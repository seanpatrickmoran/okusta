import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import test from "node:test";
import {playable, validate} from "../src/replay/record.js";
import {makePayload} from "../src/model.js";
const fixture = JSON.parse(readFileSync(new URL("../examples/tabs.okusta-replay.json",import.meta.url)));
const records = {};
globalThis.chrome = {storage:{local:{
  get: async ks => Object.fromEntries(Object.entries(records).filter(([k]) => ks == null || ks.includes(k))),
  set: async data => Object.assign(records, structuredClone(data)),
  remove: async ks => ks.forEach(k => delete records[k]),
}}};
const {serial, importReplay, editEntry} = await import("../src/journal.js");

test("validates provenance, cursors, grades and packaged selectors before storage", () => {
  assert.ok(playable(validate(fixture)));
  const next = () => structuredClone(fixture);
  const alt = next(); alt.fixture.sha256 = "e".repeat(64);
  assert.equal(playable(validate(alt)),false);
  for (const change of [r => {r.origin.actor="policy";}, r => {r.pauseAfter=4;},
    r => {r.steps[0].selector="#out";}, r => {r.verification.reference.actual="wrong";},
    r => {r.verification.candidate.observed=false;}, r => {r.fixture.source="arbitrary";}]) {
    const r=next(); change(r); assert.throws(() => validate(r), /Invalid replay/);
  }
});
test("profile reimports coalesce, conflicting IDs preserve the original and branches are independent", async () => {
  const legacy = {...fixture, format: "zerkalo-replay/1"};
  const [a,b] = await Promise.all([legacy,fixture].map(r => serial(() => importReplay(r))));
  assert.deepEqual(a,b);
  const original = records["clip:"+a.id];
  assert.equal(Object.keys(records).length,1);
  const altered = {...fixture,title:"Different title"};
  await assert.rejects(serial(() => importReplay(altered)),/different submission/);
  const branch = await editEntry("split",a.id);
  assert.deepEqual(records["clip:"+branch.id].replay,original.replay);
  await editEntry("delete",branch.id);
  assert.equal(original.text.includes('Recorded ""'),true);
  assert.deepEqual(makePayload(original),{capture:{kind:"replay"},title:fixture.title,selection:original.text});
  assert.equal(records["clip:"+a.id],original);
});
