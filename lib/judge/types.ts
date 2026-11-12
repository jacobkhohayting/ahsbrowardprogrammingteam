import type { Checker, Language, Verdict } from "../format";

/** What the website asks a judge host to do. */
export type JudgeJob = {
  language: Language;
  source: string;
  /** Test data, sent to the host only if it does not have this key cached yet. */
  tests: { key: string; load: () => Promise<Buffer> };
  timeLimitMs: number;
  memoryLimitMb: number;
  checker: Checker;
  /**
   * judge    - stop at the first failing test (normal submissions)
   * full     - run every test (organizer test runs)
   * examples - run every test and return the program's output ("Run examples")
   */
  mode: "judge" | "full" | "examples";
  /** How long the whole job may take before the runner gives up. */
  budgetMs: number;
};

export type RunnerTest = {
  test: number;
  verdict: Verdict;
  time_ms: number;
  memory_kb: number;
  detail?: string;
  stdout?: string;
  stdout_truncated?: boolean;
  stderr?: string;
};

/** What judge/runner.py prints. */
export type RunnerResult = {
  ok: true;
  verdict: Verdict;
  failed_test: number | null;
  passed: number;
  total: number;
  time_ms: number;
  memory_kb: number;
  compile_output: string;
  tests: RunnerTest[];
  message: string;
  isolated: boolean;
};

export type SelfTestResult = {
  ok: true;
  selftest: true;
  isolated: boolean;
  secret_safe: boolean | null;
  languages: Record<Language, { ok: boolean; message: string; version: string }>;
};

/** A place where the runner can be executed: a Vercel Sandbox, or this computer during development. */
export interface JudgeHost {
  run(job: JudgeJob): Promise<RunnerResult>;
  selfTest(): Promise<SelfTestResult>;
  close(): Promise<void>;
}

/** The judge itself failed (not the submission). The submission should be retried. */
export class JudgeHostError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = "JudgeHostError";
  }
}

/** The uid submitted programs run as. It has no account, no password and no sudo rights. */
export const JUDGE_UID = 61234;

export function parseRunnerOutput<T>(stdout: string): T {
  const marker = "@@RESULT@@";
  const at = stdout.lastIndexOf(marker);
  if (at === -1) throw new JudgeHostError("The judge runner did not return a result.");
  const line = stdout.slice(at + marker.length).split("\n")[0];
  let parsed: { ok?: boolean; error?: string };
  try {
    parsed = JSON.parse(line);
  } catch {
    throw new JudgeHostError("The judge runner returned something unreadable.");
  }
  if (!parsed.ok && !(parsed as { need_tests?: boolean }).need_tests) {
    throw new JudgeHostError("Judge runner error: " + (parsed.error || "unknown"));
  }
  return parsed as T;
}
