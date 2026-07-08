import {
  applyAction,
  createInitialRound,
  getPlayerView,
  jamioDefaultRuleset,
  validateRulesetForPlayers,
  type GameState,
  type Player,
  type PlayerId,
  type PlayerView,
  type Ruleset
} from "@jamio/game-core";
import {
  ClientMessageSchema,
  CreateRoomRequestSchema,
  JoinRoomRequestSchema,
  RoomCodeSchema,
  type AvailabilityResponse,
  type CreateRoomResponse,
  type JoinRoomResponse,
  type ServerMessage
} from "@jamio/protocol";

export interface Env {
  JAMIO_ROOM: DurableObjectNamespace;
  JAMIO_RATE_LIMIT: DurableObjectNamespace;
  ASSETS?: Fetcher;
  ENVIRONMENT?: string;
  ALLOWED_ORIGIN?: string;
  PUBLIC_BASE_PATH?: string;
}

type RoomPlayer = Player & {
  token: string;
  connected: boolean;
};

type RoomRecord = {
  roomCode: string;
  maxPlayers: number;
  ruleset: Ruleset;
  theme: string;
  hostPlayerId: PlayerId;
  players: RoomPlayer[];
  gameState: GameState | null;
  createdAt: number;
  updatedAt: number;
};

const roomKey = "room";
const maxRestBodyBytes = 64 * 1024;
const maxSocketMessageBytes = 16 * 1024;
const socketMessageLimit = { max: 36, windowMs: 10_000 };
const roomExpiry = {
  connectedCheckMs: 60 * 60 * 1000,
  disconnectedLobbyMs: 30 * 60 * 1000,
  disconnectedActiveMs: 2 * 60 * 60 * 1000,
  finishedMs: 60 * 60 * 1000
};

type RateLimitScope = "availability" | "room_create" | "room_join" | "ws_connect";

const requestRateLimits: Record<RateLimitScope, { max: number; windowMs: number }> = {
  availability: { max: 120, windowMs: 10 * 60 * 1000 },
  room_create: { max: 6, windowMs: 60 * 60 * 1000 },
  room_join: { max: 60, windowMs: 10 * 60 * 1000 },
  ws_connect: { max: 80, windowMs: 10 * 60 * 1000 }
};

type RateBucket = {
  count: number;
  resetAt: number;
};

type SocketBucket = RateBucket;

type SocketAttachment = {
  playerId?: PlayerId;
};

class HttpError extends Error {
  constructor(
    readonly status: number,
    message: string
  ) {
    super(message);
  }
}

export class JamioRateLimiter {
  constructor(private readonly state: DurableObjectState) {}

  async fetch(request: Request): Promise<Response> {
    if (request.method !== "POST") {
      return json({ error: "Not found" }, 404);
    }

    const body = (await readJsonBody(request, 1024)) as { scope?: string };
    const scope = body.scope;
    if (!isRateLimitScope(scope)) {
      return json({ error: "Invalid rate limit scope" }, 400);
    }

    const now = Date.now();
    const limit = requestRateLimits[scope];
    const key = `bucket:${scope}`;
    const current = await this.state.storage.get<RateBucket>(key);
    const bucket =
      !current || current.resetAt <= now
        ? { count: 0, resetAt: now + limit.windowMs }
        : current;

    if (bucket.count >= limit.max) {
      return json(
        {
          error: "Too many requests",
          retryAfterSeconds: Math.max(1, Math.ceil((bucket.resetAt - now) / 1000))
        },
        429,
        {
          "Retry-After": String(Math.max(1, Math.ceil((bucket.resetAt - now) / 1000)))
        }
      );
    }

    bucket.count += 1;
    await this.state.storage.put(key, bucket);
    await this.scheduleCleanup();
    return json({ ok: true, remaining: Math.max(0, limit.max - bucket.count), resetAt: bucket.resetAt });
  }

