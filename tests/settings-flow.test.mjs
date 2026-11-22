import assert from "node:assert/strict";
import test from "node:test";
import {readFile, mkdtemp, rm} from "node:fs/promises";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {spawn} from "node:child_process";
import {once} from "node:events";
import {fileURLToPath} from "node:url";
import {createInterface} from "node:readline/promises";

function storageArea(notify = () => {}) {
  const values = {};
  return {
    async get(keys) {
      if (keys == null) return structuredClone(values);
      const list = Array.isArray(keys) ? keys : [keys];
      return structuredClone(Object.fromEntries(list.filter(k => k in values).map(k => [k, values[k]])));
    },
    async set(items) {
      const changes = Object.fromEntries(Object.entries(items).map(([k, v]) => [k, {oldValue: values[k], newValue: v}]));
      Object.assign(values, structuredClone(items));
      notify(changes);
    },
    async remove(keys) { for (const k of [].concat(keys)) delete values[k]; }
  };
}

class Control {
  constructor(id) {
    this.id = id;
    this.value = "";
    this.dataset = {};
    this.listeners = {};
    this.group = {};
    this.classList = {toggle() {}};
  }
  closest() { return this.group; }
  setAttribute(key, value) { this[key] = value; }
  addEventListener(name, action) { this.listeners[name] = action; }
  click() { return this.listeners.click(); }
}

