import React from "react";
import ReactDOM from "react-dom/client";
import "@fontsource-variable/fraunces";
import "@fontsource-variable/manrope";
import { MotionConfig } from "framer-motion";
import App from "./App";
import { applyTheme, getTheme } from "./lib/theme";

// Before first paint, to avoid a flash of the wrong theme
applyTheme(getTheme());

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <MotionConfig reducedMotion="user">
      <App />
    </MotionConfig>
  </React.StrictMode>,
);
