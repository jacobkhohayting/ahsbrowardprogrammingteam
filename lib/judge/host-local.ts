import "server-only";
import { execFile } from "node:child_process";
import { chmod, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { RUNNER_SOURCE } from "./runner-source";
import {
  JUDGE_UID,
  JudgeHostError,
  parseRunnerOutput,
  type JudgeHost,
  type JudgeJob,
  type RunnerResult,
  type SelfTestResult,
} from "./types";

// Development only: runs the judge on this computer (needs python3, g++ and a JDK installed).
// On Vercel the site uses a Vercel Sandbox instead (host-sandbox.ts).
//
// Jobs run one at a time because they share one working folder and one judge user.
let queue: Promise<unknown> = Promise.resolve();
function oneAtATime<T>(task: () => Promise<T>): Promise<T> {
  const next = queue.then(task, task);
  queue = next.catch(() => {});
  return next;
}

function execRunner(dir: string, jobFile: string, timeoutMs: number): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(
      /* turbopackIgnore: true */ process.env.JUDGE_PYTHON || "python3",
      ["runner.py", jobFile],
      {
        cwd: dir,
        env: { PATH: process.env.PATH || "/usr/local/bin:/usr/bin:/bin" } as unknown as NodeJS.ProcessEnv,
        encoding: "utf8",
        timeout: timeoutMs,
        killSignal: "SIGKILL",
        maxBuffer: 64 * 1024 * 1024,
      },
      (error, stdout, stderr) => {
        if (stdout.includes("@@RESULT@@")) {
          resolve(stdout);
        } else if (error && (error as NodeJS.ErrnoException).code === "ENOENT") {
          reject(new JudgeHostError("python3 was not found on this computer. Install Python 3 to judge locally."));
        } else {
          reject(new JudgeHostError("The local judge runner failed: " + (stderr || stdout || String(error)).slice(-500)));
        }
      },
    );
  });
}

export class LocalHost implements JudgeHost {
  private dir: string | null = null;
  private cached = new Set<string>();
  private counter = 0;
  private uid = process.platform === "linux" && process.getuid?.() === 0 ? JUDGE_UID : null;

  private async prepare(): Promise<string> {
    if (!this.dir) {
      const dir = await mkdtemp(/* turbopackIgnore: true */ path.join(tmpdir(), "ahs-judge-"));
      await chmod(dir, 0o711); // the unprivileged judge user must be able to pass through
      await writeFile(/* turbopackIgnore: true */ path.join(dir, "runner.py"), RUNNER_SOURCE);
      this.dir = dir;
    }
    return this.dir;
  }

  private write(dir: string, name: string, content: string | Buffer): Promise<void> {
    return writeFile(/* turbopackIgnore: true */ path.join(dir, name), content);
  }

  run(job: JudgeJob): Promise<RunnerResult> {
    return oneAtATime(async () => {
      const dir = await this.prepare();
      for (let attempt = 0; attempt < 2; attempt++) {
        const id = ++this.counter;
        const upload = attempt === 1 || !this.cached.has(job.tests.key);
        const testsFile = `tests-${id}.json.gz`;
        await this.write(dir, `source-${id}`, job.source);
        if (upload) await this.write(dir, testsFile, await job.tests.load());
        await this.write(
          dir,
          `job-${id}.json`,
          JSON.stringify({
            language: job.language,
            source_path: `source-${id}`,
            tests_path: upload ? testsFile : null,
            tests_key: job.tests.key,
            time_limit_ms: job.timeLimitMs,
            memory_limit_mb: job.memoryLimitMb,
            checker: job.checker,
            mode: job.mode,
            budget_ms: job.budgetMs,
            uid: this.uid,
            work_dir: path.join(dir, "work"),
          }),
        );
        const stdout = await execRunner(dir, `job-${id}.json`, job.budgetMs + 30_000);
        await rm(/* turbopackIgnore: true */ path.join(dir, `job-${id}.json`), { force: true });
        const result = parseRunnerOutput<RunnerResult | { ok: false; need_tests: true }>(stdout);
        if ("need_tests" in result) continue;
        this.cached.add(job.tests.key);
        return result;
      }
      throw new JudgeHostError("The local judge kept asking for the test data.");
    });
  }

  selfTest(): Promise<SelfTestResult> {
    return oneAtATime(async () => {
      const dir = await this.prepare();
      await this.write(
        dir,
        "job-selftest.json",
        JSON.stringify({ selftest: true, uid: this.uid, work_dir: path.join(dir, "work") }),
      );
      const stdout = await execRunner(dir, "job-selftest.json", 120_000);
      return parseRunnerOutput<SelfTestResult>(stdout);
    });
  }

  async close(): Promise<void> {
    // Kept for the lifetime of the dev server so cached tests can be reused.
  }
}

const holder = globalThis as unknown as { __ahsLocalHost?: LocalHost };
export function localHost(): LocalHost {
  return (holder.__ahsLocalHost ??= new LocalHost());
}
