# Infatoz Printing ERP — Architecture

Status: living document. Describes the **current modular monolith** and the target enterprise SaaS shape. Working modules are not rewritten unless a gap is production-blocking.

## 1. System context

Infatoz is a printing-press ERP: CRM → quotation → customer approval → order → artwork approval → production → material consumption → dispatch → invoice → payment → reports.

```
Staff browsers / future Flutter apps
              |
           HTTPS
              |
        Reverse proxy (Dokploy / nginx)
         /              \
   React PWA         Express API  (/api/v1, /public, /health)
                         |
              ┌──────────┴──────────┐
              |                     |
           MongoDB         Local/object storage*
```

\* Object storage is local disk (`UPLOAD_DIR`) with an abstraction path documented in `decisions.md`.

## 2. Current topology

| Layer | Location | Stack |
| --- | --- | --- |
| Frontend | `frontend/` | React 19, Vite 6, TypeScript, Tailwind 4, TanStack Query, Zustand, React Router 7 |
| Backend | `backend/` | Node 22, Express 4, TypeScript, Mongoose 8, Zod, JWT, bcryptjs |
| Data | MongoDB 7 | Organization-scoped collections, counters, ledger collections |
| Deploy | `docker-compose.yml` | Frontend nginx, backend, MongoDB |

Tenant model: every operational document carries `organizationId` + optional `branchId` + `deletedAt`. The first production tenant is **one organization, one branch**. Isolation is enforced in queries, not only in the UI.

## 3. Backend module map

Routes live under `backend/src/modules/*/`. Shared rules live in `backend/src/common/` (money, pricing, inventory ledger, permissions, numbering, public tokens).

| Module | Responsibility |
| --- | --- |
| `auth` | Login, refresh, logout, me, password reset |
| `users` | Users, roles, permission catalog, session revoke |
| `customers` | CRM, GST/PAN, contacts, activity, AR statement/aging, credit events, KYC, membership QR |
| `catalog` | Categories, items, variants, price lists |
| `quotations` | Draft/send/approve flow, public token |
| `orders` | POS create, status machine, payments, design upload, convert quotation |
| `production` | Jobs, machines, queue dashboard |
| `inventory` | Stock master, immutable ledger, BOM |
| `finance` | Expenses, income, payments, invoices, summary |
| `notifications` | Templates, logs, test payload / wa.me |
| `reports` | Dashboard, period P&L, GST, aging, pipeline, production/inventory analytics, CSV export |
| `settings` | Business profile, printers, statuses, coupons, audit |
| `public` | Tokenised quotation, design, tracking, membership |

**Refactor direction (not a rewrite):** extract `service/` + `validation/` from fat route files module-by-module, starting with orders and pricing. Controllers stay thin; money never moves to the client.

## 4. Frontend module map

App shell: ink sidebar (desktop) + bottom nav (mobile). Staff routes are JWT-guarded. Customer actions use `/approve/*` and `/card/:token` without staff login.

POS ticket totals come from `POST /orders/preview`. Grand total, tax, credit, and stock are always recomputed by the API; client-submitted totals are ignored.

## 5. Security baseline

- Passwords: bcryptjs, never stored plaintext.
- Access JWT (short) + refresh JWT stored hashed in `sessions`.
- RBAC middleware on protected routers; owner bypass is explicit.
- Public links: unguessable tokens, expiry on quotations, rate limits, no KYC/cost fields.
- Helmet, CORS allowlist, JSON body limit, upload MIME/size checks.
- Financial rows are soft-deleted / status-voided, not hard-deleted.
- Catalog price changes do not mutate order/quotation snapshots.

## 6. Money and inventory invariants

1. `priceDocument()` snapshots name, SKU, tax, unit price, and pricing rule onto each line.
2. `computeOrderTotals()` is the only trusted total.
3. Stock quantity changes only through `moveStock()` which writes `inventory_transactions`. Reservations change `reservedQty` only. Available = on hand − reserved.
4. BOM materials are reserved when an order becomes `ready_to_print` and consumed once when the production job starts. Unused reservations are released on cancel.
5. Design-required lines cannot enter `ready_to_print` until `designStatus === approved`.

## 7. Notification architecture

Backend renders templates and stores a log with a `wa.me` payload. The UI opens WhatsApp. **No provider is claimed as delivered** unless a future Cloud API / SMS adapter is configured. Secrets stay on the server.

## 8. What this increment does not change

Existing order, POS, CRM, and catalog behaviour stays. This round documents the system and hardens **foundation** (env schema, structured logs, tests, error envelope, repo tooling).
