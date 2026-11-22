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
  const css = "/* The panel defines its own palette inside the shadow root. */\n:root, .window, .source-marker {\n  --okusta-scheme: light;\n  --okusta-ink: #151515;\n  --okusta-desktop: #f7f7f5;\n  --okusta-frame: #deded8;\n  --okusta-outline: #3e3e3c;\n  --okusta-stripe-shadow: #868681;\n  --okusta-stripe-light: #fbfbf9;\n  --okusta-stripe-mid: #cdcdc8;\n  --okusta-paper: #ffffff;\n  --okusta-sidebar: #f3f3ef;\n  --okusta-drawer: #efefe9;\n  --okusta-button: #f7f7f5;\n  --okusta-control: #ffffff;\n  --okusta-note: #f7f7f5;\n  --okusta-rule: #a9a9a2;\n  --okusta-soft-rule: #d8d8d2;\n  --okusta-accent-rule: #b8b8b1;\n  --okusta-note-rule: #c15260;\n  --okusta-title-ink: var(--okusta-ink);\n  --okusta-tool-ink: #454541;\n  --okusta-muted: #5f5f5f;\n  --okusta-link: #c15260;\n  --okusta-link-hover: #14998b;\n  --okusta-selection: rgba(193,82,96,.18);\n  --okusta-selected: #a34451;\n  --okusta-hover: #efefe9;\n  --okusta-pressed: #deded8;\n  --okusta-disabled: #8b8b85;\n  --okusta-focus: #a34451;\n  --okusta-code: #efefe9;\n  --okusta-error: #842e29;\n  --okusta-bevel: #ffffff;\n  --okusta-scroll-thumb: #aaa9a3;\n  --okusta-scroll-track: #efefe9;\n}\n:root[data-theme=\"dark\"], .window[data-theme=\"dark\"], .source-marker[data-theme=\"dark\"] {\n  --okusta-scheme: dark;\n  --okusta-ink: #f3f3f0;\n  --okusta-desktop: #141414;\n  --okusta-frame: #303030;\n  --okusta-outline: #101010;\n  --okusta-stripe-shadow: #202020;\n  --okusta-stripe-light: #797976;\n  --okusta-stripe-mid: #444443;\n  --okusta-paper: #171717;\n  --okusta-sidebar: #1b1b1b;\n  --okusta-drawer: #202020;\n  --okusta-button: #303030;\n  --okusta-control: #141414;\n  --okusta-note: #202020;\n  --okusta-rule: #515150;\n  --okusta-soft-rule: #303030;\n  --okusta-accent-rule: #5e5e5b;\n  --okusta-note-rule: #14998b;\n  --okusta-title-ink: var(--okusta-ink);\n  --okusta-tool-ink: #d8d8d2;\n  --okusta-muted: #b4b4ad;\n  --okusta-link: #14998b;\n  --okusta-link-hover: #c15260;\n  --okusta-selection: rgba(20,153,139,.22);\n  --okusta-selected: #196c63;\n  --okusta-hover: #303030;\n  --okusta-pressed: #393939;\n  --okusta-disabled: #757572;\n  --okusta-focus: #31b5a5;\n  --okusta-code: #202020;\n  --okusta-error: #ffaaa1;\n  --okusta-bevel: #686865;\n  --okusta-scroll-thumb: #666664;\n  --okusta-scroll-track: #202020;\n}\n\n::selection { background: var(--okusta-selection); color: var(--okusta-ink); }\n\n.titlebar { display: flex; align-items: center; gap: 7px; height: 24px; margin: 0 3px 3px; }\n.titlebar .crossbars { flex: 1; height: 13px; background: repeating-linear-gradient(to bottom,var(--okusta-stripe-shadow) 0 1px,var(--okusta-stripe-light) 1px 2px,var(--okusta-stripe-mid) 2px 3px); }\n.titlebar h1 { font-size: 14px; margin: 0; }\n\n* { box-sizing: border-box; }\n.window {\n  all: initial; box-sizing: border-box; position: relative; z-index: 1; display: flex; flex-direction: column;\n  direction: ltr; color-scheme: var(--okusta-scheme); color: var(--okusta-ink); background: var(--okusta-frame);\n  font: 14px/1.5 \"Geneva\", \"Tahoma\", system-ui, sans-serif;\n  width: min(396px, calc(100vw - 16px)); max-width: calc(100vw - 8px);\n  min-height: min(120px, calc(100vh - 16px)); max-height: calc(100vh - 8px); padding: 3px;\n  border: 1px solid var(--okusta-outline);\n  scrollbar-color: var(--okusta-scroll-thumb) var(--okusta-scroll-track); scrollbar-width: thin;\n}\n.titlebar { flex: none; cursor: grab; user-select: none; touch-action: none; }\n.titlebar:active { cursor: grabbing; }\nbutton { font: inherit; color: inherit; cursor: pointer; }\nbutton:focus-visible, textarea:focus-visible, .model-dot:focus-visible, .window:focus-visible { outline: 2px solid var(--okusta-focus); outline-offset: 2px; }\n.close {\n  width: 14px; height: 14px; padding: 0; border: 1px solid var(--okusta-outline); border-radius: 0;\n  background: var(--okusta-button);\n}\n.panel-content { display: flex; flex-direction: column; flex: 1 1 auto; min-height: 0; overflow: auto; overscroll-behavior: contain; }\n.body {\n  flex: 1 1 auto; min-height: 0; overflow: auto; overscroll-behavior: contain; padding: 18px;\n  overflow-anchor: none;\n  border: 1px solid var(--okusta-rule); border-bottom: 0; background: var(--okusta-paper);\n}\n.paper {\n  margin: 0; padding-left: 13px; border-left: 2px solid var(--okusta-accent-rule); font: 18px/1.5 Georgia, serif;\n  overflow: visible; white-space: pre-wrap; overflow-wrap: anywhere;\n}\n.source-marker { position: fixed; z-index: 0; pointer-events: none; border: 2px solid var(--okusta-link); }\n.paper[data-kind=\"html\"] { font: 12px/1.55 ui-monospace, monospace; }\n.crop-preview { margin: 0; }\n.crop-preview canvas { display: block; max-width: 100%; height: auto; }\n.crop-preview figcaption { margin-top: 5px; font-size: 12px; color: var(--okusta-muted); overflow-wrap: anywhere; }\n\n.model-note { margin-top: 15px; padding: 9px 12px; background: var(--okusta-note); border-left: 2px solid var(--okusta-note-rule); }\n.model-note h2 { overflow-wrap: anywhere; white-space: pre-wrap; margin: 0 0 3px; font: bold 12px/1.5 \"Geneva\", \"Tahoma\", system-ui, sans-serif; }\n.model-note p { margin: 0; white-space: pre-wrap; overflow-wrap: anywhere; }\n.model-note small { display: block; margin-top: 5px; color: var(--okusta-muted); overflow-wrap: anywhere; }\n.footer {\n  flex: none; padding: 9px 12px; background: var(--okusta-paper); border: 1px solid var(--okusta-rule);\n  border-top: 1px solid var(--okusta-soft-rule);\n}\n.buttons { display: flex; align-items: center; gap: 4px; flex-wrap: wrap; }\n.tool {\n  position: relative; display: inline-grid; place-items: center; width: 32px; height: 32px; padding: 0;\n  background: transparent; color: var(--okusta-tool-ink); border: 1px solid transparent; border-radius: 3px;\n}\n.tool::after {\n  content: attr(aria-label); position: absolute; z-index: 1;\n  bottom: calc(100% + 3px); inset-inline-start: 50%; transform: translateX(-50%);\n  width: max-content; max-width: min(180px, calc(100vw - 48px)); padding: 3px 7px;\n  border: 1px solid var(--okusta-accent-rule); background: var(--okusta-paper); color: var(--okusta-title-ink);\n  font: 12px/1.4 \"Geneva\", \"Tahoma\", system-ui, sans-serif; text-align: start;\n  visibility: hidden; pointer-events: none;\n}\n.tool-eye::after { inset-inline-start: 0; transform: none; }\n.tool-book::after { inset-inline-start: auto; inset-inline-end: 0; transform: none; }\n.tool:focus-visible::after { visibility: visible; }\n@media (hover: hover) {\n  .tool:hover::after { visibility: visible; }\n  .buttons:has(.tool:hover) .tool:focus-visible:not(:hover)::after { visibility: hidden; }\n}\n.tool svg {\n  display: block; width: 20px; height: 20px; fill: none; stroke: currentColor;\n  stroke-width: 1.75; stroke-linecap: round; stroke-linejoin: round; pointer-events: none;\n}\n.tool-play svg { fill: currentColor; stroke-width: 1; }\n.tool:hover:enabled, .tool[aria-expanded=\"true\"] { background: var(--okusta-hover); border-color: var(--okusta-accent-rule); }\n.tool:active:enabled { background: var(--okusta-pressed); }\n.tool:disabled { color: var(--okusta-disabled); cursor: default; }\n.tool-book { margin-inline-start: auto; }\n.play-state { display: inline-flex; align-items: center; gap: 1px; }\n.composer {\n  height: var(--prompt-height, 78px); min-height: 50px; max-height: max(78px, calc(100vh - 150px)); margin: 0 0 8px;\n  resize: vertical; overflow: hidden;\n}\n.window[data-resized] .composer { max-height: max(78px, 26vh); }\n.prompt-frame { display: block; width: 100%; height: 100%; border: 0; }\n.status { margin: 6px 0 0; font-size: 12px; color: var(--okusta-tool-ink); }\n.status:empty, [hidden] { display: none; }\n.model-dot { flex: none; width: 10px; height: 10px; border: 1px solid #44483e; border-radius: 50%; margin-right: 2px; background: #cb4c46; }\n.model-dot[data-state=\"idle\"] { background: #419854; }\n.model-dot[data-state=\"busy\"] { background: #f4bf33; }\n\n\n/* The hit areas straddle the frame so the interior controls and scrollbar stay usable. */\n.resize-handle { position: absolute; z-index: 2; touch-action: none; user-select: none; }\n.resize-handle[data-edge=\"n\"], .resize-handle[data-edge=\"s\"] { left: 7px; right: 7px; height: 8px; cursor: ns-resize; }\n.resize-handle[data-edge=\"w\"], .resize-handle[data-edge=\"e\"] { top: 7px; bottom: 7px; width: 8px; cursor: ew-resize; }\n.resize-handle[data-edge^=\"n\"] { top: -4px; }\n.resize-handle[data-edge^=\"s\"] { bottom: -4px; }\n.resize-handle[data-edge$=\"w\"] { left: -4px; }\n.resize-handle[data-edge$=\"e\"] { right: -4px; }\n.resize-handle:is([data-edge=\"nw\"], [data-edge=\"se\"], [data-edge=\"ne\"], [data-edge=\"sw\"]) { width: 13px; height: 13px; }\n.resize-handle:is([data-edge=\"nw\"], [data-edge=\"se\"]) { cursor: nwse-resize; }\n.resize-handle:is([data-edge=\"ne\"], [data-edge=\"sw\"]) { cursor: nesw-resize; }\n\n.answer-markdown { overflow-wrap: anywhere; }\n.answer-markdown p { white-space: normal; margin: .45em 0; }\n.answer-markdown :is(h3,h4,h5,h6) { font-size: 1em; margin: .65em 0 .2em; }\n.answer-markdown :is(ul,ol) { padding-inline-start: 1.5em; margin: .4em 0; }\n.answer-markdown pre { padding: .65em; background: var(--okusta-code); border: 1px solid var(--okusta-soft-rule); font: 12px/1.55 ui-monospace, monospace; white-space: pre; overflow: auto; max-width: 100%; }\n.answer-markdown .table-scroll { overflow-x: auto; }\n.answer-markdown table { border-collapse: collapse; }\n.answer-markdown :is(th,td) { padding: .25em .5em; border: 1px solid var(--okusta-soft-rule); }\n.answer-markdown > :first-child { margin-top: 0; }\n.answer-markdown > :last-child { margin-bottom: 0; }\n.answer-markdown a { color: var(--okusta-link); text-underline-offset: .15em; }\n.answer-markdown a:is(:hover, :focus-visible) { color: var(--okusta-link-hover); }\n.answer-markdown :not(pre) > code { background: var(--okusta-code); color: var(--okusta-ink); padding: .05em .2em; }\n.answer-markdown blockquote { margin: .5em 0; padding-inline-start: .75em; border-inline-start: 2px solid var(--okusta-accent-rule); font: inherit; white-space: normal; }\n";
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
  book.src = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAYAAAAf8/9hAAADrElEQVQ4y6XSW0ybdRzG8d//fd+2Ly0tjLbY0ha6ruVUVqDsAOsARVSc2YmZSMbGZoKRbIJxm84Ti5tMw82Y4pzBLOJcuFAhXphFFwdsY8nYnBCWArW0o4WuhR4oPUkP7/v3RhJvvPJz/+S5+SL4F4N8J7FXWwof37nEnqk+XsGjeF8Dgs2AYcj2xHowV7YRSEBs563P8PqGBIANBxoOXyjaVCoZnfx5UpWtIfZqamtoLj20GPToxmy/Exl8oT5PmksxTGoEIyCfUVeyo45xOFvbAfDqK+3XHfYl/FrzWykAsh4AoLv+tPmwfh9W85TxbCT+7pix+dH5upO/rb+eqmwlztW+iQAAqEQihQa+/REMpQZ8NPH6YP8PXz7tDi+vcBAHE4BiMpGka7M8v3zaPTd6pvq4iUNyiM7Ri3cAAD6pO0EgAJAUKIzfn/u0u0apyiEGvrniGbjax60r3pmVTYvZe/aJ+YngdPOFFz8UhGPhmwxmgUToGkWQH30w0mMjASDGp9PnQsFw67aqHQyPR2eIhHz+/mMt+PYvN1EoGhabVBUvyITidrvPxVo8jkQ8lTRm8NNrGrTVw6ROXk55lswO92LQtexZ2q1Sy9j9h5qgt+tzuP1wGOVkytmteYbMqUUrO+93gT8W4ASioSSP4ioy+cIgka/diGNPMKg1ua5CfR4uKS8lLDMueP98ByrUFsLyihe5Q76Ue9XL+v/y4ySbGFxZW3kQiUeBS3ExYdpeBSgHAcmh3isqM1Kn33g7NX73Hii1Bjw0PASyTQo0MjWGIqkItZaKh2u123say54v0EiVTgD4CQAASoT5HbWKKqZF/3KyWmJkNFnFzDunLjMWq58JLPvYI/sOJaSQibVp6su/Tjwgu+pPGnsPnFUCAKA9upfaVRnSHkmaEFxBLxIK0uHGoxGU4PNxze4maG1rhoqyXNz/xVdEd2e31xZ1mABg7p8kOGSVqmJcKRLDH04LTLkt6LHfAXxagNbCq8hinsSPFwNsLEFTjQcbk7v2PCtKI3hVTJTKbmk+0lRSvOUKWSDOL6M53CKGZQhPyMusxFaRXq4Dk24Ldvoc5PzsFDk9aw2aZxYFgg1yqN/VoNhmqqzLyJJutdkWBqmHC38eJVi2VytVPEeRlMwXCTAykRTFk3ESIWKGSxL9C9P3rzmd86b7d8fapE/JaTqNh+3Wub6ZuRtX0Xrf7+5o06fT/BMEIlrWkvG16+ZbfbN+26UIRO3wHzDGCP6vvwG+b4XAvdLYPgAAAABJRU5ErkJggg==";
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
