import { z } from "zod";

export const RoomCodeSchema = z
  .string()
  .trim()
  .transform((value) => value.toUpperCase())
  .pipe(z.string().min(3).max(12).regex(/^[A-Z0-9-]+$/));

export const PlayerNameSchema = z.string().trim().min(1).max(32);
export const PlayerTokenSchema = z.string().min(32).max(256);

export const CardPowerSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("swap") }),
  z.object({ type: z.literal("look_swap") }),
  z.object({ type: z.literal("self_look"), count: z.number().int().min(1).max(10) }),
  z.object({ type: z.literal("look"), count: z.number().int().min(1).max(10) }),
  z.object({ type: z.literal("universal_look"), count: z.number().int().min(1).max(10) }),
  z.object({ type: z.literal("give"), count: z.number().int().min(1).max(10) }),
  z.object({ type: z.literal("donate"), count: z.number().int().min(1).max(10) }),
  z.object({ type: z.literal("burn"), count: z.number().int().min(1).max(10) }),
  z.object({ type: z.literal("draw"), count: z.number().int().min(1).max(10) }),
  z.object({ type: z.literal("emote"), value: z.string().min(1).max(24) })
]);

export const CardRuleSchema = z.object({
  label: z.string().min(1),
  matchGroup: z.string().min(1),
  points: z.number().int().min(-100).max(100),
  power: CardPowerSchema.nullable(),
  triggersFromHand: z.boolean()
});

export const RulesetSchema = z.object({
  name: z.string().min(1).max(80),
  general: z.object({
    canDiscardOnOwnTurn: z.boolean(),
    startingHandSize: z.number().int().min(1).max(8),
    automaticJamioOnZeroCards: z.boolean(),
    drawCardOnMistake: z.boolean(),
    scoreLimit: z.number().int().min(1).max(1000),
    minCardsPlayedBeforeJamio: z.number().int().min(0).max(54),
    badCallPenaltyCards: z.number().int().min(0).max(8),
    deckMode: z.enum(["standard52", "withJokers54"])
  }),
  cardRules: z.record(CardRuleSchema)
});

const CardTargetSchema = z.object({
  playerId: z.string().min(1),
  slotId: z.string().min(1)
});

const PowerChoiceSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("cancel") }),
  z.object({ type: z.literal("swap"), targets: z.tuple([CardTargetSchema, CardTargetSchema]) }),
  z.object({
    type: z.literal("look_swap"),
    targets: z.tuple([CardTargetSchema, CardTargetSchema]),
    swap: z.boolean()
  }),
  z.object({ type: z.literal("reveal"), targets: z.array(CardTargetSchema).min(1).max(10) }),
  z.object({ type: z.literal("give"), targetPlayerId: z.string().min(1) }),
  z.object({
    type: z.literal("donate"),
    targetPlayerId: z.string().min(1),
    handSlotIds: z.array(z.string().min(1)).min(1).max(10)
  }),
  z.object({ type: z.literal("burn"), targets: z.array(CardTargetSchema).min(1).max(10) })
]);

export const GameActionSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("start_game"),
    players: z.array(z.object({ id: z.string().min(1), name: PlayerNameSchema })).min(1).max(10),
    randomSeed: z.string().optional()
  }),
  z.object({ type: z.literal("draw_from_deck") }),
  z.object({ type: z.literal("play_drawn_card") }),
  z.object({ type: z.literal("replace_with_drawn_card"), handSlotId: z.string().min(1) }),
  z.object({ type: z.literal("take_discard_and_replace"), handSlotId: z.string().min(1) }),
  z.object({
    type: z.literal("attempt_discard"),
    targetPlayerId: z.string().min(1),
    handSlotId: z.string().min(1),
    lastPlayedSeq: z.number().int().min(1)
  }),
  z.object({ type: z.literal("resolve_power"), choice: PowerChoiceSchema }),
  z.object({ type: z.literal("resolve_discard_reward"), handSlotIdToDonate: z.string().min(1) }),
  z.object({ type: z.literal("call_jamio") }),
  z.object({ type: z.literal("start_next_round"), randomSeed: z.string().optional() }),
  z.object({ type: z.literal("end_game_now") }),
  z.object({ type: z.literal("leave_table"), playerId: z.string().optional() })
]);

export const CreateRoomRequestSchema = z.object({
  name: PlayerNameSchema,
  roomCode: RoomCodeSchema,
  maxPlayers: z.number().int().min(1).max(10),
  ruleset: RulesetSchema,
  theme: z.string().max(40).optional()
});

export const JoinRoomRequestSchema = z.object({
  name: PlayerNameSchema
});

export const ClientMessageSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("join_room"),
    roomCode: RoomCodeSchema,
    playerToken: PlayerTokenSchema
  }),
  z.object({
    type: z.literal("game_action"),
    action: GameActionSchema,
    clientActionId: z.string().min(1).max(120),
    expectedStateVersion: z.number().int().min(0)
  }),
  z.object({ type: z.literal("ping") })
]);

export const ServerMessageSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("snapshot"),
    view: z.unknown(),
    stateVersion: z.number().int().min(0)
  }),
  z.object({
    type: z.literal("event"),
    event: z.unknown(),
    view: z.unknown().optional(),
    stateVersion: z.number().int().min(0)
  }),
  z.object({
    type: z.literal("private_reveal"),
    cards: z.array(z.unknown()),
    prompt: z.unknown(),
    stateVersion: z.number().int().min(0)
  }),
  z.object({
    type: z.literal("error"),
    code: z.string().min(1),
    message: z.string().min(1),
    stateVersion: z.number().int().min(0).optional()
  }),
  z.object({ type: z.literal("pong") })
]);
