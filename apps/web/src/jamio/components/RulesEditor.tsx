import { useMemo } from "react";
import { jamioDefaultRuleset, type CardPower, type CardRule, type Ruleset, type Suit } from "@jamio/game-core";

type RulesEditorProps = {
  ruleset: Ruleset;
  maxPlayers: number;
  onChange: (ruleset: Ruleset) => void;
};

type RankGroup = {
  key: string;
  label: string;
  suitKeys?: Record<Suit, string>;
};

const rankGroups: RankGroup[] = [
  { key: "A", label: "Ace" },
  { key: "2", label: "2" },
  { key: "3", label: "3" },
  { key: "4", label: "4" },
  { key: "5", label: "5" },
  { key: "6", label: "6" },
  { key: "7", label: "7" },
  { key: "8", label: "8" },
  { key: "9", label: "9" },
  { key: "10", label: "10" },
  { key: "J", label: "Jack" },
  { key: "Q", label: "Queen" },
  {
    key: "K",
    label: "King",
    suitKeys: {
      S: "KS",
      C: "KC",
      H: "KH",
      D: "KD"
    }
  },
  { key: "JOKER", label: "Joker" }
];

const suits: Array<{ suit: Suit; label: string }> = [
  { suit: "S", label: "Spades" },
  { suit: "C", label: "Clubs" },
  { suit: "H", label: "Hearts" },
  { suit: "D", label: "Diamonds" }
];

const powerOptions: Array<{ value: PowerType; label: string }> = [
  { value: "none", label: "None" },
  { value: "swap", label: "Swap" },
  { value: "look_swap", label: "Look & Swap" },
  { value: "self_look", label: "Self Look" },
  { value: "look", label: "Look" },
  { value: "universal_look", label: "Universal Look" },
  { value: "give", label: "Give" },
  { value: "donate", label: "Donate" },
  { value: "burn", label: "Burn" },
  { value: "draw", label: "Draw" },
  { value: "emote", label: "Emote" }
];

type PowerType = CardPower["type"] | "none";

