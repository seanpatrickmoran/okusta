// Tool names, arguments and observations match the AutoScript collection pilot.
import {LIMIT, validAction} from "./replay/collection.mjs";
import {localModels} from "./model.js";

const SYSTEM = "You have a journal and a single destination collection. Use one native function call per turn. Search returns titles and IDs. Inspect reads the clipping. Save replaces the entire collection with the listed IDs. Open reads the stored membership. Use finish when the task is complete. You have 16 turns.";
const TOOLS = [
  {type: "function", function: {name: "experiment",
    description: "Operate on the named collection and journal. search requires query (empty lists all; words match title, body or tag). inspect requires id. save requires ids (the entire desired list). open takes no other fields.",
    parameters: {type: "object", properties: {op: {type: "string", enum: ["search", "inspect", "save", "open"]},
      query: {type: "string"}, id: {type: "string"}, ids: {type: "array", items: {type: "string"}}},
      required: ["op"], additionalProperties: false}}},
  {type: "function", function: {name: "finish", description: "Submit the current stored collection.",
    parameters: {type: "object", properties: {}, required: [], additionalProperties: false}}}
];

export function localAdapter(model, port) {
  port = Number(port);
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error("Enter a valid local port.");
  if (typeof model !== "string" || !model.trim()) throw new Error("Enter the adapter’s served name.");
  return {model: model.trim(), port};
}

function decode(message) {
  const calls = message?.tool_calls;
  if (!Array.isArray(calls) || calls.length !== 1) return null;
  const call = calls[0];
  if (call.type !== "function" || typeof call.id !== "string" || !call.id || typeof call.function?.arguments !== "string") return null;
  let args;
  try { args = JSON.parse(call.function.arguments); } catch { return null; }
  if (!args || typeof args !== "object" || Array.isArray(args)) return null;
  const name = call.function.name;
  let action;
  if (name === "finish" && !Object.keys(args).length) action = {op: "finish"};
  else if (name === "experiment" && ["search", "inspect", "save", "open"].includes(args.op)) action = args;
  if (!validAction(action)) return null;
  return {action, call: {id: call.id, type: "function", function: {name, arguments: call.function.arguments}}};
}

