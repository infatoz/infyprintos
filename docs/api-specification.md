# API specification

Base: `/api/v1`  
Public (token, rate-limited): `/public`  
Health: `GET /health`

Auth: `Authorization: Bearer <accessToken>`  
Content type: `application/json` unless multipart upload.

## Envelope

Success:

```json
{ "success": true, "message": "OK", "data": {}, "meta": { "page": 1, "limit": 20, "total": 0, "pages": 1 } }
```

Error:

```json
{ "success": false, "code": "BAD_REQUEST", "message": "Validation failed", "errors": [], "details": {} }
```

`meta` is present on list endpoints. `errors` is always an array (may be empty).

## Auth — `/api/v1/auth`

| Method | Path | Auth | Description |
| --- | --- | --- | --- |
| POST | `/login` | no | email + password → access, refresh, user |
| POST | `/refresh` | refresh body | new access token |
| POST | `/logout` | yes | revoke refresh |
| GET | `/me` | yes | profile + permissions |
| PATCH | `/me` | yes | name, phone, avatar |
| POST | `/forgot-password` | no | always 200; token stored hashed |
| POST | `/reset-password` | no | token + new password; revokes sessions |

## Users & roles — `/api/v1/users`

| Method | Path | Permission |
| --- | --- | --- |
| GET | `/permissions` | authenticated |
| GET | `/roles` | users.view |
| POST | `/roles` | roles.manage |
| PATCH | `/roles/:id` | roles.manage |
| GET | `/` | users.view |
| POST | `/` | users.manage |
| PATCH | `/:id` | users.manage |
| POST | `/:id/revoke-sessions` | users.manage |

## Customers — `/api/v1/customers`

GSTIN (15-char format + Indian state code), PAN, and PIN code are validated on write. GSTN checksum is stored as `business.gstinChecksumValid` and does not reject known dummy GSTINs. Credit limit, credit terms and blocked status after create require `customers.credit` and a reason. Duplicate phone/email/GSTIN still return 409; merge is the controlled alternative.

| Method | Path | Permission |
| --- | --- | --- |
| GET | `/` `/tiers` `/credit-terms` `/gst-states` `/assignees` `/metrics` `/duplicates` | customers.view |
| GET | `/:id` | customers.view (`includeDeleted` needs customers.delete) |
| GET | `/:id/history` `/:id/statement` `/:id/contacts` `/:id/activities` | customers.view |
| GET | `/:id/credit-events` | customers.credit |
| POST | `/` | customers.create (issues membership card; may set initial credit limit) |
| PATCH | `/:id` | customers.update (credit fields need customers.credit + reason) |
| DELETE | `/:id` | customers.delete (archive) |
| POST | `/:id/restore` | customers.delete |
| POST | `/:id/merge` | customers.delete (`sourceId` + reason; reassigns orders/AR) |
| POST | `/:id/recalc-balances` | customers.update |
| POST | `/:id/membership/reissue` | customers.update (old QR token stops working) |
| POST/PATCH/DELETE | `/:id/addresses` | customers.update (one default address per type) |
| POST/PATCH/DELETE | `/:id/contacts` | customers.update |
| POST | `/:id/activities` | customers.update |
| POST | `/:id/documents` | customers.kyc |
| POST | `/:id/documents/:docId/verify` | customers.kyc |
| POST | `/:id/credit-hold` | customers.credit (`hold` + reason) |

List filters: `search`, `tierId`, `creditHold`, `active`, `type`, `source`, `assignedTo`, `taxRegistration`, `lifecycleStatus`, `overdue`, `kycExpired`, `archived`. Statement aging buckets: 0–30 / 31–60 / 61–90 / 90+.

## Catalog — `/api/v1/catalog`

Categories CRUD-lite, items list/get/create/patch, variants, price lists, `GET /price` resolver.

## Quotations — `/api/v1/quotations`

Server-priced documents. Never send client totals.

| Method | Path | Permission | Notes |
| --- | --- | --- | --- |
| GET | `/` `/:id` | quotations.view | Detail includes `versions` |
| POST | `/` | quotations.create | Snapshot stored as revision 1 |
| PATCH | `/:id` | quotations.update | Recalculates; increments revision |
| GET | `/:id/pdf` | quotations.view | PDFKit tax invoice-style quotation |
| POST | `/:id/send` | quotations.send | Opaque public token + expiry |
| POST | `/:id/cancel` | quotations.update | Not allowed after convert |

