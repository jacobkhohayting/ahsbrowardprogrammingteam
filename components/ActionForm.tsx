"use client";

import { useActionState, useEffect, useRef, useTransition, type FormEvent, type ReactNode } from "react";
import type { ActionState } from "@/lib/errors";

type Action = (previous: ActionState, form: FormData) => Promise<ActionState>;

type Props = {
  action: Action;
  children: ReactNode;
  className?: string;
  /** Ask "Are you sure?" with this text before sending. */
  confirm?: string;
  /** Clear the fields after a successful save (for "add another" forms). */
  resetOnSuccess?: boolean;
  /** Where the error / confirmation message goes. "errors" shows problems only (for small buttons). */
  messages?: "top" | "bottom" | "errors" | "none";
};

/**
 * A form connected to a server action. It shows the action's error or confirmation
 * message, keeps what was typed when there is an error, and disables its buttons while saving.
 */
export function ActionForm({ action, children, className, confirm, resetOnSuccess, messages = "top" }: Props) {
  const [state, formAction, pending] = useActionState(action, null);
  const [, startTransition] = useTransition();
  const ref = useRef<HTMLFormElement>(null);

  useEffect(() => {
    if (resetOnSuccess && state?.ok) ref.current?.reset();
  }, [state, resetOnSuccess]);

  function onSubmit(event: FormEvent<HTMLFormElement>) {
    if (confirm && !window.confirm(confirm)) {
      event.preventDefault();
      return;
    }
    // Send it ourselves so the browser does not wipe the fields when the action reports an error.
    event.preventDefault();
    const submitter = (event.nativeEvent as SubmitEvent).submitter as HTMLElement | null;
    const data = new FormData(event.currentTarget, submitter);
    startTransition(() => formAction(data));
  }

  const message =
    state?.error ? (
      <p className="msg error" role="alert">
        {state.error}
      </p>
    ) : state?.ok ? (
      <p className="msg ok" role="status">
        {state.ok}
      </p>
    ) : null;

  return (
    <form ref={ref} action={formAction} onSubmit={onSubmit} className={className} aria-busy={pending}>
      {messages === "top" && message}
      <fieldset disabled={pending} style={{ display: "contents" }}>
        {children}
      </fieldset>
      {messages === "bottom" && message}
      {messages === "errors" && state?.error && (
        <span className="msg error" role="alert" style={{ display: "inline-block", margin: "0 0 0 0.5rem" }}>
          {state.error}
        </span>
      )}
    </form>
  );
}
