import Link from 'next/link';

export default function Home() {
  return (
    <div className="container">
      <div className="card">
        <h1>Veveaham Alumni</h1>
        <p className="subtitle">
          See where our seniors are and what they are doing now — and share
          your own journey with the juniors.
        </p>
        <Link href="/register">
          <button>Register Yourself</button>
        </Link>
      </div>
    </div>
  );
}
