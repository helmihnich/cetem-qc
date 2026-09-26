# CETEM-QC workspace

## Prerequisites

- Node.js 24.21.0 (`.nvmrc`)
- pnpm 12.7.0 (Corepack uses the version pinned in `package.json`)

Install dependencies from the repository root:

```sh
corepack pnpm install
```

## Development servers

Run one application from the repository root:

```sh
pnpm dev:web
pnpm dev:mobile
pnpm dev:api
```

The web app listens on `127.0.0.1:3000`, Expo starts its local Metro server, and the API listens on `127.0.0.1:3001` (`/health`).

## Validation

```sh
pnpm typecheck
pnpm --filter @cetem-qc/web build
pnpm --filter @cetem-qc/api build
pnpm --filter @cetem-qc/mobile exec expo install --check
```
