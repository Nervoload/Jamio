import type { PlayerView } from "@jamio/game-core";

type ScoreboardProps = {
  view: PlayerView;
};

export function Scoreboard({ view }: ScoreboardProps) {
  return (
    <aside className="scoreboard">
      <strong>Scoreboard</strong>
      {view.players.map((player) => (
        <div className="score-row" key={player.id}>
          <span>{player.name}</span>
          <b>{view.scores[player.id] ?? 0}</b>
        </div>
      ))}
    </aside>
  );
}
