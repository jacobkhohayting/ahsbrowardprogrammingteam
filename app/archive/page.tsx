import type { Metadata } from "next";
import Link from "next/link";
import { getViewer } from "@/lib/auth";
import { listContests } from "@/lib/contests";
import { q } from "@/lib/db";
import { contestPhase } from "@/lib/format";
import { ContestRow } from "@/components/ContestList";

export const metadata: Metadata = { title: "Archive" };

/** Every finished contest: its problems, final standings, submissions and (when published) solutions. */
export default async function ArchivePage() {
  const { isAdmin } = await getViewer();
  const finished = (await listContests(isAdmin)).filter((c) => contestPhase(c.start_at, c.end_at) === "ended");

  // Which contests have a written solution for at least one problem.
  const withSolutions = new Set(
    (
      await q<{ contest_id: number }>(
        `select distinct p.contest_id from problems p join contests c on c.id = p.contest_id
         where c.show_editorial and (p.editorial <> '' or p.solution_code <> '')`,
      )
    ).map((row) => row.contest_id),
  );

  return (
    <main>
      <div className="head">
        <div>
          <h1>Archive</h1>
          <p className="muted">
            Past contests stay open to read: the problems, the final standings and everyone&apos;s results. No account
            needed.
          </p>
        </div>
      </div>
      {finished.length === 0 ? (
        <p className="empty">No contest has finished yet.</p>
      ) : (
        <ul className="contest-list">
          {finished.map((contest) => (
            <ContestRow
              key={contest.id}
              contest={contest}
              side={
                <span className="small">
                  <Link href={`/contests/${contest.id}`}>
                    {withSolutions.has(contest.id) ? "Problems and solutions" : "Problems"}
                  </Link>
                  {", "}
                  <Link href={`/contests/${contest.id}/standings`}>Standings</Link>
                  {", "}
                  <Link href={`/contests/${contest.id}/status`}>Submissions</Link>
                </span>
              }
            />
          ))}
        </ul>
      )}
    </main>
  );
}
