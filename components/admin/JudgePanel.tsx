"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";

type LanguageStatus = { ok: boolean; message: string; version: string };
type Runtime = {
  builtAt: string;
  isolated: boolean;
  secretSafe: boolean | null;
  pchDir: string | null;
  languages: Record<string, LanguageStatus>;
};
type Build = { running: boolean; step: string; error?: string };
type State = { mode: "sandbox" | "local"; runtime: Runtime | null; build: Build | null; names: Record<string, string> | null };
type LocalTest = { isolated: boolean; secret_safe: boolean | null; languages: Record<string, LanguageStatus> };

const LANGUAGE_LABEL: Record<string, string> = { cpp: "C++", python: "Python", java: "Java" };

/** Shows whether the judge is ready, and lets an organizer prepare or rebuild it. */
export function JudgePanel({ initial }: { initial: State }) {
  const router = useRouter();
  const [state, setState] = useState(initial);
  const [error, setError] = useState("");
  const [starting, setStarting] = useState(false);
  const [localTest, setLocalTest] = useState<LocalTest | null>(null);
  const wasRunning = useRef(initial.build?.running ?? false);

  const running = starting || (state.build?.running ?? false);

  useEffect(() => {
    if (!running || state.mode === "local") return;
    let stopped = false;
    const timer = setInterval(async () => {
      try {
        const response = await fetch("/api/admin/judge", { cache: "no-store" });
        if (!response.ok || stopped) return;
        const next = (await response.json()) as State;
        setState(next);
        if (next.build?.running) wasRunning.current = true;
        if (wasRunning.current && !next.build?.running) {
          wasRunning.current = false;
          setStarting(false);
          router.refresh();
        }
      } catch {
        // try again on the next tick
      }
    }, 3000);
    return () => {
      stopped = true;
      clearInterval(timer);
    };
  }, [running, state.mode, router]);

  async function prepare() {
    setError("");
    setStarting(true);
    try {
      const response = await fetch("/api/admin/judge", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: "{}",
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        setError(data.error || "Could not start. Try again.");
        setStarting(false);
        return;
      }
      if (data.mode === "local") {
        setLocalTest(data.selfTest as LocalTest);
        setStarting(false);
      } else {
        wasRunning.current = true;
      }
    } catch {
      setError("Could not reach the site. Try again.");
      setStarting(false);
    }
  }

  const languages = state.mode === "local" ? localTest?.languages : state.runtime?.languages;
  const isolation = state.mode === "local" ? localTest : state.runtime && { isolated: state.runtime.isolated, secret_safe: state.runtime.secretSafe };

  return (
    <div>
      {state.mode === "local" ? (
        <p className="msg note">
          Development mode: submissions are compiled and run on this computer. On Vercel they run in isolated
          sandboxes instead.
        </p>
      ) : running ? (
        <p className="msg warn" role="status">
          Preparing the judge: {state.build?.step ?? "starting"}… This takes about two minutes. You can leave this
          page.
        </p>
      ) : state.runtime ? (
        <p className="msg ok">
          The judge is ready. It was prepared on {new Date(state.runtime.builtAt).toLocaleString()}.
        </p>
      ) : (
        <p className="msg warn">
          The judge has not been prepared yet. Do it now so the first submission does not have to wait two minutes.
        </p>
      )}

      {!running && state.build?.error && state.mode !== "local" && (
        <p className="msg error">The last attempt failed: {state.build.error}</p>
      )}
      {error && (
        <p className="msg error" role="alert">
          {error}
        </p>
      )}

      {languages && (
        <div className="table-wrap">
          <table style={{ width: "auto" }}>
            <thead>
              <tr>
                <th>Language</th>
                <th>Self-test</th>
                <th>Version</th>
              </tr>
            </thead>
            <tbody>
              {Object.entries(languages).map(([key, status]) => (
                <tr key={key}>
                  <td>{LANGUAGE_LABEL[key] ?? key}</td>
                  <td>
                    <span className={`verdict ${status.ok ? "v-AC" : "v-WA"}`}>{status.ok ? "Works" : "Not working"}</span>
                    <span className="sub">{status.message}</span>
                  </td>
                  <td className="small muted">{status.version || "unknown"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {isolation && (
        <p className="small muted">
          {isolation.isolated
            ? "Submissions run as a separate, unprivileged user."
            : "Submissions run as the same user as the judge (fine for development, not for a real contest)."}{" "}
          {isolation.secret_safe === true && "Checked: a submission cannot read the hidden tests."}
          {isolation.secret_safe === false && "Warning: the hidden-test protection check failed."}
        </p>
      )}

      <button type="button" className="btn" onClick={prepare} disabled={running}>
        {state.mode === "local"
          ? starting
            ? "Testing…"
            : "Test the compilers on this computer"
          : running
            ? "Preparing…"
            : state.runtime
              ? "Rebuild the judge"
              : "Prepare the judge"}
      </button>
    </div>
  );
}