export function RulesEditor({ ruleset, maxPlayers, onChange }: RulesEditorProps) {
  const maxStartingHand = useMemo(() => {
    const deckSize = ruleset.general.deckMode === "withJokers54" ? 54 : 52;
    return Math.min(8, Math.floor(deckSize / Math.max(1, maxPlayers)));
  }, [maxPlayers, ruleset.general.deckMode]);

  function update(next: Ruleset) {
    onChange(next);
  }

  function updateGeneral<T extends keyof Ruleset["general"]>(key: T, value: Ruleset["general"][T]) {
    update({
      ...ruleset,
      general: {
        ...ruleset.general,
        [key]: value
      }
    });
  }

  function updateRule(ruleKey: string, patch: Partial<CardRule>) {
    const existing = ruleFor(ruleset, ruleKey);
    update({
      ...ruleset,
      cardRules: {
        ...ruleset.cardRules,
        [ruleKey]: {
          ...existing,
          ...patch
        }
      }
    });
  }

  function setDifferentiated(group: RankGroup, differentiated: boolean) {
    const suitKeys = group.suitKeys ?? makeSuitKeys(group.key);
    const nextRules = { ...ruleset.cardRules };
    const base = ruleFor(ruleset, group.key);

    if (differentiated) {
      for (const { suit, label } of suits) {
        const suitKey = suitKeys[suit];
        nextRules[suitKey] = {
          ...base,
          label: `${group.label} of ${label}`,
          matchGroup: group.key
        };
      }
    } else {
      const firstSuitRule = nextRules[suitKeys.S] ?? base;
      nextRules[group.key] = {
        ...firstSuitRule,
        label: group.label,
        matchGroup: group.key
      };
      for (const { suit } of suits) {
        delete nextRules[suitKeys[suit]];
      }
    }

    update({ ...ruleset, cardRules: nextRules });
  }

  return (
    <details className="rules-editor" open>
      <summary>Rules Settings</summary>

      <section className="rules-editor-section">
        <div className="rules-section-heading">
          <h3>Templates</h3>
          <button
            type="button"
            onClick={() => onChange(JSON.parse(JSON.stringify(jamioDefaultRuleset)) as Ruleset)}
          >
            Reset to Default Jamio
          </button>
        </div>
      </section>

      <section className="rules-editor-section">
        <h3>General Rules</h3>
        <div className="settings-grid">
          <label className="toggle-row">
            <span>Can discard on own turn</span>
            <input
              type="checkbox"
              checked={ruleset.general.canDiscardOnOwnTurn}
              onChange={(event) => updateGeneral("canDiscardOnOwnTurn", event.target.checked)}
            />
          </label>
          <label className="toggle-row">
            <span>Automatic Jamio on 0 cards</span>
            <input
              type="checkbox"
              checked={ruleset.general.automaticJamioOnZeroCards}
              onChange={(event) => updateGeneral("automaticJamioOnZeroCards", event.target.checked)}
            />
          </label>
          <label className="toggle-row">
            <span>Draw card on mistakes</span>
            <input
              type="checkbox"
              checked={ruleset.general.drawCardOnMistake}
              onChange={(event) => updateGeneral("drawCardOnMistake", event.target.checked)}
            />
          </label>
          <label className="field compact-field">
            <span>Deck</span>
            <select
              value={ruleset.general.deckMode}
              onChange={(event) => updateGeneral("deckMode", event.target.value as Ruleset["general"]["deckMode"])}
            >
              <option value="standard52">Standard 52</option>
              <option value="withJokers54">With Jokers 54</option>
            </select>
          </label>
          <label className="field compact-field">
            <span>Starting hand</span>
            <input
              type="number"
              min={1}
              max={maxStartingHand}
              value={ruleset.general.startingHandSize}
              onChange={(event) =>
                updateGeneral("startingHandSize", clampNumber(Number(event.target.value), 1, maxStartingHand))
              }
            />
            <small>Max {maxStartingHand} with {maxPlayers} player{maxPlayers === 1 ? "" : "s"}.</small>
          </label>
          <label className="field compact-field">
            <span>End score threshold</span>
            <input
              type="number"
              min={1}
              max={1000}
              value={ruleset.general.scoreLimit}
              onChange={(event) => updateGeneral("scoreLimit", clampNumber(Number(event.target.value), 1, 1000))}
            />
          </label>
          <label className="field compact-field">
            <span>Minimum cards before Jamio</span>
            <input
              type="number"
              min={0}
              max={ruleset.general.deckMode === "withJokers54" ? 54 : 52}
              value={ruleset.general.minCardsPlayedBeforeJamio}
              onChange={(event) =>
                updateGeneral(
                  "minCardsPlayedBeforeJamio",
                  clampNumber(Number(event.target.value), 0, ruleset.general.deckMode === "withJokers54" ? 54 : 52)
                )
              }
            />
          </label>
          <label className="field compact-field">
            <span>Bad Jamio penalty next round</span>
            <input
              type="number"
              min={0}
              max={8}
              value={ruleset.general.badCallPenaltyCards}
              onChange={(event) =>
                updateGeneral("badCallPenaltyCards", clampNumber(Number(event.target.value), 0, 8))
              }
            />
          </label>
        </div>
      </section>

      <section className="rules-editor-section">
        <h3>Card Rules</h3>
        <div className="card-rule-stack">
          {rankGroups.map((group) => {
            const suitKeys = group.suitKeys ?? makeSuitKeys(group.key);
            const differentiated = suits.some(({ suit }) => Boolean(ruleset.cardRules[suitKeys[suit]]));
            const canDifferentiate = group.key !== "JOKER";

            return (
              <div className="card-rule-group" key={group.key}>
                <div className="card-rule-title">
                  <strong>{group.label}</strong>
                  {canDifferentiate ? (
                    <label>
                      <input
                        type="checkbox"
                        checked={differentiated}
                        onChange={(event) => setDifferentiated(group, event.target.checked)}
                      />
                      Differentiate suit powers
                    </label>
                  ) : null}
                </div>

                {differentiated ? (
                  <div className="suit-rule-stack">
                    {suits.map(({ suit, label }) => (
                      <RuleBox
                        key={suit}
                        title={`${group.label} of ${label}`}
                        rule={ruleFor(ruleset, suitKeys[suit])}
                        onChange={(patch) => updateRule(suitKeys[suit], patch)}
                      />
                    ))}
                  </div>
                ) : (
                  <RuleBox
                    title={group.label}
                    rule={ruleFor(ruleset, group.key)}
                    onChange={(patch) => updateRule(group.key, patch)}
                  />
                )}
              </div>
            );
          })}
        </div>
      </section>
    </details>
  );
}

