import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { requireAdmin } from "@/lib/auth";
import { getProblems, SUBMISSION_SELECT, toView, type SubmissionRow } from "@/lib/contests";
import { q, q1 } from "@/lib/db";
import { CHECKERS, type Checker, type Language } from "@/lib/format";
import { languageOptions } from "@/lib/judge/languages";
import {
  addTest,
  deleteAllTests,
  deleteProblem,
  deleteTest,
  moveTest,
  rejudgeProblem,
  saveProblem,
  toggleExample,
} from "@/lib/actions/admin-problems";
import { ActionForm } from "@/components/ActionForm";
import { Balloon } from "@/components/Balloon";
import { StatementEditor } from "@/components/admin/StatementEditor";
import { TestUploader } from "@/components/admin/TestUploader";
import { TryRun } from "@/components/admin/TryRun";

export const metadata: Metadata = { title: "Problem" };

type ProblemRow = {
  id: number;
  contest_id: number;
  contest_name: string;
  leaderboard_type: string;
  title: string;
  statement: string;
  editorial: string;
  solution_code: string;
  solution_language: Language;
  time_limit_ms: number;
  memory_limit_mb: number;
  checker: Checker;
  points: number;
  submissions: number;
};

type TestRow = {
  id: number;
  is_example: boolean;
  input_start: string;
  output_start: string;
  input_bytes: number;
  output_bytes: number;
};

const PREVIEW = 400;

