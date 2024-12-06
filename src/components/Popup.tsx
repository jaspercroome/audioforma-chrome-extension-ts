import React from "react";
import { createRoot } from "react-dom/client";

const toggleVisualWindow = () => {
  chrome.runtime.sendMessage({ type: "toggle-visual" });
};

const Popup = () => {
  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        alignItems: " center",
        gap: "8px",
        color: "#666666",
      }}
    >
      <div>
        <span>Press</span>
        <kbd>cmd/ctrl</kbd>+<kbd>shift</kbd>+<kbd>U</kbd>
        <span>,</span>
      </div>
      <span>or click below to toggle the visualizer manually.</span>
      <button onClick={toggleVisualWindow}>Toggle Visualizer</button>
    </div>
  );
};

const root = createRoot(document.getElementById("root")!);

root.render(
  <React.StrictMode>
    <Popup />
  </React.StrictMode>
);
