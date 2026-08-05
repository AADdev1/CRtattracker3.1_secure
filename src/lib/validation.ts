// Shared runtime input validation for server functions (TAGIC-IR-GL-001
// §3.1 / M4). Deliberately one blanket rule, not per-field business
// schemas: this app's real data (CR numbers, names, remarks, etc., all
// CMS-imported) has no fixed format — prefixes, suffixes, free text all
// occur — so a strict per-field schema would just be guesswork dressed up
// as validation. The actual goal is a floor against malformed/oversized
// payloads reaching business logic or the DB, not format enforcement.
import { z } from "zod";

export const text = z.string().trim().max(500);
export const optionalText = z.string().trim().max(500).nullable().optional();

// Wraps a zod schema as an inputValidator function — createServerFn's
// .inputValidator() expects a plain (data) => output function (this
// version of @tanstack/react-start has no built-in standard-schema
// support), so every call site does `validated(schema)` instead of the
// previous identity `(data) => data`. Typed with z.input<S> rather than
// `unknown` — TanStack Start infers each caller's required `{ data: ... }`
// shape from this function's parameter type, and `unknown` collapses that
// inference (callers stop being required to pass `data` at all).
export function validated<S extends z.ZodTypeAny>(schema: S) {
  return (data: z.input<S>): z.infer<S> => schema.parse(data);
}
