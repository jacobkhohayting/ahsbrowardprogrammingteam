import "server-only";
import { after } from "next/server";
import { randomBytes } from "node:crypto";
import { gzipSync } from "node:zlib";
import { q, q1 } from "../db";
import { countUsage, getSettings } from "../settings";
import type { Checker, Language } from "../format";
import { judgeMode, sandboxCredentialsOrNull, type SandboxCredentials } from "./credentials";
import { localHost } from "./host-local";
import { describeSandboxError, isMissingSnapshot, isRateLimited, SandboxHost } from "./host-sandbox";
import { buildRuntime, ensureRuntime, forgetRuntime, JudgeBusyError, toolPaths } from "./runtime";
import { JudgeHostError, type JudgeHost, type JudgeJob, type RunnerResult } from "./types";

// How submissions get judged
// --------------------------
// Submitting only stores a row with status "queued". Right after the response is sent,
// the same function keeps running (`after`) and works through the queue: it claims a
// submission, judges it in a sandbox, stores the verdict, and repeats while there is
// work and time left. Pages that show pending submissions poll for the result, and
// every poll also restarts the queue if something is waiting, so nothing gets stuck.

/** How many submissions may be judged at the same time (Vercel's free plan allows 10 sandboxes). */
const MAX_CONCURRENT = 4;
/** A claim older than this belongs to a function that was cut off; someone else may take over. */
const STALE_AFTER = "6 minutes";
const MAX_ATTEMPTS = 3;
/** Vercel stops a function after 300 seconds; stay clear of that. */
const DRAIN_MS = 270_000;

type Claimed = {
  id: number;
  problem_id: number;
  language: Language;
  source: string;
  attempts: number;
  admin_test: boolean;
};

type ProblemForJudge = {
  id: number;
  time_limit_ms: number;
  memory_limit_mb: number;
  checker: Checker;
  tests_version: number;
  test_count: number;
};

// ---------------------------------------------------------------------------
// Test data (kept in memory between requests so it is not re-read for every submission)
// ---------------------------------------------------------------------------
type BundleCache = { map: Map<string, Buffer>; bytes: number };
const cacheHolder = globalThis as unknown as { __ahsBundles?: BundleCache };
const bundles: BundleCache = (cacheHolder.__ahsBundles ??= { map: new Map(), bytes: 0 });
const BUNDLE_CACHE_BYTES = 64 * 1024 * 1024;

async function testsBundle(problemId: number, version: number, examplesOnly: boolean): Promise<Buffer> {
  const key = `${problemId}:${version}:${examplesOnly ? "ex" : "all"}`;
  const hit = bundles.map.get(key);
  if (hit) return hit;
  // Examples first, so "test 1" for a student is the first example in the statement.
  const rows = await q<{ input: string; expected_output: string }>(
    `select input, expected_output from tests
     where problem_id = $1 ${examplesOnly ? "and is_example" : ""}
     order by is_example desc, ord, id`,
    [problemId],
  );
  const bundle = gzipSync(JSON.stringify(rows.map((row) => [row.input, row.expected_output])), { level: 1 });
  bundles.map.set(key, bundle);
  bundles.bytes += bundle.length;
  for (const [oldKey, old] of bundles.map) {
    if (bundles.bytes <= BUNDLE_CACHE_BYTES || oldKey === key) break;
    bundles.map.delete(oldKey);
    bundles.bytes -= old.length;
  }
  return bundle;
}

async function problemForJudge(problemId: number): Promise<ProblemForJudge | null> {
  return q1<ProblemForJudge>(
    `select p.id, p.time_limit_ms, p.memory_limit_mb, p.checker, p.tests_version,
            (select count(*) from tests t where t.problem_id = p.id) as test_count
     from problems p where p.id = $1`,
    [problemId],
  );
}

async function scaledTimeLimit(problem: ProblemForJudge, language: Language): Promise<number> {
  const settings = await getSettings();
  const factor = language === "python" ? settings.timeFactorPython : language === "java" ? settings.timeFactorJava : 1;
  return Math.round(problem.time_limit_ms * Math.max(1, factor || 1));
}

