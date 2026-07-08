# Jamio

Jamio is a web-hosted realtime card game adapted from Cambio.

This repo is structured as a small TypeScript monorepo:

- `packages/game-core`: pure Jamio game engine and tests.
- `packages/protocol`: shared runtime schemas and protocol types.
- `apps/web`: React/Vite client for `/jamio`.
- `apps/worker`: Cloudflare Worker + Durable Object room server.

The core rule is that browsers only submit intended actions. The server owns
hidden game state and sends each player a filtered view.

## Development

Install dependencies:

```bash
npm install
```

Run checks:

```bash
npm test
npm run typecheck
npm run build
```

Run the web client and Worker in separate terminals:

```bash
npm run dev:web
npm run dev:worker
```

The Vite app uses `http://localhost:8787` for `/api/jamio` while running on
`localhost:5173`. Set `VITE_JAMIO_API_BASE` if the Worker is somewhere else.

## Cloudflare Deployment

Jamio can deploy as its own Cloudflare Worker with bundled static assets. This
keeps it separate from the personal website repo while still letting Cloudflare
serve it on the same domain.

Two production shapes are configured:

- `johnsurette.com/jamio`: serves the game from this Worker on the `/jamio`
  path, plus the realtime API at `/api/jamio/*`.
- `jamio.johnsurette.com`: serves the same app from a dedicated subdomain.

### First-Time Cloudflare Setup

1. Make sure `johnsurette.com` is an active zone in the Cloudflare account you
   are logged into with Wrangler.
2. Authenticate Wrangler if needed:

   ```bash
   npx wrangler login
   ```

3. Deploy the path-based version:

   ```bash
   npm run deploy:cloudflare:path
   ```

4. Open `https://johnsurette.com/jamio`.

This deploys the Vite build from `apps/web/dist` as Worker assets and routes:

```text
https://johnsurette.com/jamio*
https://johnsurette.com/api/jamio/*
```

That means the personal website can keep serving every other path. Jamio owns
only `/jamio` and `/api/jamio`.

### Later Subdomain Setup

When you want the cleaner subdomain, deploy:

```bash
npm run deploy:cloudflare:subdomain
```

That builds the app for `/` and publishes it to:

```text
https://jamio.johnsurette.com
```

The subdomain environment uses same-origin API and WebSocket calls, so the
browser talks to:

```text
https://jamio.johnsurette.com/api/jamio/*
wss://jamio.johnsurette.com/api/jamio/ws
```

### Local Production Checks

Before deploying, run:

```bash
npm test
npm run typecheck
npm run build:cloudflare:path
```

For the subdomain build:

```bash
npm run build:cloudflare:subdomain
```

The Worker config lives at `apps/worker/wrangler.jsonc`. The Durable Object
binding is `JAMIO_ROOM`, and each room code maps to one isolated Durable Object.

## Free-Plan Protection

The hosted app is designed to stay small and abuse-resistant:

- Production room creation and joining require the configured `ALLOWED_ORIGIN`.
- REST request bodies are capped at 64 KB and must be JSON.
- WebSocket messages are capped at 16 KB.
- Room creation, room joins, availability checks, and WebSocket connects are
  rate-limited per source address by the `JAMIO_RATE_LIMIT` Durable Object.
- Active room WebSockets use Cloudflare Durable Object hibernation so idle
  connections can sleep without dropping players.
- Abandoned rooms expire automatically:
  - disconnected lobby: 30 minutes
  - disconnected active game: 2 hours
  - finished game: 1 hour
- Static responses get security headers including CSP, `nosniff`,
  `no-referrer`, and HSTS in production.

Cloudflare Durable Objects are available on Workers Free when using the SQLite
storage backend, which this config uses through `new_sqlite_classes`. On the
Free plan, exceeding free-tier limits should fail operations instead of
silently billing, but the practical goal is still to avoid needless requests,
writes, and long-running sockets.

For extra protection in the Cloudflare dashboard, keep these free/low-friction
controls in mind:

- Disable public `workers.dev` routes if you only want the custom domain routes.
- Keep Bot Fight Mode or equivalent basic bot protections enabled if available
  for the zone.
- Add a WAF/custom rule for `/api/jamio/*` if you see abuse patterns in
  analytics.
- Watch Durable Object request and duration metrics after the first deploy.
