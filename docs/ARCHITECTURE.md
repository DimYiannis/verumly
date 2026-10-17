# Architecture

One Postgres 17 database split into schemas with separate roles. The merchant side and the buyer side never read each other's data. The only person ↔ receipt link is `buyer.claims`.

## Components and database roles

```mermaid
flowchart LR
  subgraph Merchant side
    SDK[terminal-sdk<br/>SQLite / IndexedDB queue] -->|signed versions| MAPI[merchant-api :4001]
    MW[merchant-web :3000<br/>dashboard + simulator] --> DASH[dashboard-core]
  end
  subgraph Buyer side
    WALLET[wallet PWA :3001] --> BAPI[buyer-api :4002]
    PHONE[phone camera] -->|opens /r/id#secret| WALLET
  end
  WORKER[worker<br/>pg-boss jobs]
  MAPI -->|role merchant_api| M[(schema merchant<br/>RLS by org_id)]
  DASH -->|role dashboard| M
  BAPI -->|role buyer_api| B[(schemas buyer, leads)]
  BAPI -.->|read-only| M
  WORKER -->|role worker| B
  WORKER -.->|read, rollups, retention| M
  MAPI --> OPS[(ops: audit_log, idempotency_keys)]
  BAPI --> OPS
  MAPI -->|notify-version| Q[(pgboss queues)]
  BAPI -->|extract-upload| Q
  Q --> WORKER
  BAPI --> S3[(S3 uploads and exports)]
  WORKER --> S3
```

| Role | `merchant` | `buyer` | `leads` | `ops` |
| --- | --- | --- | --- | --- |
| `merchant_api` | read/write, RLS by org | none | none | audit insert, idempotency |
| `dashboard` | read/write, RLS by org (no receipt writes) | none | none | audit insert |
| `buyer_api` | read-only receipts, versions, location and organisation columns | read/write | read/write | audit insert |
| `worker` | read, plus rollups, lines, exports, retention deletes | read/write | read/write | audit insert |

`terminals` (key hashes, public keys) and `merchant_users` (password, TOTP) are unreachable from `buyer_api` and `worker`. Pre-auth lookups use three `SECURITY DEFINER` functions. See `docs/DECISIONS.md`.

## Golden path: QR to wallet

```mermaid
sequenceDiagram
  participant T as Terminal SDK
  participant M as merchant-api
  participant W as Wallet (phone)
  participant B as buyer-api
  T->>T: uuidv7 + 256-bit secret, sign v1 in state paid (Ed25519 over JCS)
  T-->>W: QR https://host/r/id#secret (no network needed)
  W->>W: read fragment, history.replaceState, keep secret in memory
  W->>B: POST /v1/resolve/view {receiptId, secret}
  B-->>W: pending (not uploaded yet)
  T->>M: POST /v1/receipts (Bearer, X-Signature, Idempotency-Key)
  M->>M: verify signature, validate CRF, lifecycle, store version (RLS)
  W->>B: retry resolve/view
  B-->>W: receipt (issued = paid, no pre-bill banner)
  W->>B: POST /v1/me/claims (session token, secret in body)
  B->>B: sha256(secret) constant-time check, INSERT claims (PK receipt_id)
  T->>M: POST version 2 (void, only if the till cancels the sale)
  M->>Q: notify-version job
  Q->>B: worker looks up the claim, web-push to the owner
```

## Offline

```mermaid
flowchart TD
  A[Sale on terminal] --> B[sign and commit to SQLite outbox + QR shown]
  B --> C{API reachable?}
  C -- no --> D[retry with exponential backoff + jitter]
  D --> C
  C -- yes --> E[ordered flush: single POST, or batch up to 500]
  E --> F{server answer}
  F -- created/replayed --> G[remove from outbox]
  F -- version_gap / 5xx --> D
  F -- 4xx other --> H[dead-letter item and later versions of that receipt]
  W1[Buyer opens link offline] --> W2[pending claim in IndexedDB, shown as Arriving]
  W2 --> W3[retry on app open, online, visibilitychange, up to 7 days]
```

## Photo extraction

```mermaid
flowchart LR
  U[Upload to S3 via presigned PUT] --> J[extract-upload job]
  J --> X{EXTRACTOR}
  X -- recorded --> R[fixtures sha256.qianfan.json]
  X -- http --> Q[Qianfan-OCR via vLLM]
  R --> P[receipt-nl parser]
  Q --> P
  P --> V{checks + printed totals agree?}
  V -- yes --> D[done]
  V -- no --> N[needs_review: user corrects]
  D --> M{KvK / VAT ID belongs to an org and an unclaimed receipt has the same gross within 30 min?}
  M -- yes --> MR[matched_receipt_id: offer replace]
  M -- no --> L[upsert lead by merchant_key; status new at LEAD_THRESHOLD uploaders]
```
