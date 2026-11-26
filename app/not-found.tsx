import Link from "next/link";
export default function NotFound() {
  return (
    <div className="shell interior narrow">
      <h1>Circle unavailable</h1>
      <p>Check your invitation or open a group you’ve already joined.</p>
      <Link className="text-link" href="/groups">
        Go to my groups →
      </Link>
    </div>
  );
}
