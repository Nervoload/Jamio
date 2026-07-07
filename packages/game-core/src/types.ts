export type Suit = "S" | "C" | "H" | "D";
export type Rank =
  | "A"
  | "2"
  | "3"
  | "4"
  | "5"
  | "6"
  | "7"
  | "8"
  | "9"
  | "10"
  | "J"
  | "Q"
  | "K"
  | "JOKER";

export type CardId = string;
export type PlayerId = string;
export type RoomId = string;
export type HandSlotId = string;

export type DeckMode = "standard52" | "withJokers54";

export type Card = {
  id: CardId;
  rank: Rank;
  suit: Suit | null;
  label: string;
  matchGroup: string;
  ruleKey: string;
};

export type CardPower =
  | { type: "swap" }
  | { type: "look_swap" }
  | { type: "self_look"; count: number }
  | { type: "look"; count: number }
  | { type: "universal_look"; count: number }
  | { type: "give"; count: number }
  | { type: "donate"; count: number }
  | { type: "burn"; count: number }
  | { type: "draw"; count: number }
  | { type: "emote"; value: string };

export type CardRule = {
  label: string;
  matchGroup: string;
  points: number;
  power: CardPower | null;
  triggersFromHand: boolean;
};

export type CardRuleMap = Record<string, CardRule>;

export type GeneralRules = {
  canDiscardOnOwnTurn: boolean;
  startingHandSize: number;
  automaticJamioOnZeroCards: boolean;
  drawCardOnMistake: boolean;
  scoreLimit: number;
  minCardsPlayedBeforeJamio: number;
  badCallPenaltyCards: number;
  deckMode: DeckMode;
};

export type Ruleset = {
  name: string;
  general: GeneralRules;
  cardRules: CardRuleMap;
};

export type GamePhase =
  | "lobby"
  | "round_setup"
  | "initial_countdown"
  | "initial_memorize"
  | "turn_idle"
  | "drawn_card_decision"
  | "selecting_replacement"
  | "resolving_power"
  | "discard_reward"
  | "jamio_final_cycle"
  | "round_reveal"
  | "game_over";

export type Player = {
  id: PlayerId;
  name: string;
};

export type PlayerState = Player & {
  connected: boolean;
  active: boolean;
};

export type HandCard = {
  slotId: HandSlotId;
  cardId: CardId;
  visibleTo: PlayerId[];
};

export type DrawnCardState = {
  cardId: CardId;
  drawnBy: PlayerId;
  source: "deck";
};

export type CardTarget = {
  playerId: PlayerId;
  slotId: HandSlotId;
};

export type PendingPower = {
  actorId: PlayerId;
  cardId: CardId;
  power: CardPower;
  source: "drawn" | "hand";
};

export type PendingDiscardReward = {
  actorId: PlayerId;
  targetPlayerId: PlayerId;
  resumePhase: GamePhase;
};

export type LastPlayedState = {
  seq: number;
  cardId: CardId;
  matchGroup: string;
  playedBy: PlayerId;
  openedAtVersion: number;
  closed: boolean;
};

export type JamioState = {
  callerId: PlayerId;
  remainingPlayerIds: PlayerId[];
};

export type GameEvent = {
  id: string;
  type: string;
  message: string;
  actorId?: PlayerId;
  publicCardId?: CardId;
};

export type GameState = {
  roomId: RoomId;
  phase: GamePhase;
  version: number;
  players: PlayerState[];
  hostPlayerId: PlayerId;
  direction: 1 | -1;
  currentTurnPlayerId: PlayerId | null;
  roundStarterIndex: number;
  deck: CardId[];
  discardPile: CardId[];
  hands: Record<PlayerId, HandCard[]>;
  scores: Record<PlayerId, number>;
  roundScores: Record<PlayerId, number>;
  roundNumber: number;
  drawnCard: DrawnCardState | null;
  pendingPower: PendingPower | null;
  pendingDiscardReward: PendingDiscardReward | null;
  lastPlayed: LastPlayedState | null;
  jamio: JamioState | null;
  nextRoundPenaltyCards: Record<PlayerId, number>;
  ruleset: Ruleset;
  cardsPlayedThisRound: number;
  eventLog: GameEvent[];
  cardsById: Record<CardId, Card>;
  randomSeed: string;
  lastPlayedSeq: number;
  roundWinnerId: PlayerId | null;
  gameWinnerId: PlayerId | null;
};