  async alarm(): Promise<void> {
    const now = Date.now();
    const buckets = await this.state.storage.list<RateBucket>({ prefix: "bucket:" });
    let nextResetAt: number | null = null;

    for (const [key, bucket] of buckets) {
      if (bucket.resetAt <= now) {
        await this.state.storage.delete(key);
      } else if (nextResetAt === null || bucket.resetAt < nextResetAt) {
        nextResetAt = bucket.resetAt;
      }
    }

    if (nextResetAt === null) {
      await this.state.storage.deleteAlarm();
    } else {
      await this.state.storage.setAlarm(nextResetAt);
    }
  }

  private async scheduleCleanup(): Promise<void> {
    const currentAlarm = await this.state.storage.getAlarm();
    if (currentAlarm === null) {
      await this.state.storage.setAlarm(Date.now() + 60 * 60 * 1000);
    }
  }
}

export class JamioRoom {
  private room: RoomRecord | null = null;
  private readonly sessions = new Map<WebSocket, PlayerId>();
  private readonly socketBuckets = new Map<WebSocket, SocketBucket>();

  constructor(
    private readonly state: DurableObjectState,
    private readonly env: Env
  ) {
    this.state.blockConcurrencyWhile(async () => {
      this.room = (await this.state.storage.get<RoomRecord>(roomKey)) ?? null;
      for (const socket of this.state.getWebSockets()) {
        const attachment = socket.deserializeAttachment() as SocketAttachment | null;
        if (attachment?.playerId) {
          this.sessions.set(socket, attachment.playerId);
        }
      }
    });
  }

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname === "/availability" && request.method === "GET") {
      return json<AvailabilityResponse>({
        roomCode: url.searchParams.get("roomCode") ?? "",
        available: this.room === null
      });
    }

    if (url.pathname === "/create" && request.method === "POST") {
      const parsed = CreateRoomRequestSchema.parse(await readJsonBody(request, maxRestBodyBytes));
      if (this.room) {
        return json({ error: "Room code is already in use" }, 409);
      }
      validateRulesetForPlayers(parsed.ruleset as Ruleset, parsed.maxPlayers);
      const host: RoomPlayer = {
        id: crypto.randomUUID(),
        name: parsed.name,
        token: makeToken(),
        connected: false
      };
      this.room = {
        roomCode: parsed.roomCode,
        maxPlayers: parsed.maxPlayers,
        ruleset: parsed.ruleset as Ruleset,
        theme: parsed.theme ?? "classic",
        hostPlayerId: host.id,
        players: [host],
        gameState: null,
        createdAt: Date.now(),
        updatedAt: Date.now()
      };
      await this.persist();
      return json<CreateRoomResponse>({
        roomCode: this.room.roomCode,
        playerId: host.id,
        playerToken: host.token,
        theme: this.room.theme
      });
    }

    if (url.pathname === "/join" && request.method === "POST") {
      const parsed = JoinRoomRequestSchema.parse(await readJsonBody(request, maxRestBodyBytes));
      const room = this.requireRoom();
      if (room.players.length >= room.maxPlayers) {
        return json({ error: "Room is full" }, 409);
      }
      if (room.gameState && room.gameState.phase !== "lobby") {
        return json({ error: "Game has already started" }, 409);
      }
      const player: RoomPlayer = {
        id: crypto.randomUUID(),
        name: parsed.name,
        token: makeToken(),
        connected: false
      };
      room.players.push(player);
      room.updatedAt = Date.now();
      await this.persist();
      await this.broadcastSnapshots();
      return json<JoinRoomResponse>({
        roomCode: room.roomCode,
        playerId: player.id,
        playerToken: player.token,
        theme: room.theme
      });
    }

    if (url.pathname === "/ws" && request.headers.get("Upgrade") === "websocket") {
      return this.acceptWebSocket(request);
    }

    return json({ error: "Not found" }, 404);
  }

  private acceptWebSocket(_request: Request): Response {
    const pair = new WebSocketPair();
    const [client, server] = Object.values(pair) as [WebSocket, WebSocket];
    this.state.acceptWebSocket(server);
    server.serializeAttachment({});

    return new Response(null, { status: 101, webSocket: client });
  }

  async webSocketMessage(socket: WebSocket, message: string | ArrayBuffer): Promise<void> {
    await this.handleSocketMessage(socket, message);
  }

  async webSocketClose(socket: WebSocket, code: number, reason: string): Promise<void> {
    await this.handleSocketClose(socket);
    socket.close(code, reason);
  }

  async webSocketError(socket: WebSocket): Promise<void> {
    await this.handleSocketClose(socket);
  }

  private async handleSocketMessage(socket: WebSocket, raw: unknown): Promise<void> {
    try {
      if (typeof raw !== "string") {
        send(socket, { type: "error", code: "INVALID_MESSAGE", message: "Message must be text" });
        return;
      }
      if (raw.length > maxSocketMessageBytes) {
        send(socket, { type: "error", code: "MESSAGE_TOO_LARGE", message: "Message is too large" });
        socket.close(1009, "Message too large");
        return;
      }
      if (!this.allowSocketMessage(socket)) {
        send(socket, { type: "error", code: "RATE_LIMITED", message: "You are sending messages too quickly" });
        socket.close(1008, "Rate limited");
        return;
      }
      const message = ClientMessageSchema.parse(JSON.parse(raw));
      const room = this.requireRoom();

      if (message.type === "ping") {
        send(socket, { type: "pong" });
        return;
      }

      if (message.type === "join_room") {
        const player = this.findPlayerByToken(room, message.playerToken);
        if (!player || message.roomCode !== room.roomCode) {
          send(socket, { type: "error", code: "AUTH_FAILED", message: "Invalid room code or player token" });
          socket.close(1008, "Unauthorized");
          return;
        }
        this.sessions.set(socket, player.id);
        socket.serializeAttachment({ playerId: player.id } satisfies SocketAttachment);
        player.connected = true;
        room.updatedAt = Date.now();
        await this.persist();
        send(socket, this.snapshotFor(player.id));
        await this.broadcastSnapshots();
        return;
      }

      const playerId = this.sessions.get(socket);
      if (!playerId) {
        send(socket, { type: "error", code: "AUTH_REQUIRED", message: "Join the room before sending actions" });
        return;
      }

      const expectedVersion = room.gameState?.version ?? 0;
      if (message.expectedStateVersion !== expectedVersion) {
        send(socket, {
          type: "error",
          code: "STALE_STATE",
          message: "Your client state is stale",
          stateVersion: expectedVersion
        });
        return;
      }

      if (message.action.type === "restart_game") {
        if (playerId !== room.hostPlayerId) {
          send(socket, { type: "error", code: "NOT_HOST", message: "Only the host can restart the game" });
          return;
        }
        if (room.gameState && room.gameState.phase !== "game_over") {
          send(socket, { type: "error", code: "INVALID_PHASE", message: "The game can only restart after game over" });
          return;
        }
        if (room.players.length < 2) {
          send(socket, { type: "error", code: "NOT_ENOUGH_PLAYERS", message: "Jamio needs at least two players" });
          return;
        }
        const players = room.players.map(({ id, name }) => ({ id, name }));
        room.gameState = createInitialRound(players, room.ruleset, message.action.randomSeed ?? `${Date.now()}`, {
          roomId: room.roomCode,
          hostPlayerId: room.hostPlayerId
        });
        room.gameState.phase = "initial_countdown";
      } else if (!room.gameState && message.action.type === "start_game") {
        if (playerId !== room.hostPlayerId) {
          send(socket, { type: "error", code: "NOT_HOST", message: "Only the host can start the game" });
          return;
        }
        if (room.players.length < 2) {
          send(socket, { type: "error", code: "NOT_ENOUGH_PLAYERS", message: "Jamio needs at least two players" });
          return;
        }
        const players = room.players.map(({ id, name }) => ({ id, name }));
        room.gameState = createInitialRound(players, room.ruleset, message.action.randomSeed ?? `${Date.now()}`, {
          roomId: room.roomCode,
          hostPlayerId: room.hostPlayerId
        });
        room.gameState.phase = "initial_countdown";
      } else if (room.gameState) {
        room.gameState = applyAction(room.gameState, playerId, message.action).state;
        if (message.action.type === "start_next_round") {
          room.gameState.phase = "initial_countdown";
        }
      } else {
        send(socket, { type: "error", code: "GAME_NOT_STARTED", message: "The game has not started yet" });
        return;
      }

      room.updatedAt = Date.now();
      await this.persist();
      await this.broadcastSnapshots();
      if (room.gameState.phase === "initial_countdown") {
        this.scheduleInitialSequence();
      }
      this.schedulePowerRevealTimeout();
    } catch (error) {
      send(socket, {
        type: "error",
        code: "ACTION_REJECTED",
        message: error instanceof Error ? error.message : "Action was rejected",
        stateVersion: this.room?.gameState?.version
      });
    }
  }

  private async handleSocketClose(socket: WebSocket): Promise<void> {
    const playerId = this.sessions.get(socket);
    this.sessions.delete(socket);
    this.socketBuckets.delete(socket);
    if (!playerId || !this.room) {
      return;
    }
    const player = this.room.players.find((candidate) => candidate.id === playerId);
    if (player) {
      player.connected = false;
      this.room.updatedAt = Date.now();
      await this.persist();
      await this.broadcastSnapshots();
    }
  }

  private snapshotFor(playerId: PlayerId): ServerMessage {
    return {
      type: "snapshot",
      view: this.viewFor(playerId),
      stateVersion: this.room?.gameState?.version ?? 0
    };
  }

  private viewFor(playerId: PlayerId): PlayerView | LobbyView {
    const room = this.requireRoom();
    if (room.gameState) {
      return getPlayerView(room.gameState, playerId);
    }
    return {
      roomId: room.roomCode,
      phase: "lobby",
      version: 0,
      you: playerId,
      hostPlayerId: room.hostPlayerId,
      players: room.players.map(({ token: _token, ...player }) => ({
        ...player,
        active: true,
        cardCount: 0
      })),
      yourHand: [],
      opponentHands: [],
      deckCount: 0,
      discardTop: null,
      discardCount: 0,
      currentTurnPlayerId: null,
      legalActions: playerId === room.hostPlayerId ? [{ type: "start_game" }] : [],
      pendingPrompt: null,
      scores: Object.fromEntries(room.players.map((player) => [player.id, 0])),
      roundScores: {},
      roundNumber: 0,
      lastPlayedSeq: null,
      jamioCallerId: null,
      eventLog: [],
      roundWinnerId: null,
      gameWinnerId: null
    };
  }

  private async broadcastSnapshots(): Promise<void> {
    for (const [socket, playerId] of this.sessions) {
      send(socket, this.snapshotFor(playerId));
    }
  }

  private schedulePowerRevealTimeout(): void {
    const pendingPower = this.room?.gameState?.pendingPower;
    if (!pendingPower?.revealedTargets?.length || pendingPower.revealedAtVersion === undefined) {
      return;
    }

    const actorId = pendingPower.actorId;
    const revealedAtVersion = pendingPower.revealedAtVersion;
    setTimeout(() => {
      void this.endPowerRevealIfPending(actorId, revealedAtVersion);
    }, 30_000);
  }

  private async endPowerRevealIfPending(actorId: PlayerId, revealedAtVersion: number): Promise<void> {
    if (
      !this.room?.gameState ||
      this.room.gameState.pendingPower?.actorId !== actorId ||
      this.room.gameState.pendingPower.revealedAtVersion !== revealedAtVersion ||
      !this.room.gameState.pendingPower.revealedTargets?.length
    ) {
      return;
    }

    this.room.gameState = applyAction(this.room.gameState, actorId, {
      type: "resolve_power",
      choice: { type: "end_reveal" }
    }).state;
    this.room.updatedAt = Date.now();
    await this.persist();
    await this.broadcastSnapshots();
  }

  async alarm(): Promise<void> {
    try {
      if (!this.room) {
        this.room = (await this.state.storage.get<RoomRecord>(roomKey)) ?? null;
      }
      if (!this.room) {
        await this.state.storage.deleteAlarm();
        return;
      }

      const now = Date.now();
      const threshold = roomExpiryThresholdMs(this.room);
      if (!this.room.players.some((player) => player.connected) && now - this.room.updatedAt >= threshold) {
        this.room = null;
        await this.state.storage.delete(roomKey);
        await this.state.storage.deleteAlarm();
        return;
      }

      await this.state.storage.setAlarm(nextRoomExpiryCheckAt(this.room));
    } catch {
      await this.state.storage.setAlarm(Date.now() + 10 * 60 * 1000);
    }
  }

  private scheduleInitialSequence(): void {
    setTimeout(() => {
      void this.transitionInitialPhase("initial_countdown", "initial_memorize");
    }, 3000);
  }

  private async transitionInitialPhase(expectedPhase: "initial_countdown" | "initial_memorize", nextPhase: "initial_memorize" | "turn_idle"): Promise<void> {
    if (!this.room?.gameState || this.room.gameState.phase !== expectedPhase) {
      return;
    }
    this.room.gameState = {
      ...this.room.gameState,
      phase: nextPhase,
      version: this.room.gameState.version + 1
    };
    this.room.updatedAt = Date.now();
    await this.persist();
    await this.broadcastSnapshots();
    if (nextPhase === "initial_memorize") {
      setTimeout(() => {
        void this.transitionInitialPhase("initial_memorize", "turn_idle");
      }, 5000);
    }
  }

  private findPlayerByToken(room: RoomRecord, token: string): RoomPlayer | null {
    return room.players.find((player) => player.token === token) ?? null;
  }

  private requireRoom(): RoomRecord {
    if (!this.room) {
      throw new Error("Room does not exist");
    }
    return this.room;
  }

  private async persist(): Promise<void> {
    if (this.room) {
      await this.state.storage.put(roomKey, this.room);
      await this.state.storage.setAlarm(nextRoomExpiryCheckAt(this.room));
    }
  }

  private allowSocketMessage(socket: WebSocket): boolean {
    const now = Date.now();
    const bucket = this.socketBuckets.get(socket);
    if (!bucket || bucket.resetAt <= now) {
      this.socketBuckets.set(socket, {
        count: 1,
        resetAt: now + socketMessageLimit.windowMs
      });
      return true;
    }
    if (bucket.count >= socketMessageLimit.max) {
      return false;
    }
    bucket.count += 1;
    return true;
  }
}

