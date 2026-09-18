# Backup and restore (Dokploy)

## What to persist

| Volume / path | Contents |
| --- | --- |
| Docker volume `mongo_data` | All ERP data |
| Docker volume `uploads_data` | Artwork and KYC files |
| Secrets in Dokploy env | JWT secrets, Mongo URI |

## Mongo dump (compose)

```bash
docker compose exec mongo mongodump --db printing_erp --out /data/db/backup
```

Copy the dump off the host. Restore with `mongorestore`. Prefer Atlas or a scheduled Dokploy job in production.

## Application

- Keep `.env` out of git.
- After restore, confirm `/health` returns `mongo: "up"`.
- Do not seed production; seed is for local/demo only.

## RPO/RTO (initial)

Daily dump is the minimum. Point-in-time requires Atlas or replica-set oplog — not assumed on a single compose Mongo.
