# Jamio

Jamio is a web-hosted realtime card game adapted from Cambio.

This repo is structured as a small TypeScript monorepo:

- `packages/game-core`: pure Jamio game engine and tests.
- `packages/protocol`: shared runtime schemas and protocol types.
- `apps/web`: React/Vite client for `/jamio`.
- `apps/worker`: Cloudflare Worker + Durable Object room server.

The core rule is that browsers only submit intended actions. The server owns
hidden game state and sends each player a filtered view.
