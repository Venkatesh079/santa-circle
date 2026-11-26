import test from "node:test";
import assert from "node:assert/strict";
import { readDeployment } from "../lib/config.ts";

const production = { NODE_ENV: "production", VERCEL_ENV: "production" };
const configured = {
  NEXT_PUBLIC_SUPABASE_URL: "https://project.example.test",
  NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "sb_publishable_localFixture",
};

test("production requires persistent storage even if demo was requested", () => {
  assert.throws(() => readDeployment(production), /Set NEXT_PUBLIC/);
  assert.throws(
    () => readDeployment({ ...production, SANTA_CIRCLE_DEMO: "true" }),
    /Set NEXT_PUBLIC/,
  );
  assert.throws(
    () => readDeployment({ NODE_ENV: "production" }),
    /Set NEXT_PUBLIC/,
  );
  assert.equal(readDeployment({ ...production, ...configured }).demo, false);
});

test("development and preview allow demo, partial configuration fails", () => {
  assert.equal(readDeployment({ NODE_ENV: "development" }).demo, true);
  assert.equal(
    readDeployment({ NODE_ENV: "production", VERCEL_ENV: "preview" }).demo,
    true,
  );
  assert.equal(
    readDeployment({ NODE_ENV: "production", SANTA_CIRCLE_DEMO: "true" }).demo,
    true,
  );
  assert.throws(
    () =>
      readDeployment({
        NEXT_PUBLIC_SUPABASE_URL: configured.NEXT_PUBLIC_SUPABASE_URL,
      }),
    /Set NEXT_PUBLIC/,
  );
});

test("rejects a private key or unsafe URL before bundling", () => {
  for (const key of [
    "sb_secret_testFixture",
    "invalid",
    "a." + Buffer.from('{"role":"service_role"}').toString("base64url") + ".z",
  ]) {
    assert.throws(
      () =>
        readDeployment({
          ...production,
          ...configured,
          NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: key,
        }),
      /publishable key/,
    );
  }
  for (const url of [
    "http://project.example.test",
    "https://localhost",
    "https://user@project.example.test",
    "https://project.example.test/?token=test",
  ]) {
    assert.throws(
      () =>
        readDeployment({
          ...production,
          ...configured,
          NEXT_PUBLIC_SUPABASE_URL: url,
        }),
      /HTTPS Supabase/,
    );
  }
});
