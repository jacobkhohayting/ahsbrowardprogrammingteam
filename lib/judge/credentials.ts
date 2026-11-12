import "server-only";
import { getVercelOidcToken } from "@vercel/oidc";

export type SandboxCredentials = { token: string; teamId: string; projectId: string };

/** Where submissions are judged: in a Vercel Sandbox (on Vercel) or on this computer (development). */
export function judgeMode(): "sandbox" | "local" {
  if (process.env.JUDGE_MODE === "local") return "local";
  if (process.env.JUDGE_MODE === "sandbox") return "sandbox";
  return process.env.VERCEL === "1" || process.env.VERCEL_OIDC_TOKEN ? "sandbox" : "local";
}

function decodePayload(token: string): { owner_id?: string; project_id?: string } {
  try {
    return JSON.parse(Buffer.from(token.split(".")[1] ?? "", "base64url").toString("utf8"));
  } catch {
    return {};
  }
}

/**
 * The identity Vercel gives this project, used to start sandboxes. No API key is
 * needed: Vercel attaches a short-lived token to every request automatically.
 *
 * Call this while handling a request (not inside `after`), because that is where
 * the token is available, then pass the result along to the background work.
 */
export async function sandboxCredentials(): Promise<SandboxCredentials> {
  // Optional manual override, for running outside Vercel.
  const { VERCEL_TOKEN, VERCEL_TEAM_ID, VERCEL_PROJECT_ID } = process.env;
  if (VERCEL_TOKEN && VERCEL_TEAM_ID && VERCEL_PROJECT_ID) {
    return { token: VERCEL_TOKEN, teamId: VERCEL_TEAM_ID, projectId: VERCEL_PROJECT_ID };
  }
  let token: string;
  try {
    token = await getVercelOidcToken();
  } catch (error) {
    throw new Error(
      "Vercel did not provide an identity token for this request, so the judge cannot start a sandbox. " +
        "This works automatically on Vercel deployments. (" +
        (error instanceof Error ? error.message.split("\n")[0] : "unknown error") +
        ")",
    );
  }
  const payload = decodePayload(token);
  if (!payload.owner_id || !payload.project_id) {
    throw new Error("Vercel's identity token is missing the project information.");
  }
  return { token, teamId: payload.owner_id, projectId: payload.project_id };
}

/** Same as sandboxCredentials, but returns null instead of failing. */
export async function sandboxCredentialsOrNull(): Promise<SandboxCredentials | null> {
  if (judgeMode() !== "sandbox") return null;
  try {
    return await sandboxCredentials();
  } catch {
    return null;
  }
}
