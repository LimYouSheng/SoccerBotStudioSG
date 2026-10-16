import { z } from "zod";
import { ApiError, digest } from "./policy";
import { isHitpayCheckoutUrl } from "../src/domain/native-checkout";

export const hitpayId = z.string().uuid();
export function hitpaySetting(env: Env, name: string) {
  const value: unknown = Reflect.get(env, name);
  return typeof value === "string" ? value : "";
}
export function hitpayRecoveryEnabled(env: Env) {
  return (
    env.ENVIRONMENT === "developer" &&
    hitpaySetting(env, "HITPAY_RECOVERY") === "enabled"
  );
}
export function hitpayConfiguration(env: Env) {
  const key = hitpaySetting(env, "HITPAY_SANDBOX_API_KEY");
  const businessId = hitpayId.parse(hitpaySetting(env, "HITPAY_BUSINESS_ID"));
  const merchant = z
    .string()
    .regex(/^[a-zA-Z0-9_-]{1,80}$/)
    .parse(hitpaySetting(env, "HITPAY_MERCHANT"));
  if (!hitpayRecoveryEnabled(env) || !key || /[\r\n]/.test(key))
    throw new ApiError(503, "hitpay_unavailable");
  return { key, businessId, merchant };
}
export function assertHitpayCreation(env: Env) {
  hitpayConfiguration(env);
  if (
    hitpaySetting(env, "HITPAY_CHECKOUT") !== "enabled" ||
    hitpaySetting(env, "HITPAY_WEBHOOK") !== "enabled" ||
    hitpaySetting(env, "HITPAY_CONTRACT_ACCEPTED") !== "sandbox-reviewed" ||
    !hitpaySetting(env, "HITPAY_WEBHOOK_SALT") ||
    hitpaySetting(env, "SIMPLYBOOK_EXTERNAL_PAYMENT") !== "sandbox-reviewed" ||
    !/^[a-zA-Z0-9_-]{1,64}$/.test(
      hitpaySetting(env, "SIMPLYBOOK_EXTERNAL_PROCESSOR"),
    )
  )
    throw new ApiError(503, "hitpay_checkout_disabled");
}
export const paymentScopeSchema = z.strictObject({
  accountId: z.string(),
  environmentId: z.literal("developer"),
  companyLogin: z.string(),
  businessId: hitpayId,
  merchant: z.string(),
  externalProcessor: z.string().regex(/^[A-Za-z0-9_-]{1,64}$/),
  keyDigest: z.string().regex(/^[a-f0-9]{64}$/),
  attemptId: hitpayId,
  intentHash: z.string(),
  associationJson: z.string(),
  invoiceId: z.string(),
  customerId: z.string(),
  totalMinor: z.number().int().positive().safe(),
  currency: z.literal("SGD"),
});
export type PaymentScope = z.infer<typeof paymentScopeSchema>;
export async function assertPaymentScope(env: Env, scope: PaymentScope) {
  const config = hitpayConfiguration(env);
  if (
    scope.accountId !== env.DEPLOYMENT_ACCOUNT_ID ||
    scope.environmentId !== env.ENVIRONMENT ||
    scope.companyLogin !== hitpaySetting(env, "SIMPLYBOOK_DEV_COMPANY_LOGIN") ||
    scope.businessId !== config.businessId ||
    scope.merchant !== config.merchant ||
    scope.externalProcessor !==
      hitpaySetting(env, "SIMPLYBOOK_EXTERNAL_PROCESSOR") ||
    scope.keyDigest !== (await digest(config.key))
  )
    throw new ApiError(409, "hitpay_scope_mismatch");
}
export function minorAmount(value: unknown) {
  if (typeof value !== "string" && typeof value !== "number")
    throw new ApiError(409, "hitpay_money_mismatch");
  const match = /^(0|[1-9]\d{0,8})(?:\.(\d{1,2}))?$/.exec(String(value));
  if (!match) throw new ApiError(409, "hitpay_money_mismatch");
  return Number(match[1]) * 100 + Number((match[2] || "").padEnd(2, "0"));
}
const payment = z.object({
  id: hitpayId,
  amount: z.unknown(),
  currency: z.string(),
  status: z.string(),
  refunded_amount: z.unknown().optional(),
});
const requestSchema = z.object({
  id: hitpayId,
  reference_number: z.string(),
  amount: z.unknown(),
  currency: z.string(),
  status: z.enum(["pending", "completed", "failed", "expired", "canceled"]),
  allow_repeated_payments: z.literal(false),
  is_currency_editable: z.literal(false),
  business_id: hitpayId.optional(),
  expiry_date: z.string().nullable().optional(),
  url: z.string().max(2048),
  payments: z.array(payment).max(20).optional(),
});
// Field names only: never retain returned URLs, account IDs or payloads.
export class HitpayAssociationError extends ApiError {
  constructor(
    readonly field:
      | "request_id"
      | "reference"
      | "currency"
      | "amount"
      | "business"
      | "checkout_url_format"
      | "checkout_path",
  ) {
    super(409, "hitpay_association_mismatch");
  }
}
export function hitpayFailureReason(error: unknown) {
  return error instanceof HitpayAssociationError
    ? "hitpay_mismatch_" + error.field
    : error instanceof ApiError
      ? error.code
      : "hitpay_verification_unavailable";
}
export function verifyHitpayRequest(
  raw: unknown,
  scope: PaymentScope,
  reference: string,
  requestId?: string,
) {
  const p = requestSchema.safeParse(raw);
  if (!p.success) throw new ApiError(409, "hitpay_representation_unverified");
  const value = p.data;
  if (requestId !== undefined && value.id !== requestId)
    throw new HitpayAssociationError("request_id");
  if (value.reference_number !== reference)
    throw new HitpayAssociationError("reference");
  if (value.currency.toUpperCase() !== scope.currency)
    throw new HitpayAssociationError("currency");
  if (minorAmount(value.amount) !== scope.totalMinor)
    throw new HitpayAssociationError("amount");
  if (value.business_id !== undefined && value.business_id !== scope.businessId)
    throw new HitpayAssociationError("business");
  if (!isHitpayCheckoutUrl(value.url))
    throw new HitpayAssociationError("checkout_url_format");
  if (
    new URL(value.url).pathname !==
    `/payment-request/@${scope.merchant}/${value.id}/checkout`
  )
    throw new HitpayAssociationError("checkout_path");
  let paymentId: string | null = null;
  if (value.status === "completed") {
    const successful = (value.payments || []).filter(
      (p) => p.status === "succeeded",
    );
    if (
      successful.length !== 1 ||
      successful[0].currency.toUpperCase() !== scope.currency ||
      minorAmount(successful[0].amount) !== scope.totalMinor ||
      (successful[0].refunded_amount !== undefined &&
        minorAmount(successful[0].refunded_amount) !== 0)
    )
      throw new ApiError(409, "hitpay_payment_unverified");
    paymentId = successful[0].id;
  }
  let expiresAtMs: number | null = null;
  if (value.expiry_date) {
    const local = value.expiry_date.replace(" ", "T");
    if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}$/.test(local))
      throw new ApiError(409, "hitpay_expiry_unverified");
    const parsed = Date.parse(local + "+08:00");
    if (
      !Number.isFinite(parsed) ||
      new Date(parsed + 28800000).toISOString().slice(0, 19) !== local
    )
      throw new ApiError(409, "hitpay_expiry_unverified");
    expiresAtMs = parsed;
  }
  return {
    id: value.id,
    url: value.url,
    status: value.status,
    paymentId,
    expiresAtMs,
  };
}
