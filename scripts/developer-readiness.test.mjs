import test from "node:test";
import assert from "node:assert/strict";
import { verifyReadiness, fingerprintRows } from "./developer-readiness.mjs";
const expected = {
  origin: "https://soccerbot.example.invalid",
  revision: "a".repeat(40),
  versionId: "12345678-1234-1234-1234-123456789012",
  mode: "trusted-reads",
  campaignEndMs: 300000,
  minimumRemainingMs: 180000,
  readinessDeadlineMs: 30000,
  maxRequests: 4,
};
function harness(change = () => ({})) {
  let time = 0,
    count = 0,
    reserved = 0;
  const retained = [];
  return {
    retained,
    count: () => count,
    reserved: () => reserved,
    io: {
      now: () => time,
      reserve: async () => {
        reserved++;
      },
      wait: async (ms) => {
        time += ms;
      },
      retain: async (r) => {
        retained.push(r);
      },
      read: async (_origin, nonce) => {
        count++;
        assert.equal(reserved, count);
        return {
          status: 200,
          health: {
            environment: "developer",
            origin: expected.origin,
            revision: expected.revision,
            versionId: expected.versionId,
            providerAccess: expected.mode,
            effectiveProviderAccess: expected.mode,
            campaignEndMs: expected.campaignEndMs,
            providerCredentialsPresent: true,
            readinessNonce: nonce,
            ...change(count),
          },
        };
      },
    },
  };
}
test("readiness requires served version configuration target and nonce before admission", async () => {
  const h = harness((count) =>
    count === 1 ? { providerAccess: "disabled" } : {},
  );
  assert.equal((await verifyReadiness(expected, h.io)).ready, true);
  assert.equal(h.count(), 2);
  assert.equal(h.retained[0].reason, "configuration_mismatch");
  for (const patch of [
    { versionId: "old" },
    { revision: "b".repeat(40) },
    { readinessNonce: "stale" },
    { effectiveProviderAccess: "disabled" },
  ]) {
    const bad = harness(() => patch);
    assert.equal((await verifyReadiness(expected, bad.io)).ready, false);
    assert.equal(bad.count(), 4);
  }
});
test("readiness stops foreign targets denials unknown transport and insufficient time", async () => {
  const foreign = harness(() => ({ origin: "https://foreign.invalid" }));
  assert.equal(
    (await verifyReadiness(expected, foreign.io)).reason,
    "target_mismatch",
  );
  assert.equal(foreign.count(), 1);
  const denied = harness();
  denied.io.read = async () => ({ status: 403 });
  assert.equal(
    (await verifyReadiness(expected, denied.io)).reason,
    "health_unavailable",
  );
  assert.equal(denied.reserved(), 1);
  const lost = harness();
  lost.io.read = async () => {
    throw new Error("lost");
  };
  assert.equal(
    (await verifyReadiness(expected, lost.io)).reason,
    "transport_unknown",
  );
  assert.equal(lost.reserved(), 1);
  const late = harness();
  assert.equal(
    (await verifyReadiness({ ...expected, campaignEndMs: 1000 }, late.io))
      .reason,
    "insufficient_window",
  );
  assert.equal(late.reserved(), 0);
});
test("preservation fingerprints ignore row key order but retain every changed column", () => {
  const rows = [
    { id: "b", checks: 0, next: 0 },
    { id: "a", checks: 0, next: 0 },
  ];
  const reordered = [
    { next: 0, checks: 0, id: "a" },
    { checks: 0, id: "b", next: 0 },
  ];
  assert.equal(fingerprintRows(rows, "id"), fingerprintRows(reordered, "id"));
  for (const changed of [
    [{ id: "b", checks: 0 }, rows[1]],
    [{ ...rows[0], checks: 1 }, rows[1]],
    [rows[0]],
  ])
    assert.notEqual(
      fingerprintRows(rows, "id"),
      fingerprintRows(changed, "id"),
    );
  assert.throws(() => fingerprintRows([rows[0], rows[0]], "id"));
});
