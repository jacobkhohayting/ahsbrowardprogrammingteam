"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import type { SubmissionView } from "@/lib/contests";
import { formatMemory, type Language } from "@/lib/format";
import { Balloon } from "./Balloon";
import { When } from "./LocalTime";
import { Verdict } from "./Verdict";

type StatusUpdate = Pick<SubmissionView, "id" | "status" | "verdict" | "failedTest" | "timeMs" | "memoryKb" | "invalidated">;

/**
 * Keeps a list of submissions up to date: while any of them is still being judged,
 * asks the server for news every second or two.
 */
export function useLiveSubmissions(initial: SubmissionView[]) {
  const router = useRouter();
  const [rows, setRows] = useState(initial);
  const rowsRef = useRef(rows);
  rowsRef.current = rows;

  // New data from the server (after a refresh) replaces what we have.
  useEffect(() => setRows(initial), [initial]);

  const pending = rows
    .filter((row) => row.status !== "done")
    .map((row) => row.id)
    .sort((a, b) => a - b)
    .join(",");

  useEffect(() => {
    if (!pending) return;
    let stopped = false;
    let timer: ReturnType<typeof setTimeout>;
    let delay = 1200;
    const startedAt = Date.now();

    const poll = async () => {
      if (stopped) return;
      try {
        const response = await fetch(`/api/submissions/status?ids=${pending}`, { cache: "no-store" });
        if (response.ok) {
          const data = (await response.json()) as { submissions: StatusUpdate[] };
          const updates = new Map(data.submissions.map((s) => [s.id, s]));
          let finished = false;
          const next = rowsRef.current.map((row) => {
            const update = updates.get(row.id);
            if (!update) return row;
            if (row.status !== "done" && update.status === "done") finished = true;
            return { ...row, ...update };
          });
          if (!stopped) setRows(next);
          // A verdict arrived: let the rest of the page (solved marks, standings) catch up.
          if (finished && !stopped) router.refresh();
        }
      } catch {
        // Network hiccup: try again on the next round.
      }
      // Slow down for long waits, and give up polling after 15 minutes (a reload resumes it).
      if (Date.now() - startedAt > 15 * 60_000) return;
      delay = Math.min(delay * 1.25, 5000);
      timer = setTimeout(poll, delay);
    };
    timer = setTimeout(poll, 900);
    return () => {
      stopped = true;
      clearTimeout(timer);
    };
  }, [pending, router]);

  return [rows, setRows] as const;
}

type TableProps = {
  rows: SubmissionView[];
  languageNames: Record<Language, string>;
  /** Extra columns. */
  show?: { who?: boolean; problem?: boolean; contest?: boolean };
  /** Where a submission number links to. */
  linkBase?: "/submissions" | "/admin/submissions";
  /** Highlight this user's rows. */
  me?: string | null;
  empty: string;
};

export function SubmissionsTable({ rows, languageNames, show = {}, linkBase = "/submissions", me, empty }: TableProps) {
  if (rows.length === 0) return <p className="empty">{empty}</p>;
  return (
    <div className="table-wrap">
      <table>
        <thead>
          <tr>
            <th>#</th>
            <th>When</th>
            {show.who && <th>Who</th>}
            {show.contest && <th>Contest</th>}
            {show.problem && <th>Problem</th>}
            <th>Language</th>
            <th>Verdict</th>
            <th className="num">Time</th>
            <th className="num">Memory</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.id} className={me && row.who === me && !row.adminTest ? "is-me" : undefined}>
              <td className="num" style={{ textAlign: "left" }}>
                <Link href={`${linkBase}/${row.id}`}>{row.id}</Link>
              </td>
              <td className="nowrap muted">
                <When iso={row.submittedAt} />
              </td>
              {show.who && (
                <td>
                  {row.who}
                  {row.fullName && <span className="sub">{row.fullName}</span>}
                </td>
              )}
              {show.contest && (
                <td>
                  <Link href={`/contests/${row.contestId}`}>{row.contestName}</Link>
                </td>
              )}
              {show.problem && (
                <td className="nowrap">
                  <Balloon
                    index={row.problemIndex}
                    label={row.problemLabel}
                    href={`/contests/${row.contestId}/problems/${row.problemLabel}`}
                    title={row.problemTitle || `Problem ${row.problemLabel}`}
                  />
                </td>
              )}
              <td className="nowrap">{languageNames[row.language] ?? row.language}</td>
              <td>
                <Verdict status={row.status} verdict={row.verdict} failedTest={row.failedTest} invalidated={row.invalidated} />
              </td>
              <td className="num nowrap">{row.timeMs == null ? "" : `${row.timeMs} ms`}</td>
              <td className="num nowrap">{formatMemory(row.memoryKb)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** A table of submissions that updates itself while verdicts are pending. */
export function LiveSubmissions({ initial, ...table }: Omit<TableProps, "rows"> & { initial: SubmissionView[] }) {
  const [rows] = useLiveSubmissions(initial);
  return <SubmissionsTable rows={rows} {...table} />;
}
