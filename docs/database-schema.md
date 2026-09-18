# Database schema

MongoDB / Mongoose. Timestamps are UTC (`createdAt` / `updatedAt`). Display timezone is organization `timezone` (default `Asia/Kolkata`). Soft delete: `deletedAt`.

Tenant keys on operational collections: `organizationId` (required, indexed), `branchId` (optional).

## Identity and tenancy

| Collection | Purpose | Unique / indexes |
| --- | --- | --- |
| `organizations` | Legal name, GSTIN, PAN, prefixes, tax defaults, hours | — |
| `branches` | Store / press unit | `{ organizationId, code }` unique |
| `roles` | Slug, permission strings, system flag | `{ organizationId, slug }` unique |
| `users` | Staff; `passwordHash`; overrides grant/revoke | `{ organizationId, email }` unique |
| `sessions` | Refresh token hash, expiry, revoke | `userId` |
| `counters` | Atomic document numbering | `{ organizationId, key }` unique |

## CRM

| Collection | Purpose | Notes |
| --- | --- | --- |
| `customertiers` | Basic → Wholesale, discount hint, color | `{ organizationId, slug }` unique |
| `creditterms` | prepaid, due_on_billing, net_days | |
| `customers` | Code, phone, GST, outstanding, creditHold, taxRegistration, gstState, lifecycleStatus, assignedTo | `{ organizationId, code }` unique; phone, GSTIN, lifecycle indexes |
| `customeraddresses` | registered / billing / shipping / other; one `isDefault` per type | `customerId` |
| `customerdocuments` | KYC; pending→verified/rejected/expired | Restricted APIs |
| `customercontacts` | Named buying/accounts contacts; one primary | `customerId` |
| `customeractivities` | Notes, calls, visits, credit/KYC/system events | `customerId` + createdAt |
| `customercreditevents` | Limit/term/hold/recalc/merge with required reason | `customers.credit` |
| `membershipcards` | membershipId + qrToken; previousQrTokens on reissue | unique membershipId, qrToken |

## Catalog and pricing

| Collection | Purpose |
| --- | --- |
| `categories` | Nested via `parentId` |
| `items` | Type, unit, HSN/SAC, tax, requiresDesign, salesPrice |
| `itemvariants` | Option map + optional price |
| `pricelists` | tier + qty slab + effective dates |
| `coupons` | `{ organizationId, code }` unique |

Order/quotation **lines copy** name, SKU, tax, unitPrice, pricingRule. Catalog edits never rewrite history.

## Commercial documents

| Collection | Numbering key | Notes |
| --- | --- | --- |
| `quotations` | `quotation:{year}` | statuses include publicToken + expiry |
| `quotationversions` | — | revision snapshots |
| `orders` | `order:{year}` | items[], totals{ paidAmount, balanceDue }, locked |
| `orderstatuses` | `{ organizationId, code }` unique | allowedTransitions, requiresReason, terminal |
| `orderstatushistories` | — | append-only |
| `invoices` | `invoice:{year}` | snapshot + totals; void not delete |
| `payments` | `receipt:{year}` | never overwrite; refunds are new rows |
| `incomes` / `expenses` | expense uses `expense:{year}` | expenses approvalStatus |

## Production and stock

| Collection | Notes |
| --- | --- |
| `designfiles` | versioned uploads, publicToken, hash |
| `designapprovals` | immutable approve/reject + IP/UA |
| `productionjobs` | `{ organizationId, number }` unique |
| `machines` | `{ organizationId, code }` unique |
| `inventoryitems` | stockQty + reservedQty + averageCost; available = stock − reserved |
| `inventorytransactions` | immutable in/out, previous/new balance + reserved, idempotencyKey |
| `stockreservations` | per order + SKU remaining qty |
| `suppliers` / `units` | master data |
| `billofmaterials` | item/variant → materials + wastePercent |
| `departments` | production departments |

## Platform

`notificationtemplates`, `notificationlogs`, `printers`, `settings` (versioned KV), `auditlogs`, `fileassets`, `paymentmethods`.

## Transactions

Mongoose sessions wrap order create, payment, invoice, and outstanding updates via `withOptionalTransaction()`. When MongoDB is a replica set (Atlas / compose), the writes commit atomically. Standalone servers (local `mongod`, MongoMemoryServer) fall back to sequential writes. Unique `{organizationId, idempotencyKey}` and `{organizationId, orderId, reference}` indexes still prevent duplicate tickets and duplicate receipts.
