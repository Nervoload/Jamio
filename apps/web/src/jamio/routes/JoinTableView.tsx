type JoinTableViewProps = {
  onBack: () => void;
};

export function JoinTableView({ onBack }: JoinTableViewProps) {
  return (
    <section className="menu-panel">
      <button className="back-button" type="button" onClick={onBack}>
        Back
      </button>
      <div className="panel-heading">
        <p className="eyebrow">Join a private table</p>
        <h2>Enter the code</h2>
      </div>
      <label className="field">
        <span>Your Name</span>
        <input placeholder="Guest" disabled />
      </label>
      <label className="field room-code-field">
        <span>Room Code</span>
        <input placeholder="J7KQ2M" disabled />
      </label>
      <button className="submit-button" type="button" disabled>
        Join Table
      </button>
      <p className="muted-note">Joining connects once the Worker room API is enabled.</p>
    </section>
  );
}
