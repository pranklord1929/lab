import Link from "next/link";

export default function NotFound() {
  return (
    <main className="ds-page">
      <div className="ds-kicker-row">
        <span className="ds-label">Error</span>
        <span className="num">404</span>
      </div>
      <h1 className="ds-title">Not in the graph</h1>
      <p className="ds-lede">This slug is unpublished or does not exist yet.</p>
      <Link href="/" className="ds-cta">
        Return home
      </Link>
    </main>
  );
}
