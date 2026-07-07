import { useEffect, useMemo, useState } from "react";
import type { CardPower, CardTarget, GameAction, Player, PlayerId, PlayerView, PublicCard } from "@jamio/game-core";
import { Card } from "../components/Card";
import { RoomCodeBadge } from "../components/RoomCodeBadge";
import { Scoreboard } from "../components/Scoreboard";
import type { CreatedTable } from "./CreateTableView";

type LocalSession = {
  table: CreatedTable;
  players: Player[];
  state: unknown;
  currentPlayerId: PlayerId;
};

type SelectionMode =
  | "none"
  | "replace_drawn"
  | "take_discard"
  | "power_targets"
  | "discard_reward"
  | "donate_cards";

type TableViewProps = {
  session: LocalSession;
  view: PlayerView | null;
  currentPlayerId: PlayerId;
  onSwitchPlayer: (playerId: PlayerId) => void;
  onAddGuest: () => void;
  onStartGame: () => void;
  onAction: (action: GameAction) => void;
  onRestartFromZero: () => void;
  onLeave: () => void;
};

export function TableView({
  session,
  view,
  currentPlayerId,
  onSwitchPlayer,
  onAddGuest,
  onStartGame,
  onAction,
  onRestartFromZero,
  onLeave
}: TableViewProps) {
  const [mode, setMode] = useState<SelectionMode>("none");
  const [selectedTargets, setSelectedTargets] = useState<CardTarget[]>([]);
  const [donateTargetId, setDonateTargetId] = useState<PlayerId | null>(null);
  const [lastTap, setLastTap] = useState<{ key: string; at: number } | null>(null);

  const currentPlayer = session.players.find((player) => player.id === currentPlayerId) ?? session.players[0]!;
  const latestEmote = [...(view?.eventLog ?? [])].reverse().find((event) => event.type === "power_emote");
  const power = view?.pendingPrompt?.type === "resolve_power" ? view.pendingPrompt.power : null;

  useEffect(() => {
    setMode("none");
    setSelectedTargets([]);
    setDonateTargetId(null);
  }, [currentPlayerId, view?.phase, view?.version]);

  const legal = useMemo(() => {
    return new Set(view?.legalActions.map((action) => action.type) ?? []);
  }, [view]);

  if (!view) {
    return (
      <LobbyView
        session={session}
        currentPlayerId={currentPlayerId}
        onSwitchPlayer={onSwitchPlayer}
        onAddGuest={onAddGuest}
        onStartGame={onStartGame}
        onLeave={onLeave}
      />
    );
  }

  const canDraw = legal.has("draw_from_deck");
  const canTakeDiscard = legal.has("take_discard_and_replace");
  const canCallJamio = legal.has("call_jamio");

  function dispatch(action: GameAction) {
    setMode("none");
    setSelectedTargets([]);
    setDonateTargetId(null);
    onAction(action);
  }

  function handleCardClick(target: CardTarget) {
    if (mode === "replace_drawn" && target.playerId === currentPlayerId) {
      dispatch({ type: "replace_with_drawn_card", handSlotId: target.slotId });
      return;
    }

    if (mode === "take_discard" && target.playerId === currentPlayerId) {
      dispatch({ type: "take_discard_and_replace", handSlotId: target.slotId });
      return;
    }

    if (mode === "discard_reward" && target.playerId === currentPlayerId) {
      dispatch({ type: "resolve_discard_reward", handSlotIdToDonate: target.slotId });
      return;
    }

    if (!power) {
      return;
    }

    if (power.type === "donate" && mode === "donate_cards" && target.playerId === currentPlayerId) {
      setSelectedTargets((current) => toggleTarget(current, target).slice(0, power.count));
      return;
    }

    if (mode !== "power_targets" || !isValidPowerTarget(power, target, currentPlayerId)) {
      return;
    }

    const maxTargets = getPowerTargetCount(power);
    setSelectedTargets((current) => toggleTarget(current, target).slice(0, maxTargets));
  }

  function handleCardTap(target: CardTarget) {
    const key = `${target.playerId}:${target.slotId}`;
    const now = Date.now();
    if (lastTap?.key === key && now - lastTap.at < 420) {
      attemptDiscard(target);
      setLastTap(null);
      return;
    }
    setLastTap({ key, at: now });
  }

  function attemptDiscard(target: CardTarget) {
    if (!view?.lastPlayedSeq || mode !== "none") {
      return;
    }
    dispatch({
      type: "attempt_discard",
      targetPlayerId: target.playerId,
      handSlotId: target.slotId,
      lastPlayedSeq: view.lastPlayedSeq
    });
  }

  function resolveSelectedPower(choiceOverride?: "swap" | "cancel") {
    if (!power) {
      return;
    }

    if (choiceOverride === "cancel") {
      dispatch({ type: "resolve_power", choice: { type: "cancel" } });
      return;
    }

    if (power.type === "swap" && selectedTargets.length === 2) {
      dispatch({
        type: "resolve_power",
        choice: { type: "swap", targets: selectedTargets as [CardTarget, CardTarget] }
      });
      return;
    }

    if (power.type === "look_swap" && selectedTargets.length === 2) {
      dispatch({
        type: "resolve_power",
        choice: {
          type: "look_swap",
          targets: selectedTargets as [CardTarget, CardTarget],
          swap: choiceOverride === "swap"
        }
      });
      return;
    }

    if (power.type === "self_look" || power.type === "look" || power.type === "universal_look") {
      if (selectedTargets.length > 0) {
        dispatch({
          type: "resolve_power",
          choice: { type: "reveal", targets: selectedTargets }
        });
      }
      return;
    }

    if (power.type === "burn" && selectedTargets.length > 0) {
      dispatch({
        type: "resolve_power",
        choice: { type: "burn", targets: selectedTargets }
      });
    }
  }

  function resolveDonate() {
    if (!power || power.type !== "donate" || !donateTargetId || selectedTargets.length === 0) {
      return;
    }
    dispatch({
      type: "resolve_power",
      choice: {
        type: "donate",
        targetPlayerId: donateTargetId,
        handSlotIds: selectedTargets.map((target) => target.slotId)
      }
    });
  }

  return (
    <main className="table-screen">
      {latestEmote ? <div className="emote-overlay" aria-live="polite">{latestEmote.message.replace(/^.* played /, "")}</div> : null}

      <header className="table-topbar">
        <div>
          <p className="eyebrow">Local hotseat table</p>
          <h1>Jamio Table</h1>
        </div>
        <div className="topbar-cluster">
          <label className="viewer-select">
            <span>Viewing as</span>
            <select value={currentPlayerId} onChange={(event) => onSwitchPlayer(event.target.value)}>
              {session.players.map((player) => (
                <option key={player.id} value={player.id}>
                  {player.name}
                </option>
              ))}
            </select>
          </label>
          <RoomCodeBadge roomCode={session.table.roomCode} />
        </div>
      </header>

      <section className="table-layout">
        <div className="status-banner">
          <strong>{phaseCopy(view.phase)}</strong>
          <span>{statusCopy(view, currentPlayer.name)}</span>
        </div>

        <div className="opponent-strip">
          {view.opponentHands.map((hand) => {
            const player = view.players.find((candidate) => candidate.id === hand.playerId);
            return (
              <div className="opponent-seat" key={hand.playerId}>
                <div className="seat-pill">
                  <span>{player?.name ?? hand.playerId}</span>
                  <strong>{hand.cards.length} cards</strong>
                </div>
                <div className="mini-cards-row">
                  {hand.cards.map((handCard) => (
                    <CardButton
                      key={handCard.slotId}
                      card={handCard.card}
                      target={{ playerId: hand.playerId, slotId: handCard.slotId }}
                      selectable={isSelectable(mode, power, currentPlayerId, { playerId: hand.playerId, slotId: handCard.slotId })}
                      selected={isSelected(selectedTargets, { playerId: hand.playerId, slotId: handCard.slotId })}
                      onClick={handleCardClick}
                      onTap={handleCardTap}
                    />
                  ))}
                </div>
              </div>
            );
          })}
        </div>

        <div className="center-stacks" aria-label="table center">
          <button className={`stack deck-stack ${canDraw ? "is-actionable" : ""}`} type="button" disabled={!canDraw} onClick={() => dispatch({ type: "draw_from_deck" })}>
            <Card card={null} />
            <strong>Deck</strong>
            <span>{view.deckCount} cards</span>
          </button>
          <button
            className={`stack played-stack ${canTakeDiscard ? "is-actionable" : ""}`}
            type="button"
            disabled={!canTakeDiscard}
            onClick={() => setMode("take_discard")}
          >
            <Card card={view.discardTop ?? null} />
            <strong>Played</strong>
            <span>{view.discardCount} cards</span>
          </button>
        </div>

        <ActionPanel
          view={view}
          mode={mode}
          power={power}
          selectedTargets={selectedTargets}
          donateTargetId={donateTargetId}
          currentPlayerId={currentPlayerId}
          canCallJamio={canCallJamio}
          players={session.players}
          onModeChange={setMode}
          onDonateTargetChange={(playerId) => {
            setDonateTargetId(playerId);
            setSelectedTargets([]);
            setMode("donate_cards");
          }}
          onResolveSelectedPower={resolveSelectedPower}
          onResolveDonate={resolveDonate}
          onAction={dispatch}
        />

        <div className="player-hand">
          <div className="hand-heading">
            <span>{currentPlayer.name}</span>
            <small>{modeCopy(mode, view.lastPlayedSeq)}</small>
          </div>
          <div className="cards-row">
            {view.yourHand.map((handCard) => (
              <CardButton
                key={handCard.slotId}
                card={handCard.card}
                target={{ playerId: currentPlayerId, slotId: handCard.slotId }}
                selectable={isSelectable(mode, power, currentPlayerId, { playerId: currentPlayerId, slotId: handCard.slotId })}
                selected={isSelected(selectedTargets, { playerId: currentPlayerId, slotId: handCard.slotId })}
                onClick={handleCardClick}
                onTap={handleCardTap}
              />
            ))}
          </div>
        </div>
      </section>

      {view.phase === "round_reveal" || view.phase === "game_over" ? (
        <RevealPanel view={view} hostPlayerId={session.players[0]!.id} currentPlayerId={currentPlayerId} onAction={dispatch} onRestartFromZero={onRestartFromZero} />
      ) : null}

      <Scoreboard view={view} />

      <button className="leave-button" type="button" onClick={onLeave}>
        Leave Table
      </button>
    </main>
  );
}

