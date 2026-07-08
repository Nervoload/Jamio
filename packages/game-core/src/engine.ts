import { toPublicCard } from "./cards";
import { createDeck } from "./deck";
import { assertJamio, JamioError } from "./errors";
import { shuffle } from "./random";
import { getCardRule, validateRulesetForPlayers } from "./ruleset";
import type {
  ApplyActionResult,
  Card,
  CardId,
  CardPower,
  CardTarget,
  GameAction,
  GameEvent,
  GamePhase,
  GameState,
  HandCard,
  HandSlotId,
  LegalAction,
  Player,
  PlayerId,
  PowerChoice,
  PublicCard,
  Ruleset
} from "./types";

export type InitialRoundOptions = {
  roomId?: string;
  hostPlayerId?: PlayerId;
  scores?: Record<PlayerId, number>;
  roundNumber?: number;
  nextRoundPenaltyCards?: Record<PlayerId, number>;
};

type GameEventDetails = Partial<
  Pick<GameEvent, "target" | "targets" | "targetPlayerId" | "source" | "destination" | "count">
>;

type OccupiedHandCard = HandCard & { cardId: CardId };

export function createInitialRound(
  players: Player[],
  ruleset: Ruleset,
  randomSeed: string,
  options: InitialRoundOptions = {}
): GameState {
  validateRulesetForPlayers(ruleset, players.length);
  assertJamio(players.length >= 1, "At least one player is required", "NOT_ENOUGH_PLAYERS");

  const deckCards = createDeck(ruleset.general.deckMode);
  const cardsById = Object.fromEntries(deckCards.map((card) => [card.id, card]));
  const shuffled = shuffle(
    deckCards.map((card) => card.id),
    randomSeed
  );
  const hands: Record<PlayerId, HandCard[]> = {};
  const roundNumber = options.roundNumber ?? 1;
  const playerStates = players.map((player) => ({
    ...player,
    connected: true,
    active: true
  }));

  let deckIndex = 0;
  for (const player of playerStates) {
    hands[player.id] = [];
    const handSize = ruleset.general.startingHandSize + (options.nextRoundPenaltyCards?.[player.id] ?? 0);
    for (let slotIndex = 0; slotIndex < handSize; slotIndex += 1) {
      const cardId = shuffled[deckIndex];
      assertJamio(cardId, "Deck ended while dealing", "DECK_EXHAUSTED");
      hands[player.id]!.push({
        slotId: makeSlotId(player.id, roundNumber, slotIndex),
        cardId,
        visibleTo: []
      });
      deckIndex += 1;
    }
  }

  const randomBits = shuffle([0, 1, 2, 3], `${randomSeed}:turn`);
  const roundStarterIndex = (randomBits[0] ?? 0) % playerStates.length;
  const direction = (randomBits[1] ?? 0) % 2 === 0 ? 1 : -1;
  const scores = Object.fromEntries(playerStates.map((player) => [player.id, options.scores?.[player.id] ?? 0]));

  return {
    roomId: options.roomId ?? "local",
    phase: "turn_idle",
    version: 0,
    players: playerStates,
    hostPlayerId: options.hostPlayerId ?? playerStates[0]!.id,
    direction,
    currentTurnPlayerId: playerStates[roundStarterIndex]!.id,
    roundStarterIndex,
    deck: shuffled.slice(deckIndex),
    discardPile: [],
    hands,
    scores,
    roundScores: {},
    roundNumber,
    drawnCard: null,
    pendingPower: null,
    pendingDiscardReward: null,
    lastPlayed: null,
    jamio: null,
    nextRoundPenaltyCards: {},
    ruleset,
    cardsPlayedThisRound: 0,
    eventLog: [],
    cardsById,
    randomSeed,
    lastPlayedSeq: 0,
    roundWinnerId: null,
    gameWinnerId: null
  };
}

export function getLegalActions(state: GameState, playerId: PlayerId): LegalAction[] {
  const actions: LegalAction[] = [];
  const ownHand = occupiedHandCards(state, playerId);
  const isCurrentPlayer = state.currentTurnPlayerId === playerId;
  const canUseTurnAction =
    isCurrentPlayer && (state.phase === "turn_idle" || state.phase === "jamio_final_cycle");

  if (canUseTurnAction) {
    actions.push({ type: "draw_from_deck" });
    if (state.discardPile.length > 0 && ownHand.length > 0) {
      actions.push({
        type: "take_discard_and_replace",
        handSlotIds: ownHand.map((card) => card.slotId)
      });
    }
    if (!state.jamio && state.cardsPlayedThisRound >= state.ruleset.general.minCardsPlayedBeforeJamio) {
      actions.push({ type: "call_jamio" });
    }
  }

  if (state.phase === "drawn_card_decision" && state.drawnCard?.drawnBy === playerId) {
    actions.push({ type: "play_drawn_card" });
    actions.push({
      type: "replace_with_drawn_card",
      handSlotIds: ownHand.map((card) => card.slotId)
    });
  }

  if (state.phase === "resolving_power" && state.pendingPower?.actorId === playerId) {
    actions.push({ type: "resolve_power" });
  }

  if (state.phase === "discard_reward" && state.pendingDiscardReward?.actorId === playerId) {
    actions.push({
      type: "resolve_discard_reward",
      handSlotIds: ownHand.map((card) => card.slotId)
    });
  }

  if (canAttemptDiscard(state, playerId)) {
    actions.push({ type: "attempt_discard" });
  }

  if (state.phase === "round_reveal" && state.hostPlayerId === playerId) {
    actions.push({ type: "start_next_round" }, { type: "end_game_now" });
  }

  return actions;
}

