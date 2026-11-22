// A temporary transparent shield receives the picking click, including over links.
(() => {
  const semantic = "p,li,td,th,pre,figcaption,caption,h1,h2,h3,h4,h5,h6,blockquote,img";
  const excluded = "input,textarea,select,button,[contenteditable]:not([contenteditable=false]),iframe,video,canvas";
  function extract(node) {
    if (node.localName === "table") {
      return Array.from(node.rows, row => Array.from(row.cells, cell => cell.innerText.trim()).join("\t")).join("\n");
    }
    if (node.localName === "img") return node.alt || "";
    return node.innerText ?? "";
  }

  const omitHTML = [
    "script", "style", "noscript", "template", "link", "base", "meta", "iframe", "object", "embed",
    "form", "input", "textarea", "select", "button", "datalist", "option", "output",
    "svg", "math", "audio", "video", "canvas", "[hidden]", "[inert]",
    '[aria-hidden="true"]', "[contenteditable]:not([contenteditable=false])"
  ].join(",");
  const structuralTags = new Set(("a abbr address article aside b bdi bdo blockquote br caption cite code " +
    "col colgroup data dd del details dfn div dl dt em figcaption figure footer h1 h2 h3 h4 h5 h6 header hr i " +
    "img ins kbd label li main mark nav ol p pre q rp rt ruby s samp section small span strong sub summary sup " +
    "table tbody td th thead tfoot time tr u ul var wbr").split(" "));
  const attributes = new Set("id class role title alt aria-label lang dir scope colspan rowspan datetime start".split(" "));

  function captureHTML(node) {
    // The detached copy is used only to serialize structural HTML as text.
    const doc = document.implementation.createHTMLDocument("");
    const wrapper = doc.createElement("div");
    wrapper.append(doc.importNode(node, true));
    for (const child of wrapper.querySelectorAll(omitHTML)) child.remove();
    const comments = doc.createTreeWalker(wrapper, NodeFilter.SHOW_COMMENT);
    const remove = [];
    while (comments.nextNode()) remove.push(comments.currentNode);
    for (const comment of remove) comment.remove();
    for (const el of wrapper.querySelectorAll("*")) {
      if (el.namespaceURI !== "http://www.w3.org/1999/xhtml" || !structuralTags.has(el.localName)) {
        const contents = doc.createDocumentFragment();
        while (el.firstChild) contents.append(el.firstChild);
        el.replaceWith(contents);
        continue;
      }
      for (const attr of Array.from(el.attributes)) {
        if (!attr.namespaceURI && attributes.has(attr.name)) continue;
        el.removeAttributeNode(attr);
        if (!attr.namespaceURI && el.localName === "a" && attr.name === "href") {
          try {
            const target = new URL(attr.value, node.baseURI);
            if (["http:", "https:"].includes(target.protocol)) el.setAttribute("href", target.origin + target.pathname);
          } catch { /* Leave an invalid link as plain anchor text. */ }
        }
      }
    }
    return wrapper.innerHTML;
  }

  globalThis.okustaPick = function startPicker(onPick, onCancel, mode = "text", dark = false) {
    let html = mode === "html";
    const previous = document.activeElement;
    const shield = document.createElement("div");
    const bounds = {all: "initial", display: "block", position: "fixed", inset: "0", cursor: "crosshair",
      "z-index": "2147483647", "pointer-events": "auto", background: "transparent"};
    for (const [key, value] of Object.entries(bounds)) shield.style.setProperty(key, value, "important");
    shield.tabIndex = -1;
    shield.setAttribute("role", "dialog");
    shield.setAttribute("aria-label", html ? "Pick an HTML node" : "Pick a page element");
    const root = shield.attachShadow({mode: "closed"});
    const outline = document.createElement("div");
    outline.style.cssText = "position:fixed;pointer-events:none;border:2px solid #315acb;background:#698bff33;box-sizing:border-box;display:none";
    outline.style.borderColor = dark ? "#14998b" : "#c15260";
    outline.style.backgroundColor = dark ? "rgba(20,153,139,.22)" : "rgba(193,82,96,.18)";
    const hint = document.createElement("div");
    hint.style.cssText = "position:fixed;bottom:12px;left:50%;transform:translateX(-50%);padding:5px 10px;background:#242a27;color:white;font:12px/1.4 system-ui;pointer-events:none;border:1px solid white;text-align:center";
    hint.setAttribute("role", "status");
    root.append(outline, hint);
    document.documentElement.append(shield);
    shield.focus({preventScroll: true});
    let leaf = null, target = null, point = null, ended = false;
    const listeners = new AbortController();

    function draw() {
      const label = target ? "<" + target.localName + (html && target.id ? "#" + target.id : "") + "> · " : "";
      hint.textContent = (html ? "HTML · " : "Text · ") + label + "Click to pick · T switches to " + (html ? "text" : "HTML") + " · ↑ parent · ↓ child · Esc cancel";
      outline.style.display = target ? "block" : "none";
      if (!target) return;
      const {left, top, width, height} = target.getBoundingClientRect();
      Object.assign(outline.style, {left: left+"px", top: top+"px", width: width+"px", height: height+"px"});
    }

    function locate(x, y) {
      point = {x, y};
      const hit = document.elementsFromPoint(x, y).find(el => el !== shield);
      const next = hit && hit !== document.documentElement && hit !== document.body && !hit.closest(html ? omitHTML : excluded)
        ? (html ? hit : hit.closest(semantic) ?? hit) : null;
      if (leaf !== next) { leaf = next; target = next; }
      draw();
    }

    function finish(node, text) {
      if (ended) return;
      ended = true;
      listeners.abort();
      shield.remove();
      if (previous?.isConnected) previous.focus?.({preventScroll: true});
      if (node) onPick({...(html ? {kind: "html"} : {}), text, element: node.localName,
        source: {title: document.title || location.hostname, url: location.href}}, node);
      else onCancel();
    }

    function commit() {
      try {
        const text = target && (html ? captureHTML(target) : extract(target));
        if (text?.trim()) { finish(target, text); return; }
        hint.textContent = html ? "Pick a page element or press Esc." : "No readable text here. Pick another element or press Esc.";
      } catch {
        hint.textContent = "Could not capture this element. Pick another element or press Esc.";
      }
    }
    shield.addEventListener("pointermove", e => locate(e.clientX, e.clientY));
    shield.addEventListener("pointerdown", e => { e.preventDefault(); e.stopPropagation(); locate(e.clientX, e.clientY); });
    shield.addEventListener("pointerup", e => { e.preventDefault(); e.stopPropagation(); });
    shield.addEventListener("click", e => {
      e.preventDefault(); e.stopImmediatePropagation(); locate(e.clientX, e.clientY); commit();
    });
    window.addEventListener("keydown", e => {
      if (!["Escape","Enter","ArrowUp","ArrowDown","Tab","t","T"].includes(e.key) || e.ctrlKey || e.metaKey || e.altKey) return;
      e.preventDefault(); e.stopImmediatePropagation();
      if (e.key.toLowerCase() === "t") {
        if (e.repeat) return;
        html = !html; leaf = target = null;
        if (point) locate(point.x, point.y); else draw();
        return;
      }
      if (e.key === "Escape") { finish(null); return; }
      if (e.key === "Enter") { commit(); return; }
      if (e.key === "ArrowUp" && target?.parentElement && !["html","body"].includes(target.parentElement.localName) &&
          !target.parentElement.closest(html ? omitHTML : excluded)) {
        target = target.parentElement;
      } else if (e.key === "ArrowDown" && leaf && target !== leaf) {
        let child = leaf;
        while (child.parentElement && child.parentElement !== target) child = child.parentElement;
        if (child.parentElement === target) target = child;
      }
      draw();
    }, {capture: true, signal: listeners.signal});
    const reposition = () => { if (point) locate(point.x, point.y); };
    window.addEventListener("scroll", reposition, {capture: true, signal: listeners.signal});
    window.addEventListener("resize", reposition, {signal: listeners.signal});
    draw();
    return () => finish(null);
  };
})();
