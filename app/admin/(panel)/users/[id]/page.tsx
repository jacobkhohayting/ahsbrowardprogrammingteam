import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { requireAdmin } from "@/lib/auth";
import { q1 } from "@/lib/db";
import { deleteUser, saveUser } from "@/lib/actions/admin-people";
import { ActionForm } from "@/components/ActionForm";
import { ProfileFields } from "@/components/ProfileFields";

export const metadata: Metadata = { title: "User" };

type Row = {
  id: number;
  username: string;
  full_name: string;
  email: string;
  pl_number: string;
  created_at: Date;
  submissions: number;
};

export default async function AdminUserPage({ params }: { params: Promise<{ id: string }> }) {
  await requireAdmin();
  const id = Number((await params).id);
  if (!Number.isInteger(id)) notFound();
  const user = await q1<Row>(
    `select u.id, u.username, u.full_name, u.email, u.pl_number, u.created_at,
            (select count(*) from submissions s where s.user_id = u.id) as submissions
     from users u where u.id = $1`,
    [id],
  );
  if (!user) notFound();

  return (
    <main>
      <p className="crumb">
        <Link href="/admin/users">Users</Link>
      </p>
      <div className="head">
        <div>
          <h1>{user.username}</h1>
          <p className="muted">
            Joined {user.created_at.toISOString().slice(0, 10)}.{" "}
            <Link href={`/admin/submissions?user=${user.id}`}>
              {user.submissions} submission{user.submissions === 1 ? "" : "s"}
            </Link>
          </p>
        </div>
      </div>
      <div className="narrow">
        <ActionForm action={saveUser}>
          <input type="hidden" name="id" value={user.id} />
          <ProfileFields values={user} />
          <h2>Set a new password</h2>
          <label htmlFor="new_password">
            New password <span className="muted">(leave empty to keep the current one)</span>
          </label>
          <input id="new_password" name="new_password" type="text" minLength={8} maxLength={200} autoComplete="off" />
          <p className="help">
            For students who forgot theirs. Tell them the new password; they can change it under their profile.
          </p>
          <div className="form-actions">
            <button className="btn primary">Save user</button>
          </div>
        </ActionForm>

        <h2>Delete this account</h2>
        <p className="help">Deletes the account with its {user.submissions} submissions and contest entries. This cannot be undone.</p>
        <ActionForm
          action={deleteUser}
          messages="bottom"
          confirm={`Delete ${user.username} and their ${user.submissions} submissions for good?`}
        >
          <input type="hidden" name="id" value={user.id} />
          <button className="btn danger">Delete account</button>
        </ActionForm>
      </div>
    </main>
  );
}