export function applyAction(state: GameState, playerId: PlayerId, action: GameAction): ApplyActionResult {
  const beforeEventCount = state.eventLog.length;
  let next = cloneState(state);

  switch (action.type) {
    case "start_game": {
      assertJamio(next.phase === "lobby", "Game can only start from lobby", "INVALID_PHASE");
      assertJamio(next.hostPlayerId === playerId, "Only the host can start the game", "NOT_HOST");
      next = createInitialRound(action.players, next.ruleset, action.randomSeed ?? `${Date.now()}`, {
        roomId: next.roomId,
        hostPlayerId: next.hostPlayerId,
        scores: next.scores,
        roundNumber: next.roundNumber
      });
      break;
    }
    case "draw_from_deck": {
      assertTurnAction(next, playerId);
      assertJamio(!next.drawnCard, "A drawn card is already pending", "DRAW_ALREADY_PENDING");
      const cardId = drawOne(next);
      next.drawnCard = { cardId, drawnBy: playerId, source: "deck" };
      next.phase = "drawn_card_decision";
      addEvent(next, "draw", `${playerName(next, playerId)} drew from the deck`, playerId, undefined, {
        source: "deck",
        destination: "hand",
        targetPlayerId: playerId,
        count: 1
      });
      break;
    }
    case "play_drawn_card": {
      assertJamio(next.phase === "drawn_card_decision", "No drawn card can be played now", "INVALID_PHASE");
      assertJamio(next.drawnCard?.drawnBy === playerId, "This is not your drawn card", "NOT_YOUR_DRAWN_CARD");
      const cardId = next.drawnCard.cardId;
      next.drawnCard = null;
      playCardToDiscard(next, playerId, cardId, "drawn");
      maybeTriggerPowerOrAdvance(next, playerId, cardId, "drawn");
      break;
    }
    case "replace_with_drawn_card": {
      assertJamio(next.phase === "drawn_card_decision", "No drawn card can replace now", "INVALID_PHASE");
      assertJamio(next.drawnCard?.drawnBy === playerId, "This is not your drawn card", "NOT_YOUR_DRAWN_CARD");
      const drawnCardId = next.drawnCard.cardId;
      const replaced = replaceHandCard(next, playerId, action.handSlotId, drawnCardId);
      next.drawnCard = null;
      addEvent(next, "replace_card", `${playerName(next, playerId)} replaced one of their cards`, playerId, undefined, {
        target: { playerId, slotId: action.handSlotId },
        source: "drawn",
        destination: "hand"
      });
      playCardToDiscard(next, playerId, replaced.cardId, "hand");
      maybeTriggerPowerOrAdvance(next, playerId, replaced.cardId, "hand");
      break;
    }
    case "take_discard_and_replace": {
      assertTurnAction(next, playerId);
      assertJamio(next.discardPile.length > 0, "The played stack is empty", "EMPTY_DISCARD");
      const takenCardId = next.discardPile.pop();
      assertJamio(takenCardId, "The played stack is empty", "EMPTY_DISCARD");
      const replaced = replaceHandCard(next, playerId, action.handSlotId, takenCardId);
      addEvent(next, "replace_card", `${playerName(next, playerId)} took the played card`, playerId, undefined, {
        target: { playerId, slotId: action.handSlotId },
        source: "discard",
        destination: "hand"
      });
      playCardToDiscard(next, playerId, replaced.cardId, "hand");
      maybeTriggerPowerOrAdvance(next, playerId, replaced.cardId, "hand");
      break;
    }
    case "attempt_discard": {
      attemptDiscard(next, playerId, action.targetPlayerId, action.handSlotId, action.lastPlayedSeq);
      break;
    }
    case "resolve_discard_reward": {
      resolveDiscardReward(next, playerId, action.handSlotIdToDonate);
      break;
    }
    case "resolve_power": {
      resolvePower(next, playerId, action.choice);
      break;
    }
    case "call_jamio": {
      assertTurnAction(next, playerId);
      assertJamio(!next.jamio, "Jamio has already been called", "JAMIO_ALREADY_CALLED");
      assertJamio(
        next.cardsPlayedThisRound >= next.ruleset.general.minCardsPlayedBeforeJamio,
        "Not enough cards have been played to call Jamio",
        "JAMIO_TOO_EARLY"
      );
      beginJamio(next, playerId);
      break;
    }
    case "start_next_round": {
      assertJamio(next.phase === "round_reveal", "Next round can only start after a reveal", "INVALID_PHASE");
      assertJamio(next.hostPlayerId === playerId, "Only the host can start the next round", "NOT_HOST");
      const seed = action.randomSeed ?? `${next.randomSeed}:round:${next.roundNumber + 1}`;
      next = startNextRound(next, seed);
      break;
    }
    case "end_game_now": {
      assertJamio(next.hostPlayerId === playerId, "Only the host can end the game", "NOT_HOST");
      next = endGame(next);
      break;
    }
    case "restart_game": {
      throw new JamioError("Restart is handled by the room server", "ROOM_ACTION_ONLY");
    }
    case "leave_table": {
      const leavingPlayerId = action.playerId ?? playerId;
      const player = next.players.find((candidate) => candidate.id === leavingPlayerId);
      assertJamio(player, "Player does not exist", "UNKNOWN_PLAYER");
      player.active = false;
      player.connected = false;
      addEvent(next, "leave", `${player.name} left the table`, leavingPlayerId);
      break;
    }
    default: {
      const neverAction: never = action;
      throw new JamioError(`Unhandled action ${JSON.stringify(neverAction)}`, "UNHANDLED_ACTION");
    }
  }

  next.version += 1;
  const events = next.eventLog.slice(beforeEventCount);
  return { state: next, events };
}

