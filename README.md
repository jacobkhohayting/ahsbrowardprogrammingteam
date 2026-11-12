# AHS Contests

A small Codeforces-style contest site for a school programming team. Students make an
account, enter contests, write C++, Python or Java in the browser, and get a verdict from
hidden tests. Organizers build contests, problems and tests in a password-protected admin
area. It is made to run on Vercel's free plan.

## What it does

- **Accounts**: full name, username, school email, PL number, password. No duplicate
  emails or usernames. Students can edit their profile at any time.
- **Contests**: name, start and end time in a time zone you pick, hidden until you publish.
  Several can run at once. Students can enter any time while one is running; everyone
  shares the same end time.
- **Problems**: any number per contest, Markdown statements with math (`$a + b$`), a time
  and memory limit each, examples shown to students, hidden tests that are never sent to
  the browser.
- **Judging**: Accepted, Wrong answer, Compilation error, Runtime error, Time limit
  exceeded, Memory limit exceeded. All tests must pass; no partial credit. Extra spaces and
  trailing newlines are ignored. Unlimited submissions.
- **Leaderboards**: Short (most solves, then earliest last solve), Long (most solves, then
  penalty minutes, +10 per wrong try on solved problems) and Adaptive (points per problem
  that fall every minute). All the numbers are settings.
- **Privacy**: during a contest students see everyone's verdicts and standings but only
  their own code. After it ends, problems and standings are public, and code is public
  only if you switch that on for the contest.
- **Archive**: finished contests with their problems, and editorials and reference
  solutions if you publish them.
- **Admin area** (`/admin`, behind a secret password): create, edit, duplicate, hide,
  publish and delete contests; add, reorder and edit problems; type or upload tests and mark
  examples; try a solution against all tests; see all users, submissions and source;
  rejudge; invalidate a submission; reset a student's password; site settings.

## Put it online (GitHub + Vercel)

You need a GitHub account and a Vercel account (sign in to Vercel with GitHub). Nothing
has to be installed on your computer.

1. **Create the repository.** On GitHub press **New repository**, give it a name, keep it
   **Private** if you like, and create it without a README.
2. **Upload the files.** On the new repository page choose **uploading an existing file**.
   Open the unzipped `ahs-contests` folder, select everything *inside* it (the `app`,
   `components`, `judge`, `lib`, `scripts` and `tests` folders and the loose files)
   and drag it all onto the page. Wait until the list stops growing, then press
   **Commit changes**. `package.json` must end up at the top level of the repository, not
   inside another folder.
3. **Import into Vercel.** On vercel.com choose **Add New > Project**, pick the repository
   and press **Deploy**. Vercel detects Next.js by itself. This first deploy works, but the
   site will show a setup page because it has no database yet.
4. **Add the database.** In the Vercel project open **Storage > Create Database > Neon**
   (the free plan), choose a region near **Washington, D.C. (iad1)** and connect it to the
   project for all environments. This adds `DATABASE_URL` to the project for you.
5. **Choose the admin password.** In **Settings > Environment Variables** add
   `ADMIN_PASSWORD` with a long password only organizers know.
6. **Redeploy** so the site picks both up: **Deployments > ... on the newest one > Redeploy**.
7. **Check it.** Open `https://your-site.vercel.app/setup`. Each line should say Ready. The
   database tables are created automatically; there is no SQL to run.
8. **Prepare the judge.** Open `/admin`, enter the admin password and press
   **Prepare the judge**. This installs the compilers once (about two minutes) and tests
   all three languages. If you skip this, it happens on the first submission instead.
9. **Make a contest.** In the admin area: New contest, add problems and tests, use "Try a
   solution" on each problem, then Publish.

To change the site later, edit or upload files on GitHub; Vercel redeploys on every commit.

### Settings in Vercel

| Variable | Needed | What it is |
| --- | --- | --- |
| `DATABASE_URL` | yes | Postgres connection string. Added by the Neon integration. `POSTGRES_URL` also works. |
| `ADMIN_PASSWORD` | yes | The secret for `/admin`. Changing it signs every organizer out. |

Nothing else is required. The judge gets its permission to start sandboxes from the
identity Vercel gives every deployment, so there is no API key to copy.

## How judging works