type LobbyView = Omit<PlayerView, "phase"> & {
  phase: "lobby";
};

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    if (request.method === "OPTIONS") {
      const status = isAllowedCorsOrigin(request, env) ? 204 : 403;
      return withSecurityHeaders(new Response(null, { status, headers: corsHeaders(request, env) }), env);
    }

    const url = new URL(request.url);
    try {
      if (url.pathname.match(/^\/api\/jamio\/rooms\/[^/]+\/availability$/) && request.method === "GET") {
        const limited = await checkRequestBudget(request, env, "availability");
        if (limited) {
          return withCors(limited, request, env);
        }
        const roomCode = RoomCodeSchema.parse(url.pathname.split("/").at(-2));
        const stub = env.JAMIO_ROOM.get(env.JAMIO_ROOM.idFromName(roomCode));
        return withCors(
          await stub.fetch(`https://jamio-room/availability?roomCode=${encodeURIComponent(roomCode)}`),
          request,
          env
        );
      }

      if (url.pathname === "/api/jamio/rooms" && request.method === "POST") {
        if (!isAllowedUnsafeRequestOrigin(request, env)) {
          return withCors(json({ error: "Forbidden" }, 403), request, env);
        }
        const limited = await checkRequestBudget(request, env, "room_create");
        if (limited) {
          return withCors(limited, request, env);
        }
        const body = CreateRoomRequestSchema.parse(await readJsonBody(request, maxRestBodyBytes));
        const stub = env.JAMIO_ROOM.get(env.JAMIO_ROOM.idFromName(body.roomCode));
        return withCors(
          await stub.fetch("https://jamio-room/create", {
            method: "POST",
            body: JSON.stringify(body),
            headers: { "content-type": "application/json" }
          }),
          request,
          env
        );
      }

      const joinMatch = url.pathname.match(/^\/api\/jamio\/rooms\/([^/]+)\/join$/);
      if (joinMatch && request.method === "POST") {
        if (!isAllowedUnsafeRequestOrigin(request, env)) {
          return withCors(json({ error: "Forbidden" }, 403), request, env);
        }
        const limited = await checkRequestBudget(request, env, "room_join");
        if (limited) {
          return withCors(limited, request, env);
        }
        const roomCode = RoomCodeSchema.parse(joinMatch[1]);
        const body = JoinRoomRequestSchema.parse(await readJsonBody(request, maxRestBodyBytes));
        const stub = env.JAMIO_ROOM.get(env.JAMIO_ROOM.idFromName(roomCode));
        return withCors(
          await stub.fetch("https://jamio-room/join", {
            method: "POST",
            body: JSON.stringify(body),
            headers: { "content-type": "application/json" }
          }),
          request,
          env
        );
      }

      if (url.pathname === "/api/jamio/ws" && request.headers.get("Upgrade") === "websocket") {
        if (!isAllowedWebSocketOrigin(request, env)) {
          return new Response("Forbidden", { status: 403 });
        }
        const limited = await checkRequestBudget(request, env, "ws_connect");
        if (limited) {
          return limited;
        }
        const roomCode = RoomCodeSchema.parse(url.searchParams.get("roomCode"));
        const stub = env.JAMIO_ROOM.get(env.JAMIO_ROOM.idFromName(roomCode));
        return stub.fetch("https://jamio-room/ws", request);
      }

      return serveStaticAsset(request, env);
    } catch (error) {
      const status = error instanceof HttpError ? error.status : 400;
      return withCors(
        json(
          {
            error: error instanceof Error ? error.message : "Request failed"
          },
          status
        ),
        request,
        env
      );
    }
  }
};