type LobbyViewProps = {
  session: LocalSession;
  currentPlayerId: PlayerId;
  onSwitchPlayer: (playerId: PlayerId) => void;
  onAddGuest: () => void;
  onStartGame: () => void;
  onLeave: () => void;
};

function LobbyView({ session, currentPlayerId, onSwitchPlayer, onAddGuest, onStartGame, onLeave }: LobbyViewProps) {
  const canStart = session.players.length >= 2;
  return (
    <main className="table-screen">
      <header className="table-topbar">
        <div>
          <p className="eyebrow">Lobby</p>
          <h1>Jamio Table</h1>
        </div>
        <RoomCodeBadge roomCode={session.table.roomCode} />
      </header>
      <section className="lobby-card">
        <div className="panel-heading">
          <p className="eyebrow">Waiting table</p>
          <h2>Players</h2>
        </div>
        <div className="lobby-player-list">
          {session.players.map((player, index) => (
            <button
              className={`lobby-player ${currentPlayerId === player.id ? "is-current" : ""}`}
              key={player.id}
              type="button"
              onClick={() => onSwitchPlayer(player.id)}
            >
              <span>{player.name}</span>
              <strong>{index === 0 ? "Host" : "Seat"}</strong>
            </button>
          ))}
        </div>
        <div className="lobby-actions">
          <button type="button" onClick={onAddGuest} disabled={session.players.length >= session.table.maxPlayers}>
            Add Local Guest
          </button>
          <button type="button" onClick={onStartGame} disabled={!canStart}>
            Start Game
          </button>
          <button type="button" onClick={onLeave}>
            Leave
          </button>
        </div>
        {!canStart ? <p className="muted-note">Add a second local player to test a real round before the online client is wired in.</p> : null}
      </section>
    </main>
  );
}

