import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App.js";
import { initI18n } from "./i18n.js";
import "./styles.css";
import { applyTheme, readTheme } from "./theme.js";

const host = document.getElementById("root");
if (!host) throw new Error("orca panel: #root is missing from index.html");
let storage: Storage | undefined;
try {
  storage = window.localStorage;
} catch {
  storage = undefined;
}
initI18n();
applyTheme(document.documentElement, readTheme(storage));
createRoot(host).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
