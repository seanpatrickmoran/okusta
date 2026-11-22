import assert from "node:assert/strict";
import {createServer} from "node:http";
import {once} from "node:events";
import test from "node:test";

function portPair(connect) {
  function endpoint() {
    const messages = new EventTarget(), disconnect = new EventTarget();
    return {
      onMessage: {addListener: fn => messages.addEventListener("message", e => fn(e.detail))},
      onDisconnect: {addListener: fn => disconnect.addEventListener("disconnect", fn)},
      receive: message => messages.dispatchEvent(new CustomEvent("message", {detail: message})),
      disconnect: () => disconnect.dispatchEvent(new Event("disconnect"))
    };
  }
  const client = endpoint(), worker = endpoint();
  client.postMessage = msg => queueMicrotask(() => worker.receive(msg));
  worker.postMessage = msg => queueMicrotask(() => client.receive(msg));
  connect({...worker, name: "okusta-reply", sender: {id: "fixture"}});
  return client;
}

test("Stop cancels the HTTP request before or after the first token and releases the next submission", {timeout: 8000}, async t => {
  let requestStarted, socketClosed;
  const server = createServer(async (req, res) => {
    if (req.url === "/v1/models") {
      res.setHeader("Content-Type", "application/json");
      return res.end(JSON.stringify({data: [{id: "fixture"}]}));
    }
    let raw = "";
    for await (const chunk of req) raw += chunk;
    const question = JSON.parse(raw).messages.at(-1).content;
    if (question === "finish") {
      res.setHeader("Content-Type", "application/json");
      return res.end(JSON.stringify({choices: [{message: {content: "Complete."}, finish_reason: "stop"}]}));
    }
    res.once("close", socketClosed.resolve);
    if (question === "stream") {
      res.writeHead(200, {"Content-Type": "text/event-stream"});
      res.write('data: {"choices":[{"delta":{"content":"Partial."}}]}\n\n');
    }
    requestStarted.resolve();
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  t.after(() => { server.closeAllConnections(); server.close(); });
  let connect;
  const modelRoute = {provider: "local", model: "fixture", port: server.address().port};
  const data = {modelRoute, autorecord: true};
  globalThis.browser = {
    action: {onClicked: {addListener() {}}},
    runtime: {id: "fixture", onMessage: {addListener() {}}, onConnect: {addListener(fn) { connect = fn; }},
      connect: () => portPair(connect)},
    storage: {local: {get: async () => data, set: async items => Object.assign(data, items)}}
  };
  t.after(() => { delete globalThis.browser; delete globalThis.okustaReply; });
  await import("../src/background.js");
  await import("../src/reply-client.js");
  const route = JSON.stringify(["local", "fixture", modelRoute.port]);
  const id = "d".repeat(32);
  for (const prompt of ["wait", "stream", "finish"]) {
    const panel = {clip: {id, kind: "prompt", prompt, text: "", source: {url: ""}}, turns: [], autorecord: true};
    const controller = new AbortController(), partial = Promise.withResolvers();
    requestStarted = Promise.withResolvers();
    socketClosed = Promise.withResolvers();
    const result = okustaReply(id, partial.resolve, prompt, route, false, true, panel, controller.signal);
    if (prompt === "finish") {
      assert.equal((await result).recorded, true);
      assert.deepEqual(data["questions:" + id].map(q => q.question), ["finish"]);
    } else {
      await requestStarted.promise;
      if (prompt === "stream") assert.equal(await partial.promise, "Partial.");
      controller.abort();
      await assert.rejects(result, {name: "AbortError"});
      await socketClosed.promise;
      assert.equal(data["clip:" + id], undefined);
    }
  }
});
