import {
  CATALOGUE_MAX_AGE_MS,
  CATALOGUE_RECORD_LIMIT,
  catalogueSchema,
  catalogueBindingSchema,
  type CatalogueBinding,
  type ProviderCatalogue,
} from "../src/domain/catalog";
import { ApiError } from "./policy";
import { providerId, providerFlag, minorUnits } from "./provider-normalization";
import type { NativeExchange } from "./provider-transport";
// Local operational bounds, not a four-instructor business limit or provider TTL.
export const CATALOGUE_CACHE_MS = CATALOGUE_MAX_AGE_MS;
export const PREBOOKING_FRESH_MS = 15000;
const MAX_CACHE_SCOPES = 8;
const unknown = (): never => {
  throw new ApiError(503, "catalogue_representation_unavailable");
};
function rows(raw: unknown) {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return unknown();
  const entries = Object.entries(raw);
  if (entries.length > CATALOGUE_RECORD_LIMIT) return unknown();
  return entries.map(([key, value]) => {
    if (!value || typeof value !== "object" || Array.isArray(value))
      return unknown();
    const row = value as Record<string, unknown>;
    if (providerId(key) !== providerId(row.id)) return unknown();
    return row;
  });
}
function flag(raw: unknown) {
  const value = providerFlag(raw);
  if (value === null) return unknown();
  return value;
}
function amount(raw: unknown) {
  const n = minorUnits(raw);
  if (n === null) return unknown();
  return n;
}
// getEventList(true,false) / getUnitList(true,false) are documented full maps,
// without pagination arguments. Reject wrappers/cursors/truncation, never take a page.
export function normalizeCatalogue(
  services: unknown,
  instructors: unknown,
  binding: CatalogueBinding,
  observedAtMs: number,
): ProviderCatalogue {
  return catalogueSchema.parse({
    binding,
    observedAtMs,
    complete: true,
    instructors: rows(instructors).map((row) => ({
      id: providerId(row.id),
      name: row.name,
      active: flag(row.is_active),
    })),
    services: rows(services).map((row) => {
      const map = row.unit_map;
      const active = flag(row.is_active),
        visible = flag(row.is_public);
      if (map !== undefined && !Array.isArray(map)) return unknown();
      return {
        id: providerId(row.id),
        name: row.name,
        active: active && visible,
        durationMinutes: Number(providerId(row.duration)),
        recurring: flag(row.is_recurring),
        priceMinor: amount(row.price),
        currency: row.currency,
        instructorIds:
          map === undefined || map.length === 0 ? null : map.map(providerId),
      };
    }),
  });
}
export function freshReceipt(
  receivedAtMs: number,
  now: number,
  maximum = PREBOOKING_FRESH_MS,
) {
  if (
    !Number.isSafeInteger(receivedAtMs) ||
    receivedAtMs > now ||
    now - receivedAtMs >= maximum
  )
    throw new ApiError(503, "provider_data_stale");
}
// Owned by ProviderSession/its account DO; no global mutable cache or SQL catalogue.
export class CatalogueReads {
  private entries = new Map<
    string,
    {
      generation: number;
      value?: ProviderCatalogue;
      pending?: Promise<ProviderCatalogue>;
    }
  >();
  private key(binding: CatalogueBinding) {
    const b = catalogueBindingSchema.parse(binding);
    return JSON.stringify([b.environmentId, b.accountId, b.companyLogin]);
  }
  invalidate(binding: CatalogueBinding) {
    const entry = this.entries.get(this.key(binding));
    if (entry) {
      entry.generation++;
      entry.value = undefined;
      entry.pending = undefined;
    }
  }
  async read(
    binding: CatalogueBinding,
    exchange: NativeExchange,
    fresh = false,
  ): Promise<ProviderCatalogue> {
    const key = this.key(binding);
    if (fresh) this.invalidate(binding);
    let entry = this.entries.get(key);
    if (!entry) {
      if (this.entries.size >= MAX_CACHE_SCOPES) {
        const oldest = this.entries.keys().next().value;
        if (oldest !== undefined) this.entries.delete(oldest);
      }
      entry = { generation: 0 };
      this.entries.set(key, entry);
    }
    if (
      !fresh &&
      entry.value &&
      Date.now() >= entry.value.observedAtMs &&
      Date.now() - entry.value.observedAtMs < CATALOGUE_CACHE_MS
    )
      return structuredClone(entry.value);
    if (!fresh && entry.pending) return structuredClone(await entry.pending);
    const generation = entry.generation;
    const selected = entry;
    const pending = (async () => {
      const services = await exchange({ kind: "catalogue-services" });
      const instructors = await exchange({ kind: "catalogue-instructors" });
      freshReceipt(services.receivedAtMs, Date.now());
      freshReceipt(instructors.receivedAtMs, Date.now());
      const value = normalizeCatalogue(
        services.body,
        instructors.body,
        binding,
        Math.min(services.receivedAtMs, instructors.receivedAtMs),
      );
      if (
        this.entries.get(key) !== selected ||
        selected.generation !== generation
      )
        throw new ApiError(409, "catalogue_read_superseded");
      selected.value = value;
      return value;
    })();
    selected.pending = pending;
    try {
      return structuredClone(await pending);
    } catch (error) {
      if (selected.generation === generation) selected.value = undefined;
      throw error;
    } finally {
      if (selected.pending === pending) selected.pending = undefined;
    }
  }
}