export function scoreRound(state: GameState): {
  roundScores: Record<PlayerId, number>;
  roundWinnerId: PlayerId;
} {
  const roundScores = Object.fromEntries(
    state.players
      .filter((player) => player.active)
      .map((player) => [
        player.id,
        (state.hands[player.id] ?? []).reduce((total, handCard) => {
          if (!handCard.cardId) {
            return total;
          }
          const card = getCard(state, handCard.cardId);
          return total + getCardRule(card, state.ruleset).points;
        }, 0)
      ])
  );
  const roundWinnerId = getLowestScorePlayerId(roundScores);
  return { roundScores, roundWinnerId };
}

export function startNextRound(state: GameState, randomSeed = `${state.randomSeed}:next`): GameState {
  const activePlayers = state.players.filter((player) => player.active).map(({ id, name }) => ({ id, name }));
  return createInitialRound(activePlayers, state.ruleset, randomSeed, {
    roomId: state.roomId,
    hostPlayerId: state.hostPlayerId,
    scores: state.scores,
    roundNumber: state.roundNumber + 1,
    nextRoundPenaltyCards: state.nextRoundPenaltyCards
  });
}

export function endGame(state: GameState): GameState {
  const next = cloneState(state);
  next.phase = "game_over";
  next.gameWinnerId = getLowestScorePlayerId(next.scores);
  next.currentTurnPlayerId = null;
  addEvent(next, "game_over", `${playerName(next, next.gameWinnerId)} wins Jamio`);
  return next;
}

export function publicCardFor(state: GameState, cardId: CardId): PublicCard {
  const card = getCard(state, cardId);
  const rule = getCardRule(card, state.ruleset);
  return toPublicCard(card, rule.points);
}

function makeSlotId(playerId: PlayerId, roundNumber: number, slotIndex: number): HandSlotId {
  return `${playerId}-r${roundNumber}-s${slotIndex}`;
}

function cloneState(state: GameState): GameState {
  return JSON.parse(JSON.stringify(state)) as GameState;
}

function assertTurnAction(state: GameState, playerId: PlayerId): void {
  assertJamio(state.currentTurnPlayerId === playerId, "It is not your turn", "NOT_YOUR_TURN");
  assertJamio(
    state.phase === "turn_idle" || state.phase === "jamio_final_cycle",
    `Cannot take a turn action during ${state.phase}`,
    "INVALID_PHASE"
  );
}

function canAttemptDiscard(state: GameState, playerId: PlayerId): boolean {
  if (!state.lastPlayed || state.lastPlayed.closed) {
    return false;
  }
  if (state.phase === "round_reveal" || state.phase === "game_over" || state.phase === "initial_countdown") {
    return false;
  }
  if (!state.ruleset.general.canDiscardOnOwnTurn && state.currentTurnPlayerId === playerId) {
    return false;
  }
  return true;
}