// ---------------------------------------------------------------------------
// Hosts
// ---------------------------------------------------------------------------
async function openSandboxHost(credentials: SandboxCredentials | null, remainingMs: number): Promise<JudgeHost> {
  if (!credentials) {
    throw new JudgeHostError(
      "Vercel did not provide an identity token, so no sandbox could be started. Open /setup for details.",
    );
  }
  const lifetime = Math.max(90_000, Math.min(remainingMs + 30_000, 6 * 60_000));
  let runtime = await ensureRuntime(credentials, Math.max(10_000, remainingMs - 70_000));
  try {
    const host = await SandboxHost.open(credentials, runtime.snapshotId, toolPaths(runtime), lifetime);
    await countUsage("sandboxes");
    return host;
  } catch (error) {
    if (!isMissingSnapshot(error)) {
      throw new JudgeHostError("Could not start the judge sandbox: " + describeSandboxError(error), { cause: error });
    }
    // The saved machine is gone (expired or deleted in the Vercel dashboard): build a new one.
    await forgetRuntime();
    runtime = await buildRuntime(credentials);
    const host = await SandboxHost.open(credentials, runtime.snapshotId, toolPaths(runtime), lifetime);
    await countUsage("sandboxes");
    return host;
  }
}

function openHost(credentials: SandboxCredentials | null, remainingMs: number): Promise<JudgeHost> {
  return judgeMode() === "local" ? Promise.resolve(localHost()) : openSandboxHost(credentials, remainingMs);
}

// ---------------------------------------------------------------------------
// Queue
// ---------------------------------------------------------------------------
async function claimNext(token: string): Promise<Claimed | null> {
  return q1<Claimed>(
    `with active as (
       select count(*) as n from submissions
       where status = 'judging' and judge_started_at > now() - interval '${STALE_AFTER}'
     ), next as (
       select id from submissions
       where (status = 'queued' and (retry_at is null or retry_at <= now()))
          or (status = 'judging' and judge_started_at <= now() - interval '${STALE_AFTER}')
       order by priority desc, id
       limit 1
       for update skip locked
     )
     update submissions s
     set status = 'judging', judge_started_at = now(), attempts = s.attempts + 1, judge_token = $1, retry_at = null
     from next, active
     where s.id = next.id and active.n < $2
     returning s.id, s.problem_id, s.language, s.source, s.attempts, s.admin_test`,
    [token, MAX_CONCURRENT],
  );
}

async function finish(id: number, token: string, result: RunnerResult): Promise<void> {
  const log = result.tests.map((t) => ({ t: t.test, v: t.verdict, ms: t.time_ms, kb: t.memory_kb }));
  await q(
    `update submissions
     set status = 'done', verdict = $3, failed_test = $4, tests_passed = $5, tests_total = $6,
         time_ms = $7, memory_kb = $8, compile_output = $9, judge_log = $10::jsonb, message = $11,
         judged_at = now(), judge_token = null
     where id = $1 and judge_token = $2`,
    [
      id,
      token,
      result.verdict,
      result.failed_test,
      result.passed,
      result.total,
      result.verdict === "CE" ? null : result.time_ms,
      result.verdict === "CE" ? null : result.memory_kb,
      result.compile_output || null,
      JSON.stringify(log),
      result.message || null,
    ],
  );
}

async function failForGood(id: number, token: string, message: string): Promise<void> {
  await q(
    `update submissions
     set status = 'done', verdict = 'JE', failed_test = null, message = $3, judged_at = now(), judge_token = null
     where id = $1 and judge_token = $2`,
    [id, token, message.slice(0, 1000)],
  );
}

/** Put a submission back in the queue after the judge (not the submission) had a problem. */
async function retryLater(sub: Claimed, token: string, message: string, countAttempt: boolean): Promise<void> {
  if (countAttempt && sub.attempts >= MAX_ATTEMPTS) {
    await failForGood(sub.id, token, `The judge failed ${sub.attempts} times. Last problem: ${message}`);
    return;
  }
  await q(
    `update submissions
     set status = 'queued', judge_token = null, message = $3,
         attempts = attempts - $4, retry_at = now() + make_interval(secs => $5)
     where id = $1 and judge_token = $2`,
    [sub.id, token, message.slice(0, 1000) || null, countAttempt ? 0 : 1, countAttempt ? 15 * sub.attempts : 5],
  );
}