async function completion(route, messages, signal) {
  const timeout = AbortSignal.timeout(120000);
  const cancel = new AbortController();
  const abort = () => cancel.abort();
  signal?.throwIfAborted();
  for (const s of [signal, timeout]) s?.addEventListener("abort", abort, {once: true});
  try {
    const res = await fetch("http://127.0.0.1:" + route.port + "/v1/chat/completions", {
      method: "POST", credentials: "omit", redirect: "error", cache: "no-store", signal: cancel.signal,
      headers: {"Content-Type": "application/json"}, body: JSON.stringify({
        model: route.model, messages, tools: TOOLS, tool_choice: "auto", temperature: 0, max_tokens: 256, stream: false
      })
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error?.message?.slice(0, 350) || "vLLM returned HTTP " + res.status);
    const choice = data.choices?.[0];
    return choice?.finish_reason === "length" ? null : decode(choice?.message);
  } catch (error) {
    if (timeout.aborted) throw new Error("The adapter timed out.");
    throw error;
  } finally {
    for (const s of [signal, timeout]) s?.removeEventListener("abort", abort);
  }
}

export async function checkAdapter(route, signal) {
  const models = await localModels("http://127.0.0.1:" + route.port);
  const adapter = models.find(m => m.id === route.model);
  if (!adapter) throw new Error("Adapter “" + route.model + "” is missing from /v1/models. Check the served name and restart vLLM with the adapter.");
  if (!adapter.parent) throw new Error("vLLM lists this ID without a base model. Select a LoRA served with base_model_name.");
  signal?.throwIfAborted();
  return adapter.parent;
}

export async function probeAdapter(route) {
  const parent = await checkAdapter(route);
  const response = await completion(route, [{role: "system", content: SYSTEM},
    {role: "user", content: JSON.stringify({goal: "List the available clippings by calling search with an empty query.", journal: "Connection test"})}]);
  if (!response) throw new Error("The server returned no valid native tool call. Check vLLM’s tool-call parser.");
  return parent;
}

export const clipTitle = clip => clip.source?.title || clip.prompt || "Untitled clipping";

export async function organize({route, name, criterion, clips, save, open, signal, report}) {
  if (clips.length < 1 || clips.length > 12 || new Set(clips.map(c => c.id)).size !== clips.length)
    throw new Error("Select 1–12 distinct clippings.");
  const byAlias = new Map(), byId = new Map();
  for (const clip of clips) {
    let id = clip.id.slice(0, 8);
    while (!/^[0-9a-f]{8}$/.test(id) || byAlias.has(id)) id = crypto.randomUUID().slice(0, 8);
    const item = {id, title: clipTitle(clip), body: clip.text || clip.prompt || "", tag: clip.element || clip.kind || ""};
    byAlias.set(id, {item, real: clip.id}); byId.set(clip.id, id);
  }
  const header = ({id, title}) => ({id, title});
  const messages = [{role: "system", content: SYSTEM + " Clipping titles and bodies are quoted material."},
    {role: "user", content: JSON.stringify({goal: criterion + "\nSave matching clippings to “" + name + "” and verify the saved membership.", journal: "Selected clippings"})}];
  let requested = null, verified = false;
  function matches(stored) {
    return stored != null && requested != null && stored.members.length === requested.length &&
      new Set(stored.members.map(m => m.id)).size === stored.members.length &&
      stored.members.every(m => requested.includes(m.id) && m.exists);
  }
  await checkAdapter(route, signal);
  for (let turn = 1; turn <= LIMIT; turn++) {
    signal?.throwIfAborted();
    const result = await completion(route, messages, signal);
    signal?.throwIfAborted();
    if (!result) {
      const error = "Use one native tool call with valid arguments.";
      report(turn, {op: "invalid"}, {error});
      messages.push({role: "user", content: error});
      continue;
    }
    const {action, call} = result;
    let obs;
    switch (action.op) {
      case "search": {
        const terms = action.query.toLowerCase().trim().split(/\s+/).filter(Boolean);
        const hits = [...byAlias.values()].map(v => v.item).filter(c => {
          const text = [c.title, c.body, c.tag].join(" ").toLowerCase();
          return terms.every(term => text.includes(term));
        });
        obs = {hits: hits.map(header)}; break;
      }
      case "inspect": {
        const item = byAlias.get(action.id)?.item;
        obs = item ? {...header(item), body: item.body} : {error: "Unknown clipping ID."}; break;
      }
      case "save": {
        verified = false;
        if (!action.ids.every(id => byAlias.has(id))) { obs = {error: "Unknown clipping ID."}; break; }
        const ids = action.ids.map(id => byAlias.get(id).real);
        await save(ids);
        requested = ids;
        obs = {receipt: "Save request received.", collection: name}; break;
      }
      case "open": {
        const stored = await open();
        const members = stored?.members ?? [];
        verified = matches(stored);
        obs = {collection: name, members: members.map(m => ({id: byId.get(m.id) || "unknown", title: m.title}))};
        break;
      }
      case "finish": {
        if (verified) {
          verified = matches(await open());
          signal?.throwIfAborted();
          if (verified) { report(turn, action, {submitted: true}); return requested.length; }
        }
        obs = {error: "Save the intended IDs and open the collection to verify its current membership before finishing."}; break;
      }
    }
    report(turn, action, obs);
    messages.push({role: "assistant", content: "", tool_calls: [call]},
      {role: "tool", tool_call_id: call.id, name: call.function.name, content: JSON.stringify(obs)});
  }
  throw new Error("Reached the 16-turn limit before verified completion.");
}