function attemptDiscard(
  state: GameState,
  actorId: PlayerId,
  targetPlayerId: PlayerId,
  handSlotId: HandSlotId,
  lastPlayedSeq: number
): void {
  assertJamio(canAttemptDiscard(state, actorId), "Discard is not allowed now", "DISCARD_NOT_ALLOWED");
  assertJamio(state.lastPlayed?.seq === lastPlayedSeq, "Discard window is stale", "STALE_DISCARD_WINDOW");

  const target = findOccupiedHandCard(state, targetPlayerId, handSlotId);
  const targetCard = getCard(state, target.handCard.cardId);
  const targetRule = getCardRule(targetCard, state.ruleset);
  const isCorrect = targetRule.matchGroup === state.lastPlayed.matchGroup;

  if (targetPlayerId === actorId) {
    if (isCorrect) {
      removeHandCard(state, targetPlayerId, handSlotId);
      addEvent(state, "discard_correct", `${playerName(state, actorId)} discarded their own ${targetRule.matchGroup}`, actorId, undefined, {
        target: { playerId: targetPlayerId, slotId: handSlotId },
        targetPlayerId,
        source: "hand",
        destination: "discard"
      });
      maybeAutoJamio(state, actorId);
      return;
    }
    drawMistakePenalty(state, actorId);
    addEvent(state, "discard_mistake", `${playerName(state, actorId)} missed a discard`, actorId, undefined, {
      target: { playerId: targetPlayerId, slotId: handSlotId },
      targetPlayerId,
      source: "hand"
    });
    return;
  }

  if (isCorrect) {
    removeHandCard(state, targetPlayerId, handSlotId);
    addEvent(
      state,
      "opponent_discard_correct",
      `${playerName(state, actorId)} discarded a card from ${playerName(state, targetPlayerId)}`,
      actorId,
      undefined,
      {
        target: { playerId: targetPlayerId, slotId: handSlotId },
        targetPlayerId,
        source: "hand",
        destination: "discard"
      }
    );
    if (occupiedHandCards(state, actorId).length > 0) {
      state.pendingDiscardReward = {
        actorId,
        targetPlayerId,
        resumePhase: state.phase
      };
      state.phase = "discard_reward";
    }
    maybeAutoJamio(state, targetPlayerId);
    return;
  }

  drawMistakePenalty(state, actorId);
  addEvent(state, "opponent_discard_mistake", `${playerName(state, actorId)} missed an opponent discard`, actorId, undefined, {
    target: { playerId: targetPlayerId, slotId: handSlotId },
    targetPlayerId,
    source: "hand"
  });
}

function resolveDiscardReward(state: GameState, actorId: PlayerId, handSlotId: HandSlotId): void {
  assertJamio(state.phase === "discard_reward", "No discard reward is pending", "INVALID_PHASE");
  assertJamio(state.pendingDiscardReward?.actorId === actorId, "This discard reward is not yours", "NOT_YOUR_REWARD");
  const reward = state.pendingDiscardReward;
  const donated = removeHandCard(state, actorId, handSlotId);
  const added = addHandCard(state, reward.targetPlayerId, donated.cardId);
  state.pendingDiscardReward = null;
  state.phase = reward.resumePhase;
  addEvent(
    state,
    "discard_reward",
    `${playerName(state, actorId)} donated a replacement card to ${playerName(state, reward.targetPlayerId)}`,
    actorId,
    undefined,
    {
      targets: [
        { playerId: actorId, slotId: handSlotId },
        { playerId: reward.targetPlayerId, slotId: added.slotId }
      ],
      targetPlayerId: reward.targetPlayerId,
      source: "hand",
      destination: "hand",
      count: 1
    }
  );
  maybeAutoJamio(state, actorId);
}

function playCardToDiscard(state: GameState, playerId: PlayerId, cardId: CardId, source: "drawn" | "hand"): void {
  state.discardPile.push(cardId);
  state.cardsPlayedThisRound += 1;
  if (state.lastPlayed) {
    state.lastPlayed.closed = true;
  }
  const card = getCard(state, cardId);
  const rule = getCardRule(card, state.ruleset);
  state.lastPlayedSeq += 1;
  state.lastPlayed = {
    seq: state.lastPlayedSeq,
    cardId,
    matchGroup: rule.matchGroup,
    playedBy: playerId,
    openedAtVersion: state.version,
    closed: false
  };
  addEvent(state, "play_card", `${playerName(state, playerId)} played ${card.label}`, playerId, cardId, {
    source,
    destination: "discard",
    targetPlayerId: playerId
  });
}

function maybeTriggerPowerOrAdvance(
  state: GameState,
  actorId: PlayerId,
  cardId: CardId,
  source: "drawn" | "hand"
): void {
  const card = getCard(state, cardId);
  const rule = getCardRule(card, state.ruleset);
  const shouldTrigger = source === "drawn" || rule.triggersFromHand;

  if (!shouldTrigger || !rule.power) {
    advanceTurn(state, actorId);
    return;
  }

  if (rule.power.type === "draw") {
    const targets: CardTarget[] = [];
    for (let count = 0; count < rule.power.count; count += 1) {
      const added = addHandCard(state, actorId, drawOne(state));
      targets.push({ playerId: actorId, slotId: added.slotId });
    }
    addEvent(state, "power_draw", `${playerName(state, actorId)} used Draw ${rule.power.count}`, actorId, undefined, {
      targets,
      targetPlayerId: actorId,
      source: "deck",
      destination: "hand",
      count: rule.power.count
    });
    advanceTurn(state, actorId);
    return;
  }

  if (rule.power.type === "emote") {
    addEvent(state, "power_emote", `${playerName(state, actorId)} played ${rule.power.value}`, actorId);
    advanceTurn(state, actorId);
    return;
  }

  state.pendingPower = {
    actorId,
    cardId,
    power: rule.power,
    source
  };
  state.phase = "resolving_power";
  addEvent(state, "power_pending", `${playerName(state, actorId)} used ${powerName(rule.power)}`, actorId);
}

