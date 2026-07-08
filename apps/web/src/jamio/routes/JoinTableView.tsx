import { useState } from "react";

export type JoinedTable = {
  name: string;
  roomCode: string;
};

type JoinTableViewProps = {
  onJoin: (table: JoinedTable) => Promise<void> | void;
  onBack: () => void;
};

export function JoinTableView({ onJoin, onBack }: JoinTableViewProps) {
  const [name, setName] = useState("");
  const [roomCode, setRoomCode] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const canJoin = name.trim().length > 0 && roomCode.trim().length >= 3;

  return (
    <form
      className="menu-panel"
      onSubmit={async (event) => {
        event.preventDefault();
        if (!canJoin) {
          return;
        }
        setIsSubmitting(true);
        setSubmitError(null);
        try {
          await onJoin({
            name: name.trim(),
            roomCode: roomCode.trim().toUpperCase()
          });
        } catch (error) {
          setSubmitError(error instanceof Error ? error.message : "Could not join that room.");
        } finally {
          setIsSubmitting(false);
        }
      }}
    >
      <button className="back-button" type="button" onClick={onBack}>
        Back
      </button>
      <div className="panel-heading">
        <p className="eyebrow">Join a private table</p>
        <h2>Enter the code</h2>
      </div>
      <label className="field">
        <span>Your Name</span>
        <input value={name} onChange={(event) => setName(event.target.value)} placeholder="Guest" maxLength={32} />
      </label>
      <label className="field room-code-field">
        <span>Room Code</span>
        <input
          value={roomCode}
          onChange={(event) => setRoomCode(event.target.value.toUpperCase().replace(/[^A-Z0-9-]/g, ""))}
          placeholder="J7KQ2M"
          maxLength={12}
        />
      </label>
      {submitError ? <p className="form-error">{submitError}</p> : null}
      <button className="submit-button" type="submit" disabled={!canJoin || isSubmitting}>
        {isSubmitting ? "Joining..." : "Join Table"}
      </button>
      <p className="muted-note">The room code is public. Your private seat token is stored locally for reconnects.</p>
    </form>
  );
}
