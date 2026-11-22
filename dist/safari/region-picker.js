// The full snapshot lives only in this picker. The panel receives an independent crop.
globalThis.okustaPickRegion = function pickRegion(capture, finish) {
  const events = new AbortController();
  const {signal} = events;
  const source = {title: document.title || location.hostname, url: location.href};
  const host = document.createElement("div");
  for (const [name, value] of Object.entries({
    all: "initial", position: "fixed", inset: "0", display: "block", "z-index": "2147483647",
    padding: "0", margin: "0", border: "0", "pointer-events": "auto", "touch-action": "none"
  })) host.style.setProperty(name, value, "important");
  const root = host.attachShadow({mode: "closed"});
  const surface = document.createElement("canvas");
  surface.tabIndex = 0;
  surface.setAttribute("aria-label", "Drag a rectangle to capture. Escape cancels.");
  surface.style.cssText = "display:block;width:100%;height:100%;cursor:crosshair;touch-action:none";
  const outline = document.createElement("div");
  outline.style.cssText = "position:absolute;display:none;pointer-events:none;box-sizing:border-box;border:2px solid white;outline:1px solid black;box-shadow:0 0 0 100vmax #0005";
  const hint = document.createElement("div");
  hint.textContent = "Drag to capture · Esc cancels";
  hint.style.cssText = "position:absolute;left:50%;bottom:12px;transform:translateX(-50%);padding:5px 10px;pointer-events:none;background:#242a27;color:white;font:12px/1.4 system-ui";
  root.append(surface, outline, hint);
  let pointer = null, origin;
  function end(clip = null, preview = null, error = "") {
    if (signal.aborted) return;
    events.abort();
    host.remove();
    surface.width = surface.height = 0;
    finish(clip, preview, error);
  }
  const cancel = () => end();
  window.addEventListener("keydown", event => {
    if (event.key === "Escape") {
      event.preventDefault(); event.stopImmediatePropagation(); cancel();
    }
  }, {capture: true, signal});
  document.addEventListener("visibilitychange", () => { if (document.hidden) cancel(); }, {signal});
  window.addEventListener("resize", cancel, {signal});
  window.visualViewport?.addEventListener("resize", cancel, {signal});
  host.addEventListener("wheel", event => event.preventDefault(), {passive: false, signal});
  surface.addEventListener("pointercancel", cancel, {signal});
  surface.addEventListener("lostpointercapture", () => { if (pointer !== null) cancel(); }, {signal});
  const point = (event, rect) => ({
    x: Math.max(0, Math.min(rect.width, event.clientX - rect.left)),
    y: Math.max(0, Math.min(rect.height, event.clientY - rect.top))
  });
  function selection(event, rect) {
    const at = point(event, rect);
    return {left: Math.min(origin.x, at.x), top: Math.min(origin.y, at.y),
      right: Math.max(origin.x, at.x), bottom: Math.max(origin.y, at.y)};
  }
  surface.addEventListener("pointerdown", event => {
    if (pointer !== null || event.button !== 0 || !event.isPrimary) return;
    event.preventDefault();
    pointer = event.pointerId;
    origin = point(event, surface.getBoundingClientRect());
    surface.setPointerCapture(pointer);
  }, {signal});
  surface.addEventListener("pointermove", event => {
    if (pointer !== event.pointerId) return;
    const {left, top, right, bottom} = selection(event, surface.getBoundingClientRect());
    Object.assign(outline.style, {display: "block", left: left + "px", top: top + "px",
      width: (right - left) + "px", height: (bottom - top) + "px"});
  }, {signal});
  surface.addEventListener("pointerup", event => {
    if (pointer !== event.pointerId) return;
    pointer = null;
    const rect = surface.getBoundingClientRect();
    const {left, top, right, bottom} = selection(event, rect);
    if (right - left < 1 || bottom - top < 1) {
      outline.style.display = "none";
      return;
    }
    // The decoded bitmap is authoritative for both Retina and browser zoom.
    const sx = surface.width / rect.width, sy = surface.height / rect.height;
    const x = Math.floor(left * sx), y = Math.floor(top * sy);
    const crop = document.createElement("canvas");
    try {
      const width = crop.width = Math.min(surface.width, Math.ceil(right * sx)) - x;
      const height = crop.height = Math.min(surface.height, Math.ceil(bottom * sy)) - y;
      crop.getContext("2d").drawImage(surface, x, y, width, height, 0, 0, width, height);
      const dataUrl = crop.toDataURL("image/png");
      if (!dataUrl.startsWith("data:image/png;base64,")) throw new Error("Choose a smaller region.");
      end({kind: "image", text: "", image: {dataUrl, width, height}, source}, crop);
    } catch (error) { end(null, null, "Could not crop this region. " + error.message); }
  }, {signal});

  async function freeze() {
    // Allow a paint with Okusta hidden before asking the browser for the bitmap.
    await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    if (signal.aborted) return;
    const data = await capture();
    if (signal.aborted) return;
    const prefix = "data:image/png;base64,";
    if (!data?.startsWith(prefix)) throw new Error("The browser did not return a PNG.");
    const encoded = data.slice(prefix.length);
    let bytes;
    if (Uint8Array.fromBase64) bytes = Uint8Array.fromBase64(encoded);
    else {
      const binary = atob(encoded);
      bytes = new Uint8Array(binary.length);
      for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    }
    const bitmap = await createImageBitmap(new Blob([bytes], {type: "image/png"}));
    try {
      if (signal.aborted) return;
      surface.width = bitmap.width;
      surface.height = bitmap.height;
      surface.getContext("2d").drawImage(bitmap, 0, 0);
    } finally { bitmap.close(); }
    document.documentElement.append(host);
    surface.focus({preventScroll: true});
  }
  freeze().catch(error => end(null, null, "Could not capture the tab. " + error.message));
  return cancel;
};
