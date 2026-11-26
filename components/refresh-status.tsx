"use client";
import { useRouter } from "next/navigation";
import { useTransition } from "react";
import { Button } from "./ui/button";
export function RefreshStatus() {
  const router = useRouter();
  const [pending, start] = useTransition();
  return <Button variant="outline" size="sm" disabled={pending} onClick={() => start(() => router.refresh())}>{pending ? "Checking…" : "Refresh status"}</Button>;
}
