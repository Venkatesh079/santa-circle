import test from "node:test";
import assert from "node:assert/strict";
import { canCreateGroup } from "../lib/permissions.ts";

test("only the verified named account can create groups", () => {
  const user = { email: "venkatesh.chappavarapu7@gmail.com", email_confirmed_at: "2026-11-26" };
  assert.equal(canCreateGroup(user), true);
  assert.equal(canCreateGroup({ ...user, email: user.email.toUpperCase() }), true);
  for (const denied of [undefined, null, {}, { ...user, email: "guest@example.test" }, { ...user, email_confirmed_at: undefined }, { ...user, is_anonymous: true }])
    assert.equal(canCreateGroup(denied), false);
});
