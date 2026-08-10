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

type QueuedAction = {
  action: GameAction;
  clientActionId: string;
};

export function useJamioSocket(credentials: JamioSocketCredentials | null): JamioSocketState {
  const [status, setStatus] = useState<JamioSocketStatus>("idle");
  const [view, setView] = useState<PlayerView | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [retry, setRetry] = useState(0);
  const socketRef = useRef<WebSocket | null>(null);
  const viewRef = useRef<PlayerView | null>(null);
  const actionQueueRef = useRef<QueuedAction[]>([]);
  const inFlightActionIdRef = useRef<string | null>(null);
  const rejectedActionIdRef = useRef<string | null>(null);

  const flushActionQueue = useCallback((socketOverride?: WebSocket) => {
    const socket = socketOverride ?? socketRef.current;
    const currentView = viewRef.current;
    const queued = actionQueueRef.current[0];
    if (
      inFlightActionIdRef.current ||
      !queued ||
      !socket ||
      socket.readyState !== WebSocket.OPEN ||
      !currentView
    ) {
      return;
    }
    inFlightActionIdRef.current = queued.clientActionId;
    socket.send(
      JSON.stringify(
        ClientMessageSchema.parse({
          type: "game_action",
          action: queued.action,
          clientActionId: queued.clientActionId,
          expectedStateVersion: currentView.version
        })
      )
    );
  }, []);

  useEffect(() => {
    viewRef.current = view;
  }, [view]);

  useEffect(() => {
    actionQueueRef.current = [];
    inFlightActionIdRef.current = null;
    rejectedActionIdRef.current = null;
  }, [credentials?.roomCode, credentials?.playerToken]);

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
        const nextView = message.view as PlayerView;
        viewRef.current = nextView;
        setView(nextView);
        if (
          message.type === "snapshot" &&
          message.acknowledgedClientActionId &&
          message.acknowledgedClientActionId !== rejectedActionIdRef.current
        ) {
          setError(null);
        }
        if (
          message.type === "snapshot" &&
          message.acknowledgedClientActionId === inFlightActionIdRef.current
        ) {
          actionQueueRef.current.shift();
          inFlightActionIdRef.current = null;
        }
        flushActionQueue(socket);
      }
      if (message.type === "error") {
        if (message.code === "STALE_STATE") {
          rejectedActionIdRef.current = null;
        } else {
          rejectedActionIdRef.current = message.clientActionId ?? inFlightActionIdRef.current;
          setError(message.message);
        }
        if (
          message.code !== "STALE_STATE" &&
          inFlightActionIdRef.current &&
          (!message.clientActionId || message.clientActionId === inFlightActionIdRef.current)
        ) {
          actionQueueRef.current.shift();
          inFlightActionIdRef.current = null;
          flushActionQueue(socket);
        }
      }
    });

    socket.addEventListener("close", () => {
      if (cancelled) {
        return;
      }
      inFlightActionIdRef.current = null;
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
  }, [credentials?.roomCode, credentials?.playerToken, flushActionQueue, retry]);

  const sendGameAction = useCallback((action: GameAction) => {
    const socket = socketRef.current;
    if (!socket || socket.readyState !== WebSocket.OPEN || !viewRef.current) {
      setError("The room connection is not ready yet.");
      return;
    }
    const clientActionId = crypto.randomUUID?.() ?? `${Date.now()}-${Math.random()}`;
    actionQueueRef.current.push({ action, clientActionId });
    flushActionQueue(socket);
  }, [flushActionQueue]);

  return { status, view, error, sendGameAction };
}
