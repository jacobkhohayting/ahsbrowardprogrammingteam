"use server";

import { redirect } from "next/navigation";
import { refresh } from "next/cache";
import { isUniqueViolation, q, q1 } from "../db";
import { UserError } from "../errors";
import { formAction, text } from "../form";
import {
  adminPassword,
  checkAdminPassword,
  endAllSessionsFor,
  getViewer,
  hashPassword,
  safeNext,
  signInAdmin,
  signInUser,
  signOutAdmin,
  signOutUser,
  verifyPassword,
} from "../auth";
import { allow, clientIp, recentCount, record } from "../ratelimit";
import { getSettings } from "../settings";

const USERNAME = /^[A-Za-z0-9_]{3,24}$/;
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

type ProfileFields = { fullName: string; username: string; email: string; plNumber: string };

async function readProfileFields(form: FormData): Promise<ProfileFields> {
  const fullName = text(form, "full_name", { name: "Full name", min: 1, max: 100 });
  const username = text(form, "username", { name: "Username", min: 3, max: 24 });
  if (!USERNAME.test(username)) {
    throw new UserError("Usernames can use letters, numbers and underscores (3 to 24 characters).");
  }
  const email = text(form, "email", { name: "School email", min: 3, max: 200 }).toLowerCase();
  if (!EMAIL.test(email)) throw new UserError("Enter a valid email address.");
  const plNumber = text(form, "pl_number", { name: "PL number", min: 1, max: 50 });

  const { emailDomains } = await getSettings();
  const domains = emailDomains
    .split(",")
    .map((d) => d.trim().toLowerCase().replace(/^@/, ""))
    .filter(Boolean);
  if (domains.length && !domains.some((domain) => email.endsWith("@" + domain))) {
    throw new UserError(`Use your school email address (ending in @${domains.join(" or @")}).`);
  }
  return { fullName, username, email, plNumber };
}

function duplicateMessage(error: unknown): string | null {
  if (isUniqueViolation(error, "users_email_key")) return "An account with this email already exists. Log in instead.";
  if (isUniqueViolation(error, "users_username_key")) return "That username is taken. Pick another one.";
  return null;
}

export const register = formAction(async (form) => {
  const settings = await getSettings();
  if (!settings.registrationOpen) throw new UserError("New accounts are closed right now. Ask a club officer.");
  const ip = await clientIp();
  // A whole classroom can share one address, so this limit is generous. It only stops floods.
  if (!(await allow(`register:${ip}`, 300, 3600))) {
    throw new UserError("Too many new accounts from this network in the last hour. Try again later.");
  }

  const fields = await readProfileFields(form);
  const password = text(form, "password", { name: "Password", min: 8, max: 200, trim: false });

  let userId: number;
  try {
    const row = await q1<{ id: number }>(
      `insert into users (username, email, full_name, pl_number, password_hash)
       values ($1, $2, $3, $4, $5) returning id`,
      [fields.username, fields.email, fields.fullName, fields.plNumber, await hashPassword(password)],
    );
    userId = row!.id;
  } catch (error) {
    const message = duplicateMessage(error);
    if (message) throw new UserError(message);
    throw error;
  }
  await signInUser(userId);
  redirect(safeNext(String(form.get("next") ?? ""), "/"));
});

// Used when the username does not exist, so a wrong username takes as long as a wrong password.
const DUMMY_HASH =
  "scrypt$32768$8$1$AAAAAAAAAAAAAAAAAAAAAA==$AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=";

export const login = formAction(async (form) => {
  const name = text(form, "login", { name: "Username or email", min: 1, max: 200 });
  const password = String(form.get("password") ?? "");
  const ip = await clientIp();
  const bucket = `login-fail:${ip}:${name.toLowerCase()}`;
  if ((await recentCount(bucket, 900)) >= 10 || (await recentCount(`login-fail:${ip}`, 900)) >= 200) {
    throw new UserError("Too many wrong passwords. Wait 15 minutes, or ask a club officer to reset your password.");
  }

  const user = await q1<{ id: number; password_hash: string }>(
    "select id, password_hash from users where lower(username) = lower($1) or lower(email) = lower($1)",
    [name],
  );
  const correct = await verifyPassword(password, user?.password_hash ?? DUMMY_HASH);
  if (!user || !correct) {
    await record(bucket);
    await record(`login-fail:${ip}`);
    throw new UserError("Wrong username, email or password.");
  }
  await signInUser(user.id);
  redirect(safeNext(String(form.get("next") ?? ""), "/"));
});

export const logout = formAction(async () => {
  await signOutUser();
  redirect("/");
});

export const updateProfile = formAction(async (form) => {
  const { user } = await getViewer();
  if (!user) redirect("/login?next=/profile");
  const fields = await readProfileFields(form);

  const newPassword = String(form.get("new_password") ?? "");
  let passwordHash: string | null = null;
  if (newPassword) {
    if (newPassword.length < 8 || newPassword.length > 200) {
      throw new UserError("The new password must be at least 8 characters.");
    }
    const row = await q1<{ password_hash: string }>("select password_hash from users where id = $1", [user.id]);
    const current = String(form.get("current_password") ?? "");
    if (!row || !(await verifyPassword(current, row.password_hash))) {
      throw new UserError("Your current password is not correct, so the password was not changed.");
    }
    passwordHash = await hashPassword(newPassword);
  }

  try {
    await q(
      `update users set full_name = $2, username = $3, email = $4, pl_number = $5,
              password_hash = coalesce($6, password_hash)
       where id = $1`,
      [user.id, fields.fullName, fields.username, fields.email, fields.plNumber, passwordHash],
    );
  } catch (error) {
    const message = duplicateMessage(error);
    if (message) throw new UserError(message.replace(" Log in instead.", ""));
    throw error;
  }
  if (passwordHash) {
    // Sign out every other device, then keep this one signed in.
    await endAllSessionsFor(user.id);
    await signInUser(user.id);
  }
  refresh();
  return { ok: passwordHash ? "Profile and password saved." : "Profile saved." };
});

export const adminLogin = formAction(async (form) => {
  if (!adminPassword()) {
    throw new UserError(
      "The admin area is switched off because no admin password is set. In Vercel, add an environment variable named ADMIN_PASSWORD, then redeploy.",
    );
  }
  const ip = await clientIp();
  if ((await recentCount(`admin-fail:${ip}`, 900)) >= 8 || (await recentCount("admin-fail", 900)) >= 60) {
    throw new UserError("Too many wrong attempts. Wait 15 minutes and try again.");
  }
  if (!checkAdminPassword(String(form.get("password") ?? ""))) {
    await record(`admin-fail:${ip}`);
    await record("admin-fail");
    throw new UserError("That is not the admin password.");
  }
  await signInAdmin();
  redirect("/admin");
});

export const adminLogout = formAction(async () => {
  await signOutAdmin();
  redirect("/");
});
