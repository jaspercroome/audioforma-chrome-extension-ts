import React from "react";
import { Visual } from "./Visual";
import { createRoot } from "react-dom/client";

export const VisualWindow = () => {
  const rootContainer = document.createElement("div");
  rootContainer.setAttribute("id", "visual-container");
  document.body.appendChild(rootContainer);

  const root = createRoot(rootContainer);
  root.render(<Visual />);
};

VisualWindow();
