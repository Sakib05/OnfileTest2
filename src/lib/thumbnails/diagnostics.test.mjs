// Run: node --test src/lib/thumbnails/diagnostics.test.mjs  (Node >= 22.18)
// Uses only a fake key. No real API key is ever used here.
import test from "node:test";
import assert from "node:assert/strict";
import {
  collectDbbyteDiagnostics,
  sanitizeDbbyteMessage,
  logDbbyteConfigDiagnostics,
  logDbbyteAuthFailure,
  DBBYTE_DIAGNOSTIC_PREFIX,
} from "./diagnostics.ts";

const FAKE_KEY = "dbk_FAKEKEY1234567890abcdef";
const env = {
  VERCEL_ENV: "preview",
  VERCEL_GIT_COMMIT_REF: "main",
  VERCEL_GIT_COMMIT_SHA: "0123456789abcdef",
};
const collect = (apiKey, extra = {}) =>
  collectDbbyteDiagnostics({ apiKey, bucket: "onfile-thumbnails", env, ...extra });

test("missing key -> apiKeyPresent=false", () => {
  const d = collect(undefined);
  assert.equal(d.apiKeyPresent, false);
  assert.equal(d.apiKeyLength, 0);
  assert.equal(d.startsWithDbk, false);
});

test("valid key -> correct booleans and env fields", () => {
  const d = collect(FAKE_KEY);
  assert.equal(d.apiKeyPresent, true);
  assert.equal(d.apiKeyLength, FAKE_KEY.length);
  assert.equal(d.startsWithDbk, true);
  assert.equal(d.hasQuotes, false);
  assert.equal(d.hasWhitespace, false);
  assert.equal(d.bucketPresent, true);
  assert.equal(d.bucket, "onfile-thumbnails");
  assert.equal(d.apiHost, "api.dbbyte.com");
  assert.equal(d.vercelEnv, "preview");
  assert.equal(d.gitCommitRef, "main");
  assert.equal(d.gitCommitSha, "0123456");
});

test("leading/trailing whitespace detected", () => {
  for (const k of [` ${FAKE_KEY}`, `${FAKE_KEY}\n`, `${FAKE_KEY} `]) {
    assert.equal(collect(k).hasWhitespace, true);
  }
});

test("quote-wrapped keys detected", () => {
  assert.equal(collect(`"${FAKE_KEY}"`).hasQuotes, true);
  assert.equal(collect(`'${FAKE_KEY}'`).hasQuotes, true);
  assert.equal(collect(`"${FAKE_KEY}"`).startsWithDbk, false);
});

test("apiHost is hostname only (no credentials/query)", () => {
  const d = collect(FAKE_KEY, { apiBaseUrl: "https://user:pw@example.com:8443/p?token=abc" });
  assert.equal(d.apiHost, "example.com");
  assert.equal(collect(FAKE_KEY, { apiBaseUrl: "not a url" }).apiHost, "invalid");
});

test("diagnostic output never contains the key or any 8+ char substring", () => {
  const lines = [];
  const sink = (...a) => lines.push(a.join(" "));
  const d = collect(`"${FAKE_KEY}" `);
  logDbbyteConfigDiagnostics(d, sink);
  logDbbyteAuthFailure(
    {
      status: 401,
      message: `Invalid or revoked API key ${FAKE_KEY} Bearer ${FAKE_KEY}`,
      apiKey: FAKE_KEY,
      diagnostics: d,
    },
    sink,
  );
  const out = lines.join("\n");
  assert.ok(out.includes(DBBYTE_DIAGNOSTIC_PREFIX));
  for (let i = 0; i + 8 <= FAKE_KEY.length; i++) {
    assert.ok(!out.includes(FAKE_KEY.slice(i, i + 8)), `leaked substring at ${i}`);
  }
});

test("sanitized message redacts key (raw, trimmed, unquoted)", () => {
  assert.equal(
    sanitizeDbbyteMessage(`bad key ${FAKE_KEY}!`, FAKE_KEY),
    "bad key [REDACTED]!",
  );
  assert.ok(!sanitizeDbbyteMessage(`x ${FAKE_KEY}`, ` "${FAKE_KEY}" `).includes(FAKE_KEY));
  assert.equal(sanitizeDbbyteMessage("Authorization: Bearer abc.def", undefined), "Authorization: Bearer [REDACTED]");
  assert.equal(sanitizeDbbyteMessage(undefined, FAKE_KEY), "");
});

test("auth failure log has status, message, correlation id", () => {
  const lines = [];
  const id = logDbbyteAuthFailure(
    { status: 401, message: "Invalid or revoked API key", apiKey: FAKE_KEY, diagnostics: collect(FAKE_KEY) },
    (...a) => lines.push(a),
  );
  assert.match(id, /^onfile-dbbyte-/);
  const payload = JSON.parse(lines[0][1]);
  assert.equal(payload.httpStatus, 401);
  assert.equal(payload.correlationId, id);
  assert.equal(payload.dbbyteMessage, "Invalid or revoked API key");
});
