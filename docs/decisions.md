# Architecture decisions

## ADR-001 — Modular monolith, not microservices

**Decision:** One Express API, one React app, one MongoDB.  
**Why:** One press / one SaaS tenant to start; splitting quotations, inventory, and finance would add ops cost without a scale trigger.  
**Follow-up:** Keep module folders so a future worker (reports, notifications) can extract without a rewrite.

## ADR-002 — Do not rewrite the working ERP in this pass

**Decision:** Inspect-first. Existing routes, models, and UI stay unless a change is required for a stated increment.  
**Why:** A greenfield regeneration would drop verified POS/order/inventory behaviour.

## ADR-003 — Server is the source of truth for money and stock

**Decision:** POS may show an estimate; `priceDocument` + `computeOrderTotals` + `moveStock` are authoritative.  
**Why:** Hidden frontend totals are a finance and GST risk.

## ADR-004 — Design system: evolve current components, defer shadcn migration

**Decision:** Keep `frontend/src/components/ui.tsx` (accessible-ish primitives, Plus Jakarta / ink + gold).  
**Why:** A mid-flight shadcn swap would restyle every screen without business value. Adopt shadcn primitives later **screen by screen** if we need Headless UI behaviour.

## ADR-005 — Public customer actions use opaque tokens, not JWTs

**Decision:** Random `publicToken` on quotations, designs, and membership cards; quotation tokens expire.  
**Why:** Customers must act without staff accounts; tokens must not leak KYC or cost.

## ADR-006 — WhatsApp is orchestrated, not a fake gateway

**Decision:** Backend stores template output + `wa.me` URL. UI opens WhatsApp. Delivery is not marked sent unless a real provider is configured (increment 3).  
**Why:** Spec forbids fake integrations.

## ADR-007 — Local disk uploads now, object-storage shaped metadata

**Decision:** `FileAsset` + `/uploads` static. `url`/`hash`/`visibility` fields allow S3 later.  
**Why:** Dokploy single-node is the first deploy; volume is enough.

## ADR-008 — Mongo port 27018 on the host

**Decision:** Compose maps `27018:27017` because many developer machines already bind 27017. Inside the network the URI remains `mongodb://mongo:27017/printing_erp`.

## ADR-009 — Owner role bypasses permission strings

**Decision:** `roleSlug === "owner"` grants all API checks. Other roles use the permission list plus user grant/revoke overrides.  
**Why:** Matches the SRS; still audit owner overrides on status and credit.

## ADR-010 — Soft delete and no financial hard delete

**Decision:** `deletedAt`; invoices/payments get status changes (void/refunded), not removal.
