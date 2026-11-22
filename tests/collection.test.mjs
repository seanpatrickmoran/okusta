import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {validateRecord,start,step,grade} from "../src/replay/collection.mjs";
import {validate,describe} from "../src/replay/formats.js";
import {collectionPlayer} from "../src/replay/collection-player.js";
const record = JSON.parse(readFileSync(new URL("../examples/collection.okusta-replay.json",import.meta.url)));
test("recomputes every observation and grade before import",() => {
  assert.equal(validate(record),record);
  assert.match(describe(record),/2 → 3/);
  for (const change of [
    r=>{r.steps[0].observation.hits.reverse();},
    r=>{r.grade.verified=false;},r=>{r.steps.push(r.steps[0]);},
    r=>{r.stop="token limit";},r=>{r.origin.actor="policy";},r=>{r.fixture.gold.push("00000000");}
  ]) {
    const other=structuredClone(record); change(other);
    assert.throws(()=>validateRecord(other));
  }
});
test("failed saves preserve stored IDs and verification freshness",() => {
  const f=record.fixture,s=start(f);
  step(f,s,{op:"save",ids:f.gold});
  assert.equal(step(f,s,{op:"open"}).members.length,2);
  assert.ok(step(f,s,{op:"save",ids:["dddddddd"]}).error);
  assert.equal(grade(f,s).readAfterSave,true);
  step(f,s,{op:"save",ids:f.gold});
  assert.equal(grade(f,s).readAfterSave,false);
  step(f,s,{op:"open"}); step(f,s,{op:"finish"});
  assert.equal(grade(f,s).verified,true);
});
test("imports into a journal and coalesces a repeated import",async() => {
  const records={};
  globalThis.chrome={storage:{local:{get:async keys=>Object.fromEntries(Object.entries(records).filter(([k])=>keys.includes(k))),
    set:async o=>Object.assign(records,o)}}};
  const {importReplay}=await import("../src/journal.js");
  const legacy = {...record, format: "zerkalo-collection/1"};
  assert.equal(describe(legacy), describe(record));
  const a=await importReplay(legacy),b=await importReplay(record);
  assert.deepEqual(a,b);
  assert.deepEqual(Object.keys(records),["clip:"+a.id]);
  assert.match(records["clip:"+a.id].text,/Verified completion/);
});
test("player steps from receipt to missing ID to verified membership and resets",() => {
  class Node extends EventTarget {
    constructor(tag){super();this.tag=tag;this.children=[];this.textContent="";this.isConnected=true;}
    append(...nodes){this.children.push(...nodes);}
    replaceChildren(...nodes){this.children=nodes;}
    setAttribute(k,v){this[k]=v;}
    all(){return [this,...this.children.flatMap(n=>n.all())];}
  }
  globalThis.document={createElement:t=>new Node(t)};
  const card=collectionPlayer(record,true);
  const pick=t=>card.all().find(n=>n.textContent===t);
  const button=pick("Step");
  for(let i=0;i<record.steps.length;i++){
    button.onclick();
    const e=record.steps[i];
    if(e.action.op==="open" && e.observation.members.length===2)
      assert.ok(card.all().some(n=>n.textContent.startsWith("Missing from the save request: Finding the right passage")));
  }
  assert.ok(pick("Verified completion · 3 of 3 saved · finish"));
  assert.ok(button.disabled);
  pick("Reset").onclick(); assert.equal(button.disabled,false); assert.ok(pick("Ready · 0 of 10 actions"));
  pick("Play").onclick(); assert.ok(pick("Pause")); pick("Pause").onclick();
});
