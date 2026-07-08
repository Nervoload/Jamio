import { useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type RefCallback } from "react";
import type { CardPower, CardTarget, GameAction, GameEvent, Player, PlayerId, PlayerView, PublicCard } from "@jamio/game-core";
import { Card } from "../components/Card";
import { RoomCodeBadge } from "../components/RoomCodeBadge";
import { Scoreboard } from "../components/Scoreboard";
import type { CreatedTable } from "./CreateTableView";

type TableSession = {
  kind: "local" | "online";
  table: CreatedTable;
  players: Player[];
  currentPlayerId: PlayerId;
  state?: unknown;
  connectionStatus?: string | null;
  connectionError?: string | null;
};

type SelectionMode =
  | "none"
  | "replace_drawn"
  | "take_discard"
  | "power_targets"
  | "discard_reward"
  | "donate_cards";

const doubleTapWindowMs = 420;
const lookRevealTimeoutMs = 30_000;

type TargetMotion = {
  className: string;
  style?: CSSProperties & Partial<Record<"--move-x" | "--move-y", string>>;
};

type FlightMotion = {
  id: string;
  className: string;
  style: CSSProperties & Record<"--move-x" | "--move-y", string>;
};

type TableViewProps = {
  session: TableSession;
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
  const [targetMotions, setTargetMotions] = useState<Record<string, TargetMotion>>({});
  const [stackMotion, setStackMotion] = useState<"deck" | "discard" | null>(null);
  const [flightMotions, setFlightMotions] = useState<FlightMotion[]>([]);
  const targetRefs = useRef(new Map<string, HTMLButtonElement>());
  const cardMotionRefs = useRef(new Map<string, HTMLButtonElement>());
  const stackRefs = useRef(new Map<"deck" | "discard", HTMLButtonElement>());
  const playerAreaRefs = useRef(new Map<PlayerId, HTMLElement>());
  const previousCardRects = useRef(new Map<string, DOMRect>());
  const animatedEventIds = useRef(new Set<string>());
  const hasHydratedEventLog = useRef(false);
  const targetMotionTimeout = useRef<number | null>(null);
  const stackMotionTimeout = useRef<number | null>(null);
  const flightCounter = useRef(0);

  const currentPlayer = session.players.find((player) => player.id === currentPlayerId) ?? session.players[0]!;
  const isOnline = session.kind === "online";
  const latestEmote = [...(view?.eventLog ?? [])].reverse().find((event) => event.type === "power_emote");
  const powerPrompt = view?.pendingPrompt?.type === "resolve_power" ? view.pendingPrompt : null;
  const power = powerPrompt?.power ?? null;
  const revealedTargets = powerPrompt?.revealedTargets ?? [];
  const revealedAtVersion = powerPrompt?.revealedAtVersion;
  const isViewingPower = revealedTargets.length > 0;
  const allCardTargets = useMemo(() => getAllCardTargets(view, currentPlayerId), [view, currentPlayerId]);

  useEffect(() => {
    setSelectedTargets([]);
    setDonateTargetId(null);
    const prompt = view?.pendingPrompt;
    if (prompt?.type === "resolve_power" && isTargetingPower(prompt.power) && !prompt.revealedTargets?.length) {
      setMode("power_targets");
      return;
    }
    if (prompt?.type === "discard_reward") {
      setMode("discard_reward");
      return;
    }
    setMode("none");
  }, [currentPlayerId, view?.phase, view?.version]);

  useEffect(() => {
    if (!isViewingPower) {
      return;
    }
    const timeout = window.setTimeout(() => {
      onAction({ type: "resolve_power", choice: { type: "end_reveal" } });
    }, lookRevealTimeoutMs);
    return () => window.clearTimeout(timeout);
  }, [isViewingPower, onAction, revealedAtVersion]);

  useLayoutEffect(() => {
    const nextRects = new Map<string, DOMRect>();
    const prefersReducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

    for (const [cardId, node] of cardMotionRefs.current) {
      const rect = node.getBoundingClientRect();
      nextRects.set(cardId, rect);
      const previousRect = previousCardRects.current.get(cardId);
      if (!previousRect || prefersReducedMotion) {
        continue;
      }
      const deltaX = previousRect.left - rect.left;
      const deltaY = previousRect.top - rect.top;
      if (Math.abs(deltaX) < 1 && Math.abs(deltaY) < 1) {
        continue;
      }
      node.animate(
        [
          { transform: `translate(${deltaX}px, ${deltaY}px)` },
          { transform: "translate(0, 0)" }
        ],
        {
          duration: 420,
          easing: "cubic-bezier(.2,.9,.2,1)"
        }
      );
    }

    previousCardRects.current = nextRects;
  }, [view?.version, currentPlayerId]);

  useEffect(() => {
    if (!view) {
      return;
    }

    if (!hasHydratedEventLog.current) {
      for (const event of view.eventLog) {
        animatedEventIds.current.add(event.id);
      }
      hasHydratedEventLog.current = true;
      return;
    }

    const unseenEvents = view.eventLog.filter((event) => !animatedEventIds.current.has(event.id));
    for (const event of unseenEvents) {
      animatedEventIds.current.add(event.id);
      animateSharedEvent(event);
    }

    const visibleIds = new Set(view.eventLog.map((event) => event.id));
    animatedEventIds.current = new Set([...animatedEventIds.current].filter((eventId) => visibleIds.has(eventId)));
  }, [view?.eventLog, view?.version]);

  const legal = useMemo(() => {
    return new Set(view?.legalActions.map((action) => action.type) ?? []);
  }, [view]);

  if (!view || view.phase === "lobby") {
    return (
      <LobbyView
        session={session}
        view={view}
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

  function registerTargetElement(target: CardTarget): RefCallback<HTMLButtonElement> {
    const key = targetKey(target);
    return (node) => {
      if (node) {
        targetRefs.current.set(key, node);
      } else {
        targetRefs.current.delete(key);
      }
    };
  }

  function registerCardMotionElement(card: PublicCard | null): RefCallback<HTMLButtonElement> {
    const cardId = card?.id;
    return (node) => {
      if (!cardId) {
        return;
      }
      if (node) {
        cardMotionRefs.current.set(cardId, node);
      } else {
        cardMotionRefs.current.delete(cardId);
      }
    };
  }

  function registerStackElement(stack: "deck" | "discard"): RefCallback<HTMLButtonElement> {
    return (node) => {
      if (node) {
        stackRefs.current.set(stack, node);
      } else {
        stackRefs.current.delete(stack);
      }
    };
  }

  function registerPlayerAreaElement(playerId: PlayerId): RefCallback<HTMLElement> {
    return (node) => {
      if (node) {
        playerAreaRefs.current.set(playerId, node);
      } else {
        playerAreaRefs.current.delete(playerId);
      }
    };
  }

  function setTemporaryTargetMotions(nextMotions: Record<string, TargetMotion>, duration = 560) {
    if (targetMotionTimeout.current) {
      window.clearTimeout(targetMotionTimeout.current);
    }
    setTargetMotions(nextMotions);
    targetMotionTimeout.current = window.setTimeout(() => {
      setTargetMotions({});
      targetMotionTimeout.current = null;
    }, duration);
  }

  function setTemporaryStackMotion(stack: "deck" | "discard", duration = 520) {
    if (stackMotionTimeout.current) {
      window.clearTimeout(stackMotionTimeout.current);
    }
    setStackMotion(stack);
    stackMotionTimeout.current = window.setTimeout(() => {
      setStackMotion(null);
      stackMotionTimeout.current = null;
    }, duration);
  }

  function markTargets(targets: CardTarget[], className: string, duration = 560) {
    const motions = Object.fromEntries(targets.map((target) => [targetKey(target), { className }]));
    setTemporaryTargetMotions(motions, duration);
  }

  function markSwapTargets(targets: [CardTarget, CardTarget]) {
    const firstKey = targetKey(targets[0]);
    const secondKey = targetKey(targets[1]);
    const firstRect = targetRefs.current.get(firstKey)?.getBoundingClientRect();
    const secondRect = targetRefs.current.get(secondKey)?.getBoundingClientRect();

    if (!firstRect || !secondRect) {
      markTargets(targets, "is-moving");
      return;
    }

    setTemporaryTargetMotions({
      [firstKey]: {
        className: "is-swapping",
        style: {
          "--move-x": `${secondRect.left - firstRect.left}px`,
          "--move-y": `${secondRect.top - firstRect.top}px`
        }
      },
      [secondKey]: {
        className: "is-swapping",
        style: {
          "--move-x": `${firstRect.left - secondRect.left}px`,
          "--move-y": `${firstRect.top - secondRect.top}px`
        }
      }
    });
    animateFlight(targetRefs.current.get(firstKey), targetRefs.current.get(secondKey), "is-swap-flight");
    animateFlight(targetRefs.current.get(secondKey), targetRefs.current.get(firstKey), "is-swap-flight");
  }

  function animateFlight(fromNode: Element | null | undefined, toNode: Element | null | undefined, className: string) {
    if (!fromNode || !toNode || window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      return;
    }
    const fromRect = fromNode.getBoundingClientRect();
    const toRect = toNode.getBoundingClientRect();
    const id = `flight-${flightCounter.current++}`;
    const flight: FlightMotion = {
      id,
      className,
      style: {
        left: `${fromRect.left}px`,
        top: `${fromRect.top}px`,
        width: `${fromRect.width}px`,
        height: `${fromRect.height}px`,
        "--move-x": `${toRect.left + toRect.width / 2 - (fromRect.left + fromRect.width / 2)}px`,
        "--move-y": `${toRect.top + toRect.height / 2 - (fromRect.top + fromRect.height / 2)}px`
      }
    };
    setFlightMotions((current) => [...current, flight]);
    window.setTimeout(() => {
      setFlightMotions((current) => current.filter((candidate) => candidate.id !== id));
    }, 780);
  }

  function targetNode(target: CardTarget): HTMLButtonElement | undefined {
    return targetRefs.current.get(targetKey(target));
  }

  function stackNode(stack: "deck" | "discard"): HTMLButtonElement | undefined {
    return stackRefs.current.get(stack);
  }

  function playerAreaNode(playerId: PlayerId): HTMLElement | undefined {
    return playerAreaRefs.current.get(playerId);
  }

  function animateStackToTargets(stack: "deck" | "discard", targets: CardTarget[], className: string) {
    for (const target of targets) {
      animateFlight(stackNode(stack), targetNode(target), className);
    }
  }

  function animateTargetsToStack(targets: CardTarget[], stack: "deck" | "discard", className: string) {
    for (const target of targets) {
      animateFlight(targetNode(target), stackNode(stack), className);
    }
  }

  function animateSharedEvent(event: GameEvent) {
    const targets = eventTargets(event);

    switch (event.type) {
      case "draw":
        setTemporaryStackMotion("deck");
        animateFlight(stackNode("deck"), event.targetPlayerId ? playerAreaNode(event.targetPlayerId) : undefined, "is-draw-flight");
        return;
      case "play_card":
        setTemporaryStackMotion("discard");
        if (event.source === "drawn") {
          animateFlight(event.targetPlayerId ? playerAreaNode(event.targetPlayerId) : undefined, stackNode("discard"), "is-discard-flight");
        }
        return;
      case "replace_card":
        if (event.source === "deck" || event.source === "drawn") {
          setTemporaryStackMotion("deck");
          animateStackToTargets("deck", targets, "is-draw-flight");
        }
        if (event.source === "discard") {
          setTemporaryStackMotion("discard");
          animateStackToTargets("discard", targets, "is-draw-flight");
        }
        animateTargetsToStack(targets, "discard", "is-discard-flight");
        markTargets(targets, "is-replacing");
        return;
      case "swap_cards":
        if (targets.length >= 2) {
          markSwapTargets(targets.slice(0, 2) as [CardTarget, CardTarget]);
        }
        return;
      case "power_reveal":
        markTargets(targets, "is-looked-at", 5000);
        return;
      case "power_draw":
      case "power_give":
      case "penalty_draw":
        setTemporaryStackMotion("deck");
        animateStackToTargets("deck", targets, "is-draw-flight");
        markTargets(targets, "is-drawing-card");
        return;
      case "discard_reward":
      case "power_donate":
        if (targets.length >= 2) {
          animateFlight(targetNode(targets[0]!), targetNode(targets[1]!), "is-donate-flight");
        }
        markTargets(targets, "is-donating");
        return;
      case "discard_correct":
      case "discard_mistake":
      case "opponent_discard_correct":
      case "opponent_discard_mistake":
        animateTargetsToStack(targets, "discard", "is-discard-flight");
        markTargets(targets, "is-discarding");
        return;
      case "burn_cards":
        animateTargetsToStack(targets, "deck", "is-burn-flight");
        markTargets(targets, "is-burning");
        return;
      default:
        return;
    }
  }

  function dispatch(action: GameAction) {
    setMode("none");
    setSelectedTargets([]);
    setDonateTargetId(null);
    onAction(action);
  }

  function handleCardClick(target: CardTarget) {
    if (mode === "replace_drawn" && target.playerId === currentPlayerId) {
      markTargets([target], "is-replacing");
      setTemporaryStackMotion("discard");
      dispatch({ type: "replace_with_drawn_card", handSlotId: target.slotId });
      return;
    }

    if (mode === "take_discard" && target.playerId === currentPlayerId) {
      markTargets([target], "is-replacing");
      setTemporaryStackMotion("discard");
      dispatch({ type: "take_discard_and_replace", handSlotId: target.slotId });
      return;
    }

    if (mode === "discard_reward" && target.playerId === currentPlayerId) {
      markTargets([target], "is-donating");
      dispatch({ type: "resolve_discard_reward", handSlotIdToDonate: target.slotId });
      return;
    }

    if (!power) {
      return;
    }

    if (power.type === "donate" && mode === "donate_cards" && target.playerId === currentPlayerId) {
      const nextTargets = toggleTarget(selectedTargets, target).slice(0, power.count);
      setSelectedTargets(nextTargets);
      if (donateTargetId && nextTargets.length >= getRequiredTargetCount(power, currentPlayerId, allCardTargets)) {
        markTargets(nextTargets, "is-donating");
        dispatch({
          type: "resolve_power",
          choice: {
            type: "donate",
            targetPlayerId: donateTargetId,
            handSlotIds: nextTargets.map((candidate) => candidate.slotId)
          }
        });
      }
      return;
    }

    if (mode !== "power_targets" || !isValidPowerTarget(power, target, currentPlayerId)) {
      return;
    }

    const maxTargets = getPowerTargetCount(power);
    const nextTargets = toggleTarget(selectedTargets, target).slice(0, maxTargets);
    setSelectedTargets(nextTargets);

    if (nextTargets.length >= getRequiredTargetCount(power, currentPlayerId, allCardTargets)) {
      resolvePowerTargets(power, nextTargets);
    }
  }

  function handleCardTap(target: CardTarget) {
    const key = `${target.playerId}:${target.slotId}`;
    const now = Date.now();
    if (lastTap?.key === key && now - lastTap.at < doubleTapWindowMs) {
      attemptDiscard(target);
      setLastTap(null);
      return;
    }
    setLastTap({ key, at: now });
  }

  function attemptDiscard(target: CardTarget) {
    if (!view?.lastPlayedSeq || !legal.has("attempt_discard")) {
      return;
    }
    markTargets([target], "is-discarding");
    dispatch({
      type: "attempt_discard",
      targetPlayerId: target.playerId,
      handSlotId: target.slotId,
      lastPlayedSeq: view.lastPlayedSeq
    });
  }

  function resolvePowerTargets(activePower: CardPower, targets: CardTarget[]) {
    if (activePower.type === "swap" && targets.length === 2) {
      markSwapTargets(targets as [CardTarget, CardTarget]);
      dispatch({
        type: "resolve_power",
        choice: { type: "swap", targets: targets as [CardTarget, CardTarget] }
      });
      return;
    }

    if (activePower.type === "look_swap" && targets.length === 2) {
      markTargets(targets, "is-revealing");
      dispatch({
        type: "resolve_power",
        choice: {
          type: "look_swap",
          targets: targets as [CardTarget, CardTarget],
          swap: false
        }
      });
      return;
    }

    if (activePower.type === "self_look" || activePower.type === "look" || activePower.type === "universal_look") {
      markTargets(targets, "is-revealing");
      dispatch({
        type: "resolve_power",
        choice: { type: "reveal", targets }
      });
      return;
    }

    if (activePower.type === "burn" && targets.length > 0) {
      markTargets(targets, "is-burning");
      dispatch({
        type: "resolve_power",
        choice: { type: "burn", targets }
      });
    }
  }

  function finishViewedPower(shouldSwap = false) {
    if (!power) {
      return;
    }
    if (shouldSwap && power.type === "look_swap" && revealedTargets.length === 2) {
      markSwapTargets(revealedTargets as [CardTarget, CardTarget]);
      dispatch({
        type: "resolve_power",
        choice: {
          type: "look_swap",
          targets: revealedTargets as [CardTarget, CardTarget],
          swap: true
        }
      });
      return;
    }
    dispatch({ type: "resolve_power", choice: { type: "end_reveal" } });
  }

  return (
    <main className={tableScreenClass(session.table.theme)}>
      {latestEmote ? <div className="emote-overlay" aria-live="polite">{latestEmote.message.replace(/^.* played /, "")}</div> : null}

      <header className="table-topbar">
        <div>
          <p className="eyebrow">{isOnline ? "Online room" : "Local hotseat table"}</p>
          <h1>Jamio Table</h1>
        </div>
        <div className="topbar-cluster">
          {isOnline ? (
            <div className="connection-pill">
              <span>{session.connectionStatus ?? "connecting"}</span>
              <strong>{currentPlayer.name}</strong>
            </div>
          ) : (
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
          )}
          <RoomCodeBadge roomCode={session.table.roomCode} />
        </div>
      </header>

      {session.connectionError ? <div className="connection-error">{session.connectionError}</div> : null}

      <section className="table-layout">
        {isPinkTheme(session.table.theme) ? <HeartSprinkles seed={session.table.roomCode} /> : null}
        <div className="status-banner">
          <strong>{phaseCopy(view.phase)}</strong>
          <span>{latestTableAnnouncement(view) ?? statusCopy(view, currentPlayer.name)}</span>
        </div>

        <div className="opponent-strip">
          {view.opponentHands.map((hand) => {
            const player = view.players.find((candidate) => candidate.id === hand.playerId);
            return (
              <div className="opponent-seat" key={hand.playerId} ref={registerPlayerAreaElement(hand.playerId) as RefCallback<HTMLDivElement>}>
                <div className="seat-pill">
                  <span>{player?.name ?? hand.playerId}</span>
                  <strong>{player?.cardCount ?? 0} cards</strong>
                </div>
                <div className="mini-cards-grid" style={slotGridStyle(hand.cards)}>
                  {hand.cards.map((handCard) => {
                    const target = { playerId: hand.playerId, slotId: handCard.slotId };
                    const motion = targetMotions[targetKey(target)];
                    return (
                      <CardButton
                        key={handCard.slotId}
                        card={handCard.card}
                        empty={handCard.empty}
                        target={target}
                        selectable={isSelectable(mode, power, currentPlayerId, target)}
                        selected={isSelected(selectedTargets, target)}
                        motionClassName={motion?.className}
                        motionStyle={cardButtonStyle(handCard.slotId, motion?.style)}
                        targetRef={registerTargetElement(target)}
                        cardMotionRef={registerCardMotionElement(handCard.empty ? null : handCard.card)}
                        onClick={handleCardClick}
                        onTap={handleCardTap}
                      />
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>

        <div className="center-stacks" aria-label="table center">
          <button
            className={`stack deck-stack ${canDraw ? "is-actionable" : ""} ${stackMotion === "deck" ? "is-drawing" : ""}`}
            ref={registerStackElement("deck")}
            type="button"
            disabled={!canDraw}
            onClick={() => {
              setTemporaryStackMotion("deck");
              dispatch({ type: "draw_from_deck" });
            }}
          >
            <Card card={null} />
            <strong>Deck</strong>
            <span>{view.deckCount} cards</span>
          </button>
          <button
            className={`stack played-stack ${canTakeDiscard ? "is-actionable" : ""} ${stackMotion === "discard" ? "is-receiving" : ""}`}
            ref={registerStackElement("discard")}
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
          revealedTargets={revealedTargets}
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
          onFinishViewedPower={finishViewedPower}
          onAction={(action) => {
            if (action.type === "play_drawn_card") {
              setTemporaryStackMotion("discard");
            }
            dispatch(action);
          }}
        />

        <div className="player-hand" ref={registerPlayerAreaElement(currentPlayerId) as RefCallback<HTMLDivElement>}>
          <div className="hand-heading">
            <span>{currentPlayer.name}</span>
            <small>{modeCopy(mode, view.lastPlayedSeq)}</small>
          </div>
          <div className="cards-grid" style={slotGridStyle(view.yourHand)}>
            {view.yourHand.map((handCard) => {
              const target = { playerId: currentPlayerId, slotId: handCard.slotId };
              const motion = targetMotions[targetKey(target)];
              return (
                <CardButton
                  key={handCard.slotId}
                  card={handCard.card}
                  empty={handCard.empty}
                  target={target}
                  selectable={isSelectable(mode, power, currentPlayerId, target)}
                  selected={isSelected(selectedTargets, target)}
                  motionClassName={motion?.className}
                  motionStyle={cardButtonStyle(handCard.slotId, motion?.style)}
                  targetRef={registerTargetElement(target)}
                  cardMotionRef={registerCardMotionElement(handCard.empty ? null : handCard.card)}
                  onClick={handleCardClick}
                  onTap={handleCardTap}
                />
              );
            })}
          </div>
        </div>
      </section>

      {view.phase === "round_reveal" || view.phase === "game_over" ? (
        <RevealPanel view={view} hostPlayerId={view.hostPlayerId} currentPlayerId={currentPlayerId} onAction={dispatch} onRestartFromZero={onRestartFromZero} />
      ) : null}

      <Scoreboard view={view} />

      <button className="leave-button" type="button" onClick={onLeave}>
        Leave Table
      </button>

      <div className="card-flight-layer" aria-hidden="true">
        {flightMotions.map((flight) => (
          <div className={`card-flight ${flight.className}`} key={flight.id} style={flight.style}>
            <Card card={null} />
          </div>
        ))}
      </div>
    </main>
  );
}

type LobbyViewProps = {
  session: TableSession;
  view: PlayerView | null;
  currentPlayerId: PlayerId;
  onSwitchPlayer: (playerId: PlayerId) => void;
  onAddGuest: () => void;
  onStartGame: () => void;
  onLeave: () => void;
};

function LobbyView({ session, view, currentPlayerId, onSwitchPlayer, onAddGuest, onStartGame, onLeave }: LobbyViewProps) {
  const players = view?.players.map((player) => ({ id: player.id, name: player.name })) ?? session.players;
  const isOnline = session.kind === "online";
  const isHost = view ? view.hostPlayerId === currentPlayerId : currentPlayerId === session.players[0]?.id;
  const canStart = players.length >= 2 && isHost;
  return (
    <main className={tableScreenClass(session.table.theme)}>
      <header className="table-topbar">
        <div>
          <p className="eyebrow">{isOnline ? "Online lobby" : "Lobby"}</p>
          <h1>Jamio Table</h1>
        </div>
        <div className="topbar-cluster">
          {isOnline ? (
            <div className="connection-pill">
              <span>{session.connectionStatus ?? "connecting"}</span>
              <strong>{session.connectionError ? "Needs attention" : "Connected seat"}</strong>
            </div>
          ) : null}
          <RoomCodeBadge roomCode={session.table.roomCode} />
        </div>
      </header>
      {session.connectionError ? <div className="connection-error">{session.connectionError}</div> : null}
      <section className="lobby-card">
        <div className="panel-heading">
          <p className="eyebrow">Waiting table</p>
          <h2>Players</h2>
        </div>
        <div className="lobby-player-list">
          {players.map((player, index) => (
            <button
              className={`lobby-player ${currentPlayerId === player.id ? "is-current" : ""}`}
              key={player.id}
              type="button"
              onClick={() => {
                if (!isOnline) {
                  onSwitchPlayer(player.id);
                }
              }}
            >
              <span>{player.name}</span>
              <strong>{player.id === view?.hostPlayerId || (!view && index === 0) ? "Host" : "Seat"}</strong>
            </button>
          ))}
        </div>
        <div className="lobby-actions">
          {!isOnline ? (
            <button type="button" onClick={onAddGuest} disabled={session.players.length >= session.table.maxPlayers}>
              Add Local Guest
            </button>
          ) : null}
          <button type="button" onClick={onStartGame} disabled={!canStart}>
            Start Game
          </button>
          <button type="button" onClick={onLeave}>
            Leave
          </button>
        </div>
        {!canStart ? (
          <p className="muted-note">
            {isOnline
              ? isHost
                ? "Share the room code and wait for another player to join."
                : "Waiting for the host to start the game."
              : "Add a second local player to test a real round."}
          </p>
        ) : null}
      </section>
    </main>
  );
}

function tableScreenClass(theme: string): string {
  return `table-screen ${isPinkTheme(theme) ? "theme-pink" : "theme-classic"}`;
}

function isPinkTheme(theme: string): boolean {
  return theme === "pink";
}

type HeartSprinkle = {
  id: string;
  x: number;
  y: number;
  size: number;
  rotation: number;
  color: string;
  opacity: number;
};

const heartColors = ["#ff5ca8", "#ff8fc4", "#f83f92", "#ffbed9", "#d71b72", "#ffffff"];

function HeartSprinkles({ seed }: { seed: string }) {
  const hearts = useMemo(() => makeHeartSprinkles(seed), [seed]);
  return (
    <div className="heart-sprinkles" aria-hidden="true">
      {hearts.map((heart) => (
        <span
          className="heart-sprinkle"
          key={heart.id}
          style={
            {
              left: `${heart.x}%`,
              top: `${heart.y}%`,
              color: heart.color,
              fontSize: `${heart.size}px`,
              opacity: heart.opacity,
              transform: `rotate(${heart.rotation}deg)`
            } satisfies CSSProperties
          }
        >
          {"\u2665"}
        </span>
      ))}
    </div>
  );
}

function makeHeartSprinkles(seed: string): HeartSprinkle[] {
  const random = seededRandom(seed || "pink");
  return Array.from({ length: 34 }, (_, index) => ({
    id: `heart-${index}`,
    x: 3 + random() * 94,
    y: 4 + random() * 90,
    size: 14 + random() * 38,
    rotation: -22 + random() * 44,
    color: heartColors[Math.floor(random() * heartColors.length)]!,
    opacity: 0.14 + random() * 0.26
  }));
}

function seededRandom(seed: string): () => number {
  let state = 2166136261;
  for (let index = 0; index < seed.length; index += 1) {
    state ^= seed.charCodeAt(index);
    state = Math.imul(state, 16777619);
  }
  return () => {
    state += 0x6d2b79f5;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}

type ActionPanelProps = {
  view: PlayerView;
  mode: SelectionMode;
  power: CardPower | null;
  selectedTargets: CardTarget[];
  revealedTargets: CardTarget[];
  donateTargetId: PlayerId | null;
  currentPlayerId: PlayerId;
  canCallJamio: boolean;
  players: Player[];
  onModeChange: (mode: SelectionMode) => void;
  onDonateTargetChange: (playerId: PlayerId) => void;
  onFinishViewedPower: (swap?: boolean) => void;
  onAction: (action: GameAction) => void;
};

function ActionPanel({
  view,
  mode,
  power,
  selectedTargets,
  revealedTargets,
  donateTargetId,
  currentPlayerId,
  canCallJamio,
  players,
  onModeChange,
  onDonateTargetChange,
  onFinishViewedPower,
  onAction
}: ActionPanelProps) {
  const drawnCard = view.pendingPrompt?.type === "drawn_card_decision" ? view.pendingPrompt.card : null;
  const discardReward = view.pendingPrompt?.type === "discard_reward" ? view.pendingPrompt : null;
  const isViewingPower = Boolean(power && revealedTargets.length > 0);
  const canCancelSelection = mode === "replace_drawn" || mode === "take_discard";

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
          <strong>{powerInstruction(power, selectedTargets, revealedTargets)}</strong>
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
              <p>{donateTargetId ? "Tap your highlighted card to donate it." : "Choose who receives the donated card."}</p>
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
            </>
          ) : null}

          {isViewingPower ? (
            <div className="inline-actions">
              {power.type === "look_swap" ? (
                <button type="button" onClick={() => onFinishViewedPower(true)}>
                  Swap
                </button>
              ) : null}
              <button type="button" onClick={() => onFinishViewedPower(false)}>
                End Turn
              </button>
            </div>
          ) : null}
        </div>
      ) : null}

      {discardReward ? (
        <div className="power-panel">
          <strong>Tap one of your highlighted cards to donate it.</strong>
        </div>
      ) : null}

      <div className="inline-actions main-actions">
        <button type="button" disabled={!canCallJamio} onClick={() => onAction({ type: "call_jamio" })}>
          Call Jamio
        </button>
        {canCancelSelection ? (
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
  empty: boolean;
  target: CardTarget;
  selectable: boolean;
  selected: boolean;
  motionClassName?: string | undefined;
  motionStyle?: (CSSProperties & Partial<Record<"--move-x" | "--move-y", string>>) | undefined;
  targetRef: RefCallback<HTMLButtonElement>;
  cardMotionRef: RefCallback<HTMLButtonElement>;
  onClick: (target: CardTarget) => void;
  onTap: (target: CardTarget) => void;
};

function CardButton({
  card,
  empty,
  target,
  selectable,
  selected,
  motionClassName,
  motionStyle,
  targetRef,
  cardMotionRef,
  onClick,
  onTap
}: CardButtonProps) {
  return (
    <button
      ref={(node) => {
        targetRef(node);
        cardMotionRef(empty ? null : node);
      }}
      className={`card-button ${empty ? "is-empty-slot" : ""} ${selectable && !empty ? "is-selectable" : ""} ${selected ? "is-selected" : ""} ${motionClassName ?? ""}`}
      style={motionStyle}
      type="button"
      onClick={() => {
        if (empty) {
          return;
        }
        if (selectable) {
          onClick(target);
          return;
        }
        onTap(target);
      }}
    >
      {empty ? <span className="empty-card-slot" /> : <Card card={card} />}
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

function isTargetingPower(power: CardPower): boolean {
  return (
    power.type === "swap" ||
    power.type === "look_swap" ||
    power.type === "self_look" ||
    power.type === "look" ||
    power.type === "universal_look" ||
    power.type === "burn"
  );
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

function getRequiredTargetCount(power: CardPower, currentPlayerId: PlayerId, allTargets: CardTarget[]): number {
  if (power.type === "swap" || power.type === "look_swap") {
    return 2;
  }

  if (power.type === "donate") {
    return Math.min(power.count, allTargets.filter((target) => target.playerId === currentPlayerId).length);
  }

  const maxTargets = getPowerTargetCount(power);
  if (maxTargets === 0) {
    return 0;
  }
  const validTargets = allTargets.filter((target) => isValidPowerTarget(power, target, currentPlayerId)).length;
  return Math.min(maxTargets, validTargets);
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

function getAllCardTargets(view: PlayerView | null, currentPlayerId: PlayerId): CardTarget[] {
  if (!view) {
    return [];
  }
  return [
    ...view.yourHand.filter((card) => !card.empty).map((card) => ({ playerId: currentPlayerId, slotId: card.slotId })),
    ...view.opponentHands.flatMap((hand) =>
      hand.cards.filter((card) => !card.empty).map((card) => ({ playerId: hand.playerId, slotId: card.slotId }))
    )
  ];
}

function slotGridStyle(cards: Array<{ slotId: string }>): CSSProperties {
  const columns = Math.max(1, ...cards.map((card) => slotGridPosition(slotIndexFromId(card.slotId)).column));
  return {
    gridTemplateColumns: `repeat(${columns}, minmax(0, max-content))`,
    gridTemplateRows: "repeat(2, auto)"
  };
}

function cardButtonStyle(
  slotId: string,
  motionStyle?: CSSProperties & Partial<Record<"--move-x" | "--move-y", string>>
): CSSProperties & Partial<Record<"--move-x" | "--move-y", string>> {
  const position = slotGridPosition(slotIndexFromId(slotId));
  return {
    gridColumn: position.column,
    gridRow: position.row,
    ...motionStyle
  };
}

function slotGridPosition(slotIndex: number): { row: number; column: number } {
  if (slotIndex < 4) {
    return {
      row: slotIndex < 2 ? 1 : 2,
      column: (slotIndex % 2) + 1
    };
  }
  const extraIndex = slotIndex - 4;
  return {
    row: (extraIndex % 2) + 1,
    column: 3 + Math.floor(extraIndex / 2)
  };
}

function slotIndexFromId(slotId: string): number {
  const match = /-s(\d+)$/.exec(slotId);
  return match ? Number(match[1]) : 0;
}

function targetKey(target: CardTarget): string {
  return `${target.playerId}:${target.slotId}`;
}

function eventTargets(event: GameEvent): CardTarget[] {
  if (event.targets?.length) {
    return event.targets;
  }
  return event.target ? [event.target] : [];
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

function powerInstruction(power: CardPower, selectedTargets: CardTarget[], revealedTargets: CardTarget[]): string {
  if (revealedTargets.length > 0) {
    if (power.type === "look_swap") {
      return "Cards are revealed. Swap them or end your turn.";
    }
    return "Cards are revealed. Memorize them, then end your turn.";
  }

  const remaining = Math.max(0, getPowerTargetCount(power) - selectedTargets.length);
  switch (power.type) {
    case "swap":
      return remaining === 1 ? "Tap one more highlighted card to swap." : "Tap two highlighted cards to swap.";
    case "look_swap":
      return remaining === 1 ? "Tap one more highlighted card to reveal." : "Tap two highlighted cards to reveal.";
    case "self_look":
      return "Tap one highlighted card to look at it.";
    case "look":
      return "Tap one opponent card to look at it.";
    case "universal_look": {
      const count = remaining || power.count;
      return `Tap ${count} highlighted card${count === 1 ? "" : "s"} to look.`;
    }
    case "give":
      return "Choose who receives the drawn card.";
    case "donate":
      return "Choose a player, then tap a highlighted card to donate.";
    case "burn": {
      const count = remaining || power.count;
      return `Tap ${count} highlighted card${count === 1 ? "" : "s"} to burn.`;
    }
    case "draw":
      return "Drawing extra card.";
    case "emote":
      return "Emote played.";
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

function latestTableAnnouncement(view: PlayerView): string | null {
  const announcementTypes = new Set([
    "draw",
    "play_card",
    "replace_card",
    "power_pending",
    "power_reveal",
    "swap_cards",
    "power_draw",
    "power_give",
    "power_donate",
    "discard_reward",
    "penalty_draw",
    "burn_cards"
  ]);
  return [...view.eventLog].reverse().find((event) => announcementTypes.has(event.type))?.message ?? null;
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
