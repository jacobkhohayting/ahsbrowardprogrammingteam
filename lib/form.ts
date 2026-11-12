import "server-only";
import { unstable_rethrow } from "next/navigation";
import { UserError, type ActionState } from "./errors";
import { SetupError } from "./db";

type TextOptions = { name: string; min?: number; max?: number; trim?: boolean };

/** Reads a text field from a submitted form, with friendly length checks. */
export function text(form: FormData, key: string, options: TextOptions): string {
  const { name, min = 0, max = 1000, trim = true } = options;
  const raw = form.get(key);
  let value = typeof raw === "string" ? raw : "";
  // Browsers send CRLF line breaks from textareas; store plain LF.
  value = value.replace(/\r\n?/g, "\n");
  if (trim) value = value.trim();
  if (value.length < min) {
    throw new UserError(min <= 1 ? `${name} is required.` : `${name} must be at least ${min} characters.`);
  }
  if (value.length > max) throw new UserError(`${name} must be at most ${max.toLocaleString("en-US")} characters.`);
  return value;
}

type NumberOptions = { name: string; min?: number; max?: number; integer?: boolean; fallback?: number };

export function number(form: FormData, key: string, options: NumberOptions): number {
  const { name, min = -Infinity, max = Infinity, integer = false, fallback } = options;
  const raw = form.get(key);
  if ((raw === null || raw === "") && fallback !== undefined) return fallback;
  const value = Number(raw);
  if (typeof raw !== "string" || raw.trim() === "" || !Number.isFinite(value)) {
    throw new UserError(`${name} must be a number.`);
  }
  if (integer && !Number.isInteger(value)) throw new UserError(`${name} must be a whole number.`);
  if (value < min || value > max) throw new UserError(`${name} must be between ${min} and ${max}.`);
  return value;
}

export function checkbox(form: FormData, key: string): boolean {
  const raw = form.get(key);
  return raw === "on" || raw === "true" || raw === "1";
}

export function oneOf<T extends string>(form: FormData, key: string, allowed: readonly T[], name: string): T {
  const raw = form.get(key);
  if (typeof raw !== "string" || !allowed.includes(raw as T)) throw new UserError(`Choose a valid ${name}.`);
  return raw as T;
}

export function id(form: FormData, key: string, name = "item"): number {
  const value = Number(form.get(key));
  if (!Number.isInteger(value) || value <= 0) throw new UserError(`Unknown ${name}.`);
  return value;
}

/**
 * Wraps a form handler so that mistakes come back as a message on the form
 * instead of an error page. Return `{ ok: "..." }` to show a confirmation.
 */
export function formAction(handler: (form: FormData) => Promise<ActionState | void>) {
  return async (_previous: ActionState, form: FormData): Promise<ActionState> => {
    try {
      return (await handler(form)) ?? { ok: "Saved." };
    } catch (error) {
      unstable_rethrow(error); // lets redirect() and notFound() work inside handlers
      if (error instanceof UserError) return { error: error.message };
      if (error instanceof SetupError) return { error: error.message };
      console.error("Form action failed:", error);
      return { error: "Something went wrong on our side. Please try again." };
    }
  };
}
