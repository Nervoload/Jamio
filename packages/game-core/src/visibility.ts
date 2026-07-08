import { getLegalActions, publicCardFor } from "./engine";
import type { GameState, PlayerId, PlayerPrompt, PlayerView, PublicCard } from "./types";

export function getPlayerView(state: GameState, playerId: PlayerId): PlayerView {
  const ownHand = state.hands[playerId] ?? [];
  const shouldRevealAll = state.phase === "round_reveal" || state.phase === "game_over";

  return {
    roomId: state.roomId,
    phase: state.phase,
    version: state.version,
    you: playerId,
    hostPlayerId: state.hostPlayerId,
    players: state.players.map((player) => ({
      ...player,
      cardCount: (state.hands[player.id] ?? []).filter((handCard) => handCard.cardId).length
    })),
    yourHand: ownHand.map((handCard, index) => ({
      slotId: handCard.slotId,
      empty: !handCard.cardId,
      card:
        handCard.cardId &&
        (shouldRevealAll || handCard.visibleTo.includes(playerId) || (state.phase === "initial_memorize" && index < 2))
          ? publicCardFor(state, handCard.cardId)
          : null
    })),
    opponentHands: state.players
      .filter((player) => player.id !== playerId)
      .map((player) => ({
        playerId: player.id,
        cards: (state.hands[player.id] ?? []).map((handCard) => ({
          slotId: handCard.slotId,
          empty: !handCard.cardId,
          card:
            handCard.cardId && (shouldRevealAll || handCard.visibleTo.includes(playerId))
              ? publicCardFor(state, handCard.cardId)
              : null
        }))
      })),
    deckCount: state.deck.length,
    discardTop: getDiscardTop(state),
    discardCount: state.discardPile.length,
    currentTurnPlayerId: state.currentTurnPlayerId,
    legalActions: getLegalActions(state, playerId),
    pendingPrompt: getPrompt(state, playerId),
    scores: state.scores,
    roundScores: state.roundScores,
    roundNumber: state.roundNumber,
    lastPlayedSeq: state.lastPlayed && !state.lastPlayed.closed ? state.lastPlayed.seq : null,
    jamioCallerId: state.jamio?.callerId ?? null,
    eventLog: state.eventLog.slice(-12),
    roundWinnerId: state.roundWinnerId,
    gameWinnerId: state.gameWinnerId
  };
}

function getDiscardTop(state: GameState): PublicCard | null {
  const cardId = state.discardPile.at(-1);
  return cardId ? publicCardFor(state, cardId) : null;
}

function getPrompt(state: GameState, playerId: PlayerId): PlayerPrompt {
  if (state.phase === "drawn_card_decision" && state.drawnCard?.drawnBy === playerId) {
    return {
      type: "drawn_card_decision",
      card: publicCardFor(state, state.drawnCard.cardId)
    };
  }
  if (state.phase === "resolving_power" && state.pendingPower?.actorId === playerId) {
    const prompt: PlayerPrompt = {
      type: "resolve_power",
      power: state.pendingPower.power
    };
    if (state.pendingPower.revealedTargets) {
      prompt.revealedTargets = state.pendingPower.revealedTargets;
    }
    if (state.pendingPower.revealedAtVersion !== undefined) {
      prompt.revealedAtVersion = state.pendingPower.revealedAtVersion;
    }
    return prompt;
  }
  if (state.phase === "discard_reward" && state.pendingDiscardReward?.actorId === playerId) {
    return {
      type: "discard_reward",
      targetPlayerId: state.pendingDiscardReward.targetPlayerId
    };
  }
  return null;
}
