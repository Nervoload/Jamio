import { useEffect, useState } from "react";
import { checkRoomAvailability } from "../api/jamioClient";

export type AvailabilityState =
  | { status: "idle"; message: string }
  | { status: "checking"; message: string }
  | { status: "available"; message: string }
  | { status: "taken"; message: string }
  | { status: "unknown"; message: string };

export function useRoomCodeAvailability(roomCode: string): AvailabilityState {
  const [state, setState] = useState<AvailabilityState>({ status: "idle", message: "Choose a room code." });

  useEffect(() => {
    const normalized = roomCode.trim().toUpperCase();
    if (normalized.length < 3) {
      setState({ status: "idle", message: "Room code must be at least 3 characters." });
      return;
    }

    setState({ status: "checking", message: "Checking availability..." });
    const controller = new AbortController();
    const timeout = window.setTimeout(() => {
      checkRoomAvailability(normalized)
        .then((result) => {
          setState(
            result.available
              ? { status: "available", message: `${result.roomCode || normalized} is available.` }
              : { status: "taken", message: `${normalized} is already taken.` }
          );
        })
        .catch(() => {
          if (!controller.signal.aborted) {
            setState({
              status: "unknown",
              message: "Room server is not reachable yet. Creation will still do a final check."
            });
          }
        });
    }, 350);

    return () => {
      controller.abort();
      window.clearTimeout(timeout);
    };
  }, [roomCode]);

  return state;
}
