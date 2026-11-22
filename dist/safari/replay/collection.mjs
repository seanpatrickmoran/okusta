// This reducer runs both under Node during rollouts and inside Okusta during replay.
export const LIMIT = 16;
export const FORMAT = "okusta-collection/1";
export const isCollectionFormat = format => format === FORMAT || format === "zerkalo-collection/1";
const only = (object, fields) => object !== null && typeof object === "object" && !Array.isArray(object) &&
  Object.keys(object).length === fields.length && fields.every(k => Object.hasOwn(object, k));
const str = (s, n) => typeof s === "string" && s.length > 0 && s.length <= n;
const id = x => typeof x === "string" && /^[a-f0-9]{8}$/.test(x);
const unique = a => new Set(a).size === a.length;
const sameMembers = (a,b) => a.length === b.length && a.every(v => b.includes(v));
export function checkFixture(f) {
  if (!only(f, ["key","journal","goal","name","clips","gold","omitIndex","replaceOmitted"]) ||
      ![f.key,f.journal,f.name].every(x => str(x,100)) || !str(f.goal,600) ||
      !Array.isArray(f.clips) || f.clips.length < 3 || f.clips.length > 12 ||
      !f.clips.every(c => only(c, ["id","title","body","tag"]) && id(c.id) && str(c.title,100) &&
        str(c.body,450) && str(c.tag,32)) || !unique(f.clips.map(c => c.id)) ||
      !Array.isArray(f.gold) || f.gold.length !== 3 || !unique(f.gold) ||
      !f.gold.every(k => f.clips.some(c => c.id === k)) ||
      typeof f.replaceOmitted !== "boolean" || !Number.isInteger(f.omitIndex) || f.omitIndex < -1 || f.omitIndex > 2)
    throw new Error("Invalid journal fixture.");
}
export function start(f) {
  checkFixture(f);
  return {saved:[], writes:0, readVersion:-1, finished:false, faultVersion:null, omitted:null, sawOmission:false, repaired:false};
}
export function validAction(a) {
  if (!a || typeof a !== "object") return false;
  switch (a.op) {
    case "search": return only(a,["op","query"]) && typeof a.query === "string" && a.query.length <= 100;
    case "inspect": return only(a,["op","id"]) && id(a.id);
    case "save": return only(a,["op","ids"]) && Array.isArray(a.ids) && a.ids.length <= 12 && a.ids.every(id) && unique(a.ids);
    case "open": case "finish": case "invalid": return only(a,["op"]);
    default: return false;
  }
}
const header = c => ({id:c.id, title:c.title});
export function step(f,s,a) {
  if (s.finished) throw new Error("Action after finish.");
  if (!validAction(a)) throw new Error("Invalid normalized action.");
  if (a.op === "invalid") return {error:"Use one tool call with valid arguments."};
  if (a.op === "search") {
    const terms = a.query.toLowerCase().trim().split(/\s+/).filter(Boolean);
    return {hits:f.clips.filter(c => {
      const text = [c.title,c.body,c.tag].join(" ").toLowerCase();
      return terms.every(t => text.includes(t));
    }).map(header)};
  }
  if (a.op === "inspect") {
    const clip = f.clips.find(c => c.id === a.id);
    return clip ? {...header(clip),body:clip.body} : {error:"Unknown clipping ID."};
  }
  if (a.op === "save") {
    if (!a.ids.every(k => f.clips.some(c => c.id === k))) return {error:"Unknown clipping ID."};
    s.saved = [...a.ids];
    if (s.faultVersion === null && s.saved.length && f.omitIndex >= 0) {
      s.faultVersion = s.writes + 1;
      const pos = f.omitIndex % s.saved.length;
      [s.omitted] = s.saved.splice(pos, 1);
      if (f.replaceOmitted) {
        const source = f.clips.find(c => c.id === s.omitted);
        const others = f.clips.filter(c => !a.ids.includes(c.id));
        const foil = others.find(c => c.title === source.title) ?? others[0];
        if (foil) s.saved.splice(pos,0,foil.id);
      }
    }
    s.writes += 1;
    if (s.sawOmission && sameMembers(s.saved,f.gold)) s.repaired = true;
    return {receipt:"Save request received.",collection:f.name};
  }
  if (a.op === "open") {
    s.readVersion = s.writes;
    if (s.writes === s.faultVersion && f.gold.includes(s.omitted) && !s.saved.includes(s.omitted)) s.sawOmission = true;
    return {collection:f.name, members:s.saved.map(k => header(f.clips.find(c => c.id === k)))};
  }
  s.finished = true;
  return {submitted:true};
}
export function grade(f,s) {
  const exact = sameMembers(s.saved,f.gold), fresh = s.writes > 0 && s.readVersion === s.writes;
  return {exact,readAfterSave:fresh,submitted:s.finished,verified:exact && fresh && s.finished,
    falseCompletion:s.finished && !exact, recovered:s.finished && exact && fresh && s.repaired,
    missing:f.gold.filter(k => !s.saved.includes(k)),extra:s.saved.filter(k => !f.gold.includes(k))};
}
export function stableJSON(value) {
  const order = obj => Array.isArray(obj) ? obj.map(order) : obj && typeof obj === "object"
    ? Object.fromEntries(Object.keys(obj).sort().map(k => [k,order(obj[k])])) : obj;
  return JSON.stringify(order(value));
}
export function validateRecord(r) {
  if (!only(r,["format","id","title","origin","fixture","steps","grade","stop"]) || !isCollectionFormat(r.format) ||
      !str(r.id,128) || !r.id.startsWith("collection-") || !str(r.title,180) ||
      !Array.isArray(r.steps) || r.steps.length > LIMIT || !["finish","action limit","token limit"].includes(r.stop))
    throw new Error("Invalid collection replay.");
  const o = r.origin, policy = o?.actor === "policy";
  if (!only(o,policy ? ["actor","model","adapterSha256"] : ["actor","name"]) ||
      !(policy ? str(o.model,512) && str(o.adapterSha256,64) && /^[a-f0-9]{64}$/.test(o.adapterSha256) :
        o.actor === "scripted" && str(o.name,80))) throw new Error("Invalid collection producer.");
  const s = start(r.fixture);
  for (const e of r.steps) {
    if (!only(e,["action","observation"]) || !validAction(e.action) ||
        stableJSON(step(r.fixture,s,e.action)) !== stableJSON(e.observation)) throw new Error("Replay observation differs.");
  }
  if ((r.stop === "finish") !== s.finished || (r.stop === "action limit" && r.steps.length !== LIMIT) ||
      stableJSON(grade(r.fixture,s)) !== stableJSON(r.grade)) throw new Error("Replay grade differs.");
  return r;
}
