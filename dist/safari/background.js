import {clipTitle, localAdapter, checkAdapter} from "./collection-agent.js";
import {validateLimits} from "./qwen-limits.js";
import {findModel, generateNote, serverBusy} from "./model.js";
import {HELPER, LABELS, importReplay, changeStore, editEntry, helper, helperToken, readJournal, routeId, savePanelDraft, serial, settings, validatePanelDraft, testRoute, writeJournal} from "./journal.js";
const api = globalThis.browser ?? chrome;
let activeClip = null;
let probe = null;
let switching = false;

api.action.onClicked.addListener(async tab => {
  try {
    if (tab.id != null && /^https?:\/\//i.test(tab.url ?? "")) {
      await api.scripting.executeScript({target: {tabId: tab.id}, files: ["reply-client.js", "picker.js", "region-picker.js", "appearance.js", "vendor/marked.js", "markdown.js", "panel.js"]});
      return;
    }
  } catch (error) {
    console.info("Okusta could not open on this page.", error.message);
  }
  await api.runtime.openOptionsPage();
});

async function checkStatus() {
  const {route} = await settings();
  const info = {label: LABELS[route.provider], routeId: routeId(route), model: route.model,
    imageInput: route.imageInput === true, canCapture: typeof api.tabs?.captureVisibleTab === "function"};
  if (activeClip !== null) return {...info, state: "busy"};
  try {
    if (route.provider === "local") {
      const base = "http://127.0.0.1:" + route.port;
      const model = await findModel(base, route.model);
      const busy = await serverBusy(base);
      return {...info, model, state: busy || activeClip !== null ? "busy" : "idle"};
    }
    const {keys, hosted, sdk, openrouterImages} = await helper("/status");
    if (!keys[route.provider] || !(hosted ?? sdk)) throw new Error("Check the helper and API key in Journal settings.");
    return {...info, imageInput: info.imageInput && openrouterImages === true, state: activeClip !== null ? "busy" : "idle"};
  } catch (error) {
    return {...info, state: "offline", detail: error.message};
  }
}

function status() {
  // Overlapping panel polls share one probe; future polls see server restarts.
  if (!probe) probe = checkStatus().finally(() => { probe = null; });
  return probe;
}

