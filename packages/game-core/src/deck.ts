import { createCard, ranks, suits } from "./cards";
import type { Card, DeckMode } from "./types";

export function createDeck(deckMode: DeckMode): Card[] {
  const standard = ranks.flatMap((rank) => suits.map((suit) => createCard(rank, suit)));
  if (deckMode === "withJokers54") {
    return [...standard, createCard("JOKER", null, 1), createCard("JOKER", null, 2)];
  }
  return standard;
}

export function getDeckSize(deckMode: DeckMode): number {
  return deckMode === "withJokers54" ? 54 : 52;
}
