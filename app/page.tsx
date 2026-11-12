import Link from "next/link";
import { getViewer } from "@/lib/auth";
import { listContests } from "@/lib/contests";
import { contestPhase } from "@/lib/format";
import { ContestRow } from "@/components/ContestList";

const RECENT = 5;

export default async function HomePage() {
  const { user, isAdmin } = await getViewer();
  const contests = await listContests(isAdmin);
  const phaseOf = (c: (typeof contests)[number]) => contestPhase(c.start_at, c.end_at);
  const running = contests.filter((c) => phaseOf(c) === "running");
  // Soonest first for upcoming contests; the list arrives newest first.
  const upcoming = contests.filter((c) => phaseOf(c) === "upcoming").reverse();
  const finished = contests.filter((c) => phaseOf(c) === "ended");

  return (
    <main>
      {contests.length === 0 && (
        <>
          <h1>Contests</h1>
          <p className="empty">
            No contests have been announced yet. Check back soon.
            {isAdmin && (
              <>
                {" "}
                <Link href="/admin/contests/new">Create the first contest</Link>
              </>
            )}
          </p>
        </>
      )}

      {running.length > 0 && (
        <>
          <h1>Running now</h1>
          <ul className="contest-list" style={{ marginTop: "1rem" }}>
            {running.map((contest) => (
              <ContestRow key={contest.id} contest={contest} />
            ))}
          </ul>
          {!user && (
            <p className="muted">
              <Link href="/login">Log in</Link> or <Link href="/register">create an account</Link> to take part.
            </p>
          )}
        </>
      )}

      {upcoming.length > 0 && (
        <>
          {running.length === 0 ? <h1>Coming up</h1> : <h2>Coming up</h2>}
          <ul className="contest-list" style={{ marginTop: "1rem" }}>
            {upcoming.map((contest) => (
              <ContestRow key={contest.id} contest={contest} />
            ))}
          </ul>
        </>
      )}

      {finished.length > 0 && (
        <>
          {running.length + upcoming.length === 0 ? <h1>Finished contests</h1> : <h2>Finished</h2>}
          <ul className="contest-list" style={{ marginTop: "1rem" }}>
            {finished.slice(0, RECENT).map((contest) => (
              <ContestRow
                key={contest.id}
                contest={contest}
                side={
                  <span className="small">
                    <Link href={`/contests/${contest.id}`}>Problems</Link>
                    {", "}
                    <Link href={`/contests/${contest.id}/standings`}>Standings</Link>
                  </span>
                }
              />
            ))}
          </ul>
          {finished.length > RECENT && (
            <p>
              <Link href="/archive">All {finished.length} finished contests</Link>
            </p>
          )}
        </>
      )}
    </main>
  );
}
