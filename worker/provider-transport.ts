import { measure } from "./diagnostics";
import { ApiError } from "./policy";

export type ProviderFamily = "public" | "admin";
export type ProviderOperation =
  | "public-auth"
  | "admin-auth"
  | "identity"
  | "tariff"
  | "historical-booking"
  | "historical-invoice";
export type ProviderSecrets = {
  company: string;
  login: string;
  publicKey: string;
  adminKey: string;
};
export function providerSecrets(env: Env): ProviderSecrets {
  const read = (name: string) => {
    const value: unknown = Reflect.get(env, name);
    if (
      typeof value !== "string" ||
      !value.trim() ||
      value !== value.trim() ||
      /[\r\n]/.test(value)
    )
      throw new ApiError(503, "provider_credentials_missing");
    return value;
  };
  return {
    company: read("SIMPLYBOOK_DEV_COMPANY_LOGIN"),
    login: read("SIMPLYBOOK_DEV_ADMIN_LOGIN"),
    publicKey: read("SIMPLYBOOK_DEV_API_KEY"),
    adminKey: read("SIMPLYBOOK_DEV_ADMIN_API_USER_KEY"),
  };
}

// Only this module owns physical dispatch. No caller-supplied URL or RPC method.
export async function providerRequest(
  operation: ProviderOperation,
  secrets: ProviderSecrets,
  token: string | undefined,
  dispatch: {
    reserve: () => Promise<string>;
    finish: (id: string, cooldown: number) => void;
  },
): Promise<unknown> {
  const rpcId = crypto.randomUUID();
  let url: string, method: string, body: string | undefined;
  switch (operation) {
    case "public-auth":
      url = "https://user-api.simplybook.me/login";
      method = "POST";
      body = JSON.stringify({
        jsonrpc: "2.0",
        id: rpcId,
        method: "getToken",
        params: [secrets.company, secrets.publicKey],
      });
      break;
    case "admin-auth":
      url = "https://user-api-v2.simplybook.me/admin/auth";
      method = "POST";
      body = JSON.stringify({
        company: secrets.company,
        login: secrets.login,
        password: secrets.adminKey,
      });
      break;
    case "identity":
      url = "https://user-api-v2.simplybook.me/admin/company/info";
      method = "GET";
      break;
    case "tariff":
      url = "https://user-api-v2.simplybook.me/admin/tariff/current";
      method = "GET";
      break;
    case "historical-booking":
      url = "https://user-api-v2.simplybook.me/admin/bookings/23";
      method = "GET";
      break;
    case "historical-invoice":
      url = "https://user-api-v2.simplybook.me/admin/invoices/23";
      method = "GET";
      break;
    default:
      throw new ApiError(503, "provider_operation_unavailable");
  }
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    Accept: "application/json",
  };
  if (operation !== "public-auth" && operation !== "admin-auth") {
    if (!token) throw new ApiError(503, "provider_auth_required");
    headers["X-Company-Login"] = secrets.company;
    headers["X-Token"] = token;
  }
  const id = await dispatch.reserve();
  // Reservation is durable before fetch; uncertain transport keeps the slot held.
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 15000);
  let complete = false;
  let cooldown = 0;
  return await measure("provider", async () => {
    try {
      const response = await fetch(url, {
        method,
        headers,
        body,
        redirect: "manual",
        signal: controller.signal,
      });
      if (response.status >= 300 && response.status < 400) {
        await response.body?.cancel();
        complete = true;
        cooldown = 60000;
        throw new ApiError(503, "provider_redirect_denied");
      }
      if (!response.ok) {
        await response.body?.cancel();
        complete = true;
        cooldown = 60000;
        throw new ApiError(
          503,
          response.status === 401 || response.status === 403
            ? "provider_auth_failed"
            : "provider_http_failed",
        );
      }
      if (
        !response.headers
          .get("content-type")
          ?.toLowerCase()
          .includes("application/json")
      ) {
        await response.body?.cancel();
        complete = true;
        cooldown = 60000;
        throw new ApiError(503, "provider_representation_unknown");
      }
      const reader = response.body?.getReader();
      if (!reader) throw new ApiError(503, "provider_representation_unknown");
      const chunks: Uint8Array[] = [];
      let size = 0;
      try {
        for (;;) {
          const chunk = await reader.read();
          if (chunk.done) break;
          size += chunk.value.byteLength;
          if (size > 131072) {
            await reader.cancel();
            complete = true;
            throw new ApiError(503, "provider_response_too_large");
          }
          chunks.push(chunk.value);
        }
      } finally {
        reader.releaseLock();
      }
      complete = true;
      const bytes = new Uint8Array(size);
      let offset = 0;
      for (const chunk of chunks) {
        bytes.set(chunk, offset);
        offset += chunk.length;
      }
      const value: unknown = JSON.parse(
        new TextDecoder("utf-8", { fatal: true, ignoreBOM: false }).decode(
          bytes,
        ),
      );
      if (operation === "public-auth") {
        if (
          !value ||
          typeof value !== "object" ||
          !("id" in value) ||
          value.id !== rpcId ||
          !("result" in value) ||
          "error" in value
        )
          throw new ApiError(503, "provider_rpc_failed");
        return value.result;
      }
      return value;
    } catch (error) {
      cooldown = 60000;
      if (error instanceof ApiError) throw error;
      throw new ApiError(
        503,
        complete
          ? "provider_representation_unknown"
          : "provider_transport_uncertain",
      );
    } finally {
      clearTimeout(timer);
      if (complete) dispatch.finish(id, cooldown);
    }
  });
}
