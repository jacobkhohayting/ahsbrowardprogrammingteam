import { NextResponse } from "next/server";
import { api } from "@/lib/api";
import { getViewer } from "@/lib/auth";
import { q } from "@/lib/db";
import { kickIfPending } from "@/lib/judge/queue";

export const maxDuration = 300;

/**
 * Pages showing "In queue" / "Judging" ask this every couple of seconds:
 *   GET /api/submissions/status?ids=12,13
 * It also restarts the judge queue if something is waiting, so nothing stays stuck.
 */
export const GET = api(async (request) => {
  const { isAdmin } = await getViewer();
  const ids = (new URL(request.url).searchParams.get("ids") ?? "")
    .split(",")
    .map(Number)
    .filter((n) => Number.isInteger(n) && n > 0)
    .slice(0, 100);
  if (ids.length === 0) return NextResponse.json({ submissions: [] });

  // Verdicts are public for visible contests; organizer test runs are not.
  const rows = await q(
    `select s.id, s.status, s.verdict, s.failed_test, s.time_ms, s.memory_kb, s.invalidated
     from submissions s join contests c on c.id = s.contest_id
     where s.id = any($1::int[]) and ($2 or (c.visible and not s.admin_test))`,
    [ids, isAdmin],
  );
  await kickIfPending();
  return NextResponse.json({
    submissions: rows.map((r) => ({
      id: r.id,
      status: r.status,
      verdict: r.verdict,
      failedTest: r.failed_test,
      timeMs: r.time_ms,
      memoryKb: r.memory_kb,
      invalidated: r.invalidated,
    })),
  });
});
