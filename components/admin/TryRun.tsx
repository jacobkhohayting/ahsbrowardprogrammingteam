"use client";

import { useState } from "react";
import type { SubmissionView } from "@/lib/contests";
import type { Language } from "@/lib/format";
import { CodeEditor } from "@/components/CodeEditor";
import { SubmissionsTable, useLiveSubmissions } from "@/components/Submissions";

type Props = {
  problemId: number;
  languages: { key: Language; name: string; available: boolean }[];
  reference: { language: Language; code: string };
  recent: SubmissionView[];
};

/**
 * Lets an organizer run a solution against every test of the problem before students see it.
 * These runs are judged like real submissions but never appear on the student site.
 */
export function TryRun({ problemId, languages, reference, recent }: Props) {
  const [language, setLanguage] = useState<Language>(reference.language);
  const [code, setCode] = useState(reference.code);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [rows, setRows] = useLiveSubmissions(recent);
  const names = Object.fromEntries(languages.map((l) => [l.key, l.name])) as Record<Language, string>;

  async function run() {
    setBusy(true);
    setError("");
    try {
      const response = await fetch("/api/admin/test-run", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ problemId, language, source: code }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) setError(data.error || "Could not start the run. Try again.");
      else setRows((current) => [data.submission as SubmissionView, ...current]);
    } catch {
      setError("Could not reach the site. Try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div>
      <div className="editor-bar">
        <label className="sr-only" htmlFor="try-language">
          Language
        </label>
        <select id="try-language" value={language} onChange={(e) => setLanguage(e.target.value as Language)}>
          {languages.map((l) => (
            <option key={l.key} value={l.key} disabled={!l.available}>
              {l.name}
              {l.available ? "" : " (unavailable)"}
            </option>
          ))}
        </select>
        {reference.code && (
          <button
            type="button"
            className="btn small"
            onClick={() => {
              setLanguage(reference.language);
              setCode(reference.code);
            }}
          >
            Use the saved reference solution
          </button>
        )}
      </div>
      <CodeEditor value={code} onChange={setCode} language={language} label="Solution to try" />
      <div className="editor-foot">
        <button type="button" className="btn primary" disabled={busy || !code.trim()} onClick={run}>
          {busy ? "Starting…" : "Run on every test"}
        </button>
        <span className="hint">Open a run to see the result of each test.</span>
      </div>
      {error && (
        <p className="msg error" role="alert" style={{ marginTop: "1rem" }}>
          {error}
        </p>
      )}
      <h3>Recent test runs</h3>
      <SubmissionsTable rows={rows} languageNames={names} linkBase="/admin/submissions" empty="No test runs yet." />
    </div>
  );
}
