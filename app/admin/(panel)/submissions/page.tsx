import type { Metadata } from "next";
import Link from "next/link";
import { requireAdmin } from "@/lib/auth";
import { SUBMISSION_SELECT, toView, type SubmissionRow } from "@/lib/contests";
import { q, q1 } from "@/lib/db";
import { VERDICT_NAMES, type Language, type Verdict } from "@/lib/format";
import { languageOptions } from "@/lib/judge/languages";
import { LiveSubmissions } from "@/components/Submissions";

export const metadata: Metadata = { title: "Submissions" };
const PAGE_SIZE = 100;

type Search = { contest?: string; problem?: string; user?: string; verdict?: string; q?: string; tests?: string; page?: string };

export default async function AdminSubmissionsPage({ searchParams }: { searchParams: Promise<Search> }) {
  await requireAdmin();
  const search = await searchParams;
  const page = Math.max(0, Number(search.page) || 0);

  const where: string[] = [];
  const values: unknown[] = [];
  /** Adds a value to the query and returns its placeholder ($1, $2, ...). */
  const param = (value: unknown) => {
    values.push(value);
    return `$${values.length}`;
  };
  const asId = (value: string | undefined) => (value && /^\d+$/.test(value) ? Number(value) : null);
  const contestId = asId(search.contest);
  const problemId = asId(search.problem);
  const userId = asId(search.user);
  if (contestId) where.push(`s.contest_id = ${param(contestId)}`);
  if (problemId) where.push(`s.problem_id = ${param(problemId)}`);
  if (userId) where.push(`s.user_id = ${param(userId)}`);
  if (search.verdict === "pending") where.push("s.status <> 'done'");
  else if (search.verdict && search.verdict in VERDICT_NAMES) where.push(`s.verdict = ${param(search.verdict)}`);
  const text = (search.q ?? "").trim().slice(0, 100);
  if (text) {
    const pattern = param(`%${text.replace(/[\\%_]/g, "\\$&")}%`);
    where.push(`(u.username ilike ${pattern} or u.full_name ilike ${pattern})`);
  }
  if (search.tests !== "1") where.push("not s.admin_test");
  const filter = where.length ? `where ${where.join(" and ")}` : "";

  const [rows, total, contests, languages] = await Promise.all([
    q<SubmissionRow>(
      `${SUBMISSION_SELECT} ${filter} order by s.id desc limit ${PAGE_SIZE} offset ${page * PAGE_SIZE}`,
      values,
    ),
    q1<{ n: number }>(`select count(*) as n from submissions s left join users u on u.id = s.user_id ${filter}`, values),
    q<{ id: number; name: string }>("select id, name from contests order by start_at desc, id desc"),
    languageOptions(),
  ]);
  const names = Object.fromEntries(languages.map((l) => [l.key, l.name])) as Record<Language, string>;
  const pages = Math.ceil((total?.n ?? 0) / PAGE_SIZE);
  const pageLink = (target: number) => {
    const params = new URLSearchParams();
    for (const [key, value] of Object.entries(search)) if (value && key !== "page") params.set(key, value);
    if (target > 0) params.set("page", String(target));
    const query = params.toString();
    return query ? `/admin/submissions?${query}` : "/admin/submissions";
  };

  return (
    <main>
      <div className="head">
        <div>
          <h1>Submissions</h1>
          <p className="muted">
            {total?.n ?? 0} found. Open one to read the code, rejudge it or remove it from the standings.
          </p>
        </div>
      </div>
      <form className="filters" method="get">
        <div>
          <label htmlFor="contest">Contest</label>
          <select id="contest" name="contest" defaultValue={search.contest ?? ""}>
            <option value="">All contests</option>
            {contests.map((contest) => (
              <option key={contest.id} value={contest.id}>
                {contest.name}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label htmlFor="verdict">Verdict</label>
          <select id="verdict" name="verdict" defaultValue={search.verdict ?? ""}>
            <option value="">Any verdict</option>
            <option value="pending">Still being judged</option>
            {(Object.keys(VERDICT_NAMES) as Verdict[]).map((key) => (
              <option key={key} value={key}>
                {VERDICT_NAMES[key]}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label htmlFor="q">Username or name</label>
          <input id="q" name="q" type="search" defaultValue={text} />
        </div>
        <label className="check" style={{ flex: "none", marginBottom: "0.55rem" }}>
          <input type="checkbox" name="tests" value="1" defaultChecked={search.tests === "1"} /> Include organizer test runs
        </label>
        {search.problem && <input type="hidden" name="problem" value={search.problem} />}
        {search.user && <input type="hidden" name="user" value={search.user} />}
        <button className="btn">Filter</button>
        {(search.problem || search.user) && (
          <Link className="btn" href="/admin/submissions">
            Clear filters
          </Link>
        )}
      </form>

      <LiveSubmissions
        initial={rows.map((row) => toView(row, true))}
        languageNames={names}
        show={{ who: true, contest: true, problem: true }}
        linkBase="/admin/submissions"
        empty="No submissions match."
      />
      {pages > 1 && (
        <div className="pager">
          {page > 0 && <Link href={pageLink(page - 1)}>Newer</Link>}
          <span className="muted">
            Page {page + 1} of {pages}
          </span>
          {page < pages - 1 && <Link href={pageLink(page + 1)}>Older</Link>}
        </div>
      )}
    </main>
  );
}