/** Judges queued submissions until the queue is empty or time is nearly up. */
export async function drain(credentials: SandboxCredentials | null, deadline = Date.now() + DRAIN_MS): Promise<void> {
  let host: JudgeHost | null = null;
  let judged = 0;
  try {
    for (;;) {
      const remaining = deadline - Date.now();
      if (remaining < 45_000) break;
      const token = randomBytes(12).toString("hex");
      const sub = await claimNext(token);
      if (!sub) break;

      try {
        if (sub.attempts > MAX_ATTEMPTS) {
          // Claimed again and again without finishing: the function judging it keeps getting cut off.
          await failForGood(
            sub.id,
            token,
            "The judge was interrupted several times while running this submission. " +
              "Its tests may take too long in total: use fewer tests or a shorter time limit, then rejudge.",
          );
          continue;
        }
        const problem = await problemForJudge(sub.problem_id);
        if (!problem || problem.test_count === 0) {
          await failForGood(sub.id, token, "This problem has no tests yet.");
          continue;
        }
        const timeLimitMs = await scaledTimeLimit(problem, sub.language);
        // If a slow-but-correct solution could not finish in the time this function has left,
        // leave it for a fresh run (unless this run is already fresh).
        const worstCase = 20_000 + problem.test_count * (timeLimitMs + 300);
        if (judged > 0 && worstCase > remaining - 30_000) {
          await retryLater(sub, token, "", false);
          break;
        }
        host ??= await openHost(credentials, remaining);
        const job: JudgeJob = {
          language: sub.language,
          source: sub.source,
          tests: {
            key: `p${problem.id}-v${problem.tests_version}`,
            load: () => testsBundle(problem.id, problem.tests_version, false),
          },
          timeLimitMs,
          memoryLimitMb: problem.memory_limit_mb,
          checker: problem.checker,
          mode: sub.admin_test ? "full" : "judge",
          budgetMs: Math.max(20_000, deadline - Date.now() - 30_000),
        };
        const result = await host.run(job);
        await finish(sub.id, token, result);
        judged++;
      } catch (error) {
        if (host) {
          await host.close();
          host = null;
        }
        if (error instanceof JudgeBusyError) {
          await retryLater(sub, token, error.message, false);
          break;
        }
        const message = error instanceof Error ? error.message : String(error);
        console.error(`judge: submission ${sub.id} could not be judged:`, error);
        // Being rate limited by Vercel is not the submission's fault: wait without using up an attempt.
        await retryLater(sub, token, message, !isRateLimited(error));
        break; // let the next kick continue, instead of failing everything in a tight loop
      }
    }
  } finally {
    if (host) await host.close();
  }
}

/**
 * Start working through the queue once the current response has been sent.
 * Must be called while handling a request.
 */
export async function scheduleDrain(): Promise<void> {
  const credentials = await sandboxCredentialsOrNull();
  after(async () => {
    try {
      await drain(credentials);
    } catch (error) {
      console.error("judge: the queue stopped with an error:", error);
    }
  });
}

/** Restart the queue if anything is waiting. Cheap when there is nothing to do. */
export async function kickIfPending(): Promise<void> {
  const waiting = await q1(
    `select 1 as x from submissions
     where (status = 'queued' and (retry_at is null or retry_at <= now()))
        or (status = 'judging' and judge_started_at <= now() - interval '${STALE_AFTER}')
     limit 1`,
  );
  if (waiting) await scheduleDrain();
}

/** "Run examples": compile and run against the public examples right now, without storing anything. */
export async function runExamples(
  credentials: SandboxCredentials | null,
  problemId: number,
  language: Language,
  source: string,
): Promise<RunnerResult> {
  const problem = await problemForJudge(problemId);
  if (!problem) throw new JudgeHostError("Problem not found.");
  const timeLimitMs = await scaledTimeLimit(problem, language);
  const host = await openHost(credentials, 120_000);
  try {
    return await host.run({
      language,
      source,
      tests: {
        key: `p${problem.id}-v${problem.tests_version}-examples`,
        load: () => testsBundle(problem.id, problem.tests_version, true),
      },
      timeLimitMs,
      memoryLimitMb: problem.memory_limit_mb,
      checker: problem.checker,
      mode: "examples",
      budgetMs: 75_000,
    });
  } finally {
    await host.close();
  }
}

/** Queue submissions for judging again. New submissions keep priority over rejudges. */
export async function requeue(where: string, params: unknown[]): Promise<number> {
  const rows = await q(
    `update submissions
     set status = 'queued', verdict = null, failed_test = null, tests_passed = 0, time_ms = null,
         memory_kb = null, compile_output = null, judge_log = null, message = null, judged_at = null,
         judge_token = null, attempts = 0, retry_at = null, priority = -1
     where ${where}
     returning id`,
    params,
  );
  return rows.length;
}
