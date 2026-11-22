import test from "node:test";
import assert from "node:assert/strict";
import {localAdapter, probeAdapter, organize} from "../src/collection-agent.js";
import {findModel} from "../src/model.js";

const route = localAdapter("collection", 8765);
const clips = ["Alpha", "Beta"].map((title, i) => ({id: (i + 1).toString(16).padStart(8, "0") + "9".repeat(24), source: {title}, text: title + " result"}));
function fixture(t, actions) {
  const requests = [];
  t.mock.method(globalThis, "fetch", async (url, options) => {
    if (url.endsWith("/v1/models")) return Response.json({data: [{id: "base"}, {id: "collection", parent: "base"}]});
    assert.equal(url, "http://127.0.0.1:8765/v1/chat/completions");
    const body = JSON.parse(options.body);
    assert.equal(body.model, route.model); assert.equal(body.tool_choice, "auto");
    assert.deepEqual(body.tools.map(x => x.function.name), ["experiment", "finish"]);
    requests.push(body);
    const action = actions.shift();
    assert.ok(action, "unexpected extra completion");
    const calls = action === "malformed" ? [] : [{id: "call-" + requests.length, type: "function",
      function: {name: action.op === "finish" ? "finish" : "experiment", arguments: JSON.stringify(action.op === "finish" ? {} : action)}}];
    return Response.json({choices: [{finish_reason: "tool_calls", message: {tool_calls: calls}}]});
  });
  return requests;
}
test("adapter probe selects the served adapter and leaves base-model discovery independent", async t => {
  const req = fixture(t, [{op: "search", query: ""}]);
  assert.equal(await probeAdapter(route), "base");
  assert.equal(await findModel(), "base");
  assert.equal(await findModel(undefined, "collection"), "collection");
  await assert.rejects(probeAdapter({...route, model: "typo"}), /missing/);
  await assert.rejects(probeAdapter({...route, model: "base"}), /without a base/);
  assert.throws(() => localAdapter("collection", "8765/path"));
  assert.doesNotMatch(JSON.stringify(req), /Alpha|Beta/);
});
test("runs native actions, rejects out-of-scope IDs and repairs independently read membership", async t => {
  const a = "00000001", b = "00000002";
  const requests = fixture(t, ["malformed", {op:"finish"}, {op:"search",query:"result"}, {op:"inspect",id:b},
    {op:"save",ids:["deadbeef"]}, {op:"save",ids:[a,b]}, {op:"open"}, {op:"finish"},
    {op:"save",ids:[a,b]}, {op:"open"}, {op:"finish"}]);
  const trace = []; let saved, writes = 0;
  const count = await organize({route, clips, name: "Results", criterion: "Keep measured results.",
    save: async ids => { writes++; assert.deepEqual(ids, clips.map(c => c.id)); saved = writes === 1 ? ids.slice(1) : [...ids]; },
    open: async () => ({members: saved.map(id => ({id, exists:true, title: clips.find(c => c.id === id).source.title}))}),
    report: (turn, action, obs) => trace.push([action.op, obs])});
  assert.equal(count, 2); assert.equal(writes, 2);
  assert.ok(trace[0][1].error); assert.ok(trace[1][1].error); assert.ok(trace[4][1].error);
  assert.deepEqual(trace[6][1].members.map(m => m.id), [b]); assert.ok(trace[7][1].error);
  assert.deepEqual(trace.at(-1)[1], {submitted: true});
  assert.deepEqual(JSON.parse(requests[4].messages.at(-1).content), {id:b, title:"Beta", body:"Beta result"});
  assert.equal(requests[4].messages.at(-1).tool_call_id, "call-4");
});
test("bounds incomplete runs and cancels without a subsequent write", async t => {
  const trace = [], acts = Array.from({length: 16}, () => ({op:"finish"}));
  fixture(t, acts);
  const options = {route, clips, name: "Results", criterion: "Keep measured results.",
    save: () => assert.fail("unexpected save"), open: () => assert.fail("unexpected read"),
    report: turn => trace.push(turn)};
  await assert.rejects(organize(options), /16-turn limit/);
  assert.equal(trace.length,16);
  const cancellation = new AbortController();
  acts.push({op:"search",query:""});
  await assert.rejects(organize({...options, signal:cancellation.signal, report:() => cancellation.abort()}), {name:"AbortError"});
});
