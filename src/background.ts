chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.type === 'START_TAB_CAPTURE') {
    chrome.tabCapture.capture({ audio: true, video: false }, (stream) => {
      // We need to keep the stream alive in the background
      if (stream) {
        const audioContext = new AudioContext();
        const source = audioContext.createMediaStreamSource(stream);
        // Connect to a silent audio sink to prevent the stream from being garbage collected
        source.connect(audioContext.createMediaStreamDestination());
        
        // Send the stream ID back to the content script
        sendResponse({ streamId: stream.id });
      } else {
        sendResponse({ error: 'Failed to capture tab audio' });
      }
    });
    return true; // Required for async response
  }
}); 