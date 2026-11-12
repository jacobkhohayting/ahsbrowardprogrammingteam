import { NextResponse, after } from "next/server";
import { api, assertSameOrigin } from "@/lib/api";
import { getViewer } from "@/lib/auth";
import { UserError } from "@/lib/errors";
import { judgeMode, sandboxCredentials } from "@/lib/judge/credentials";
import { localHost } from "@/lib/judge/host-local";
import { buildRuntime, getBuildState, getRuntime, JudgeBusyError, languageDisplayNames } from "@/lib/judge/runtime";

export const maxDuration = 300;

async function requireAdminApi() {
  const { isAdmin } = await getViewer();
  if (!isAdmin) throw new UserError("Sign in to the admin area first.", 401);
}

/** Current state of the judge, polled by the admin dashboard while it is being prepared. */
export const GET = api(async () => {
  await requireAdminApi();
  const mode = judgeMode();
  if (mode === "local") return NextResponse.json({ mode, runtime: null, build: null, names: null });
  const [runtime, build] = await Promise.all([getRuntime(), getBuildState()]);
  return NextResponse.json({ mode, runtime, build, names: languageDisplayNames(runtime) });
});

/** "Prepare judge" / "Rebuild judge": installs the compilers into a fresh snapshot (about two minutes). */
export const POST = api(async (request) => {
  assertSameOrigin(request);
  await requireAdminApi();

  if (judgeMode() === "local") {
    const test = await localHost().selfTest();
    return NextResponse.json({ mode: "local", selfTest: test });
  }

  const build = await getBuildState();
  if (build?.running) throw new UserError("The judge is already being prepared. Give it a couple of minutes.", 409);
  const credentials = await sandboxCredentials().catch((error: Error) => {
    throw new UserError(error.message, 503);
  });
  // Answer right away and keep working; the page polls GET for progress.
  after(async () => {
    try {
      await buildRuntime(credentials);
    } catch (error) {
      if (!(error instanceof JudgeBusyError)) console.error("judge: preparing the runtime failed:", error);
    }
  });
  return NextResponse.json({ mode: "sandbox", started: true });
});