function resolvePower(state: GameState, actorId: PlayerId, choice: PowerChoice): void {
  assertJamio(state.phase === "resolving_power", "No power is pending", "INVALID_PHASE");
  assertJamio(state.pendingPower?.actorId === actorId, "This power is not yours", "NOT_YOUR_POWER");
  const pending = state.pendingPower;
  const power = pending.power;

  if (choice.type === "end_reveal") {
    assertJamio(isViewingLookPower(pending), "No revealed cards are waiting", "INVALID_POWER_CHOICE");
    finishViewedPower(state, actorId, false);
    return;
  }

  if (choice.type === "cancel") {
    state.pendingPower = null;
    advanceTurn(state, actorId);
    return;
  }

  if (isViewingLookPower(pending)) {
    assertJamio(power.type === "look_swap", "End the reveal before resolving another power choice", "INVALID_POWER_CHOICE");
    assertJamio(choice.type === "look_swap", "Look & Swap can only swap or end now", "INVALID_POWER_CHOICE");
    finishViewedPower(state, actorId, choice.swap);
    return;
  }

  switch (power.type) {
    case "swap": {
      assertJamio(choice.type === "swap", "Swap requires two targets", "INVALID_POWER_CHOICE");
      swapTargets(state, choice.targets[0], choice.targets[1]);
      addEvent(state, "swap_cards", `${playerName(state, actorId)} swapped two cards`, actorId, undefined, {
        targets: choice.targets,
        source: "power",
        destination: "hand"
      });
      break;
    }
    case "look_swap": {
      assertJamio(choice.type === "look_swap", "Look & Swap requires two targets", "INVALID_POWER_CHOICE");
      revealTargetsToActor(state, actorId, choice.targets);
      state.pendingPower = {
        ...pending,
        revealedTargets: choice.targets,
        revealedAtVersion: state.version + 1
      };
      addEvent(state, "power_reveal", `${playerName(state, actorId)} is looking at two cards`, actorId, undefined, {
        targets: choice.targets,
        source: "power",
        count: choice.targets.length
      });
      return;
    }
    case "self_look": {
      assertJamio(choice.type === "reveal", "Self Look requires reveal targets", "INVALID_POWER_CHOICE");
      assertTargetCount(choice.targets, power.count);
      assertJamio(choice.targets.every((target) => target.playerId === actorId), "Self Look can only target your cards");
      revealTargetsToActor(state, actorId, choice.targets);
      state.pendingPower = {
        ...pending,
        revealedTargets: choice.targets,
        revealedAtVersion: state.version + 1
      };
      addEvent(state, "power_reveal", `${playerName(state, actorId)} is looking at ${choice.targets.length} card(s)`, actorId, undefined, {
        targets: choice.targets,
        source: "power",
        count: choice.targets.length
      });
      return;
    }
    case "look": {
      assertJamio(choice.type === "reveal", "Look requires reveal targets", "INVALID_POWER_CHOICE");
      assertTargetCount(choice.targets, power.count);
      assertJamio(choice.targets.every((target) => target.playerId !== actorId), "Look can only target opponent cards");
      revealTargetsToActor(state, actorId, choice.targets);
      state.pendingPower = {
        ...pending,
        revealedTargets: choice.targets,
        revealedAtVersion: state.version + 1
      };
      addEvent(state, "power_reveal", `${playerName(state, actorId)} is looking at ${choice.targets.length} card(s)`, actorId, undefined, {
        targets: choice.targets,
        source: "power",
        count: choice.targets.length
      });
      return;
    }
    case "universal_look": {
      assertJamio(choice.type === "reveal", "Universal Look requires reveal targets", "INVALID_POWER_CHOICE");
      assertTargetCount(choice.targets, power.count);
      revealTargetsToActor(state, actorId, choice.targets);
      state.pendingPower = {
        ...pending,
        revealedTargets: choice.targets,
        revealedAtVersion: state.version + 1
      };
      addEvent(state, "power_reveal", `${playerName(state, actorId)} is looking at ${choice.targets.length} card(s)`, actorId, undefined, {
        targets: choice.targets,
        source: "power",
        count: choice.targets.length
      });
      return;
    }
    case "give": {
      assertJamio(choice.type === "give", "Give requires a target player", "INVALID_POWER_CHOICE");
      assertActivePlayer(state, choice.targetPlayerId);
      const targets: CardTarget[] = [];
      for (let count = 0; count < power.count; count += 1) {
        const added = addHandCard(state, choice.targetPlayerId, drawOne(state));
        targets.push({ playerId: choice.targetPlayerId, slotId: added.slotId });
      }
      addEvent(state, "power_give", `${playerName(state, actorId)} gave ${power.count} card(s) to ${playerName(state, choice.targetPlayerId)}`, actorId, undefined, {
        targets,
        targetPlayerId: choice.targetPlayerId,
        source: "deck",
        destination: "hand",
        count: power.count
      });
      break;
    }
    case "donate": {
      assertJamio(choice.type === "donate", "Donate requires own cards and a target player", "INVALID_POWER_CHOICE");
      assertActivePlayer(state, choice.targetPlayerId);
      assertJamio(choice.targetPlayerId !== actorId, "Donate must target another player", "INVALID_POWER_CHOICE");
      assertJamio(choice.handSlotIds.length <= power.count, "Too many cards selected", "INVALID_POWER_CHOICE");
      for (const slotId of choice.handSlotIds) {
        const handCard = removeHandCard(state, actorId, slotId);
        const added = addHandCard(state, choice.targetPlayerId, handCard.cardId);
        addEvent(state, "power_donate", `${playerName(state, actorId)} donated a card to ${playerName(state, choice.targetPlayerId)}`, actorId, undefined, {
          targets: [
            { playerId: actorId, slotId },
            { playerId: choice.targetPlayerId, slotId: added.slotId }
          ],
          targetPlayerId: choice.targetPlayerId,
          source: "hand",
          destination: "hand",
          count: 1
        });
      }
      maybeAutoJamio(state, actorId);
      break;
    }
    case "burn": {
      assertJamio(choice.type === "burn", "Burn requires targets", "INVALID_POWER_CHOICE");
      assertTargetCount(choice.targets, power.count);
      for (const target of choice.targets) {
        const burned = removeHandCard(state, target.playerId, target.slotId);
        state.deck.push(burned.cardId);
      }
      addEvent(state, "burn_cards", `${playerName(state, actorId)} burned ${choice.targets.length} card(s)`, actorId, undefined, {
        targets: choice.targets,
        source: "hand",
        destination: "deck",
        count: choice.targets.length
      });
      break;
    }
    case "draw":
    case "emote":
      break;
    default: {
      const neverPower: never = power;
      throw new JamioError(`Unhandled power ${JSON.stringify(neverPower)}`, "UNHANDLED_POWER");
    }
  }

  addEvent(state, "power_resolved", `${playerName(state, actorId)} finished ${powerName(power)}`, actorId);
  state.pendingPower = null;
  advanceTurn(state, actorId);
}