async function serveStaticAsset(request: Request, env: Env): Promise<Response> {
  if (!env.ASSETS || request.method !== "GET") {
    return withSecurityHeaders(json({ error: "Not found" }, 404), env);
  }

  const url = new URL(request.url);
  const basePath = normalizePublicBasePath(env.PUBLIC_BASE_PATH);

  if (basePath !== "/" && url.pathname === basePath.slice(0, -1)) {
    url.pathname = basePath;
    return Response.redirect(url.toString(), 308);
  }

  if (basePath !== "/" && !url.pathname.startsWith(basePath)) {
    return withSecurityHeaders(json({ error: "Not found" }, 404), env);
  }

  const assetUrl = new URL(request.url);
  if (basePath !== "/") {
    const strippedPath = url.pathname.slice(basePath.length - 1);
    assetUrl.pathname = strippedPath === "" ? "/" : strippedPath;
  }

  return withSecurityHeaders(await env.ASSETS.fetch(new Request(assetUrl, request)), env);
}

function json<T>(body: T, status = 200, headers?: HeadersInit): Response {
  return headers ? Response.json(body, { status, headers }) : Response.json(body, { status });
}

function send(socket: WebSocket, message: ServerMessage): void {
  try {
    socket.send(JSON.stringify(message));
  } catch {
    socket.close(1011, "Send failed");
  }
}

