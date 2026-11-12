import type { ReactNode } from "react";
import type { Metadata } from "next";
import { contestContext, getProblems } from "@/lib/contests";
import { q } from "@/lib/db";
import { formatDuration, formatInZone } from "@/lib/format";
import { kickIfPending } from "@/lib/judge/queue";
import { Balloon } from "@/components/Balloon";
import { NavLinks } from "@/components/Chrome";
import { ContestClock } from "@/components/ContestClock";
import { LocalTime } from "@/components/LocalTime";

type Props = { children: ReactNode; params: Promise<{ id: string }> };

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }): Promise<Metadata> {
  const { contest } = await contestContext((await params).id);
  return { title: contest.name };
}

/** The strip at the top of every contest page: name, times, countdown, problem balloons and tabs. */
export default async function ContestLayout({ children, params }: Props) {
  const { contest, viewer, phase, access } = await contestContext((await params).id);
  const base = `/contests/${contest.id}`;
  const problems = access === "ok" ? await getProblems(contest.id) : [];

  // Which problems this student has solved or tried, to fill in their balloons.
  const progress = new Map<number, { solved: boolean; tried: boolean }>();
  if (viewer.user && problems.length) {
    const rows = await q<{ problem_id: number; solved: boolean; tried: boolean }>(
      `select problem_id,
              bool_or(verdict = 'AC') as solved,
              bool_or(status = 'done' and verdict not in ('AC', 'CE', 'JE')) as tried
       from submissions
       where contest_id = $1 and user_id = $2 and not invalidated and not admin_test
       group by problem_id`,
      [contest.id, viewer.user.id],
    );
    for (const row of rows) progress.set(row.problem_id, row);
  }

  // If a submission is waiting and nobody is polling for it, any visit gets the judge going again.
  await kickIfPending().catch(() => {});

  const minutes = (contest.end_at.getTime() - contest.start_at.getTime()) / 60000;
  const tabs = [
    { href: base, label: "Problems", exact: true, also: [`${base}/problems`] },
    ...(phase === "upcoming" && !viewer.isAdmin
      ? []
      : [
          { href: `${base}/standings`, label: "Standings" },
          { href: `${base}/status`, label: "Submissions" },
        ]),
  ];

  return (
    <>
      <div className="strip">
        <div className="strip-inner">
          <div className="strip-top">
            <div>
              <h1>
                {contest.name} {!contest.visible && <span className="pill hidden">Hidden</span>}
              </h1>
              <p className="when">
                {formatInZone(contest.start_at, contest.timezone)} to {formatInZone(contest.end_at, contest.timezone)}
                {", "}
                {formatDuration(minutes)}
                <LocalTime iso={contest.start_at.toISOString()} timeZone={contest.timezone} />
              </p>
            </div>
            <ContestClock
              startAt={contest.start_at.toISOString()}
              endAt={contest.end_at.toISOString()}
              serverNow={Date.now()}
            />
          </div>
          <div className="strip-bottom">
            <NavLinks className="tabs" items={tabs} />
            {problems.length > 0 && (
              <div className="balloons" aria-label="Problems">
                {problems.map((problem, index) => {
                  const mine = progress.get(problem.id);
                  const state = !viewer.user ? undefined : mine?.solved ? "solved" : mine?.tried ? "tried" : "open";
                  const note = state === "solved" ? " (solved)" : state === "tried" ? " (not solved yet)" : "";
                  return (
                    <Balloon
                      key={problem.id}
                      index={index}
                      label={problem.label}
                      state={state}
                      href={`${base}/problems/${problem.label}`}
                      title={`${problem.label}. ${problem.title}${note}`}
                    />
                  );
                })}
              </div>
            )}
          </div>
        </div>
      </div>
      {children}
    </>
  );
}
