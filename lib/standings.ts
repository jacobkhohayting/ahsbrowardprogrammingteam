// Leaderboards. This file has no imports so it can be unit-tested on its own.
//
//  short    : most solves first; ties broken by the earlier time of the last accepted submission.
//  long     : most solves first, then lowest penalty. Penalty = for each solved problem, whole
//             minutes from the contest start to the accepted submission, plus `penalty_per_wrong`
//             for every rejected attempt before it. Ties broken by earlier last accepted.
//  adaptive : each problem is worth `points` at the start and loses `decay_per_minute` every full
//             minute (never below 0); optionally `wrong_penalty_pts` per rejected attempt.
//             Highest total first, then earlier last accepted.
//
// Everyone who entered the contest appears, even with no submissions. Only the first accepted
// submission per problem counts; later submissions are ignored. Compilation errors and judge
// errors are never counted as attempts. Rejected attempts on unsolved problems carry no penalty.

export type StandingsContest = {
  start_at: Date | string;
  leaderboard_type: "short" | "long" | "adaptive";
  penalty_per_wrong: number;
  decay_per_minute: number;
  wrong_penalty_pts: number;
};

export type StandingsProblem = { id: number; label: string; title: string; points: number };

export type StandingsPerson = { user_id: number; username: string; full_name: string };

/** Must be ordered by submission time (oldest first) and exclude invalidated and admin runs. */
export type StandingsSubmission = StandingsPerson & {
  problem_id: number;
  status: string;
  verdict: string | null;
  submitted_at: Date | string;
};

export type StandingsCell = {
  attempts: number; // rejected attempts before the accepted one
  pending: number; // still being judged
  solved: boolean;
  time_s: number | null; // seconds from contest start to the accepted submission
  points: number; // adaptive only
};

export type StandingsRow = StandingsPerson & {
  rank: number;
  solves: number;
  penalty: number;
  points: number;
  last_ac: number | null;
  cells: Record<number, StandingsCell>;
};

export type Standings = {
  type: StandingsContest["leaderboard_type"];
  problems: StandingsProblem[];
  rows: StandingsRow[];
};

const round2 = (value: number) => Math.round(value * 100) / 100;

/** What a problem is worth `elapsedMs` into an adaptive contest. */
export function pointsAt(
  maxPoints: number,
  decayPerMinute: number,
  wrongPenaltyPoints: number,
  elapsedMs: number,
  wrongAttempts = 0,
): number {
  const minutes = Math.max(0, Math.floor(elapsedMs / 60000));
  return Math.max(0, round2(maxPoints - decayPerMinute * minutes - wrongPenaltyPoints * wrongAttempts));
}

