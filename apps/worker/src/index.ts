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
  ENVIRONMENT?: string;
  ALLOWED_ORIGIN?: string;
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

export class JamioRoom {
  private room: RoomRecord | null = null;
  private readonly sessions = new Map<WebSocket, PlayerId>();

  constructor(
    private readonly state: DurableObjectState,
    private readonly env: Env
  ) {
    this.state.blockConcurrencyWhile(async () => {
      this.room = (await this.state.storage.get<RoomRecord>(roomKey)) ?? null;
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
      const parsed = CreateRoomRequestSchema.parse(await request.json());
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
        playerToken: host.token
      });
    }

    if (url.pathname === "/join" && request.method === "POST") {
      const parsed = JoinRoomRequestSchema.parse(await request.json());
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
        playerToken: player.token
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
    server.accept();

    server.addEventListener("message", (event) => {
      void this.handleSocketMessage(server, event.data);
    });
    server.addEventListener("close", () => {
      void this.handleSocketClose(server);
    });
    server.addEventListener("error", () => {
      void this.handleSocketClose(server);
    });

    return new Response(null, { status: 101, webSocket: client });
  }

  private async handleSocketMessage(socket: WebSocket, raw: unknown): Promise<void> {
    try {
      if (typeof raw !== "string") {
        send(socket, { type: "error", code: "INVALID_MESSAGE", message: "Message must be text" });
        return;
      }
      if (raw.length > 16_384) {
        send(socket, { type: "error", code: "MESSAGE_TOO_LARGE", message: "Message is too large" });
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

      if (!room.gameState && message.action.type === "start_game") {
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
    }
  }
}

type LobbyView = Omit<PlayerView, "phase"> & {
  phase: "lobby";
};

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    if (request.method === "OPTIONS") {
      return new Response(null, { headers: corsHeaders(request, env) });
    }

    const url = new URL(request.url);
    try {
      if (url.pathname.match(/^\/api\/jamio\/rooms\/[^/]+\/availability$/) && request.method === "GET") {
        const roomCode = RoomCodeSchema.parse(url.pathname.split("/").at(-2));
        const stub = env.JAMIO_ROOM.get(env.JAMIO_ROOM.idFromName(roomCode));
        return withCors(
          await stub.fetch(`https://jamio-room/availability?roomCode=${encodeURIComponent(roomCode)}`),
          request,
          env
        );
      }

      if (url.pathname === "/api/jamio/rooms" && request.method === "POST") {
        const body = CreateRoomRequestSchema.parse(await request.json());
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
        const roomCode = RoomCodeSchema.parse(joinMatch[1]);
        const body = JoinRoomRequestSchema.parse(await request.json());
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
        const roomCode = RoomCodeSchema.parse(url.searchParams.get("roomCode"));
        const stub = env.JAMIO_ROOM.get(env.JAMIO_ROOM.idFromName(roomCode));
        return stub.fetch("https://jamio-room/ws", request);
      }

      return withCors(json({ error: "Not found" }, 404), request, env);
    } catch (error) {
      return withCors(
        json(
          {
            error: error instanceof Error ? error.message : "Request failed"
          },
          400
        ),
        request,
        env
      );
    }
  }
};

function json<T>(body: T, status = 200): Response {
  return Response.json(body, { status });
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
  const accessControlAllowOrigin = origin && (origin === allowedOrigin || env.ENVIRONMENT !== "production") ? origin : allowedOrigin;
  return {
    "Access-Control-Allow-Origin": accessControlAllowOrigin,
    "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    "Vary": "Origin"
  };
}

function withCors(response: Response, request: Request, env: Env): Response {
  const headers = new Headers(response.headers);
  for (const [key, value] of Object.entries(corsHeaders(request, env))) {
    headers.set(key, value);
  }
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers
  });
}

function isAllowedWebSocketOrigin(request: Request, env: Env): boolean {
  if (env.ENVIRONMENT !== "production") {
    return true;
  }
  const origin = request.headers.get("Origin");
  return origin === (env.ALLOWED_ORIGIN ?? "https://johnsurette.com");
}
