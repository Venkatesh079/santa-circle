import "server-only";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { store } from "./db";
import { SESSION_SECONDS } from "./store-types";
const cookieName = "santa-session";
export async function currentUser() {
  const token = (await cookies()).get(cookieName)?.value;
  return token ? (await store().session(token)) : undefined;
}
export async function requireUser() {
  const user = await currentUser();
  if (!user) redirect("/signin");
  return user;
}
export async function startSession(userId: string) {
  const jar = await cookies();
  const previous = jar.get(cookieName)?.value;
  if (previous) (await store().logout(previous));
  jar.set(cookieName, (await store().createSession(userId)), {
    httpOnly: true, sameSite: "lax", secure: process.env.NODE_ENV === "production",
    path: "/", maxAge: SESSION_SECONDS,
  });
}
export async function endSession() {
  const jar = await cookies();
  const token = jar.get(cookieName)?.value;
  if (token) (await store().logout(token));
  jar.delete(cookieName);
}
