import "server-only";
import { Sandbox, Snapshot } from "@vercel/sandbox";
import { q1 } from "../db";
import { countUsage, readSetting, writeSetting } from "../settings";
import { LANGUAGE_NAMES, type Language } from "../format";
import type { SandboxCredentials } from "./credentials";
import { describeSandboxError, SandboxHost, withTimeout, type ToolPaths } from "./host-sandbox";
import { JudgeHostError, type SelfTestResult } from "./types";

// The "judge machine": a saved copy (snapshot) of a sandbox that already has the
// compilers installed. Every submission starts from this copy, so nothing has to be
// installed while students wait. The site builds it by itself the first time it is
// needed (about 2 minutes), or when an organizer presses "Prepare judge".

/** Increase this when the software installed below changes, to force a rebuild. */
export const TOOLCHAIN_VERSION = 1;
const PCH_DIR = "/opt/ahs-pch";
const BUILD_IMAGES = ["vercel/sandbox/python:3.14", "vercel/sandbox/universal"];

export type LanguageStatus = { ok: boolean; message: string; version: string };

export type JudgeRuntime = {
  snapshotId: string;
  toolchain: number;
  builtAt: string;
  image: string;
  python: string;
  pchDir: string | null;
  isolated: boolean;
  secretSafe: boolean | null;
  languages: Record<Language, LanguageStatus>;
};

export type BuildState = {
  running: boolean;
  step: string;
  until: string;
  startedAt: string;
  error?: string;
};

export class JudgeBusyError extends Error {
  constructor() {
    super("The judge is being prepared right now. This takes about two minutes.");
    this.name = "JudgeBusyError";
  }
}

export async function getRuntime(): Promise<JudgeRuntime | null> {
  const runtime = await readSetting<JudgeRuntime>("judge");
  return runtime && runtime.toolchain === TOOLCHAIN_VERSION && runtime.snapshotId ? runtime : null;
}

export async function getBuildState(): Promise<BuildState | null> {
  const state = await readSetting<BuildState>("judge_build");
  if (!state) return null;
  // A build that outlived its deadline was cut off (for example by the function time limit).
  if (state.running && new Date(state.until).getTime() < Date.now()) {
    return { ...state, running: false, error: state.error ?? "The last attempt was interrupted. Try again." };
  }
  return state;
}

export function toolPaths(runtime: JudgeRuntime): ToolPaths {
  return { python: runtime.python || "python3", pchDir: runtime.pchDir };
}

/** Only one build may run at a time. Returns false if another one holds the lock. */
async function acquireBuildLock(state: BuildState): Promise<boolean> {
  const row = await q1(
    `insert into settings (key, value) values ('judge_build', $1::jsonb)
     on conflict (key) do update set value = excluded.value, updated_at = now()
     where coalesce((settings.value ->> 'running')::boolean, false) = false
        or (settings.value ->> 'until')::timestamptz < now()
     returning 1 as ok`,
    [JSON.stringify(state)],
  );
  return row !== null;
}

async function createBuildSandbox(credentials: SandboxCredentials): Promise<{ sandbox: Sandbox; image: string }> {
  let lastError: unknown;
  for (const image of BUILD_IMAGES) {
    try {
      const sandbox = await withTimeout(
        Sandbox.create({
          ...credentials,
          image,
          persistent: false,
          timeout: 9 * 60_000,
          resources: { vcpus: 2 },
          networkPolicy: "allow-all", // needed to download the compilers; judging sandboxes get no network
        }),
        60_000,
        "Vercel did not start a sandbox within 60 seconds.",
      );
      await countUsage("sandboxes");
      return { sandbox, image };
    } catch (error) {
      lastError = error;
    }
  }
  throw new JudgeHostError("Could not start a Vercel Sandbox: " + describeSandboxError(lastError), {
    cause: lastError,
  });
}

/** Runs a shell command as root in the build sandbox. */
async function shell(sandbox: Sandbox, script: string, timeoutMs: number) {
  const finished = await withTimeout(
    sandbox.runCommand({
      cmd: "bash",
      args: ["-c", script],
      sudo: true,
      timeoutMs,
      env: { DEBIAN_FRONTEND: "noninteractive" },
    }),
    timeoutMs + 15_000,
    "A setup command in the sandbox took too long.",
  );
  let output = "";
  try {
    output = await withTimeout(finished.output("both"), 15_000, "Reading command output took too long.");
  } catch {
    // The exit code is what matters.
  }
  return { ok: finished.exitCode === 0, output: output.slice(-600) };
}

/**
 * Installs the compilers in a fresh sandbox, tests every language and saves the result
 * as a snapshot. Takes roughly two minutes. Safe to call again at any time.
 */
