import type { Metadata } from "next";
import Link from "next/link";
import { contestContext, getProblems, namesVisible, SUBMISSION_SELECT, toView, type SubmissionRow } from "@/lib/contests";
import { q, q1 } from "@/lib/db";
import { languageOptions } from "@/lib/judge/languages";
import type { Language } from "@/lib/format";
import { LiveSubmissions } from "@/components/Submissions";

export const metadata: Metadata = { title: "Submissions" };
const PAGE_SIZE = 50;

type Props = {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ mine?: string; problem?: string; page?: string }>;
};

/** Everyone's submissions in this contest: who, which problem, and the verdict (never the code). */
export default async function StatusPage({ params, searchParams }: Props) {
  const { contest, viewer, phase, access } = await contestContext((await params).id);
  const query = await searchParams;
  const base = `/contests/${contest.id}/status`;
  if (phase === "upcoming" && !viewer.isAdmin) {
    return (
      <main>
        <p className="msg note">Submissions appear here once the contest starts.</p>
      </main>
    );
  }

  const problems = await getProblems(contest.id);
  const mineOnly = query.mine === "1" && viewer.user !== null;
  const problem = problems.find((p) => p.label === (query.problem ?? "").toUpperCase());
  const page = Math.max(0, Number(query.page) || 0);

  const where = ["s.contest_id = $1", "not s.admin_test"];
  const values: unknown[] = [contest.id];
  if (mineOnly) {
    values.push(viewer.user!.id);
    where.push(`s.user_id = $${values.length}`);
  }
  if (problem) {
    values.push(problem.id);
    where.push(`s.problem_id = $${values.length}`);
  }

  const [rows, total, languages, showNames] = await Promise.all([
    q<SubmissionRow>(
      `${SUBMISSION_SELECT} where ${where.join(" and ")} order by s.id desc limit ${PAGE_SIZE} offset ${page * PAGE_SIZE}`,
      values,
    ),
    q1<{ n: number }>(`select count(*) as n from submissions s where ${where.join(" and ")}`, values),
    languageOptions(),
    namesVisible(),
  ]);
  const names = Object.fromEntries(languages.map((l) => [l.key, l.name])) as Record<Language, string>;
  const canSeeTitles = access === "ok";
  const views = rows.map((row) => {
    const view = toView(row, showNames);
    return canSeeTitles ? view : { ...view, problemTitle: "" };
  });

  const link = (changes: Record<string, string | null>) => {
    const next = new URLSearchParams();
    const merged: Record<string, string | null> = {
      mine: mineOnly ? "1" : null,
      problem: problem?.label ?? null,
      ...changes,
    };
    for (const [key, value] of Object.entries(merged)) if (value) next.set(key, value);
    const text = next.toString();
    return text ? `${base}?${text}` : base;
  };
  const pages = Math.ceil((total?.n ?? 0) / PAGE_SIZE);

  return (
    <main>
      <div className="pager">
        <span>Show:</span>
        <Link href={link({ mine: null, page: null })} aria-current={!mineOnly ? "page" : undefined}>
          {!mineOnly ? <strong>Everyone</strong> : "Everyone"}
        </Link>
        {viewer.user && (
          <Link href={link({ mine: "1", page: null })} aria-current={mineOnly ? "page" : undefined}>
            {mineOnly ? <strong>Only mine</strong> : "Only mine"}
          </Link>
        )}
        {problem && (
          <span>
            Problem {problem.label} only (<Link href={link({ problem: null, page: null })}>show all problems</Link>)
          </span>
        )}
      </div>
      <LiveSubmissions
        initial={views}
        languageNames={names}
        show={{ who: !mineOnly, problem: true }}
        me={viewer.user?.username ?? null}
        empty={mineOnly ? "You have not submitted anything in this contest." : "No submissions yet."}
      />
      {pages > 1 && (
        <div className="pager">
          {page > 0 && <Link href={link({ page: String(page - 1) })}>Newer</Link>}
          <span className="muted">
            Page {page + 1} of {pages}
          </span>
          {page < pages - 1 && <Link href={link({ page: String(page + 1) })}>Older</Link>}
        </div>
      )}
    </main>
  );
}
