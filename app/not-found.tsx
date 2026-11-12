import Link from "next/link";

export default function NotFound() {
  return (
    <main>
      <h1>Page not found</h1>
      <p style={{ marginTop: "1rem" }}>
        There is nothing at this address. It may have been removed, or it may be a contest that is not published yet.
      </p>
      <p>
        <Link href="/">See the contests</Link>
      </p>
    </main>
  );
}
