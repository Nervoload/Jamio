import { useMemo, useState } from "react";
import { jamioDefaultRuleset, validateRulesetForPlayers, type Ruleset } from "@jamio/game-core";
import { RulesEditor } from "../components/RulesEditor";
import { RoomCodeBadge } from "../components/RoomCodeBadge";

export type CreatedTable = {
  name: string;
  roomCode: string;
  maxPlayers: number;
  ruleset: Ruleset;
  theme: string;
};

type CreateTableViewProps = {
  onCreate: (table: CreatedTable) => void;
  onBack: () => void;
};

const roomCodeAlphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

export function CreateTableView({ onCreate, onBack }: CreateTableViewProps) {
  const [name, setName] = useState("");
  const [maxPlayers, setMaxPlayers] = useState(2);
  const [roomCode, setRoomCode] = useState(() => generateRoomCode());
  const [ruleset, setRuleset] = useState<Ruleset>(() => JSON.parse(JSON.stringify(jamioDefaultRuleset)) as Ruleset);
  const [theme, setTheme] = useState("classic");

  const validation = useMemo(() => {
    try {
      validateRulesetForPlayers(ruleset, maxPlayers);
      return null;
    } catch (error) {
      return error instanceof Error ? error.message : "Invalid table settings";
    }
  }, [ruleset, maxPlayers]);

  const canCreate = name.trim().length > 0 && roomCode.trim().length >= 3 && !validation;

  return (
    <form
      className="menu-panel create-panel"
      onSubmit={(event) => {
        event.preventDefault();
        if (!canCreate) {
          return;
        }
        onCreate({
          name: name.trim(),
          roomCode: roomCode.trim().toUpperCase(),
          maxPlayers,
          ruleset,
          theme
        });
      }}
    >
      <button className="back-button" type="button" onClick={onBack}>
        Back
      </button>

      <div className="panel-heading">
        <p className="eyebrow">Create a private table</p>
        <h2>Set the room</h2>
      </div>

      <label className="field">
        <span>Your Name</span>
        <input value={name} onChange={(event) => setName(event.target.value)} maxLength={32} placeholder="John" />
      </label>

      <div className="field-row">
        <label className="field">
          <span>Max Players</span>
          <select value={maxPlayers} onChange={(event) => setMaxPlayers(Number(event.target.value))}>
            {Array.from({ length: 10 }, (_, index) => index + 1).map((value) => (
              <option key={value} value={value}>
                {value}
              </option>
            ))}
          </select>
        </label>

        <label className="field">
          <span>Table Theme</span>
          <select value={theme} onChange={(event) => setTheme(event.target.value)}>
            <option value="classic">Classic felt</option>
            <option value="moonlit" disabled>
              Moonlit later
            </option>
            <option value="garden" disabled>
              Garden later
            </option>
          </select>
        </label>
      </div>

      <label className="field room-code-field">
        <span>Room Code</span>
        <input
          value={roomCode}
          onChange={(event) => setRoomCode(event.target.value.toUpperCase().replace(/[^A-Z0-9-]/g, ""))}
          maxLength={12}
          aria-describedby="room-code-status"
        />
      </label>
      <div id="room-code-status" className="availability-row">
        <RoomCodeBadge roomCode={roomCode || "ROOM"} />
        <span>Availability check will use the room server; local preview treats this as available.</span>
      </div>

      <RulesEditor ruleset={ruleset} maxPlayers={maxPlayers} onChange={setRuleset} />

      {validation ? <p className="form-error">{validation}</p> : null}

      <button className="submit-button" type="submit" disabled={!canCreate}>
        Create Table
      </button>
    </form>
  );
}

function generateRoomCode(): string {
  return Array.from({ length: 6 }, () => roomCodeAlphabet[Math.floor(Math.random() * roomCodeAlphabet.length)]).join("");
}
