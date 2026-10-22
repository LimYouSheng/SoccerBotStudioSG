import { traceId } from "./diagnostics";
import { providerSecrets, type ProviderFamily } from "./provider-transport";

export type CachedProviderToken = {
  value: string;
  issued: number;
  until: number;
};
export const providerTokenLifetime = (family: ProviderFamily) =>
  family === "public" ? 50 * 60000 : 60000;
const bytes = (value: string) => new TextEncoder().encode(value);
const hex = (value: ArrayBuffer | Uint8Array) =>
  Array.from(new Uint8Array(value))
    .map((v) => v.toString(16).padStart(2, "0"))
    .join("");
const unhex = (value: string) => {
  if (!/^(?:[0-9a-f]{2})+$/.test(value)) throw new Error("invalid_ciphertext");
  return Uint8Array.from(value.match(/../g)!, (v) => Number.parseInt(v, 16));
};

// Account-owned encrypted cache only. No D1, RPC exposure, credentials in SQL,
// sliding expiry, identity proof or booking authority. Two replaceable rows.
export class ProviderTokenCache {
  /** Initialize persistent encrypted token storage for the account. */
  constructor(private readonly sql: SqlStorage) {
    sql.exec(
      "CREATE TABLE IF NOT EXISTS provider_token_cache(family TEXT PRIMARY KEY,scope TEXT NOT NULL,issued_ms INTEGER NOT NULL,expires_ms INTEGER NOT NULL,iv TEXT NOT NULL,ciphertext TEXT NOT NULL)",
    );
  }
  /** Derive encryption material and scope from account and credential identity. */
  private async binding(env: Env, family: ProviderFamily) {
    const secrets = providerSecrets(env);
    const identity = JSON.stringify([
      env.ENVIRONMENT,
      env.DEPLOYMENT_ACCOUNT_ID,
      secrets.company,
      family,
      family === "admin" ? secrets.login : "",
      family === "public" ? secrets.publicKey : secrets.adminKey,
    ]);
    const scope = hex(
      await crypto.subtle.digest(
        "SHA-256",
        bytes("token-cache-scope:" + identity),
      ),
    );
    const material = await crypto.subtle.digest(
      "SHA-256",
      bytes("token-cache-encryption:" + identity),
    );
    const key = await crypto.subtle.importKey(
      "raw",
      material,
      "AES-GCM",
      false,
      ["encrypt", "decrypt"],
    );
    return { scope, key };
  }
  remove(family: ProviderFamily) {
    this.sql.exec("DELETE FROM provider_token_cache WHERE family=?", family);
  }
  /** Decrypt a matching unexpired token and reject invalid persistent records. */
  async load(
    env: Env,
    family: ProviderFamily,
  ): Promise<CachedProviderToken | undefined> {
    const row = this.sql
      .exec<{
        scope: string;
        issued_ms: number;
        expires_ms: number;
        iv: string;
        ciphertext: string;
      }>(
        "SELECT scope,issued_ms,expires_ms,iv,ciphertext FROM provider_token_cache WHERE family=?",
        family,
      )
      .toArray()[0];
    if (!row) {
      tokenCacheEvent(family, "absent");
      return;
    }
    const binding = await this.binding(env, family);
    const now = Date.now();
    if (
      row.scope !== binding.scope ||
      row.issued_ms > now ||
      row.expires_ms <= now ||
      row.expires_ms - row.issued_ms !== providerTokenLifetime(family)
    ) {
      this.remove(family);
      tokenCacheEvent(
        family,
        row.scope !== binding.scope ? "scope_changed" : "expired",
      );
      return;
    }
    try {
      const value = new TextDecoder().decode(
        await crypto.subtle.decrypt(
          {
            name: "AES-GCM",
            iv: unhex(row.iv),
            additionalData: bytes(
              JSON.stringify([
                family,
                row.scope,
                row.issued_ms,
                row.expires_ms,
              ]),
            ),
          },
          binding.key,
          unhex(row.ciphertext),
        ),
      );
      if (value.length < 16 || value.length > 8192 || /[\r\n]/.test(value))
        throw new Error("invalid_token");
      tokenCacheEvent(family, "restored");
      return { value, issued: row.issued_ms, until: row.expires_ms };
    } catch {
      this.remove(family);
      tokenCacheEvent(family, "invalid");
      return;
    }
  }
  /** Persist the encrypted token with its original absolute expiry. */
  async save(env: Env, family: ProviderFamily, token: CachedProviderToken) {
    const { scope, key } = await this.binding(env, family);
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const encrypted = await crypto.subtle.encrypt(
      {
        name: "AES-GCM",
        iv,
        additionalData: bytes(
          JSON.stringify([family, scope, token.issued, token.until]),
        ),
      },
      key,
      bytes(token.value),
    );
    this.sql.exec(
      "INSERT INTO provider_token_cache VALUES(?,?,?,?,?,?) ON CONFLICT(family) DO UPDATE SET scope=excluded.scope,issued_ms=excluded.issued_ms,expires_ms=excluded.expires_ms,iv=excluded.iv,ciphertext=excluded.ciphertext",
      family,
      scope,
      token.issued,
      token.until,
      hex(iv),
      hex(encrypted),
    );
  }
}
/** Emit only the sanitized token family and cache outcome. */
export function tokenCacheEvent(family: ProviderFamily, result: string) {
  console.log(
    JSON.stringify({
      event: "provider_token_cache",
      correlationId: traceId(),
      family,
      result,
    }),
  );
}
