"use server";
import { z } from "zod";
import { redirect } from "next/navigation";
import { cookies, headers } from "next/headers";
import { buildPasswordResetLink } from "@/lib/reset-url";
import { store } from "@/lib/db";
import { requireUser, startSession, endSession } from "@/lib/auth";

const credentials = z.object({
  name: z.string().trim().min(1, "Enter your name.").max(80, "Use up to 80 characters for your name."),
  password: z.string().min(8, "Use at least 8 characters for your password.").refine(value => Buffer.byteLength(value) <= 72, "Passwords must be at most 72 UTF-8 bytes."),
});
const recoveryDetails = z.object({
  recoveryQuestion: z.string().min(1, "Choose a recovery question.").max(32),
  recoveryAnswer: z.string().min(2, "Enter your recovery answer (at least 2 characters).").max(72),
});
function errorMessage(error: unknown) {
  // Next.js can load the database and action in different module bundles.
  if (error instanceof Error && "code" in error && error.code === "SANTA_VALIDATION") return error.message;
  console.error("Santa action failed", error);
  return "Something went wrong. Please try again.";
}
function authenticationError(mode: "signup" | "signin", fd: FormData, message: string): never {
  const params = new URLSearchParams({ error: message });
  const name = fd.get("name");
  const question = fd.get("recoveryQuestion");
  // Preserve non-secret fields only. Passwords and recovery answers never go in URLs.
  if (typeof name === "string" && name.length <= 80) params.set("name", name);
  if (mode === "signup" && typeof question === "string" && question.length <= 32)
    params.set("recoveryQuestion", question);
  redirect((mode === "signup" ? "/signup" : "/signin") + "?" + params);
}
export async function authenticate(mode: "signup" | "signin", fd: FormData): Promise<void> {
  const parsed = credentials.safeParse(Object.fromEntries(fd));
  if (!parsed.success) authenticationError(mode, fd, parsed.error.issues[0].message);
  if (mode === "signup" && fd.get("confirmPassword") !== parsed.data.password)
    authenticationError(mode, fd, "Passwords do not match.");
  const hasRecovery = [fd.get("recoveryQuestion"), fd.get("recoveryAnswer")]
    .some(value => value !== null && (typeof value !== "string" || value.trim() !== ""));
  const recovery = mode === "signup" && hasRecovery ? recoveryDetails.safeParse(Object.fromEntries(fd)) : undefined;
  if (recovery && !recovery.success) authenticationError(mode, fd, recovery.error.issues[0].message);
  let error: string | undefined;
  try {
    // Hosted deployments must use a trusted proxy that replaces this header.
    const ip = (await headers()).get("x-forwarded-for")?.split(",")[0]?.trim() || "local";
    const { name, password } = parsed.data;
    (await store().throttle("auth-ip:" + ip, 200));
    const user = mode === "signup"
      ? await store().register(name, password, recovery?.data?.recoveryQuestion, recovery?.data?.recoveryAnswer)
      : await store().login(name, password);
    await startSession(user.id);
  } catch (cause) { error = errorMessage(cause); }
  if (error) authenticationError(mode, fd, error);
  redirect("/dashboard");
}
export async function act(op: "wishlist" | "enable" | "draw", fd: FormData): Promise<void> {
  const user = await requireUser();
  let error: string | undefined;
  try {
    if (op === "wishlist") {
      const wishlist = z.string().max(5000, "Keep your wishlist under 5,000 characters.").safeParse(fd.get("wishlist"));
      if (!wishlist.success) throw new Error("Invalid wishlist.");
      (await store().saveWishlist(user.id, wishlist.data));
    } else if (op === "enable") {
      (await store().enableDraw(user.id));
    } else if (op === "draw") {
      (await store().reveal(user.id));
    } else {
      throw new Error("Unknown action.");
    }
  } catch (cause) { error = errorMessage(cause); }
  if (error) redirect("/dashboard?error=" + encodeURIComponent(error));
  redirect(op === "draw" ? "/dashboard?reveal=1" : "/dashboard?saved=" + op);
}
export async function signOut() {
  await endSession();
  redirect("/signin");
}
export async function saveWishlist(fd: FormData): Promise<{ error?: string; wishlist?: string }> {
  const user = await requireUser();
  const parsed = z.string().max(5000, "Keep your wishlist under 5,000 characters.").safeParse(fd.get("wishlist"));
  if (!parsed.success) return { error: parsed.error.issues[0].message };
  try {
    (await store().saveWishlist(user.id, parsed.data));
    return { wishlist: parsed.data.trim() };
  } catch (cause) { return { error: errorMessage(cause) }; }
}
export async function saveWishlistAndSignOut(fd: FormData): Promise<{ error?: string }> {
  const result = await saveWishlist(fd);
  if (result.error) return { error: result.error };
  try { await endSession(); }
  catch (cause) { return { error: errorMessage(cause) }; }
  redirect("/signin");
}
export async function linkParticipant(fd: FormData) {
  const user = await requireUser();
  let error: string | undefined;
  try {
    const fields = z.object({ userId: z.uuid(), personId: z.coerce.number().int().positive() }).parse(Object.fromEntries(fd));
    (await store().linkParticipant(user.id, fields.userId, fields.personId));
  } catch (cause) { error = errorMessage(cause); }
  redirect(error ? "/dashboard?error=" + encodeURIComponent(error) : "/dashboard?saved=roster");
}
export async function addPerson(fd: FormData) {
  const user = await requireUser();
  if (fd.get("confirmed") !== "yes") redirect("/dashboard?error=" + encodeURIComponent("Confirm adding this person before continuing."));
  let error: string | undefined;
  const name = credentials.shape.name.safeParse(fd.get("name"));
  if (!name.success) redirect("/dashboard?error=" + encodeURIComponent(name.error.issues[0].message));
  try { (await store().addPerson(user.id, name.data)); }
  catch (cause) { error = errorMessage(cause); }
  redirect(error ? "/dashboard?error=" + encodeURIComponent(error) : "/dashboard?saved=person-added");
}
export async function removePerson(fd: FormData) {
  const user = await requireUser();
  if (fd.get("confirmed") !== "yes") redirect("/dashboard?error=" + encodeURIComponent("Confirm deleting this person before continuing."));
  let error: string | undefined;
  const parsed = z.object({ personId: z.coerce.number().int().positive(), name: credentials.shape.name }).safeParse(Object.fromEntries(fd));
  if (!parsed.success) redirect("/dashboard?error=" + encodeURIComponent("Select a person from the approved list."));
  try { (await store().removePerson(user.id, parsed.data.personId, parsed.data.name)); }
  catch (cause) { error = errorMessage(cause); }
  redirect(error ? "/dashboard?error=" + encodeURIComponent(error) : "/dashboard?saved=person-removed");
}
export async function prepareDrawReset(fd: FormData): Promise<{ error?: string; token?: string; expires?: number; participantCount?: number }> {
  const user = await requireUser();
  const parsed = z.object({ password: z.string().max(72), reason: z.string().trim().min(10).max(500), revision: z.coerce.number().int().nonnegative() }).safeParse(Object.fromEntries(fd));
  if (!parsed.success) return { error: "Enter your administrator password and a reason between 10 and 500 characters." };
  try {
    return await store().prepareDrawReset(user.id, {
      ...parsed.data, understood: fd.get("understood") === "yes", notified: fd.get("notified") === "yes",
      sessionToken: (await cookies()).get("santa-session")?.value || "",
    });
  } catch (cause) { return { error: errorMessage(cause) }; }
}
export async function resetDraw(fd: FormData): Promise<{ error?: string }> {
  const user = await requireUser();
  const parsed = z.object({ token: z.string().length(43), phrase: z.string().max(80) }).safeParse(Object.fromEntries(fd));
  if (!parsed.success) return { error: "Reset approval is invalid. Start again." };
  try {
    await store().resetDraw(user.id, (await cookies()).get("santa-session")?.value || "", parsed.data.token, parsed.data.phrase, fd.get("confirmed") === "yes");
  } catch (cause) { return { error: errorMessage(cause) }; }
  redirect("/dashboard?saved=draw-reset");
}
export async function resetPassword(fd: FormData) {
  const name = credentials.shape.name.safeParse(fd.get("name"));
  if (!name.success) redirect("/change-password?error=" + encodeURIComponent("Enter your full name as shown in your Aria Profile."));
  const parsed = credentials.shape.password.safeParse(fd.get("newPassword"));
  if (!parsed.success) redirect("/change-password?error=" + encodeURIComponent(parsed.error.issues[0].message));
  if (fd.get("confirmPassword") !== parsed.data)
    redirect("/change-password?error=" + encodeURIComponent("Passwords do not match."));
  const recovery = recoveryDetails.safeParse(Object.fromEntries(fd));
  if (!recovery.success) redirect("/change-password?error=" + encodeURIComponent(recovery.error.issues[0].message));
  let error: string | undefined;
  try {
    const ip = (await headers()).get("x-forwarded-for")?.split(",")[0]?.trim() || "local";
    (await store().throttle("recovery-reset-ip:" + ip));
    await store().resetPassword(name.data, recovery.data.recoveryQuestion, recovery.data.recoveryAnswer, parsed.data);
    await endSession();
  } catch (cause) { error = errorMessage(cause); }
  redirect(error ? "/change-password?error=" + encodeURIComponent(error) : "/signin?changed=1");
}
export async function generatePasswordResetLink(fd: FormData) {
  const admin = await requireUser();
  if (!admin.admin) redirect("/dashboard?error=" + encodeURIComponent("Only the administrator can generate reset links."));
  const id = z.uuid().safeParse(fd.get("userId"));
  if (!id.success) redirect("/dashboard?error=" + encodeURIComponent("Select a participant account."));
  let error: string | undefined;
  try {
    buildPasswordResetLink(""); // Validate configuration before replacing an existing link.
    const token = (await store().issuePasswordReset(admin.id, id.data));
    (await cookies()).set("santa-reset-link", token, {
      httpOnly: true, sameSite: "strict", secure: process.env.NODE_ENV === "production",
      path: "/dashboard", maxAge: 30 * 60,
    });
  } catch (cause) { error = errorMessage(cause); }
  redirect(error ? "/dashboard?error=" + encodeURIComponent(error) : "/dashboard?saved=reset-link");
}
export async function lookupPasswordResetLink(fd: FormData): Promise<{ name: string; expires: number } | { error: string }> {
  const token = fd.get("token");
  if (typeof token !== "string") return { error: "This reset link is invalid or has expired." };
  const info = (await store().resetLinkInfo(token));
  return info ?? { error: "This reset link has already been used or has expired. Ask the administrator for a new link." };
}
export async function completePasswordReset(fd: FormData) {
  const token = z.string().regex(/^[A-Za-z0-9_-]{43}$/).safeParse(fd.get("token"));
  if (!token.success) redirect("/reset-password?error=" + encodeURIComponent("This reset link is invalid or has expired."));
  const destination = (message: string) => "/reset-password?error=" + encodeURIComponent(message) + "#token=" + token.data;
  const password = credentials.shape.password.safeParse(fd.get("newPassword"));
  if (!password.success) redirect(destination(password.error.issues[0].message));
  if (password.data !== fd.get("confirmPassword")) redirect(destination("Passwords do not match."));
  let error: string | undefined;
  try {
    // The token identifies the account; any posted username or user ID is ignored.
    await store().completePasswordReset(token.data, password.data);
    await endSession();
  } catch (cause) { error = errorMessage(cause); }
  redirect(error ? destination(error) : "/signin?changed=1");
}