function makeToken(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return [...bytes].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

function corsHeaders(request: Request, env: Env): HeadersInit {
  const origin = request.headers.get("Origin");
  const allowedOrigin = env.ALLOWED_ORIGIN ?? "http://localhost:5173";
  const accessControlAllowOrigin = isAllowedCorsOrigin(request, env) && origin ? origin : allowedOrigin;
  return {
    "Access-Control-Allow-Origin": accessControlAllowOrigin,
    "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Max-Age": "600",
    "Vary": "Origin"
  };
}

function withCors(response: Response, request: Request, env: Env): Response {
  const headers = new Headers(response.headers);
  for (const [key, value] of Object.entries(corsHeaders(request, env))) {
    headers.set(key, value);
  }
  return withSecurityHeaders(new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers
  }), env);
}

function isAllowedWebSocketOrigin(request: Request, env: Env): boolean {
  if (env.ENVIRONMENT !== "production") {
    return true;
  }
  const origin = request.headers.get("Origin");
  return origin === (env.ALLOWED_ORIGIN ?? "https://johnsurette.com");
}

function isAllowedCorsOrigin(request: Request, env: Env): boolean {
  if (env.ENVIRONMENT !== "production") {
    return true;
  }
  return request.headers.get("Origin") === (env.ALLOWED_ORIGIN ?? "https://johnsurette.com");
}

