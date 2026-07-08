import { useCallback, useEffect, useRef, useState } from "react";
import type { GameAction, PlayerView } from "@jamio/game-core";
import { ClientMessageSchema, ServerMessageSchema } from "@jamio/protocol";
import { makeJamioWebSocket } from "../api/jamioClient";

type JamioSocketCredentials = {
  roomCode: string;
  playerToken: string;
};

export type JamioSocketStatus = "idle" | "connecting" | "connected" | "reconnecting" | "closed";

export type JamioSocketState = {
  status: JamioSocketStatus;
  view: PlayerView | null;
  error: string | null;
  sendGameAction: (action: GameAction) => void;
};

export function useJamioSocket(credentials: JamioSocketCredentials | null): JamioSocketState {
  const [status, setStatus] = useState<JamioSocketStatus>("idle");
  const [view, setView] = useState<PlayerView | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [retry, setRetry] = useState(0);
  const socketRef = useRef<WebSocket | null>(null);
  const viewRef = useRef<PlayerView | null>(null);

  useEffect(() => {
    viewRef.current = view;
  }, [view]);

  useEffect(() => {
    if (!credentials) {
      setStatus("idle");
      setView(null);
      setError(null);
      return;
    }

    let reconnectTimer: number | null = null;
    let cancelled = false;
    setStatus(retry === 0 ? "connecting" : "reconnecting");

    const socket = makeJamioWebSocket(credentials.roomCode);
    socketRef.current = socket;

    socket.addEventListener("open", () => {
      setStatus("connected");
      setError(null);
      socket.send(
        JSON.stringify(
          ClientMessageSchema.parse({
            type: "join_room",
            roomCode: credentials.roomCode,
            playerToken: credentials.playerToken
          })
        )
      );
    });

    socket.addEventListener("message", (event) => {
      let rawMessage: unknown;
      try {
        rawMessage = JSON.parse(String(event.data));
      } catch {
        setError("Received unreadable data from the room server.");
        return;
      }
      const parsed = ServerMessageSchema.safeParse(rawMessage);
      if (!parsed.success) {
        setError("Received an invalid server message.");
        return;
      }
      const message = parsed.data;
      if ((message.type === "snapshot" || message.type === "event") && message.view) {
        setView(message.view as PlayerView);
      }
      if (message.type === "error") {
        setError(message.message);
      }
    });

    socket.addEventListener("close", () => {
      if (cancelled) {
        return;
      }
      setStatus("closed");
      reconnectTimer = window.setTimeout(() => {
        setRetry((current) => current + 1);
      }, 1500);
    });

    socket.addEventListener("error", () => {
      setError("Connection error. Retrying shortly.");
    });

    return () => {
      cancelled = true;
      if (reconnectTimer) {
        window.clearTimeout(reconnectTimer);
      }
      socket.close();
    };
  }, [credentials?.roomCode, credentials?.playerToken, retry]);

  const sendGameAction = useCallback((action: GameAction) => {
    const socket = socketRef.current;
    const currentView = viewRef.current;
    if (!socket || socket.readyState !== WebSocket.OPEN || !currentView) {
      setError("The room connection is not ready yet.");
      return;
    }
    const clientActionId = crypto.randomUUID?.() ?? `${Date.now()}-${Math.random()}`;
    socket.send(
      JSON.stringify(
        ClientMessageSchema.parse({
          type: "game_action",
          action,
          clientActionId,
          expectedStateVersion: currentView.version
        })
      )
    );
  }, []);

  return { status, view, error, sendGameAction };
}
