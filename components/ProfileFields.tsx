type Values = { full_name?: string; username?: string; email?: string; pl_number?: string };

/** The four profile fields shared by the sign-up, profile and admin user forms. */
export function ProfileFields({ values = {}, emailHint }: { values?: Values; emailHint?: string }) {
  return (
    <>
      <label htmlFor="full_name">Full name</label>
      <input id="full_name" name="full_name" type="text" required maxLength={100} autoComplete="name" defaultValue={values.full_name} />

      <label htmlFor="username">Username</label>
      <input
        id="username"
        name="username"
        type="text"
        required
        minLength={3}
        maxLength={24}
        pattern="[A-Za-z0-9_]+"
        autoComplete="username"
        autoCapitalize="none"
        spellCheck={false}
        defaultValue={values.username}
      />
      <p className="help">Shown on leaderboards. Letters, numbers and underscores.</p>

      <label htmlFor="email">School email</label>
      <input id="email" name="email" type="email" required maxLength={200} autoComplete="email" defaultValue={values.email} />
      {emailHint && <p className="help">{emailHint}</p>}

      <label htmlFor="pl_number">PL number</label>
      <input id="pl_number" name="pl_number" type="text" required maxLength={50} autoComplete="off" defaultValue={values.pl_number} />
    </>
  );
}