function isViewingLookPower(pending: NonNullable<GameState["pendingPower"]>): boolean {
  return (
    (pending.power.type === "self_look" || pending.power.type === "look" || pending.power.type === "universal_look" || pending.power.type === "look_swap") &&
    Boolean(pending.revealedTargets?.length)
  );
}

function finishViewedPower(state: GameState, actorId: PlayerId, shouldSwap: boolean): void {
  const pending = state.pendingPower;
  assertJamio(pending, "No power is pending", "INVALID_PHASE");
  const revealedTargets = pending.revealedTargets ?? [];
  assertJamio(revealedTargets.length > 0, "No revealed cards are waiting", "INVALID_POWER_CHOICE");

  if (shouldSwap) {
    assertJamio(pending.power.type === "look_swap", "Only Look & Swap can swap revealed cards", "INVALID_POWER_CHOICE");
    assertJamio(revealedTargets.length === 2, "Look & Swap requires two revealed targets", "INVALID_POWER_CHOICE");
    swapTargets(state, revealedTargets[0]!, revealedTargets[1]!);
    addEvent(state, "swap_cards", `${playerName(state, actorId)} swapped two cards`, actorId, undefined, {
      targets: revealedTargets,
      source: "power",
      destination: "hand"
    });
  }

  hideTargetsFromActor(state, actorId, revealedTargets);
  addEvent(state, "power_resolved", `${playerName(state, actorId)} finished ${powerName(pending.power)}`, actorId);
  state.pendingPower = null;
  advanceTurn(state, actorId);
}

function assertTargetCount(targets: CardTarget[], maxCount: number): void {
  assertJamio(targets.length > 0, "At least one target is required", "INVALID_POWER_CHOICE");
  assertJamio(targets.length <= maxCount, "Too many targets selected", "INVALID_POWER_CHOICE");
}

function revealTargetsToActor(state: GameState, actorId: PlayerId, targets: CardTarget[]): void {
  for (const target of targets) {
    const handCard = findOccupiedHandCard(state, target.playerId, target.slotId).handCard;
    if (!handCard.visibleTo.includes(actorId)) {
      handCard.visibleTo.push(actorId);
    }
  }
}

function hideTargetsFromActor(state: GameState, actorId: PlayerId, targets: CardTarget[]): void {
  for (const target of targets) {
    const handCard = maybeFindHandCard(state, target.playerId, target.slotId)?.handCard;
    if (!handCard) {
      continue;
    }
    handCard.visibleTo = handCard.visibleTo.filter((playerId) => playerId !== actorId);
  }
}

function swapTargets(state: GameState, first: CardTarget, second: CardTarget): void {
  const firstCard = findOccupiedHandCard(state, first.playerId, first.slotId).handCard;
  const secondCard = findOccupiedHandCard(state, second.playerId, second.slotId).handCard;
  const firstCardId = firstCard.cardId;
  firstCard.cardId = secondCard.cardId;
  secondCard.cardId = firstCardId;
  firstCard.visibleTo = [];
  secondCard.visibleTo = [];
}

function drawMistakePenalty(state: GameState, playerId: PlayerId): void {
  if (state.ruleset.general.drawCardOnMistake) {
    const added = addHandCard(state, playerId, drawOne(state));
    addEvent(state, "penalty_draw", `${playerName(state, playerId)} drew a penalty card`, playerId, undefined, {
      target: { playerId, slotId: added.slotId },
      targetPlayerId: playerId,
      source: "deck",
      destination: "hand",
      count: 1
    });
  }
}

