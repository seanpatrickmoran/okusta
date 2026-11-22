import assert from "node:assert/strict";
import {readFile} from "node:fs/promises";
import test from "node:test";
import vm from "node:vm";
import {generateNote, makePayload, probeLocalImage} from "../src/model.js";

const png = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+j03sAAAAASUVORK5CYII=";
const clip = {kind: "image", id: "example", image: {dataUrl: png, width: 1, height: 1},
  source: {title: "Source", url: "https://example.org/doc?private=1#frag"}, text: ""};

test("local capability check submits a fixed image to the chosen endpoint and handles text-only servers", async t => {
  const fetch = t.mock.method(globalThis, "fetch", async (url, options) => {
    assert.equal(url, "http://127.0.0.1:9000/v1/chat/completions");
    const body = JSON.parse(options.body);
    assert.equal(body.model, "fixture");
    assert.equal(body.max_tokens, 1);
    assert.equal(body.stream, false);
    const urlPart = body.messages[0].content[1].image_url.url;
    const bytes = Buffer.from(urlPart.split(",")[1], "base64");
    assert.equal(bytes.readUInt32BE(16), 64);
    assert.equal(bytes.readUInt32BE(20), 64);
    return Response.json({choices: [{message: {content: "Red"}}]});
  });
  assert.equal(await probeLocalImage("http://127.0.0.1:9000", "fixture"), true);
  fetch.mock.mockImplementation(async () => Response.json({error: {message: "Text only"}}, {status: 400}));
  assert.equal(await probeLocalImage("http://127.0.0.1:9000", "fixture"), false);
});

test("description and follow-up each contain the crop once, with clean source metadata", async t => {
  const bodies = [];
  t.mock.method(globalThis, "fetch", async (_url, options) => {
    bodies.push(JSON.parse(options.body));
    return Response.json({choices: [{message: {content: "Reply"}}]});
  });
  const history = [{role: "user", content: "First question"}, {role: "assistant", content: "First reply"}];
  await generateNote("local-vlm", clip);
  await generateNote("hosted-vlm", clip, undefined, "Next question", {provider: "openrouter", token: "fixture", history});
  for (const body of bodies) {
    const parts = body.messages[1].content;
    assert.deepEqual(parts[1], {type: "image_url", image_url: {url: png}});
    assert.equal(parts[0].type, "text");
    assert.match(parts[0].text, /https:\/\/example.org\/doc"/);
    assert.equal(JSON.stringify(body).split(png).length, 2);
    assert.doesNotMatch(JSON.stringify(body), /private=1|#frag/);
  }
  assert.match(bodies[1].messages[1].content[0].text, /First question/);
  assert.deepEqual(bodies[1].messages.slice(2), [history[1], {role: "user", content: "Next question"}]);
  assert.doesNotMatch(JSON.stringify(makePayload(clip)), /base64/);
});

const pickerScript = await readFile(new URL("../src/region-picker.js", import.meta.url), "utf8");
function picker() {
  const draws = [], canvases = [], mounted = Promise.withResolvers(), finished = Promise.withResolvers();
  const window = new EventTarget(), document = new EventTarget();
  let removed = false;
  function element(tag) {
    const e = new EventTarget();
    Object.assign(e, {style: {setProperty() {}}, setAttribute() {}, focus() {}, append() {},
      attachShadow: () => element("shadow"), remove() { removed = true; }});
    if (tag === "canvas") {
      canvases.push(e);
      e.getBoundingClientRect = () => ({left: 10, top: 20, width: 6, height: 4});
      e.getContext = () => ({drawImage: (...args) => draws.push(args.slice(1))});
      e.setPointerCapture = () => {};
      e.toDataURL = () => png;
    }
    return e;
  }
  Object.assign(document, {createElement: element, documentElement: {append: mounted.resolve}, title: "Page"});
  const globals = {document, window, location: new URL("https://example.org"), Blob, atob, AbortController,
    requestAnimationFrame: queueMicrotask, createImageBitmap: async () => ({width: 12, height: 8, close() {}})};
  vm.runInNewContext(pickerScript, globals);
  const start = capture => globals.okustaPickRegion(capture, (...args) => finished.resolve(args));
  function dispatch(target, type, fields) {
    target.dispatchEvent(Object.assign(new Event(type, {cancelable: true}), fields));
  }
  return {start, mounted, finished, draws, canvases, window, dispatch, removed: () => removed};
}

test("a backwards drag is clamped and mapped to captured bitmap pixels at 2x scale", async () => {
  const p = picker();
  p.start(async () => png);
  await p.mounted.promise;
  const pointer = {button: 0, isPrimary: true, pointerId: 1};
  p.dispatch(p.canvases[0], "pointerdown", {...pointer, clientX: 15.25, clientY: 23});
  p.dispatch(p.canvases[0], "pointerup", {...pointer, clientX: 9, clientY: 21});
  const [crop, preview] = await p.finished.promise;
  assert.deepEqual(p.draws, [[0, 0], [0, 2, 11, 4, 0, 0, 11, 4]]);
  assert.equal(crop.image.width, 11);
  assert.equal(crop.image.height, 4);
  assert.equal(preview, p.canvases[1]);
  assert.equal(p.canvases[0].width, 0);
  assert.equal(p.removed(), true);
});

test("Escape while awaiting the snapshot discards the result without mounting a picker", async () => {
  const p = picker(), started = Promise.withResolvers(), response = Promise.withResolvers();
  p.start(() => { started.resolve(); return response.promise; });
  await started.promise;
  p.dispatch(p.window, "keydown", {key: "Escape"});
  assert.equal((await p.finished.promise)[0], null);
  response.resolve(png);
  await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(p.draws, []);
  assert.equal(p.removed(), true);
});

test("the background discards a screenshot if the active tab changes during capture", async t => {
  function tabEvent() {
    const listeners = new Set();
    return {addListener: fn => listeners.add(fn), removeListener: fn => listeners.delete(fn),
      deliver: info => listeners.forEach(fn => fn(info)), count: () => listeners.size};
  }
  const activation = tabEvent(), update = tabEvent();
  const route = {provider: "local", model: "fixture", port: 9000, imageInput: true};
  const sender = {id: "self", frameId: 0, tab: {id: 10, windowId: 12}, url: "https://example.org/"};
  let listener, captures = 0, switchTab = false;
  const tabs = {onActivated: activation, onUpdated: update, query: async () => [{id: 10, url: sender.url}],
    async captureVisibleTab(windowId, options) {
      assert.equal(windowId, 12);
      assert.deepEqual(options, {format: "png"});
      captures++;
      if (switchTab) activation.deliver({windowId});
      return png;
    }};
  globalThis.browser = {tabs, runtime: {id: "self", onConnect: {addListener() {}},
    onMessage: {addListener(fn) { listener = fn; }}}, action: {onClicked: {addListener() {}}},
    storage: {local: {get: async () => ({modelRoute: route})}}};
  t.after(() => { delete globalThis.browser; });
  await import("../src/background.js");
  function capture(from = sender) {
    const message = {type: "panel-capture", expectedRoute: JSON.stringify(["local", "fixture", 9000])};
    return new Promise(resolve => listener(message, from, resolve));
  }
  assert.deepEqual(await capture(), {ok: true, value: png});
  switchTab = true;
  assert.match((await capture()).error, /tab changed/);
  assert.match((await capture({...sender, frameId: 1})).error, /ordinary web page/);
  route.imageInput = false;
  assert.match((await capture()).error, /model changed/);
  assert.equal(captures, 2);
  assert.equal(activation.count() + update.count(), 0);
});
