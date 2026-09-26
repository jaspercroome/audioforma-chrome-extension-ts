const VISUAL_PAGE = chrome.runtime.getURL("visual.html");

type ExtensionContext = { contextType: string; documentUrl?: string; windowId: number };

/**
 * Find open visualizer windows by asking Chrome, instead of remembering them in
 * module-level variables. MV3 service workers are shut down after ~30 s idle,
 * which wiped those variables, so the shortcut would open a second visualizer
 * instead of closing the first (and the second tab capture would fail).
 */
const findVisualWindows = async (): Promise<number[]> => {
  const runtime = chrome.runtime as unknown as {
    getContexts?: (filter: { contextTypes: string[] }) => Promise<ExtensionContext[]>;
  };
  if (!runtime.getContexts) return [];
  const contexts = await runtime.getContexts({ contextTypes: ["TAB"] });
  const windowIds = contexts
    .filter((c) => c.documentUrl?.startsWith(VISUAL_PAGE) && c.windowId >= 0)
    .map((c) => c.windowId);
  return Array.from(new Set(windowIds));
};

const toggleVisualWindow = async () => {
  const openWindows = await findVisualWindows();
  if (openWindows.length > 0) {
    await Promise.all(openWindows.map((id) => chrome.windows.remove(id).catch(() => undefined)));
    return;
  }

  const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
  if (tab?.id === undefined) return;

  // The source tab travels in the URL, so the visual page doesn't depend on a
  // timed message arriving after its listener is registered.
  await chrome.windows.create({
    url: `${VISUAL_PAGE}?tabId=${tab.id}`,
    type: "popup",
    width: 800,
    height: 600,
    focused: true,
  });
};

chrome.commands.onCommand.addListener((command) => {
  if (command === "toggle-visual") {
    toggleVisualWindow().catch((error) => console.error("Failed to toggle visualizer:", error));
  }
});

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type === "toggle-visual") {
    toggleVisualWindow().catch((error) => console.error("Failed to toggle visualizer:", error));
  }
  // Reply straight away. The old listener returned `true` (promising an async
  // reply) but never replied, so every sender's promise rejected with
  // "message channel closed before a response was received".
  sendResponse({ ok: true });
});
