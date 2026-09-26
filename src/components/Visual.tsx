import React, { useMemo } from "react";
import { useTabCapture } from "../audio/useTabCapture";
import { VisualStage } from "./VisualStage";

/** Tab ID of the page being visualised, passed in the window URL by the background worker. */
const getSourceTabId = () => {
  const value = new URLSearchParams(window.location.search).get("tabId");
  const tabId = value === null ? NaN : Number(value);
  return Number.isInteger(tabId) ? tabId : undefined;
};

export const Visual = () => {
  const tabId = useMemo(getSourceTabId, []);
  const { captured, error } = useTabCapture(tabId);
  const audio = useMemo(
    () => (captured ? { context: captured.context, source: captured.source } : null),
    [captured]
  );

  return (
    <>
      <VisualStage audio={audio} backgroundStream={captured?.stream} />
      {(error || tabId === undefined) && (
        <div
          style={{
            position: "absolute",
            left: 16,
            right: 16,
            bottom: 16,
            zIndex: 2000,
            color: "#e5e7eb",
            font: "13px system-ui, sans-serif",
            background: "rgba(0,0,0,0.6)",
            padding: "8px 12px",
            borderRadius: 6,
          }}
        >
          {tabId === undefined
            ? "Open the visualizer from a tab with the shortcut or the toolbar button."
            : `Couldn't capture this tab's audio: ${error}`}
        </div>
      )}
    </>
  );
};
