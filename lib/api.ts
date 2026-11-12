import "server-only";
import { NextResponse } from "next/server";
import { SetupError } from "./db";
import { UserError } from "./errors";

/** Refuse POSTs that come from another website (protects logged-in users from forged requests). */
export function assertSameOrigin(request: Request): void {
  const type = request.headers.get("content-type") ?? "";
  if (!type.toLowerCase().includes("application/json")) {
    throw new UserError("Requests must be sent as JSON.", 415);
  }
  const origin = request.headers.get("origin");
  if (!origin) return; // non-browser client; a browser cannot send JSON cross-site without an Origin
  const host = request.headers.get("x-forwarded-host") ?? request.headers.get("host");
  let originHost = "";
  try {
    originHost = new URL(origin).host;
  } catch {
    // handled below
  }
  if (!host || originHost !== host) throw new UserError("This request came from another site.", 403);
}

export async function readJson(request: Request): Promise<Record<string, unknown>> {
  try {
    const body = await request.json();
    if (body && typeof body === "object" && !Array.isArray(body)) return body as Record<string, unknown>;
  } catch {
    // handled below
  }
  throw new UserError("The request could not be read.");
}

/** Wraps an API handler so that problems come back as `{ error: "..." }` with a fitting status. */
export function api<Args extends unknown[]>(handler: (request: Request, ...args: Args) => Promise<Response>) {
  return async (request: Request, ...args: Args): Promise<Response> => {
    try {
      return await handler(request, ...args);
    } catch (error) {
      if (error instanceof UserError) return NextResponse.json({ error: error.message }, { status: error.status });
      if (error instanceof SetupError) return NextResponse.json({ error: error.message }, { status: 503 });
      console.error("API error:", error);
      return NextResponse.json({ error: "Something went wrong on our side. Please try again." }, { status: 500 });
    }
  };
}

export function positiveInt(value: unknown, name: string): number {
  const n = Number(value);
  if (!Number.isInteger(n) || n <= 0) throw new UserError(`Unknown ${name}.`);
  return n;
}
