import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { requireAdmin } from "@/lib/auth";
import { q1 } from "@/lib/db";
import { deleteTest, saveTest } from "@/lib/actions/admin-problems";
import { ActionForm } from "@/components/ActionForm";

export const metadata: Metadata = { title: "Edit test" };

const EDITABLE_BYTES = 300_000;

type TestRow = {
  id: number;
  problem_id: number;
  problem_title: string;
  is_example: boolean;
  input: string;
  expected_output: string;
  bytes: number;
};

export default async function AdminTestPage({ params }: { params: Promise<{ id: string }> }) {
  await requireAdmin();
  const id = Number((await params).id);
  if (!Number.isInteger(id)) notFound();

  // Huge tests are not sent to the browser in full; they are replaced by uploading new files.
  const test = await q1<TestRow>(
    `select t.id, t.problem_id, p.title as problem_title, t.is_example,
            octet_length(t.input) + octet_length(t.expected_output) as bytes,
            case when octet_length(t.input) + octet_length(t.expected_output) <= ${EDITABLE_BYTES}
                 then t.input else left(t.input, 2000) end as input,
            case when octet_length(t.input) + octet_length(t.expected_output) <= ${EDITABLE_BYTES}
                 then t.expected_output else left(t.expected_output, 2000) end as expected_output
     from tests t join problems p on p.id = t.problem_id where t.id = $1`,
    [id],
  );
  if (!test) notFound();
  const editable = test.bytes <= EDITABLE_BYTES;
  const back = `/admin/problems/${test.problem_id}#tests`;

  return (
    <main>
      <p className="crumb">
        <Link href={back}>{test.problem_title}</Link>
      </p>
      <div className="head">
        <h1>Edit test</h1>
      </div>
      {editable ? (
        <ActionForm action={saveTest} className="medium">
          <input type="hidden" name="id" value={test.id} />
          <label htmlFor="input">Input</label>
          <textarea id="input" name="input" className="code" rows={10} spellCheck={false} defaultValue={test.input} />
          <label htmlFor="expected_output">Expected output</label>
          <textarea id="expected_output" name="expected_output" className="code" rows={10} spellCheck={false} defaultValue={test.expected_output} />
          <label className="check">
            <input type="checkbox" name="is_example" defaultChecked={test.is_example} /> Show to students as an example
          </label>
          <div className="form-actions">
            <button className="btn primary">Save test</button>
            <Link className="btn" href={back}>
              Back to the problem
            </Link>
          </div>
        </ActionForm>
      ) : (
        <>
          <p className="msg note">
            This test is {(test.bytes / 1024 / 1024).toFixed(1)} MB, too large to edit in the browser. To change it,
            delete it and upload new files on the problem page. Its beginning is shown below.
          </p>
          <div className="test-io">
            <div>
              <h3>Input (start)</h3>
              <pre>{test.input}</pre>
            </div>
            <div>
              <h3>Expected output (start)</h3>
              <pre>{test.expected_output}</pre>
            </div>
          </div>
        </>
      )}
      <ActionForm action={deleteTest} messages="bottom" confirm="Delete this test?">
        <input type="hidden" name="id" value={test.id} />
        <input type="hidden" name="then" value="back" />
        <p style={{ marginTop: "2rem" }}>
          <button className="btn small danger">Delete this test</button>
        </p>
      </ActionForm>
    </main>
  );
}
