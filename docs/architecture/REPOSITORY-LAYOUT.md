# Repository layout

The repository is organized around deployable applications, reusable packages,
and the local AI service:

```text
apps/web/                 Browser source
apps/local-api/           Local Node.js API
apps/local-api/domain/    Catalog and feature-domain rules
apps/local-api/repositories/ Persistence adapters and stores
apps/local-api/queue/     Durable work execution
apps/local-api/infrastructure/ Background processes and lifecycle
packages/                 Shared Node.js contracts, runtime and storage
services/ai/              Python AI service
services/ai/features/     Feature-specific AI domain code
services/ai/prompting/    Prompt catalog and encoder policy
services/ai/quality/      Quality learning and reporting
scripts/                  Operational tooling
tests/                    Compatibility and regression tests
app/                      Legacy Node.js compatibility surface
```

## Compatibility policy

`app/server.js` and `ai_service.py` are the only stable compatibility entry
points. There are no feature aliases at the repository root or directly inside
`app/`; implementation code must be added to `apps/`, `packages/`, or
`services/ai/`.

Imports inside `services/ai`
use fully qualified `services.ai.*` modules, and `apps/local-api` must not use
`createRequire` rooted at `app/server.js`. `pnpm verify:layout` enforces both
rules. Repository-owned tests and scripts also use canonical modules.

Generated browser files remain in `app/public` until the offline installer is
migrated to a release-only `dist/web` artifact. Source changes belong in
`apps/web`.

## Runtime data

`workspace/`, `models/`, `weights/`, virtual environments, caches and vendor
content are not source code and remain ignored by Git. A later data-directory
migration may place them behind `ATELIER_DATA_DIR`; that migration requires a
separate backup and rollback procedure and is intentionally not combined with
source relocation.

Run `pnpm verify:layout` to reject new implementation modules added at the
repository root.

After adding or removing Python or local API source files, run
`pnpm update:manifests`. The API manifest includes middleware, domain modules,
services and task coordination code.