export function computeStandings(
  contest: StandingsContest,
  problems: StandingsProblem[],
  entrants: StandingsPerson[],
  submissions: StandingsSubmission[],
): Standings {
  const type = contest.leaderboard_type;
  const start = new Date(contest.start_at).getTime();
  const byProblem = new Map(problems.map((p) => [p.id, p]));
  const people = new Map<number, StandingsRow>();

  const rowFor = (person: StandingsPerson): StandingsRow => {
    let row = people.get(person.user_id);
    if (!row) {
      row = {
        user_id: person.user_id,
        username: person.username,
        full_name: person.full_name,
        rank: 0,
        solves: 0,
        penalty: 0,
        points: 0,
        last_ac: null,
        cells: {},
      };
      people.set(person.user_id, row);
    }
    return row;
  };

  for (const entrant of entrants) rowFor(entrant);

  for (const s of submissions) {
    const problem = byProblem.get(s.problem_id);
    if (!problem) continue;
    const row = rowFor(s);
    const cell = (row.cells[s.problem_id] ??= { attempts: 0, pending: 0, solved: false, time_s: null, points: 0 });
    if (cell.solved) continue;
    if (s.status !== "done") {
      cell.pending++;
      continue;
    }
    if (s.verdict === "CE" || s.verdict === "JE" || s.verdict === null) continue;
    if (s.verdict === "AC") {
      cell.solved = true;
      cell.time_s = Math.max(0, Math.floor((new Date(s.submitted_at).getTime() - start) / 1000));
      if (type === "adaptive") {
        cell.points = pointsAt(
          problem.points,
          contest.decay_per_minute,
          contest.wrong_penalty_pts,
          cell.time_s * 1000,
          cell.attempts,
        );
      }
    } else {
      cell.attempts++;
    }
  }

  for (const row of people.values()) {
    for (const cell of Object.values(row.cells)) {
      if (!cell.solved || cell.time_s === null) continue;
      row.solves++;
      row.last_ac = row.last_ac === null ? cell.time_s : Math.max(row.last_ac, cell.time_s);
      row.penalty += Math.floor(cell.time_s / 60) + cell.attempts * contest.penalty_per_wrong;
      row.points += cell.points;
    }
    row.points = round2(row.points);
  }

  const rows = [...people.values()];
  const byLast = (a: StandingsRow, b: StandingsRow) => (a.last_ac ?? Infinity) - (b.last_ac ?? Infinity);
  const byName = (a: StandingsRow, b: StandingsRow) =>
    a.username.localeCompare(b.username, "en", { sensitivity: "base" });

  const compare =
    type === "long"
      ? (a: StandingsRow, b: StandingsRow) =>
          b.solves - a.solves || a.penalty - b.penalty || byLast(a, b) || byName(a, b)
      : type === "adaptive"
        ? (a: StandingsRow, b: StandingsRow) => b.points - a.points || byLast(a, b) || byName(a, b)
        : (a: StandingsRow, b: StandingsRow) => b.solves - a.solves || byLast(a, b) || byName(a, b);
  rows.sort(compare);

  // Equal scores share a rank: 1, 1, 3, ...
  const tied = (a: StandingsRow, b: StandingsRow) =>
    type === "adaptive"
      ? a.points === b.points && a.last_ac === b.last_ac
      : type === "long"
        ? a.solves === b.solves && a.penalty === b.penalty && a.last_ac === b.last_ac
        : a.solves === b.solves && a.last_ac === b.last_ac;
  rows.forEach((row, i) => {
    row.rank = i > 0 && tied(rows[i - 1], row) ? rows[i - 1].rank : i + 1;
  });

  return { type, problems, rows };
}

/** The standings as a CSV file (for spreadsheets). */
export function standingsCsv(standings: Standings, includeFullNames: boolean): string {
  const quote = (value: unknown) => {
    let text = String(value ?? "");
    // Spreadsheets treat cells starting with these characters as formulas; neutralize them.
    if (/^[=+\-@\t\r]/.test(text) && typeof value !== "number") text = "'" + text;
    return `"${text.replace(/"/g, '""')}"`;
  };
  const scoreColumn =
    standings.type === "long" ? "penalty" : standings.type === "adaptive" ? "points" : "last_accepted_seconds";
  const header = [
    "rank",
    "username",
    ...(includeFullNames ? ["full_name"] : []),
    "solved",
    scoreColumn,
    ...standings.problems.map((p) => p.label),
  ];
  const lines = [header.map(quote).join(",")];
  for (const row of standings.rows) {
    const score =
      standings.type === "long" ? row.penalty : standings.type === "adaptive" ? row.points : (row.last_ac ?? "");
    const cells = standings.problems.map((p) => {
      const cell = row.cells[p.id];
      if (!cell) return "";
      const wrong = cell.attempts ? `, ${cell.attempts} wrong` : "";
      if (cell.solved) {
        return standings.type === "adaptive"
          ? `${cell.points} pts at ${cell.time_s}s${wrong}`
          : `solved at ${cell.time_s}s${wrong}`;
      }
      return cell.attempts ? `${cell.attempts} wrong` : "";
    });
    lines.push(
      [row.rank, row.username, ...(includeFullNames ? [row.full_name] : []), row.solves, score, ...cells]
        .map(quote)
        .join(","),
    );
  }
  return lines.join("\n") + "\n";
}
