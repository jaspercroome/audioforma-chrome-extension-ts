import { createRoot } from "react-dom/client";
import React from "react";
import { Visual } from "./utils/Visual";

const initializeAudioForma = () => {
  // Wait for video element to exist
  const videoElement = document.querySelector("video");
  if (!videoElement) {
    setTimeout(initializeAudioForma, 1000);
    return;
  }

  // Create overlay container
  const overlay = document.createElement("div");
  overlay.id = "audioforma-overlay";
  overlay.style.position = "absolute";
  overlay.style.top = "0";
  overlay.style.left = "0";
  overlay.style.pointerEvents = "none";
  overlay.style.zIndex = "1000";

  // Insert overlay next to video
  videoElement.parentElement?.appendChild(overlay);

  // Render Visual component
  const root = createRoot(overlay);
  root.render(
    <React.StrictMode>
      <>
        <Visual videoElement={videoElement} />
        <div
          id="audioforma-controls"
          style={{
            position: "absolute",
            bottom: "20px",
            left: "50%",
            transform: "translateX(-50%)",
            background: "rgba(0, 0, 0, 0.7)",
            color: "white",
            padding: "8px 12px",
            borderRadius: "4px",
            fontSize: "14px",
            pointerEvents: "none",
            zIndex: "1000",
          }}
        >
          Press Cmd/Ctrl + H to toggle visual
        </div>
      </>
    </React.StrictMode>
  );

  // Cleanup when navigating away
  const cleanup = () => {
    root.unmount();
    overlay.remove();
  };

  // Listen for navigation events
  const observer = new MutationObserver((mutations) => {
    if (!document.querySelector("video")) {
      cleanup();
      observer.disconnect();
    }
  });

  observer.observe(document.body, {
    childList: true,
    subtree: true,
  });
};

// Start initialization when page loads
initializeAudioForma();
