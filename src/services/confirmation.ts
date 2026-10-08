import { z } from "zod";
const decisionSchema = z.discriminatedUnion("status", [
  z.object({ status: z.literal("confirmed"), reason: z.literal("verified") }),
  z.object({ status: z.literal("pending"), reason: z.string() }),
  z.object({ status: z.literal("unresolved"), reason: z.string() }),
  z.object({ status: z.literal("invalid"), reason: z.string() }),
  z.object({ status: z.literal("denied"), reason: z.literal("access_denied") }),
]);
export async function readConfirmation(attemptId: string, signal: AbortSignal) {
  if (!/^[a-f0-9-]{36}$/.test(attemptId))
    throw new Error("confirmation_unavailable");
  const response = await fetch(
    `/api/attempts/${encodeURIComponent(attemptId)}/confirmation`,
    {
      credentials: "same-origin",
      cache: "no-store",
      redirect: "error",
      signal,
      headers: { Accept: "application/json" },
    },
  );
  if (!response.ok) throw new Error("confirmation_unavailable");
  return decisionSchema.parse(await response.json());
}
