import {
  interpolateCool,
  interpolateCubehelixDefault,
  interpolateInferno,
  interpolatePurples,
  interpolateWarm,
} from "d3-scale-chromatic";
import React, { useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import { ColorScale } from "../utils/colors";

const toggleVisualWindow = () => {
  chrome.runtime.sendMessage({ type: "toggle-visual" });
};

const Popup = () => {
  const colorBars = new Array(40).fill(1).map((v, i) => (i + 1) / 40);
  const scaleOptions: Array<{
    name: ColorScale;
    scale: (t: number) => string;
  }> = [
    { name: "Rainbow - Cool", scale: interpolateCool },
    { name: "Rainbow - Warm", scale: interpolateWarm },
    { name: "Cubehelix", scale: interpolateCubehelixDefault },
    { name: "Inferno", scale: interpolateInferno },
    { name: "Purples", scale: interpolatePurples },
  ];
  const [hoveredColorScale, setHoveredColorScale] = useState<string>();
  const [preferences, setPreferences] = useState<{
    scale: ColorScale;
  }>({ scale: "Inferno" });

  useEffect(() => {
    if (preferences) {
      chrome.runtime.sendMessage({
        type: "COLOR_SCALE",
        scale: preferences.scale,
      });
    }
  }, [preferences]);

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
      <span>Choose a color scale</span>
      <div
        style={{
          height: "fit-content",
          width: "fit-content",
          display: "flex",
          flexDirection: "column",
          gap: "4px",
        }}
      >
        {scaleOptions.map(({ name, scale }) => {
          return (
            <div
              key={`${name}-container`}
              style={{
                width: "260px",
                height: "20px",
                display: "flex",
                flexDirection: "row",
                alignItems: "center",
                justifyContent: "space-between",
                gap: "2px",
                cursor: "pointer",
                border: name === preferences.scale ? "2px solid #023" : "unset",
                backgroundColor: name === hoveredColorScale ? "#add" : "unset",
                padding: "2px",
                borderRadius: "2px",
              }}
              onMouseOver={() => setHoveredColorScale(name)}
              onMouseOut={() => setHoveredColorScale(undefined)}
              onClick={() =>
                setPreferences((prior) => ({ ...prior, scale: name }))
              }
            >
              <p>{name}</p>
              <div
                style={{
                  width: "fit-content",
                  height: "fit-content",
                  display: "flex",
                  flexDirection: "row",
                  gap: "0px",
                }}
              >
                {colorBars.map((v, i) => {
                  return (
                    <div
                      key={`${name}-${i}`}
                      style={{
                        height: "16px",
                        width: "2px",
                        backgroundColor: scale(v),
                      }}
                    />
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>
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
