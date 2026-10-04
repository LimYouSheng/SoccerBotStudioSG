# SoccerBotStudio — Service Contracts

Canonical boundary reference, introduced 4 October 2026 under the latest OneFitfinity process. Rules & Architecture owns product/security invariants; Journey owns changes and evidence. This document describes the actual initial interface and labels future requirements. It does not create HTTP endpoints.

## Composition and authority

`src/services/index.ts` selects four demo adapters only. `src/services/contracts.ts` owns their TypeScript interfaces; `src/domain/booking.ts` and `contact.ts` own relevant runtime schemas. There is no production adapter, API client, Worker, provider SDK or mode flag. Booking and identity methods are synchronous browser operations; enquiry alone returns a Promise. Do not pretend these positional signatures already meet the future named asynchronous request contract.

Demo state is versioned, schema-checked browser storage. The booking provider in `src/features/booking/provider.tsx` orchestrates React state, draft persistence, route prerequisites and simulated payment timers. It is not a server authorization boundary. Synthetic identity may expire; its current-session check in provider checkout is UI orchestration, not production service security. Browser IDs, stored email and confirmation objects are untrusted for live operations.

## Implemented operations — demo only

Inputs below are actual current method names and types, not proposed URLs. Errors are ordinary `Error` strings rather than a stable HTTP/error-code envelope.

| Operation | Current inputs | Result and behaviour | Failure / authority / retry boundary |
| --- | --- | --- | --- |
| `booking.instructors` | `slots: Slot[]` | `InstructorId[]` from deterministic eligibility fixtures; empty selection gives no instructors | Does not query real schedules or reserve capacity |
| `booking.availability` | `date: string` | `AvailableSlot[]`, each date/start plus boolean availability | Deterministic studio occupancy plus local paid inventory; does not remove elapsed slots today |
| `booking.checkout` | `draft`, `previous: Attempt \| null`, optional `simulateConflict` | `Attempt` with new ID, immutable draft, `ready`, no booking and no provider writes | Rejects locked attempt, invalid draft/contacts/policy, missing/ineligible instructor and final-slot conflicts; repeated fresh checkouts are not a durable production idempotency system |
| `booking.pay` | `attempt`, chosen demo `outcome` | For ready/declined, returns checking state and one-second deadline; otherwise unchanged | The caller chooses the simulated outcome; no card collection or hosted checkout |
| `booking.check` | `attempt` | Pending → checking with simulated success; other states unchanged | Local status simulation only; not provider reconciliation |
| `booking.resolve` | `attempt`, optional `now` | Before deadline/no checking: unchanged; other outcomes: declined/pending/late; success creates or reuses local receipt and paid state | Reuses receipt by attempt ID. Missing studio allocation yields late. Browser storage writes are separate, not a cross-request transaction or provider reservation |
| `identity.read` | none | `VerifiedIdentity \| null`; chooses unexpired demo session/local record | Browser state is forgeable; never a live identity token |
| `identity.challenge` | `email` | Normalized email, ten-minute expiry, unused flag and attempt count | Invalid email throws; does not send email or perform server rate limiting |
| `identity.verify` | challenge, code, remember | Accepts demo code `360360`; consumes challenge and saves email/expiry (12 hours or 30 days) | Wrong, expired, reused or five-attempt challenge rejects; mutable local challenge is not secure verification |
| `identity.signOut` | none | Clears both demo identity stores; returns void | Does not revoke a server/provider session |
| `identity.profile` | `email` | Contact defaults plus only saved name/phone/email, or null | Exact email must match current demo identity; no SimplyBook lookup or shared-email conflict resolution |
| `identity.saveProfile` | `draft` | For matching member identity, stores name/phone only; returns void | Mismatched/guest identity no-op; does not update provider contact records |
| `enquiry.submit` | `Enquiry` record | Promise of `{ email, delivered: false }` after validation | Invalid contact/type/message/guest count/date throws; no email/message is sent |
| `assistant.reply` | `text`, `booking: Booking \| null` | Deterministic help text and local receipt summary; changes/refunds direct to contact | No LLM, external tools, provider query, authorization or write; no assistant output grants authority |

