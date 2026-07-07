import { describe, expect, it } from "vitest";
import {
  applyAction,
  createInitialRound,
  getPlayerView,
  jamioDefaultRuleset,
  scoreRound,
  type CardId,
  type GameState,
  type HandSlotId,
  type PlayerId,
  type Ruleset
} from "../src";

const players = [
  { id: "p1", name: "John" },
  { id: "p2", name: "Guest" }
];

function cloneRuleset(): Ruleset {
  return JSON.parse(JSON.stringify(jamioDefaultRuleset)) as Ruleset;
}

function makeState(seed = "seed", ruleset = cloneRuleset()): GameState {
  return createInitialRound(players, ruleset, seed, { roomId: "ROOM1", hostPlayerId: "p1" });
}

function slot(state: GameState, playerId: PlayerId, index = 0): HandSlotId {
  return state.hands[playerId]![index]!.slotId;
}

function putCardOnDeckTop(state: GameState, cardId: CardId): void {
  const replacement = state.deck.find((candidate) => candidate !== cardId) ?? state.discardPile.find((candidate) => candidate !== cardId);
  for (const hand of Object.values(state.hands)) {
    for (const handCard of hand) {
      if (handCard.cardId === cardId) {
        handCard.cardId = replacement ?? handCard.cardId;
      }
    }
  }
  state.discardPile = state.discardPile.filter((candidate) => candidate !== cardId);
  state.deck = [cardId, ...state.deck.filter((candidate) => candidate !== cardId)];
}

function putCardInSlot(state: GameState, playerId: PlayerId, slotId: HandSlotId, cardId: CardId): void {
  const handCard = state.hands[playerId]!.find((candidate) => candidate.slotId === slotId)!;
  const oldCardId = handCard.cardId;
  for (const hand of Object.values(state.hands)) {
    for (const candidate of hand) {
      if (candidate !== handCard && candidate.cardId === cardId) {
        candidate.cardId = oldCardId;
      }
    }
  }
  const deckIndex = state.deck.indexOf(cardId);
  if (deckIndex >= 0) {
    state.deck[deckIndex] = oldCardId;
  }
  const discardIndex = state.discardPile.indexOf(cardId);
  if (discardIndex >= 0) {
    state.discardPile[discardIndex] = oldCardId;
  }
  handCard.cardId = cardId;
  handCard.visibleTo = [];
}

function openDiscardWindow(state: GameState, cardId: CardId, matchGroup: string): void {
  state.deck = state.deck.filter((candidate) => candidate !== cardId);
  state.discardPile.push(cardId);
  state.lastPlayedSeq += 1;
  state.lastPlayed = {
    seq: state.lastPlayedSeq,
    cardId,
    matchGroup,
    playedBy: "p2",
    openedAtVersion: state.version,
    closed: false
  };
}

function playNoPowerCard(state: GameState, playerId: PlayerId): GameState {
  putCardOnDeckTop(state, "AS");
  const drawn = applyAction(state, playerId, { type: "draw_from_deck" }).state;
  return applyAction(drawn, playerId, { type: "play_drawn_card" }).state;
}

