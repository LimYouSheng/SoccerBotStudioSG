# SOCCERBOTSTUDIO Singapore — Admin prototype

A responsive browser portal with three views:

- **Schedule:** month calendar, two studios, 40-minute slots, bulk opening/blocking with a reason, and manual reservations.
- **Bookings:** search and filter bookings; edit customer details, players, activity, notes and sessions across dates; cancel reservations.
- **Revenue:** payments, refunds, net collected and outstanding balances; date/studio filters and CSV export.

Open `index.html` for a browser demo. Sample data and edits are saved on the current device. Customer information in the sample is fictional.

## Install as a PWA

Keep the whole folder together and serve it over HTTPS. A local development server also works for desktop testing:

```bash
cd SoccerBotStudio_Admin
python3 -m http.server 8080
```

Open `http://localhost:8080/index.html` on that computer. Use **Install app** when supported. For phone testing, use an HTTPS URL; an ordinary HTTP address on your local network is insufficient for the service worker.

On iPhone or iPad, open the HTTPS site in Safari and choose **Share → Add to Home Screen**. On supporting desktop or Android browsers, use the browser's installation option. Load online once before testing offline. Install behavior varies by browser and OS.

Files included: the canonical `index.html`, `manifest.webmanifest`, `sw.js`, and four icons. All fonts, branding, UI styles and application code are embedded in the HTML. See [PWA installation guidance](https://web.dev/learn/pwa/installation) and [web app manifests](https://web.dev/learn/pwa/web-app-manifest).

## Booking and payment behavior

- Each studio has eighteen non-overlapping sessions from 10:00–22:00. A session ending at 17:20 is followed by one starting at 17:20.
- Rates match the current public prototype: S$88 weekday low peak, S$128 weekday peak, S$168 weekend. A weekday session extending beyond 17:00 uses peak pricing. GST is included; up to four players per session. Every session includes an instructor.
- Booked slots cannot be silently opened or blocked. Edit or cancel the booking explicitly first.
- Editing sessions recalculates the booking total but retains existing payments. Additional amounts become outstanding; a reduction can create an overpayment.
- Cancelling a reservation releases the slots and keeps its payment history. A refund must be recorded separately.
- **Record payment/refund** updates this demonstration ledger. It does not charge or refund a customer.
- Revenue uses payment/refund received dates. Outstanding shows all active bookings, independent of the selected date range. Studio allocations are fixed when each transaction is recorded.
- Cross-tab changes are detected. A stale open form must be closed and reopened before saving.

## Prototype boundary

This is a separate administrative demonstration. Its overrides and reservations are not connected to the public booking HTML, a payment processor, or a server. Browser storage is local, can be cleared, and does not synchronize across devices or guarantee multi-user reservations.

There is no authentication or server authorization in this prototype. Before using real customer data, add protected admin access, shared database inventory and atomic booking transactions, verified payment/refund integrations, durable audit records and backups. Do not publish this demo with real personal information.

To restore the sample data on a test device, remove the `soccerbotstudio-admin-demo-v1` local-storage entry in browser developer tools and reload.