Supporting boundaries: `src/services/storage.ts` parses versioned draft/attempt data and tolerates unavailable/malformed browser storage; this can discard local state and must not be reused for durable live attempts. `exports.ts` builds ICS text and downloads PDF/calendar from a supplied confirmed demo snapshot; download initiation does not prove readable bytes, device save or external delivery. Production confirmation must be fetched through an authorized capability first.

## Current data and state model

- `Slot`: date plus local start time; no provider booking ID.
- `BookingDraft`: guest/member mode, account email, 1–4 players, nullable demo instructor, up to 100 selected slots, contact and policy acknowledgement. The 100-slot limit is a current schema bound, not approved live cart size.
- `Attempt`: ID, reviewed draft, status, selected demo outcome, checking deadline, optional booking. Status set: `ready`, `checking`, `declined`, `pending`, `late`, `paid`.
- `Booking`: reference, creation timestamp, frozen draft, studio-assigned sessions and total cents. It has no SimplyBook/SBPay/HitPay invoice association yet.
- Checking/pending/late/paid lock draft/payment mutation. Decline is retryable. Late displays help without another payment. Paid leads to confirmation. Draft edits clear acceptance and the earlier unlocked attempt.
- Missing live states include explicit expired/unknown/partial failure/cleanup-required distinctions. Existing demo late/pending labels must not be used to hide those outcomes.

## Future Worker contract requirements — not implemented endpoints

Before connecting a screen, document its named request/response schema, bounded inputs, typed errors, identity/capability derivation, permissions, environment mapping, idempotency/stale-write rules, provider authority and actual availability. Do not invent endpoint paths or claim an operation is live until its owner exists and is verified.

| Capability family | Required server result / authority | Required failure and repeat semantics |
| --- | --- | --- |
| Availability and instructor eligibility | Authoritative mapped service/resource/instructor times, prices and relevant freshness | Validate Singapore time, capacity and eligibility on every applicable path; no selection hold implied |
| Email challenge / verify / session | Expiring single-use challenge and protected session; principal derived server-side | Abuse/rate limits, replay/expiry, wrong code, invalid/revoked session; no account enumeration or browser-chosen verified identity |
| Approved contact prefill | Only allowed name/phone for safely matched verified email | Missing/shared/duplicate results handled without exposing another person's details; user can correct |
| Create/recover checkout attempt | Correlated booking references and matched invoice/payment association only after all sessions accepted | Stable idempotency identity, mismatch/stale-request rejection, unknown-write reconciliation, partial-failure compensation restricted to new confirmed-unpaid records |
| Payment status / callback | Authenticated provider result bound to the correct account, attempt, invoice, amount and customer capability | Signature/replay validation where applicable; duplicate/out-of-order callbacks; pending/expired/late/unknown and incomplete cleanup; never trust return URL alone |
| Confirmation and exports | Protected read of verified final records and allowed contact fields | Deny unrelated/direct-ID access; no duplicate booking/payment on reload; preserve original references |
| Enquiry delivery, if retained in live scope | Explicit accepted/delivered/failed/unknown distinction for the chosen server mail path | Bounded content, spam protection, duplicate/unknown delivery handling; no claim of delivery from local success |

The exact supported native SimplyBook/SBPay/HitPay route and entitlements must be proved before freezing payment contracts. Decide and document any minimal durable attempt/recovery ledger explicitly; it cannot become a replacement booking database. A live API may require asynchronous UI coordination and updated types—this documentation review makes no such frontend changes.

## Required evidence and change discipline

Update this owner whenever signatures, results, error semantics, permissions, retry/version behaviour or live capabilities change. Review any generated Worker/OpenAPI snapshot separately when implemented; no generated HTTP contract exists now. Test adapter contracts using deterministic faults, then Worker runtime/D1 integration and authorized provider accounts. Browser/physical acceptance is user-owned. Mocks, a registered method, a green build and a provider sandbox result are separate evidence levels.
