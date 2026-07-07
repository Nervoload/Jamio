import { useEffect, useMemo, useState } from "react";
import {
  applyAction,
  createInitialRound,
  getPlayerView,
  type GameAction,
  type GameState,
  type Player,
  type PlayerId,
  type PlayerView
} from "@jamio/game-core";
import { CreateTableView, type CreatedTable } from "./routes/CreateTableView";
import { JamioHome, type HomePanel } from "./routes/JamioHome";
import { JoinTableView } from "./routes/JoinTableView";
import { RulesView } from "./routes/RulesView";
import { TableView } from "./routes/TableView";

type Screen = "home" | "table";

type LocalSession = {
  table: CreatedTable;
  players: Player[];
  state: GameState | null;
  currentPlayerId: PlayerId;
};

export function JamioApp() {
  const [screen, setScreen] = useState<Screen>("home");
  const [activePanel, setActivePanel] = useState<HomePanel>("none");
  const [session, setSession] = useState<LocalSession | null>(null);

  const previewView: PlayerView | null = useMemo(() => {
    if (!session?.state) {
      return null;
    }
    return getPlayerView(session.state, session.currentPlayerId);
  }, [session]);

  useEffect(() => {
    if (!session?.state) {
      return;
    }

    if (session.state.phase === "initial_countdown") {
      const timeout = window.setTimeout(() => {
        setSession((current) => {
          if (!current?.state || current.state.phase !== "initial_countdown") {
            return current;
          }
          return {
            ...current,
            state: {
              ...current.state,
              phase: "initial_memorize",
              version: current.state.version + 1
            }
          };
        });
      }, 3000);
      return () => window.clearTimeout(timeout);
    }

    if (session.state.phase === "initial_memorize") {
      const timeout = window.setTimeout(() => {
        setSession((current) => {
          if (!current?.state || current.state.phase !== "initial_memorize") {
            return current;
          }
          return {
            ...current,
            currentPlayerId: current.state.currentTurnPlayerId ?? current.currentPlayerId,
            state: {
              ...current.state,
              phase: current.state.jamio ? "jamio_final_cycle" : "turn_idle",
              version: current.state.version + 1
            }
          };
        });
      }, 5000);
      return () => window.clearTimeout(timeout);
    }
  }, [session?.state?.phase, session?.state?.version]);

  function handleCreate(table: CreatedTable) {
    setSession({
      table,
      players: [{ id: "player-1", name: table.name }],
      state: null,
      currentPlayerId: "player-1"
    });
    setScreen("table");
  }

  function handleAddGuest() {
    setSession((current) => {
      if (!current || current.players.length >= current.table.maxPlayers || current.state) {
        return current;
      }
      const nextNumber = current.players.length + 1;
      const player: Player = {
        id: `player-${nextNumber}`,
        name: nextNumber === 2 ? "Guest" : `Guest ${nextNumber - 1}`
      };
      return {
        ...current,
        players: [...current.players, player]
      };
    });
  }

  function handleStartGame() {
    setSession((current) => {
      if (!current) {
        return current;
      }
      const state = createInitialRound(current.players, current.table.ruleset, `${current.table.roomCode}-${Date.now()}`, {
        roomId: current.table.roomCode,
        hostPlayerId: current.players[0]!.id
      });
      return {
        ...current,
        currentPlayerId: current.players[0]!.id,
        state: {
          ...state,
          phase: "initial_countdown"
        }
      };
    });
  }

  function handleAction(action: GameAction) {
    setSession((current) => {
      if (!current?.state) {
        return current;
      }
      const result = applyAction(current.state, current.currentPlayerId, action);
      const nextState =
        action.type === "start_next_round"
          ? {
              ...result.state,
              phase: "initial_countdown" as const
            }
          : result.state;
      return {
        ...current,
        currentPlayerId: chooseViewer(nextState, current.currentPlayerId),
        state: nextState
      };
    });
  }

  function handleRestartFromZero() {
    setSession((current) => {
      if (!current) {
        return current;
      }
      return {
        ...current,
        state: null,
        currentPlayerId: current.players[0]?.id ?? current.currentPlayerId
      };
    });
  }

  if (screen === "table" && session) {
    return (
      <TableView
        session={session}
        view={previewView}
        currentPlayerId={session.currentPlayerId}
        onSwitchPlayer={(playerId) => setSession((current) => (current ? { ...current, currentPlayerId: playerId } : current))}
        onAddGuest={handleAddGuest}
        onStartGame={handleStartGame}
        onAction={handleAction}
        onRestartFromZero={handleRestartFromZero}
        onLeave={() => {
          setScreen("home");
          setActivePanel("none");
        }}
      />
    );
  }

  return (
    <JamioHome activePanel={activePanel} onPanelChange={setActivePanel}>
      {activePanel === "create" ? <CreateTableView onCreate={handleCreate} onBack={() => setActivePanel("none")} /> : null}
      {activePanel === "join" ? <JoinTableView onBack={() => setActivePanel("none")} /> : null}
      {activePanel === "rules" ? <RulesView onBack={() => setActivePanel("none")} /> : null}
    </JamioHome>
  );
}

function chooseViewer(state: GameState, fallback: PlayerId): PlayerId {
  return (
    state.pendingPower?.actorId ??
    state.pendingDiscardReward?.actorId ??
    state.drawnCard?.drawnBy ??
    state.currentTurnPlayerId ??
    fallback
  );
}
