import {validate, stable, describe, sameReplay} from "./replay/formats.js";
import {DEFAULT_LIMITS} from "./qwen-limits.js";
import {probeLocalImage, validateImage} from "./model.js";
const api = globalThis.browser ?? chrome;
export const HELPER = "http://127.0.0.1:8766";
const DEFAULT_STORE = {type: "profile", path: "", folder: ""};
const DEFAULT_ROUTE = {provider: "local", model: "", port: 8765};
export const LABELS = {local: "Local model", openai: "OpenAI", deepseek: "DeepSeek", anthropic: "Anthropic",
  groq: "Groq", gemini: "Gemini", openrouter: "OpenRouter"};
const recordKey = /^(clip|note|questions|collection):[A-Za-z0-9_-]+$/;

export async function settings() {
  const data = await api.storage.local.get(["journalStore", "modelRoute", "modelIds", "qwenLimits", "collectionAdapter"]);
  const route = data.modelRoute ?? DEFAULT_ROUTE;
  return {adapter: data.collectionAdapter ?? null, limits: {...DEFAULT_LIMITS, ...data.qwenLimits}, modelIds: data.modelIds || {}, store: data.journalStore ?? DEFAULT_STORE, route: route.provider === "qwen" ? {...route, provider: "local"} : route};
}

export async function helperToken() {
  if (api.runtime.getManifest?.().browser_specific_settings?.gecko &&
      !await api.permissions.contains({data_collection: ["authenticationInfo"]})) {
    throw new Error("Pair the helper in Journal settings to enable credential use.");
  }
  const {pairing} = await api.storage.session.get("pairing");
  if (!pairing) throw new Error("Start desk-service.py and pair it in Journal settings.");
  return pairing;
}

export async function helper(path, data = {}, token, timeout = 10000) {
  token ??= await helperToken();
  let response;
  try {
    response = await fetch(HELPER + path, {method: "POST", redirect: "error", credentials: "omit",
      headers: {"Content-Type": "application/json", Authorization: "Bearer " + token},
      body: JSON.stringify(data), signal: AbortSignal.timeout(timeout)});
  } catch (error) {
    throw new Error(error.name === "TimeoutError" ? "The helper timed out." : "Cannot reach desk-service.py on port 8766.");
  }
  const result = await response.json();
  if (!response.ok) throw new Error(result.error?.message || "Helper returned HTTP " + response.status);
  return result;
}

export async function readJournal(keys = null, store) {
  store ??= (await settings()).store;
  if (store.type === "sqlite") return helper("/journal/read", {path: store.path, keys});
  const records = await api.storage.local.get(keys);
  return Object.fromEntries(Object.entries(records).filter(([key]) => recordKey.test(key)));
}

let pending = Promise.resolve();
export function serial(job) {
  const result = pending.then(job);
  pending = result.catch(() => {});
  return result;
}

export async function writeJournal(records, store) {
  if (store.type === "profile") return api.storage.local.set(records);
  await helper("/journal/write", {path: store.path, records});
  await api.storage.local.set({journalRevision: crypto.randomUUID()});
}

export async function importReplay(input) {
  const replay = stable(validate(input));
  const hash = await crypto.subtle.digest("SHA-256",new TextEncoder().encode("autoscript/" + replay.id));
  const id = "replay-" + Array.from(new Uint8Array(hash), b => b.toString(16).padStart(2,"0")).join("");
  const key = "clip:" + id, store = (await settings()).store;
  const now = new Date();
  const day = [now.getFullYear(),now.getMonth()+1,now.getDate()].map(v => String(v).padStart(2,"0")).join("-");
  const clip = {id, day, createdAt:now.toISOString(), kind:"replay", source:{title:replay.title,url:""},
    text:describe(replay), replay};
  const existing = (await readJournal([key],store))[key];
  if (existing) {
    if (existing.kind !== "replay" || !sameReplay(existing.replay, replay))
      throw new Error("A different submission already uses this replay ID.");
    return {id,day:existing.day};
  }
  // The worker serializes profile writes. SQLite repeats the comparison inside its write transaction.
  await writeJournal({[key]:clip},store);
  return {id,day};
}

export function entryKeys(id) {
  if (typeof id !== "string" || !/^[A-Za-z0-9_-]+$/.test(id)) throw new Error("Invalid entry ID.");
  return ["clip:", "note:", "questions:"].map(prefix => prefix + id);
}

export function validatePanelDraft({clip, turns}) {
  if (!clip || clip.kind === "replay" || !/^[0-9a-f]{32}$/.test(clip.id) || typeof clip.text !== "string" ||
      typeof clip.source?.url !== "string" || !Array.isArray(turns) ||
      turns.some(t => !t || typeof t.turnId !== "string" || typeof t.text !== "string")) {
    throw new Error("Invalid panel draft.");
  }
  if (clip.kind === "image") validateImage(clip.image);
}

