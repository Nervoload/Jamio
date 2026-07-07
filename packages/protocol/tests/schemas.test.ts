import { describe, expect, it } from "vitest";
import { ClientMessageSchema, CreateRoomRequestSchema } from "../src";

describe("protocol schemas", () => {
  it("normalizes room codes", () => {
    const parsed = CreateRoomRequestSchema.safeParse({
      name: "John",
      roomCode: "jm42",
      maxPlayers: 2,
      theme: "classic",
      ruleset: {
        name: "Test",
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
          A: {
            label: "Ace",
            matchGroup: "A",
            points: 1,
            power: null,
            triggersFromHand: false
          }
        }
      }
    });

    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data.roomCode).toBe("JM42");
    }
  });

  it("validates game action envelopes", () => {
    expect(
      ClientMessageSchema.safeParse({
        type: "game_action",
        clientActionId: "a1",
        expectedStateVersion: 3,
        action: { type: "draw_from_deck" }
      }).success
    ).toBe(true);

    expect(
      ClientMessageSchema.safeParse({
        type: "game_action",
        clientActionId: "a1",
        expectedStateVersion: -1,
        action: { type: "draw_from_deck" }
      }).success
    ).toBe(false);
  });
});
