import { DatabaseSync } from "node:sqlite";
import { test } from "node:test";
import assert from "node:assert/strict";
import { build } from "esbuild";
import { readFileSync } from "node:fs";
import ts from "typescript";
const bundle = await build({
  stdin: {
    contents: `export * from './worker/provider-token-cache'; export * from './worker/display-snapshots'; export * from './worker/parallel-reads'; export * from './worker/customer-catalogue'; export * from './worker/public-calendar'; export * from './worker/native-calendar'; export * from './worker/catalogue'; export * from './worker/prebooking'; export * from './worker/provider-session'; export * from './worker/provider-transport';`,
    resolveDir: process.cwd(),
  },
  bundle: true,
  write: false,
  platform: "node",
  format: "esm",
});
const {
  ProviderTokenCache,
  DisplaySnapshots,
  parallelReads,
  customerCatalogue,
  publicCalendar,
  windowCatalogue,
  windowCalendar,
  windowAvailability,
  NativeCalendarReads,
  calendarRanges,
  calendarDates,
  normalizeCatalogue,
  CatalogueReads,
  NativePrebooking,
  nativeBookingComment,
  nativeTrialLeadMs,
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
  await assert.rejects(
    cache.read(binding, read.exchange, false, false, true),
    /display_cache_miss/,
  );
  assert.equal(read.calls.length, 0);
  const [a, b] = await Promise.all([
    cache.read(binding, read.exchange),
    cache.read(binding, read.exchange),
  ]);
  assert.equal(read.calls.length, 2);
  assert.deepEqual(a, b);
  assert.deepEqual(
    await cache.read(binding, read.exchange, false, false, true),
    b,
  );
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
test("catalogue overlaps independent reads and waits for both before caching", async () => {
  const cache = new CatalogueReads(),
    read = exchangeFor(fixtures());
  const gates = new Map();
  const started = [];
  let draining = false;
  const exchange = async (request) => {
    started.push(request.kind);
    if (!draining)
      await new Promise((resolve) => gates.set(request.kind, resolve));
    return read.exchange(request);
  };
  const pending = cache.read(binding, exchange, false, true);
  const shared = cache.read(binding, exchange, false, true);
  try {
    assert.deepEqual(started, ["catalogue-services", "catalogue-instructors"]);
    await assert.rejects(
      cache.read(binding, exchange, false, true, true),
      /display_cache_miss/,
    );
    gates.get("catalogue-instructors")();
    await new Promise(setImmediate);
    assert.equal(read.calls.length, 1);
    gates.get("catalogue-services")();
    assert.deepEqual(await pending, await shared);
    await cache.read(binding, exchange, false, true);
    assert.equal(started.length, 2);
  } finally {
    draining = true;
    for (const release of gates.values()) release();
    await Promise.allSettled([pending, shared]);
  }
});
test("catalogue drains a failed read sibling and does not cache partial success", async () => {
  for (const failed of ["catalogue-services", "catalogue-instructors"]) {
    const cache = new CatalogueReads(),
      read = exchangeFor(fixtures());
    let release;
    const gate = new Promise((resolve) => {
      release = resolve;
    });
    let settled = false;
    const pending = cache.read(
      binding,
      async (request) => {
        if (request.kind === failed)
          throw new Error("synthetic catalogue failure");
        await gate;
        return read.exchange(request);
      },
      false,
      true,
    );
    const outcome = pending.then(
      () => {
        settled = true;
      },
      () => {
        settled = true;
      },
    );
    try {
      await new Promise(setImmediate);
      assert.equal(settled, false);
    } finally {
      release();
    }
    await assert.rejects(pending, /synthetic catalogue failure/);
    await outcome;
    const before = read.calls.length;
    await cache.read(binding, read.exchange);
    assert.equal(read.calls.length - before, 2);
  }
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
  assert.equal(result.state, "restart_required");
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
  await assert.rejects(
    validation.revalidate(intent),
    /native_restart_required/,
  );
  assert.deepEqual(intent, before);
  assert.ok(read.calls.every((x) => x.kind !== "book"));
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
test("prebooking derives automatic non-blocking player comments independently of studio capacity", async () => {
  for (const players of [1, 2, 3, 4]) {
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
    assert.equal(result.review.players, players);
    assert.equal(result.review.bookingComment, `Number of players: ${players}`);
    assert.ok(!result.reasons.includes("native_booking_comment_unavailable"));
    assert.ok(!result.reasons.includes("native_player_mapping_unavailable"));
    assert.ok(
      !result.reasons.includes("native_player_information_unavailable"),
    );
    assert.ok(result.reasons.includes("native_customer_binding_unavailable"));
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
test("native comments bind optional school to the approved contact and reject injected lines", async () => {
  const intent = approved();
  intent.contact = {
    name: "Synthetic Guest",
    email: "guest@example.invalid",
    phone: "00000000",
    contactMethod: "email",
    academy: "Synthetic School",
  };
  for (const players of [1, 2, 3, 4]) {
    intent.sessions[0].players = players;
    assert.equal(
      nativeBookingComment(intent, 0),
      `Number of players: ${players}\nSchool / organisation: Synthetic School\nPreferred communication: Email`,
    );
  }
  intent.contact.academy = "";
  for (const [method, label] of [
    ["email", "Email"],
    ["phone", "Call"],
    ["sms", "SMS"],
    ["whatsapp", "WhatsApp"],
  ]) {
    intent.contact.contactMethod = method;
    assert.equal(
      nativeBookingComment(intent, 0),
      `Number of players: 4\nPreferred communication: ${label}`,
    );
  }
  intent.contact.contactMethod = "email\nNumber of players: 99";
  assert.throws(() => nativeBookingComment(intent, 0));
  intent.contact.contactMethod = "email";
  for (const school of [
    " School ",
    "School\nNumber of players: 99",
    "x".repeat(121),
  ]) {
    intent.contact.academy = school;
    assert.throws(() => nativeBookingComment(intent, 0));
  }
  intent.contact.academy = "";
  assert.throws(
    () => nativeBookingComment(intent, -1),
    /native_session_missing/,
  );
  assert.throws(
    () => nativeBookingComment(intent, 1),
    /native_session_missing/,
  );
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
      "native_provider_schedule_overlap",
    ),
  );
  assert.ok(
    read.calls.every((x) => x.kind !== "availability" && x.kind !== "book"),
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

test("ended provider transports release capacity without replaying uncertain writes", async () => {
  const original = globalThis.fetch;
  const secrets = {
    company: "synthetic",
    login: "synthetic",
    publicKey: "synthetic",
    adminKey: "synthetic",
  };
  const safe = [
    ...[
      "public-auth",
      "admin-auth",
      "identity",
      "tariff",
      "historical-booking",
      "historical-invoice",
    ].map((operation) => [operation, undefined]),
    ...[
      { kind: "catalogue-services" },
      { kind: "catalogue-instructors" },
      { kind: "booking-read", bookingId: "701", signature: "a".repeat(32) },
      { kind: "invoice-read", invoiceId: "901" },
      { kind: "webhook-subscriptions" },
      { kind: "required-fields", serviceId: "12" },
      {
        kind: "availability",
        serviceId: "12",
        instructorId: "14",
        date: "2026-10-16",
      },
      {
        kind: "availability-range",
        serviceId: "12",
        instructorId: "14",
        from: "2026-10-16",
        to: "2026-10-17",
      },
      {
        kind: "working-hours",
        serviceId: "12",
        instructorId: "14",
        from: "2026-10-16",
        to: "2026-10-17",
      },
      {
        kind: "eligible-instructors",
        serviceId: "12",
        date: "2026-10-16",
        time: "09:00:00",
      },
    ].map((native) => ["native", native]),
  ];
  const unsafe = [
    { kind: "batch-create" },
    { kind: "batch-close", batchId: "701", signature: "a".repeat(32) },
    {
      kind: "book",
      serviceId: "12",
      instructorId: "14",
      date: "2026-10-16",
      time: "09:00:00",
      client: {
        name: "Synthetic",
        email: "customer@example.invalid",
        phone: "+6581234567",
      },
      additional: { handle_invoice: true },
    },
    { kind: "payment-link", invoiceId: "901" },
    {
      kind: "booking-cancel",
      bookingId: "701",
      signature: "a".repeat(32),
      evidenceObservedAtMs: Date.now(),
    },
    {
      kind: "webhook-create",
      origin: "https://soccerbot-dev.limyousheng-94.workers.dev",
      event: "new_invoice",
    },
    { kind: "webhook-delete", subscriptionId: "1" },
  ].map((native) => ["native", native]);
  try {
    for (const partialBody of [false, true])
      for (const [expected, operations] of [
        [true, safe],
        [false, unsafe],
      ])
        for (const [operation, native] of operations) {
          let dispatched = 0,
            reserved = 0;
          const finished = [];
          globalThis.fetch = async () => {
            dispatched++;
            if (!partialBody)
              throw new DOMException(
                "Synthetic aborted transport",
                "AbortError",
              );
            return new Response(
              new ReadableStream({
                start(controller) {
                  controller.error(new Error("Synthetic interrupted body"));
                },
              }),
              { headers: { "Content-Type": "application/json" } },
            );
          };
          await assert.rejects(
            providerRequest(
              operation,
              secrets,
              "synthetic-token",
              {
                reserve: async () => String(++reserved),
                finish: (...args) => finished.push(args),
              },
              native,
            ),
            /provider_transport_uncertain/,
          );
          assert.equal(reserved, 1);
          assert.equal(dispatched, 1);
          assert.deepEqual(
            finished,
            [
              [
                "1",
                60000,
                expected ? "read_transport_ended" : "write_transport_ended",
              ],
            ],
            JSON.stringify({ operation, native, partialBody }),
          );
        }
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

test("prebooking accepts scoped owner declarations for fresh booking contact and rejects stale or foreign settings", async () => {
  const intent = approved();
  intent.customerMode = "booking-contact";
  intent.customerId = "synthetic-local-subject";
  intent.contact = {
    name: "Synthetic Guest",
    email: "guest@example.invalid",
    phone: "00000000",
    contactMethod: "email",
    academy: "",
  };
  const contract = {
    ...binding,
    serviceId: "12",
    priceMinor: 8800,
    currency: "SGD",
    taxMinor: 0,
    durationMinutes: 40,
    bufferAfterMinutes: 10,
    clientLoginRequired: false,
    providerSchedules: "non-overlapping",
    confirmedAtMs: Date.now() - 1000,
    expiresAtMs: Date.now() + 600000,
  };
  const read = exchangeFor(fixtures(), intent);
  const validation = new NativePrebooking(
    binding,
    new CatalogueReads(),
    read.exchange,
    contract,
  );
  assert.equal((await validation.review(intent)).state, "ready");
  assert.deepEqual(await validation.revalidate(intent), intent);
  for (const change of [
    { accountId: "foreign" },
    { companyLogin: "foreign" },
    { serviceId: "13" },
    { expiresAtMs: Date.now() - 1 },
    { confirmedAtMs: Date.now() + 100000 },
    { taxMinor: 1 },
    { bufferAfterMinutes: 0 },
    { clientLoginRequired: true },
  ]) {
    await assert.rejects(
      new NativePrebooking(binding, new CatalogueReads(), read.exchange, {
        ...contract,
        ...change,
      }).revalidate(intent),
    );
  }
  read.bodies["eligible-instructors"] = [14, 15];
  await assert.rejects(
    validation.revalidate(intent),
    /native_prebooking_unavailable/,
  );
  read.bodies["eligible-instructors"] = [14];
  read.bodies["catalogue-services"][12].price = "99";
  await assert.rejects(
    validation.revalidate(intent),
    /native_restart_required/,
  );
  assert.ok(read.calls.every((request) => request.kind !== "book"));
});

test("owner date-scoped trial lead exception preserves default account instructor and time fences", async (t) => {
  t.mock.timers.enable({
    apis: ["Date"],
    now: Date.parse("2026-10-12T23:40:00+08:00"),
  });
  const intent = approved();
  intent.sessions[0] = {
    ...intent.sessions[0],
    serviceId: "2",
    instructorId: "3",
    startMs: Date.parse("2026-10-14T09:00:00+08:00"),
  };
  intent.customerMode = "booking-contact";
  intent.contact = {
    name: "Synthetic Guest",
    email: "guest@example.invalid",
    phone: "00000000",
    contactMethod: "email",
    academy: "",
  };
  const contract = {
    ...binding,
    serviceId: "2",
    priceMinor: 8800,
    currency: "SGD",
    taxMinor: 0,
    durationMinutes: 40,
    bufferAfterMinutes: 10,
    clientLoginRequired: false,
    providerSchedules: "non-overlapping",
    confirmedAtMs: Date.now() - 1000,
    expiresAtMs: Date.now() + 600000,
    trialLeadTimeException: "owner-2026-10-14-15",
  };
  const data = fixtures();
  data.services = { 2: { ...data.services[12], id: 2, unit_map: [3] } };
  data.instructors = { 3: { id: 3, name: "Synthetic Trainer", is_active: 1 } };
  const read = exchangeFor(data, intent);
  read.bodies["eligible-instructors"] = [3];
  const normal = { ...contract };
  delete normal.trialLeadTimeException;
  await assert.rejects(
    new NativePrebooking(
      binding,
      new CatalogueReads(),
      read.exchange,
      normal,
    ).review(intent),
    /native_trial_lead_time/,
  );
  assert.equal(read.calls.length, 0);
  const validator = new NativePrebooking(
    binding,
    new CatalogueReads(),
    read.exchange,
    contract,
  );
  assert.equal((await validator.review(intent)).state, "ready");
  assert.deepEqual(await validator.revalidate(intent), intent);
  assert.equal(
    nativeTrialLeadMs(contract, binding, intent.sessions[0], Date.now()),
    86400000,
  );
  for (const patch of [
    { accountId: "foreign" },
    { companyLogin: "foreign" },
    { environmentId: "production" },
    { serviceId: "99" },
    { confirmedAtMs: Date.now() + 1 },
    { expiresAtMs: Date.now() },
    { expiresAtMs: Date.parse("2026-10-15T00:00:00+08:00") },
    { trialLeadTimeException: "caller-selected" },
  ])
    assert.equal(
      nativeTrialLeadMs(
        { ...contract, ...patch },
        binding,
        intent.sessions[0],
        Date.now(),
      ),
      172800000,
    );
  for (const patch of [
    { serviceId: "99" },
    { instructorId: "2" },
    { startMs: Date.parse("2026-10-16T09:00:00+08:00") },
  ])
    assert.equal(
      nativeTrialLeadMs(
        contract,
        binding,
        { ...intent.sessions[0], ...patch },
        Date.now(),
      ),
      172800000,
    );
  assert.ok(read.calls.every((x) => x.kind !== "book"));
});
test("owner trial exception rechecks twenty-four-hour minimum and contract expiry after provider reads", async (t) => {
  t.mock.timers.enable({
    apis: ["Date"],
    now: Date.parse("2026-10-13T08:59:59+08:00"),
  });
  for (const expiredContract of [false, true]) {
    const intent = approved();
    intent.sessions[0] = {
      ...intent.sessions[0],
      serviceId: "2",
      instructorId: "3",
      startMs: Date.parse(
        expiredContract
          ? "2026-10-14T10:00:00+08:00"
          : "2026-10-14T09:00:00+08:00",
      ),
    };
    const contract = {
      ...binding,
      serviceId: "2",
      priceMinor: 8800,
      currency: "SGD",
      taxMinor: 0,
      durationMinutes: 40,
      bufferAfterMinutes: 10,
      clientLoginRequired: false,
      providerSchedules: "non-overlapping",
      confirmedAtMs: Date.now() - 1000,
      expiresAtMs: Date.now() + (expiredContract ? 1000 : 600000),
      trialLeadTimeException: "owner-2026-10-14-15",
    };
    const data = fixtures();
    data.services = { 2: { ...data.services[12], id: 2, unit_map: [3] } };
    data.instructors = {
      3: { id: 3, name: "Synthetic Trainer", is_active: 1 },
    };
    const read = exchangeFor(data, intent);
    read.bodies["eligible-instructors"] = [3];
    const validator = new NativePrebooking(
      binding,
      new CatalogueReads(),
      async (operation) => {
        if (operation.kind === "availability") t.mock.timers.tick(2000);
        return read.exchange(operation);
      },
      contract,
    );
    await assert.rejects(validator.review(intent), /native_trial_lead_time/);
    assert.equal(read.calls.length, 5);
  }
});

function calendarFixture() {
  const data = fixtures();
  data.services[12].unit_map = [14];
  return normalizeCatalogue(
    data.services,
    data.instructors,
    binding,
    Date.now(),
  );
}
function monthFixture() {
  const dates = Array.from(
    { length: 31 },
    (_, i) => `2027-01-${String(i + 1).padStart(2, "0")}`,
  );
  const calls = [];
  const input = {
    scope: JSON.stringify(binding),
    serviceId: "12",
    month: "2027-01",
    dates,
    catalogue: async () => calendarFixture(),
    exchange: async (request) => {
      calls.push(request);
      return {
        receivedAtMs: Date.now(),
        body: Object.fromEntries(
          dates
            .filter((d) => d >= request.from && d <= request.to)
            .map((d) => [d, d.endsWith("-02") ? [] : ["09:00:00"]]),
        ),
      };
    },
  };
  return { input, calls };
}
test("calendar range cache batches a month shares reads and preserves explicit empty versus unknown days", async () => {
  const { input, calls } = monthFixture();
  const cache = new NativeCalendarReads();
  await assert.rejects(
    cache.read({ ...input, cacheOnly: true }),
    /display_cache_miss/,
  );
  assert.equal(calls.length, 0);
  const [first, second] = await Promise.all([
    cache.read(input),
    cache.read(input),
  ]);
  assert.equal(calls.length, 3);
  assert.equal(first.dates.length, 31);
  assert.equal(first.dates[1].offers.length, 0);
  assert.deepEqual(first, second);
  assert.deepEqual(await cache.read({ ...input, cacheOnly: true }), second);
  first.dates[0].offers.length = 0;
  assert.equal((await cache.read(input)).dates[0].offers.length, 1);
  assert.equal(calls.length, 3);
  const unknown = await new NativeCalendarReads().read({
    ...input,
    exchange: async (request) => {
      const response = await input.exchange(request);
      delete response.body["2027-01-03"];
      return response;
    },
  });
  assert.equal(
    unknown.dates.some((d) => d.date === "2027-01-03"),
    false,
  );
  // A positive offer establishes display availability even when another
  // instructor's omitted date is unknown. Empty still requires every reply.
  const mixed = await new NativeCalendarReads().read({
    ...input,
    catalogue: async () => {
      const value = calendarFixture();
      value.services[0].instructorIds = ["14", "15"];
      return value;
    },
    exchange: async (request) =>
      request.instructorId === "14"
        ? { receivedAtMs: Date.now(), body: {} }
        : input.exchange(request),
  });
  assert.equal(
    mixed.dates.find((day) => day.date === "2027-01-01").offers.length,
    1,
  );
  assert.equal(
    mixed.dates.some((day) => day.date === "2027-01-02"),
    false,
  );
});
test("calendar cache isolates scope and invalidates changed dates without stale fallback", async () => {
  const { input, calls } = monthFixture();
  const cache = new NativeCalendarReads();
  await cache.read(input);
  await cache.read({ ...input, scope: "another-account" });
  assert.equal(calls.length, 6);
  cache.invalidateDate("2027-02-01");
  await cache.read(input);
  assert.equal(calls.length, 6);
  cache.invalidateDate("2027-01-01");
  await assert.rejects(
    cache.read({ ...input, cacheOnly: true }),
    /display_cache_miss/,
  );
  await assert.rejects(
    cache.read({
      ...input,
      exchange: async () => {
        throw new Error("offline");
      },
    }),
    /offline/,
  );
  const next = await cache.read(input);
  assert.equal(next.dates.length, 31);
  assert.equal(calls.length, 9);
  const now = Date.now;
  const expiredAt = next.observedAtMs + 60001;
  Date.now = () => expiredAt;
  try {
    await assert.rejects(
      cache.read({ ...input, cacheOnly: true }),
      /display_cache_miss/,
    );
    await assert.rejects(
      cache.read({
        ...input,
        exchange: async () => {
          throw new Error("expired");
        },
      }),
      /expired/,
    );
  } finally {
    Date.now = now;
  }
});
test("calendar ranges never bridge unauthorized gaps and reject conflicting or foreign provider data", async () => {
  assert.deepEqual(
    calendarDates("2027-01", ["2027-01-03", "2027-02-01", "2027-01-01"]),
    ["2027-01-01", "2027-01-03"],
  );
  assert.equal(calendarRanges(["2027-01-01", "2027-01-03"]).length, 2);
  assert.throws(() => calendarRanges(["2027-02-30"]), /calendar_date_invalid/);
  const { input } = monthFixture();
  await assert.rejects(
    new NativeCalendarReads().read({
      ...input,
      exchange: async () => ({
        receivedAtMs: Date.now(),
        body: { "2027-02-01": [] },
      }),
    }),
    /calendar_representation_unavailable/,
  );
  await assert.rejects(
    new NativeCalendarReads().read({
      ...input,
      catalogue: async () => {
        const value = calendarFixture();
        value.services[0].instructorIds = ["14", "15"];
        return value;
      },
    }),
    /native_provider_schedule_overlap/,
  );
});
test("calendar invalidation fences an in-flight stale response", async () => {
  const { input } = monthFixture();
  let release;
  const pendingRead = new Promise((resolve) => {
    release = resolve;
  });
  const cache = new NativeCalendarReads();
  const pending = cache.read({
    ...input,
    catalogue: async () => {
      await pendingRead;
      return calendarFixture();
    },
  });
  cache.invalidateDate("2027-01-01");
  release();
  await assert.rejects(pending, /calendar_read_superseded/);
});

test("anonymous calendar is bounded and shared without exposing provider slots or customer data", async () => {
  const config = ts.parseConfigFileTextToJson(
    "wrangler.jsonc",
    readFileSync("wrangler.jsonc", "utf8"),
  ).config;
  const date = new Date(Date.now() + 4 * 86400000).toISOString().slice(0, 10),
    month = date.slice(0, 7);
  const source = "a".repeat(40),
    start = Date.now();
  const window = {
    sourceRevision: source,
    serviceId: "12",
    dates: [date],
    notBeforeMs: start,
    expiresMs: start + 600000,
    startingUsed: 0,
    maximumUsed: 2,
  };
  const env = {
    ...config.vars,
    SOURCE_REVISION: source,
    PROVIDER_ACCESS: "trusted-reads",
    CAMPAIGN_END_MS: String(start + 600000),
    PUBLIC_CALENDAR_WINDOW_JSON: JSON.stringify(window),
    SIMPLYBOOK_DEV_COMPANY_LOGIN: "synthetic-company",
    SIMPLYBOOK_DEV_ADMIN_LOGIN: "synthetic-admin",
    SIMPLYBOOK_DEV_API_KEY: "synthetic-key",
    SIMPLYBOOK_DEV_ADMIN_API_USER_KEY: "synthetic-key",
  };
  let calls = 0;
  const input = {
    env,
    month,
    cache: new NativeCalendarReads(),
    accounting: () => ({ used: calls, active: 0 }),
    control: {
      reserve: async () => {
        calls++;
        return "test";
      },
    },
    provider: {
      identity: async () => {},
      catalogue: async () => calendarFixture(),
      nativeRead: async (_env, control, request) => {
        await control.reserve();
        assert.equal(request.from, date);
        assert.equal(request.to, date);
        return { receivedAtMs: Date.now(), body: { [date]: ["09:00:00"] } };
      },
    },
  };
  await assert.rejects(
    publicCalendar({ ...input, cacheOnly: true }),
    /display_cache_miss/,
  );
  assert.equal(calls, 0);
  const first = await publicCalendar(input);
  assert.deepEqual(first.dates, [{ date, available: true }]);
  assert.deepEqual(Object.keys(first).sort(), [
    "dates",
    "month",
    "observedAtMs",
    "serviceId",
  ]);
  assert.equal(calls, 1);
  assert.deepEqual(await publicCalendar({ ...input, cacheOnly: true }), first);
  assert.equal(calls, 1);
  const catalogue = await windowCatalogue(input);
  assert.deepEqual(
    catalogue.services.map((service) => service.id),
    ["12"],
  );
  assert.equal("binding" in catalogue, false);
  const visitor = new Request("https://synthetic.example/api/catalogue");
  const publicEnv = {
    ...env,
    LIVE_CUSTOMER_ACCESS: "enabled",
    COORDINATOR: {
      getByName: () => ({
        windowCatalogue: async () => ({ ok: true, value: catalogue }),
      }),
    },
  };
  assert.deepEqual(
    await customerCatalogue(visitor, publicEnv, Date.now()),
    catalogue,
  );
  await assert.rejects(
    customerCatalogue(
      visitor,
      { ...publicEnv, LIVE_CUSTOMER_ACCESS: "disabled" },
      Date.now(),
    ),
  );
  const privateEnv = {
    ...publicEnv,
    COORDINATOR: {
      getByName: () => ({
        windowCatalogue: async () => ({
          ok: true,
          value: { ...catalogue, customer: "private" },
        }),
      }),
    },
  };
  await assert.rejects(customerCatalogue(visitor, privateEnv, Date.now()));
  const protectedMonth = await windowCalendar({ ...input, serviceId: "12" });
  assert.equal(protectedMonth.dates[0].offers.length, 1);
  assert.equal(
    calls,
    1,
    "homepage and protected calendar reuse the same range cache",
  );
  await windowAvailability({ ...input, serviceId: "12", date });
  assert.equal(calls, 1);
  for (const request of [
    { ...input, serviceId: "99", date },
    { ...input, serviceId: "12", date: "2099-01-01" },
  ])
    await assert.rejects(
      windowAvailability(request),
      /scope_unavailable|month_invalid/,
    );
  input.cache.invalidateDate(date);
  await publicCalendar(input);
  assert.equal(calls, 2);
  input.cache.invalidateDate(date);
  await assert.rejects(publicCalendar(input), /budget_exhausted/);
  for (const changes of [
    { PUBLIC_CALENDAR_WINDOW_JSON: "" },
    { PUBLIC_CALENDAR_WINDOW_JSON: "{" },
    { SOURCE_REVISION: "b".repeat(40) },
    { PROVIDER_ACCESS: "disabled" },
    {
      PUBLIC_CALENDAR_WINDOW_JSON: JSON.stringify({
        ...window,
        expiresMs: start - 1,
      }),
    },
  ])
    await assert.rejects(
      publicCalendar({ ...input, env: { ...env, ...changes } }),
      /public_calendar_closed/,
    );
  assert.equal(calls, 2);
});

test("priced customer calendar chooses native service by Singapore weekday and public holiday and refreshes changes", async (t) => {
  let now = Date.parse("2026-11-01T00:00:00Z");
  t.mock.method(Date, "now", () => now);
  const catalogueReads = [];
  const config = ts.parseConfigFileTextToJson(
    "wrangler.jsonc",
    readFileSync("wrangler.jsonc", "utf8"),
  ).config;
  const data = fixtures();
  data.services = {
    2: { ...data.services[12], id: 2, unit_map: [14] },
    3: { ...data.services[12], id: 3, price: "108", unit_map: [14] },
  };
  let calls = 0,
    available = true;
  const input = {
    env: {
      ...config.vars,
      SOURCE_REVISION: "a".repeat(40),
      PROVIDER_ACCESS: "trusted-reads",
      LIVE_CUSTOMER_ACCESS: "enabled",
      PREMIUM_SERVICE_ID: "3",
      SIMPLYBOOK_DEV_COMPANY_LOGIN: "synthetic-company",
      SIMPLYBOOK_DEV_ADMIN_LOGIN: "synthetic-admin",
      SIMPLYBOOK_DEV_API_KEY: "synthetic-key",
      SIMPLYBOOK_DEV_ADMIN_API_USER_KEY: "synthetic-key",
    },
    month: "2026-11",
    cache: new NativeCalendarReads(),
    accounting: () => ({ used: calls, active: 0 }),
    control: {},
    provider: {
      identity: async () => {},
      catalogue: async (_env, _control, fresh) => {
        catalogueReads.push(fresh);
        return normalizeCatalogue(
          data.services,
          data.instructors,
          binding,
          now - (fresh ? 0 : 59000),
        );
      },
      nativeRead: async (_env, _control, request) => {
        calls++;
        now += 2000;
        const body = {};
        for (
          let day = new Date(request.from + "T00:00:00Z");
          day.toISOString().slice(0, 10) <= request.to;
          day.setUTCDate(day.getUTCDate() + 1)
        )
          body[day.toISOString().slice(0, 10)] = available
            ? ["11:59:00", "12:00:00", "19:21:00"]
            : [];
        return { receivedAtMs: Date.now(), body };
      },
    },
  };
  const calendar = await publicCalendar(input);
  for (const [date, id, price] of [
    ["2026-11-06", "2", 8800],
    ["2026-11-07", "3", 10800],
    ["2026-11-08", "3", 10800],
    ["2026-11-09", "3", 10800],
    ["2026-11-10", "2", 8800],
  ]) {
    const offer = calendar.dates.find((day) => day.date === date).offers[0];
    assert.equal(offer.serviceId, id);
    assert.equal(offer.productServiceId, "2");
    assert.equal(offer.priceMinor, price);
  }
  assert.deepEqual(
    catalogueReads,
    [true],
    "one fresh catalogue is shared by both priced service ranges",
  );
  const count = calls;
  await publicCalendar(input);
  assert.equal(calls, count);
  assert.deepEqual(catalogueReads, [true]);
  available = false;
  const fresh = await windowAvailability({
    ...input,
    serviceId: "2",
    date: "2026-11-09",
    fresh: true,
  });
  assert.deepEqual(fresh.offers, []);
  assert.equal(calls, count + 1);
  data.services[3].price = "88";
  await assert.rejects(
    windowAvailability({
      ...input,
      serviceId: "2",
      date: "2026-11-09",
      fresh: true,
    }),
    /native_service_price_changed/,
  );
  data.services[3].price = "108";
  available = true;
  now = Date.parse("2026-11-06T07:59:58+08:00");
  const boundary = await windowAvailability({
    ...input,
    serviceId: "2",
    date: "2026-11-06",
    fresh: true,
  });
  assert.equal(
    boundary.offers.length,
    1,
    "exactly 240 minutes remains bookable",
  );
  now++;
  assert.deepEqual(
    (await windowAvailability({ ...input, serviceId: "2", date: "2026-11-06" }))
      .offers,
    [],
    "cached offers cross the cutoff without a stale fallback",
  );
});

test("priced prebooking accepts exact mixed service totals and rejects cheap holiday service substitution", async (t) => {
  t.mock.method(Date, "now", () => Date.parse("2026-11-01T00:00:00Z"));
  const intent = approved();
  intent.customerMode = "booking-contact";
  intent.contact = {
    name: "Synthetic Guest",
    email: "guest@example.invalid",
    phone: "00000000",
    contactMethod: "email",
    academy: "",
  };
  intent.sessions = [
    {
      ...intent.sessions[0],
      serviceId: "12",
      startMs: Date.parse("2026-11-06T12:00:00+08:00"),
      totalMinor: 8800,
    },
    {
      ...intent.sessions[0],
      serviceId: "13",
      startMs: Date.parse("2026-11-09T12:00:00+08:00"),
      totalMinor: 10800,
    },
  ];
  intent.totalMinor = 19600;
  const data = fixtures();
  data.services[13] = { ...data.services[12], id: 13, price: "108" };
  const read = exchangeFor(data, intent);
  const exchange = async (request) =>
    request.kind === "availability"
      ? { receivedAtMs: Date.now(), body: { [request.date]: ["12:00:00"] } }
      : read.exchange(request);
  const contract = {
    ...binding,
    serviceId: "12",
    premiumServiceId: "13",
    priceMinor: 8800,
    currency: "SGD",
    taxMinor: 0,
    durationMinutes: 40,
    bufferAfterMinutes: 10,
    clientLoginRequired: false,
    providerSchedules: "non-overlapping",
    confirmedAtMs: Date.now() - 1000,
    expiresAtMs: Date.now() + 600000,
  };
  const validation = new NativePrebooking(
    binding,
    new CatalogueReads(),
    exchange,
    contract,
  );
  for (let index = 0; index < 2; index++)
    assert.deepEqual(await validation.revalidate(intent, index), intent);
  const wrong = structuredClone(intent);
  wrong.sessions[1].serviceId = "12";
  wrong.sessions[1].totalMinor = 8800;
  wrong.totalMinor = 17600;
  await assert.rejects(
    validation.revalidate(wrong, 1),
    /native_account_contract_unavailable/,
  );
  data.services[13].price = "88";
  await assert.rejects(
    validation.revalidate(intent, 1),
    /native_restart_required/,
  );
});

test("catalogue accepts observed explicit provider null maps without allowing other object relationships", () => {
  const data = fixtures();
  data.services[12].unit_map = { 14: null, 15: null, 16: null };
  const parsed = normalizeCatalogue(
    data.services,
    data.instructors,
    binding,
    Date.now(),
  );
  assert.deepEqual(parsed.services[0].instructorIds, ["14", "15", "16"]);
  for (const map of [
    { 14: 40 },
    { 14: false },
    { 14: "14" },
    { invalid: null },
    { "014": null },
    {},
    null,
  ]) {
    data.services[12].unit_map = map;
    assert.throws(() =>
      normalizeCatalogue(data.services, data.instructors, binding, Date.now()),
    );
  }
});

test("customer booking accepts exactly 240 minutes and rechecks the cutoff after provider reads", async (t) => {
  let now = Date.parse("2026-11-06T08:00:00+08:00");
  t.mock.method(Date, "now", () => now);
  const intent = approved();
  intent.sessions[0].startMs = now + 240 * 60000;
  intent.customerMode = "booking-contact";
  intent.contact = {
    name: "Synthetic Guest",
    email: "guest@example.invalid",
    phone: "00000000",
    contactMethod: "email",
    academy: "",
  };
  const contract = {
    ...binding,
    serviceId: "12",
    priceMinor: 8800,
    currency: "SGD",
    taxMinor: 0,
    durationMinutes: 40,
    bufferAfterMinutes: 10,
    clientLoginRequired: false,
    providerSchedules: "non-overlapping",
    bookingLeadMinutes: 240,
    confirmedAtMs: now - 1000,
    expiresAtMs: now + 600000,
  };
  const read = exchangeFor(fixtures(), intent);
  const validator = new NativePrebooking(
    binding,
    new CatalogueReads(),
    read.exchange,
    contract,
  );
  assert.equal(
    nativeTrialLeadMs(contract, binding, intent.sessions[0], now),
    240 * 60000,
  );
  assert.equal((await validator.review(intent)).state, "ready");
  assert.deepEqual(await validator.revalidate(intent), intent);
  const count = read.calls.length;
  now++;
  await assert.rejects(validator.review(intent), /native_trial_lead_time/);
  assert.equal(read.calls.length, count);
  now--;
  const delayed = new NativePrebooking(
    binding,
    new CatalogueReads(),
    async (request) => {
      const result = await read.exchange(request);
      now++;
      return result;
    },
    contract,
  );
  await assert.rejects(delayed.revalidate(intent), /native_trial_lead_time/);
  for (const change of [
    { accountId: "foreign" },
    { bookingLeadMinutes: 0 },
    { expiresAtMs: now - 1 },
  ])
    assert.equal(
      nativeTrialLeadMs(
        { ...contract, ...change },
        binding,
        intent.sessions[0],
        now,
      ),
      48 * 3600000,
    );
  // Legacy ongoing declarations remain readable, but new reviews use the current cutoff.
  assert.equal(
    nativeTrialLeadMs(
      { ...contract, bookingLeadMinutes: 150 },
      binding,
      intent.sessions[0],
      now,
    ),
    240 * 60000,
  );
  for (const [time, allowed] of [
    ["11:59:00", false],
    ["12:00:00", true],
    ["19:20:00", true],
    ["19:21:00", false],
    ["20:00:00", false],
  ]) {
    now = Date.parse("2026-11-06T07:00:00+08:00");
    const candidate = structuredClone(intent);
    candidate.sessions[0].startMs = Date.parse(`2026-11-06T${time}+08:00`);
    const reads = exchangeFor(fixtures(), candidate);
    const current = new NativePrebooking(
      binding,
      new CatalogueReads(),
      reads.exchange,
      { ...contract, confirmedAtMs: now - 1000, expiresAtMs: now + 600000 },
    );
    assert.equal(
      (await current.review(candidate)).state,
      allowed ? "ready" : "selection_unavailable",
    );
    if (!allowed) assert.equal(reads.calls.length, 0);
    assert.ok(reads.calls.every((request) => request.kind !== "book"));
  }
  assert.ok(read.calls.every((request) => request.kind !== "book"));
});

test("provider identity renewal keeps native reads valid across token retention boundaries", async (t) => {
  const config = ts.parseConfigFileTextToJson(
    "wrangler.jsonc",
    readFileSync("wrangler.jsonc", "utf8"),
  ).config;
  let now = Date.parse("2026-10-14T12:00:00+08:00");
  t.mock.method(Date, "now", () => now);
  const env = {
    ...config.vars,
    PROVIDER_ACCESS: "trusted-reads",
    CAMPAIGN_END_MS: String(now + 3600000),
    SIMPLYBOOK_DEV_COMPANY_LOGIN: "synthetic-company",
    SIMPLYBOOK_DEV_ADMIN_LOGIN: "synthetic-admin",
    SIMPLYBOOK_DEV_API_KEY: "synthetic-public-key",
    SIMPLYBOOK_DEV_ADMIN_API_USER_KEY: "synthetic-admin-key",
  };
  for (const crossesDuringIdentity of [false, true]) {
    env.CAMPAIGN_END_MS = String(now + 3600000);
    const start = now;
    const calls = [];
    let reserved = 0;
    let finished = 0;
    let slowIdentity = false;
    const control = {
      reserve: async () => String(++reserved),
      finish: () => finished++,
      claim: () => ({ generation: 1, claim: "synthetic" }),
      complete: () => true,
      pause: () => assert.fail("successful renewal must not pause the account"),
    };
    t.mock.method(globalThis, "fetch", async (url, options) => {
      const path = new URL(url).pathname;
      const body = options.body ? JSON.parse(options.body) : null;
      calls.push(path);
      if (path === "/login")
        return Response.json({ id: body.id, result: "synthetic-public-token" });
      if (path === "/admin/auth")
        return Response.json({ token: "synthetic-admin-token" });
      if (path === "/admin/company/info")
        return Response.json({ login: "synthetic-company" });
      if (path === "/admin/tariff/current") {
        if (slowIdentity) now += 2000;
        return Response.json({ limits: [] });
      }
      assert.equal(body.method, "getEventList");
      return Response.json({ id: body.id, result: fixtures().services });
    });
    const session = new ProviderSession();
    await session.identity(env, control);
    assert.equal(calls.length, 4);
    now = start + 6000;
    await Promise.all([
      session.identity(env, control),
      session.identity(env, control),
    ]);
    assert.equal(
      calls.length,
      4,
      "reuse identity beyond five seconds without provider calls",
    );
    now = start + 59000;
    slowIdentity = crossesDuringIdentity;
    await session.identity(env, control);
    if (!crossesDuringIdentity) {
      now = start + 60001;
      await session.identity(env, control);
    }
    const response = await session.nativeRead(env, control, {
      kind: "catalogue-services",
    });
    assert.deepEqual(response.body, fixtures().services);
    assert.equal(calls.filter((path) => path === "/login").length, 1);
    assert.equal(calls.filter((path) => path === "/admin/auth").length, 2);
    assert.equal(reserved, calls.length);
    assert.equal(finished, calls.length);
    const before = calls.length;
    now += 60001;
    await assert.rejects(
      session.nativeRead(env, control, { kind: "catalogue-services" }),
      /provider_identity_expired/,
    );
    assert.equal(
      calls.length,
      before,
      "nativeRead never reauthenticates implicitly",
    );
    now = start + 50 * 60000 + 1;
    slowIdentity = false;
    await session.identity(env, control);
    assert.equal(calls.filter((path) => path === "/login").length, 2);
    const beforeRejection = calls.length;
    t.mock.method(
      globalThis,
      "fetch",
      async () => new Response(null, { status: 401 }),
    );
    await assert.rejects(
      session.nativeRead(env, control, { kind: "catalogue-services" }),
      /provider_auth_failed/,
    );
    await assert.rejects(
      session.nativeRead(env, control, { kind: "catalogue-services" }),
      /provider_identity_expired/,
    );
    assert.equal(
      reserved,
      beforeRejection + 1,
      "rejected auth invalidates cache without an implicit retry",
    );
  }
});

test("bounded read groups reuse two lanes and drain failure without starting queued work", async () => {
  const first = Promise.withResolvers();
  const second = Promise.withResolvers();
  const entered = [];
  let settled = false;
  const failure = new Error("synthetic read failure");
  const result = parallelReads([
    async () => {
      entered.push(0);
      return first.promise;
    },
    async () => {
      entered.push(1);
      return second.promise;
    },
    async () => {
      entered.push(2);
      return 3;
    },
  ]).finally(() => {
    settled = true;
  });
  const rejection = assert.rejects(result, (error) => error === failure);
  assert.deepEqual(entered, [0, 1]);
  first.reject(failure);
  await new Promise(setImmediate);
  assert.equal(settled, false);
  assert.deepEqual(entered, [0, 1]);
  second.resolve(2);
  await rejection;
  assert.deepEqual(entered, [0, 1]);
  assert.deepEqual(
    await parallelReads([async () => 1, async () => 2, async () => 3]),
    [1, 2, 3],
  );
});

test("persistent display snapshots retain original deadlines across restarts and fence invalidation", () => {
  const db = new DatabaseSync(":memory:");
  const sql = {
    exec(query, ...args) {
      const rows = db.prepare(query).all(...args);
      return {
        toArray: () => rows,
        one: () => {
          assert.equal(rows.length, 1);
          return rows[0];
        },
      };
    },
  };
  const clock = Date.now;
  let now = 2000000000000;
  Date.now = () => now;
  try {
    const store = new DisplaySnapshots(sql, "account/source");
    const month = new Date(now + 28800000).toISOString().slice(0, 7);
    const key = `calendar:${month}`;
    const value = { month, serviceId: "2", observedAtMs: now, dates: [] };
    store.save("calendar", key, value, store.generation());
    const expected = store.read("calendar", key);
    assert.equal(expected.displayExpiresAtMs, now + 1800000);
    assert.equal(store.claimRefresh(now), true);
    assert.equal(
      new DisplaySnapshots(sql, "account/source").claimRefresh(now),
      false,
    );
    now += 900000;
    const restarted = new DisplaySnapshots(sql, "account/source");
    assert.deepEqual(restarted.read("calendar", key), expected);
    assert.equal(restarted.claimRefresh(now), true);
    // A failed refresh changes neither content nor its original deadline.
    assert.deepEqual(restarted.read("calendar", key), expected);
    const oldGeneration = restarted.generation();
    restarted.invalidateCalendars();
    assert.equal(restarted.read("calendar", key), undefined);
    assert.ok(restarted.months().includes(month));
    restarted.save("calendar", key, value, oldGeneration);
    assert.equal(restarted.read("calendar", key), undefined);
    assert.equal(restarted.claimRefresh(now), true);
    restarted.save("calendar", key, value, restarted.generation());
    assert.deepEqual(restarted.read("calendar", key), expected);
    assert.equal(
      new DisplaySnapshots(sql, "different-source").read("calendar", key),
      undefined,
    );
    now = expected.displayExpiresAtMs;
    assert.equal(restarted.read("calendar", key), undefined);
  } finally {
    Date.now = clock;
    db.close();
  }
});

test("failed pre-dispatch evidence persistence releases the transport reservation without sending a write", async (t) => {
  const config = ts.parseConfigFileTextToJson(
    "wrangler.jsonc",
    readFileSync("wrangler.jsonc", "utf8"),
  ).config;
  const env = {
    ...config.vars,
    PROVIDER_ACCESS: "trusted-reads",
    CAMPAIGN_END_MS: String(Date.now() + 3600000),
    SIMPLYBOOK_DEV_COMPANY_LOGIN: "synthetic-company",
    SIMPLYBOOK_DEV_ADMIN_LOGIN: "synthetic-admin",
    SIMPLYBOOK_DEV_API_KEY: "synthetic-public-key",
    SIMPLYBOOK_DEV_ADMIN_API_USER_KEY: "synthetic-admin-key",
  };
  let sent = 0,
    reserved = 0;
  const finished = [];
  const control = {
    reserve: async () => String(++reserved),
    finish: (...args) => finished.push(args),
    claim: () => ({ generation: 1, claim: "synthetic" }),
    complete: () => true,
    pause: () => {},
  };
  t.mock.method(globalThis, "fetch", async (url, options) => {
    sent++;
    const pathname = new URL(url).pathname;
    if (pathname === "/login")
      return Response.json({
        id: JSON.parse(options.body).id,
        result: "synthetic-public-token",
      });
    if (pathname === "/admin/auth")
      return Response.json({ token: "synthetic-admin-token" });
    if (pathname === "/admin/company/info")
      return Response.json({ login: "synthetic-company" });
    if (pathname === "/admin/tariff/current")
      return Response.json({ limits: [] });
    assert.fail("write must not reach transport");
  });
  const session = new ProviderSession();
  await session.identity(env, control);
  const before = sent;
  await assert.rejects(
    session.nativeWrite(
      env,
      control,
      { kind: "payment-link", invoiceId: "901" },
      async () => {},
      async () => {
        throw new Error("evidence-save-failed");
      },
    ),
    /evidence-save-failed/,
  );
  assert.equal(sent, before);
  assert.equal(reserved, before + 1);
  assert.deepEqual(finished.at(-1), [
    String(reserved),
    0,
    "write_transport_ended",
  ]);
});

test("durable provider tokens retain original expiry and reject changed credentials tampering and cross-account reuse", async (t) => {
  let now = Date.now();
  t.mock.method(Date, "now", () => now);
  const db = new DatabaseSync(":memory:");
  const sql = {
    exec(query, ...args) {
      const statement = db.prepare(query);
      const rows = statement.all(...args);
      return { toArray: () => rows };
    },
  };
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
  const token = {
    value: "synthetic-secret-token-value",
    issued: now,
    until: now + 50 * 60000,
  };
  try {
    const first = new ProviderTokenCache(sql);
    await first.save(env, "public", token);
    const stored = db.prepare("SELECT * FROM provider_token_cache").all();
    assert.doesNotMatch(
      JSON.stringify(stored),
      /synthetic-secret-token-value|synthetic-public-key/,
    );
    now += 6 * 60000;
    const restored = new ProviderTokenCache(sql);
    assert.deepEqual(await restored.load(env, "public"), token);
    assert.deepEqual(
      db.prepare("SELECT * FROM provider_token_cache").all(),
      stored,
      "hits do not slide expiry or rewrite storage",
    );
    for (const change of [
      { SIMPLYBOOK_DEV_API_KEY: "rotated-public-key" },
      { SIMPLYBOOK_DEV_COMPANY_LOGIN: "another-company" },
      { DEPLOYMENT_ACCOUNT_ID: "another-account" },
      { ENVIRONMENT: "another-environment" },
    ]) {
      await restored.save(env, "public", token);
      assert.equal(
        await restored.load({ ...env, ...change }, "public"),
        undefined,
      );
    }
    await restored.save(env, "public", token);
    db.prepare("UPDATE provider_token_cache SET ciphertext='00'").run();
    assert.equal(await restored.load(env, "public"), undefined);
    await restored.save(env, "public", token);
    now = token.until;
    assert.equal(await restored.load(env, "public"), undefined);
    const admin = {
      value: "synthetic-secret-admin-token",
      issued: now,
      until: now + 60000,
    };
    await restored.save(env, "admin", admin);
    now += 60000;
    assert.equal(await restored.load(env, "admin"), undefined);
  } finally {
    db.close();
  }
});

test("late authentication rejection cannot evict a newer token", async (t) => {
  let now = Date.now(),
    publicAuth = 0;
  t.mock.method(Date, "now", () => now);
  const config = ts.parseConfigFileTextToJson(
    "wrangler.jsonc",
    readFileSync("wrangler.jsonc", "utf8"),
  ).config;
  const env = {
    ...config.vars,
    PROVIDER_ACCESS: "trusted-reads",
    CAMPAIGN_END_MS: String(now + 7200000),
    SIMPLYBOOK_DEV_COMPANY_LOGIN: "synthetic-company",
    SIMPLYBOOK_DEV_ADMIN_LOGIN: "synthetic-admin",
    SIMPLYBOOK_DEV_API_KEY: "synthetic-public-key",
    SIMPLYBOOK_DEV_ADMIN_API_USER_KEY: "synthetic-admin-key",
  };
  const entered = Promise.withResolvers(),
    release = Promise.withResolvers();
  const control = {
    reserve: async () => "synthetic",
    finish() {},
    claim: () => ({ generation: 1, claim: "synthetic" }),
    complete: () => true,
    pause() {},
  };
  t.mock.method(globalThis, "fetch", async (url, options) => {
    const path = new URL(url).pathname;
    const body = options.body ? JSON.parse(options.body) : null;
    if (path === "/login")
      return Response.json({
        id: body.id,
        result: `synthetic-public-token-${++publicAuth}`,
      });
    if (path === "/admin/auth")
      return Response.json({ token: "synthetic-admin-token" });
    if (path === "/admin/company/info")
      return Response.json({ login: "synthetic-company" });
    if (path === "/admin/tariff/current") return Response.json({ limits: [] });
    assert.equal(body.method, "getEventList");
    entered.resolve();
    await release.promise;
    return new Response(null, { status: 401 });
  });
  const session = new ProviderSession();
  await session.identity(env, control);
  const oldRead = assert.rejects(
    session.nativeRead(env, control, { kind: "catalogue-services" }),
    /provider_auth_failed/,
  );
  await entered.promise;
  now += 50 * 60000 + 1;
  await session.identity(env, control);
  assert.equal(publicAuth, 2);
  release.resolve();
  await oldRead;
  await session.identity(env, control);
  assert.equal(
    publicAuth,
    2,
    "old rejection cannot clear the newly verified token",
  );
});
