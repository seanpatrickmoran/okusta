import {localAdapter, probeAdapter} from "./collection-agent.js";
import {LABELS as labels} from "./journal.js";
const api = globalThis.browser ?? chrome;
const byId = id => document.getElementById(id);
const suggestedModels = {groq: "openai/gpt-oss-120b", gemini: "gemini-3.5-flash-lite", openrouter: "openrouter/free"};
let saved, helperInfo = null;
const modelDrafts = new Map();
let shownProvider = "local";

const appearance = byId("dark-mode");
globalThis.okustaAppearance.watch(document.documentElement, dark => { appearance.checked = dark; });
appearance.addEventListener("change", async () => {
  appearance.disabled = true;
  try {
    await globalThis.okustaAppearance.setDark(appearance.checked);
    outcome("appearance-status", "");
  } catch (error) {
    appearance.checked = document.documentElement.dataset.theme === "dark";
    outcome("appearance-status", "Could not save dark mode. " + error.message, true);
  } finally {
    appearance.disabled = false;
  }
});

const recording = byId("autorecord");
let storedRecording = false;
globalThis.okustaAppearance.watchBoolean("autorecord", on => {
  storedRecording = on;
  recording.checked = on;
});
recording.addEventListener("change", async () => {
  recording.disabled = true;
  try {
    await api.storage.local.set({autorecord: recording.checked});
    outcome("record-status", "");
  } catch (error) {
    recording.checked = storedRecording;
    outcome("record-status", "Could not save recording preference. " + error.message, true);
  } finally { recording.disabled = false; }
});

async function send(type, fields = {}) {
  const response = await api.runtime.sendMessage({type, ...fields});
  if (!response?.ok) throw new Error(response?.error || "Reload the journal tab.");
  return response.value;
}

function outcome(id, text, error = false) {
  const node = byId(id);
  node.textContent = text;
  node.dataset.error = String(error);
}

function onClick(id, result, action) {
  byId(id).addEventListener("click", async () => {
    const group = byId(id).closest("fieldset");
    if (group.disabled) return;
    group.disabled = true;
    outcome(result, "Working…");
    try { outcome(result, await action()); }
    catch (error) { outcome(result, error.message, true); }
    finally { group.disabled = false; }
  });
}

function showStore() {
  const sqlite = byId("store-type").value === "sqlite";
  byId("sqlite-fields").hidden = !sqlite;
  byId("copy-label").hidden = !saved || byId("store-type").value === saved.store.type &&
    (!sqlite || byId("db-path").value.trim() === saved.store.path);
}

function showModel() {
  const provider = byId("provider").value;
  if (provider !== shownProvider) {
    modelDrafts.set(shownProvider, byId("model-id").value);
    byId("model-id").value = modelDrafts.get(provider) ?? suggestedModels[provider] ?? "";
    shownProvider = provider;
  }
  byId("qwen-fields").hidden = provider !== "local";
  byId("hosted-fields").hidden = provider === "local";
  byId("credential-hint").textContent = helperInfo?.keys[provider]
    ? "Provider key available on the helper." : "Set " + provider.toUpperCase() + "_API_KEY or add this provider to the helper keys file.";
}

function shellArg(value) {
  return "'" + String(value).replaceAll("'", "'\"'\"'") + "'";
}

function displayLimits(limits) {
  byId("note-tokens").value = limits.noteTokens;
  byId("question-tokens").value = limits.questionTokens;
  byId("context-tokens").value = limits.contextTokens;
  byId("gpu-gb").value = limits.gpuGB;
  byId("launch-command").textContent = "OKUSTA_CONTEXT=" + limits.contextTokens +
    " OKUSTA_GPU_GB=" + (limits.gpuGB || "auto") + " OKUSTA_PORT=" +
    (saved.route.provider === "local" ? saved.route.port : 8765) + " bash scripts/start-local.sh" +
    (saved.route.provider === "local" && saved.route.model ? " " + shellArg(saved.route.model) : "");
}

