import type { PublicCard } from "@jamio/game-core";

type CardProps = {
  card: PublicCard | null;
};

export function Card({ card }: CardProps) {
  const suitClass = card?.suit === "H" || card?.suit === "D" ? "is-red" : "is-black";

  if (!card) {
    return (
      <div className="playing-card card-back" aria-label="Hidden card">
        <span>J</span>
      </div>
    );
  }

  return (
    <div className={`playing-card card-face ${suitClass}`} aria-label={card.label}>
      <span className="card-rank">{card.rank === "JOKER" ? "JK" : card.rank}</span>
      <span className="card-suit">{suitSymbol(card.suit)}</span>
      <small>{card.points}</small>
    </div>
  );
}

function suitSymbol(suit: PublicCard["suit"]): string {
  switch (suit) {
    case "S":
      return "♠";
    case "C":
      return "♣";
    case "H":
      return "♥";
    case "D":
      return "♦";
    default:
      return "★";
  }
}
