/** An error whose message is safe and useful to show to the person using the site. */
export class UserError extends Error {
  status: number;
  constructor(message: string, status = 400) {
    super(message);
    this.name = "UserError";
    this.status = status;
  }
}

/** What a form action reports back to the page. */
export type ActionState = { error?: string; ok?: string } | null;
