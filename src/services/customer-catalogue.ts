import {
  customerCatalogueSchema,
  CATALOGUE_MAX_AGE_MS,
  type CustomerCatalogue,
} from "@/domain/catalog";
import { BookingServiceError } from "./contracts";
export interface CustomerCatalogueService {
  read(signal: AbortSignal): Promise<CustomerCatalogue>;
}
export const customerCatalogueService: CustomerCatalogueService = {
  async read(signal) {
    const unavailable = () =>
      new BookingServiceError(
        "unavailable",
        "Session information is unavailable. Please contact the studio.",
      );
    const response = await fetch("/api/catalogue", {
      signal,
      credentials: "same-origin",
      cache: "no-store",
      redirect: "error",
      headers: { Accept: "application/json" },
    });
    if (!response.ok || !response.body) throw unavailable();
    const reader = response.body.getReader(),
      chunks = [];
    let size = 0;
    try {
      while (true) {
        const part = await reader.read();
        if (part.done) break;
        size += part.value.length;
        if (size > 131072) throw unavailable();
        chunks.push(part.value);
      }
    } finally {
      void reader.cancel().catch(() => {});
      reader.releaseLock();
    }
    const bytes = new Uint8Array(size);
    let offset = 0;
    for (const chunk of chunks) {
      bytes.set(chunk, offset);
      offset += chunk.length;
    }
    const result = customerCatalogueSchema.safeParse(
      JSON.parse(new TextDecoder().decode(bytes)),
    );
    if (
      signal.aborted ||
      !result.success ||
      result.data.observedAtMs > Date.now() ||
      Date.now() - result.data.observedAtMs >= CATALOGUE_MAX_AGE_MS
    )
      throw unavailable();
    return result.data;
  },
};
