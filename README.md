# SOCCERBOTSTUDIO — Staff Chat PWA

Upload the **contents of this folder** to a GitHub repository. The `index.html`, `manifest.webmanifest`, `sw.js` and `icons` folder must sit together.

1. In the repository, open **Settings → Pages**.
2. Choose **Deploy from a branch**, then the branch containing these files and **/ (root)**.
3. Open the published HTTPS address when deployment finishes.
4. Sign in using the prefilled account.
5. Install from the browser menu, or use **Share → Add to Home Screen** on iPhone/iPad.

The app also supports a repository subfolder. All manifest, icon, launch and worker paths are relative. The installed app opens `index.html#admin`. The public website remains available through the logo or **Back to website**. `#trainer` opens the separate read-only trainer schedule simulation.

## Demo accounts

| Role | Email | Password |
| --- | --- | --- |
| Manager | admin@soccerbotstudio.sg | demo123 |
| Staff | staff@soccerbotstudio.sg | demo123 |

The **+** button in the chat opens all workflows and simulation controls. Choose a session role or a processing scenario there. **New chat** clears the conversation. **Reset simulation** restores the sample bookings, requests and action records.

## Workflow coverage

Based on **APP404-SBS-Q-AI-001**, A1–A12.

| Quote | Included simulation |
| --- | --- |
| A1 | Staff chat, clarification, structured proposals, confirmation, results and native-admin handoff. |
| A2 | Studio and trainer schedules, working periods, eligible 40-minute slots, capacity/conflict checks, alternatives and unheld slots. |
| A3 | Booking lookup by reference, customer, date/time and trainer. Multiple matches require a selection. Booking cards show session, player and contact details. |
| A4 | Booking/payment status, unknown payment state, appointment/cancellation/assignment summaries, gaps and unresolved actions. |
| A5 | Create, reschedule, reassign and cancel. Exact previews, explicit confirmation, validation and simulated read-back. Native payment/refund handoff only. |
| A6 | Trainer requests, conflicts, approval and decline, followed by save/verification. Existing bookings cannot be silently changed by an availability approval. |
| A7 | Manager-only closure, exact period, frozen affected set, per-booking outcomes, cancellation notices and partial recovery. No automatic refunds. |
| A8 | Action records include proposal, actor, time, state, result, attempts and support reference. Staff see their own action history. Managers can review all records. |
| A9 | Embedded trainer WhatsApp simulation: guided menus, back/cancel, reminders, availability submission/change, clarification, editing, confirmation, request/outcome status and a read-only schedule-PWA link. |
| A10 | Simulated manager/staff permissions. The trainer channel is fixed to Marcus and shows only his own requests and schedule. |
| A11 | Two-minute, actor-bound confirmations. Current-state checks block stale proposals. Duplicate confirmation does not repeat an action. |
| A12 | Local action records survive refresh. Queued, failed and uncertain results, controlled retries, duplicate/older-event handling, read-back verification and native fallback. |

The trainer approval policy and five-booking closure limit are **demo fixtures**, not final agreed policies. Discovery must confirm the trainer workflow, reminders, cut-offs, approvals, closure cap and notification procedure.

## Useful demo prompts

- Show today's schedule
- Show available slots tomorrow
- Show trainer working periods tomorrow
- Find Maya
- Find SB-2048
- Create a booking
- Reschedule SB-2048
- Reassign SB-2048
- Cancel SB-2054
- Review trainer requests
- Remind trainers to submit next week availability
- Open trainer WhatsApp
- Show this week summary
- Show payment status
- Close studio today
- Show action history
- Show unresolved actions
- How do refunds work?

The dataset is anchored to **3 October 2026, Singapore time**. All names and records in the staff workflow are sample data. The retained public-site branding/assets come from the supplied demo.

## Processing scenarios

Select a **Next action** scenario from the **+** menu before confirming a proposal.

| Scenario | Expected result |
| --- | --- |
| Standard processing | Queued → saved → verified. |
| Temporary failure | No write. A bounded retry is available. |
| Uncertain response | The simulated provider write occurs, but completion is not claimed until the saved result is checked. |
| Partial closure | One cancellation needs review. Verify it before retrying only the incomplete work. |
| Booking changed elsewhere | A booking changes after preview. Confirmation is blocked until a fresh preview. Applies to create, reschedule, reassign or cancellation. |
| Duplicate event | A repeated completion event is ignored after the first result. |
| Out-of-order event | An older queued event cannot overwrite a completed result. |

## PWA files

- `index.html` — standalone interface, embedded assets and local simulation logic.
- `manifest.webmanifest` — identity, relative scope/start URL and standalone display.
- `sw.js` — static shell caching and offline navigation fallback.
- `icons/` — 192px, 512px, maskable and Apple home-screen icons, plus SVG source.
- `.nojekyll` — GitHub Pages static-file handling.

Open the hosted page online once so the worker can cache the app. Offline refresh then uses the cached shell. A downloaded HTML file can demonstrate the chat, but installation/offline worker support requires HTTPS hosting or localhost.

To publish a later version, change the cache version in `sw.js` with the app update. Browser storage retains this demo's local state until **Reset simulation** or browser data is cleared.

## Scope of this package

This is a static demonstration, not production authentication or a live SimplyBook/OpenAI/WhatsApp integration. It makes no booking, payment or messaging API calls. Credentials are demonstration values, and data is stored only in this browser. Provider execution/read-back, webhook authentication, enrolled-number verification, durable server queues, real alerts and recovery are simulated. Production infrastructure and the quotation's automated/UAT, physical-device, launch and handover acceptance gates remain separate work.

No API keys, production credentials or real customer records should be added to this public GitHub Pages demo.

Reference: [MDN PWA installability](https://developer.mozilla.org/en-US/docs/Web/Progressive_web_apps/Guides/Making_PWAs_installable), [manifest start URL](https://developer.mozilla.org/en-US/docs/Web/Progressive_web_apps/Manifest/Reference/start_url).

## Verification

38 browser checks passed, covering the workflows above, mobile viewport layout, manifest installability and offline reload at a repository-style subpath. See `verification.json`. Browser verification used headless Chromium with a 390px mobile viewport. This is not physical-device testing or the quotation’s production UAT acceptance.
