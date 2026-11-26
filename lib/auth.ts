import "server-only";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { store } from "./db";
import { SESSION_SECONDS } from "./store";
const cookieName = "santa-session";
export async function currentUser() {
  const token = (await cookies()).get(cookieName)?.value;
  return token ? store().session(token) : undefined;
}
export async function requireUser() {
  const user = await currentUser();
  if (!user) redirect("/signin");
  return user;
}
export async function startSession(userId: string) {
  const jar = await cookies();
  const previous = jar.get(cookieName)?.value;
  if (previous) store().logout(previous);
  jar.set(cookieName, store().createSession(userId), {
    httpOnly: true, sameSite: "lax", secure: process.env.NODE_ENV === "production",
    path: "/", maxAge: SESSION_SECONDS,
  });
}
export async function endSession() {
  const jar = await cookies();
  const token = jar.get(cookieName)?.value;
  if (token) store().logout(token);
  jar.delete(cookieName);
}
