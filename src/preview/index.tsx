import React from "react";
import { createRoot } from "react-dom/client";
import { PreviewApp } from "./PreviewApp";
import { RenderHarness } from "./RenderHarness";

const root = createRoot(document.getElementById("app")!);
root.render(window.__AUDIOFORMA_RENDER__ ? <RenderHarness /> : <PreviewApp />);
