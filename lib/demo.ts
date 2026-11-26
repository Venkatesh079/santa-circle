import "server-only";
import { budgetCurrency } from "./types";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { PGlite, type Transaction } from "@electric-sql/pglite";
import { cookies } from "next/headers";

async function start() {
  const db = new PGlite();
  for (const file of [
    "lib/demo-bootstrap.sql",
    "supabase/migrations/202611260001_santa_circle.sql",
    "supabase/migrations/202611260002_budget_and_membership.sql",
  ]) {
    await db.exec(await readFile(join(process.cwd(), file), "utf8"));
  }
  return db;
}
const runtime = globalThis as typeof globalThis & {
  santaDemo?: Promise<PGlite>;
};
async function identify(tx: Transaction, id: string, email?: string) {
  await tx.query(
    "insert into auth.users(id,email,email_confirmed_at) values ($1,$2,now()) on conflict(id) do nothing",
    [id, email || "guest-" + id.slice(0, 8) + "@example.test"],
  );
  await tx.query("select set_config('request.jwt.claim.sub',$1,true)", [id]);
}
async function run(tx: Transaction, op: string, p: Record<string, unknown>) {
  const res = await tx.query<{ value: unknown }>(
    "select public.circle_action($1,$2) as value",
    [op, JSON.stringify(p)],
  );
  return res.rows[0].value;
}
async function sample(tx: Transaction, account: string) {
  const previous = await tx.query<{ circle: string }>(
    "select circle from demo_samples where account=$1",
    [account],
  );
  if (previous.rows[0]) return previous.rows[0].circle;
  const today = new Date();
  const year =
    today.getUTCFullYear() +
    (today.getUTCMonth() === 11 && today.getUTCDate() > 24 ? 1 : 0);
  const id = await run(tx, "create", {
    name: "The Fireside Friends",
    person: "Alex",
    budget: 35,
    currency: budgetCurrency,
    date: year + "-12-24",
    message: "Bring your wrapped gift to our holiday dinner.",
  });
  const group = (await run(tx, "view", { id })) as { code: string };
  for (const [name, title, interests] of [
    ["Robin", "A cozy mystery novel", "Bookshops and rainy afternoons"],
    ["Jamie", "A travel coffee mug", "Coffee and ceramics"],
    ["Sam", "A pocket sketchbook", "Drawing and hiking"],
  ]) {
    await identify(tx, randomUUID());
    await run(tx, "join", { code: group.code, person: name });
    await run(tx, "wishlist", {
      id,
      ideas: [{ title, url: "", notes: "Something small to enjoy every day." }],
      interests,
      preferences: "Secondhand gifts are welcome.",
    });
  }
  await identify(tx, account);
  await run(tx, "invite", { id, email: "taylor@example.test" });
  await tx.query("insert into demo_samples values($1,$2)", [account, id]);
  return id;
}
export async function demoCall(op: string, p: Record<string, unknown>) {
  const jar = await cookies();
  let account = jar.get("sc-demo")?.value;
  if (
    !account ||
    !/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/.test(account)
  ) {
    if (op === "list") return [];
    if (op === "view")
      throw new Error("This circle is unavailable in this demo session.");
    account = randomUUID();
    jar.set("sc-demo", account, {
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production" && !!process.env.VERCEL,
      path: "/",
      maxAge: 86400,
    });
  }
  const actor = account;
  const db = await (runtime.santaDemo ??= start().catch((error) => {
    delete runtime.santaDemo;
    throw error;
  }));
  return db.transaction(async (tx) => {
    await identify(
      tx,
      actor,
      typeof p.email === "string" ? p.email : undefined,
    );
    return op === "sample" ? sample(tx, actor) : run(tx, op, p);
  });
}
