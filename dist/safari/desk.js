import {updateOrganizer, clearOrganizer} from "./organizer.js";
import {makePayload, validateImage} from "./model.js";
import {player} from "./replay/players.js";
import {journalNavigation} from "./journal-navigation.js";
const api = globalThis.browser ?? chrome;
const days = document.querySelector("#days");
const clips = document.querySelector("#clips");
const navigation = journalNavigation(days, clips);
const heading = document.querySelector("#heading");
const empty = document.querySelector("#empty");
const status = document.querySelector("#status");
const dateFormat = new Intl.DateTimeFormat(undefined, {dateStyle: "long"});
const shortDate = new Intl.DateTimeFormat(undefined, {month: "short", day: "numeric", year: "numeric"});
const timeFormat = new Intl.DateTimeFormat(undefined, {timeStyle: "short"});

const graphemes = new Intl.Segmenter(undefined, {granularity: "grapheme"});
const openDays = new Set();
let openComposer, openedReplay;
const replayFile = document.querySelector("#replay-file");
document.querySelector("#import-replay").onclick = () => replayFile.click();
replayFile.onchange = async () => {
  try {
    const file = replayFile.files[0];
    if (!file) return;
    if (file.size > 65536) throw new Error("Replay file exceeds 64 KiB.");
    const reply = await api.runtime.sendMessage({type:"journal-import-replay",replay:JSON.parse(await file.text())});
    if (!reply?.ok) throw new Error(reply?.error || "Import failed.");
    openedReplay = reply.value.id;
    openDays.add(reply.value.day);
    await render();
    const article = document.getElementById("entry-" + reply.value.id);
    if (article) navigation.jumpTo(article, false);
  } catch (err) { status.textContent = err.message; }
  finally { replayFile.value = ""; }
};
const drafts = new Map();
let refreshNumber = 0;
let modelState = "offline", generating = false, polling = false;
let modelLabel = "Local model", expectedRoute;
let preview = null;
const replyViews = new Map();
const dot = document.querySelector("#model-dot");

function updateModelControls() {
  const state = generating ? "busy" : modelState;
  dot.dataset.state = state;
  dot.title = modelLabel + " · " + state;
  dot.setAttribute("aria-label", dot.title);
  for (const button of clips.querySelectorAll("button.regenerate")) {
    button.disabled = state !== "idle";
    if (!generating) button.textContent = "Regenerate with " + modelLabel;
  }
}

async function pollModel() {
  if (polling || document.hidden) return;
  polling = true;
  try {
    const response = await api.runtime.sendMessage({type: "qwen-status"});
    const info = response?.value;
    expectedRoute = info?.routeId;
    modelLabel = info?.model || info?.label || "Local model";
    modelState = info?.state ?? "offline";
  } catch {
    modelState = "offline";
  } finally {
    polling = false;
    updateModelControls();
  }
}

function showPreview() {
  const view = replyViews.get(preview?.id);
  if (!view) return;
  view.block.hidden = false;
  view.block.setAttribute("aria-busy", String(generating));
  view.text.textContent = preview.text;
  if (view.run) view.run.textContent = generating ? "Running…" : "Regenerate with " + modelLabel;
}

async function runSavedClip(id, question, viewKey, regenerate, followup = false) {
  if (generating) return;
  generating = true;
  if (preview && replyViews.has(preview.id)) replyViews.get(preview.id).block.hidden = true;
  preview = {id: viewKey, text: "Waiting for " + modelLabel + "…"};
  status.textContent = "";
  updateModelControls();
  showPreview();
  try {
    await globalThis.okustaReply(id, text => {
      preview.text = text;
      showPreview();
    }, question, expectedRoute, regenerate, followup);
    if (followup) { drafts.delete(id); openComposer = null; }
    preview = null;
    await render();
  } catch (error) {
    preview.text = "Could not generate an explanation. " + error.message;
  } finally {
    generating = false;
    showPreview();
    updateModelControls();
    pollModel();
  }
}

function el(tag, text) {
  const node = document.createElement(tag);
  if (text) node.textContent = text;
  return node;
}

function localDate(day) {
  const [y, m, d] = day.split("-").map(Number);
  return new Date(y, m - 1, d, 12);
}

