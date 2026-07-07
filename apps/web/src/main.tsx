import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { JamioApp } from "./jamio/JamioApp";
import "./jamio/styles/jamio.css";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <JamioApp />
  </StrictMode>
);
