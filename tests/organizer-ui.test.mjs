import assert from "node:assert/strict";
import test from "node:test";

class Element extends EventTarget {
  constructor(tag) {
    super();
    this.tag = tag; this.value = ""; this.textContent = ""; this.dataset = {}; this.children = [];
  }
  append(...children) { this.children.push(...children); }
  replaceChildren(...children) { this.children = children; }
  get childElementCount() { return this.children.length; }
  querySelectorAll(selector) {
    return this.children.flatMap(child => [
      ...(child.tag === selector || (selector === "details[open]" && child.tag === "details" && child.open) ? [child] : []),
      ...child.querySelectorAll(selector)
    ]);
  }
}
test("journal controls run the named adapter and display the persisted links while offline", async t => {
  const controls = new Map(), port = 9401, model = "collection";
  const byId = id => {
    if (!controls.has(id)) controls.set(id, new Element("div"));
    return controls.get(id);
  };
  const make = (tag, text = "") => Object.assign(new Element(tag), {textContent: text});
  globalThis.document = {getElementById: byId, createElement: make, createTextNode: text => make("text", text)};
  globalThis.window = new EventTarget();
  const store = {type:"profile", path:""}, route = {port, model};
  const clips = ["aaaaaaaa", "bbbbbbbb"].map((s, i) => ({id:s.repeat(4), text:"Body " + i,
    source:{title:"Clipping " + i}, createdAt:"2026-11-20T01:00:00Z"}));
  const records = Object.fromEntries(clips.map(c => ["clip:" + c.id, c]));
  let incoming;
  const values = {...records, collectionAdapter:route, modelRoute:{provider:"openrouter",model:"hosted",port:8765}};
  const get = async keys => structuredClone(Object.fromEntries(Object.entries(values).filter(([k]) => keys == null || [].concat(keys).includes(k))));
  const deskURL = "chrome-extension://unit/desk.html";
  const api = {runtime: {id:"unit", getURL: () => deskURL, onConnect:{addListener(){}},
    onMessage:{addListener(fn) {incoming = fn;}}, sendMessage: m => new Promise(resolve => incoming(m, {id:"unit",url:deskURL}, resolve))},
    action:{onClicked:{addListener(){}}}, storage:{local:{get, set:async obj => Object.assign(values, structuredClone(obj))},
      onChanged:{addListener(){}}}};
  globalThis.browser = api;
  t.after(() => { delete globalThis.browser; delete globalThis.window; delete globalThis.document; });
  const actions = [{op:"search",query:""},{op:"inspect",id:"aaaaaaaa"},{op:"save",ids:["aaaaaaaa"]},{op:"open"},{op:"finish"}];
  t.mock.method(globalThis, "fetch", async (url, options) => {
    assert.equal(new URL(url).origin, "http://127.0.0.1:" + port);
    if (url.endsWith("/v1/models")) return Response.json({data:[{id:"base"},{id:model,parent:"base"}]});
    const body = JSON.parse(options.body), action = actions.shift();
    assert.equal(body.model, model);
    assert.doesNotMatch(JSON.stringify(body.messages), /Clipping 1|Body 1/);
    return Response.json({choices:[{finish_reason:"tool_calls", message:{tool_calls:[{type:"function",id:"id-" + actions.length,
      function:{name:action.op === "finish" ? "finish":"experiment", arguments:JSON.stringify(action.op === "finish"?{}:action)}}]}}]});
  });
  await import("../src/background.js");
  const {updateOrganizer} = await import("../src/organizer.js");
  updateOrganizer(clips, records, store);
  byId("collection-name").value = "Measurements"; byId("collection-goal").value = "Keep measured results.";
  const pick = byId("collection-pick");
  const input = pick.querySelectorAll("input")[0]; input.checked = true;
  // EventTarget has no DOM bubbling. Deliver the checkbox change to the delegated listener.
  const e = new Event("change"); Object.defineProperty(e,"target",{value:input}); pick.dispatchEvent(e);
  assert.equal(byId("organize-start").disabled,false);
  await byId("organize-start").onclick();
  assert.deepEqual(actions, []);
  assert.match(byId("organize-status").textContent, /Checked “Measurements”.*1 member/);
  assert.equal(byId("organize-trace").children.length, 5);
  const snapshot = (await api.runtime.sendMessage({type:"journal-snapshot"})).value;
  assert.equal(Object.keys(snapshot.records).filter(k => k.startsWith("collection:")).length, 1);
  updateOrganizer(clips, snapshot.records, store);
  assert.equal(byId("saved-collections").querySelectorAll("a")[0].href, "#entry-" + clips[0].id);
  assert.equal(values.modelRoute.provider, "openrouter");
});