Public: `GET/POST /public/quotations/:token` approve or reject.

## Orders — `/api/v1/orders`

Backend recalculates every amount via `priceDocument()`. Frontend totals are ignored.

| Method | Path | Notes |
| --- | --- | --- |
| POST | `/preview` | Dry-run pricing (CGST/SGST/IGST, coupons, charges) |
| POST | `/` | Create; `Idempotency-Key` replays the same order |
| PATCH | `/:id` | Draft edit (`orders.edit`); server re-prices |
| GET | `/:id` | Order + timeline + designs + jobs + payments + invoices |
| GET | `/:id/timeline` | Organisation-scoped status history |
| GET | `/:id/invoice.pdf` | Generated tax invoice |
| POST | `/:id/status` | Transition matrix + design-before-print |
| POST | `/:id/payments` | Caps at balance due; duplicate `reference` replays |
| POST | `/:id/designs` | Artwork + public approval link |
| POST | `/from-quotation/:quotationId` | Approved quotes only; keeps quoted unit prices; idempotent convert |
| POST | `/:id/cancel` | Reason required |

`GET /settings/payment-methods` is available to POS (`orders.create`), not only owners.

## Idempotency

`Idempotency-Key` on `POST /orders` is unique per organization. Retrying Charge will not create a second ticket. Payment `reference` is unique per order; the same UPI ref returns the original receipt.

## Inventory — `/api/v1/inventory`

Stock quantity never changes except through `moveStock()` ledger rows.

| Method | Path | Notes |
| --- | --- | --- |
| GET | `/items` `/items/:id` `/units` `/suppliers` `/alerts` `/usage` `/analytics` | Valuation, low-stock, reserved qty |
| POST | `/items` | Opening qty writes an `opening` ledger row |
| PATCH | `/items/:id` | Cannot set `stockQty` / `reservedQty` |
| POST | `/move` | Inward/outward/wastage/return/damaged/adjustment/transfer/reconciliation/reservation/release. `Idempotency-Key` replays. |
| GET | `/ledger/:itemId` | Immutable history with unit cost |
| GET/POST/PATCH | `/bom` | BOM; `POST /bom/explode` checks availability |

Ready-to-print **reserves** BOM. Job start **consumes** reserved qty once. Cancel **releases** unused reservation.

## Production — `/api/v1/production`

| Method | Path | Notes |
| --- | --- | --- |
| GET/POST | `/machines` `/departments` `/staff` | Assignment sources |
| GET | `/jobs` `/jobs/:id` `/dashboard` | Delayed/overdue included |
| POST | `/jobs` `/from-order/:orderId` | Idempotent per order line |
| PATCH | `/jobs/:id` | Assignment, schedule, priority |
| POST | `/jobs/:id/start` | Consumes reserved BOM once |
| POST | `/jobs/:id/complete` | Planned/completed/rejected/wastage; finished-goods inward if linked |
| POST | `/jobs/:id/quality` | QC pass/fail |
| POST | `/jobs/:id/delay` | Reason required |

See route files under `backend/src/modules/` for finance, settings, notifications.

## Reports — `/api/v1/reports`

| Method | Path | Permission | Notes |
| --- | --- | --- | --- |
| GET | `/dashboard` | reports.view or orders.view | Period KPIs, GST, aging, pipeline, alerts. `preset=today\|7d\|30d\|month\|fy` or `from`/`to` |
| GET | `/sales` | reports.view | Trend grouped by day/week/month |
| GET | `/top` | reports.view | Top customers, items, payment methods |
| GET | `/daily` | reports.view | Today snapshot |
| GET | `/detail` | reports.view | `kind=gst\|aging\|pnl\|pipeline\|production\|inventory\|expenses\|customers` |
| GET | `/export` | reports.export | CSV. `type=daily\|sales\|gst\|aging\|expenses\|production\|inventory\|customers` |

## Public

| Method | Path |
| --- | --- |
| GET/POST | `/public/quotations/:token` approve/reject |
| GET/POST | `/public/designs/:token` approve/reject |
| GET | `/public/membership/:token` |

Public payloads omit KYC, cost, and internal notes.
