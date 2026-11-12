import Link from "next/link";
import { requireAdmin } from "@/lib/auth";
import { q1 } from "@/lib/db";
import { checkHealth } from "@/lib/health";
import { languageDisplayNames } from "@/lib/judge/runtime";
import { usageThisMonth } from "@/lib/settings";
import { JudgePanel } from "@/components/admin/JudgePanel";

export default async function AdminHome() {
  await requireAdmin();
  const [health, counts, usage] = await Promise.all([
    checkHealth(),
    q1<{ users: number; contests: number; submissions: number; pending: number }>(
      `select (select count(*) from users) as users,
              (select count(*) from contests) as contests,
              (select count(*) from submissions where not admin_test) as submissions,
              (select count(*) from submissions where status <> 'done') as pending`,
    ),
    usageThisMonth(),
  ]);

  return (
    <main>
      <div className="head">
        <h1>Overview</h1>
        <div className="actions">
          <Link className="btn primary" href="/admin/contests/new">
            New contest
          </Link>
        </div>
      </div>

      <div className="stat-row">
        <div>
          <strong>{counts?.contests ?? 0}</strong>
          <span>contests</span>
        </div>
        <div>
          <strong>{counts?.users ?? 0}</strong>
          <span>accounts</span>
        </div>
        <div>
          <strong>{counts?.submissions ?? 0}</strong>
          <span>submissions</span>
        </div>
        <div>
          <strong>{counts?.pending ?? 0}</strong>
          <span>waiting to be judged</span>
        </div>
      </div>

      {(health.database.state !== "good" || health.admin.state !== "good") && (
        <p className="msg warn">
          {health.admin.state !== "good" ? health.admin.title + ". " + health.admin.detail : health.database.detail}{" "}
          <Link href="/setup">Open the setup check</Link>
        </p>
      )}

      <h2>Judge</h2>
      <JudgePanel
        initial={{
          mode: health.mode,
          runtime: health.runtime,
          build: health.build,
          names: languageDisplayNames(health.runtime),
        }}
      />

      {health.mode === "sandbox" && (
        <>
          <h2>Judge use this month</h2>
          <div className="stat-row">
            <div>
              <strong>{usage.sandboxes}</strong>
              <span>sandboxes started (free plan: 5,000 a month)</span>
            </div>
            <div>
              <strong>{usage.submissions}</strong>
              <span>submissions</span>
            </div>
            <div>
              <strong>{usage.runs}</strong>
              <span>&ldquo;Run examples&rdquo; clicks</span>
            </div>
          </div>
          <p className="help" style={{ maxWidth: "72ch" }}>
            Vercel&apos;s free plan also includes 5 hours of sandbox CPU time a month, which is usually what runs out
            first: roughly a few thousand submissions. Exact figures are under Usage in the Vercel dashboard. If the
            allowance runs out, judging pauses until it resets; nothing is charged. Switching off &ldquo;Run
            examples&rdquo; in Settings saves the most.
          </p>
        </>
      )}

      <h2>How to run a contest</h2>
      <ol style={{ maxWidth: "72ch", paddingLeft: "1.25rem" }}>
        <li>
          <Link href="/admin/contests/new">Create a contest</Link>: name, times and leaderboard type. It starts hidden.
        </li>
        <li>Add problems, write their statements, and add tests. Tick the tests students should see as examples.</li>
        <li>Use &ldquo;Try a solution&rdquo; on each problem to check the tests and limits.</li>
        <li>Publish the contest. Problems open to everyone at the start time.</li>
      </ol>
    </main>
  );
}
