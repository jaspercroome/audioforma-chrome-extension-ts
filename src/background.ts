let visualWindow: number | null = null;
let sourceTabId: number | null = null;

chrome.commands.onCommand.addListener(async (command) => {
  if (command === "toggle-visual") {
    console.log("Toggle visual command received:", command);
    if (visualWindow) {
      console.log("Closing existing window:", visualWindow);
      await chrome.windows.remove(visualWindow);
      visualWindow = null;
    } else {
      try {
        const [tab] = await chrome.tabs.query({
          active: true,
          currentWindow: true,
        });
        console.log("Source tab:", tab);
        sourceTabId = tab.id ?? null;

        const window = await chrome.windows.create({
          url: chrome.runtime.getURL("visual.html"),
          type: "popup",
          width: 800,
          height: 600,
        });
        console.log("Created window:", window);

        visualWindow = window.id ?? null;
      } catch (error) {
        console.error("Failed to create window:", error);
      }
    }
  }
});

// Make the message listener async and return true to keep the message channel open
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  console.log("Received message:", message, "from:", sender);
  if (
    message.type === "VISUAL_WINDOW_READY" &&
    visualWindow &&
    sourceTabId &&
    sender.tab?.id
  ) {
    console.log("Visual window is ready, sending tab ID");
    setTimeout(() => {
      if (sender.tab?.id) {
        try {
          chrome.tabs.sendMessage(sender.tab.id, {
            type: "SOURCE_TAB_ID",
            tabId: sourceTabId,
          });
        } catch (error) {
          console.error("Failed to send tab ID:", error);
        }
      }
    }, 100);
  }
  return true;
});

chrome.windows.onRemoved.addListener((windowId) => {
  if (windowId === visualWindow) {
    visualWindow = null;
    sourceTabId = null;
  }
});
