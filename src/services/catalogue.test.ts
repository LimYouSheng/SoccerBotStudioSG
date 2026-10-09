import { expect, test } from "vitest";
import { catalogueReview, catalogueSchema } from "@/domain/catalog";
import { draftSchema, blankDraft } from "@/domain/booking";
import { defineCatalogueService, liveCatalogueService } from "./booking";
function catalogue() {
  return catalogueSchema.parse({
    binding: {
      accountId: "synthetic",
      environmentId: "developer",
      companyLogin: "synthetic",
    },
    observedAtMs: Date.now(),
    complete: true,
    services: [
      {
        id: "12",
        name: "Session",
        active: true,
        durationMinutes: 40,
        recurring: false,
        priceMinor: 8800,
        currency: "SGD",
        instructorIds: ["14", "15"],
      },
    ],
    instructors: [
      { id: "14", name: "Same Name", active: true },
      { id: "15", name: "Same Name", active: true },
    ],
  });
}
const selection = {
  serviceId: "12",
  instructorId: "14",
  startMs: 1234567890000,
  players: 2,
};
test("live catalogue boundary accepts stable provider IDs without preview aliases", async () => {
  const value = catalogue();
  const service = defineCatalogueService(value.binding, {
    read: async () => value,
  });
  expect((await service.read({})).instructors.map((x) => x.id)).toEqual([
    "14",
    "15",
  ]);
  expect(draftSchema.parse(blankDraft())).toEqual(blankDraft());
  const invalid = {
    ...value,
    instructors: [{ id: "faisal", name: "Preview", active: true }],
  };
  await expect(
    defineCatalogueService(value.binding, { read: async () => invalid }).read(
      {},
    ),
  ).rejects.toMatchObject({ code: "invalid_response" });
});
test("live catalogue boundary rejects stale incomplete foreign and unavailable data", async () => {
  const value = catalogue();
  for (const changed of [
    { ...value, observedAtMs: Date.now() - 60001 },
    { ...value, observedAtMs: Date.now() + 10000 },
    { ...value, binding: { ...value.binding, accountId: "foreign" } },
  ])
    await expect(
      defineCatalogueService(value.binding, { read: async () => changed }).read(
        {},
      ),
    ).rejects.toMatchObject({ code: "invalid_response" });
  expect(catalogueSchema.safeParse({ ...value, complete: false }).success).toBe(
    false,
  );
  await expect(liveCatalogueService.read({})).rejects.toMatchObject({
    code: "unavailable",
  });
});
test("catalogue review reports rename price and relationship changes while preserving selection", () => {
  const old = catalogue(),
    next = structuredClone(old),
    selected = structuredClone(selection);
  next.services[0].priceMinor = 9900;
  next.instructors[0].name = "Renamed";
  const review = catalogueReview(old, next, selection);
  expect(review.state).toBe("review_required");
  expect(selection).toEqual(selected);
  expect(old.services[0].priceMinor).toBe(8800);
  next.instructors[0].active = false;
  expect(catalogueReview(old, next, selection).state).toBe(
    "selection_unavailable",
  );
  next.instructors[0].active = true;
  next.services[0].instructorIds = ["15"];
  expect(catalogueReview(old, next, selection).state).toBe(
    "selection_unavailable",
  );
});
test("catalogue additions and response order do not change approved identity", () => {
  const old = catalogue(),
    next = structuredClone(old);
  next.instructors.reverse();
  next.instructors.push({ id: "16", name: "New Trainer", active: true });
  expect(catalogueReview(old, next, selection).state).toBe("unchanged");
  expect(
    catalogueReview(old, next, { ...selection, instructorId: "99" }).state,
  ).toBe("selection_unavailable");
  expect(
    catalogueReview(
      old,
      { ...next, binding: { ...next.binding, companyLogin: "foreign" } },
      selection,
    ).state,
  ).toBe("unavailable");
});
