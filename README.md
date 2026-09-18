# Infy PrintOS

Print shop ERP for banner printing, visiting cards, corporate gifting, 3D printing, and other custom services. It is a MERN application: quotations, design approvals, production, inventory ledger, billing, payments, and role-based access — not a POS-only billing app.

## Stack

- **Frontend:** React, Vite, TypeScript, Tailwind CSS, PWA
- **Backend:** Node.js, Express, TypeScript, REST `/api/v1`
- **Database:** MongoDB (Mongoose, indexes, transactions-ready)
- **Deploy:** Docker Compose, Dokploy-friendly reverse proxy

## Quick start (local)

1. Install Node.js 22+ and Docker (or MongoDB 7).
2. Copy environment variables:

```bash
cp .env.example .env
```

3. Install and seed:

```bash
cd backend
npm install
npm run seed
npm run dev
```

```bash
cd frontend
npm install
npm run dev
```

4. Open http://localhost:5173

**Default owner login**

- Email: `printfactorykoteshwara@gmail.com`
- Password: `Owner@12345`

Change these in `.env` before any production use.

## Docker / Dokploy

```bash
cp .env.example .env
docker compose up --build
```

Local MongoDB is mapped to **27018** so it does not clash with an existing server on 27017. Inside Docker the URI is `mongodb://mongo:27017/printing_erp`.

Dokploy: point the compose file at this repo, set production secrets (`JWT_*`, `MONGODB_URI`, `CORS_ORIGIN`), and terminate HTTPS at the reverse proxy.

## What is implemented

| Area | Behaviour |
| --- | --- |
| Auth & RBAC | JWT access/refresh, owner + 9 roles, granular permissions enforced on APIs |
| Customers | CRM, tiers, credit terms, credit hold, membership card + public QR verify |
| Catalog | Items, variants, categories, tier/qty price lists |
| POS / Orders | Keyboard-friendly ticket, server-side GST totals, payments, invoices |
| Quotations | Draft → share WhatsApp link → customer approve/reject → convert |
| Design workflow | Upload, versioning, public approve/reject, immutable approval record |
| Production | Jobs created when an order becomes Ready to Print, machine queue |
| Inventory | Stock ledger (no silent overwrites), BOM consumption on print |
| Finance | Income, expenses, receipts, outstanding vs collected vs profit |
| Notifications | Template manager + queued WhatsApp `wa.me` payloads from the UI |
| Public links | Tokenised quotation, design, and membership pages |
| Settings | Business profile, printers, statuses, coupons, users, audit |

All money totals are recalculated on the backend. Frontend amounts are estimates only.

Architecture, schema, API, roadmap, and ADRs live in [`docs/`](./docs/).

## Project layout

```
printing-erp/
├── frontend/     React PWA
├── backend/      Express API
├── docs/         Architecture and API
├── docker-compose.yml
├── .env.example
└── README.md
```

Root scripts: `npm test`, `npm run lint`, `npm run build`.

## Roadmap still open

Scheduled report delivery, Razorpay/Cashfree, thermal print bridge, customer self-service portal login, malware scanning, and a job queue are modelled but not fully wired.

## Scripts

| Location | Command | Purpose |
| --- | --- | --- |
| backend | `npm run dev` | API with reload |
| backend | `npm run seed` | Demo org, catalog, roles |
| backend | `npm run build` | Compile TypeScript |
| frontend | `npm run dev` | Vite on :5173 |
| frontend | `npm run build` | Production bundle |