function activeLabels() {
  const {store, route, adapter} = saved;
  byId("active-adapter").textContent = adapter ? adapter.model + " · 127.0.0.1:" + adapter.port : "Disconnected";
  byId("clear-adapter").hidden = !adapter;
  byId("active-store").textContent = (store.type === "sqlite" ? store.path : "This extension’s storage in the current browser profile") +
    " · Exports to " + (store.folder || "browser downloads");
  byId("active-model").textContent = "Send uses " + labels[route.provider] + " · " +
    (route.provider === "local" ? "127.0.0.1:" + route.port + (route.model ? " · " + route.model : "") : route.model) +
    (route.imageInput ? " · Image input ready" : "") +
    (route.verifiedAt ? " · Last verified " + new Date(route.verifiedAt).toLocaleString() : "");
  byId("reset-model").hidden = route.provider === "local" && route.port === 8765 && !route.model;
}

async function load() {
  saved = await send("settings-get");
  displayLimits(saved.limits);
  byId("adapter-name").value = saved.adapter?.model || "collection";
  byId("adapter-port").value = saved.adapter?.port || 8765;
  byId("store-type").value = saved.store.type;
  byId("db-path").value = saved.store.path;
  byId("export-folder").value = saved.store.folder;
  byId("provider").value = saved.route.provider;
  for (const [provider, model] of Object.entries(saved.modelIds)) modelDrafts.set(provider, model);
  byId("qwen-port").value = saved.route.provider === "local" ? saved.route.port : 8765;
  byId("local-model").value = saved.route.provider === "local" ? saved.route.model : saved.modelIds.local || "";
  showModel();
  byId("model-id").value = saved.route.model;
  showStore();
  activeLabels();
}

async function checkHelper(type = "helper-status", fields) {
  helperInfo = null;
  try {
    helperInfo = await send(type, fields);
    if (helperInfo.credentialError) return "Paired. " + helperInfo.credentialError;
    return (helperInfo.hosted ?? helperInfo.sdk) ? "Paired. Hosted models available." : "Paired. Restart the updated helper to use hosted models.";
  } finally { showModel(); }
}

