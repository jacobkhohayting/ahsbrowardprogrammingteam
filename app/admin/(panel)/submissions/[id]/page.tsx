import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { requireAdmin } from "@/lib/auth";
import { SUBMISSION_DETAIL_SELECT, toView, type SubmissionRow } from "@/lib/contests";
import { q1 } from "@/lib/db";
import { formatMemory, VERDICT_NAMES, type Verdict as VerdictCode } from "@/lib/format";
import { languageName } from "@/lib/judge/languages";
import { deleteSubmission, rejudgeSubmission, setInvalidated } from "@/lib/actions/admin-people";
import { ActionForm } from "@/components/ActionForm";
import { AutoRefresh } from "@/components/AutoRefresh";
import { Balloon } from "@/components/Balloon";
import { CopyButton } from "@/components/Chrome";
import { When } from "@/components/LocalTime";
import { Verdict } from "@/components/Verdict";

export const metadata: Metadata = { title: "Submission" };

type Detail = SubmissionRow & {
  source: string;
  compile_output: string | null;
  message: string | null;
  attempts: number;
  judge_log: { t: number; v: VerdictCode; ms: number; kb: number }[] | null;
};

export default async function AdminSubmissionPage({ params }: { params: Promise<{ id: string }> }) {
  await requireAdmin();
  const id = Number((await params).id);
  if (!Number.isInteger(id)) notFound();
  const row = await q1<Detail>(`${SUBMISSION_DETAIL_SELECT} where s.id = $1`, [id]);
  if (!row) notFound();
  const view = toView(row, true);
  const language = await languageName(row.language);

  return (
    <main>
      {row.status !== "done" && <AutoRefresh seconds={2} />}
      <p className="crumb">
        <Link href={`/admin/submissions?contest=${row.contest_id}`}>Submissions in {row.contest_name}</Link>
      </p>
      <div className="head">
        <h1>
          Submission {row.id} {row.admin_test && <span className="pill hidden">Organizer test run</span>}
        </h1>
        <div className="actions">
          <ActionForm action={rejudgeSubmission} className="inline" messages="bottom">
            <input type="hidden" name="id" value={row.id} />
            <button className="btn">Rejudge</button>
          </ActionForm>
          {!row.admin_test && (
            <ActionForm action={setInvalidated} className="inline" messages="bottom">
              <input type="hidden" name="id" value={row.id} />
              <input type="hidden" name="invalidated" value={row.invalidated ? "0" : "1"} />
              <button className="btn">{row.invalidated ? "Count it again" : "Remove from standings"}</button>
            </ActionForm>
          )}
          <ActionForm action={deleteSubmission} className="inline" messages="errors" confirm="Delete this submission for good?">
            <input type="hidden" name="id" value={row.id} />
            <button className="btn danger">Delete</button>
          </ActionForm>
        </div>
      </div>

      <dl className="kv">
        <dt>Verdict</dt>
        <dd>
          <Verdict status={row.status} verdict={row.verdict} failedTest={row.failed_test} invalidated={row.invalidated} />
          {row.invalidated && <span className="muted"> (removed from the standings)</span>}
        </dd>
        {row.message && (
          <>
            <dt>Judge note</dt>
            <dd>{row.message}</dd>
          </>
        )}
        <dt>Problem</dt>
        <dd>
          <Balloon index={view.problemIndex} label={view.problemLabel} href={`/admin/problems/${row.problem_id}`} />{" "}
          <Link href={`/admin/problems/${row.problem_id}`}>{row.problem_title}</Link>
          <span className="muted"> in </span>
          <Link href={`/admin/contests/${row.contest_id}`}>{row.contest_name}</Link>
        </dd>
        <dt>By</dt>
        <dd>
          {row.user_id ? (
            <>
              <Link href={`/admin/users/${row.user_id}`}>{row.username}</Link>
              <span className="muted"> ({row.full_name})</span>
            </>
          ) : (
            "An organizer (test run)"
          )}
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
        {row.status === "done" && row.tests_total > 0 && row.verdict !== "CE" && (
          <>
            <dt>Tests passed</dt>
            <dd>
              {row.tests_passed} of {row.tests_total}
            </dd>
          </>
        )}
        {row.attempts > 1 && (
          <>
            <dt>Judge attempts</dt>
            <dd>{row.attempts}</dd>
          </>
        )}
      </dl>

      {row.compile_output && (
        <>
          <h2>Compiler output</h2>
          <pre>{row.compile_output}</pre>
        </>
      )}

      {row.judge_log && row.judge_log.length > 0 && (
        <>
          <h2>Results test by test</h2>
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
          <p className="help">
            Test numbers match the order on the problem&apos;s admin page (examples first).
            {!row.admin_test && " Student submissions stop at the first failing test."}
          </p>
        </>
      )}

      <h2>Code</h2>
      <p className="small">
        <CopyButton text={row.source} label="Copy the code" />
      </p>
      <pre className="source">{row.source}</pre>
    </main>
  );
}
