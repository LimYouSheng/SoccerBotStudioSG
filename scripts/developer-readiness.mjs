// Operator support only. Importing this module never performs remote work.
// The caller must reserve every request under a separately approved packet.
import assert from "node:assert/strict";
import { randomBytes, createHash } from "node:crypto";
import { spawn } from "node:child_process";

export const expireGrantSql =
  "UPDATE developer_operations SET expires_ms=MIN(expires_ms,?) WHERE capability_hash=? AND operation='native_field_discovery' RETURNING state,result_json,expires_ms";
export const readGrantSql =
  "SELECT state,result_json,expires_ms FROM developer_operations WHERE capability_hash=? AND operation='native_field_discovery'";

// All newly applied columns remain in the fingerprint. No deletion or default
// substitution can hide a changed recovery/checking counter.
export function fingerprintRows(rows, key) {
  assert(Array.isArray(rows));
  const normalized = rows.map((row) => {
    assert(row && typeof row === "object" && !Array.isArray(row));
    assert(Object.hasOwn(row, key));
    return Object.fromEntries(
      Object.keys(row)
        .sort()
        .map((k) => [k, row[k]]),
    );
  });
  assert.equal(new Set(normalized.map((r) => r[key])).size, rows.length);
  normalized.sort((a, b) => String(a[key]).localeCompare(String(b[key])));
  return createHash("sha256").update(JSON.stringify(normalized)).digest("hex");
}

export function assessReadiness(expected, receipt, nonce, now) {
  const h = receipt.health;
  if (receipt.status !== 200 || !h || typeof h !== "object")
    return { ready: false, reason: "health_unavailable" };
  if (h.environment !== "developer" || h.origin !== expected.origin)
    return { ready: false, reason: "target_mismatch" };
  if (h.revision !== expected.revision || h.versionId !== expected.versionId)
    return { ready: false, reason: "deployment_mismatch" };
  if (h.readinessNonce !== nonce)
    return { ready: false, reason: "response_identity_mismatch" };
  if (
    h.providerAccess !== expected.mode ||
    h.effectiveProviderAccess !== expected.mode ||
    h.campaignEndMs !== expected.campaignEndMs ||
    h.providerCredentialsPresent !== true
  )
    return { ready: false, reason: "configuration_mismatch" };
  if (
    expected.mode === "trusted-reads" &&
    expected.campaignEndMs - now < expected.minimumRemainingMs
  )
    return { ready: false, reason: "insufficient_window" };
  return { ready: true, reason: "matched" };
}

export async function verifyReadiness(expected, io) {
  assert.match(expected.revision, /^[a-f0-9]{40}$/);
  assert.match(expected.versionId, /^[a-f0-9-]{36}$/);
  assert.equal(new URL(expected.origin).origin, expected.origin);
  assert.equal(new URL(expected.origin).protocol, "https:");
  assert(["disabled", "trusted-reads"].includes(expected.mode));
  assert(Number.isSafeInteger(expected.campaignEndMs));
  assert(
    expected.mode === "disabled"
      ? expected.campaignEndMs === 0
      : Number.isSafeInteger(expected.minimumRemainingMs) &&
          expected.minimumRemainingMs >= 90000,
  );
  assert(
    Number.isInteger(expected.maxRequests) &&
      expected.maxRequests >= 1 &&
      expected.maxRequests <= 4,
  );
  assert(Number.isSafeInteger(expected.readinessDeadlineMs));
  const receipts = [];
  for (let count = 0; count < expected.maxRequests; count++) {
    const now = io.now();
    if (
      now + 5000 > expected.readinessDeadlineMs ||
      (expected.mode === "trusted-reads" &&
        now + 5000 + expected.minimumRemainingMs > expected.campaignEndMs)
    )
      return { ready: false, reason: "insufficient_window", receipts };
    const nonce = randomBytes(16).toString("hex");
    // Reservation precedes I/O; thrown/unknown transport is never retried.
    await io.reserve();
    let receipt;
    try {
      receipt = await io.read(expected.origin, nonce);
    } catch {
      const evidence = {
        checkedAtMs: io.now(),
        ready: false,
        reason: "transport_unknown",
      };
      await io.retain(evidence);
      receipts.push(evidence);
      return { ready: false, reason: "transport_unknown", receipts };
    }
    const result =
      io.now() > expected.readinessDeadlineMs
        ? { ready: false, reason: "insufficient_window" }
        : assessReadiness(expected, receipt, nonce, io.now());
    const evidence = { ...receipt, checkedAtMs: io.now(), ...result };
    await io.retain(evidence);
    receipts.push(evidence);
    if (result.ready) return { ...result, receipts };
    // Only known, valid health mismatches can consume the remaining bounded
    // readiness allowance. Denials, foreign targets and unknown transport stop.
    if (
      ![
        "deployment_mismatch",
        "configuration_mismatch",
        "response_identity_mismatch",
      ].includes(result.reason)
    )
      return { ...result, receipts };
    if (count + 1 < expected.maxRequests) await io.wait(2000);
  }
  return { ready: false, reason: "readiness_exhausted", receipts };
}

