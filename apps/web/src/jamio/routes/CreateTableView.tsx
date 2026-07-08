import { useMemo, useState } from "react";
import { jamioDefaultRuleset, validateRulesetForPlayers, type Ruleset } from "@jamio/game-core";
import { RulesEditor } from "../components/RulesEditor";
import { RoomCodeBadge } from "../components/RoomCodeBadge";
import { useRoomCodeAvailability } from "../hooks/useRoomCodeAvailability";

export type CreatedTable = {
  name: string;
  roomCode: string;
  maxPlayers: number;
  ruleset: Ruleset;
  theme: string;
};

type CreateTableViewProps = {
  onCreate: (table: CreatedTable) => Promise<void> | void;
  onPracticeLocal: (table: CreatedTable) => void;
  onBack: () => void;
};

const roomCodeAlphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

export function CreateTableView({ onCreate, onPracticeLocal, onBack }: CreateTableViewProps) {
  const [name, setName] = useState("");
  const [maxPlayers, setMaxPlayers] = useState(2);
  const [roomCode, setRoomCode] = useState(() => generateRoomCode());
  const [ruleset, setRuleset] = useState<Ruleset>(() => JSON.parse(JSON.stringify(jamioDefaultRuleset)) as Ruleset);
  const [theme, setTheme] = useState("classic");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const availability = useRoomCodeAvailability(roomCode);

  const validation = useMemo(() => {
    try {
      validateRulesetForPlayers(ruleset, maxPlayers);
      return null;
    } catch (error) {
      return error instanceof Error ? error.message : "Invalid table settings";
    }
  }, [ruleset, maxPlayers]);

  const canCreate = name.trim().length > 0 && roomCode.trim().length >= 3 && !validation && availability.status !== "taken";

  const table = useMemo(
    () => ({
      name: name.trim(),
      roomCode: roomCode.trim().toUpperCase(),
      maxPlayers,
      ruleset,
      theme
    }),
    [maxPlayers, name, roomCode, ruleset, theme]
  );

  return (
    <form
      className="menu-panel create-panel"
      onSubmit={async (event) => {
        event.preventDefault();
        if (!canCreate) {
          return;
        }
        setIsSubmitting(true);
        setSubmitError(null);
        try {
          await onCreate(table);
        } catch (error) {
          setSubmitError(error instanceof Error ? error.message : "Could not create the online table.");
        } finally {
          setIsSubmitting(false);
        }
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
            <option value="pink">Pink hearts</option>
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
        <span className={`availability-text is-${availability.status}`}>{availability.message}</span>
      </div>

      <RulesEditor ruleset={ruleset} maxPlayers={maxPlayers} onChange={setRuleset} />

      {validation ? <p className="form-error">{validation}</p> : null}
      {submitError ? <p className="form-error">{submitError}</p> : null}

      <div className="form-actions">
        <button className="submit-button" type="submit" disabled={!canCreate || isSubmitting}>
          {isSubmitting ? "Creating..." : "Create Online Table"}
        </button>
        <button className="secondary-submit-button" type="button" disabled={!canCreate} onClick={() => onPracticeLocal(table)}>
          Practice Locally
        </button>
      </div>
    </form>
  );
}

function generateRoomCode(): string {
  return Array.from({ length: 6 }, () => roomCodeAlphabet[Math.floor(Math.random() * roomCodeAlphabet.length)]).join("");
}