const actionPaths = {
  text: "M3 5h18M3 10h12M3 15h8M14 20l1-5 5-5 3 3-5 5z",
  split: "M6 20v-5c0-3 2-4 5-5l5-2V3m-4 4 4-4 4 4M6 15V4m-3 3 3-3 3 3",
  delete: "M4 6h16M9 6V3h6v3M6 6l1 15h10l1-15M10 10v7m4-7v7"
};

function actionButton(icon, label) {
  const button = el("button");
  button.type = "button"; button.className = "entry-action";
  button.title = label; button.setAttribute("aria-label", label);
  const ns = "http://www.w3.org/2000/svg";
  const svg = document.createElementNS(ns, "svg");
  svg.setAttribute("viewBox", "0 0 24 24"); svg.setAttribute("aria-hidden", "true");
  const path = document.createElementNS(ns, "path");
  path.setAttribute("d", actionPaths[icon]); svg.append(path); button.append(svg);
  return button;
}

async function changeEntry(action, clip) {
  if (action === "delete" && !window.confirm("Delete this entry and its replies from the active journal?")) return;
  try {
    const response = await api.runtime.sendMessage({type: "journal-" + action, id: clip.id});
    if (!response?.ok) throw new Error(response?.error || "The journal is unavailable.");
    if (action === "split") {
      const branch = response.value;
      openDays.add(branch.day);
      openComposer = branch.id;
      await render();
      const article = document.getElementById("entry-" + branch.id);
      if (article) navigation.jumpTo(article, false);
      document.getElementById("prompt-" + branch.id)?.focus();
    } else {
      drafts.delete(clip.id);
      if (openComposer === clip.id) openComposer = null;
      await render();
    }
  } catch (error) { status.textContent = error.message; }
}

