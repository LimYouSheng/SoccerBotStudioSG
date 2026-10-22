# Current system diagram

Current developer setup; client production migration remains pending. Dashed telemetry links are prepared but disabled/unattached. [One-page explanation](README.md) · [System rules](../SERVICE_CONTRACTS.md#part-1--current-system-rules).

```mermaid
flowchart TB
  Browser["Customer browser · Next.js static site"]
  subgraph CF["Cloudflare · developer account"]
    Assets["Worker Static Assets · HTML / JS / CSS"]
    Worker["Application Worker · protected HTTP API"]
    D1[("D1 · access, attempts, effects, payments, receipts, snapshots")]
    DO["Account Durable Object · queue and provider coordination"]
    SQLite[("DO SQLite · coordination and encrypted token cache")]
    Cron["Minute cron · recovery and due display warming"]
    Logs["Sanitized platform logs and diagnostic summaries"]
    Tail["Tail Worker · prepared, disabled"]
  end
  SB["SimplyBook · schedules, bookings, invoices"]
  HP["HitPay sandbox · hosted payment and readback"]
  TS["Turnstile · bot verification"]
  Mail["Resend · identity verification email"]
  Inbox["Customer inbox"]
  Grafana["Grafana Cloud Tempo + dashboards · not connected"]
  CI["GitHub · frontend / backend / live-email CI"]
  Pages["GitHub Pages · separate demo export"]
  Browser --> Assets
  Browser --> Worker
  Worker <--> D1
  Worker --> DO
  DO <--> SQLite
  DO <--> D1
  DO <--> SB
  DO <--> HP
  Browser -->|hosted checkout| HP
  HP -->|return navigation| Browser
  HP -->|authenticated webhook| Worker
  SB -->|provider callback| Worker
  Worker --> TS
  Worker --> Mail
  Mail --> Inbox
  SB -->|accepted booking notification| Inbox
  Cron --> Worker
  Worker --> Logs
  DO --> Logs
  Logs -.-> Tail
  Tail -.->|sanitized OTLP HTTP| Grafana
  CI -->|tested root artifact| Assets
  CI -->|tested Worker and migrations| Worker
  CI -->|separate demo artifact| Pages
```

Reconciliation verifies provider state before confirmation; arrows do not imply parallel provider writes or that a callback proves payment. D1 and Durable Object SQLite are separate stores. The diagram shows current integrations, not authorization to provision or activate them.

## Planned client delivery topology

Agreed target, not configured yet. The runtime components above apply independently to each environment.

```mermaid
flowchart TB
  Repo["One client-owned GitHub repository"]
  PR["Feature branch / PR · three CI gates"]
  StageGate["Trusted candidate · passing CI · one shared staging candidate"]
  Stage["Developer Cloudflare account · existing Worker / D1 / DO retained"]
  TestProviders["Separate SimplyBook test account · HitPay sandbox"]
  Review["Owner staging acceptance · merge"]
  Main["Main · three merged-revision CI gates"]
  Approval["GitHub production environment · owner approval"]
  Prod["Client Cloudflare account · separate Worker / D1 / DO"]
  LiveProviders["Client SimplyBook · HitPay live"]
  StageSecrets["Staging configuration / scoped credentials"]
  ProdSecrets["Production configuration / scoped credentials"]
  Repo --> PR --> StageGate
  StageGate -->|automatic staging deployment| Stage
  StageSecrets --> Stage
  Stage <--> TestProviders
  Stage --> Review --> Main --> Approval
  Approval -->|verified production artifact| Prod
  ProdSecrets --> Prod
  Prod <--> LiveProviders
```
