import Link from "next/link";
export default function NotFound() {
  return (
    <div className="shell interior narrow">
      <h1>Page unavailable</h1>
      <p>Return to your dashboard to view your wishlist and draw.</p>
      <Link className="text-link" href="/dashboard">
        Go to my dashboard →
      </Link>
    </div>
  );
}
