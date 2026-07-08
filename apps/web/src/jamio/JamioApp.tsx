import { useEffect, useMemo, useState } from "react";
import {
  applyAction,
  createInitialRound,
  getPlayerView,
  jamioDefaultRuleset,
  type GameAction,
  type GameState,
  type Player,
  type PlayerId,
  type PlayerView
} from "@jamio/game-core";
import { clearLastSeat, createRoom, joinRoom, loadLastSeat, saveSeat } from "./api/jamioClient";
import { useJamioSocket } from "./hooks/useJamioSocket";
import { CreateTableView, type CreatedTable } from "./routes/CreateTableView";
import { JamioHome, type HomePanel } from "./routes/JamioHome";
import { JoinTableView, type JoinedTable } from "./routes/JoinTableView";
import { RulesView } from "./routes/RulesView";
import { TableView } from "./routes/TableView";

type Screen = "home" | "table";

type LocalSession = {
  kind: "local";
  table: CreatedTable;
  players: Player[];
  state: GameState | null;
  currentPlayerId: PlayerId;
};

type OnlineSession = {
  kind: "online";
  table: CreatedTable;
  players: Player[];
  playerId: PlayerId;
  playerToken: string;
  currentPlayerId: PlayerId;
};

type JamioSession = LocalSession | OnlineSession;

export function JamioApp() {
  const [screen, setScreen] = useState<Screen>(() => (loadLastSeat() ? "table" : "home"));
  const [activePanel, setActivePanel] = useState<HomePanel>("none");
  const [session, setSession] = useState<JamioSession | null>(() => restoreOnlineSession());
  const socket = useJamioSocket(
    session?.kind === "online"
      ? {
          roomCode: session.table.roomCode,
          playerToken: session.playerToken
        }
      : null
  );

  const localView: PlayerView | null = useMemo(() => {
    if (session?.kind !== "local" || !session.state) {
      return null;
    }
    return getPlayerView(session.state, session.currentPlayerId);
  }, [session]);

  const currentView = session?.kind === "online" ? socket.view : localView;

  useEffect(() => {
    if (session?.kind !== "local" || !session.state) {
      return;
    }

    if (session.state.phase === "initial_countdown") {
      const timeout = window.setTimeout(() => {
        setSession((current) => {
          if (current?.kind !== "local" || !current.state || current.state.phase !== "initial_countdown") {
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
          if (current?.kind !== "local" || !current.state || current.state.phase !== "initial_memorize") {
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
  }, [session?.kind, session?.kind === "local" ? session.state?.phase : null, session?.kind === "local" ? session.state?.version : null]);

  async function handleCreateOnline(table: CreatedTable) {
    const response = await createRoom(table);
    saveSeat({
      roomCode: response.roomCode,
      playerId: response.playerId,
      playerToken: response.playerToken,
      name: table.name,
      theme: response.theme
    });
    setSession({
      kind: "online",
      table: {
        ...table,
        roomCode: response.roomCode,
        theme: response.theme
      },
      players: [{ id: response.playerId, name: table.name }],
      playerId: response.playerId,
      playerToken: response.playerToken,
      currentPlayerId: response.playerId
    });
    setScreen("table");
    setActivePanel("none");
  }

  function handlePracticeLocal(table: CreatedTable) {
    setSession({
      kind: "local",
      table,
      players: [{ id: "player-1", name: table.name }],
      state: null,
      currentPlayerId: "player-1"
    });
    setScreen("table");
    setActivePanel("none");
  }

  async function handleJoinOnline(table: JoinedTable) {
    const response = await joinRoom(table);
    saveSeat({
      roomCode: response.roomCode,
      playerId: response.playerId,
      playerToken: response.playerToken,
      name: table.name,
      theme: response.theme
    });
    setSession({
      kind: "online",
      table: {
        name: table.name,
        roomCode: response.roomCode,
        maxPlayers: 10,
        ruleset: JSON.parse(JSON.stringify(jamioDefaultRuleset)) as typeof jamioDefaultRuleset,
        theme: response.theme
      },
      players: [{ id: response.playerId, name: table.name }],
      playerId: response.playerId,
      playerToken: response.playerToken,
      currentPlayerId: response.playerId
    });
    setScreen("table");
    setActivePanel("none");
  }

  function handleAddGuest() {
    setSession((current) => {
      if (!current || current.kind !== "local" || current.players.length >= current.table.maxPlayers || current.state) {
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
      if (!current || current.kind !== "local") {
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
    if (session?.kind === "online") {
      socket.sendGameAction(action);
      return;
    }
    setSession((current) => {
      if (!current || current.kind !== "local" || !current.state) {
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
    if (session?.kind === "online") {
      socket.sendGameAction({ type: "restart_game" });
      return;
    }
    setSession((current) => {
      if (!current || current.kind !== "local") {
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
    const players =
      session.kind === "online" && currentView
        ? currentView.players.map((player) => ({ id: player.id, name: player.name }))
        : session.players;
    const currentPlayerId = session.kind === "online" ? session.playerId : session.currentPlayerId;

    return (
      <TableView
        session={{
          ...session,
          players,
          currentPlayerId,
          connectionStatus: session.kind === "online" ? socket.status : null,
          connectionError: session.kind === "online" ? socket.error : null
        }}
        view={currentView}
        currentPlayerId={currentPlayerId}
        onSwitchPlayer={(playerId) =>
          setSession((current) => (current?.kind === "local" ? { ...current, currentPlayerId: playerId } : current))
        }
        onAddGuest={handleAddGuest}
        onStartGame={() => {
          if (session.kind === "online") {
            socket.sendGameAction({ type: "start_game", players });
          } else {
            handleStartGame();
          }
        }}
        onAction={handleAction}
        onRestartFromZero={handleRestartFromZero}
        onLeave={() => {
          if (session.kind === "online") {
            clearLastSeat();
          }
          setSession(null);
          setScreen("home");
          setActivePanel("none");
        }}
      />
    );
  }

  return (
    <JamioHome activePanel={activePanel} onPanelChange={setActivePanel}>
      {activePanel === "create" ? (
        <CreateTableView
          onCreate={handleCreateOnline}
          onPracticeLocal={handlePracticeLocal}
          onBack={() => setActivePanel("none")}
        />
      ) : null}
      {activePanel === "join" ? <JoinTableView onJoin={handleJoinOnline} onBack={() => setActivePanel("none")} /> : null}
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

function restoreOnlineSession(): OnlineSession | null {
  const seat = loadLastSeat();
  if (!seat) {
    return null;
  }
  return {
    kind: "online",
    table: {
      name: seat.name,
      roomCode: seat.roomCode,
      maxPlayers: 10,
      ruleset: JSON.parse(JSON.stringify(jamioDefaultRuleset)) as typeof jamioDefaultRuleset,
      theme: seat.theme ?? "classic"
    },
    players: [{ id: seat.playerId, name: seat.name }],
    playerId: seat.playerId,
    playerToken: seat.playerToken,
    currentPlayerId: seat.playerId
  };
}