function renderClip(clip, expanded, note, questions = []) {
  const article = el("article");
  article.id = "entry-" + clip.id;
  article.tabIndex = -1;
  const meta = el("div");
  meta.className = "meta";
  const free = clip.kind === "prompt";
  const link = el(free ? "strong" : "a", free ? "Prompt" : clip.source.title);
  if (/^https?:\/\//i.test(clip.source.url)) link.href = clip.source.url;
  link.target = "_blank";
  link.rel = "noopener noreferrer";
  const time = el("time", timeFormat.format(new Date(clip.createdAt)));
  time.dateTime = clip.createdAt;
  meta.append(link, time);
  article.append(meta);
  if (clip.splitFrom) meta.append(el("small", "Split entry"));
  if (free) article.append(el("p", clip.prompt));
  else if (clip.kind === "replay") article.append(player(clip.replay, clip.id === openedReplay || expanded.has("replay-" + clip.id)));
  else if (clip.kind === "image") {
    try {
      validateImage(clip.image);
      const img = el("img");
      img.className = "journal-crop";
      img.width = clip.image.width;
      img.height = clip.image.height;
      img.alt = "Screenshot crop from " + (clip.source.title || "the selected page");
      img.loading = "lazy";
      img.src = clip.image.dataUrl;
      article.append(img);
    } catch { article.append(el("p", "The saved screenshot is unavailable.")); }
  } else if (clip.kind === "html") article.append(el("pre", clip.text));
  else article.append(el("blockquote", clip.text));
  if (clip.instruction?.trim()) {
    const instruction = el("p");
    instruction.className = "instruction";
    instruction.append(el("strong", "Instruction "), document.createTextNode(clip.instruction));
    article.append(instruction);
  }
  function addReply(reply, question, viewKey) {
    const saved = el("section");
    saved.className = "model-note";
    saved.title = reply.model;
    saved.append(el("h3", free && question === clip.prompt && viewKey === clip.id + ":0" ? reply.model : question || reply.model), globalThis.okustaRenderMarkdown(reply.text));
    if (question && reply.model) saved.append(el("small", reply.model));
    if (reply.finishReason === "length") saved.append(el("small", "Partial answer · token limit reached"));
    article.append(saved);
    // Older entries have no finish reason, so offer an explicit way to recover a cutoff.
    if (reply.finishReason && reply.finishReason !== "length") return;
    const block = el("section");
    block.className = "model-note";
    const text = el("p");
    block.append(el("h3", question || modelLabel), text);
    block.hidden = true;
    const run = el("button", "Regenerate with " + modelLabel);
    run.className = "regenerate";
    run.disabled = generating || modelState !== "idle";
    run.addEventListener("click", () => runSavedClip(clip.id, question, viewKey, true));
    article.append(block, run);
    replyViews.set(viewKey, {block, text, run});
    if (preview?.id === viewKey) showPreview();
  }
  if (note) addReply(note, "", clip.id);
  questions.forEach((reply, i) => addReply(reply, reply.question || "", clip.id + ":" + i));
  if (!free) {
    const details = el("details");
    details.dataset.clip = clip.id;
    details.open = expanded.has(clip.id);
    const payload = el("pre");
    function inspect() {
      if (details.open && !payload.textContent) payload.textContent = JSON.stringify(clip.kind === "replay" ? clip.replay : makePayload(clip), null, 2);
    }
    inspect();
    details.addEventListener("toggle", inspect);
    details.append(el("summary", clip.kind === "replay" ? "Recorded submission" : "Inspect clipping payload"), payload);
    article.append(details);
  }

  const footer = el("div");
  footer.className = "entry-actions";
  const text = actionButton("text", "Continue this entry");
  const split = actionButton("split", "Split into a new entry");
  const del = actionButton("delete", "Delete entry");
  footer.append(text, split, del);
  const form = el("form");
  form.className = "followup";
  form.hidden = openComposer !== clip.id;
  const field = el("textarea");
  field.id = "prompt-" + clip.id;
  field.setAttribute("aria-label", "Query"); field.rows = 3;
  field.setAttribute("aria-description", "Enter to send. Shift+Enter for a new line.");
  field.enterKeyHint = "send";
  field.value = drafts.get(clip.id) || "";
  text.setAttribute("aria-controls", field.id); text.setAttribute("aria-expanded", String(!form.hidden));
  text.addEventListener("click", async () => {
    openComposer = form.hidden ? clip.id : null;
    await render();
    if (openComposer) document.getElementById("prompt-" + clip.id)?.focus();
    else document.getElementById("continue-" + clip.id)?.focus();
  });
  text.id = "continue-" + clip.id;
  field.addEventListener("input", () => drafts.set(clip.id, field.value));
  field.addEventListener("keydown", event => {
    if (event.key === "Enter" && !event.shiftKey && !event.isComposing) {
      event.preventDefault();
      if (!event.repeat) form.requestSubmit();
    }
  });
  form.addEventListener("submit", event => {
    event.preventDefault();
    const question = field.value.trim();
    if (question && !generating && modelState === "idle") {
      runSavedClip(clip.id, question, clip.id + ":continue", false, true);
    }
  });
  split.addEventListener("click", () => changeEntry("split", clip));
  del.addEventListener("click", () => changeEntry("delete", clip));
  const live = el("div"); live.className = "model-note"; live.hidden = true;
  const liveText = el("p"); live.append(liveText);
  replyViews.set(clip.id + ":continue", {block: live, text: liveText});
  if (preview?.id === clip.id + ":continue") showPreview();
  form.append(field); article.append(footer, form, live);
  return article;
}

function shortTitle(title) {
  let prefix = "", length = 0;
  for (const {segment} of graphemes.segment(title)) {
    if (length === 14) return prefix.trimEnd() + "…";
    prefix += segment;
    length++;
  }
  return prefix;
}

function renderDay(day, records, entries, expandedPayloads) {
  const section = el("section");
  section.className = "journal-day";
  section.id = "day-" + day;
  section.dataset.day = day;
  const header = el("header");
  header.className = "paper-head";
  const title = el("h2", dateFormat.format(localDate(day)));
  title.id = "date-" + day;
  section.setAttribute("aria-labelledby", title.id);
  const total = el("div", records.length + (records.length === 1 ? " entry" : " entries"));
  total.className = "day-count";
  header.append(title, total);
  section.append(header);

  const group = el("div");
  const toggle = el("button", shortDate.format(localDate(day)));
  toggle.type = "button";
  toggle.className = "day-toggle";
  toggle.id = "jump-" + section.id;
  const list = el("ul");
  list.className = "entry-list";
  list.id = "index-" + day;
  list.hidden = !openDays.has(day);
  toggle.setAttribute("aria-expanded", String(!list.hidden));
  toggle.setAttribute("aria-controls", list.id);
  toggle.addEventListener("click", () => {
    list.hidden = !list.hidden;
    toggle.setAttribute("aria-expanded", String(!list.hidden));
    if (list.hidden) {
      openDays.delete(day);
      navigation.collapse(section);
    } else {
      openDays.add(day);
      navigation.jumpTo(section, false);
    }
  });
  group.append(toggle, list);

  for (const clip of records) {
    const article = renderClip(clip, expandedPayloads, entries["note:" + clip.id], entries["questions:" + clip.id]);
    section.append(article);
    const name = (clip.kind === "prompt" ? clip.prompt : clip.source.title)?.trim() ||
      clip.source.url || clip.text?.trim() || "Untitled entry";
    const full = name.replace(/\s+/g, " ");
    const stamp = timeFormat.format(new Date(clip.createdAt));
    const item = el("li");
    const jump = el("button");
    jump.type = "button";
    jump.id = "jump-" + article.id;
    jump.className = "entry-jump";
    jump.setAttribute("aria-label", full + ", " + stamp);
    jump.setAttribute("aria-controls", article.id);
    const label = el("span", shortTitle(full));
    label.className = "short-title";
    const reveal = el("span", full);
    reveal.className = "full-title";
    const time = el("time", stamp);
    time.dateTime = clip.createdAt;
    reveal.append(time);
    jump.append(label, reveal);
    jump.addEventListener("click", () => navigation.jumpTo(article, true));
    item.append(jump);
    list.append(item);
  }
  return {section, group};
}

async function render() {
  const revision = ++refreshNumber;
  try {
    const reply = await api.runtime.sendMessage({type: "journal-snapshot"});
    if (!reply?.ok) throw new Error(reply?.error || "Reload the journal tab.");
    const {records: entries, store} = reply.value;
    if (revision !== refreshNumber) return;
    const all = Object.entries(entries).filter(([k]) => k.startsWith("clip:"))
      .map(([, clip]) => clip).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    updateOrganizer(all, entries, store);
    const grouped = new Map();
    for (const clip of all) {
      if (!grouped.has(clip.day)) grouped.set(clip.day, []);
      grouped.get(clip.day).push(clip);
    }
    const dates = [...grouped.keys()].sort().reverse();
    for (const day of openDays) if (!grouped.has(day)) openDays.delete(day);
    let currentTarget = navigation.current;
    if (!currentTarget || !(all.some(c => currentTarget === "entry-" + c.id) ||
        dates.some(day => currentTarget === "day-" + day))) {
      currentTarget = dates.length ? "day-" + dates[0] : null;
      if (dates.length) openDays.add(dates[0]);
    }
    const focusedJump = document.activeElement?.id?.startsWith("jump-") ? document.activeElement.id : null;
    const expanded = new Set([...clips.querySelectorAll("details[open]")].map(d => d.dataset.clip));
    for (const d of clips.querySelectorAll(".replay-card[open]")) expanded.add("replay-" + d.closest("article").id.slice(6));
    replyViews.clear();
    const groups = dates.map(day => renderDay(day, grouped.get(day), entries, expanded));
    openedReplay = undefined;
    days.replaceChildren(...groups.map(g => g.group));
    clips.replaceChildren(...groups.map(g => g.section));
    navigation.refresh(currentTarget);
    if (focusedJump) document.getElementById(focusedJump)?.focus({preventScroll: true});
    heading.hidden = all.length > 0;
    empty.hidden = all.length > 0;
    status.textContent = "";
  } catch (error) {
    if (revision !== refreshNumber) return;
    clearOrganizer();
    days.replaceChildren(); clips.replaceChildren(); empty.hidden = true; heading.hidden = false;
    navigation.refresh(null);
    status.textContent = "Could not read the journal. " + error.message;
  }
}

api.storage.onChanged.addListener((changes, area) => {
  if (area === "local" && changes.modelRoute) pollModel();
  if (area === "session" && changes.pairing) render();
  if (area === "local" && Object.keys(changes).some(key => key === "journalStore" || key === "journalRevision" || key.startsWith("collection:") || key.startsWith("clip:") || key.startsWith("note:") || key.startsWith("questions:"))) render();
});
const pollTimer = setInterval(pollModel, 2500);
document.addEventListener("visibilitychange", pollModel);
window.addEventListener("pagehide", event => {
  if (!event.persisted) clearInterval(pollTimer);
});
render();
pollModel();
