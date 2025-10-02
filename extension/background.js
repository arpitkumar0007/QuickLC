chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.action === "insertTemplate") {
    (async () => {
      try {
        const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
        if (!tab) {
          throw new Error("No active tab found.");
        }

        const injectionResults = await chrome.scripting.executeScript({
          target: { tabId: tab.id },
          world: "MAIN", 
          func: insertCodeWithRetry,
          args: [message.code],
        });

        if (injectionResults && injectionResults[0] && injectionResults[0].result === true) {
          sendResponse({ status: "injected" });
        } 
        else {
          throw new Error("Injection script failed to return success.");
        }
      } 
      catch (e) {
        console.error("LeetCode Template Inserter - Injection failed:", e.message);
        sendResponse({ status: "error", message: e.message });
      }
    })();
    
    return true; 
  }
});

/**
 * @param {string} templateCode The code to insert.
 * @returns {Promise<boolean>} A promise that resolves to true on success, false on failure.
 */


function insertCodeWithRetry(templateCode) {
  return new Promise((resolve) => {
    const codeToPrepend = templateCode + "\n";
    let attempts = 0;
    const maxAttempts = 30; 

    const intervalId = setInterval(() => {
      attempts++;
      try {
        if (window.monaco && typeof window.monaco.editor.getModels === 'function' && window.monaco.editor.getModels().length > 0) {
          clearInterval(intervalId); 
          
          const model = window.monaco.editor.getModels()[0];
          const currentCode = model.getValue();
          model.setValue(codeToPrepend + currentCode); 

          const editors = window.monaco.editor.getEditors();
          if (editors.length > 0) {
            const editor = editors[0];
            editor.focus();
            const lineCount = templateCode.split('\n').length;
            editor.setPosition({ lineNumber: lineCount + 1, column: 1 });
          }
          
          resolve(true); 
          return;
        }
      } 
      catch (e) {
        
        clearInterval(intervalId);
        console.error("LeetCode Template Inserter - Error during injection:", e);
        resolve(false); 
        return;
      }



      if (attempts >= maxAttempts) {

        clearInterval(intervalId);
        console.error("LeetCode Template Inserter - Monaco editor not found on page after 3 seconds.");
        alert("LeetCode Template Inserter: Could not find the code editor on the page.");
        resolve(false); // Signal failure
      
      
      }
    }, 100);
  });
}