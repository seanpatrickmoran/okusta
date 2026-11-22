// This file runs in the extension's isolated world, once per toolbar invocation.
(() => {
  const api = globalThis.browser ?? chrome;
  const slot = "__okustaWindowV2";
  const activeElement = document.activeElement;
  if (globalThis[slot]?.connected()) {
    globalThis[slot].activate(null);
    return;
  }

  const host = document.createElement("div");
  // The outer host lives on the webpage. Reset its layout before positioning it.
  for (const [key, value] of Object.entries({
    all: "initial", position: "fixed", display: "block", top: "8px", right: "8px",
    "z-index": "2147483647"
  })) host.style.setProperty(key, value, "important");
  const root = host.attachShadow({mode: "closed"});
  const css = /* BUILD_PANEL_CSS */ "";
  try {
    const sheet = new CSSStyleSheet();
    sheet.replaceSync(css);
    root.adoptedStyleSheets = [sheet];
  } catch {
    const style = document.createElement("style");
    style.textContent = css;
    root.append(style);
  }

  function element(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text) node.textContent = text;
    return node;
  }

  // Small monochrome toolbar glyphs inherit the control's focus and disabled colors.
  const glyphs = {
    closedEye: "M2 10c3 4 6 6 10 6s7-2 10-6M5 14l-2 3m7-1-1 4m6-4 1 4m3-6 2 3",
    eye: "M2 12C4.8 7.3 8 5.5 12 5.5S19.2 7.3 22 12c-2.8 4.7-6 6.5-10 6.5S4.8 16.7 2 12ZM15 12a3 3 0 1 1-6 0 3 3 0 1 1 6 0Z",
    bolt: "M13 2 4.5 13.2h6.7L10 22l9.8-13h-7.2L15 2Z",
    disk: "M4 3.5h13l3.5 3.6v13.4H3.5v-17ZM7 4v6h9V4M7 20v-6h10v6M13 5.5v3",
    bubble: "M5 4.5h14a2.5 2.5 0 0 1 2.5 2.5v7a2.5 2.5 0 0 1-2.5 2.5h-8l-5.5 4v-4H5A2.5 2.5 0 0 1 2.5 14V7A2.5 2.5 0 0 1 5 4.5ZM7 9h10M7 12.5h6",
    play: "M7 3.8 20.5 12 7 20.2Z",
    stop: "M5 5h14v14H5Z",
    reset: "M12 20a8 8 0 1 0-8-8M1 9l3 3 3-3",
    book: "M12 6C9.5 4.2 6.2 4 2.5 4.8v14c3.7-.8 7-.5 9.5 1.2 2.5-1.7 5.8-2 9.5-1.2v-14c-3.7-.8-7-.6-9.5 1.2ZM12 6v14"
  };
  function iconButton(icon, label) {
    const button = element("button", "tool tool-" + icon);
    button.type = "button";
    button.setAttribute("aria-label", label);
    const ns = "http://www.w3.org/2000/svg";
    const svg = document.createElementNS(ns, "svg");
    svg.setAttribute("viewBox", "0 0 24 24");
    svg.setAttribute("aria-hidden", "true");
    svg.setAttribute("focusable", "false");
    const path = document.createElementNS(ns, "path");
    path.setAttribute("d", glyphs[icon]);
    svg.append(path);
    button.append(svg);
    return button;
  }

  const box = element("section", "window");
  box.setAttribute("role", "dialog");
  box.setAttribute("aria-label", "Okusta clipping");
  box.tabIndex = -1;
  const bar = element("header", "titlebar");
  const close = element("button", "close");
  close.setAttribute("aria-label", "Close clipping window");
  close.title = "Close";
  const dot = element("span", "model-dot");
  dot.setAttribute("role", "img");
  dot.tabIndex = 0;
  const leftBars = element("span", "crossbars");
  leftBars.setAttribute("aria-hidden", "true");
  const book = element("img");
  book.src = /* BUILD_APP_ICON */ "";
  book.alt = "";
  book.width = book.height = 16;
  book.draggable = false;
  bar.append(close, leftBars, book, element("h1", "", "Okusta"), leftBars.cloneNode(false));

  const body = element("div", "body");
  body.tabIndex = 0;
  const quote = element("blockquote", "paper");
  const cropPreview = element("figure", "crop-preview");
  cropPreview.hidden = true;
  const transcript = element("div", "transcript");
  const footer = element("footer", "footer");
  const buttons = element("div", "buttons");
  const pick = iconButton("eye", "Capture image region");
  const pickHTML = iconButton("bolt", "Pick HTML node");
  const save = iconButton("disk", "Save clipping");
  const ask = iconButton("bubble", "Query");
  const run = iconButton("play", "Send");
  const reset = iconButton("reset", "Reset panel");
  const desk = iconButton("book", "Open journal");
  const playState = element("span", "play-state");
  playState.append(run, dot, reset);

  const composer = element("div", "composer");
  composer.hidden = true;
  composer.id = "qwen-composer";
  ask.setAttribute("aria-controls", composer.id);
  ask.setAttribute("aria-expanded", "false");
  // A page's window/document capture listeners run before any listener in a shadow
  // root. Give native text editing its own event path, including IME and paste.
  const editorFrame = element("iframe", "prompt-frame");
  editorFrame.title = "Okusta query editor";
  composer.append(editorFrame);
  const status = element("p", "status");
  status.setAttribute("role", "status");
  buttons.append(pick, pickHTML, save, ask, playState, desk);
  body.append(quote, cropPreview, transcript);
  footer.append(composer, buttons, status);
  const content = element("div", "panel-content");
  content.append(body, footer);
  box.append(bar, content);
  const sourceMarker = element("div", "source-marker");
  sourceMarker.setAttribute("aria-hidden", "true");
  sourceMarker.hidden = true;
  root.append(sourceMarker, box);
  document.documentElement.append(host);

  // Use the frame's initial empty document. Only extension-created controls go here.
  const editor = editorFrame.contentDocument;
  const promptLabel = editor.createElement("label");
  promptLabel.textContent = "Query";
  const question = editor.createElement("textarea");
  question.id = "clipping-question";
  question.rows = 2;
  question.enterKeyHint = "send";
  promptLabel.htmlFor = question.id;
  editor.body.attachShadow({mode: "closed"}).append(promptLabel, question);
  editor.documentElement.style.height = "100%";
  Object.assign(editor.body.style, {height: "100%", margin: "0", display: "flex", flexDirection: "column",
    font: '14px/1.5 "Geneva", "Tahoma", system-ui, sans-serif'});
  Object.assign(promptLabel.style, {fontSize: "12px", fontWeight: "600", marginBottom: "3px"});
  Object.assign(question.style, {boxSizing: "border-box", width: "100%", flex: "1", minHeight: "0",
    resize: "none", padding: "5px 8px", font: "inherit", border: "1px solid", borderRadius: "2px", outlineOffset: "-2px"});
  // Measure wrapped lines without disturbing the live textarea's caret or scroll position.
  const measure = question.cloneNode();
  measure.removeAttribute("id");
  measure.tabIndex = -1;
  measure.setAttribute("aria-hidden", "true");
  Object.assign(measure.style, {position: "absolute", left: "0", top: "0", height: "0", visibility: "hidden", overflow: "hidden"});
  question.after(measure);
  function fitPrompt() {
    if (composer.hidden) return;
    measure.value = question.value;
    const height = question.value ? Math.ceil(question.offsetTop + measure.scrollHeight + 2) : 0;
    composer.style.setProperty("--prompt-height", Math.max(78, height) + "px");
  }

  const unwatchTheme = globalThis.okustaAppearance.watch(box, dark => {
    sourceMarker.dataset.theme = dark ? "dark" : "light";
    const palette = getComputedStyle(box);
    editor.documentElement.style.colorScheme = dark ? "dark" : "light";
    editor.body.style.backgroundColor = question.style.backgroundColor = palette.getPropertyValue("--okusta-paper");
    question.style.color = palette.getPropertyValue("--okusta-ink");
    question.style.borderColor = palette.getPropertyValue("--okusta-rule");
    promptLabel.style.color = palette.getPropertyValue("--okusta-tool-ink");
  });
  let draft = null, record = null, turns = [];
  let autorecord = false, sourceEvents;
  let saved = false, saving = false, answered = false;
  let activeRequest = null;
  let modelLabel = "Local model", expectedRoute;
  let imageInput = false, canCapture = false, routeLabel = "";
  let state = "offline", pendingPoll = false, cancelPicker = null;
  const listeners = new AbortController();
  let followReply = false, followedTop = 0;
  function scrollToReply() {
    if (!followReply) return;
    body.scrollTop = body.scrollHeight;
    followedTop = body.scrollTop;
  }
  function pauseFollowing() { followReply = false; }
  for (const target of [box, editor]) {
    target.addEventListener("wheel", pauseFollowing, {capture: true, passive: true});
    target.addEventListener("touchmove", pauseFollowing, {capture: true, passive: true});
    target.addEventListener("keydown", event => {
      const keys = target === editor ? ["PageUp", "PageDown"] : ["ArrowUp", "ArrowDown", "PageUp", "PageDown", "Home", "End", " "];
      if (keys.includes(event.key)) pauseFollowing();
    });
  }
  // Native scrollbar drags can scroll the body without a wheel or keyboard event.
  body.addEventListener("pointerdown", event => {
    if (event.target === body && event.clientX >= body.getBoundingClientRect().left + body.clientLeft + body.clientWidth)
      pauseFollowing();
  });
  body.addEventListener("scroll", () => {
    const limit = body.scrollHeight - body.clientHeight;
    if (body.scrollTop + 1 < Math.min(limit, followedTop)) pauseFollowing();
  }, {passive: true});

  const unwatchRecording = globalThis.okustaAppearance.watchBoolean("autorecord", on => {
    autorecord = on;
    controls();
  });

  async function send(type, extra = {}) {
    const reply = await api.runtime.sendMessage({type, ...extra});
    if (!reply?.ok) throw new Error(reply?.error || "Reload the extension and this page.");
    return reply.value;
  }

  function controls() {
    const hasPrompt = !composer.hidden && Boolean(question.value.trim());
    const imageDraft = draft?.kind === "image";
    const hasSource = Boolean(draft?.element || imageDraft);
    const eyeOpen = imageInput && canCapture && state !== "offline";
    const shown = activeRequest ? "busy" : state;
    const labels = {idle: modelLabel + " ready", busy: modelLabel + " processing a request", offline: modelLabel + " unavailable"};
    dot.dataset.state = shown;
    dot.title = labels[shown];
    dot.setAttribute("aria-label", dot.title);
    pickHTML.disabled = reset.disabled = saving || Boolean(activeRequest);
    pick.disabled = pickHTML.disabled || !eyeOpen || state !== "idle";
    pick.querySelector("path").setAttribute("d", eyeOpen ? glyphs.eye : glyphs.closedEye);
    pick.title = !canCapture && state !== "offline" ? "Tab capture unavailable in this browser" :
      state === "offline" ? "Model connection unavailable" : !imageInput ? "Select and verify a model with image input" :
      state === "busy" || activeRequest ? "Model is busy" : "Capture image region";
    pick.setAttribute("aria-label", pick.title);
    if (imageDraft && cropPreview.lastElementChild) {
      const {width, height} = draft.image;
      cropPreview.lastElementChild.textContent = width + " × " + height + " · " +
        (imageInput ? routeLabel + " · " + modelLabel : "Select an image-capable model to send");
    }
    save.hidden = autorecord;
    save.disabled = saved || saving || Boolean(activeRequest) || (!hasSource && !record && !question.value.trim());
    ask.disabled = saving || Boolean(activeRequest);
    run.setAttribute("aria-label", activeRequest ? "Stop response" : "Send");
    run.querySelector("path").setAttribute("d", activeRequest ? glyphs.stop : glyphs.play);
    const emptyImageQuestion = imageDraft && !turns.length;
    run.disabled = activeRequest ? activeRequest.signal.aborted : !draft || saving || state !== "idle" ||
      (imageDraft && !imageInput) || (composer.hidden ? hasSource && answered : !hasPrompt && !emptyImageQuestion);
  }

  async function poll() {
    if (pendingPoll || listeners.signal.aborted || document.hidden) return;
    pendingPoll = true;
    try {
      const info = await send("qwen-status");
      state = info.state;
      expectedRoute = info.routeId;
      imageInput = info.imageInput === true;
      canCapture = info.canCapture === true;
      routeLabel = info.label || "Local model";
      modelLabel = info.model || info.label || "Local model";
    }
    catch { state = "offline"; }
    finally { pendingPoll = false; controls(); }
  }

  const emptyDraft = () => ({kind: "prompt", text: "", source: {title: "", url: ""}});
  function replaceDraft(next, preview) {
    draft = next;
    turns = [];
    record = null;
    saved = answered = false;
    question.value = "";
    fitPrompt();
    pauseFollowing();
    transcript.replaceChildren();
    quote.textContent = next.element ? next.text : "";
    quote.hidden = !next.element;
    quote.dataset.kind = next.kind || "text";
    cropPreview.replaceChildren();
    cropPreview.hidden = !preview;
    if (preview) {
      preview.setAttribute("role", "img");
      preview.setAttribute("aria-label", "Selected screenshot region");
      cropPreview.append(preview, element("figcaption"));
    }
    status.textContent = "";
  }

  function activate(next, preview) {
    if (cancelPicker) cancelPicker();
    if (next && !saving && !activeRequest &&
        (next.kind === "image" || next.kind !== draft?.kind || next.text !== draft?.text || next.source.url !== draft?.source.url || next.element !== draft?.element)) {
      replaceDraft(next, preview);
      composer.hidden = true;
      ask.setAttribute("aria-expanded", "false");
    }
    controls();
    box.focus({preventScroll: true});
  }

  function snapshot() {
    if (!record) {
      const captured = new Date();
      const day = [captured.getFullYear(), captured.getMonth() + 1, captured.getDate()]
        .map(n => String(n).padStart(2, "0")).join("-");
      const id = Array.from(crypto.getRandomValues(new Uint8Array(16)), b => b.toString(16).padStart(2, "0")).join("");
      record = {...draft, ...(draft.kind === "prompt" ? {prompt: question.value.trim()} : {}),
        id, createdAt: captured.toISOString(), day};
    }
    return {clip: record, turns};
  }

  async function saveDraft() {
    if (save.disabled || autorecord) return;
    saving = true;
    controls();
    try {
      await send("panel-save", {draft: snapshot()});
      saved = true;
      status.textContent = "Saved to your journal.";
    } catch (error) {
      status.textContent = "Could not save this entry. " + error.message;
    } finally {
      saving = false;
      controls();
    }
  }

  function storeChanged(changes, area) {
    if (area !== "local" || !changes.journalStore) return;
    const before = changes.journalStore.oldValue ?? {type: "profile", path: ""};
    const after = changes.journalStore.newValue ?? {type: "profile", path: ""};
    if (before.type === after.type && (after.type === "profile" || before.path === after.path)) return;
    saved = false;
    answered = false;
    if (draft) status.textContent = "Journal location changed. Save to the active journal.";
    controls();
  }
  api.storage.onChanged.addListener(storeChanged);
  function dismiss() {
    frameObserver.disconnect();
    trackSource(null);
    unwatchTheme();
    unwatchRecording();
    api.storage.onChanged.removeListener(storeChanged);
    if (cancelPicker) cancelPicker();
    listeners.abort();
    clearInterval(pollTimer);
    host.remove();
    delete globalThis[slot];
    if (activeElement?.isConnected) activeElement.focus?.({preventScroll: true});
  }

  function trackSource(node) {
    sourceEvents?.abort();
    sourceMarker.hidden = true;
    if (!node) return;
    sourceEvents = new AbortController();
    const options = {passive: true, signal: sourceEvents.signal};
    function place() {
      if (!node.isConnected) { trackSource(null); return; }
      const {left, top, right, bottom} = node.getBoundingClientRect();
      const x = Math.max(0, left), y = Math.max(0, top);
      const width = Math.min(innerWidth, right) - x, height = Math.min(innerHeight, bottom) - y;
      sourceMarker.hidden = width <= 0 || height <= 0;
      if (!sourceMarker.hidden) Object.assign(sourceMarker.style, {
        left: x + "px", top: y + "px", width: width + "px", height: height + "px"
      });
    }
    node.addEventListener("pointerenter", place, options);
    node.addEventListener("pointerleave", () => { sourceMarker.hidden = true; }, options);
    const reposition = () => { if (!sourceMarker.hidden) place(); };
    window.addEventListener("scroll", reposition, {...options, capture: true});
    window.addEventListener("resize", reposition, options);
  }
  reset.addEventListener("click", () => {
    trackSource(null);
    replaceDraft(emptyDraft());
    controls();
    if (!composer.hidden) question.focus({preventScroll: true});
  });
  function startPicker(mode) {
    sourceMarker.hidden = true;
    host.style.setProperty("display", "none", "important");
    const resume = (next, node) => {
      cancelPicker = null;
      host.style.setProperty("display", "block", "important");
      if (next) trackSource(node);
      activate(next);
    };
    cancelPicker = globalThis.okustaPick(resume, () => resume(null), mode, box.dataset.theme === "dark");
  }
  pick.addEventListener("click", () => {
    if (pick.disabled || cancelPicker) return;
    const route = expectedRoute;
    const typed = question.value;
    const editing = !composer.hidden;
    sourceMarker.hidden = true;
    host.style.setProperty("display", "none", "important");
    cancelPicker = globalThis.okustaPickRegion(() => send("panel-capture", {expectedRoute: route}), (next, preview, error) => {
      cancelPicker = null;
      host.style.setProperty("display", "block", "important");
      if (next) trackSource(null);
      activate(next, preview);
      if (next) question.value = typed;
      if (editing) toggleComposer(true);
      if (error) status.textContent = error;
    });
  });
  pickHTML.addEventListener("click", () => startPicker("html"));
  function toggleComposer(open) {
    composer.hidden = !open;
    ask.setAttribute("aria-expanded", String(open));
    if (open) fitPrompt();
    controls();
    (open ? question : ask).focus({preventScroll: true});
  }
  ask.addEventListener("click", () => toggleComposer(composer.hidden));
  question.addEventListener("input", () => { fitPrompt(); controls(); });
  question.addEventListener("keydown", event => {
    if (event.isComposing || event.keyCode === 229) return;
    if (event.key === "Escape") {
      event.preventDefault();
      if (activeRequest) dismiss();
      else toggleComposer(false);
    } else if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      if (!event.repeat && !activeRequest) run.click();
    }
  });
  run.addEventListener("click", async () => {
    if (run.disabled) return;
    if (activeRequest) {
      activeRequest.abort();
      controls();
      return;
    }
    if (composer.hidden && !draft?.element && draft?.kind !== "image") { toggleComposer(true); return; }
    const clickedRoute = expectedRoute;
    const prompt = composer.hidden ? "" : question.value.trim();
    const panel = {...snapshot(), autorecord};
    activeRequest = new AbortController();
    question.value = "";
    fitPrompt();
    const resultBox = element("section", "model-note");
    const note = element("div", "", "Waiting for " + modelLabel + "…");
    resultBox.append(element("h2", "", prompt || modelLabel), note);
    resultBox.setAttribute("aria-busy", "true");
    transcript.append(resultBox);
    status.textContent = "";
    followReply = true;
    scrollToReply();
    controls();
    let paintTimer, pendingText;
    function renderPartial(text) {
      pendingText = text;
      if (paintTimer !== undefined || !host.isConnected) return;
      paintTimer = setTimeout(() => {
        paintTimer = undefined;
        if (host.isConnected) {
          note.replaceChildren(globalThis.okustaRenderMarkdown(pendingText));
          scrollToReply();
        }
      }, 60);
    }
    try {
      const {turn, recorded, saveError} = await globalThis.okustaReply(panel.clip.id, renderPartial, prompt, clickedRoute, false, Boolean(prompt), panel, activeRequest.signal);
      turns.push(turn);
      saved = recorded;
      note.replaceChildren(globalThis.okustaRenderMarkdown(turn.text));
      if (!prompt) answered = turn.finishReason !== "length";
      if (prompt && turn.model) resultBox.append(element("small", "", turn.model));
      if (turn.finishReason === "length") resultBox.append(element("small", "", "Partial answer · token limit reached."));
      status.textContent = saveError ? "Could not record this reply. " + saveError +
        " Turn off Autorecord to save manually." : recorded ? "Saved to your journal." : "";
    } catch (error) {
      if (!saved && !turns.length) record = null;
      if (error.name === "AbortError" && activeRequest.signal.aborted) {
        if (pendingText) note.replaceChildren(globalThis.okustaRenderMarkdown(pendingText));
        else note.replaceChildren();
        resultBox.append(element("small", "", "Response stopped."));
      } else {
        if (pendingText) {
          note.replaceChildren(globalThis.okustaRenderMarkdown(pendingText));
          resultBox.append(element("small", "", error.message));
        } else note.textContent = error.message;
        status.textContent = prompt ? "Re-enter the query to try again." : "Choose Send to try again.";
      }
    } finally {
      clearTimeout(paintTimer);
      activeRequest = null;
      resultBox.setAttribute("aria-busy", "false");
      controls();
      scrollToReply();
      pauseFollowing();
      if (prompt && host.isConnected && root.activeElement === run) question.focus({preventScroll: true});
      poll();
    }
  });
  save.addEventListener("click", saveDraft);
  close.addEventListener("click", dismiss);
  desk.addEventListener("click", async () => {
    try {
      const result = await api.runtime.sendMessage({type: "open-desk"});
      if (!result?.ok) throw new Error(result?.error || "Try reloading the page.");
    } catch (error) {
      status.textContent = "Could not open the journal. " + error.message;
    }
  });
  box.addEventListener("keydown", event => {
    if (event.key === "Escape" && !event.isComposing) {
      event.preventDefault();
      event.stopPropagation();
      if (!composer.hidden && !activeRequest) toggleComposer(false);
      else dismiss();
    }
  });

  const gutter = 4;
  const minWidth = 244, minHeight = 120;
  const clamp = (value, low, high) => Math.min(Math.max(value, low), Math.max(low, high));
  function position(left, top) {
    host.style.setProperty("right", "auto", "important");
    host.style.setProperty("left", left + "px", "important");
    host.style.setProperty("top", top + "px", "important");
  }
  function keepInView(left, top, width, height) {
    position(clamp(left, gutter, innerWidth - width - gutter), clamp(top, gutter, innerHeight - height - gutter));
  }

  let gesture;
  function bindFrame(handle, edge = "") {
    handle.addEventListener("pointerdown", event => {
      if (gesture || event.button !== 0 || event.target === close) return;
      gesture = {id: event.pointerId, x: event.clientX, y: event.clientY, rect: box.getBoundingClientRect()};
      handle.setPointerCapture(event.pointerId);
      event.preventDefault();
    });
    handle.addEventListener("pointermove", event => {
      if (gesture?.id !== event.pointerId) return;
      const {rect, x, y} = gesture;
      const dx = event.clientX - x, dy = event.clientY - y;
      if (!edge) {
        keepInView(rect.left + dx, rect.top + dy, rect.width, rect.height);
        return;
      }
      let {left, right, top, bottom} = rect;
      if (edge.includes("w")) left = clamp(left + dx, gutter, right - minWidth);
      if (edge.includes("e")) right = clamp(right + dx, Math.min(left + minWidth, innerWidth - gutter), innerWidth - gutter);
      if (edge.includes("n")) top = clamp(top + dy, gutter, bottom - minHeight);
      if (edge.includes("s")) bottom = clamp(bottom + dy, Math.min(top + minHeight, innerHeight - gutter), innerHeight - gutter);
      if (!box.hasAttribute("data-resized") && right - left === rect.width && bottom - top === rect.height) return;
      position(left, top);
      box.style.width = (right - left) + "px";
      box.style.height = (bottom - top) + "px";
      box.setAttribute("data-resized", "");
    });
    const end = event => {
      if (gesture?.id === event.pointerId) gesture = null;
    };
    handle.addEventListener("pointerup", end);
    handle.addEventListener("pointercancel", end);
    handle.addEventListener("lostpointercapture", end);
  }
  bindFrame(bar);
  for (const edge of ["n", "s", "w", "e", "nw", "ne", "sw", "se"]) {
    const handle = element("div", "resize-handle");
    handle.dataset.edge = edge;
    handle.setAttribute("aria-hidden", "true");
    box.append(handle);
    bindFrame(handle, edge);
  }
  window.addEventListener("resize", () => {
    const rect = box.getBoundingClientRect();
    keepInView(rect.left, rect.top, rect.width, rect.height);
  }, {signal: listeners.signal});
  let lastEditorWidth;
  const frameObserver = new ResizeObserver(entries => {
    for (const entry of entries) {
      if (entry.target === editorFrame && entry.contentRect.width !== lastEditorWidth) {
        lastEditorWidth = entry.contentRect.width;
        fitPrompt();
      }
    }
    const rect = box.getBoundingClientRect();
    if (rect.bottom > innerHeight - gutter || rect.right > innerWidth - gutter)
      keepInView(rect.left, rect.top, rect.width, rect.height);
    scrollToReply();
  });
  frameObserver.observe(box);
  frameObserver.observe(editorFrame);
  globalThis[slot] = {activate, connected: () => host.isConnected};
  const pollTimer = setInterval(poll, 2500);
  document.addEventListener("visibilitychange", poll, {signal: listeners.signal});
  window.addEventListener("pagehide", dismiss, {once: true, signal: listeners.signal});
  activate(emptyDraft());
  poll();
})();
