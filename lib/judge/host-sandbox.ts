import "server-only";
import { Sandbox } from "@vercel/sandbox";
import { RUNNER_SOURCE, RUNNER_VERSION } from "./runner-source";
import type { SandboxCredentials } from "./credentials";
import {
  JUDGE_UID,
  JudgeHostError,
  parseRunnerOutput,
  type JudgeHost,
  type JudgeJob,
  type RunnerResult,
  type SelfTestResult,
} from "./types";

export const WORK_DIR = "/judge";
const RUNNER_FILE = `ahs-runner-${RUNNER_VERSION}.py`;

/** Fails with `message` if `promise` has not settled after `ms`. Sandbox API calls can hang. */
export function withTimeout<T>(promise: Promise<T>, ms: number, message: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  return Promise.race([
    promise,
    new Promise<T>((_, reject) => {
      timer = setTimeout(() => reject(new JudgeHostError(message)), ms);
    }),
  ]).finally(() => clearTimeout(timer));
}

/** A readable one-line description of a Sandbox SDK error. */
export function describeSandboxError(error: unknown): string {
  if (!(error instanceof Error)) return String(error);
  const extra = error as Error & { json?: unknown; text?: string; response?: { status?: number } };
  const status = extra.response?.status ? ` (HTTP ${extra.response.status})` : "";
  let detail = "";
  if (extra.json) detail = " " + JSON.stringify(extra.json).slice(0, 300);
  else if (extra.text) detail = " " + extra.text.slice(0, 300);
  return `${error.message.split("\n")[0]}${status}${detail}`;
}

export function isMissingSnapshot(error: unknown): boolean {
  return /snapshot[\s_-]*(not[\s_-]*found|expired|deleted|region)|snapshot_not_found/i.test(describeSandboxError(error));
}

export function isRateLimited(error: unknown): boolean {
  const text = describeSandboxError(error);
  return /HTTP 429|rate.?limit|too many|quota|concurren/i.test(text);
}

export type ToolPaths = { python: string; pchDir: string | null };

/** Runs judge jobs inside one Vercel Sandbox. Reused for several submissions in a row. */
export class SandboxHost implements JudgeHost {
  private cached = new Set<string>();
  private counter = 0;
  private runnerUploaded = false;

  constructor(
    private sandbox: Sandbox,
    private tools: ToolPaths,
  ) {}

  /** Starts a fresh, network-less sandbox from the prepared snapshot. */
  static async open(
    credentials: SandboxCredentials,
    snapshotId: string,
    tools: ToolPaths,
    lifetimeMs: number,
  ): Promise<SandboxHost> {
    const sandbox = await withTimeout(
      Sandbox.create({
        ...credentials,
        source: { type: "snapshot", snapshotId },
        persistent: false,
        timeout: lifetimeMs,
        resources: { vcpus: 1 },
        networkPolicy: "deny-all",
      }),
      45_000,
      "Vercel did not start the judge sandbox within 45 seconds.",
    );
    return new SandboxHost(sandbox, tools);
  }

  private async execute(jobFile: string, files: { path: string; content: string | Uint8Array }[], timeoutMs: number) {
    if (!this.runnerUploaded) files.push({ path: RUNNER_FILE, content: RUNNER_SOURCE });
    await withTimeout(this.sandbox.writeFiles(files), 30_000, "Sending files to the judge sandbox took too long.");
    this.runnerUploaded = true;
    const finished = await withTimeout(
      // sudo: the runner needs root to lock away the tests and to drop to an unprivileged user.
      this.sandbox.runCommand({
        cmd: this.tools.python,
        args: [RUNNER_FILE, jobFile],
        cwd: this.sandbox.cwd, // the same folder writeFiles puts relative paths in
        sudo: true,
        timeoutMs,
      }),
      timeoutMs + 15_000,
      "The judge sandbox did not answer in time.",
    );
    const stdout = await withTimeout(finished.stdout(), 20_000, "Reading the judge result took too long.");
    if (!stdout.includes("@@RESULT@@")) {
      const stderr = await finished.stderr().catch(() => "");
      throw new JudgeHostError(
        `The judge runner stopped without a result (exit code ${finished.exitCode}). ${stderr.slice(-400)}`,
      );
    }
    return stdout;
  }

  async run(job: JudgeJob): Promise<RunnerResult> {
    for (let attempt = 0; attempt < 2; attempt++) {
      const id = ++this.counter;
      const upload = attempt === 1 || !this.cached.has(job.tests.key);
      const testsFile = `ahs-tests-${id}.json.gz`;
      const files: { path: string; content: string | Uint8Array }[] = [
        { path: `ahs-source-${id}`, content: job.source },
        {
          path: `ahs-job-${id}.json`,
          content: JSON.stringify({
            language: job.language,
            source_path: `ahs-source-${id}`,
            tests_path: upload ? testsFile : null,
            tests_key: job.tests.key,
            time_limit_ms: job.timeLimitMs,
            memory_limit_mb: job.memoryLimitMb,
            checker: job.checker,
            mode: job.mode,
            budget_ms: job.budgetMs,
            uid: JUDGE_UID,
            work_dir: WORK_DIR,
            tools: { cxx_pch_dir: this.tools.pchDir },
          }),
        },
      ];
      if (upload) files.push({ path: testsFile, content: await job.tests.load() });
      const stdout = await this.execute(`ahs-job-${id}.json`, files, job.budgetMs + 20_000);
      const result = parseRunnerOutput<RunnerResult | { ok: false; need_tests: true }>(stdout);
      if ("need_tests" in result) continue;
      this.cached.add(job.tests.key);
      return result;
    }
    throw new JudgeHostError("The judge sandbox kept asking for the test data.");
  }

  async selfTest(): Promise<SelfTestResult> {
    const stdout = await this.execute(
      "ahs-job-selftest.json",
      [
        {
          path: "ahs-job-selftest.json",
          content: JSON.stringify({
            selftest: true,
            uid: JUDGE_UID,
            work_dir: WORK_DIR,
            tools: { cxx_pch_dir: this.tools.pchDir },
          }),
        },
      ],
      150_000,
    );
    return parseRunnerOutput<SelfTestResult>(stdout);
  }

  async close(): Promise<void> {
    try {
      await withTimeout(this.sandbox.stop(), 8_000, "Stopping the sandbox took too long.");
    } catch {
      // It shuts itself down when its lifetime runs out.
    }
  }
}
