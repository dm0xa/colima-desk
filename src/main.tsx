import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";

// The desktop shell has no use for WebKit's page menu ("Reload", "Inspect Element");
// right-click on chrome should do nothing.
window.addEventListener("contextmenu", (event) => event.preventDefault(), { capture: true });

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
