import { getViewer } from "@/lib/auth";
import { getContest, showsFullNames } from "@/lib/contests";
import { contestPhase } from "@/lib/format";
import { getSettings } from "@/lib/settings";
import { standingsCsv } from "@/lib/standings";
import { loadStandings } from "@/lib/standings-data";

/** The standings as a .csv file that opens in Excel or Google Sheets. */
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const [contest, viewer, settings] = await Promise.all([
    getContest(Number((await params).id)),
    getViewer(),
    getSettings(),
  ]);
  if (!contest || (!contest.visible && !viewer.isAdmin)) return new Response("Contest not found.", { status: 404 });
  if (contestPhase(contest.start_at, contest.end_at) === "upcoming" && !viewer.isAdmin) {
    return new Response("The contest has not started yet.", { status: 403 });
  }
  const csv = standingsCsv(await loadStandings(contest), showsFullNames(viewer, settings));
  return new Response(csv, {
    headers: {
      "content-type": "text/csv; charset=utf-8",
      "content-disposition": `attachment; filename="standings-contest-${contest.id}.csv"`,
      "cache-control": "no-store",
    },
  });
}