type RuleBoxProps = {
  title: string;
  rule: CardRule;
  onChange: (patch: Partial<CardRule>) => void;
};

function RuleBox({ title, rule, onChange }: RuleBoxProps) {
  const powerType = rule.power?.type ?? "none";

  return (
    <div className="rule-box">
      <div className="rule-box-title">{title}</div>
      <label className="field compact-field">
        <span>Points</span>
        <input
          type="number"
          min={-100}
          max={100}
          value={rule.points}
          onChange={(event) => onChange({ points: clampNumber(Number(event.target.value), -100, 100) })}
        />
      </label>
      <label className="field compact-field">
        <span>Power</span>
        <select value={powerType} onChange={(event) => onChange({ power: makePower(event.target.value as PowerType) })}>
          {powerOptions.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
      </label>
      {rule.power && needsPowerValue(rule.power) ? (
        <PowerValueInput power={rule.power} onChange={(power) => onChange({ power })} />
      ) : null}
      <label className="toggle-row compact-toggle">
        <span>Always empowered</span>
        <input
          type="checkbox"
          checked={rule.triggersFromHand}
          onChange={(event) => onChange({ triggersFromHand: event.target.checked })}
        />
      </label>
    </div>
  );
}

type PowerValueInputProps = {
  power: CardPower;
  onChange: (power: CardPower) => void;
};

function PowerValueInput({ power, onChange }: PowerValueInputProps) {
  if (power.type === "emote") {
    return (
      <label className="field compact-field">
        <span>Emote</span>
        <input
          value={power.value}
          maxLength={24}
          onChange={(event) => onChange({ type: "emote", value: event.target.value })}
        />
      </label>
    );
  }

  if ("count" in power) {
    return (
      <label className="field compact-field">
        <span>Value</span>
        <input
          type="number"
          min={1}
          max={10}
          value={power.count}
          onChange={(event) => onChange({ ...power, count: clampNumber(Number(event.target.value), 1, 10) })}
        />
      </label>
    );
  }

  return null;
}

function makePower(type: PowerType): CardPower | null {
  switch (type) {
    case "none":
      return null;
    case "swap":
      return { type };
    case "look_swap":
      return { type };
    case "self_look":
      return { type, count: 1 };
    case "look":
      return { type, count: 1 };
    case "universal_look":
      return { type, count: 3 };
    case "give":
      return { type, count: 1 };
    case "donate":
      return { type, count: 1 };
    case "burn":
      return { type, count: 1 };
    case "draw":
      return { type, count: 1 };
    case "emote":
      return { type, value: "❤️" };
  }
}

function needsPowerValue(power: CardPower): boolean {
  return power.type === "emote" || "count" in power;
}

function ruleFor(ruleset: Ruleset, ruleKey: string): CardRule {
  return (
    ruleset.cardRules[ruleKey] ?? {
      label: ruleKey,
      matchGroup: ruleKey.replace(/[SCHD]$/, ""),
      points: 0,
      power: null,
      triggersFromHand: false
    }
  );
}

function makeSuitKeys(rank: string): Record<Suit, string> {
  return {
    S: `${rank}S`,
    C: `${rank}C`,
    H: `${rank}H`,
    D: `${rank}D`
  };
}

function clampNumber(value: number, min: number, max: number): number {
  if (Number.isNaN(value)) {
    return min;
  }
  return Math.min(max, Math.max(min, Math.trunc(value)));
}
