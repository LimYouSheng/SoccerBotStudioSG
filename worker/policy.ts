import { z } from "zod";
const duration = (minimum: number, maximum: number) =>
  z.coerce.number().int().min(minimum).max(maximum);
const schema = z.object({
  DEPLOYMENT_ACCOUNT_ID: z.literal("517f4f85eb8f982b483dbc05b797fd88"),
  STATE_DATABASE_ID: z.literal("297a991b-70a7-438d-a0e3-39fa3a7f2cee"),
  APP_ORIGIN: z
    .string()
    .url()
    .refine((value) => {
      const url = new URL(value);
      return (
        url.protocol === "https:" &&
        url.origin === value &&
        !url.username &&
        !url.password
      );
    }),
  CAMPAIGN_ID: z.literal("developer-20261008"),
  CAMPAIGN_END_MS: duration(0, Number.MAX_SAFE_INTEGER),
  SOURCE_REVISION: z.string().regex(/^(unpublished|[a-f0-9]{40})$/),
  ENVIRONMENT: z.literal("developer"),
  PROVIDER_ACCESS: z.enum(["disabled", "trusted-reads"]),
  ACCESS_LIFETIME_MS: duration(60000, 3600000),
  OBSERVATION_MAX_AGE_MS: duration(1000, 60000),
  POLL_INTERVAL_MS: duration(1000, 30000),
  CHECKING_DEADLINE_MS: duration(60000, 1800000),
});
export function policy(env: Env) {
  return schema.parse(env);
}
export class ApiError extends Error {
  constructor(
    public status: number,
    public code: string,
  ) {
    super(code);
  }
}
export async function digest(value: string) {
  return Array.from(
    new Uint8Array(
      await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value)),
    ),
    (b) => b.toString(16).padStart(2, "0"),
  ).join("");
}
export function capability() {
  return Array.from(crypto.getRandomValues(new Uint8Array(32)), (b) =>
    b.toString(16).padStart(2, "0"),
  ).join("");
}
