type RulesViewProps = {
  onBack: () => void;
};

export function RulesView({ onBack }: RulesViewProps) {
  return (
    <section className="menu-panel rules-copy">
      <button className="back-button" type="button" onClick={onBack}>
        Back
      </button>
      <div className="panel-heading">
        <p className="eyebrow">Basic Jamio rules</p>
        <h2>Lowest hand wins</h2>
      </div>
      <p>
        Draw from the deck, play immediately for a power, or replace one of your hidden cards. You can also take the top
        played card and swap it into your hand.
      </p>
      <p>
        When a card is played, the discard window opens. If you remember a matching hidden card, double tap it before
        the next card is played. Correct own discards remove your card; correct opponent discards earn a donation choice.
      </p>
      <p>
        Call Jamio on your turn when you think you have the lowest score. Everyone else gets one last turn, then all
        cards reveal and the round scores are added to the table totals.
      </p>
    </section>
  );
}
