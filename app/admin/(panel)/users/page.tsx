import type { Metadata } from "next";
import Link from "next/link";
import { requireAdmin } from "@/lib/auth";
import { q } from "@/lib/db";

export const metadata: Metadata = { title: "Users" };

type Row = {
  id: number;
  username: string;
  full_name: string;
  email: string;
  pl_number: string;
  created_at: Date;
  submissions: number;
  contests: number;
};

export default async function AdminUsersPage({ searchParams }: { searchParams: Promise<{ q?: string }> }) {
  await requireAdmin();
  const search = ((await searchParams).q ?? "").trim().slice(0, 100);
  const pattern = `%${search.replace(/[\\%_]/g, "\\$&")}%`;
  const users = await q<Row>(
    `select u.id, u.username, u.full_name, u.email, u.pl_number, u.created_at,
            (select count(*) from submissions s where s.user_id = u.id) as submissions,
            (select count(*) from contest_entries e where e.user_id = u.id) as contests
     from users u
     where $1 = '%%' or u.username ilike $1 or u.full_name ilike $1 or u.email ilike $1 or u.pl_number ilike $1
     order by u.id desc limit 1000`,
    [pattern],
  );

  return (
    <main>
      <div className="head">
        <div>
          <h1>Users</h1>
          <p className="muted">
            {users.length}
            {users.length === 1000 ? "+" : ""} account{users.length === 1 ? "" : "s"}
            {search ? ` matching "${search}"` : ""}
          </p>
        </div>
      </div>
      <form className="filters" method="get">
        <div style={{ flex: "1 1 18rem" }}>
          <label htmlFor="q">Search by name, username, email or PL number</label>
          <input id="q" name="q" type="search" defaultValue={search} />
        </div>
        <button className="btn">Search</button>
      </form>
      {users.length === 0 ? (
        <p className="empty">{search ? "No account matches that search." : "Nobody has created an account yet."}</p>
      ) : (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Username</th>
                <th>Full name</th>
                <th>Email</th>
                <th>PL number</th>
                <th>Joined</th>
                <th className="num">Contests</th>
                <th className="num">Submissions</th>
              </tr>
            </thead>
            <tbody>
              {users.map((user) => (
                <tr key={user.id}>
                  <td>
                    <Link href={`/admin/users/${user.id}`}>
                      <strong>{user.username}</strong>
                    </Link>
                  </td>
                  <td>{user.full_name}</td>
                  <td>{user.email}</td>
                  <td>{user.pl_number}</td>
                  <td className="nowrap muted small">{user.created_at.toISOString().slice(0, 10)}</td>
                  <td className="num">{user.contests}</td>
                  <td className="num">
                    <Link href={`/admin/submissions?user=${user.id}`}>{user.submissions}</Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </main>
  );
}