const toggle = byId("toggle-settings");
toggle.addEventListener("click", async () => {
  const open = byId("settings-body").hidden;
  byId("settings-body").hidden = !open;
  toggle.setAttribute("aria-expanded", String(open));
  document.querySelector(".workspace").classList.toggle("settings-open", open);
  if (!open) { byId("pair-token").value = ""; return; }
  try { await load(); }
  catch (error) { outcome("store-result", error.message, true); return; }
  try { outcome("helper-result", await checkHelper()); }
  catch (error) { outcome("helper-result", error.message); }
});
byId("settings-body").addEventListener("keydown", event => {
  if (event.key === "Escape") { toggle.click(); toggle.focus(); }
});
byId("close-journal").addEventListener("click", async () => {
  const tab = await api.tabs.getCurrent();
  if (tab?.id != null) await api.tabs.remove(tab.id);
});
byId("provider").addEventListener("change", () => { showModel(); outcome("model-result", ""); });
byId("store-type").addEventListener("change", showStore);
byId("db-path").addEventListener("input", showStore);
onClick("pair", "helper-result", async () => {
  if (api.runtime.getManifest?.().browser_specific_settings?.gecko &&
      !await api.permissions.request({data_collection: ["authenticationInfo"]})) {
    throw new Error("Firefox needs permission to send the helper its pairing token.");
  }
  const msg = await checkHelper("helper-pair", {token: byId("pair-token").value});
  byId("pair-token").value = "";
  return msg;
});
onClick("check-helper", "helper-result", () => checkHelper());
onClick("save-limits", "limits-result", async () => {
  const result = await send("qwen-save-limits", {limits: {
    noteTokens: byId("note-tokens").value, questionTokens: byId("question-tokens").value,
    contextTokens: byId("context-tokens").value, gpuGB: byId("gpu-gb").value
  }});
  saved.limits = result.limits;
  displayLimits(result.limits);
  byId("launch-details").open = Boolean(result.launchManually);
  if (result.launchManually) {
    return "Reply limits saved. " + result.launchManually + " Use the launch command below on the vLLM machine.";
  }
  return "Reply limits saved. Restart your vLLM launcher with the launch command to load " + result.path + ".";
});
onClick("save-store", "store-result", async () => {
  saved.store = await send("journal-store", {typeName: byId("store-type").value,
    path: byId("db-path").value.trim(), folder: byId("export-folder").value.trim(), copy: byId("copy-records").checked});
  byId("db-path").value = saved.store.path;
  showStore(); activeLabels();
  return "Journal location saved.";
});
onClick("use-model", "model-result", async () => {
  const provider = byId("provider").value;
  saved.route = await send("model-use", {provider, model: byId(provider === "local" ? "local-model" : "model-id").value.trim(),
    port: byId("qwen-port").value});
  activeLabels(); displayLimits(saved.limits);
  if (provider !== "local") { if (helperInfo) helperInfo.keys[provider] = true; showModel(); }
  return "Verified " + (saved.route.detected || saved.route.model) + ". Ready to send." +
    (saved.route.imageInput ? " Image input ready." : " Text input only.");
});
onClick("reset-model", "model-result", async () => {
  await send("model-reset");
  await load();
  return "Send uses the local server on port 8765.";
});
onClick("use-adapter", "adapter-result", async () => {
  const route = localAdapter(byId("adapter-name").value, byId("adapter-port").value);
  const parent = await probeAdapter(route);
  saved.adapter = await send("adapter-use", route);
  activeLabels();
  return "Native tool call received · base model " + parent;
});
onClick("clear-adapter", "adapter-result", async () => {
  await send("adapter-clear");
  saved.adapter = null; activeLabels();
  return "Adapter disconnected.";
});
function markdown(records) {
  const clips = Object.entries(records).filter(([key]) => key.startsWith("clip:"))
    .map(([, clip]) => clip).sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  const lines = ["# Okusta journal", ""];
  let day;
  for (const clip of clips) {
    if (clip.day !== day) { day = clip.day; lines.push("## " + day, ""); }
    lines.push("### " + (clip.source.title || "Prompt"), "", clip.createdAt, "");
    if (clip.kind === "prompt") lines.push(clip.prompt || "", "");
    else if (clip.kind === "image") {
      const {width, height, dataUrl} = clip.image;
      lines.push(clip.source.url, "", "![Screenshot crop, " + width + " × " + height + "](" + dataUrl + ")", "");
    } else if (clip.kind === "html") {
      const runs = clip.text.match(/`+/g) || [];
      const fence = "`".repeat(runs.reduce((width, run) => Math.max(width, run.length + 1), 3));
      lines.push(clip.source.url, "", fence + "html", clip.text, fence, "");
    } else lines.push(clip.source.url, "", ...clip.text.split(/\r?\n/).map(line => "> " + line), "");
    if (clip.instruction) lines.push("Instruction", "", clip.instruction, "");
    const note = records["note:" + clip.id];
    if (note) {
      lines.push("**" + note.model + "**", "", note.text, "");
      if (note.finishReason === "length") lines.push("_Partial answer · token limit reached_", "");
    }
    for (const reply of records["questions:" + clip.id] || []) {
      lines.push("**" + (reply.question || "Regenerated explanation") + "**", "", reply.text, "", "Model · " + reply.model, "");
      if (reply.finishReason === "length") lines.push("_Partial answer · token limit reached_", "");
    }
  }
  const collections = Object.entries(records).filter(([key]) => key.startsWith("collection:"));
  if (collections.length) lines.push("## Collections", "");
  for (const [, collection] of collections) {
    lines.push("### " + collection.name, "", collection.criterion, "");
    for (const id of collection.members) {
      const clip = records["clip:" + id];
      lines.push("- " + (clip ? clip.source?.title || clip.prompt || "Untitled clipping" : "Unavailable clipping") + " (" + id + ")");
    }
    lines.push("");
  }
  return lines.join("\n");
}

for (const format of ["md", "json"]) {
  onClick("export-" + format, "store-result", async () => {
    const records = await send("journal-read");
    const text = format === "md" ? markdown(records) : JSON.stringify({version: 1, records}, null, 2) + "\n";
    if (saved.store.folder) return "Exported to " + (await send("journal-export", {format, text})).path;
    const link = document.createElement("a");
    const url = URL.createObjectURL(new Blob([text], {type: format === "md" ? "text/markdown" : "application/json"}));
    link.href = url;
    link.download = "okusta-" + new Date().toISOString().replace(/[:.]/g, "-") + "." + format;
    document.body.append(link); link.click(); link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 60000);
    return "Sent " + link.download + " to browser downloads.";
  });
}
