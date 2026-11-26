import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";

test("circle lifecycle and database privacy boundaries", async (t) => {
  const db = new PGlite();
  t.after(() => db.close());
  for (const file of [
    "lib/demo-bootstrap.sql",
    "supabase/migrations/202611260001_santa_circle.sql",
    "supabase/migrations/202611260002_budget_and_membership.sql",
    "supabase/migrations/202611260003_restrict_group_creation.sql",
  ])
    await db.exec(
      await readFile(new URL("../" + file, import.meta.url), "utf8"),
    );
  const accounts = Array.from({ length: 6 }, () => randomUUID());
  for (const [i, id] of accounts.entries())
    await db.query("insert into auth.users values ($1,$2,$3,false)", [
      id,
      i === 0 ? "Venkatesh.Chappavarapu7@gmail.com" : "guest" + i + "@example.test",
      i === 5 ? null : new Date().toISOString(),
    ]);
  async function rpc(actor, op, p = {}) {
    return db.transaction(async (tx) => {
      await tx.query("select set_config('request.jwt.claim.sub',$1,true)", [
        accounts[actor],
      ]);
      await tx.exec("set local role authenticated");
      const { rows } = await tx.query(
        "select public.circle_action($1,$2) as value",
        [op, JSON.stringify(p)],
      );
      return rows[0].value;
    });
  }
  const settings = {
    name: "Friends",
    person: "Alex",
    date: "2026-12-24",
    budget: 30,
    currency: "INR",
    message: "",
  };
  await assert.rejects(rpc(1, "create", { ...settings, email: "venkatesh.chappavarapu7@gmail.com" }), /restricted to the administrator/);
  const id = await rpc(0, "create", settings);
  const { code } = await rpc(0, "view", { id });
  await t.test(
    "requires INR and a finite budget on database writes",
    async () => {
      await assert.rejects(
        rpc(0, "create", { ...settings, currency: "USD" }),
        /budget in INR/,
      );
      await assert.rejects(
        rpc(0, "settings", { ...settings, id, currency: "USD" }),
        /budget in INR/,
      );
      await assert.rejects(
        rpc(0, "settings", { ...settings, id, budget: "NaN" }),
        /valid gift budget/,
      );
      assert.equal((await rpc(0, "view", { id })).currency, "INR");
    },
  );
  await t.test(
    "restricts unverified, anonymous and unrelated accounts",
    async () => {
      await assert.rejects(rpc(5, "list"), /verify your email/);
      await assert.rejects(rpc(4, "view", { id }), /unavailable/);
      await assert.rejects(
        db.transaction(async (tx) => {
          await tx.exec("set local role anon");
          await tx.query("select public.circle_action('list','{}')");
        }),
        /permission denied/,
      );
      await assert.rejects(
        db.transaction(async (tx) => {
          await tx.exec("set local role authenticated");
          await tx.query("select * from santa_private.assignments");
        }),
        /permission denied/,
      );
    },
  );
  await t.test(
    "tracks invitations, duplicate joins and minimum group size",
    async () => {
      await rpc(0, "invite", { id, email: "Guest1@example.test" });
      assert.deepEqual((await rpc(0, "view", { id })).pending, [
        "guest1@example.test",
      ]);
      for (const i of [1, 1])
        assert.equal(await rpc(i, "join", { code, person: "Robin" }), id);
      assert.deepEqual((await rpc(0, "view", { id })).pending, []);
      await assert.rejects(rpc(0, "draw", { id }), /at least three/);
      await rpc(2, "join", { code, person: "Jamie" });
      await rpc(3, "join", { code, person: "Sam" });
      await assert.rejects(rpc(1, "draw", { id }), /Only the organizer/);
    },
  );
  const participants = await Promise.all(
    [0, 1, 2, 3].map(async (u) => (await rpc(u, "view", { id })).me),
  );
  await t.test(
    "updates settings, removes members, and respects membership revocation",
    async () => {
      await rpc(0, "settings", { ...settings, id, budget: "40.50" });
      assert.equal((await rpc(1, "view", { id })).budget, 40.5);
      await rpc(4, "join", { code, person: "Taylor" });
      const guest = await rpc(4, "view", { id });
      await rpc(0, "remove", { id, member: guest.me });
      await assert.rejects(rpc(4, "view", { id }), /unavailable/);
      await assert.rejects(
        rpc(0, "remove", { id, member: participants[0] }),
        /organizer must stay/,
      );
    },
  );
  await t.test(
    "rolls back an impossible draw and permits a corrected draw only once",
    async () => {
      for (const b of participants.slice(1))
        await rpc(0, "exclude", { id, a: participants[0], b });
      await assert.rejects(rpc(0, "draw", { id }), /no valid draw/);
      assert.equal((await rpc(0, "view", { id })).drawn, false);
      const { rows } = await db.query(
        "select count(*)::int as n from santa_private.assignments",
      );
      assert.equal(rows[0].n, 0);
      for (const b of participants.slice(2))
        await rpc(0, "allow", { id, a: participants[0], b });
      const replies = await Promise.allSettled([
        rpc(0, "draw", { id }),
        rpc(0, "draw", { id }),
      ]);
      assert.equal(replies.filter((x) => x.status === "fulfilled").length, 1);
      await assert.rejects(rpc(0, "settings", { ...settings, id }), /locked/);
      await assert.rejects(
        rpc(4, "join", { code, person: "Taylor" }),
        /already drawn/,
      );
    },
  );
  await t.test(
    "returns one private recipient, supports updated wishlists, and tracks reveals",
    async () => {
      for (let i = 0; i < 4; i++)
        await rpc(i, "wishlist", {
          id,
          ideas: [
            { title: "Gift " + i, url: "https://example.test/gift", notes: "" },
          ],
          interests: "Books",
          preferences: "",
        });
      const matches = [];
      for (let i = 0; i < 4; i++) {
        const r = await rpc(i, "reveal", { id });
        const target = Number(r.ideas[0].title.split(" ")[1]);
        matches.push(target);
        assert.notEqual(target, i);
        assert(!((i === 0 && target === 1) || (i === 1 && target === 0)));
        assert.deepEqual(Object.keys(r).sort(), [
          "ideas",
          "interests",
          "name",
          "preferences",
        ]);
        assert.deepEqual(r, await rpc(i, "reveal", { id }));
      }
      assert.equal(new Set(matches).size, 4);
      const dashboard = await rpc(0, "view", { id });
      assert(dashboard.members.every((p) => p.revealed));
      assert(!JSON.stringify(dashboard).includes("recipient"));
      const participant = await rpc(1, "view", { id });
      assert.equal(participant.code, null);
      assert.deepEqual(participant.exclusions, []);
      assert(participant.members.every((p) => p.revealed === null));
    },
  );
});
