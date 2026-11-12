import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { getViewer } from "@/lib/auth";
import {
  canViewSource,
  getContest,
  namesVisible,
  SUBMISSION_DETAIL_SELECT,
  toView,
  type SubmissionRow,
} from "@/lib/contests";
import { q1 } from "@/lib/db";
import { contestPhase, formatMemory, VERDICT_NAMES, type Verdict as VerdictCode } from "@/lib/format";
import { languageName } from "@/lib/judge/languages";
import { AutoRefresh } from "@/components/AutoRefresh";
import { Balloon } from "@/components/Balloon";
import { CopyButton } from "@/components/Chrome";
import { When } from "@/components/LocalTime";
import { Verdict } from "@/components/Verdict";

export const metadata: Metadata = { title: "Submission" };

type Detail = SubmissionRow & {
  source: string;
  compile_output: string | null;
  judge_log: { t: number; v: VerdictCode; ms: number; kb: number }[] | null;
};

export default async function SubmissionPage({ params }: { params: Promise<{ id: string }> }) {
  const id = Number((await params).id);
  if (!Number.isInteger(id) || id <= 0) notFound();
  const viewer = await getViewer();
  const row = await q1<Detail>(
    `${SUBMISSION_DETAIL_SELECT} where s.id = $1`,
    [id],
  );
  if (!row || (row.admin_test && !viewer.isAdmin)) notFound();
  const contest = await getContest(row.contest_id);
  if (!contest || (!contest.visible && !viewer.isAdmin)) notFound();

  const [showNames, language] = await Promise.all([namesVisible(), languageName(row.language)]);
  const view = toView(row, showNames);
  const phase = contestPhase(contest.start_at, contest.end_at);
  const mine = viewer.user !== null && row.user_id === viewer.user.id;
  const sourceVisible = canViewSource(viewer, row, contest);
  // Problem titles are only for people who can open the problems.
  const canOpenProblem = viewer.isAdmin || phase === "ended" || mine;

  return (
    <main>
      {row.status !== "done" && <AutoRefresh seconds={2} />}
      <p className="crumb">
        <Link href={`/contests/${contest.id}/status`}>{contest.name}</Link>
      </p>
      <div className="head">
        <h1>Submission {row.id}</h1>
        {viewer.isAdmin && (
          <Link className="btn small" href={`/admin/submissions/${row.id}`}>
            Open in admin
          </Link>
        )}
      </div>

      <dl className="kv">
        <dt>Verdict</dt>
        <dd>
          <Verdict status={row.status} verdict={row.verdict} failedTest={row.failed_test} invalidated={row.invalidated} />
          {row.invalidated && <span className="muted"> (removed from the standings by an organizer)</span>}
        </dd>
        <dt>Problem</dt>
        <dd>
          <Balloon
            index={view.problemIndex}
            label={view.problemLabel}
            href={canOpenProblem ? `/contests/${contest.id}/problems/${view.problemLabel}` : undefined}
          />{" "}
          {canOpenProblem ? view.problemTitle : `Problem ${view.problemLabel}`}
        </dd>
        <dt>By</dt>
        <dd>
          {view.who}
          {view.fullName && <span className="muted"> ({view.fullName})</span>}
        </dd>
        <dt>Language</dt>
        <dd>{language}</dd>
        <dt>Submitted</dt>
        <dd>
          <When iso={view.submittedAt} />
        </dd>
        {row.status === "done" && row.time_ms !== null && (
          <>
            <dt>Slowest test</dt>
            <dd>
              {row.time_ms} ms, {formatMemory(row.memory_kb)}
            </dd>
          </>
        )}
        {row.status === "done" && (mine || viewer.isAdmin) && row.tests_total > 0 && row.verdict !== "CE" && (
          <>
            <dt>Tests passed</dt>
            <dd>
              {row.tests_passed} of {row.tests_total}
            </dd>
          </>
        )}
      </dl>

      {sourceVisible && row.verdict === "CE" && row.compile_output && (
        <>
          <h2>Compiler output</h2>
          <pre>{row.compile_output}</pre>
        </>
      )}

      {sourceVisible && row.judge_log && row.judge_log.length > 0 && (
        <details>
          <summary>Results test by test</summary>
          <div className="table-wrap">
            <table style={{ width: "auto" }}>
              <thead>
                <tr>
                  <th>Test</th>
                  <th>Result</th>
                  <th className="num">Time</th>
                  <th className="num">Memory</th>
                </tr>
              </thead>
              <tbody>
                {row.judge_log.map((test) => (
                  <tr key={test.t}>
                    <td className="num">{test.t}</td>
                    <td>
                      <span className={`verdict v-${test.v}`}>{VERDICT_NAMES[test.v] ?? test.v}</span>
                    </td>
                    <td className="num">{test.ms} ms</td>
                    <td className="num">{formatMemory(test.kb)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="help">Test inputs and expected outputs stay hidden. Only the result of each test is shown.</p>
        </details>
      )}

      <h2>Code</h2>
      {sourceVisible ? (
        <>
          <p className="small">
            <CopyButton text={row.source} label="Copy the code" />
          </p>
          <pre className="source">{row.source}</pre>
        </>
      ) : (
        <p className="msg note">
          {phase === "ended"
            ? "The organizers have not opened up the code for this contest."
            : "Nobody can see another contestant's code while the contest is running."}
        </p>
      )}
    </main>
  );
}
