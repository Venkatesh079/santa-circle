"use server";
import { z } from "zod";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { call, CircleError } from "@/lib/data";
import { demo } from "@/lib/config";
import { supabase } from "@/lib/supabase";
import { budgetCurrency, type Result, type Recipient } from "@/lib/types";

const short = z
  .string()
  .trim()
  .min(1, "Please enter a name.")
  .max(80, "Use up to 80 characters.");
const id = z.string().uuid("This group or participant ID is invalid.");
const email = z
  .string()
  .trim()
  .toLowerCase()
  .email("Enter a valid email address.")
  .max(254);
const details = {
  name: short,
  budget: z
    .string()
    .regex(
      /^\d{1,9}(\.\d{1,2})?$/,
      "Enter a budget with up to two decimal places.",
    ),
  currency: z.literal(budgetCurrency).default(budgetCurrency),
  date: z.iso.date("Choose a valid exchange date."),
  message: z.string().trim().max(1000),
};
const url = z.union([z.literal(""), z.url({ protocol: /^https?$/ }).max(1500)]);
const idea = z.object({
  title: z.string().trim().min(1, "Add a title for every gift idea.").max(120),
  url,
  notes: z.string().max(500),
});
const schemas = {
  create: z.object({ ...details, person: short }),
  settings: z.object({ ...details, id }),
  join: z.object({
    code: z
      .string()
      .trim()
      .toUpperCase()
      .regex(
        /^[0-9A-F]{12}$/,
        "Enter the 12-character code from your invitation.",
      ),
    person: short,
    email: demo ? email : z.string().optional(),
  }),
  invite: z.object({ id, email }),
  remove: z.object({ id, member: id }),
  exclude: z.object({ id, a: id, b: id }),
  allow: z.object({ id, a: id, b: id }),
  draw: z.object({ id }),
  reveal: z.object({ id }),
  wishlist: z.object({
    id,
    interests: z.string().max(1000),
    preferences: z.string().max(1000),
    ideas: z.array(idea).max(12),
  }),
  sample: z.object({}),
};
export async function act(
  op: keyof typeof schemas,
  _prev: Result,
  fd: FormData,
): Promise<Result> {
  if (!Object.hasOwn(schemas, op) || (op === "sample" && !demo))
    return { error: "This action is unavailable." };
  let raw: Record<string, unknown> = Object.fromEntries(fd);
  if (op === "wishlist") {
    const urls = fd.getAll("url"),
      notes = fd.getAll("notes");
    raw = {
      ...raw,
      ideas: fd
        .getAll("title")
        .map((title, i) => ({ title, url: urls[i], notes: notes[i] })),
    };
  }
  const parsed = schemas[op].safeParse(raw);
  if (!parsed.success) return { error: parsed.error.issues[0].message };
  let result;
  try {
    result = await call(op, parsed.data);
  } catch (e) {
    return {
      error: e instanceof CircleError ? e.message : "Please try again.",
    };
  }
  if (op === "create" || op === "join" || op === "sample")
    redirect("/groups/" + result);
  revalidatePath("/groups/" + fd.get("id"));
  if (op === "reveal") return { recipient: result as Recipient };
  const messages: Record<string, string> = {
    wishlist: "Wishlist saved.",
    settings: "Group settings saved.",
    draw: "Names drawn! Your private gift card is ready.",
    invite: "Invitation tracked. Share the invite link with your guest.",
    remove: "Participant removed.",
    exclude: "Exclusion added.",
    allow: "Exclusion removed.",
  };
  return { success: messages[op] };
}
function destination(value: FormDataEntryValue | null) {
  const path = String(value || "");
  return /^\/(create|groups(?:\/[a-f\d-]{36})?|join(?:\?code=[a-f\d]{12})?)$/i.test(
    path,
  )
    ? path
    : "/groups";
}
type SignInResult = Result & { sentTo?: string };
export async function authenticate(
  mode: "send" | "verify",
  _prev: Result,
  data: FormData,
): Promise<SignInResult> {
  if (demo)
    return { error: "Email sign-in is available when Supabase is connected." };
  const address = email.safeParse(data.get("email"));
  if (!address.success) return { error: "Enter a valid email address." };
  const client = await supabase();
  if (mode === "send") {
    const { error } = await client.auth.signInWithOtp({ email: address.data });
    if (error?.status === 429)
      return {
        error:
          "Too many requests. Wait a minute before requesting another code.",
      };
    return error
      ? {
          error:
            "Could not send a code. Check the address and try again in a minute.",
        }
      : {
          success: "Check your email for your sign-in code.",
          sentTo: address.data,
        };
  }
  const code = String(data.get("token") || "").trim();
  if (!/^\d{6,10}$/.test(code))
    return { error: "Enter the numeric code from your email." };
  const { error } = await client.auth.verifyOtp({
    email: address.data,
    token: code,
    type: "email",
  });
  if (error)
    return {
      error:
        "That code is invalid or expired. Request a fresh code and try again.",
    };
  redirect(destination(data.get("next")));
}
export async function signOut() {
  if (!demo) {
    const { error } = await (await supabase()).auth.signOut({ scope: "local" });
    if (error) throw new Error("Sign-out failed. Try again.");
  }
  redirect("/");
}