function size(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

export default async function AdminProblemPage({ params }: { params: Promise<{ id: string }> }) {
  await requireAdmin();
  const id = Number((await params).id);
  if (!Number.isInteger(id)) notFound();

  const problem = await q1<ProblemRow>(
    `select p.*, c.name as contest_name, c.leaderboard_type,
            (select count(*) from submissions s where s.problem_id = p.id and not s.admin_test) as submissions
     from problems p join contests c on c.id = p.contest_id where p.id = $1`,
    [id],
  );
  if (!problem) notFound();

  const [siblings, tests, languages, runs] = await Promise.all([
    getProblems(problem.contest_id),
    // Only the beginning of each test is loaded; tests can be megabytes long.
    q<TestRow>(
      `select id, is_example, left(input, ${PREVIEW + 1}) as input_start, left(expected_output, ${PREVIEW + 1}) as output_start,
              octet_length(input) as input_bytes, octet_length(expected_output) as output_bytes
       from tests where problem_id = $1 order by is_example desc, ord, id`,
      [id],
    ),
    languageOptions(),
    q<SubmissionRow>(`${SUBMISSION_SELECT} where s.problem_id = $1 and s.admin_test order by s.id desc limit 8`, [id]),
  ]);
  const index = siblings.findIndex((p) => p.id === id);
  const label = siblings[index]?.label ?? "?";
  const examples = tests.filter((t) => t.is_example).length;
  const totalBytes = tests.reduce((sum, t) => sum + t.input_bytes + t.output_bytes, 0);
  const worstCaseSeconds = (tests.length * problem.time_limit_ms) / 1000;
  const clip = (text: string) => (text.length > PREVIEW ? text.slice(0, PREVIEW) + "\n…" : text);

  return (
    <main>
      <p className="crumb">
        <Link href={`/admin/contests/${problem.contest_id}`}>{problem.contest_name}</Link>
      </p>
      <div className="head">
        <div className="problem-title">
          <Balloon index={Math.max(index, 0)} label={label} large />
          <h1>{problem.title}</h1>
        </div>
        <div className="actions">
          <Link className="btn" href={`/contests/${problem.contest_id}/problems/${label}`}>
            Student view
          </Link>
          <Link className="btn" href={`/admin/submissions?contest=${problem.contest_id}&problem=${problem.id}`}>
            Submissions ({problem.submissions})
          </Link>
          <ActionForm
            action={rejudgeProblem}
            className="inline"
            messages="bottom"
            confirm={`Judge all ${problem.submissions} submissions to this problem again?`}
          >
            <input type="hidden" name="id" value={problem.id} />
            <button className="btn">Rejudge</button>
          </ActionForm>
          <ActionForm
            action={deleteProblem}
            className="inline"
            messages="errors"
            confirm={`Remove "${problem.title}" with its tests and ${problem.submissions} submissions?`}
          >
            <input type="hidden" name="id" value={problem.id} />
            <button className="btn danger">Remove problem</button>
          </ActionForm>
        </div>
      </div>

      <ActionForm action={saveProblem}>
        <input type="hidden" name="id" value={problem.id} />
        <div className="form-row">
          <div style={{ gridColumn: "span 2" }}>
            <label htmlFor="title">Title</label>
            <input id="title" name="title" type="text" required maxLength={200} defaultValue={problem.title} />
          </div>
          <div>
            <label htmlFor="time_limit_ms">Time limit (milliseconds)</label>
            <input id="time_limit_ms" name="time_limit_ms" type="number" min={100} max={15000} step={100} required defaultValue={problem.time_limit_ms} />
          </div>
          <div>
            <label htmlFor="memory_limit_mb">Memory limit (MB)</label>
            <input id="memory_limit_mb" name="memory_limit_mb" type="number" min={16} max={1024} required defaultValue={problem.memory_limit_mb} />
          </div>
          <div>
            <label htmlFor="points">
              Maximum points <span className="muted">(adaptive only)</span>
            </label>
            <input id="points" name="points" type="number" min={0} step="any" defaultValue={problem.points} />
          </div>
        </div>
        <label htmlFor="checker">How output is compared</label>
        <select id="checker" name="checker" defaultValue={problem.checker} className="medium">
          {(Object.keys(CHECKERS) as Checker[]).map((key) => (
            <option key={key} value={key}>
              {CHECKERS[key]}
            </option>
          ))}
        </select>

        <StatementEditor
          name="statement"
          label="Statement"
          hint="(Markdown; $n$ for math)"
          defaultValue={problem.statement}
        />

        <details style={{ marginTop: "1rem" }} open={!!(problem.editorial || problem.solution_code)}>
          <summary>Editorial and reference solution</summary>
          <p className="help">
            Shown to everyone after the contest ends, if that option is on for the contest. Never visible before.
          </p>
          <StatementEditor name="editorial" label="Editorial" hint="(Markdown)" defaultValue={problem.editorial} rows={8} />
          <label htmlFor="solution_language">Reference solution language</label>
          <select id="solution_language" name="solution_language" defaultValue={problem.solution_language} className="narrow">
            {languages.map((l) => (
              <option key={l.key} value={l.key}>
                {l.name}
              </option>
            ))}
          </select>
          <label htmlFor="solution_code">Reference solution</label>
          <textarea id="solution_code" name="solution_code" className="code" rows={12} spellCheck={false} defaultValue={problem.solution_code} />
        </details>

        <div className="form-actions">
          <button className="btn primary">Save problem</button>
        </div>
      </ActionForm>

      <h2 id="tests">Tests</h2>
      <p className="muted" style={{ maxWidth: "72ch" }}>
        {tests.length} test{tests.length === 1 ? "" : "s"}, {examples} shown to students as example
        {examples === 1 ? "" : "s"}, {size(totalBytes)} in total. Every test is used for judging, examples first. A
        solution is accepted only if it passes all of them.
      </p>
      {tests.length === 0 && <p className="msg warn">Students cannot submit to this problem until it has at least one test.</p>}
      {tests.length > 0 && examples === 0 && (
        <p className="msg warn">No test is marked as an example, so the statement shows no sample input and output.</p>
      )}
      {worstCaseSeconds > 180 && (
        <p className="msg warn">
          {tests.length} tests at {problem.time_limit_ms / 1000} s each can take up to {Math.round(worstCaseSeconds)}{" "}
          seconds for a slow solution. The judge has about 200 seconds per submission, so slow correct solutions may get
          a judge error. Use fewer tests or a shorter time limit.
        </p>
      )}

      {tests.length > 0 && (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th className="num">#</th>
                <th>Input</th>
                <th>Expected output</th>
                <th>Shown as example</th>
                <th>
                  <span className="sr-only">Actions</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {tests.map((test, i) => (
                <tr key={test.id}>
                  <td className="num">{i + 1}</td>
                  <td style={{ maxWidth: "20rem" }}>
                    <pre style={{ margin: 0, maxHeight: "6rem" }}>{clip(test.input_start)}</pre>
                    <span className="sub">{size(test.input_bytes)}</span>
                  </td>
                  <td style={{ maxWidth: "20rem" }}>
                    <pre style={{ margin: 0, maxHeight: "6rem" }}>{clip(test.output_start)}</pre>
                    <span className="sub">{size(test.output_bytes)}</span>
                  </td>
                  <td>
                    <ActionForm action={toggleExample} className="inline" messages="errors">
                      <input type="hidden" name="id" value={test.id} />
                      <button className="btn small" aria-pressed={test.is_example}>
                        {test.is_example ? "Yes, example" : "No, hidden"}
                      </button>
                    </ActionForm>
                  </td>
                  <td>
                    <div className="actions" style={{ flexWrap: "nowrap" }}>
                      <ActionForm action={moveTest} className="inline" messages="none">
                        <input type="hidden" name="id" value={test.id} />
                        <input type="hidden" name="direction" value="up" />
                        <button className="btn small" disabled={i === 0} aria-label={`Move test ${i + 1} up`}>
                          Up
                        </button>
                      </ActionForm>
                      <ActionForm action={moveTest} className="inline" messages="none">
                        <input type="hidden" name="id" value={test.id} />
                        <input type="hidden" name="direction" value="down" />
                        <button className="btn small" disabled={i === tests.length - 1} aria-label={`Move test ${i + 1} down`}>
                          Down
                        </button>
                      </ActionForm>
                      <Link className="btn small" href={`/admin/tests/${test.id}`}>
                        Edit
                      </Link>
                      <ActionForm action={deleteTest} className="inline" messages="errors" confirm={`Delete test ${i + 1}?`}>
                        <input type="hidden" name="id" value={test.id} />
                        <button className="btn small danger">Delete</button>
                      </ActionForm>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <div className="columns">
        <div>
          <h3>Add one test</h3>
          <ActionForm action={addTest} resetOnSuccess>
            <input type="hidden" name="problem_id" value={problem.id} />
            <label htmlFor="input">Input</label>
            <textarea id="input" name="input" className="code" rows={5} spellCheck={false} />
            <label htmlFor="expected_output">Expected output</label>
            <textarea id="expected_output" name="expected_output" className="code" rows={5} spellCheck={false} />
            <label className="check">
              <input type="checkbox" name="is_example" /> Show to students as an example
            </label>
            <div className="form-actions">
              <button className="btn primary">Add test</button>
            </div>
          </ActionForm>
        </div>
        <div>
          <h3>Add many tests from files</h3>
          <TestUploader problemId={problem.id} />
          {tests.length > 0 && (
            <ActionForm
              action={deleteAllTests}
              messages="bottom"
              confirm={`Delete all ${tests.length} tests of this problem?`}
            >
              <input type="hidden" name="problem_id" value={problem.id} />
              <p style={{ marginTop: "1.5rem" }}>
                <button className="btn small danger">Delete all tests</button>
              </p>
            </ActionForm>
          )}
        </div>
      </div>

      <h2 id="try">Try a solution</h2>
      <p className="muted" style={{ maxWidth: "72ch" }}>
        Check the tests and limits before the contest: run a correct solution (it should be accepted) and, if you have
        one, a slow or wrong solution (it should fail). These runs are never shown to students.
      </p>
      {tests.length === 0 ? (
        <p className="msg note">Add at least one test first.</p>
      ) : (
        <TryRun
          problemId={problem.id}
          languages={languages.map(({ key, name, available }) => ({ key, name, available }))}
          reference={{ language: problem.solution_language, code: problem.solution_code }}
          recent={runs.map((row) => toView(row, false))}
        />
      )}
    </main>
  );
}
