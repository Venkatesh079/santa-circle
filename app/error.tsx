"use client";
import { Button } from "@/components/ui/button";
export default function ErrorPage({ reset }: { reset: () => void }) {
  return (
    <div className="shell interior narrow">
      <h1>Something went wrong</h1>
      <p>We couldn’t load your circle. Check the connection and try again.</p>
      <Button onClick={reset}>Try again</Button>
    </div>
  );
}