function drawOne(state: GameState): CardId {
  if (state.deck.length === 0) {
    recycleDiscardPile(state);
  }
  const cardId = state.deck.shift();
  assertJamio(cardId, "No cards are available to draw", "DECK_EXHAUSTED");
  return cardId;
}

function recycleDiscardPile(state: GameState): void {
  const topCard = state.discardPile.at(-1);
  const rest = state.discardPile.slice(0, -1);
  assertJamio(rest.length > 0, "Deck and played stack are exhausted", "DECK_EXHAUSTED");
  state.discardPile = topCard ? [topCard] : [];
  state.deck = shuffle(rest, `${state.randomSeed}:reshuffle:${state.version}:${state.cardsPlayedThisRound}`);
  addEvent(state, "deck_recycled", "The played stack was shuffled into the deck");
}

function replaceHandCard(state: GameState, playerId: PlayerId, slotId: HandSlotId, newCardId: CardId): OccupiedHandCard {
  const target = findOccupiedHandCard(state, playerId, slotId);
  const replaced = { ...target.handCard };
  target.handCard.cardId = newCardId;
  target.handCard.visibleTo = [];
  return replaced;
}

function removeHandCard(state: GameState, playerId: PlayerId, slotId: HandSlotId): OccupiedHandCard {
  const target = findOccupiedHandCard(state, playerId, slotId);
  const removed = { ...target.handCard };
  target.hand[target.index]!.cardId = null;
  target.hand[target.index]!.visibleTo = [];
  return removed;
}

function addHandCard(state: GameState, playerId: PlayerId, cardId: CardId): HandCard {
  const hand = state.hands[playerId];
  assertJamio(hand, "Player hand does not exist", "UNKNOWN_PLAYER");
  const emptySlot = hand.find((candidate) => candidate.cardId === null);
  if (emptySlot) {
    emptySlot.cardId = cardId;
    emptySlot.visibleTo = [];
    return emptySlot;
  }
  const handCard = {
    slotId: makeSlotId(playerId, state.roundNumber, nextSlotIndex(hand)),
    cardId,
    visibleTo: []
  };
  hand.push(handCard);
  return handCard;
}

function findHandCard(
  state: GameState,
  playerId: PlayerId,
  slotId: HandSlotId
): { hand: HandCard[]; handCard: HandCard; index: number } {
  const hand = state.hands[playerId];
  assertJamio(hand, "Player hand does not exist", "UNKNOWN_PLAYER");
  const index = hand.findIndex((candidate) => candidate.slotId === slotId);
  assertJamio(index >= 0, "Card slot does not exist", "CARD_NOT_FOUND");
  const handCard = hand[index];
  assertJamio(handCard, "Card slot does not exist", "CARD_NOT_FOUND");
  return { hand, handCard, index };
}

function findOccupiedHandCard(
  state: GameState,
  playerId: PlayerId,
  slotId: HandSlotId
): { hand: HandCard[]; handCard: OccupiedHandCard; index: number } {
  const target = findHandCard(state, playerId, slotId);
  assertJamio(target.handCard.cardId, "Card slot is empty", "CARD_NOT_FOUND");
  return {
    hand: target.hand,
    handCard: target.handCard as OccupiedHandCard,
    index: target.index
  };
}

function maybeFindHandCard(
  state: GameState,
  playerId: PlayerId,
  slotId: HandSlotId
): { hand: HandCard[]; handCard: HandCard; index: number } | null {
  const hand = state.hands[playerId];
  if (!hand) {
    return null;
  }
  const index = hand.findIndex((candidate) => candidate.slotId === slotId);
  if (index < 0) {
    return null;
  }
  const handCard = hand[index];
  return handCard ? { hand, handCard, index } : null;
}

function occupiedHandCards(state: GameState, playerId: PlayerId): OccupiedHandCard[] {
  return (state.hands[playerId] ?? []).filter((handCard): handCard is OccupiedHandCard => Boolean(handCard.cardId));
}

function nextSlotIndex(hand: HandCard[]): number {
  const highest = hand.reduce((max, handCard) => Math.max(max, slotIndexFromId(handCard.slotId)), -1);
  return highest + 1;
}

function slotIndexFromId(slotId: HandSlotId): number {
  const match = /-s(\d+)$/.exec(slotId);
  return match ? Number(match[1]) : 0;
}

function advanceTurn(state: GameState, completedPlayerId: PlayerId): void {
  if (state.jamio) {
    state.jamio.remainingPlayerIds = state.jamio.remainingPlayerIds.filter((id) => id !== completedPlayerId);
    if (state.jamio.remainingPlayerIds.length === 0) {
      revealAndScoreRound(state);
      return;
    }
    state.currentTurnPlayerId = state.jamio.remainingPlayerIds[0]!;
    state.phase = "jamio_final_cycle";
    return;
  }

  const active = activePlayers(state);
  const currentIndex = active.findIndex((player) => player.id === completedPlayerId);
  const nextIndex = wrapIndex(currentIndex + state.direction, active.length);
  state.currentTurnPlayerId = active[nextIndex]!.id;
  state.phase = "turn_idle";
}

