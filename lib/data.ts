import "server-only";
import { redirect } from "next/navigation";
import { demo } from "./config";
import { supabase } from "./supabase";
import { canCreateGroup } from "./permissions";
export class CircleError extends Error {}
export async function currentUser() {
  if (demo) return;
  const { data, error } = await (await supabase()).auth.getUser();
  if (
    error &&
    (error.status === 429 ||
      (error.status ?? 0) >= 500 ||
      error.name === "AuthRetryableFetchError")
  )
    throw new Error("The sign-in service is temporarily unavailable.");
  return data.user;
}
export async function requireUser(next: string) {
  if (demo) return;
  const user = await currentUser();
  if (!user?.email_confirmed_at)
    redirect("/signin?next=" + encodeURIComponent(next));
  return user;
}
export async function call<T>(
  op: string,
  p: Record<string, unknown> = {},
): Promise<T> {
  try {
    if ((op === "create" || op === "sample") && !canCreateGroup(await currentUser()))
      throw new CircleError("Group creation is restricted to the administrator.");
    if (demo) return (await (await import("./demo")).demoCall(op, p)) as T;
    const { data, error } = await (
      await supabase()
    ).rpc("circle_action", { op, p });
    if (error) throw error;
    return data as T;
  } catch (error) {
    if (error instanceof CircleError) throw error;
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
