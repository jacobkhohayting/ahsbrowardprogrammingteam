"use client";

import { useEffect, useRef, useState } from "react";
import type { SubmissionView } from "@/lib/contests";
import { LANGUAGE_EXTENSIONS, STARTER_CODE, VERDICT_NAMES, type Language, type Verdict as VerdictCode } from "@/lib/format";
import { CodeEditor } from "./CodeEditor";
import { SubmissionsTable, useLiveSubmissions } from "./Submissions";

type LanguageChoice = { key: Language; name: string; available: boolean };

type RunResult = {
  verdict: VerdictCode;
  compileOutput: string;
  message: string;
  tests: {
    test: number;
    verdict: VerdictCode;
    timeMs: number;
    stdout: string;
    stdoutTruncated: boolean;
    stderr: string;
    detail: string;
  }[];
};

type Props = {
  contestId: number;
  problemId: number;
  problemLabel: string;
  languages: LanguageChoice[];
  examples: { input: string; output: string }[];
  /** Submitting is possible (contest running, logged in, entered). */
  canSubmit: boolean;
  /** Why not, when canSubmit is false. */
  closedReason: string;
  allowRun: boolean;
  mySubmissions: SubmissionView[];
  me: string | null;
};

const draftKey = (problemId: number, language: Language) => `ahs:draft:${problemId}:${language}`;

function readStore(key: string): string | null {
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null; // storage can be blocked; drafts then last only while the page is open
  }
}
function writeStore(key: string, value: string) {
  try {
    window.localStorage.setItem(key, value);
  } catch {
    // see above
  }
}

