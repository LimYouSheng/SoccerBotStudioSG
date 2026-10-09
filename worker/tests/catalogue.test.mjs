import { test } from "node:test";
import assert from "node:assert/strict";
import { build } from "esbuild";
import { readFileSync } from "node:fs";
import ts from "typescript";
const bundle = await build({
  stdin: {
    contents: `export * from './worker/catalogue'; export * from './worker/prebooking'; export * from './worker/provider-session'; export * from './worker/provider-transport';`,
    resolveDir: process.cwd(),
  },
  bundle: true,
  write: false,
  platform: "node",
  format: "esm",
});
const {
  normalizeCatalogue,
  CatalogueReads,
  NativePrebooking,
  ProviderSession,
  providerRequest,
} = await import(
  `data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString("base64")}`
);
const binding = {
  accountId: "synthetic-account",
  environmentId: "developer",
  companyLogin: "synthetic-company",
};
function fixtures() {
  return {
    services: {
      12: {
        id: 12,
        name: "Session",
        duration: "40",
        is_active: "1",
        is_public: "1",
        is_recurring: "0",
        price: "88.0000",
        currency: "SGD",
        unit_map: [14, 15, 16, 17, 18, 19],
      },
    },
    instructors: Object.fromEntries(
      [14, 15, 16, 17, 18, 19].map((id) => [
        String(id),
        { id, name: id < 16 ? "Same Name" : `Trainer ${id}`, is_active: "1" },
      ]),
    ),
  };
}
function approved() {
  return {
    accountId: binding.accountId,
    environmentId: "developer",
    customerId: "51",
    currency: "SGD",
    totalMinor: 8800,
    taxMinor: 0,
    sessions: [
      {
        serviceId: "12",
        instructorId: "14",
        players: 2,
        startMs:
          Math.floor(Date.now() / 86400000) * 86400000 +
          3 * 86400000 +
          4 * 3600000 +
          20 * 60000,
        totalMinor: 8800,
        taxMinor: 0,
      },
    ],
  };
}
function exchangeFor(data, intent = approved()) {
  const calls = [],
    wall = new Date(intent.sessions[0].startMs + 8 * 3600000).toISOString(),
    date = wall.slice(0, 10),
    time = wall.slice(11, 19);
  const bodies = {
    "catalogue-services": data.services,
    "catalogue-instructors": data.instructors,
    "required-fields": [],
    "eligible-instructors": [14],
    availability: { [date]: [time] },
  };
  let age = 0;
  return {
    calls,
    bodies,
    setAge(value) {
      age = value;
    },
    async exchange(request) {
      calls.push(request);
      return {
        body: structuredClone(bodies[request.kind]),
        receivedAtMs: Date.now() - age,
      };
    },
  };
}
test("catalogue IDs survive rename addition deactivation and duplicate display names", () => {
  const data = fixtures(),
    first = normalizeCatalogue(
      data.services,
      data.instructors,
      binding,
      Date.now(),
    );
  assert.equal(first.instructors.length, 6);
  assert.equal(first.instructors[0].name, first.instructors[1].name);
  data.instructors[14].name = "Renamed";
  data.instructors[15].is_active = "0";
  data.instructors[20] = { id: 20, name: "New Trainer", is_active: 1 };
  const next = normalizeCatalogue(
    data.services,
    data.instructors,
    binding,
    Date.now(),
  );
  assert.equal(next.instructors.length, 7);
  assert.equal(next.instructors.find((x) => x.id === "14").name, "Renamed");
  assert.equal(next.instructors.find((x) => x.id === "15").active, false);
  assert.equal(first.instructors[0].name, "Same Name");
});
test("catalogue rejects partial paginated malformed and unsupported relationship envelopes", () => {
  const data = fixtures();
  for (const services of [
    { data: data.services, next: "cursor" },
    { ...data.services, next_page: null },
    { 12: { ...data.services[12], unit_map: { 14: 40 } } },
    { 12: { ...data.services[12], price: "88.001" } },
    { 12: { ...data.services[12], is_active: "false" } },
    { 13: data.services[12] },
    { 12: { ...data.services[12], unit_map: [14, 14] } },
  ])
    assert.throws(() =>
      normalizeCatalogue(services, data.instructors, binding, Date.now()),
    );
  const large = Object.fromEntries(
    Array.from({ length: 1001 }, (_, i) => [
      String(i + 1),
      { ...data.instructors[14], id: i + 1 },
    ]),
  );
  assert.throws(() =>
    normalizeCatalogue(data.services, large, binding, Date.now()),
  );
});
test("catalogue shares bounded reads isolates account environment and protects cached objects", async () => {
  const data = fixtures(),
    read = exchangeFor(data),
    cache = new CatalogueReads();
  const [a, b] = await Promise.all([
    cache.read(binding, read.exchange),
    cache.read(binding, read.exchange),
  ]);
  assert.equal(read.calls.length, 2);
  assert.deepEqual(a, b);
  a.instructors[0].name = "Mutation";
  assert.equal(
    (await cache.read(binding, read.exchange)).instructors[0].name,
    "Same Name",
  );
  await cache.read({ ...binding, accountId: "another-account" }, read.exchange);
  await cache.read(
    { ...binding, companyLogin: "another-company" },
    read.exchange,
  );
  assert.equal(read.calls.length, 6);
  await assert.rejects(
    cache.read({ ...binding, environmentId: "production" }, read.exchange),
  );
  cache.invalidate(binding);
  await cache.read(binding, read.exchange);
  assert.equal(read.calls.length, 8);
});
test("catalogue invalidation fences delayed reads and never serves stale fallback", async () => {
  const data = fixtures(),
    cache = new CatalogueReads(),
    read = exchangeFor(data);
  let release;
  const paused = new Promise((resolve) => {
    release = resolve;
  });
  let count = 0;
  const slow = async (request) => {
    if (count++ === 0) await paused;
    return read.exchange(request);
  };
  const pending = cache.read(binding, slow);
  cache.invalidate(binding);
  release();
  await assert.rejects(pending, /catalogue_read_superseded/);
  read.setAge(15000);
  await assert.rejects(
    cache.read(binding, read.exchange),
    /provider_data_stale/,
  );
  read.setAge(-1000);
  await assert.rejects(
    cache.read(binding, read.exchange),
    /provider_data_stale/,
  );
  read.setAge(0);
  await cache.read(binding, read.exchange);
  await assert.rejects(
    cache.read(
      binding,
      async () => {
        throw Error("offline");
      },
      true,
    ),
    /offline/,
  );
  await cache.read(binding, read.exchange);
  assert.equal(
    read.calls.filter((x) => x.kind === "catalogue-services").length,
    5,
  );
});
test("prebooking refreshes current price and names without rewriting approved intent", async () => {
  const data = fixtures(),
    intent = approved(),
    before = structuredClone(intent),
    read = exchangeFor(data, intent);
  data.services[12].price = "99.50";
  data.instructors[14].name = "Renamed Trainer";
  const validation = new NativePrebooking(
    binding,
    new CatalogueReads(),
    read.exchange,
  );
  const result = await validation.review(intent);
  assert.equal(result.state, "review_required");
  assert.equal(result.review.priceMinor, 9950);
  assert.equal(result.review.instructorName, "Renamed Trainer");
  assert.equal(result.review.taxMinor, null);
  assert.deepEqual(intent, before);
  assert.deepEqual(
    read.calls.map((x) => x.kind),
    [
      "catalogue-services",
      "catalogue-instructors",
      "required-fields",
      "eligible-instructors",
      "availability",
    ],
  );
  assert.equal(read.calls.at(-1).serviceId, "12");
  assert.equal(read.calls.at(-1).instructorId, "14");
});
test("prebooking rejects unknown inactive reassigned and no longer eligible instructors", async () => {
  for (const kind of [
    "unknown",
    "inactive",
    "reassigned",
    "ineligible",
    "slot-changed",
  ]) {
    const data = fixtures(),
      intent = approved(),
      read = exchangeFor(data, intent);
    if (kind === "unknown") intent.sessions[0].instructorId = "99";
    if (kind === "inactive") data.instructors[14].is_active = 0;
    if (kind === "reassigned") data.services[12].unit_map = [15];
    if (kind === "ineligible") read.bodies["eligible-instructors"] = [];
    if (kind === "slot-changed")
      read.bodies.availability[Object.keys(read.bodies.availability)[0]] = [];
    assert.equal(
      (
        await new NativePrebooking(
          binding,
          new CatalogueReads(),
          read.exchange,
        ).review(intent)
      ).state,
      "selection_unavailable",
    );
  }
});
test("prebooking validates freshness account lead time and supported service profile", async () => {
  const intent = approved(),
    data = fixtures(),
    read = exchangeFor(data, intent),
    validation = new NativePrebooking(
      binding,
      new CatalogueReads(),
      read.exchange,
    );
  await assert.rejects(
    validation.review({ ...intent, accountId: "foreign" }),
    /native_account_mismatch/,
  );
  assert.equal(read.calls.length, 0);
  const elapsed = structuredClone(intent);
  elapsed.sessions[0].startMs = Date.now() + 3600000;
  await assert.rejects(validation.review(elapsed), /native_trial_lead_time/);
  const fractional = structuredClone(intent);
  fractional.sessions[0].startMs++;
  await assert.rejects(
    validation.review(fractional),
    /native_start_precision_unsupported/,
  );
  read.setAge(15000);
  await assert.rejects(validation.review(intent), /provider_data_stale/);
  read.setAge(0);
  for (const patch of [
    { duration: 50 },
    { is_recurring: 1 },
    { currency: "USD" },
  ]) {
    const changed = fixtures();
    Object.assign(changed.services[12], patch);
    assert.equal(
      (
        await new NativePrebooking(
          binding,
          new CatalogueReads(),
          exchangeFor(changed, intent).exchange,
        ).review(intent)
      ).reasons[0],
      "native_service_profile_unsupported",
    );
  }
  const tax = structuredClone(intent);
  tax.taxMinor = 100;
  tax.sessions[0].taxMinor = 100;
  assert.equal(
    (await validation.review(tax)).reasons[0],
    "native_service_profile_unsupported",
  );
});
test("prebooking never substitutes allocation count for missing player persistence or shared capacity", async () => {
  for (const players of [1, 2, 4]) {
    const data = fixtures(),
      intent = approved();
    intent.sessions[0].players = players;
    const read = exchangeFor(data, intent),
      validation = new NativePrebooking(
        binding,
        new CatalogueReads(),
        read.exchange,
      );
    const result = await validation.review(intent);
    assert.equal(result.state, "unavailable");
    assert.ok(result.reasons.includes("native_player_mapping_unavailable"));
    assert.ok(result.reasons.includes("native_shared_capacity_unverified"));
    assert.ok(result.reasons.includes("native_quote_tax_unavailable"));
    await assert.rejects(
      validation.revalidate(intent),
      /native_prebooking_unavailable/,
    );
    assert.ok(read.calls.every((x) => x.kind !== "book"));
    read.bodies["required-fields"] = [{ name: "unknown" }];
    assert.deepEqual((await validation.review(intent)).reasons, [
      "native_required_fields_unsupported",
    ]);
  }
});
test("prebooking treats overlapping eligibility as unassigned and rejects contradictory schedules", async () => {
  const data = fixtures(),
    intent = approved(),
    read = exchangeFor(data, intent),
    validation = new NativePrebooking(
      binding,
      new CatalogueReads(),
      read.exchange,
    );
  read.bodies["eligible-instructors"] = [15, 14];
  assert.ok(
    (await validation.review(intent)).reasons.includes(
      "native_assignment_policy_unavailable",
    ),
  );
  read.bodies["eligible-instructors"] = [99];
  await assert.rejects(
    validation.review(intent),
    /eligibility_catalogue_conflict/,
  );
  read.bodies["eligible-instructors"] = [14, 14];
  await assert.rejects(
    validation.review(intent),
    /eligibility_representation_unavailable/,
  );
  read.bodies["eligible-instructors"] = [14];
  read.bodies.availability = { "1999-01-01": ["12:20:00"] };
  await assert.rejects(
    validation.review(intent),
    /availability_representation_unavailable/,
  );
});
test("catalogue transport uses documented named calls and remains denied in closed sessions", async () => {
  const secrets = {
    company: "synthetic",
    login: "synthetic",
    publicKey: "synthetic",
    adminKey: "synthetic",
  };
  let calls = 0,
    reserved = 0;
  const original = globalThis.fetch;
  const seen = [];
  globalThis.fetch = async (_url, options) => {
    calls++;
    const body = JSON.parse(options.body);
    seen.push(body);
    return Response.json({ id: body.id, result: {}, error: null });
  };
  try {
    const control = {
      reserve: async () => String(++reserved),
      finish: () => {},
    };
    for (const request of [
      { kind: "catalogue-services" },
      { kind: "catalogue-instructors" },
      {
        kind: "eligible-instructors",
        serviceId: "12",
        date: "2026-10-12",
        time: "12:20:00",
      },
    ])
      await providerRequest(
        "native",
        secrets,
        "synthetic-token",
        control,
        request,
      );
    assert.deepEqual(
      seen.map((x) => [x.method, x.params]),
      [
        ["getEventList", [true, false]],
        ["getUnitList", [true, false]],
        ["getAvailableUnits", [12, "2026-10-12 12:20:00", 1]],
      ],
    );
    assert.equal(reserved, 3);
    await assert.rejects(
      new ProviderSession().nativeRead(
        { PROVIDER_ACCESS: "disabled", CAMPAIGN_END_MS: "0" },
        control,
        { kind: "catalogue-services" },
      ),
      /provider_access_disabled/,
    );
    assert.equal(calls, 3);
  } finally {
    globalThis.fetch = original;
  }
});

