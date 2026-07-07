import type { CardRule, Ruleset } from "./types";

const noPower = (label: string, matchGroup: string, points: number): CardRule => ({
  label,
  matchGroup,
  points,
  power: null,
  triggersFromHand: false
});

export const jamioDefaultRuleset: Ruleset = {
  name: "Jamio Default",
  general: {
    canDiscardOnOwnTurn: true,
    startingHandSize: 4,
    automaticJamioOnZeroCards: true,
    drawCardOnMistake: true,
    scoreLimit: 100,
    minCardsPlayedBeforeJamio: 10,
    badCallPenaltyCards: 1,
    deckMode: "standard52"
  },
  cardRules: {
    A: noPower("Ace", "A", 1),
    "2": {
      label: "2",
      matchGroup: "2",
      points: 2,
      power: { type: "give", count: 1 },
      triggersFromHand: true
    },
    "3": {
      label: "3",
      matchGroup: "3",
      points: 3,
      power: { type: "universal_look", count: 3 },
      triggersFromHand: false
    },
    "4": {
      label: "4",
      matchGroup: "4",
      points: 4,
      power: { type: "donate", count: 1 },
      triggersFromHand: true
    },
    "5": {
      label: "5",
      matchGroup: "5",
      points: 5,
      power: { type: "emote", value: "❤️" },
      triggersFromHand: false
    },
    "6": {
      label: "6",
      matchGroup: "6",
      points: 6,
      power: { type: "self_look", count: 1 },
      triggersFromHand: false
    },
    "7": {
      label: "7",
      matchGroup: "7",
      points: 7,
      power: { type: "self_look", count: 1 },
      triggersFromHand: false
    },
    "8": {
      label: "8",
      matchGroup: "8",
      points: 8,
      power: { type: "look", count: 1 },
      triggersFromHand: false
    },
    "9": {
      label: "9",
      matchGroup: "9",
      points: 9,
      power: { type: "look", count: 1 },
      triggersFromHand: false
    },
    "10": {
      label: "10",
      matchGroup: "10",
      points: 10,
      power: { type: "swap" },
      triggersFromHand: false
    },
    J: {
      label: "Jack",
      matchGroup: "J",
      points: 11,
      power: { type: "swap" },
      triggersFromHand: false
    },
    Q: {
      label: "Queen",
      matchGroup: "Q",
      points: 12,
      power: { type: "look_swap" },
      triggersFromHand: false
    },
    KS: {
      label: "King of Spades",
      matchGroup: "K",
      points: 20,
      power: { type: "look_swap" },
      triggersFromHand: false
    },
    KC: {
      label: "King of Clubs",
      matchGroup: "K",
      points: 20,
      power: { type: "look_swap" },
      triggersFromHand: false
    },
    KH: {
      label: "King of Hearts",
      matchGroup: "K",
      points: -1,
      power: { type: "look_swap" },
      triggersFromHand: false
    },
    KD: {
      label: "King of Diamonds",
      matchGroup: "K",
      points: -1,
      power: { type: "look_swap" },
      triggersFromHand: false
    },
    JOKER: noPower("Joker", "JOKER", 0)
  }
};
