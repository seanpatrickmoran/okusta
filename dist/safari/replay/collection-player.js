import {start, step, grade, stableJSON} from "./collection.mjs";

const el = (tag, text) => {
  const node = document.createElement(tag);
  if (text !== undefined) node.textContent = text;
  return node;
};

export function collectionDescription(r) {
  const counts = r.steps.filter(e => e.action.op === "open").map(e => e.observation.members?.length).filter(n => n !== undefined);
  return [r.fixture.goal, (r.origin.actor === "policy" ? r.origin.model + " · " + r.origin.adapterSha256 : "Scripted · " + r.origin.name),
    "Members seen on reopen: " + (counts.join(" → ") || "none"),
    r.grade.verified ? "Verified completion" : "Ended without verified completion"].join("\n");
}

export function collectionPlayer(r, openAtStart) {
  const card = el("details");
  card.className = "replay-card collection-replay";
  card.append(el("summary","Replay collection task"));
  const provenance = el("p",r.origin.actor === "policy" ? "Qwen rollout · adapter " + r.origin.adapterSha256.slice(0,12) : "Scripted demonstration · " + r.origin.name);
  const goal = el("p",r.fixture.goal);
  const controls = el("div");
  controls.className = "replay-controls";
  const play = el("button","Play"), next = el("button","Step"), restart = el("button","Reset");
  controls.append(play,next,restart);
  const status = el("p"), stage = el("section"), history = el("ol");
  status.setAttribute("role","status");
  stage.className = "collection-observation";
  history.className = "collection-history";
  const log = el("details");
  log.append(el("summary","Actions so far"),history);
  card.append(provenance,goal,controls,status,stage,log);
  let session, cursor, requested, timer;
  const stop = () => { clearTimeout(timer); timer = undefined; play.textContent = "Play"; };
  const clipLabel = id => {
    const clip = r.fixture.clips.find(c => c.id === id);
    return clip ? clip.title + " · " + id : id;
  };
  function showList(rows) {
    const list = el("ul");
    rows.forEach(row => list.append(el("li",row)));
    stage.append(list);
  }
  function terminal() {
    const result = grade(r.fixture,session);
    const checked = stableJSON(result) === stableJSON(r.grade);
    const message = result.verified ? "Verified completion · 3 of 3 saved" :
      result.falseCompletion ? "Submitted with incorrect membership" :
      result.exact ? "Correct membership · verification incomplete" : "Incomplete collection";
    stage.append(el("p",(checked ? message : "Replay diverged") + " · " + r.stop));
    if (!result.exact) {
      if (result.missing.length) stage.append(el("p","Missing: " + result.missing.map(clipLabel).join(", ")));
      if (result.extra.length) stage.append(el("p","Extra: " + result.extra.map(clipLabel).join(", ")));
    }
    stop(); play.disabled = next.disabled = true;
  }
  function reset() {
    stop(); cursor = 0; session = start(r.fixture); requested = null;
    stage.replaceChildren(el("p",r.fixture.journal + " · " + r.fixture.clips.length + " journal entries"));
    history.replaceChildren(); status.textContent = "Ready · 0 of " + r.steps.length + " actions";
    play.disabled = next.disabled = false;
    if (!r.steps.length) terminal();
  }
  function advance() {
    if (cursor >= r.steps.length) return;
    const e = r.steps[cursor++];
    const {action:a} = e, obs = step(r.fixture,session,a);
    stage.replaceChildren();
    if (stableJSON(obs) !== stableJSON(e.observation)) {
      status.textContent = "Replay diverged at action " + cursor;
      stop(); play.disabled = next.disabled = true; return;
    }
    let label;
    if (obs.error) {
      label = "Rejected action"; stage.append(el("p",obs.error));
    } else if (a.op === "search") {
      label = a.query ? "Search · " + a.query : "Browse journal";
      stage.append(el("p",obs.hits.length + " matches")); showList(obs.hits.map(c => clipLabel(c.id)));
    } else if (a.op === "inspect") {
      label = "Inspect · " + clipLabel(a.id); stage.append(el("p",obs.body));
    } else if (a.op === "save") {
      label = "Save " + a.ids.length + " to " + obs.collection; requested = a.ids;
      stage.append(el("p",obs.receipt), el("p","Requested members")); showList(requested.map(clipLabel));
    } else if (a.op === "open") {
      label = "Reopen · " + obs.members.length + " saved";
      stage.append(el("p",obs.collection)); showList(obs.members.map(c => clipLabel(c.id)));
      if (requested) {
        const missing = requested.filter(k => !obs.members.some(c => c.id === k));
        const extra = obs.members.filter(c => !requested.includes(c.id));
        if (extra.length) stage.append(el("p","Unexpected members: " + extra.map(c => clipLabel(c.id)).join(", ")));
        stage.append(el("p",missing.length ? "Missing from the save request: " + missing.map(clipLabel).join(", ") : "All requested IDs are present."));
      }
    } else {
      label = "Finish";
    }
    history.append(el("li",label));
    status.textContent = cursor + " of " + r.steps.length + " · " + label;
    if (cursor === r.steps.length) terminal();
  }
  function tick() {
    if (!card.isConnected || !card.open) { stop(); return; }
    advance();
    if (!next.disabled) timer = setTimeout(tick,1000);
  }
  next.onclick = () => { stop(); advance(); };
  play.onclick = () => { if (timer !== undefined) stop(); else { play.textContent = "Pause"; tick(); } };
  restart.onclick = reset;
  card.addEventListener("toggle",() => { if (!card.open) stop(); });
  reset(); card.open = Boolean(openAtStart);
  return card;
}
