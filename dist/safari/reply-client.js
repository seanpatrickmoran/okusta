// A port streams one request. Panel drafts travel in memory until explicitly recorded.
globalThis.okustaReply = function okustaReply(id, onText, question = "", expectedRoute, regenerate = false, followup = false, panel, signal) {
  const api = globalThis.browser ?? chrome;
  return new Promise((resolve, reject) => {
    signal?.throwIfAborted();
    const port = api.runtime.connect({name: "okusta-reply"});
    const cancel = () => port.postMessage({type: "cancel"});
    port.onDisconnect.addListener(() => {
      signal?.removeEventListener("abort", cancel);
      const problem = api.runtime.lastError?.message || port.error?.message;
      reject(new Error(problem || "The connection to this window closed. Check the journal or retry."));
    });
    port.onMessage.addListener(message => {
      if (message.type === "text") {
        if (!signal?.aborted) onText(message.text);
        return;
      }
      signal?.removeEventListener("abort", cancel);
      if (message.type === "done") resolve(message.note);
      else if (message.type === "cancelled") reject(new DOMException("Response stopped.", "AbortError"));
      else reject(new Error(message.error || "The model did not return an answer."));
      port.disconnect();
    });
    port.postMessage({id, question, expectedRoute, regenerate, followup, panel});
    signal?.addEventListener("abort", cancel, {once: true});
  });
};
