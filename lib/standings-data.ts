import "server-only";
import { q } from "./db";
import { getProblems, type Contest } from "./contests";
import { computeStandings, type Standings, type StandingsPerson, type StandingsSubmission } from "./standings";

/** Reads everything the leaderboard needs for one contest and computes it. */
export async function loadStandings(contest: Contest): Promise<Standings> {
  const [problems, entrants, submissions] = await Promise.all([
    getProblems(contest.id),
    q<StandingsPerson>(
      `select e.user_id, u.username, u.full_name
       from contest_entries e join users u on u.id = e.user_id
       where e.contest_id = $1`,
      [contest.id],
    ),
    q<StandingsSubmission>(
      `select s.user_id, u.username, u.full_name, s.problem_id, s.status, s.verdict, s.submitted_at
       from submissions s join users u on u.id = s.user_id
       where s.contest_id = $1 and not s.invalidated and not s.admin_test
         and s.submitted_at >= $2 and s.submitted_at < $3
       order by s.submitted_at, s.id`,
      [contest.id, contest.start_at, contest.end_at],
    ),
  ]);
  return computeStandings(
    contest,
    problems.map((p) => ({ id: p.id, label: p.label, title: p.title, points: p.points })),
    entrants,
    submissions,
  );
}