async function captureForPanel(sender, expectedRoute) {
  const tab = sender.tab;
  if (sender.frameId !== 0 || tab?.id == null || tab.windowId == null || !/^https?:\/\//i.test(sender.url || ""))
    throw new Error("Open the eye on an ordinary web page.");
  const {route} = await settings();
  if (!route.imageInput || expectedRoute !== routeId(route))
    throw new Error("The selected model changed. Check the eye and try again.");
  let changed = false;
  const activated = info => { if (info.windowId === tab.windowId) changed = true; };
  const updated = (id, info) => { if (id === tab.id && (info.url || info.status === "loading")) changed = true; };
  async function checkTab() {
    const [active] = await api.tabs.query({windowId: tab.windowId, active: true});
    if (changed || active?.id !== tab.id || (active.url && active.url !== sender.url))
      throw new Error("The tab changed. Click the eye to capture again.");
  }
  api.tabs.onActivated.addListener(activated);
  api.tabs.onUpdated.addListener(updated);
  try {
    await checkTab();
    const png = await api.tabs.captureVisibleTab(tab.windowId, {format: "png"});
    await checkTab();
    return png;
  } finally {
    api.tabs.onActivated.removeListener(activated);
    api.tabs.onUpdated.removeListener(updated);
  }
}

async function run(id, onText, question = "", expectedRoute, regenerate = false, followup = false, panel, signal) {
  if (typeof question !== "string") throw new Error("Invalid question.");
  const prompt = question.trim();
  if (typeof id !== "string" || !/^[A-Za-z0-9_-]+$/.test(id)) throw new Error("Invalid clipping.");
  if (panel) {
    validatePanelDraft(panel);
    if (panel.clip.id !== id) throw new Error("Invalid panel draft ID.");
  }
  if (switching || activeClip !== null) throw new Error("The journal is busy. Retry in a moment.");
  activeClip = id;
  // Let a short, user-initiated job finish even when its overlay is dismissed.
  const heartbeat = setInterval(() => api.runtime.getPlatformInfo().catch(() => {}), 20000);
  try {
    const clipKey = "clip:" + id, noteKey = "note:" + id;
    const questionsKey = "questions:" + id;
    const {route, store, limits} = await settings();
    signal?.throwIfAborted();
    if ((expectedRoute && expectedRoute !== routeId(route)) || (!expectedRoute && route.provider !== "local")) {
      throw new Error("The active model changed. Check the model status dot and send again.");
    }
    const entries = panel ? {[clipKey]: panel.clip, [questionsKey]: panel.turns} :
      await readJournal([clipKey, noteKey, questionsKey], store);
    const questions = entries[questionsKey] ?? [];
    const previous = prompt ? questions.findLast(q => q.question === prompt &&
      (q.provider === "qwen" ? "local" : q.provider || "local") === route.provider && (!route.model || q.model === route.model)) :
      questions.findLast(q => q.kind === "explanation") || entries[noteKey];
    if (!panel && !followup && previous && previous.finishReason !== "length" && !regenerate) return previous;
    if (!entries[clipKey]) throw new Error("Save the clipping before running the model.");
    if (entries[clipKey].kind === "image" && route.imageInput !== true)
      throw new Error("Select and verify an image-capable model in Journal settings to send this crop.");
    const local = route.provider === "local";
    const base = local ? "http://127.0.0.1:" + route.port : HELPER;
    const model = local ? await findModel(base, route.model, signal) : route.model;
    const options = {limits, provider: route.provider, base, token: local ? null : await helperToken(), signal};
    if (followup && prompt) {
      options.history = [];
      if (entries[noteKey]) options.history.push({role: "assistant", content: entries[noteKey].text});
      for (const turn of questions) {
        if (turn.question) options.history.push({role: "user", content: turn.question});
        options.history.push({role: "assistant", content: turn.text});
      }
    }
    const note = await generateNote(model, entries[clipKey], onText, prompt, options);
    signal?.throwIfAborted();
    note.provider = route.provider;
    if (panel) {
      const turn = {...note, turnId: crypto.randomUUID(), ...(prompt ? {question: prompt} : {kind: "explanation"})};
      let recorded = false, saveError = "";
      if (panel.autorecord === true) {
        try {
          await serial(async () => {
            if ((await api.storage.local.get("autorecord")).autorecord !== true) return;
            await savePanelDraft({clip: panel.clip, turns: [...panel.turns, turn]}, store, signal);
            recorded = true;
          });
        } catch (error) {
          signal?.throwIfAborted();
          saveError = error.message;
        }
      }
      if (!recorded) signal?.throwIfAborted();
      return {turn, recorded, saveError};
    }
    if (prompt || entries[noteKey]) {
      // Keep the original when regenerating a saved answer. Revisions appear under the same clipping.
      const turnId = crypto.randomUUID();
      const reply = prompt ? {turnId, question: prompt, ...note} : {turnId, kind: "explanation", ...note};
      await serial(() => writeJournal({[questionsKey]: [...questions, reply]}, store));
      return reply;
    }
    await serial(() => writeJournal({[noteKey]: note}, store));
    return note;
  } finally {
    clearInterval(heartbeat);
    activeClip = null;
  }
}

api.runtime.onConnect.addListener(port => {
  if (port.name !== "okusta-reply" || port.sender?.id !== api.runtime.id) return;
  let connected = true, started = false;
  const controller = new AbortController();
  port.onDisconnect.addListener(() => { connected = false; });
  function publish(message) {
    if (!connected) return;
    try { port.postMessage(message); } catch { connected = false; }
  }
  port.onMessage.addListener(({type, id, question, expectedRoute, regenerate, followup, panel}) => {
    if (type === "cancel") { controller.abort(); return; }
    if (started) return;
    started = true;
    run(id, text => publish({type: "text", text}), question, expectedRoute, regenerate, followup, panel, controller.signal).then(
      note => publish({type: "done", note}),
      error => publish(controller.signal.aborted ? {type: "cancelled"} : {type: "error", error: error.message})
    );
  });
});

function sameStore(left, right) {
  return left?.type === right.type && (right.type === "profile" || left.path === right.path);
}

async function collectionOperation(message) {
  const {store, adapter} = await settings();
  if (!sameStore(message.store, store)) throw new Error("The journal location changed. Start a new collection run.");
  if (!adapter) throw new Error("Connect a collection adapter in Settings first.");
  const {ids, destination} = message;
  if (message.type === "collection-begin") {
    if (!Array.isArray(ids) || !ids.length || ids.length > 12 || new Set(ids).size !== ids.length ||
        !ids.every(id => typeof id === "string" && /^[A-Za-z0-9_-]+$/.test(id))) throw new Error("Select 1–12 clippings.");
    const keys = ids.map(id => "clip:" + id), records = await readJournal(keys, store);
    const clips = keys.map(k => records[k]);
    if (clips.some(c => !c || c.kind === "replay")) throw new Error("A selected clipping is unavailable. Refresh the journal.");
    return {clips, adapter, store};
  }
  if (!destination || !/^[0-9a-f]{32}$/.test(destination.id) ||
      typeof destination.name !== "string" || !destination.name.trim() || destination.name.length > 100 ||
      typeof destination.criterion !== "string" || !destination.criterion.trim() || destination.criterion.length > 600 ||
      !Array.isArray(destination.selection) || destination.selection.length > 12 ||
      !destination.selection.every(id => typeof id === "string" && /^[A-Za-z0-9_-]+$/.test(id)))
    throw new Error("Invalid collection destination.");
  if (adapter.model !== destination.model || adapter.port !== destination.port)
    throw new Error("The collection adapter changed. Start a new run.");
  const key = "collection:" + destination.id;
  const records = await readJournal([key, ...destination.selection.map(id => "clip:" + id)], store);
  if (message.type === "collection-open") {
    if (!records[key]) return null;
    return {members: records[key].members.map(id => {
      const clip = records["clip:" + id];
      return {id, exists: Boolean(clip), title: clip ? clipTitle(clip) : "Unavailable clipping"};
    })};
  }
  if (!Array.isArray(ids) || ids.length > 12 || new Set(ids).size !== ids.length ||
      !ids.every(id => destination.selection.includes(id) && records["clip:" + id]))
    throw new Error("A requested clipping is outside the selection or was deleted.");
  const {id, name, criterion, model} = destination;
  await writeJournal({[key]: {id, name, criterion, model, members: ids,
    createdAt: records[key]?.createdAt || new Date().toISOString()}}, store);
}

async function configure(message) {
  switch (message.type) {
    case "adapter-use": {
      const route = localAdapter(message.model, message.port);
      await checkAdapter(route);
      await api.storage.local.set({collectionAdapter: route});
      return route;
    }
    case "adapter-clear": return api.storage.local.remove("collectionAdapter");
    case "journal-snapshot": return serial(async () => {
      const {store} = await settings();
      return {store, records: await readJournal(null, store)};
    });
    case "collection-begin":
    case "collection-save":
    case "collection-open": return serial(() => collectionOperation(message));
    case "settings-get": {
      const profile = await settings();
      try {
        const {runtime} = await helper("/qwen/config", {}, undefined, 2000);
        if (runtime) Object.assign(profile.limits, runtime);
      } catch { /* Unpaired and browser-only installations use their saved launch values. */ }
      return profile;
    }
    case "qwen-save-limits": return serial(async () => {
      const limits = validateLimits(message.limits);
      await api.storage.local.set({qwenLimits: limits});
      try {
        const {path} = await helper("/qwen/config/save", {contextTokens: limits.contextTokens, gpuGB: limits.gpuGB});
        return {limits, path};
      } catch (error) {
        return {limits, launchManually: error.message};
      }
    });
    case "journal-import-replay": return serial(() => importReplay(message.replay));
    case "journal-delete":
    case "journal-split": return serial(() => {
      if (activeClip === message.id) throw new Error("Wait for this entry’s reply to finish.");
      return editEntry(message.type === "journal-delete" ? "delete" : "split", message.id);
    });
    case "journal-read": return readJournal();
    case "helper-status": return helper("/status");
    case "helper-pair": {
      const token = message.token.trim();
      if (!token) throw new Error("Enter the pairing token printed by desk-service.py.");
      const info = await helper("/status", {}, token);
      await api.storage.session.set({pairing: token});
      return info;
    }
    case "model-use": {
      const route = await testRoute(message, findModel);
      route.verifiedAt = new Date().toISOString();
      await serial(async () => {
        const {modelIds} = await settings();
        if (route.model) modelIds[route.provider] = route.model;
        await api.storage.local.set({modelRoute: route, modelIds});
      });
      return route;
    }
    case "model-reset": {
      await api.storage.local.remove("modelRoute");
      return (await settings()).route;
    }
    case "journal-store": {
      if (activeClip !== null || switching) throw new Error("Wait for the current journal operation to finish.");
      switching = true;
      try { return await serial(() => changeStore({...message, type: message.typeName})); }
      finally { switching = false; }
    }
    case "journal-export": {
      const {store} = await settings();
      if (!store.folder) throw new Error("Choose an export folder first.");
      return helper("/export", {folder: store.folder, format: message.format, text: message.text});
    }
    default: throw new Error("Unknown settings operation.");
  }
}

api.runtime.onMessage.addListener((message, sender, respond) => {
  if (sender.id !== api.runtime.id) return false;
  let work;
  switch (message?.type) {
    case "open-desk": work = api.runtime.openOptionsPage(); break;
    case "qwen-status": work = status(); break;
    case "panel-capture": work = captureForPanel(sender, message.expectedRoute); break;
    case "run-qwen": work = run(message.id, undefined, message.question, message.expectedRoute, message.regenerate, message.followup); break;
    case "panel-save": work = serial(async () => savePanelDraft(message.draft, (await settings()).store)); break;
    case "journal-save-clip": {
      const clip = message.clip;
      work = serial(async () => {
        validatePanelDraft({clip, turns: []});
        return writeJournal({["clip:" + clip.id]: clip}, (await settings()).store);
      });
      break;
    }
    default:
      if (sender.url?.split(/[?#]/)[0] !== api.runtime.getURL("desk.html")) return false;
      work = configure(message);
  }
  work.then(value => respond({ok: true, value}), error => respond({ok: false, error: error.message}));
  return true;
});
