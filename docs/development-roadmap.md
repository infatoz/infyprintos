# Development roadmap

Work in **complete increments**. Do not claim a feature done without API + persistence + UI + a test for the money/workflow rule.

## Already in the tree (inspect date)

Functional staff ERP: auth/RBAC, customers + membership + GST/credit/AR statement, catalog/pricing, POS, quotations + public approve, orders + design + payments, production jobs, inventory ledger + BOM consume, finance, reports, settings, Docker.

Known gaps vs the full SRS are listed below — they are the backlog, not hidden.

## Increment 0 — Foundation hardening (this task)

- Architecture and API docs
- Zod environment schema (reject weak production secrets)
- Structured logging
- Consistent error envelope
- Unit tests for money, permissions, public tokens, status transitions
- Root scripts, Prettier, ESLint (non-breaking)
- Health check includes Mongo readiness
- Backup notes for Dokploy

## Increment 1 — Orders & money correctness

Done in this increment: Mongo transactions (with standalone fallback), `Idempotency-Key` for order create, unique payment references, extracted `order.service`, POS live preview, PDF quotation/invoice, public quotation approval.

Remaining backlog:

- POS barcode scanner auto-add after exact SKU match
- Credit override with owner permission + audit
- Browser print templates (A4 / thermal CSS)

## Increment 2 — Documents

- PDF quotation, tax invoice, receipt, membership card (pdfkit already a dependency)
- Reprint counter
- Browser print templates (A4 / thermal CSS)

## Increment 3 — Notifications honesty

- Provider config in settings (WhatsApp Cloud, MSG91) **server-side secrets only**
- Status: `not_configured` | `queued` | `sent` | `failed`
- UI warning when no provider
- Event hooks on remaining status changes

## Increment 4 — Inventory & production depth

Done in this increment: ledger-only stock mutation, reservation/release, idempotent consumption, BOM explode, transfers, reconciliation, usage/valuation, production jobs with machine/employee/schedule/QC, delayed dashboard.

Remaining backlog:

- Batch/expiry picking UI
- Machine maintenance history
- Job pause with wastage as a separate ledger reason code

## Increment 4b — Customer CRM depth

Done in this increment: GSTIN/PAN/PIN validation, tax registration and place of supply, lifecycle status, contacts and activity, credit events with required reason, AR statement aging, duplicate merge/restore, membership QR reissue, credit-permission gating after create, blocked customers cannot take new credit orders.

Remaining backlog:

- Live GSTN portal verification
- Customer self-service portal (increment 6)

## Increment 5 — Reports export

- Server-side PDF/XLSX
- Saved filters
- Scheduled daily summary (job queue when a worker is added)

## Increment 6 — Customer portal

- Customer auth (OTP/password)
- Own-data scoping
- Browse + quotation request
- Online payment adapter (Razorpay) behind config flag

## Increment 7 — Print bridge

- Document that USB thermal needs a local bridge
- Network printer metadata only; browser print fallback remains default

## Quality gates per increment

`npm --prefix backend test` · `npm --prefix backend run lint` · `npm --prefix frontend run build` · smoke the changed UI flow.
