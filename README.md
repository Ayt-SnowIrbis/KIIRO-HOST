# KIIRO-HOST — Foundation v1.1

Starter implementation package for the KIIRO-HOST VPS hosting platform.

- Runtime: Node.js 24
- Deployment: Docker Compose
- Data: PostgreSQL 17 + Prisma 6.19
- Queue: Redis 7 + BullMQ
- API: NestJS 11
- Frontend: existing Next.js app (preserved)

Start with [`docs/FOUNDATION-v1.md`](docs/FOUNDATION-v1.md). It contains setup, first boot, migration, backup and security instructions.

> Foundation v1.1 is infrastructure + initial data model + API/worker skeleton. It does not yet implement customer authentication, payment processing, Incus provisioning or production billing workflows. Do not launch paid customer workloads until those milestones are implemented and tested.
