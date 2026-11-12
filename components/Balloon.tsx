import Link from "next/link";

type Props = {
  /** Position of the problem in its contest: 0 for A, 1 for B, ... */
  index: number;
  label: string;
  /** Leave out to show the plain filled balloon. */
  state?: "solved" | "tried" | "open";
  href?: string;
  title?: string;
  large?: boolean;
};

const STATE_CLASS = { solved: "", tried: "is-tried", open: "is-open" } as const;

/** A problem's letter in its own color, like the balloons handed out at programming contests. */
export function Balloon({ index, label, state, href, title, large }: Props) {
  const className = ["balloon", `b${index % 12}`, state ? STATE_CLASS[state] : "", large ? "large" : ""]
    .filter(Boolean)
    .join(" ");
  if (href) {
    return (
      <Link href={href} className={className} title={title} aria-label={title ?? `Problem ${label}`}>
        {label}
      </Link>
    );
  }
  return (
    <span className={className} title={title}>
      {label}
    </span>
  );
}
