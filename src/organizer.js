import {clipTitle, organize} from "./collection-agent.js";
const api = globalThis.browser ?? chrome;
const el = id => document.getElementById(id);
const pick = el("collection-pick"), status = el("organize-status"), trace = el("organize-trace");
let store, controller, adapter, selected = new Set();

function buttonState() {
  const full = selected.size >= 12;
  for (const input of pick.querySelectorAll("input")) input.disabled = full && !input.checked;
  el("organize-start").disabled = !adapter || !selected.size || !el("collection-name").value.trim() ||
    !el("collection-goal").value.trim() || !!controller;
}
function showAdapter(value) {
  if (controller && (adapter?.model !== value?.model || adapter?.port !== value?.port)) controller.abort();
  adapter = value;
  if (!controller && !trace.childElementCount) status.textContent = adapter ? "" : "Connect a collection adapter in Settings.";
  buttonState();
}
api.storage.onChanged.addListener((changes, area) => {
  if (area === "local" && changes.collectionAdapter) showAdapter(changes.collectionAdapter.newValue);
  if (area === "local" && changes.journalStore) controller?.abort();
});
api.storage.local.get("collectionAdapter").then(d => showAdapter(d.collectionAdapter)).catch(e => { status.textContent = e.message; });
for (const id of ["collection-name", "collection-goal"]) el(id).addEventListener("input", buttonState);
pick.addEventListener("change", e => {
  if (e.target.checked) selected.add(e.target.value); else selected.delete(e.target.value);
  buttonState();
});
el("organize-stop").onclick = () => controller?.abort();
window.addEventListener("pagehide", () => controller?.abort());

function node(tag, text) {
  const element = document.createElement(tag);
  if (text !== undefined) element.textContent = text;
  return element;
}
export function clearOrganizer() {
  controller?.abort(); store = null; selected.clear();
  pick.replaceChildren(); el("saved-collections").replaceChildren(); buttonState();
}
export function updateOrganizer(clips, records, active) {
  if (store && (store.type !== active.type || store.path !== active.path)) {
    clearOrganizer(); trace.replaceChildren(); status.textContent = "";
  }
  store = active;
  const available = clips.filter(c => c.kind !== "replay");
  const ids = new Set(available.map(c => c.id));
  selected = new Set([...selected].filter(id => ids.has(id)));
  pick.replaceChildren(...available.map(c => {
    const label = node("label"), input = node("input");
    input.type = "checkbox"; input.value = c.id; input.checked = selected.has(c.id);
    label.append(input, document.createTextNode(clipTitle(c) + " · " + new Date(c.createdAt).toLocaleString()));
    return label;
  }));
  if (!available.length) pick.textContent = "Save a clipping to start a collection.";
  const collections = Object.entries(records).filter(([key]) => key.startsWith("collection:")).map(([, v]) => v)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  const box = el("saved-collections");
  const expanded = new Set([...box.querySelectorAll("details[open]")].map(d => d.dataset.id));
  box.replaceChildren(...collections.map(c => {
    const details = node("details"); details.dataset.id = c.id; details.open = expanded.has(c.id);
    details.append(node("summary", c.name + " (" + c.members.length + ")"), node("p", c.criterion));
    const list = node("ul");
    for (const id of c.members) {
      const li = node("li"), clip = records["clip:" + id];
      if (clip) { const link = node("a", clipTitle(clip)); link.href = "#entry-" + id; li.append(link); }
      else li.textContent = "Deleted clipping";
      list.append(li);
    }
    details.append(list); return details;
  }));
  buttonState();
}

async function send(type, fields) {
  const response = await api.runtime.sendMessage({type, ...fields});
  if (!response?.ok) throw new Error(response?.error || "Reload the journal.");
  return response.value;
}

el("organize-start").onclick = async () => {
  if (controller || !store) return;
  controller = new AbortController();
  const signal = controller.signal;
  const name = el("collection-name").value.trim(), criterion = el("collection-goal").value.trim();
  const selection = [...selected];
  let wrote = false;
  trace.replaceChildren(); status.textContent = "Connecting to the collection adapter…";
  el("organize-inputs").disabled = true; el("organize-stop").hidden = false;
  try {
    const run = await send("collection-begin", {ids: selection, store});
    signal.throwIfAborted();
    const destination = {id: crypto.randomUUID().replaceAll("-", ""), name, criterion, selection, ...run.adapter};
    const fields = {destination, store: run.store};
    status.textContent = "Organizing with " + run.adapter.model + "…";
    const count = await organize({route: run.adapter, name, criterion, clips: run.clips, signal,
      save: async ids => { await send("collection-save", {...fields, ids}); wrote = true; },
      open: () => send("collection-open", fields),
      report(turn, action, observation) {
        let line;
        if (observation.error) line = action.op + " · " + observation.error;
        else if (action.op === "search") line = "Search “" + action.query + "” · " + observation.hits.length + " found";
        else if (action.op === "inspect") line = "Read “" + observation.title + "”";
        else if (action.op === "save") line = "Save · " + action.ids.length + " requested";
        else if (action.op === "open") line = "Read journal storage · " + (observation.members.map(m => m.title).join(", ") || "empty");
        else line = "Finish";
        trace.append(node("li", line));
      }});
    status.textContent = "Checked “" + name + "” against journal storage · " + count + (count === 1 ? " member." : " members.");
  } catch (e) {
    status.textContent = (signal.aborted ? "Stopped." : e.message) +
      (wrote ? " The last save is in the journal. Verification did not finish." : "");
  } finally {
    controller = null; el("organize-inputs").disabled = false; el("organize-stop").hidden = true; buttonState();
  }
};
