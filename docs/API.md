# API

Both APIs generate their OpenAPI 3.1 document from the shared Zod schemas in `packages/schema` (`@asteasolutions/zod-to-openapi`) and serve it at **`GET /docs`**:

- merchant-api: http://127.0.0.1:4001/docs
- buyer-api: http://127.0.0.1:4002/docs

`/docs` covers the request and response shapes of the main routes; the table below lists every route. All amounts are integer euro cents, timestamps are UTC. Errors are `{ "error": "<code>" }`. Logs carry request ids only.

## merchant-api (terminals)

Every request: `Authorization: Bearer <terminal API key>` and `X-Terminal-Id`. Every POST also carries `X-Signature` (Ed25519 over the raw body). Writes need `Idempotency-Key`.

| Method | Path | Notes |
| --- | --- | --- |
| POST | `/v1/receipts` | Create receipt with v1 and `claimSecretHash`. 201 created, 200 replayed. |
| POST | `/v1/receipts/:id/versions` | Next version. 409 `version_gap`, `bad_transition`; 422 `invalid_receipt`. |
| POST | `/v1/receipts:batch` | ≤ 500 items, per-item results, partial success. |
| GET | `/v1/receipts/:id` | Own organisation only. Never contains claim information. |
| GET | `/v1/terminals/me` | Terminal config and server time. |

Same key with different content: 409 `idempotency_conflict` and an `ops.audit_log` row. A failed signature: 401 `bad_signature` and an audit row.

## buyer-api

Public resolver (no login): 30 requests/min per IP, 10 failed secrets per receipt per hour, then 429.

| Method | Path | Notes |
| --- | --- | --- |
| POST | `/v1/resolve/secret` | `{receiptId, secret}` → `pending` or preview. Wrong secret: 404. |
| POST | `/v1/resolve/view` | Latest CRF and all versions. |
| GET | `/v1/push/vapid-public-key` | Web Push public key. |

Authenticated (`Authorization: Bearer <session token>`; email code via Mailpit locally):

| Method | Path | Notes |
| --- | --- | --- |
| POST | `/v1/auth/email/start`, `/v1/auth/email/verify`, `/v1/auth/logout` | 6-digit code, 10 min. |
| POST | `/v1/me/claims` | `{receiptId, secret, source}`. 201; 200 if already yours; 409 `already_claimed`; 410 `claim_expired`. |
| GET | `/v1/me/receipts` | Cursor pagination; filters `q`, `state`, `from`, `to`, `category`, `merchant`. |
| GET | `/v1/me/receipts/:id` | Latest CRF and versions; only if claimed by the caller. |
| GET | `/v1/me/receipts/:id/pdf` | Server-rendered PDF (pdfmake). |
| POST | `/v1/me/uploads` | `{contentType, size}`; JPEG, PNG or WEBP only (PDF and HEIC are 400), at most 10 MB. Returns a presigned S3 PUT the browser uses directly. Then `POST /v1/me/uploads/:id/complete`. |
| GET / PATCH | `/v1/me/uploads`, `/v1/me/uploads/:id` | Status; corrections for `needs_review` (lines are re-categorised; `userCategory` per line is kept). The list takes `?category=` (stored category of any line). |
| PUT | `/v1/me/uploads/:id/categories` | `{lines: [{index, category \| null}]}`: the buyer's own category per line (`null` clears it). `done` and `needs_review` only; changes nothing else. |
| GET | `/v1/me/uploads/:id/photo` | The photo bytes (bearer auth, owner only, `cache-control: private, no-store`). |
| DELETE | `/v1/me/uploads/:id` | Removes the S3 object, then the row. 204; 404 unless it is yours. |
| POST | `/v1/me/uploads/:id/accept-match` | Replace the photo with the matched official receipt (claim source `photo_match`). |
| GET | `/v1/me/insights` | Spend per month, per category (stored line categories, health as `overig`), top merchants, and `vatPerRate` (VAT per rate over claimed final receipts and done uploads). |
| GET / PUT | `/v1/me/consents` | Append-only; all off by default. |
| POST / DELETE | `/v1/me/push-subscriptions`, `/v1/me/push-subscriptions/:id` | Web Push. |
| GET | `/v1/me/export` | JSON export of everything about the user. |
| DELETE | `/v1/me` | Soft delete; the retention job hard-deletes after 30 days. |

## Dashboard (merchant-web)

Nitro routes under `/api/dashboard/**`, session cookie (httpOnly, SameSite=Lax) after password and TOTP; roles owner, manager, accountant (read-only). The browser simulator reaches merchant-api through the same-origin proxy `/sim-api/**`.
