import type { Metadata } from "next";
import { requireUser } from "@/lib/auth";
import { SUBMISSION_SELECT, toView, type SubmissionRow } from "@/lib/contests";
import { q } from "@/lib/db";
import type { Language } from "@/lib/format";
import { languageOptions } from "@/lib/judge/languages";
import { LiveSubmissions } from "@/components/Submissions";

export const metadata: Metadata = { title: "My submissions" };

export default async function MySubmissionsPage() {
  const user = await requireUser("/submissions");
  const [rows, languages] = await Promise.all([
    q<SubmissionRow>(
      `${SUBMISSION_SELECT} where s.user_id = $1 and not s.admin_test order by s.id desc limit 300`,
      [user.id],
    ),
    languageOptions(),
  ]);
  const names = Object.fromEntries(languages.map((l) => [l.key, l.name])) as Record<Language, string>;

  return (
    <main>
      <div className="head">
        <div>
          <h1>My submissions</h1>
          <p className="muted">Everything you have submitted, newest first. Open one to see your code.</p>
        </div>
      </div>
      <LiveSubmissions
        initial={rows.map((row) => toView(row, false))}
        languageNames={names}
        show={{ contest: true, problem: true }}
        empty="You have not submitted anything yet. Enter a running contest to start."
      />
    </main>
  );
}
