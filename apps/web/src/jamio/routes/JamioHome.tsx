import type { ReactNode } from "react";

export type HomePanel = "none" | "create" | "join" | "rules";

type JamioHomeProps = {
  activePanel: HomePanel;
  onPanelChange: (panel: HomePanel) => void;
  children: ReactNode;
};

export function JamioHome({ activePanel, onPanelChange, children }: JamioHomeProps) {
  const isExpanded = activePanel !== "none";

  return (
    <main className="jamio-home">
      <section className={`home-shell ${isExpanded ? "is-expanded" : ""}`}>
        <div className="home-heading">
          <p className="eyebrow">Long-distance card night</p>
          <h1>Jamio</h1>
          <p className="home-subtitle">A realtime Cambio-inspired table built for two phones, one room code, and a little memory.</p>
        </div>

        {!isExpanded ? (
          <div className="home-actions" aria-label="Jamio menu">
            <button className="primary-tile" type="button" onClick={() => onPanelChange("create")}>
              <span>Create a Table</span>
              <small>Host a private room</small>
            </button>
            <button className="secondary-tile" type="button" onClick={() => onPanelChange("join")}>
              <span>Join a Table</span>
              <small>Enter a room code</small>
            </button>
            <button className="secondary-tile" type="button" onClick={() => onPanelChange("rules")}>
              <span>Rules</span>
              <small>Learn the Jamio flow</small>
            </button>
          </div>
        ) : (
          <div className="expanded-panel">{children}</div>
        )}
      </section>
    </main>
  );
}