describe("Jamio game engine", () => {
  it("deals unique cards", () => {
    const state = makeState();
    const dealt = Object.values(state.hands)
      .flat()
      .map((card) => card.cardId);
    expect(new Set(dealt).size).toBe(dealt.length);
  });

  it("cannot start if players times starting hand exceeds deck size", () => {
    const ruleset = cloneRuleset();
    ruleset.general.startingHandSize = 8;
    const tooManyPlayers = Array.from({ length: 10 }, (_, index) => ({
      id: `p${index}`,
      name: `Player ${index}`
    }));

    expect(() => createInitialRound(tooManyPlayers, ruleset, "seed")).toThrow(/Cannot deal/);
  });

  it("drawn card can be played", () => {
    let state = makeState();
    state.currentTurnPlayerId = "p1";
    putCardOnDeckTop(state, "AS");

    state = applyAction(state, "p1", { type: "draw_from_deck" }).state;
    state = applyAction(state, "p1", { type: "play_drawn_card" }).state;

    expect(state.discardPile.at(-1)).toBe("AS");
    expect(state.phase).toBe("turn_idle");
  });

  it("drawn card can replace a hand card", () => {
    let state = makeState();
    state.currentTurnPlayerId = "p1";
    const targetSlot = slot(state, "p1");
    const replacedCard = state.hands.p1![0]!.cardId;
    putCardOnDeckTop(state, "AS");

    state = applyAction(state, "p1", { type: "draw_from_deck" }).state;
    state = applyAction(state, "p1", { type: "replace_with_drawn_card", handSlotId: targetSlot }).state;

    expect(state.hands.p1!.find((card) => card.slotId === targetSlot)?.cardId).toBe("AS");
    expect(state.discardPile.at(-1)).toBe(replacedCard);
  });

  it("taking played-stack card replaces a hand card", () => {
    let state = makeState();
    state.currentTurnPlayerId = "p1";
    const targetSlot = slot(state, "p1");
    const oldCard = state.hands.p1![0]!.cardId;
    state.deck = state.deck.filter((card) => card !== "KH");
    state.discardPile.push("KH");

    state = applyAction(state, "p1", { type: "take_discard_and_replace", handSlotId: targetSlot }).state;

    expect(state.hands.p1!.find((card) => card.slotId === targetSlot)?.cardId).toBe("KH");
    expect(state.discardPile.at(-1)).toBe(oldCard);
  });

  it("drawn card power always triggers", () => {
    let state = makeState();
    state.currentTurnPlayerId = "p1";
    putCardOnDeckTop(state, "6S");

    state = applyAction(state, "p1", { type: "draw_from_deck" }).state;
    state = applyAction(state, "p1", { type: "play_drawn_card" }).state;

    expect(state.phase).toBe("resolving_power");
    expect(state.pendingPower?.power.type).toBe("self_look");
  });

  it("hand card power triggers only if triggersFromHand is true", () => {
    let state = makeState("trigger-true");
    state.currentTurnPlayerId = "p1";
    const targetSlot = slot(state, "p1");
    putCardInSlot(state, "p1", targetSlot, "2S");
    putCardOnDeckTop(state, "AS");

    state = applyAction(state, "p1", { type: "draw_from_deck" }).state;
    state = applyAction(state, "p1", { type: "replace_with_drawn_card", handSlotId: targetSlot }).state;

    expect(state.phase).toBe("resolving_power");
    expect(state.pendingPower?.power.type).toBe("give");

    let noTriggerState = makeState("trigger-false");
    noTriggerState.currentTurnPlayerId = "p1";
    const noTriggerSlot = slot(noTriggerState, "p1");
    putCardInSlot(noTriggerState, "p1", noTriggerSlot, "6S");
    putCardOnDeckTop(noTriggerState, "AS");

    noTriggerState = applyAction(noTriggerState, "p1", { type: "draw_from_deck" }).state;
    noTriggerState = applyAction(noTriggerState, "p1", {
      type: "replace_with_drawn_card",
      handSlotId: noTriggerSlot
    }).state;

    expect(noTriggerState.phase).toBe("turn_idle");
    expect(noTriggerState.pendingPower).toBeNull();
  });

  it("correct own discard removes card", () => {
    let state = makeState();
    putCardInSlot(state, "p1", slot(state, "p1"), "AS");
    openDiscardWindow(state, "AH", "A");
    const startingCount = state.hands.p1!.length;

    state = applyAction(state, "p1", {
      type: "attempt_discard",
      targetPlayerId: "p1",
      handSlotId: slot(state, "p1"),
      lastPlayedSeq: state.lastPlayedSeq
    }).state;

    expect(state.hands.p1).toHaveLength(startingCount - 1);
  });

  it("incorrect own discard adds penalty card when enabled", () => {
    let state = makeState();
    putCardInSlot(state, "p1", slot(state, "p1"), "2S");
    openDiscardWindow(state, "AH", "A");
    const startingCount = state.hands.p1!.length;

    state = applyAction(state, "p1", {
      type: "attempt_discard",
      targetPlayerId: "p1",
      handSlotId: slot(state, "p1"),
      lastPlayedSeq: state.lastPlayedSeq
    }).state;

    expect(state.hands.p1).toHaveLength(startingCount + 1);
  });

  it("correct opponent discard requires donation", () => {
    let state = makeState();
    putCardInSlot(state, "p2", slot(state, "p2"), "AS");
    openDiscardWindow(state, "AH", "A");
    const actorDonateSlot = slot(state, "p1");

    state = applyAction(state, "p1", {
      type: "attempt_discard",
      targetPlayerId: "p2",
      handSlotId: slot(state, "p2"),
      lastPlayedSeq: state.lastPlayedSeq
    }).state;

    expect(state.phase).toBe("discard_reward");
    expect(state.pendingDiscardReward?.targetPlayerId).toBe("p2");

    state = applyAction(state, "p1", {
      type: "resolve_discard_reward",
      handSlotIdToDonate: actorDonateSlot
    }).state;

    expect(state.phase).toBe("turn_idle");
    expect(state.hands.p2).toHaveLength(4);
  });

  it("incorrect opponent discard adds penalty card when enabled", () => {
    let state = makeState();
    putCardInSlot(state, "p2", slot(state, "p2"), "2S");
    openDiscardWindow(state, "AH", "A");
    const startingCount = state.hands.p1!.length;

    state = applyAction(state, "p1", {
      type: "attempt_discard",
      targetPlayerId: "p2",
      handSlotId: slot(state, "p2"),
      lastPlayedSeq: state.lastPlayedSeq
    }).state;

    expect(state.hands.p1).toHaveLength(startingCount + 1);
  });

  it("discard window closes when next card is played and stale discard is rejected", () => {
    let state = makeState("window");
    state.currentTurnPlayerId = "p1";
    putCardOnDeckTop(state, "AS");
    state = applyAction(state, "p1", { type: "draw_from_deck" }).state;
    state = applyAction(state, "p1", { type: "play_drawn_card" }).state;
    const staleSeq = state.lastPlayedSeq;

    putCardOnDeckTop(state, "AH");
    state = applyAction(state, "p2", { type: "draw_from_deck" }).state;
    expect(state.lastPlayed?.closed).toBe(false);
    state = applyAction(state, "p2", { type: "play_drawn_card" }).state;

    expect(state.lastPlayedSeq).toBe(staleSeq + 1);
    expect(() =>
      applyAction(state, "p1", {
        type: "attempt_discard",
        targetPlayerId: "p1",
        handSlotId: slot(state, "p1"),
        lastPlayedSeq: staleSeq
      })
    ).toThrow(/stale/i);
  });

  it("Jamio gives every other player one more turn", () => {
    const ruleset = cloneRuleset();
    ruleset.general.minCardsPlayedBeforeJamio = 0;
    let state = makeState("jamio", ruleset);
    state.currentTurnPlayerId = "p1";

    state = applyAction(state, "p1", { type: "call_jamio" }).state;
    expect(state.currentTurnPlayerId).toBe("p2");
    expect(state.jamio?.callerId).toBe("p1");

    putCardOnDeckTop(state, "AS");
    state = applyAction(state, "p2", { type: "draw_from_deck" }).state;
    state = applyAction(state, "p2", { type: "play_drawn_card" }).state;

    expect(["round_reveal", "game_over"]).toContain(state.phase);
    expect(state.roundWinnerId).toBeTruthy();
  });

  it("round scoring uses custom values", () => {
    const ruleset = cloneRuleset();
    ruleset.cardRules.A!.points = -5;
    const state = makeState("score", ruleset);
    putCardInSlot(state, "p1", slot(state, "p1", 0), "AS");
    putCardInSlot(state, "p1", slot(state, "p1", 1), "AH");
    putCardInSlot(state, "p1", slot(state, "p1", 2), "AC");
    putCardInSlot(state, "p1", slot(state, "p1", 3), "AD");

    const scored = scoreRound(state);

    expect(scored.roundScores.p1).toBe(-20);
  });

  it("game ends when score limit is reached", () => {
    const ruleset = cloneRuleset();
    ruleset.general.minCardsPlayedBeforeJamio = 0;
    ruleset.general.scoreLimit = 1;
    let state = makeState("game-over", ruleset);
    state.currentTurnPlayerId = "p1";

    state = applyAction(state, "p1", { type: "call_jamio" }).state;
    state = playNoPowerCard(state, "p2");

    expect(state.phase).toBe("game_over");
    expect(state.gameWinnerId).toBeTruthy();
  });

  it("applies bad Jamio penalty cards on the next round", () => {
    const ruleset = cloneRuleset();
    ruleset.general.minCardsPlayedBeforeJamio = 0;
    ruleset.general.badCallPenaltyCards = 2;
    let state = makeState("bad-call", ruleset);
    state.currentTurnPlayerId = "p1";
    putCardInSlot(state, "p1", slot(state, "p1", 0), "KS");
    putCardInSlot(state, "p1", slot(state, "p1", 1), "KC");
    putCardInSlot(state, "p1", slot(state, "p1", 2), "10S");
    putCardInSlot(state, "p1", slot(state, "p1", 3), "10C");
    putCardInSlot(state, "p2", slot(state, "p2", 0), "AS");
    putCardInSlot(state, "p2", slot(state, "p2", 1), "AH");
    putCardInSlot(state, "p2", slot(state, "p2", 2), "AC");
    putCardInSlot(state, "p2", slot(state, "p2", 3), "AD");

    state = applyAction(state, "p1", { type: "call_jamio" }).state;
    putCardOnDeckTop(state, "5S");
    state = applyAction(state, "p2", { type: "draw_from_deck" }).state;
    state = applyAction(state, "p2", { type: "play_drawn_card" }).state;

    expect(state.roundWinnerId).toBe("p2");
    expect(state.nextRoundPenaltyCards.p1).toBe(2);

    state = applyAction(state, "p1", { type: "start_next_round", randomSeed: "penalty-round" }).state;

    expect(state.hands.p1).toHaveLength(ruleset.general.startingHandSize + 2);
    expect(state.hands.p2).toHaveLength(ruleset.general.startingHandSize);
  });

  it("hidden cards are not leaked in PlayerView", () => {
    const state = makeState("visibility");
    const p1View = getPlayerView(state, "p1");

    expect(p1View.yourHand.every((card) => card.card === null)).toBe(true);
    expect(p1View.opponentHands.every((hand) => hand.cards.every((card) => card.card === null))).toBe(true);

    state.phase = "initial_memorize";
    const memorizeView = getPlayerView(state, "p1");
    expect(memorizeView.yourHand[0]!.card).not.toBeNull();
    expect(memorizeView.yourHand[1]!.card).not.toBeNull();
    expect(memorizeView.opponentHands[0]!.cards.every((card) => card.card === null)).toBe(true);
  });
});
