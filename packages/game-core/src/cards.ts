import type { Card, CardId, Rank, Suit } from "./types";

export const suits: Suit[] = ["S", "C", "H", "D"];
export const ranks: Exclude<Rank, "JOKER">[] = [
  "A",
  "2",
  "3",
  "4",
  "5",
  "6",
  "7",
  "8",
  "9",
  "10",
  "J",
  "Q",
  "K"
];

const suitLabels: Record<Suit, string> = {
  S: "Spades",
  C: "Clubs",
  H: "Hearts",
  D: "Diamonds"
};

const rankLabels: Record<Rank, string> = {
  A: "Ace",
  "2": "2",
  "3": "3",
  "4": "4",
  "5": "5",
  "6": "6",
  "7": "7",
  "8": "8",
  "9": "9",
  "10": "10",
  J: "Jack",
  Q: "Queen",
  K: "King",
  JOKER: "Joker"
};

export function createCard(rank: Rank, suit: Suit | null, jokerIndex?: number): Card {
  if (rank === "JOKER") {
    const id = `JOKER${jokerIndex ?? 1}`;
    return {
      id,
      rank,
      suit: null,
      label: jokerIndex ? `Joker ${jokerIndex}` : "Joker",
      matchGroup: "JOKER",
      ruleKey: "JOKER"
    };
  }

  const id = `${rank}${suit}`;
  const suitLabel = suit ? suitLabels[suit] : "";
  return {
    id,
    rank,
    suit,
    label: `${rankLabels[rank]} of ${suitLabel}`,
    matchGroup: rank,
    ruleKey: rank === "K" && suit ? id : rank
  };
}

export function toPublicCard(card: Card, points: number): {
  id: CardId;
  rank: Rank;
  suit: Suit | null;
  label: string;
  matchGroup: string;
  points: number;
} {
  return {
    id: card.id,
    rank: card.rank,
    suit: card.suit,
    label: card.label,
    matchGroup: card.matchGroup,
    points
  };
}
