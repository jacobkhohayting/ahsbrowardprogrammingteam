import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { contestContext, getProblems, SUBMISSION_SELECT, toView, type SubmissionRow } from "@/lib/contests";
import { q } from "@/lib/db";
import { formatPoints } from "@/lib/format";
import { languageOptions } from "@/lib/judge/languages";
import { getSettings } from "@/lib/settings";
import { pointsAt } from "@/lib/standings";
import { Balloon } from "@/components/Balloon";
import { CopyButton } from "@/components/Chrome";
import { Markdown } from "@/components/Markdown";
import { Workspace } from "@/components/Workspace";

type Params = { params: Promise<{ id: string; label: string }> };

export async function generateMetadata({ params }: Params): Promise<Metadata> {
  const { id, label } = await params;
  const { contest, access } = await contestContext(id);
  if (access !== "ok") return { title: contest.name };
  const problem = (await getProblems(contest.id)).find((p) => p.label === label.toUpperCase());
  return { title: problem ? `${problem.label}. ${problem.title}` : contest.name };
}

export default async function ProblemPage({ params }: Params) {
  const { id, label } = await params;
  const { contest, viewer, phase, access } = await contestContext(id);
  const base = `/contests/${contest.id}`;
  if (access !== "ok") redirect(base);

  const problems = await getProblems(contest.id);
  const index = problems.findIndex((p) => p.label === label.toUpperCase());
  if (index === -1) notFound();
  const problem = problems[index];

  const [examples, languages, settings, mine] = await Promise.all([
    q<{ input: string; expected_output: string }>(
      "select input, expected_output from tests where problem_id = $1 and is_example order by ord, id",
      [problem.id],
    ),
    languageOptions(),
    getSettings(),
    viewer.user
      ? q<SubmissionRow>(
          `${SUBMISSION_SELECT} where s.problem_id = $1 and s.user_id = $2 and not s.admin_test
           order by s.id desc limit 30`,
          [problem.id, viewer.user.id],
        )
      : Promise.resolve([]),
  ]);

  const canSubmit = phase === "running" && viewer.user !== null;
  const closedReason =
    phase === "ended"
      ? "This contest is over, so submissions are closed. The problem and everyone's results stay available."
      : phase === "upcoming"
        ? "The contest has not started. You can see this page because you are signed in as an organizer."
        : "You are looking at this as an organizer. To try a solution, open the problem in the admin area.";

  const factors = [
    settings.timeFactorPython > 1 ? `Python gets ${settings.timeFactorPython}× the time` : "",
    settings.timeFactorJava > 1 ? `Java gets ${settings.timeFactorJava}× the time` : "",
  ].filter(Boolean);
  const showSolution = phase === "ended" && contest.show_editorial && (problem.editorial || problem.solution_code);
  const solutionLanguage = languages.find((l) => l.key === problem.solution_language)?.name;

  return (
    <main>
      <div className="split">
        <article>
          <div className="problem-title">
            <Balloon index={index} label={problem.label} large />
            <h1>{problem.title}</h1>
          </div>
          <p className="limits">
            Time limit {problem.time_limit_ms / 1000} s, memory limit {problem.memory_limit_mb} MB
            {factors.length > 0 && ` (${factors.join(", ")})`}
            {contest.leaderboard_type === "adaptive" &&
              (phase === "running"
                ? `. Worth ${formatPoints(
                    pointsAt(
                      problem.points,
                      contest.decay_per_minute,
                      contest.wrong_penalty_pts,
                      Date.now() - contest.start_at.getTime(),
                    ),
                  )} of ${formatPoints(problem.points)} points right now`
                : `. ${formatPoints(problem.points)} points`)}
          </p>

          <Markdown>{problem.statement}</Markdown>

          {examples.length > 0 && (
            <>
              <h2>{examples.length === 1 ? "Example" : "Examples"}</h2>
              <div className="samples">
                {examples.map((example, i) => (
                  <div className="sample" key={i}>
                    <div>
                      <div className="cap">
                        Input <CopyButton text={example.input} />
                      </div>
                      <pre>{example.input}</pre>
                    </div>
                    <div>
                      <div className="cap">Output</div>
                      <pre>{example.expected_output}</pre>
                    </div>
                  </div>
                ))}
              </div>
            </>
          )}

          {showSolution && (
            <>
              <h2>Solution</h2>
              {problem.editorial && <Markdown>{problem.editorial}</Markdown>}
              {problem.solution_code && (
                <details open={!problem.editorial}>
                  <summary>Reference solution{solutionLanguage ? ` in ${solutionLanguage}` : ""}</summary>
                  <pre className="source">{problem.solution_code}</pre>
                </details>
              )}
            </>
          )}

          <p className="small muted" style={{ marginTop: "2rem" }}>
            {index > 0 && <Link href={`${base}/problems/${problems[index - 1].label}`}>Previous problem</Link>}
            {index > 0 && index < problems.length - 1 && ", "}
            {index < problems.length - 1 && (
              <Link href={`${base}/problems/${problems[index + 1].label}`}>Next problem</Link>
            )}
          </p>
        </article>

        <Workspace
          key={problem.id}
          contestId={contest.id}
          problemId={problem.id}
          problemLabel={problem.label}
          languages={languages.map(({ key, name, available }) => ({ key, name, available }))}
          examples={examples.map((e) => ({ input: e.input, output: e.expected_output }))}
          canSubmit={canSubmit}
          closedReason={closedReason}
          allowRun={settings.allowRun}
          mySubmissions={mine.map((row) => toView(row, false))}
          me={viewer.user?.username ?? null}
        />
      </div>
    </main>
  );
}