export async function buildRuntime(credentials: SandboxCredentials): Promise<JudgeRuntime> {
  const startedAt = new Date().toISOString();
  const state = (step: string, extra: Partial<BuildState> = {}): BuildState => ({
    running: true,
    step,
    startedAt,
    until: new Date(Date.now() + 5 * 60_000).toISOString(),
    ...extra,
  });
  if (!(await acquireBuildLock(state("Starting a sandbox")))) throw new JudgeBusyError();

  const previous = await readSetting<JudgeRuntime>("judge");
  let sandbox: Sandbox | null = null;
  let saved = false;
  try {
    const created = await createBuildSandbox(credentials);
    sandbox = created.sandbox;
    const progress = (step: string) => writeSetting("judge_build", state(step));

    await progress("Installing the C++ compiler");
    const update = await shell(sandbox, "apt-get update -qq", 120_000);
    const cpp = await shell(sandbox, "apt-get install -y -qq --no-install-recommends g++", 200_000);

    await progress("Installing Java");
    const java = await shell(sandbox, "apt-get install -y -qq --no-install-recommends default-jdk-headless", 200_000);

    const python = await shell(
      sandbox,
      "command -v python3 >/dev/null || apt-get install -y -qq --no-install-recommends python3; command -v python3",
      120_000,
    );
    const pythonPath = python.output.trim().split("\n").pop()?.trim() || "";
    if (!python.ok || !pythonPath.startsWith("/")) {
      throw new JudgeHostError(
        "Python is missing in the sandbox and could not be installed. " + (update.output || python.output),
      );
    }

    // Precompile <bits/stdc++.h> so C++ submissions compile about three times faster.
    await progress("Speeding up C++ compiles");
    const pch = cpp.ok
      ? await shell(
          sandbox,
          `set -e
           header=$(echo '#include <bits/stdc++.h>' | g++ -std=gnu++20 -x c++ -E -H - 2>&1 >/dev/null | grep -m1 'bits/stdc++.h' | awk '{print $2}')
           mkdir -p ${PCH_DIR}/bits
           g++ -std=gnu++20 -O2 -DONLINE_JUDGE -x c++-header "$header" -o ${PCH_DIR}/bits/stdc++.h.gch
           chmod -R a+rX ${PCH_DIR}`,
          90_000,
        )
      : { ok: false, output: "" };
    await shell(sandbox, "apt-get clean; rm -rf /var/lib/apt/lists/*", 30_000);

    await progress("Testing every language");
    const tools: ToolPaths = { python: pythonPath, pchDir: pch.ok ? PCH_DIR : null };
    const host = new SandboxHost(sandbox, tools);
    let test: SelfTestResult;
    try {
      test = await host.selfTest();
    } catch (error) {
      throw new JudgeHostError("The judge self-test could not run: " + describeSandboxError(error), { cause: error });
    }
    if (!test.languages.cpp.ok && !cpp.ok) {
      test.languages.cpp.message = "The compiler could not be installed. " + (cpp.output || update.output);
    }
    if (!test.languages.java.ok && !java.ok) {
      test.languages.java.message = "Java could not be installed. " + java.output;
    }
    if (!Object.values(test.languages).some((language) => language.ok)) {
      throw new JudgeHostError(
        "No language passed the self-test. " +
          Object.entries(test.languages)
            .map(([name, status]) => `${name}: ${status.message}`)
            .join(" | "),
      );
    }

    await progress("Saving the prepared machine");
    // The snapshot never expires. Taking it also shuts the sandbox down.
    const snapshot = await withTimeout(
      sandbox.snapshot({ expiration: 0 }),
      170_000,
      "Saving the snapshot took too long.",
    );
    saved = true;

    const runtime: JudgeRuntime = {
      snapshotId: snapshot.snapshotId,
      toolchain: TOOLCHAIN_VERSION,
      builtAt: new Date().toISOString(),
      image: created.image,
      python: pythonPath,
      pchDir: tools.pchDir,
      isolated: test.isolated,
      secretSafe: test.secret_safe,
      languages: test.languages,
    };
    await writeSetting("judge", runtime);
    await writeSetting("judge_build", { ...state("Done"), running: false });

    // Free the storage used by the snapshot this one replaces.
    if (previous?.snapshotId && previous.snapshotId !== runtime.snapshotId) {
      try {
        const old = await Snapshot.get({ ...credentials, snapshotId: previous.snapshotId });
        await old.delete();
      } catch {
        // Already gone.
      }
    }
    return runtime;
  } catch (error) {
    const message = error instanceof JudgeHostError ? error.message : describeSandboxError(error);
    await writeSetting("judge_build", { ...state("Failed"), running: false, error: message }).catch(() => {});
    throw error instanceof JudgeHostError ? error : new JudgeHostError(message, { cause: error });
  } finally {
    if (sandbox && !saved) await sandbox.stop().catch(() => {});
  }
}

/** Forget the stored snapshot (for example because Vercel says it no longer exists). */
export async function forgetRuntime(): Promise<void> {
  await writeSetting("judge", {});
}

/**
 * Returns the prepared judge machine, building it first if there is none.
 * If someone else is already building it, waits for them (up to `waitMs`).
 */
export async function ensureRuntime(credentials: SandboxCredentials, waitMs: number): Promise<JudgeRuntime> {
  const existing = await getRuntime();
  if (existing) return existing;
  try {
    return await buildRuntime(credentials);
  } catch (error) {
    if (!(error instanceof JudgeBusyError)) throw error;
    const deadline = Date.now() + waitMs;
    while (Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, 4000));
      const ready = await getRuntime();
      if (ready) return ready;
      const build = await getBuildState();
      if (build && !build.running) break;
    }
    const ready = await getRuntime();
    if (ready) return ready;
    throw error;
  }
}

/** "g++ (Ubuntu 15.2.0-4ubuntu4) 15.2.0" -> "C++20 (GCC 15.2)", and so on. */
export function languageDisplayNames(runtime: JudgeRuntime | null): Record<Language, string> {
  const names = { ...LANGUAGE_NAMES };
  if (!runtime) return names;
  const gcc = /(\d+)\.(\d+)(?:\.\d+)?\s*$/.exec(runtime.languages.cpp?.version ?? "");
  if (gcc) names.cpp = `C++20 (GCC ${gcc[1]}.${gcc[2]})`;
  const python = /Python (\d+)\.(\d+)/.exec(runtime.languages.python?.version ?? "");
  if (python) names.python = `Python ${python[1]}.${python[2]}`;
  const java = /(?:openjdk|java)[^\d]*(\d+)/i.exec(runtime.languages.java?.version ?? "");
  if (java) names.java = `Java ${java[1]}`;
  return names;
}