function beginJamio(state: GameState, callerId: PlayerId): void {
  const remainingPlayerIds = turnOrderAfter(state, callerId);
  state.jamio = { callerId, remainingPlayerIds };
  addEvent(state, "jamio_called", `${playerName(state, callerId)} called Jamio`, callerId);
  if (remainingPlayerIds.length === 0) {
    revealAndScoreRound(state);
    return;
  }
  state.currentTurnPlayerId = remainingPlayerIds[0]!;
  state.phase = "jamio_final_cycle";
}

function maybeAutoJamio(state: GameState, playerId: PlayerId): void {
  if (!state.ruleset.general.automaticJamioOnZeroCards || state.jamio) {
    return;
  }
  if (occupiedHandCards(state, playerId).length === 0) {
    beginJamio(state, playerId);
  }
}

function revealAndScoreRound(state: GameState): void {
  const { roundScores, roundWinnerId } = scoreRound(state);
  state.roundScores = roundScores;
  for (const [playerId, roundScore] of Object.entries(roundScores)) {
    state.scores[playerId] = (state.scores[playerId] ?? 0) + roundScore;
  }
  state.roundWinnerId = roundWinnerId;
  state.nextRoundPenaltyCards = {};
  const jamioCallerId = state.jamio?.callerId;
  const penaltyCards = state.ruleset.general.badCallPenaltyCards;
  if (jamioCallerId && jamioCallerId !== roundWinnerId && penaltyCards > 0) {
    state.nextRoundPenaltyCards[jamioCallerId] = penaltyCards;
    addEvent(
      state,
      "bad_jamio_penalty",
      `${playerName(state, jamioCallerId)} takes ${penaltyCards} extra card${penaltyCards === 1 ? "" : "s"} next round`,
      jamioCallerId
    );
  }
  state.currentTurnPlayerId = null;
  state.phase = Object.values(state.scores).some((score) => score >= state.ruleset.general.scoreLimit)
    ? "game_over"
    : "round_reveal";
  if (state.phase === "game_over") {
    state.gameWinnerId = getLowestScorePlayerId(state.scores);
  }
  addEvent(state, "round_scored", `${playerName(state, roundWinnerId)} wins the round`, roundWinnerId);
}

function turnOrderAfter(state: GameState, playerId: PlayerId): PlayerId[] {
  const active = activePlayers(state);
  const startIndex = active.findIndex((player) => player.id === playerId);
  assertJamio(startIndex >= 0, "Jamio caller is not active", "UNKNOWN_PLAYER");
  const order: PlayerId[] = [];
  for (let step = 1; step < active.length; step += 1) {
    order.push(active[wrapIndex(startIndex + step * state.direction, active.length)]!.id);
  }
  return order;
}

function activePlayers(state: GameState): Array<{ id: PlayerId; name: string }> {
  return state.players.filter((player) => player.active);
}

function wrapIndex(index: number, length: number): number {
  return ((index % length) + length) % length;
}

function getCard(state: GameState, cardId: CardId): Card {
  const card = state.cardsById[cardId];
  assertJamio(card, `Unknown card ${cardId}`, "UNKNOWN_CARD");
  return card;
}

function assertActivePlayer(state: GameState, playerId: PlayerId): void {
  assertJamio(
    state.players.some((player) => player.id === playerId && player.active),
    "Target player is not active",
    "UNKNOWN_PLAYER"
  );
}

function getLowestScorePlayerId(scores: Record<PlayerId, number>): PlayerId {
  const entries = Object.entries(scores);
  assertJamio(entries.length > 0, "No scores are available", "NO_SCORES");
  return entries.reduce((best, entry) => (entry[1] < best[1] ? entry : best))[0];
}

function playerName(state: GameState, playerId: PlayerId): string {
  return state.players.find((player) => player.id === playerId)?.name ?? playerId;
}

function powerName(power: CardPower): string {
  switch (power.type) {
    case "self_look":
      return "Self Look";
    case "look_swap":
      return "Look & Swap";
    case "universal_look":
      return "Universal Look";
    case "look":
      return "Look";
    case "swap":
      return "Swap";
    case "give":
      return "Give";
    case "donate":
      return "Donate";
    case "burn":
      return "Burn";
    case "draw":
      return `Draw ${power.count}`;
    case "emote":
      return power.value;
  }
}

function addEvent(
  state: GameState,
  type: string,
  message: string,
  actorId?: PlayerId,
  publicCardId?: CardId,
  details: GameEventDetails = {}
): GameEvent {
  const event: GameEvent = {
    id: `e${state.version}-${state.eventLog.length}`,
    type,
    message
  };
  if (actorId) {
    event.actorId = actorId;
  }
  if (publicCardId) {
    event.publicCardId = publicCardId;
  }
  if (details.target) {
    event.target = details.target;
  }
  if (details.targets) {
    event.targets = details.targets;
  }
  if (details.targetPlayerId) {
    event.targetPlayerId = details.targetPlayerId;
  }
  if (details.source) {
    event.source = details.source;
  }
  if (details.destination) {
    event.destination = details.destination;
  }
  if (details.count !== undefined) {
    event.count = details.count;
  }
  state.eventLog.push(event);
  return event;
}