Vercel's functions cannot compile or run programs, so the site uses
[Vercel Sandbox](https://vercel.com/docs/vercel-sandbox): short-lived Linux machines that
a deployment can start on demand.

1. **Prepare** (once): the site starts a sandbox, installs `g++` and a JDK, precompiles
   `<bits/stdc++.h>`, runs a self-test and saves the machine as a snapshot.
2. **Submit**: the submission is stored as "In queue" and the page gets its answer right
   away. The same function keeps working after the response: it starts a sandbox from the
   snapshot with networking switched off, sends the code and the tests, and runs
   `judge/runner.py` inside.
3. **Run**: the runner compiles and runs the program as a separate unprivileged user with
   CPU-time, memory, process and output limits. The tests sit in a folder only root can
   read, so a submission cannot open them. The verdict is saved and the page, which polls
   every couple of seconds, shows it.

If a function is cut off mid-judging, the submission is picked up again automatically.
Up to four submissions are judged at the same time; the rest wait in the queue.

Every language gets the same time limit by default. Admin > Settings can give Python and
Java a multiplier if you want slower languages to have more time.

## Free-plan limits worth knowing

- Vercel's free plan includes a monthly sandbox allowance. A submission uses a few seconds
  of it, so a school team is unlikely to run out, but a very large event could. The admin
  overview counts sandboxes, submissions and "Run examples" clicks for the month, and the
  **Usage** page in Vercel has the exact figures. When the allowance is used up, judging
  pauses until it resets; you are not charged.
- "Run examples" starts a sandbox each time. You can switch it off in Admin > Settings.
- A whole submission has to be judged within about four minutes. Keep
  (number of tests) x (time limit) well under that; 20 to 40 tests of 1 to 2 seconds is fine.
- One test can be about 3.5 MB at most, a problem's tests 16 MB in total.
- Neon's free database pauses when idle and wakes on the next visit, so the first page
  after a quiet period can take a second or two.
- Vercel's free plan is for non-commercial use, which a school club is.

## If something is wrong

- **The site shows a setup page**: it says which part is missing. After adding a variable
  or the database in Vercel you must redeploy.
- **"Prepare the judge" fails**: the red message under Judge on the admin overview is
  Vercel's own reason. The same text is on `/setup`.
- **A submission says "Judge error"**: open it in Admin > Submissions to see why, fix the
  cause, then press Rejudge.
- **Vercel rejects the deploy because of `maxDuration`**: turn on Fluid Compute in the
  project's Settings > Functions (it is on by default for new projects).
- **A student forgot their password**: Admin > Users > the student > set a new password.
- **You forgot the admin password**: change `ADMIN_PASSWORD` in Vercel and redeploy.

## Decisions made for you

- A new contest is hidden until you press Publish.
- Deleting a contest deletes its problems, tests and submissions. Deleting a user deletes
  their submissions. Both ask first. To keep the data, hide the contest instead.
- Invalidating a submission keeps it on record but removes it from the standings.
- Compilation errors and judge errors never count as wrong tries.
- There is no email verification and no password-reset email (that would need an email
  service). Organizers reset passwords.
- Full names are shown to logged-in members by default; emails and PL numbers only to
  organizers. Admin > Settings can change who sees names and can limit sign-ups to your
  school's email domain.

## Working on it on your own computer (optional)

You need Node.js 22 or newer, a Postgres database, and `python3`, `g++` and a JDK for the
local judge.

```
npm install
DATABASE_URL=postgres://... ADMIN_PASSWORD=something-long JUDGE_MODE=local npm run dev
```

`JUDGE_MODE=local` runs submissions on your machine instead of in a Vercel Sandbox. It is
meant for development only. For the unprivileged-user isolation it must run as root on
Linux; otherwise it still judges, without that protection.

```
npm test            # judge runner and leaderboard tests
npm run typecheck
npm run sync-runner # after editing judge/runner.py
```

## Where things are

```
app/                 pages and API routes (Next.js App Router)
  admin/             the organizer area
  api/               submit, run examples, verdict polling, judge setup
  contests/[id]/     problems, standings, status
components/          editor, workspace, tables, forms
judge/runner.py      compiles and runs one submission inside the sandbox
lib/
  schema.ts          the database tables (created automatically)
  standings.ts       the three leaderboard types
  judge/             queue, sandbox host, snapshot builder
  actions/           everything the forms do
tests/               automated tests
```
