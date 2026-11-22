import {playable} from "./record.js";

function node(tag, text) {
  const e = document.createElement(tag);
  e.textContent = text ?? "";
  return e;
}

class ReplayPlayer extends HTMLElement {
  connectedCallback() {
    if (this.firstChild) return;
    const r = this.record;
    const details = node("details");
    details.className = "replay-card";
    details.append(node("summary","Play replay"));
    const state = node("p");
    state.setAttribute("role","status");
    const stage = node("div");
    const step = node("button","Step"), reset = node("button","Reset"), explore = node("button","Try it yourself");
    const controls = node("div");
    controls.className = "replay-controls";
    controls.append(step,reset,explore);
    const last = r.steps.at(-1), recorded = r.verification.candidate.actual;
    const evidence = node("p");
    const show = v => v === "" ? "empty" : JSON.stringify(v);
    const evidenceText = "Expected " + last.selector + " " + show(last.expected) + " · Recorded " + show(recorded);
    evidence.textContent = evidenceText;
    details.append(stage,controls,state,evidence);
    this.append(details);

    let frame, port, timer, cursor, mode, waiting;
    const setState = (text) => { state.textContent = text; };
    const clean = () => {
      clearTimeout(timer);
      port?.close(); port = null;
      frame?.remove(); frame = null;
    };
    this.clean = clean;
    const error = () => {
      clean(); step.disabled = explore.disabled = true;
      setState("Replay unavailable · the fixture did not return an observation.");
    };
    const arm = () => { clearTimeout(timer); timer = setTimeout(error, 5000); };
    const manual = () => {
      mode = "explore"; step.disabled = explore.disabled = true;
      clearTimeout(timer); evidence.textContent = evidenceText; setState("Explore · Reset to replay the submission.");
    };
    const dispatch = (count, check) => {
      step.disabled = explore.disabled = true; frame.inert = true; waiting = true;
      const clicks = r.steps.slice(cursor,cursor+count).map(s => s.selector);
      cursor += count;
      port.postMessage({clicks, read:check ? last.selector : null});
      arm();
    };
    const mount = () => {
      clean(); cursor = 0; mode = "replay"; waiting = false;
      step.disabled = explore.disabled = true; evidence.textContent = evidenceText;
      setState("Opening fixture…");
      const f = frame = node("iframe");
      f.inert = true; f.title = "Interactive tabs widget"; f.sandbox = "allow-scripts";
      f.src = new URL("tabs.html", import.meta.url).href;
      f.addEventListener("load", () => {
        if (frame !== f) return;
        const channel = new MessageChannel();
        port = channel.port1;
        port.onmessage = ({data}) => {
          if (frame !== f || !this.isConnected) return;
          if (data.type === "manual") { manual(); return; }
          if (mode === "explore") return;
          clearTimeout(timer);
          if (data.type === "ready") { dispatch(r.pauseAfter,false); return; }
          if (data.type !== "result" || !waiting) { error(); return; }
          waiting = false; explore.disabled = false; f.inert = false;
          if (data.actual === null) {
            step.disabled = false;
            setState(cursor + " of " + (r.steps.length-1) + " clicks played");
          } else if (typeof data.actual === "string") {
            step.disabled = true;
            evidence.textContent = evidenceText + " · This replay " + show(data.actual);
            setState(data.actual === recorded ? "Reproduced" : "Diverged");
          } else { error(); }
        };
        f.contentWindow.postMessage({type:"connect"}, "*", [channel.port2]);
      }, {once:true});
      stage.append(f); arm();
    };
    details.addEventListener("toggle", () => {
      if (!this.isConnected) return;
      if (!details.open) { clean(); return; }
      if (!playable(r)) { controls.hidden = true; setState("Replay unavailable · unknown fixture revision or runtime."); return; }
      mount();
    });
    step.onclick = () => {
      if (waiting || mode !== "replay") return;
      const n = Number(cursor < r.steps.length-1);
      dispatch(n, cursor+n === r.steps.length-1);
    };
    reset.onclick = mount;
    explore.onclick = manual;
    details.open = Boolean(this.openAtStart);
  }
  disconnectedCallback() { this.clean?.(); this.replaceChildren(); }
}
customElements.define("okusta-replay", ReplayPlayer);
export function player(record, openAtStart) {
  const element = document.createElement("okusta-replay");
  element.record = record;
  element.openAtStart = openAtStart;
  return element;
}
