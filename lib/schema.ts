// Database tables. The site creates and upgrades these by itself the first time
// it connects, so there is nothing to run by hand.
//
// To change the schema later, add a NEW entry at the end of MIGRATIONS.
// Never edit an entry that has already been deployed.

export const MIGRATIONS: string[] = [
  /* 1: initial schema */ `
  create table users (
    id            serial primary key,
    username      text not null,
    email         text not null,
    full_name     text not null,
    pl_number     text not null,
    password_hash text not null,
    created_at    timestamptz not null default now()
  );
  create unique index users_username_key on users (lower(username));
  create unique index users_email_key on users (lower(email));

  -- Login sessions. Only a hash of the cookie value is stored.
  create table sessions (
    token_hash text primary key,
    kind       text not null check (kind in ('user', 'admin')),
    user_id    integer references users(id) on delete cascade,
    stamp      text,   -- admin sessions: fingerprint of the admin password they were opened with
    created_at timestamptz not null default now(),
    expires_at timestamptz not null
  );
  create index sessions_user_idx on sessions (user_id);
  create index sessions_expires_idx on sessions (expires_at);

  create table contests (
    id                serial primary key,
    name              text not null,
    description       text not null default '',
    start_at          timestamptz not null,
    end_at            timestamptz not null,
    timezone          text not null default 'America/New_York',
    visible           boolean not null default false,
    leaderboard_type  text not null default 'short'
                      check (leaderboard_type in ('short', 'long', 'adaptive')),
    penalty_per_wrong integer not null default 10,          -- long: added per rejected attempt on a solved problem
    decay_per_minute  double precision not null default 1,  -- adaptive: points a problem loses each minute
    wrong_penalty_pts double precision not null default 0,  -- adaptive: points lost per rejected attempt (optional)
    show_code_after   boolean not null default false,       -- everyone can read everyone's code once it ends
    show_editorial    boolean not null default true,        -- show editorials / solutions once it ends
    created_at        timestamptz not null default now(),
    check (end_at > start_at)
  );

  create table problems (
    id                serial primary key,
    contest_id        integer not null references contests(id) on delete cascade,
    ord               integer not null default 0,
    title             text not null,
    statement         text not null default '',
    editorial         text not null default '',
    solution_code     text not null default '',
    solution_language text not null default 'cpp',
    time_limit_ms     integer not null default 1000,
    memory_limit_mb   integer not null default 256,
    checker           text not null default 'tokens',
    points            double precision not null default 100, -- adaptive: maximum points
    tests_version     integer not null default 1,            -- bumped whenever the tests change
    created_at        timestamptz not null default now()
  );
  create index problems_contest_idx on problems (contest_id, ord, id);

  create table tests (
    id              serial primary key,
    problem_id      integer not null references problems(id) on delete cascade,
    ord             integer not null default 0,
    input           text not null default '',
    expected_output text not null default '',
    is_example      boolean not null default false
  );
  create index tests_problem_idx on tests (problem_id, ord, id);

  -- Everyone who entered a contest (they appear on its leaderboard).
  create table contest_entries (
    contest_id integer not null references contests(id) on delete cascade,
    user_id    integer not null references users(id) on delete cascade,
    entered_at timestamptz not null default now(),
    primary key (contest_id, user_id)
  );

  create table submissions (
    id               serial primary key,
    user_id          integer references users(id) on delete cascade,  -- null for admin test runs
    contest_id       integer not null references contests(id) on delete cascade,
    problem_id       integer not null references problems(id) on delete cascade,
    language         text not null,
    source           text not null,
    status           text not null default 'queued' check (status in ('queued', 'judging', 'done')),
    verdict          text,              -- AC WA CE RE TLE MLE JE
    failed_test      integer,           -- 1-based number of the first failing test
    tests_passed     integer not null default 0,
    tests_total      integer not null default 0,
    time_ms          integer,           -- slowest test (CPU time)
    memory_kb        integer,           -- highest peak memory
    compile_output   text,
    judge_log        jsonb,             -- per-test results
    message          text,              -- details of a judge error (organizers only)
    invalidated      boolean not null default false,  -- removed from standings by an organizer
    admin_test       boolean not null default false,  -- organizer test run, never shown to students
    priority         smallint not null default 0,     -- rejudges wait behind new submissions
    attempts         smallint not null default 0,
    judge_token      text,
    judge_started_at timestamptz,
    retry_at         timestamptz,       -- after a judge hiccup: do not try again before this time
    submitted_at     timestamptz not null default now(),
    judged_at        timestamptz
  );
  create index submissions_contest_idx on submissions (contest_id, id);
  create index submissions_user_idx on submissions (user_id, id);
  create index submissions_problem_idx on submissions (problem_id, id);
  create index submissions_pending_idx on submissions (priority desc, id) where status <> 'done';

  create table settings (
    key        text primary key,
    value      jsonb not null,
    updated_at timestamptz not null default now()
  );

  -- Used to slow down password guessing and submission floods.
  create table rate_events (
    bucket text not null,
    at     timestamptz not null default now()
  );
  create index rate_events_idx on rate_events (bucket, at);
  `,
];