type ActionPanelProps = {
  view: PlayerView;
  mode: SelectionMode;
  power: CardPower | null;
  selectedTargets: CardTarget[];
  donateTargetId: PlayerId | null;
  currentPlayerId: PlayerId;
  canCallJamio: boolean;
  players: Player[];
  onModeChange: (mode: SelectionMode) => void;
  onDonateTargetChange: (playerId: PlayerId) => void;
  onResolveSelectedPower: (choice?: "swap" | "cancel") => void;
  onResolveDonate: () => void;
  onAction: (action: GameAction) => void;
};

function ActionPanel({
  view,
  mode,
  power,
  selectedTargets,
  donateTargetId,
  currentPlayerId,
  canCallJamio,
  players,
  onModeChange,
  onDonateTargetChange,
  onResolveSelectedPower,
  onResolveDonate,
  onAction
}: ActionPanelProps) {
  const drawnCard = view.pendingPrompt?.type === "drawn_card_decision" ? view.pendingPrompt.card : null;
  const discardReward = view.pendingPrompt?.type === "discard_reward" ? view.pendingPrompt : null;

  return (
    <div className="table-actions">
      {drawnCard ? (
        <div className="drawn-card-panel">
          <Card card={drawnCard} />
          <div>
            <strong>You drew {drawnCard.label}</strong>
            <p>Play it for its power, or replace one of your hidden cards.</p>
            <div className="inline-actions">
              <button type="button" onClick={() => onAction({ type: "play_drawn_card" })}>
                Play Card
              </button>
              <button type="button" onClick={() => onModeChange("replace_drawn")}>
                Replace
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {power ? (
        <div className="power-panel">
          <strong>{powerLabel(power)} power</strong>
          <p>{powerHelp(power)}</p>
          {power.type === "give" ? (
            <div className="inline-actions">
              {players
                .filter((player) => player.id !== currentPlayerId)
                .map((player) => (
                  <button
                    key={player.id}
                    type="button"
                    onClick={() => onAction({ type: "resolve_power", choice: { type: "give", targetPlayerId: player.id } })}
                  >
                    Give to {player.name}
                  </button>
                ))}
            </div>
          ) : null}

          {power.type === "donate" ? (
            <>
              <div className="inline-actions">
                {players
                  .filter((player) => player.id !== currentPlayerId)
                  .map((player) => (
                    <button
                      className={donateTargetId === player.id ? "is-active" : ""}
                      key={player.id}
                      type="button"
                      onClick={() => onDonateTargetChange(player.id)}
                    >
                      Donate to {player.name}
                    </button>
                  ))}
              </div>
              <button type="button" disabled={!donateTargetId || selectedTargets.length === 0} onClick={onResolveDonate}>
                Donate selected
              </button>
            </>
          ) : null}

          {power.type !== "give" && power.type !== "donate" ? (
            <div className="inline-actions">
              <button type="button" onClick={() => onModeChange("power_targets")}>
                Select Targets
              </button>
              {power.type === "look_swap" && selectedTargets.length === 2 ? (
                <>
                  <button type="button" onClick={() => onResolveSelectedPower("swap")}>
                    Look & Swap
                  </button>
                  <button type="button" onClick={() => onResolveSelectedPower()}>
                    Just Look
                  </button>
                </>
              ) : (
                <button type="button" disabled={!canResolvePower(power, selectedTargets)} onClick={() => onResolveSelectedPower()}>
                  Resolve Selected
                </button>
              )}
              <button type="button" onClick={() => onResolveSelectedPower("cancel")}>
                Skip
              </button>
            </div>
          ) : null}
        </div>
      ) : null}

      {discardReward ? (
        <div className="power-panel">
          <strong>Discard reward</strong>
          <p>Choose one of your cards to donate to the player you correctly discarded from.</p>
          <button type="button" onClick={() => onModeChange("discard_reward")}>
            Select Donation Card
          </button>
        </div>
      ) : null}

      <div className="inline-actions main-actions">
        <button type="button" disabled={!canCallJamio} onClick={() => onAction({ type: "call_jamio" })}>
          Call Jamio
        </button>
        {mode !== "none" ? (
          <button type="button" onClick={() => onModeChange("none")}>
            Cancel Selection
          </button>
        ) : null}
      </div>
    </div>
  );
}

type RevealPanelProps = {
  view: PlayerView;
  hostPlayerId: PlayerId;
  currentPlayerId: PlayerId;
  onAction: (action: GameAction) => void;
  onRestartFromZero: () => void;
};

function RevealPanel({ view, hostPlayerId, currentPlayerId, onAction, onRestartFromZero }: RevealPanelProps) {
  const winner = view.players.find((player) => player.id === view.roundWinnerId);
  const gameWinner = view.players.find((player) => player.id === view.gameWinnerId);
  const isHost = currentPlayerId === hostPlayerId;

  return (
    <section className="reveal-panel">
      <div>
        <p className="eyebrow">{view.phase === "game_over" ? "Game over" : "Round reveal"}</p>
        <h2>{view.phase === "game_over" ? `${gameWinner?.name ?? "Winner"} wins` : `${winner?.name ?? "Someone"} wins the round`}</h2>
      </div>
      <div className="reveal-grid">
        {view.players.map((player) => (
          <div className="reveal-score" key={player.id}>
            <span>{player.name}</span>
            <strong>{view.roundScores[player.id] ?? 0} this round</strong>
            <small>{view.scores[player.id] ?? 0} total</small>
          </div>
        ))}
      </div>
      <div className="inline-actions">
        {view.phase === "round_reveal" ? (
          <>
            <button type="button" disabled={!isHost} onClick={() => onAction({ type: "start_next_round" })}>
              Start Next Round
            </button>
            <button type="button" disabled={!isHost} onClick={() => onAction({ type: "end_game_now" })}>
              End Game
            </button>
          </>
        ) : (
          <button type="button" onClick={onRestartFromZero}>
            Restart From Zero
          </button>
        )}
      </div>
    </section>
  );
}

type CardButtonProps = {
  card: PublicCard | null;
  target: CardTarget;
  selectable: boolean;
  selected: boolean;
  onClick: (target: CardTarget) => void;
  onTap: (target: CardTarget) => void;
};

function CardButton({ card, target, selectable, selected, onClick, onTap }: CardButtonProps) {
  return (
    <button
      className={`card-button ${selectable ? "is-selectable" : ""} ${selected ? "is-selected" : ""}`}
      type="button"
      onClick={() => {
        onTap(target);
        onClick(target);
      }}
      onDoubleClick={() => onTap(target)}
    >
      <Card card={card} />
    </button>
  );
}

function isSelectable(mode: SelectionMode, power: CardPower | null, currentPlayerId: PlayerId, target: CardTarget): boolean {
  if (mode === "replace_drawn" || mode === "take_discard" || mode === "discard_reward" || mode === "donate_cards") {
    return target.playerId === currentPlayerId;
  }
  if (mode === "power_targets" && power) {
    return isValidPowerTarget(power, target, currentPlayerId);
  }
  return false;
}

function isValidPowerTarget(power: CardPower, target: CardTarget, currentPlayerId: PlayerId): boolean {
  switch (power.type) {
    case "self_look":
      return target.playerId === currentPlayerId;
    case "look":
      return target.playerId !== currentPlayerId;
    case "swap":
    case "look_swap":
    case "universal_look":
    case "burn":
      return true;
    default:
      return false;
  }
}

function getPowerTargetCount(power: CardPower): number {
  if (power.type === "swap" || power.type === "look_swap") {
    return 2;
  }
  if ("count" in power) {
    return power.count;
  }
  return 0;
}

function canResolvePower(power: CardPower, selectedTargets: CardTarget[]): boolean {
  if (power.type === "swap" || power.type === "look_swap") {
    return selectedTargets.length === 2;
  }
  if (power.type === "self_look" || power.type === "look" || power.type === "universal_look" || power.type === "burn") {
    return selectedTargets.length > 0;
  }
  return false;
}

function toggleTarget(current: CardTarget[], target: CardTarget): CardTarget[] {
  if (isSelected(current, target)) {
    return current.filter((candidate) => !sameTarget(candidate, target));
  }
  return [...current, target];
}

function isSelected(current: CardTarget[], target: CardTarget): boolean {
  return current.some((candidate) => sameTarget(candidate, target));
}

function sameTarget(first: CardTarget, second: CardTarget): boolean {
  return first.playerId === second.playerId && first.slotId === second.slotId;
}

function powerLabel(power: CardPower): string {
  switch (power.type) {
    case "swap":
      return "Swap";
    case "look_swap":
      return "Look & Swap";
    case "self_look":
      return `Self Look ${power.count}`;
    case "look":
      return `Look ${power.count}`;
    case "universal_look":
      return `Universal Look ${power.count}`;
    case "give":
      return `Give ${power.count}`;
    case "donate":
      return `Donate ${power.count}`;
    case "burn":
      return `Burn ${power.count}`;
    case "draw":
      return `Draw ${power.count}`;
    case "emote":
      return `Emote ${power.value}`;
  }
}

function powerHelp(power: CardPower): string {
  switch (power.type) {
    case "swap":
      return "Select any two cards to swap blindly.";
    case "look_swap":
      return "Select any two cards, then choose whether to swap them.";
    case "self_look":
      return "Select your own card or cards to privately reveal.";
    case "look":
      return "Select opponent cards to privately reveal.";
    case "universal_look":
      return "Select any card or cards to privately reveal.";
    case "give":
      return "Choose another player to receive blind cards from the deck.";
    case "donate":
      return "Choose another player, then select your own cards to donate.";
    case "burn":
      return "Select cards to burn back into the deck.";
    case "draw":
      return "Draw resolved automatically.";
    case "emote":
      return "Emote resolved automatically.";
  }
}

function phaseCopy(phase: PlayerView["phase"]): string {
  switch (phase) {
    case "initial_countdown":
      return "Get ready";
    case "initial_memorize":
      return "Memorize your front two";
    case "turn_idle":
      return "Turn";
    case "drawn_card_decision":
      return "Drawn card";
    case "resolving_power":
      return "Power";
    case "discard_reward":
      return "Discard reward";
    case "jamio_final_cycle":
      return "Final cycle";
    case "round_reveal":
      return "Round reveal";
    case "game_over":
      return "Game over";
    default:
      return phase;
  }
}

function statusCopy(view: PlayerView, currentPlayerName: string): string {
  if (view.phase === "initial_countdown") {
    return "Cards are dealt. Memorization starts in a moment.";
  }
  if (view.phase === "initial_memorize") {
    return `${currentPlayerName}, only you can see your first two cards.`;
  }
  if (view.currentTurnPlayerId) {
    const player = view.players.find((candidate) => candidate.id === view.currentTurnPlayerId);
    return `${player?.name ?? view.currentTurnPlayerId} is up.`;
  }
  if (view.phase === "round_reveal") {
    return "All hands are face up.";
  }
  if (view.phase === "game_over") {
    return "Final scores are locked.";
  }
  return "Table is waiting.";
}

function modeCopy(mode: SelectionMode, lastPlayedSeq: number | null): string {
  switch (mode) {
    case "replace_drawn":
      return "Choose a card to replace";
    case "take_discard":
      return "Choose a card to trade for the played stack";
    case "power_targets":
      return "Choose power targets";
    case "discard_reward":
      return "Choose a card to donate";
    case "donate_cards":
      return "Choose cards to donate";
    default:
      return lastPlayedSeq ? "Double tap any card to attempt discard" : "Cards are hidden";
  }
}