test("provider session refuses credential account changes before cached identity reuse", async () => {
  const config = ts.parseConfigFileTextToJson(
    "wrangler.jsonc",
    readFileSync("wrangler.jsonc", "utf8"),
  ).config;
  const env = {
    ...config.vars,
    SIMPLYBOOK_DEV_COMPANY_LOGIN: "synthetic-company",
    SIMPLYBOOK_DEV_ADMIN_LOGIN: "synthetic-admin",
    SIMPLYBOOK_DEV_API_KEY: "synthetic-public-key",
    SIMPLYBOOK_DEV_ADMIN_API_USER_KEY: "synthetic-admin-key",
  };
  const session = new ProviderSession();
  const control = {
    reserve: async () => {
      throw Error("outbound denied");
    },
    finish: () => {},
    claim: () => ({ generation: 1, claim: "synthetic" }),
    complete: () => true,
    pause: () => {},
  };
  session.prebooking(env, control);
  await assert.rejects(
    session.identity(
      { ...env, SIMPLYBOOK_DEV_COMPANY_LOGIN: "another-company" },
      control,
    ),
    /provider_scope_changed/,
  );
  await assert.rejects(
    session.catalogue(env, control),
    /provider_access_disabled/,
  );
});
test("catalogue cache expires and scope eviction never returns another account data", async () => {
  const cache = new CatalogueReads(),
    data = fixtures(),
    read = exchangeFor(data);
  await cache.read(binding, read.exchange);
  const original = Date.now;
  try {
    const later = original() + 60001;
    Date.now = () => later;
    await cache.read(binding, read.exchange);
  } finally {
    Date.now = original;
  }
  assert.equal(read.calls.length, 4);
  for (let i = 0; i < 9; i++)
    await cache.read({ ...binding, accountId: `scope-${i}` }, read.exchange);
  const back = await cache.read(binding, read.exchange);
  assert.equal(back.binding.accountId, binding.accountId);
  assert.equal(read.calls.length, 24);
});
