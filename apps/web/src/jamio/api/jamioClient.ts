import type { Ruleset } from "@jamio/game-core";
import type { AvailabilityResponse, CreateRoomResponse, JoinRoomResponse } from "@jamio/protocol";

export type StoredSeat = {
  roomCode: string;
  playerId: string;
  playerToken: string;
  name: string;
  theme?: string;
};

export type CreateRoomInput = {
  name: string;
  roomCode: string;
  maxPlayers: number;
  ruleset: Ruleset;
  theme: string;
};

export type JoinRoomInput = {
  name: string;
  roomCode: string;
};

const lastSeatKey = "jamio:last-seat";

export async function createRoom(input: CreateRoomInput): Promise<CreateRoomResponse> {
  return postJson<CreateRoomResponse>("/api/jamio/rooms", input);
}

export async function joinRoom(input: JoinRoomInput): Promise<JoinRoomResponse> {
  return postJson<JoinRoomResponse>(`/api/jamio/rooms/${encodeURIComponent(input.roomCode)}/join`, {
    name: input.name
  });
}

export async function checkRoomAvailability(roomCode: string): Promise<AvailabilityResponse> {
  const response = await fetch(`${apiBase()}/api/jamio/rooms/${encodeURIComponent(roomCode)}/availability`);
  if (!response.ok) {
    throw new Error(`Availability check failed: ${response.status}`);
  }
  return (await response.json()) as AvailabilityResponse;
}

export function makeJamioWebSocket(roomCode: string): WebSocket {
  const base = apiBase();
  const wsBase =
    base.startsWith("https://")
      ? base.replace(/^https:\/\//, "wss://")
      : base.startsWith("http://")
        ? base.replace(/^http:\/\//, "ws://")
        : `${window.location.protocol === "https:" ? "wss" : "ws"}://${window.location.host}`;
  return new WebSocket(`${wsBase}/api/jamio/ws?roomCode=${encodeURIComponent(roomCode)}`);
}

export function saveSeat(seat: StoredSeat): void {
  window.localStorage.setItem(lastSeatKey, JSON.stringify(seat));
  window.localStorage.setItem(`jamio:seat:${seat.roomCode}`, JSON.stringify(seat));
}

export function loadLastSeat(): StoredSeat | null {
  const raw = window.localStorage.getItem(lastSeatKey);
  if (!raw) {
    return null;
  }
  try {
    return JSON.parse(raw) as StoredSeat;
  } catch {
    return null;
  }
}

export function clearLastSeat(): void {
  const last = loadLastSeat();
  if (last) {
    window.localStorage.removeItem(`jamio:seat:${last.roomCode}`);
  }
  window.localStorage.removeItem(lastSeatKey);
}

async function postJson<T>(path: string, body: unknown): Promise<T> {
  const response = await fetch(`${apiBase()}${path}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body)
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    const message =
      typeof payload === "object" && payload && "error" in payload ? String(payload.error) : `Request failed: ${response.status}`;
    throw new Error(message);
  }
  return payload as T;
}

function apiBase(): string {
  const configured = import.meta.env.VITE_JAMIO_API_BASE?.replace(/\/$/, "");
  if (configured) {
    return configured;
  }
  if (window.location.hostname === "localhost" && window.location.port === "5173") {
    return "http://localhost:8787";
  }
  return "";
}
