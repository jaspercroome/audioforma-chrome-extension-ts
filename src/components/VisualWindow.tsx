import React from "react";
import { Visual } from "./Visual";
import { createRoot } from "react-dom/client";

export const VisualWindow = () => {
  // Create root container
  const rootContainer = document.createElement("div");
  rootContainer.setAttribute("id", "visual-container");
  document.body.appendChild(rootContainer);

  // Create and render root
  const root = createRoot(rootContainer);
  root.render(<Visual />);

  // Signal that the window is ready
  chrome.runtime.sendMessage({ type: "VISUAL_WINDOW_READY" });
};

// Initialize the visual window
VisualWindow();
