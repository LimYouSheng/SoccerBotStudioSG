import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { campaign, distribution, overloadCampaign } from "./load-runner.mjs";
import { loadProvider } from "./load-provider.mjs";

test("load runner rejects remote targets and exposes bounded isolated campaign without execution", () => {
  const rejected = spawnSync(
    process.execPath,
    ["scripts/run-load.mjs", "--campaign", "--url=https://example.com"],
    { encoding: "utf8" },
  );
  assert.equal(rejected.status, 2);
  const plan = spawnSync(process.execPath, ["scripts/run-load.mjs", "--plan"], {
    encoding: "utf8",
  });
  assert.equal(plan.status, 0);
  const parsed = JSON.parse(plan.stdout);
  assert.equal(parsed.environment, "isolated-workerd-synthetic-providers");
  assert.deepEqual(
    [...new Set(parsed.cohorts.map((c) => c.customers))],
    [1, 3, 5, 10],
  );
  assert.ok(
    parsed.cohorts.every(
      (c) => c.deadlineMs === 120000 && c.maxProviderCalls === 2000,
    ),
  );
  assert.equal(campaign(true).length, 4);
  assert.ok(campaign().every((c) => c.admission === undefined));
  assert.deepEqual(
    overloadCampaign().map((c) => [
      c.customers,
      c.profile,
      c.admission,
      c.deadlineMs,
      c.maxProviderCalls,
    ]),
    [
      [10, "baseline", "overload", 120000, 2000],
      [10, "faults", "overload", 120000, 2000],
    ],
  );
});

test("load evidence does not report absent latency samples as zero", () => {
  assert.deepEqual(distribution([]), {
    count: 0,
    p50: null,
    p95: null,
    max: null,
  });
  assert.deepEqual(distribution([50, 10, 30, 20, 40]), {
    count: 5,
    p50: 30,
    p95: 50,
    max: 50,
  });
});

test("load provider refuses duplicate slot effects and limits synthetic dispatches", async () => {
  const provider = loadProvider({ maxCalls: 3 });
  const call = {
    url: "https://user-api.simplybook.me/",
    method: "POST",
    body: {
      id: 1,
      method: "book",
      params: [
        2,
        14,
        "2026-11-04",
        "12:10:00",
        { email: "synthetic@example.test" },
        {},
        1,
        null,
        null,
      ],
    },
  };
  assert.equal((await provider.respond(call)).status, 200);
  await assert.rejects(
    provider.respond(call),
    /Duplicate synthetic studio booking/,
  );
  assert.equal(provider.occupied.size, 1);
  await provider.respond({
    ...call,
    body: { id: 2, method: "getToken", params: [] },
  });
  await assert.rejects(provider.respond(call), /call budget exceeded/);
});