/** The right-hand side of a problem page: write code, run the examples, submit, and see your verdicts. */
export function Workspace(props: Props) {
  const { contestId, problemId, problemLabel, languages, examples, canSubmit, closedReason, allowRun, me } = props;
  const usable = languages.filter((l) => l.available);
  const names = Object.fromEntries(languages.map((l) => [l.key, l.name])) as Record<Language, string>;

  const [language, setLanguage] = useState<Language>(usable[0]?.key ?? "cpp");
  const [code, setCode] = useState(STARTER_CODE[usable[0]?.key ?? "cpp"]);
  const [busy, setBusy] = useState<"submit" | "run" | null>(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [run, setRun] = useState<RunResult | null>(null);
  const [rows, setRows] = useLiveSubmissions(props.mySubmissions);
  const fileInput = useRef<HTMLInputElement>(null);

  // Restore the language used last time and the draft saved for this problem.
  useEffect(() => {
    const saved = readStore("ahs:language") as Language | null;
    const start = saved && usable.some((l) => l.key === saved) ? saved : (usable[0]?.key ?? "cpp");
    setLanguage(start);
    setCode(readStore(draftKey(problemId, start)) ?? STARTER_CODE[start]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [problemId]);

  function edit(next: string) {
    setCode(next);
    writeStore(draftKey(problemId, language), next);
  }

  function switchLanguage(next: Language) {
    writeStore(draftKey(problemId, language), code);
    writeStore("ahs:language", next);
    setLanguage(next);
    setCode(readStore(draftKey(problemId, next)) ?? STARTER_CODE[next]);
    setRun(null);
  }

  async function loadFile(file: File | undefined) {
    if (!file) return;
    if (file.size > 64 * 1024) {
      setError("That file is larger than 64 KB.");
      return;
    }
    const extension = file.name.split(".").pop()?.toLowerCase();
    const match = (Object.keys(LANGUAGE_EXTENSIONS) as Language[]).find(
      (key) => LANGUAGE_EXTENSIONS[key] === extension || (key === "cpp" && ["cc", "cxx", "c++"].includes(extension ?? "")),
    );
    const target = match && usable.some((l) => l.key === match) ? match : language;
    const textContent = await file.text();
    if (target !== language) {
      writeStore(draftKey(problemId, language), code);
      writeStore("ahs:language", target);
      setLanguage(target);
    }
    setCode(textContent);
    writeStore(draftKey(problemId, target), textContent);
    setError("");
  }

  async function send(kind: "submit" | "run") {
    setBusy(kind);
    setError("");
    setNotice("");
    setRun(null);
    try {
      const response = await fetch(kind === "submit" ? "/api/submit" : "/api/run", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ contestId, problemId, language, source: code }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        setError(data.error || "The request did not go through. Try again.");
        return;
      }
      if (kind === "submit") {
        setRows((current) => [data.submission as SubmissionView, ...current.filter((r) => r.id !== data.id)]);
        setNotice(`Submitted as #${data.id}. The verdict appears below.`);
      } else {
        setRun(data as RunResult);
      }
    } catch {
      setError(
        kind === "submit"
          ? "Could not reach the site. Check your submissions before sending it again."
          : "Could not reach the site. Try again.",
      );
    } finally {
      setBusy(null);
    }
  }

  return (
    <section className="work" aria-label="Your solution">
      {canSubmit ? (
        <>
          <div className="editor-bar">
            <label className="sr-only" htmlFor="language">
              Language
            </label>
            <select id="language" value={language} onChange={(e) => switchLanguage(e.target.value as Language)}>
              {languages.map((l) => (
                <option key={l.key} value={l.key} disabled={!l.available}>
                  {l.name}
                  {l.available ? "" : " (unavailable)"}
                </option>
              ))}
            </select>
            <button type="button" className="btn small push" onClick={() => fileInput.current?.click()}>
              Load a file
            </button>
            <input
              ref={fileInput}
              type="file"
              hidden
              accept=".cpp,.cc,.cxx,.py,.java,.txt"
              onChange={(e) => {
                void loadFile(e.target.files?.[0]);
                e.target.value = "";
              }}
            />
          </div>
          <CodeEditor value={code} onChange={edit} language={language} label={`Code for problem ${problemLabel}`} />
          <div className="editor-foot">
            <button type="button" className="btn primary" disabled={busy !== null} onClick={() => send("submit")}>
              {busy === "submit" ? "Submitting…" : "Submit"}
            </button>
            {allowRun && examples.length > 0 && (
              <button type="button" className="btn" disabled={busy !== null} onClick={() => send("run")}>
                {busy === "run" ? "Running…" : "Run examples"}
              </button>
            )}
            <span className="hint">Reads standard input, writes standard output. Saved in this browser.</span>
          </div>
          {error && (
            <p className="msg error" role="alert" style={{ marginTop: "1rem" }}>
              {error}
            </p>
          )}
          {notice && !error && (
            <p className="msg ok" role="status" style={{ marginTop: "1rem" }}>
              {notice}
            </p>
          )}
          {run && <RunPanel run={run} examples={examples} />}
        </>
      ) : (
        <p className="msg note">{closedReason}</p>
      )}

      {(me || rows.length > 0) && (
        <>
          <h2>Your submissions for {problemLabel}</h2>
          <SubmissionsTable rows={rows} languageNames={names} me={null} empty="Nothing submitted yet." />
        </>
      )}
    </section>
  );
}

function RunPanel({ run, examples }: { run: RunResult; examples: Props["examples"] }) {
  if (run.verdict === "CE") {
    return (
      <div className="result">
        <div className="result-head verdict v-CE">Compilation error</div>
        <div className="result-body">
          <pre>{run.compileOutput || "The compiler gave no message."}</pre>
        </div>
      </div>
    );
  }
  if (run.tests.length === 0) {
    return (
      <div className="result">
        <div className="result-head verdict v-JE">The examples could not be run</div>
        <div className="result-body">{run.message || "Try again in a moment."}</div>
      </div>
    );
  }
  const passed = run.tests.filter((t) => t.verdict === "AC").length;
  return (
    <div className="result" aria-live="polite">
      <div className={`result-head verdict ${passed === run.tests.length ? "v-AC" : "v-WA"}`}>
        {passed === run.tests.length
          ? `All ${run.tests.length} examples pass. Submit to run the hidden tests.`
          : `${passed} of ${run.tests.length} examples pass`}
      </div>
      {run.tests.map((t) => {
        const example = examples[t.test - 1];
        return (
          <div className="result-body" key={t.test} style={{ borderTop: "1px solid var(--rule)" }}>
            <p style={{ margin: "0 0 0.5rem" }}>
              Example {t.test}:{" "}
              <span className={`verdict v-${t.verdict}`}>
                {VERDICT_NAMES[t.verdict]}
                {t.detail ? ` (${t.detail})` : ""}
              </span>
              <span className="muted">, {t.timeMs} ms</span>
            </p>
            <div className="io">
              <div>
                <div className="cap">Input</div>
                <pre>{example?.input ?? ""}</pre>
              </div>
              <div>
                <div className="cap">Expected output</div>
                <pre>{example?.output ?? ""}</pre>
              </div>
              <div>
                <div className="cap">Your output</div>
                <pre>
                  {t.stdout || "(nothing printed)"}
                  {t.stdoutTruncated ? "\n… (cut off)" : ""}
                </pre>
              </div>
            </div>
            {t.stderr && (
              <>
                <div className="cap small muted" style={{ marginTop: "0.5rem" }}>
                  Error output
                </div>
                <pre style={{ margin: 0 }}>{t.stderr}</pre>
              </>
            )}
          </div>
        );
      })}
    </div>
  );
}
