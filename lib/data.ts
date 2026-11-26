import "server-only";
import { redirect } from "next/navigation";
import { demo } from "./config";
import { supabase } from "./supabase";
export class CircleError extends Error {}
export async function requireUser(next: string) {
  if (demo) return;
  const { data, error } = await (await supabase()).auth.getUser();
  if (
    error &&
    (error.status === 429 ||
      (error.status ?? 0) >= 500 ||
      error.name === "AuthRetryableFetchError")
  )
    throw new Error("The sign-in service is temporarily unavailable.");
  if (!data.user?.email_confirmed_at)
    redirect("/signin?next=" + encodeURIComponent(next));
  return data.user;
}
export async function call<T>(
  op: string,
  p: Record<string, unknown> = {},
): Promise<T> {
  try {
    if (demo) return (await (await import("./demo")).demoCall(op, p)) as T;
    const { data, error } = await (
      await supabase()
    ).rpc("circle_action", { op, p });
    if (error) throw error;
    return data as T;
  } catch (error) {
    const fault = error as { code?: string; message?: string };
    if (
      fault.code === "P0001" ||
      fault.message?.startsWith("This circle is unavailable")
    )
      throw new CircleError(fault.message);
    if (fault.code === "23505")
      throw new CircleError("This participant or invitation already exists.");
    console.error("Circle operation failed", {
      operation: op,
      code: fault.code ?? "unknown",
    });
    throw new CircleError(
      "Could not access this circle. Check your connection and database setup, then try again.",
    );
  }
}