// A disk click commits the entire snapshot. Stable turn IDs make retries additive.
export async function savePanelDraft(draft, store, signal) {
  validatePanelDraft(draft);
  const {clip, turns} = draft;
  const [clipKey, noteKey, questionsKey] = entryKeys(clip.id);
  const existing = await readJournal([clipKey, noteKey, questionsKey], store);
  const records = {[clipKey]: existing[clipKey] || clip};
  const questions = existing[questionsKey] || [];
  const seen = new Set(questions.map(turn => turn.turnId));
  if (existing[noteKey]) seen.add(existing[noteKey].turnId);
  const additions = turns.filter(turn => !seen.has(turn.turnId));
  if (!existing[noteKey] && !questions.length && additions[0]?.kind === "explanation") {
    records[noteKey] = additions.shift();
  }
  if (additions.length) records[questionsKey] = [...questions, ...additions];
  signal?.throwIfAborted();
  await writeJournal(records, store);
}

export async function editEntry(action, id) {
  const keys = entryKeys(id);
  const store = (await settings()).store;
  const now = new Date();
  const newId = crypto.randomUUID().replaceAll("-", "");
  const date = [now.getFullYear(), now.getMonth() + 1, now.getDate()].map(x => String(x).padStart(2, "0")).join("-");
  const stamp = {id: newId, day: date, createdAt: now.toISOString(), splitFrom: id};
  if (store.type === "sqlite") {
    await helper("/journal/" + action, {path: store.path, id, stamp});
    await api.storage.local.set({journalRevision: crypto.randomUUID()});
  } else if (action === "delete") {
    await api.storage.local.remove(keys);
  } else {
    const source = await readJournal(keys, store);
    if (!source[keys[0]]) throw new Error("This entry was deleted.");
    const dest = entryKeys(newId);
    const records = {[dest[0]]: {...source[keys[0]], ...stamp}};
    for (const i of [1, 2]) if (source[keys[i]]) records[dest[i]] = source[keys[i]];
    await api.storage.local.set(records);
  }
  return action === "split" ? stamp : {id};
}

function mergedProfile(old, records) {
  const result = {};
  for (const [key, value] of Object.entries(records)) {
    if (!(key in old)) result[key] = value;
    else if (key.startsWith("questions:")) {
      const seen = new Set(old[key].map(q => JSON.stringify(q)));
      result[key] = [...old[key], ...value.filter(q => !seen.has(JSON.stringify(q)))];
    } else if (key.startsWith("clip:") && value.kind === "replay" && old[key].kind === "replay" &&
        sameReplay(value.replay, old[key].replay)) {
      continue;
    } else if (JSON.stringify(old[key]) !== JSON.stringify(value)) {
      throw new Error("Conflicting journal record " + key + ". Open the destination without copying.");
    }
  }
  return result;
}

export async function changeStore({type, path = "", folder = "", copy}) {
  if (!["profile", "sqlite"].includes(type)) throw new Error("Choose a journal store.");
  if (folder && !/^(\/|~\/|[A-Za-z]:[\\/])/.test(folder)) throw new Error("Enter an absolute output directory or ~/ path.");
  const previous = (await settings()).store;
  if (folder) folder = (await helper("/folder", {folder})).path;
  const switching = previous.type !== type || (type === "sqlite" && previous.path !== path);
  const records = copy && switching ? await readJournal(null, previous) : {};
  const next = {type, path, folder};
  let imported = {};
  if (type === "sqlite") {
    if (switching) next.path = (await helper("/journal/open", {path, records})).path;
    else await helper("/journal/read", {path, keys: []});
  } else if (switching && copy) {
    imported = mergedProfile(await readJournal(null, next), records);
  }
  await api.storage.local.set({...imported, journalStore: next});
  return next;
}

export function routeId(route) {
  return JSON.stringify([route.provider, route.model, route.port]);
}

export async function testRoute({provider, model = "", port = 8765}, findModel) {
  if (!Object.hasOwn(LABELS, provider)) throw new Error("Choose a model provider.");
  port = Number(port);
  if (provider === "local") {
    if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error("Enter a valid local port.");
    const base = "http://127.0.0.1:" + port;
    const detected = await findModel(base, model.trim());
    return {provider, port, model: detected, detected, imageInput: await probeLocalImage(base, detected)};
  }
  model = model.trim();
  if (!model) throw new Error("Enter the exact model ID from your provider account.");
  const result = await helper("/model/test", {provider, model}, undefined, 100000);
  return {provider, model, port: 8765, imageInput: provider === "openrouter" && result.imageInput === true};
}
