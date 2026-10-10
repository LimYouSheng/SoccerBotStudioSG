import { z } from "zod";
import { ApiError } from "./policy";
// Official getAdditionalFields metadata only; never retain supplied answer/default
// values, arbitrary option text, unknown keys, contact data or raw provider bodies.
const field = z.object({
  name: z.string().regex(/^[A-Za-z0-9_-]{1,128}$/),
  title: z.string().max(256),
  type: z.string().max(64),
  values: z.string().max(2048).nullable(),
  is_null: z.union([
    z.boolean(),
    z.literal(0),
    z.literal(1),
    z.literal("0"),
    z.literal("1"),
    z.null(),
  ]),
});
const schema = z.array(field).max(64);
export function discoveryFields(body: unknown) {
  const parsed = schema.safeParse(body);
  if (
    !parsed.success ||
    new Set(parsed.data.map((v) => v.name)).size !== parsed.data.length
  )
    throw new ApiError(503, "discovery_fields_unrecognized");
  return parsed.data.map((row) => {
    const options =
      row.values === null ? null : row.values.split(",").map((v) => v.trim());
    const exactPlayers =
      row.type === "select" &&
      options !== null &&
      options.length === 4 &&
      new Set(options).size === 4 &&
      options.every((v) => ["1", "2", "3", "4"].includes(v));
    return {
      identifier: row.name,
      playerTitleMatches: row.title === "Number of players",
      type: [
        "select",
        "digits",
        "checkbox",
        "textarea",
        "text",
        "date",
      ].includes(row.type)
        ? row.type
        : "unsupported",
      required:
        row.is_null === null
          ? null
          : row.is_null === false || row.is_null === 0 || row.is_null === "0",
      playerOptions: exactPlayers ? options : null,
      optionCount: options?.length ?? 0,
      // Candidate metadata is not a trusted persistence or business-policy grant.
      playerCandidate: row.title === "Number of players" && exactPlayers,
    };
  });
}