export function curlHealth(origin, nonce) {
  assert.equal(new URL(origin).origin, origin);
  assert.equal(new URL(origin).protocol, "https:");
  assert.match(nonce, /^[a-f0-9]{32}$/);
  return new Promise((resolve, reject) => {
    const child = spawn(
      "curl",
      [
        "--silent",
        "--show-error",
        "--max-time",
        "5",
        "--max-filesize",
        "16384",
        "--dump-header",
        "-",
        "--header",
        `X-Readiness-Nonce: ${nonce}`,
        "--header",
        "Cache-Control: no-cache",
        "--header",
        "Accept: application/json",
        `${origin}/api/health`,
      ],
      { shell: false },
    );
    const chunks = [];
    let size = 0,
      failed = false;
    child.stdout.on("data", (part) => {
      size += part.length;
      if (size > 32768) {
        failed = true;
        child.kill();
      } else chunks.push(part);
    });
    child.stderr.resume(); // no uncontrolled proxy/provider error body in logs
    child.on("error", () => reject(new Error("health_transport_unknown")));
    child.on("close", (code) => {
      if (failed || code !== 0)
        return reject(new Error("health_transport_unknown"));
      try {
        const raw = Buffer.concat(chunks).toString("utf8");
        // curl may include a proxy CONNECT header block; use final HTTP block.
        const blocks = raw.split(/\r?\n\r?\n/);
        const body = blocks.pop();
        const header = blocks.pop();
        const status = Number(/^HTTP\/\S+ (\d{3})/m.exec(header)?.[1]);
        assert(Number.isInteger(status) && status >= 100);
        const safeHeaders = {};
        for (const line of header.split(/\r?\n/).slice(1)) {
          const i = line.indexOf(":");
          const key = line.slice(0, i).toLowerCase();
          if (
            [
              "date",
              "cf-ray",
              "cf-cache-status",
              "age",
              "x-request-id",
              "cache-control",
            ].includes(key)
          )
            safeHeaders[key] = line
              .slice(i + 1)
              .trim()
              .slice(0, 256);
        }
        const health = JSON.parse(body);
        resolve({
          status,
          headers: safeHeaders,
          health: Object.fromEntries(
            [
              "environment",
              "providerAccess",
              "effectiveProviderAccess",
              "revision",
              "versionId",
              "origin",
              "campaignEndMs",
              "providerCredentialsPresent",
              "readinessNonce",
            ]
              .filter((k) => Object.hasOwn(health, k))
              .map((k) => [k, health[k]]),
          ),
        });
      } catch {
        reject(new Error("health_representation_invalid"));
      }
    });
  });
}
