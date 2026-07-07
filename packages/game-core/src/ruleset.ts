import { getDeckSize } from "./deck";
import { assertJamio } from "./errors";
import type { Card, CardRule, Ruleset } from "./types";

export function getRuleKeyForCard(card: Card, ruleset: Ruleset): string {
  if (ruleset.cardRules[card.id]) {
    return card.id;
  }
  if (ruleset.cardRules[card.ruleKey]) {
    return card.ruleKey;
  }
  return card.rank;
}

export function getCardRule(card: Card, ruleset: Ruleset): CardRule {
  const ruleKey = getRuleKeyForCard(card, ruleset);
  const rule = ruleset.cardRules[ruleKey];
  assertJamio(rule, `Missing card rule for ${card.id}`, "MISSING_CARD_RULE");
  return rule;
}

export function validateRulesetForPlayers(ruleset: Ruleset, maxPlayers: number): void {
  assertJamio(maxPlayers > 0 && maxPlayers <= 10, "maxPlayers must be between 1 and 10", "INVALID_MAX_PLAYERS");
  assertJamio(
    Number.isInteger(ruleset.general.startingHandSize) &&
      ruleset.general.startingHandSize >= 1 &&
      ruleset.general.startingHandSize <= 8,
    "startingHandSize must be an integer between 1 and 8",
    "INVALID_STARTING_HAND_SIZE"
  );
  assertJamio(ruleset.general.scoreLimit > 0, "scoreLimit must be positive", "INVALID_SCORE_LIMIT");
  assertJamio(
    ruleset.general.minCardsPlayedBeforeJamio >= 0,
    "minCardsPlayedBeforeJamio must be non-negative",
    "INVALID_JAMIO_MINIMUM"
  );
  assertJamio(
    Number.isInteger(ruleset.general.badCallPenaltyCards) &&
      ruleset.general.badCallPenaltyCards >= 0 &&
      ruleset.general.badCallPenaltyCards <= 8,
    "badCallPenaltyCards must be an integer between 0 and 8",
    "INVALID_BAD_CALL_PENALTY"
  );

  const requiredCards = maxPlayers * ruleset.general.startingHandSize;
  const deckSize = getDeckSize(ruleset.general.deckMode);
  assertJamio(
    requiredCards <= deckSize,
    `Cannot deal ${requiredCards} cards from a ${deckSize}-card deck`,
    "IMPOSSIBLE_DEAL"
  );
}
