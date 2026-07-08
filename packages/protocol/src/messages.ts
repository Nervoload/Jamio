import type { z } from "zod";
import type {
  ClientMessageSchema,
  CreateRoomRequestSchema,
  GameActionSchema,
  JoinRoomRequestSchema,
  RulesetSchema,
  ServerMessageSchema
} from "./schemas";

export type CreateRoomRequest = z.infer<typeof CreateRoomRequestSchema>;
export type JoinRoomRequest = z.infer<typeof JoinRoomRequestSchema>;
export type RulesetWire = z.infer<typeof RulesetSchema>;
export type GameActionWire = z.infer<typeof GameActionSchema>;
export type ClientMessage = z.infer<typeof ClientMessageSchema>;
export type ServerMessage = z.infer<typeof ServerMessageSchema>;

export type CreateRoomResponse = {
  roomCode: string;
  playerId: string;
  playerToken: string;
  theme: string;
};

export type JoinRoomResponse = {
  roomCode: string;
  playerId: string;
  playerToken: string;
  theme: string;
};

export type AvailabilityResponse = {
  roomCode: string;
  available: boolean;
};