test("drawer settings drive storage, exports, validation and inference", async t => {
  const directory = await mkdtemp(join(tmpdir(), "okusta-"));
  t.after(() => rm(directory, {recursive: true, force: true}));
  const script = fileURLToPath(new URL("../scripts/desk-service.py", import.meta.url));
  const command = [
    "import sys,runpy,os",
    "sys.path.insert(0,os.path.dirname(sys.argv[1]))",
    "d=runpy.run_path(sys.argv[1])",
    "server=d['ThreadingHTTPServer'](('127.0.0.1',0),d['Handler'])",
    "server.bearer=b'Bearer fixture-session'",
    "print(server.server_port,flush=True)",
    "server.serve_forever()"
  ].join("\n");
  const process = spawn("python3", ["-c", command, script], {stdio: ["ignore", "pipe", "inherit"], env: {...globalThis.process.env, XDG_CONFIG_HOME: directory}});
  const exited = once(process, "exit");
  t.after(async () => { process.kill(); await exited; });
  const lines = createInterface({input: process.stdout});
  const [port] = await once(lines, "line");
  const realFetch = globalThis.fetch;
  const hostedKeys = {};
  const requests = [], localCalls = [];
  t.mock.method(globalThis, "fetch", async (url, options) => {
    const path = new URL(url).pathname;
    assert.equal(new URL(url).hostname, "127.0.0.1");
    if (new URL(url).port === "8765") {
      if (path === "/v1/models") return Response.json({data: [{id: "example/local-model"}, {id: "collection", parent: "example/local-model"}]});
      if (path === "/metrics") return new Response("");
      if (path === "/v1/chat/completions") {
        const body = JSON.parse(options.body);
        if (body.tools && body.model === "collection") return Response.json({choices: [{message: {
          tool_calls: [{type: "function", id: "probe", function: {name: "experiment", arguments: JSON.stringify({op: "search", query: ""})}}]
        }}]});
        localCalls.push(body);
        const choice = {message: {content: localCalls.length === 1 ? "Partial" : "Complete"}, finish_reason: localCalls.length === 1 ? "length" : "stop"};
        return Response.json({choices: [choice]});
      }
    }
    if (options.headers?.Authorization === "Bearer fixture-session") {
      const body = JSON.parse(options.body);
      if (path === "/status") return Response.json({sdk: true, openrouterImages: true, keys: hostedKeys});
      if (path === "/model/test") {
        if (body.model === "should-not-activate") return Response.json({error: {message: "Check the API key."}}, {status: 400});
        assert.equal(body.key, undefined);
        hostedKeys[body.provider] = true;
        return Response.json({model: body.model, imageInput: body.provider === "openrouter" && body.model === "fixture/vlm"});
      }
      if (path === "/v1/chat/completions") {
        requests.push(body);
        return new Response('data: {"choices":[{"delta":{"content":"Hosted answer"},"finish_reason":"stop"}]}\n\ndata: [DONE]\n\n');
      }
    }
    return realFetch("http://127.0.0.1:" + port + path, options);
  });

  let incoming, connect;
  const observers = new Set();
  const local = storageArea(changes => observers.forEach(fn => fn(changes, "local"))), session = storageArea();
  const deskURL = "moz-extension://fixture/desk.html";
  const api = {
    runtime: {id: "fixture", getURL: () => deskURL, onConnect: {addListener(fn) { connect = fn; }},
      onMessage: {addListener(f) { incoming = f; }},
      sendMessage: message => new Promise(resolve => incoming(message, {id: "fixture", url: deskURL}, resolve))},
    action: {onClicked: {addListener() {}}}, storage: {local, session, onChanged: {addListener: fn => observers.add(fn), removeListener: fn => observers.delete(fn)}}
  };
  globalThis.browser = api;
  const html = await readFile(new URL("../src/desk.html", import.meta.url), "utf8");
  const ids = new Map([...html.matchAll(/ id="([^"]+)"/g)].map(([, id]) => [id, new Control(id)]));
  const get = id => { assert.ok(ids.has(id), "missing HTML control " + id); return ids.get(id); };
  get("settings-body").hidden = true;
  get("copy-records").checked = true;
  globalThis.document = {documentElement: new Control("html"), getElementById: get, querySelector: () => new Control("workspace")};
  await import("../src/background.js");
  await import("../src/appearance.js");
  await import("../src/settings.js");
  assert.equal(get("dark-mode").checked, false);
  get("dark-mode").checked = true;
  await get("dark-mode").listeners.change();
  assert.equal((await local.get("darkMode")).darkMode, true);
  assert.equal(document.documentElement.dataset.theme, "dark");
  t.after(() => { delete globalThis.browser; delete globalThis.document; });

  const clip = {id: "a".repeat(32), text: "Saved selection", createdAt: "2026-11-21T12:00:00Z",
    day: "2026-11-21", source: {title: "Example", url: "https://example.org"}};
  const clipKey = "clip:" + clip.id;
  await local.set({[clipKey]: clip});
  await get("toggle-settings").click();
  assert.equal(get("settings-body").hidden, false);
  assert.match(get("active-store").textContent, /browser profile/);
  get("pair-token").value = "fixture-session";
  await get("pair").click();
  assert.match(get("helper-result").textContent, /Paired/);
  get("note-tokens").value = "1200"; get("question-tokens").value = "3100";
  get("context-tokens").value = "24576"; get("gpu-gb").value = "24.0099";
  await get("save-limits").click();
  assert.equal(get("gpu-gb").value, "24.00");
  assert.match(get("limits-result").textContent, /Restart/);
  const cfg = JSON.parse(await readFile(join(directory, "okusta/local-model.json"), "utf8"));
  assert.deepEqual(cfg, {contextTokens: 24576, gpuGB: "24.00"});
  let stored = (await local.get("qwenLimits")).qwenLimits;
  assert.deepEqual(stored, {contextTokens: 24576, gpuGB: "24.00", noteTokens: 1200, questionTokens: 3100});
  get("context-tokens").value = "128"; await get("save-limits").click();
  assert.equal(get("limits-result").dataset.error, "true");
  assert.deepEqual((await local.get("qwenLimits")).qwenLimits, stored);
  get("context-tokens").value = "24576";
  const send = async (type, fields) => {
    const reply = await api.runtime.sendMessage({type, ...fields});
    assert.equal(reply.ok, true, reply.error);
    return reply.value;
  };
  await get("use-adapter").click();
  assert.match(get("adapter-result").textContent, /Native tool call/);
  const {adapter, store: profile} = await send("settings-get");
  const {clips: selectedClips} = await send("collection-begin", {store: profile, ids: [clip.id]});
  assert.deepEqual(selectedClips, [clip]);
  const destination = {id: "b".repeat(32), selection: [clip.id], name: "Results", criterion: "Keep results", ...adapter};
  const fields = {store: profile, destination};
  assert.equal(await send("collection-open", fields), null);
  await send("collection-save", {...fields, ids: [clip.id]});
  assert.deepEqual((await send("collection-open", fields)).members, [{id: clip.id, title: "Example", exists: true}]);
  get("store-type").value = "sqlite";
  get("store-type").listeners.change();
  assert.equal(get("copy-label").hidden, false);
  const dbPath = join(directory, "journal.sqlite");
  get("db-path").value = dbPath;
  get("export-folder").value = directory;
  await get("save-store").click();
  assert.match(get("store-result").textContent, /location saved/);
  assert.equal((await local.get("journalStore")).journalStore.path, dbPath);
  assert.ok((await api.runtime.sendMessage({type: "journal-read"})).value[clipKey]);

  assert.equal((await api.runtime.sendMessage({type: "collection-save", ...fields, ids: []})).ok, false);
  fields.store = (await send("settings-get")).store;
  assert.equal((await send("collection-open", fields)).members[0].id, clip.id);
  await send("collection-save", {...fields, ids: []});
  assert.deepEqual((await send("collection-open", fields)).members, []);
  await send("collection-save", {...fields, ids: [clip.id]});
  assert.equal((await api.runtime.sendMessage({type: "collection-save", ...fields, ids: ["other"]})).ok, false);
  assert.equal((await send("collection-open", fields)).members.length, 1);
  for (const provider of ["groq", "gemini", "openrouter", "deepseek", "anthropic", "openai"]) {
    get("provider").value = provider; get("provider").listeners.change();
    if (["groq", "gemini", "openrouter"].includes(provider)) {
      assert.ok(get("model-id").value);
      assert.ok(html.includes('value="' + provider + '"'));
    }
    get("model-id").value = "model-" + provider;
    await get("use-model").click();
    assert.match(get("model-result").textContent, /Verified/);
    assert.ok(!ids.has("api-key"));
  }
  get("model-id").value = "should-not-activate";
  await get("use-model").click();
  assert.equal(get("model-result").dataset.error, "true");
  const selected = (await local.get("modelRoute")).modelRoute;
  assert.equal(selected.model, "model-openai");
  assert.equal((await send("settings-get")).adapter.model, "collection");
  get("adapter-name").value = "absent";
  await get("use-adapter").click();
  assert.equal(get("adapter-result").dataset.error, "true");
  assert.equal((await send("settings-get")).adapter.model, "collection");
  await get("clear-adapter").click();
  assert.equal((await send("settings-get")).adapter, null);
  assert.deepEqual((await send("settings-get")).route, selected);
  const info = (await api.runtime.sendMessage({type: "qwen-status"})).value;
  assert.equal(info.state, "idle");
  const run = expectedRoute => api.runtime.sendMessage({type: "run-qwen", id: clip.id, expectedRoute});
  assert.equal((await run("stale-route")).ok, false);
  const res = await run(info.routeId);
  assert.ok(res.ok, res.error);
  assert.equal(res.value.text, "Hosted answer");
  assert.equal(requests.length, 1);
  assert.equal(requests[0].provider, "openai");
  assert.equal(requests[0].top_k, undefined);
  assert.equal((await local.get("note:" + clip.id))["note:" + clip.id], undefined);
  for (const format of ["md", "json"]) {
    await get("export-" + format).click();
    const filename = get("store-result").textContent.replace(/^Exported to /, "");
    const output = await readFile(filename, "utf8");
    assert.match(output, /Hosted answer/);
    assert.match(output, /Saved selection/);
    assert.doesNotMatch(output, /fixture-session|fixture-key|modelRoute|pairing/);
  }
  // Regeneration preserves the original entry and saves the new result on the same clip.
  const regen = await api.runtime.sendMessage({type: "run-qwen", id: clip.id, regenerate: true, expectedRoute: info.routeId});
  assert.ok(regen.ok, regen.error);
  const records = (await api.runtime.sendMessage({type: "journal-read"})).value;
  assert.deepEqual(records["note:" + clip.id], res.value);
  assert.equal(records["questions:" + clip.id][0].kind, "explanation");
  async function exerciseSplit(id, route) {
    const send = (type, args) => api.runtime.sendMessage({type, ...args});
    const fork = await send("journal-split", {id});
    assert.ok(fork.ok, fork.error);
    const newId = fork.value.id;
    const answer = await send("run-qwen", {id: newId, question: "Consider a different example", followup: true, expectedRoute: route});
    assert.ok(answer.ok, answer.error);
    const after = (await send("journal-read", {})).value;
    assert.equal(after["clip:" + newId].splitFrom, id);
    assert.equal(after["questions:" + newId].length, after["questions:" + id].length + 1);
    assert.equal(after["questions:" + newId].at(-1).question, "Consider a different example");
    const deleted = await send("journal-delete", {id: newId});
    assert.ok(deleted.ok, deleted.error);
    const remaining = (await send("journal-read", {})).value;
    assert.ok(remaining["clip:" + id]);
    for (const prefix of ["clip:", "note:", "questions:"]) assert.ok(!(prefix + newId in remaining));
  }
  await exerciseSplit(clip.id, info.routeId);
  assert.ok(requests.at(-1).messages.some(m => m.role === "assistant" && m.content.includes("Hosted answer")));
  await session.remove("pairing");
  get("gpu-gb").value = "19.999";
  await get("save-limits").click();
  assert.match(get("launch-command").textContent, /OKUSTA_GPU_GB=19.99 /);
  assert.ok(get("launch-details").open);

  assert.equal((await api.runtime.sendMessage({type: "journal-read"})).ok, false);
  get("store-type").value = "profile"; get("store-type").listeners.change();
  get("export-folder").value = ""; get("copy-records").checked = true;
  await get("save-store").click();
  assert.equal((await local.get("journalStore")).journalStore.type, "sqlite");
  get("pair-token").value = "fixture-session"; await get("pair").click();
  await get("save-store").click();
  assert.equal((await local.get("journalStore")).journalStore.type, "profile");
  assert.equal((await local.get("note:" + clip.id))["note:" + clip.id].text, "Hosted answer");
  await get("reset-model").click();
  assert.equal((await api.runtime.sendMessage({type: "settings-get"})).value.route.provider, "local");
  const localRoute = (await api.runtime.sendMessage({type: "qwen-status"})).value.routeId;
  const second = {...clip, id: "b".repeat(32)};
  await local.set({["clip:" + second.id]: second});
  const ask = question => api.runtime.sendMessage({type: "run-qwen", id: second.id, question, expectedRoute: localRoute});
  assert.equal((await ask("")).value.finishReason, "length");
  assert.equal((await ask("")).value.finishReason, "stop");
  assert.equal((await ask("why?")).value.finishReason, "stop");
  assert.deepEqual(localCalls.map(body => body.max_tokens), [1200, 1200, 3100]);
  assert.equal(localCalls[2].chat_template_kwargs, undefined);
  const journal = (await api.runtime.sendMessage({type: "journal-read"})).value;
  assert.equal(journal["note:" + second.id].text, "Partial");
  assert.equal(journal["questions:" + second.id][0].text, "Complete");
  await exerciseSplit(second.id, localRoute);
  const free = {...clip, id: "c".repeat(32), kind: "prompt", prompt: "Say hello", text: "", source: {title: "", url: ""}};
  await api.runtime.sendMessage({type: "journal-save-clip", clip: free});
  await api.runtime.sendMessage({type: "run-qwen", id: free.id, question: free.prompt, followup: true, expectedRoute: localRoute});
  const freeMsgs = localCalls.at(-1).messages;
  assert.deepEqual(freeMsgs.slice(1), [{role: "user", content: "Say hello"}]);
  // Drive panel generation through its real streaming port, with both journal backends.
  function panelReply(draft, question, autorecord) {
    return new Promise((resolve, reject) => {
      let start;
      connect({name: "okusta-reply", sender: {id: "fixture"},
        onMessage: {addListener(fn) { start = fn; }, removeListener() {}},
        onDisconnect: {addListener() {}},
        postMessage(message) {
          if (message.type === "done") resolve(message.note);
          if (message.type === "error") reject(new Error(message.error));
        }
      });
      start({id: draft.clip.id, question, followup: Boolean(question), expectedRoute: localRoute,
        panel: {...draft, autorecord}});
    });
  }

  assert.equal(get("autorecord").checked, false);
  for (const [i, backend] of ["profile", "sqlite"].entries()) {
    if (backend === "sqlite") {
      get("store-type").value = "sqlite"; get("store-type").listeners.change();
      get("db-path").value = dbPath; get("copy-records").checked = false;
      await get("save-store").click();
      assert.equal((await local.get("journalStore")).journalStore.type, "sqlite");
    }
    const id = String(i + 1).repeat(32);
    const draft = {clip: {...clip, id, kind: "html", element: "div", text: '<div class="test">A</div>'}, turns: []};
    const read = async () => (await api.runtime.sendMessage({type: "journal-read"})).value;
    const save = async () => assert.equal((await api.runtime.sendMessage({type: "panel-save", draft})).ok, true);
    const first = await panelReply(draft, "", false);
    assert.equal(first.recorded, false);
    assert.ok(!(await read())["clip:" + id]);
    assert.match(localCalls.at(-1).messages[1].content, /"kind": "html"/);
    draft.turns.push(first.turn);
    const secondReply = await panelReply(draft, "Describe the container", false);
    assert.ok(localCalls.at(-1).messages.some(m => m.role === "assistant" && m.content === first.turn.text));
    draft.turns.push(secondReply.turn);
    assert.ok(!(await read())["clip:" + id]);
    await save(); await save();
    let rows = await read();
    assert.deepEqual(rows["clip:" + id], draft.clip);
    assert.equal(rows["note:" + id].turnId, first.turn.turnId);
    assert.deepEqual(rows["questions:" + id].map(q => q.turnId), [secondReply.turn.turnId]);
    const third = await panelReply(draft, "One more?", false);
    draft.turns.push(third.turn);
    assert.equal((await read())["questions:" + id].length, 1);
    get("autorecord").checked = true; await get("autorecord").listeners.change();
    assert.equal((await read())["questions:" + id].length, 1);
    const fourth = await panelReply(draft, "Record this conversation", true);
    assert.equal(fourth.recorded, true);
    draft.turns.push(fourth.turn);
    assert.deepEqual((await read())["questions:" + id].map(q => q.turnId), draft.turns.slice(1).map(q => q.turnId));
    get("autorecord").checked = false; await get("autorecord").listeners.change();
    const last = await panelReply(draft, "With an old preference", true);
    assert.equal(last.recorded, false);
    assert.equal((await read())["questions:" + id].length, 3);
  }
  assert.equal(incoming({type: "settings-get"}, {id: "fixture", url: "https://example.org"}, () => {}), false);

  const crop = {...clip, id: "8".repeat(32), text: "", kind: "image", image: {
    width: 1, height: 1, dataUrl: "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+j03sAAAAASUVORK5CYII="}};
  await send("panel-save", {draft: {clip: crop, turns: []}});
  const askCrop = (route, question) => api.runtime.sendMessage({type: "run-qwen", id: crop.id,
    question, followup: true, expectedRoute: route});
  const before = localCalls.length;
  assert.match((await askCrop(localRoute, "Describe this")).error, /image-capable/);
  assert.equal(localCalls.length, before);
  for (const provider of ["local", "openrouter"]) {
    get("provider").value = provider;
    get("provider").listeners.change();
    get(provider === "local" ? "local-model" : "model-id").value = provider === "local" ? "example/local-model" : "fixture/vlm";
    await get("use-model").click();
    const info = await send("qwen-status");
    assert.equal(info.imageInput, true);
    assert.match(get("active-model").textContent, /Image input ready/);
    const response = await askCrop(info.routeId, "Describe this for " + provider);
    assert.ok(response.ok, response.error);
    const body = (provider === "local" ? localCalls : requests).at(-1);
    assert.deepEqual(body.messages[1].content[1], {type: "image_url", image_url: {url: crop.image.dataUrl}});
    assert.equal(JSON.stringify(body.messages).split(crop.image.dataUrl).length, 2);
  }
  const persisted = await send("journal-read");
  assert.deepEqual(persisted["clip:" + crop.id].image, crop.image);
  assert.equal(persisted["questions:" + crop.id].length, 2);
  get("export-folder").value = directory;
  await get("save-store").click();
  for (const format of ["md", "json"]) {
    await get("export-" + format).click();
    const path = get("store-result").textContent.replace(/^Exported to /, "");
    const output = await readFile(path, "utf8");
    assert.ok(output.includes(crop.image.dataUrl));
  }
});
