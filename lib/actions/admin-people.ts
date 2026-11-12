"use server";

import { redirect } from "next/navigation";
import { refresh } from "next/cache";
import { endAllSessionsFor, hashPassword, requireAdmin } from "../auth";
import { isUniqueViolation, q } from "../db";
import { UserError } from "../errors";
import { checkbox, formAction, id, number, oneOf, text } from "../form";
import { requeue, scheduleDrain } from "../judge/queue";
import { DEFAULT_SETTINGS, writeSetting, type SiteSettings } from "../settings";

// ---------------------------------------------------------------------------
// Users
// ---------------------------------------------------------------------------
export const saveUser = formAction(async (form) => {
  await requireAdmin();
  const userId = id(form, "id", "user");
  const fullName = text(form, "full_name", { name: "Full name", min: 1, max: 100 });
  const username = text(form, "username", { name: "Username", min: 3, max: 24 });
  if (!/^[A-Za-z0-9_]{3,24}$/.test(username)) {
    throw new UserError("Usernames can use letters, numbers and underscores (3 to 24 characters).");
  }
  const email = text(form, "email", { name: "Email", min: 3, max: 200 }).toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new UserError("Enter a valid email address.");
  const plNumber = text(form, "pl_number", { name: "PL number", min: 1, max: 50 });
  const newPassword = String(form.get("new_password") ?? "");
  if (newPassword && newPassword.length < 8) throw new UserError("A new password must be at least 8 characters.");

  try {
    const updated = await q(
      `update users set full_name = $2, username = $3, email = $4, pl_number = $5,
              password_hash = coalesce($6, password_hash)
       where id = $1 returning id`,
      [userId, fullName, username, email, plNumber, newPassword ? await hashPassword(newPassword) : null],
    );
    if (updated.length === 0) throw new UserError("This account no longer exists.");
  } catch (error) {
    if (isUniqueViolation(error, "users_email_key")) throw new UserError("Another account already uses this email.");
    if (isUniqueViolation(error, "users_username_key")) throw new UserError("That username is taken.");
    throw error;
  }
  if (newPassword) await endAllSessionsFor(userId); // they must log in again with the new password
  refresh();
  return { ok: newPassword ? "Saved. The new password works from now on." : "Saved." };
});

/** Deletes an account for good, with its submissions and contest entries. */
export const deleteUser = formAction(async (form) => {
  await requireAdmin();
  await q("delete from users where id = $1", [id(form, "id", "user")]);
  redirect("/admin/users");
});

// ---------------------------------------------------------------------------
// Submissions
// ---------------------------------------------------------------------------
export const rejudgeSubmission = formAction(async (form) => {
  await requireAdmin();
  const count = await requeue("id = $1", [id(form, "id", "submission")]);
  if (count > 0) await scheduleDrain();
  refresh();
  return { ok: count > 0 ? "Queued for judging again." : "This submission no longer exists." };
});

/** Invalidating keeps a submission on record but removes it from the standings. */
export const setInvalidated = formAction(async (form) => {
  await requireAdmin();
  const invalidated = form.get("invalidated") === "1";
  await q("update submissions set invalidated = $2 where id = $1", [id(form, "id", "submission"), invalidated]);
  refresh();
  return { ok: invalidated ? "Removed from the standings." : "Counts in the standings again." };
});

export const deleteSubmission = formAction(async (form) => {
  await requireAdmin();
  await q("delete from submissions where id = $1", [id(form, "id", "submission")]);
  redirect("/admin/submissions");
});

// ---------------------------------------------------------------------------
// Site settings
// ---------------------------------------------------------------------------
export const saveSettings = formAction(async (form) => {
  await requireAdmin();
  const domains = text(form, "email_domains", { name: "Allowed email endings", max: 500 })
    .split(/[\s,]+/)
    .map((d) => d.trim().toLowerCase().replace(/^@/, ""))
    .filter(Boolean);
  for (const domain of domains) {
    if (!/^[a-z0-9.-]+\.[a-z]{2,}$/.test(domain)) {
      throw new UserError(`"${domain}" does not look like an email ending. Example: ahschool.com`);
    }
  }
  const settings: SiteSettings = {
    siteName: text(form, "site_name", { name: "Site name", min: 1, max: 80 }) || DEFAULT_SETTINGS.siteName,
    registrationOpen: checkbox(form, "registration_open"),
    emailDomains: domains.join(", "),
    namesVisibility: oneOf(form, "names_visibility", ["everyone", "members", "organizers"] as const, "option"),
    allowRun: checkbox(form, "allow_run"),
    timeFactorPython: number(form, "time_factor_python", { name: "Python time factor", min: 1, max: 10, fallback: 1 }),
    timeFactorJava: number(form, "time_factor_java", { name: "Java time factor", min: 1, max: 10, fallback: 1 }),
  };
  await writeSetting("site", settings);
  refresh();
  return { ok: "Settings saved." };
});