export type PowerChoice =
  | { type: "cancel" }
  | { type: "swap"; targets: [CardTarget, CardTarget] }
  | { type: "look_swap"; targets: [CardTarget, CardTarget]; swap: boolean }
  | { type: "reveal"; targets: CardTarget[] }
  | { type: "give"; targetPlayerId: PlayerId }
  | { type: "donate"; targetPlayerId: PlayerId; handSlotIds: HandSlotId[] }
  | { type: "burn"; targets: CardTarget[] };

export type GameAction =
  | { type: "start_game"; players: Player[]; randomSeed?: string | undefined }
  | { type: "draw_from_deck" }
  | { type: "play_drawn_card" }
  | { type: "replace_with_drawn_card"; handSlotId: HandSlotId }
  | { type: "take_discard_and_replace"; handSlotId: HandSlotId }
  | {
      type: "attempt_discard";
      targetPlayerId: PlayerId;
      handSlotId: HandSlotId;
      lastPlayedSeq: number;
    }
  | { type: "resolve_power"; choice: PowerChoice }
  | { type: "resolve_discard_reward"; handSlotIdToDonate: HandSlotId }
  | { type: "call_jamio" }
  | { type: "start_next_round"; randomSeed?: string | undefined }
  | { type: "end_game_now" }
  | { type: "leave_table"; playerId?: PlayerId | undefined };

export type LegalAction =
  | { type: "start_game" }
  | { type: "draw_from_deck" }
  | { type: "play_drawn_card" }
  | { type: "replace_with_drawn_card"; handSlotIds: HandSlotId[] }
  | { type: "take_discard_and_replace"; handSlotIds: HandSlotId[] }
  | { type: "attempt_discard" }
  | { type: "resolve_power" }
  | { type: "resolve_discard_reward"; handSlotIds: HandSlotId[] }
  | { type: "call_jamio" }
  | { type: "start_next_round" }
  | { type: "end_game_now" };

export type PublicCard = {
  id: CardId;
  rank: Rank;
  suit: Suit | null;
  label: string;
  matchGroup: string;
  points: number;
};

export type ClientHandCard = {
  slotId: HandSlotId;
  card: PublicCard | null;
};

export type PublicOpponentHand = {
  playerId: PlayerId;
  cards: Array<{ slotId: HandSlotId; card: PublicCard | null }>;
};

export type PublicPlayerView = PlayerState & {
  cardCount: number;
};

export type PlayerPrompt =
  | { type: "drawn_card_decision"; card: PublicCard }
  | { type: "select_replacement" }
  | { type: "resolve_power"; power: CardPower }
  | { type: "discard_reward"; targetPlayerId: PlayerId }
  | null;

export type PlayerView = {
  roomId: RoomId;
  phase: GamePhase;
  version: number;
  you: PlayerId;
  hostPlayerId: PlayerId;
  players: PublicPlayerView[];
  yourHand: ClientHandCard[];
  opponentHands: PublicOpponentHand[];
  deckCount: number;
  discardTop: PublicCard | null;
  discardCount: number;
  currentTurnPlayerId: PlayerId | null;
  legalActions: LegalAction[];
  pendingPrompt: PlayerPrompt;
  scores: Record<PlayerId, number>;
  roundScores: Record<PlayerId, number>;
  roundNumber: number;
  lastPlayedSeq: number | null;
  jamioCallerId: PlayerId | null;
  eventLog: GameEvent[];
  roundWinnerId: PlayerId | null;
  gameWinnerId: PlayerId | null;
};

export type ApplyActionResult = {
  state: GameState;
  events: GameEvent[];
};