function isAllowedUnsafeRequestOrigin(request: Request, env: Env): boolean {
  if (env.ENVIRONMENT !== "production") {
    return true;
  }
  return request.headers.get("Origin") === (env.ALLOWED_ORIGIN ?? "https://johnsurette.com");
}

function normalizePublicBasePath(basePath: string | undefined): string {
  if (!basePath || basePath === "/") {
    return "/";
  }
  return `/${basePath.replace(/^\/+|\/+$/g, "")}/`;
}

async function readJsonBody(request: Request, maxBytes: number): Promise<unknown> {
  const contentType = request.headers.get("content-type") ?? "";
  if (!contentType.toLowerCase().includes("application/json")) {
    throw new HttpError(415, "Content-Type must be application/json");
  }

  const contentLength = request.headers.get("content-length");
  if (contentLength && Number(contentLength) > maxBytes) {
    throw new HttpError(413, "Request body is too large");
  }

  const body = await request.text();
  if (new TextEncoder().encode(body).length > maxBytes) {
    throw new HttpError(413, "Request body is too large");
  }

  try {
    return JSON.parse(body);
  } catch {
    throw new HttpError(400, "Request body must be valid JSON");
  }
}

async function checkRequestBudget(request: Request, env: Env, scope: RateLimitScope): Promise<Response | null> {
  const source = sourceAddress(request);
  const stub = env.JAMIO_RATE_LIMIT.get(env.JAMIO_RATE_LIMIT.idFromName(`ip:${source}`));
  const response = await stub.fetch("https://jamio-rate-limit/check", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ scope })
  });

  if (response.ok) {
    return null;
  }

  return json(
    {
      error: response.status === 429 ? "Too many requests. Please slow down and try again soon." : "Request rejected"
    },
    response.status,
    {
      "Retry-After": response.headers.get("Retry-After") ?? "60"
    }
  );
}

