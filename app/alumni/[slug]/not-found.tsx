import Link from 'next/link';

export default function AlumnusNotFound() {
  return (
    <div className="container container--wide">
      <div className="empty">
        <span className="empty__emoji">🔍</span>
        <h1>We don&apos;t have that profile</h1>
        <p>
          The link may be old, or the profile may have been taken down at the person&apos;s request.
        </p>
        <p><Link href="/directory" className="link-btn">Browse all alumni</Link></p>
      </div>
    </div>
  );
}