function sourceAddress(request: Request): string {
  return request.headers.get("CF-Connecting-IP") ?? request.headers.get("X-Forwarded-For")?.split(",")[0]?.trim() ?? "local";
}

function isRateLimitScope(scope: string | undefined): scope is RateLimitScope {
  return scope === "availability" || scope === "room_create" || scope === "room_join" || scope === "ws_connect";
}

function roomExpiryThresholdMs(room: RoomRecord): number {
  if (room.players.some((player) => player.connected)) {
    return roomExpiry.connectedCheckMs;
  }
  if (room.gameState?.phase === "game_over") {
    return roomExpiry.finishedMs;
  }
  if (!room.gameState || room.gameState.phase === "lobby") {
    return roomExpiry.disconnectedLobbyMs;
  }
  return roomExpiry.disconnectedActiveMs;
}

function nextRoomExpiryCheckAt(room: RoomRecord): number {
  if (room.players.some((player) => player.connected)) {
    return Date.now() + roomExpiry.connectedCheckMs;
  }
  return room.updatedAt + roomExpiryThresholdMs(room);
}

function withSecurityHeaders(response: Response, env: Env): Response {
  const headers = new Headers(response.headers);
  headers.set("X-Content-Type-Options", "nosniff");
  headers.set("Referrer-Policy", "no-referrer");
  headers.set("Permissions-Policy", "camera=(), microphone=(), geolocation=(), payment=()");
  headers.set("Cross-Origin-Opener-Policy", "same-origin");

  const contentType = headers.get("content-type") ?? "";
  if (contentType.includes("text/html")) {
    headers.set(
      "Content-Security-Policy",
      "default-src 'self'; base-uri 'self'; object-src 'none'; frame-ancestors 'none'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self' https: wss:; form-action 'self'"
    );
  }

  if (env.ENVIRONMENT === "production") {
    headers.set("Strict-Transport-Security", "max-age=31536000; includeSubDomains");
  }

  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers
  });
}
