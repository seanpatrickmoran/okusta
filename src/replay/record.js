export const tabsDigest = "79d7efde2e2c224fb3aefe7476bff7e7100cd846518623a766dea52f2383eeb9";
export function playable(r) {
  return r.fixture.runtime === "autoscript-sync-widget/1" && r.fixture.sha256 === tabsDigest;
}
const hex = x => typeof x === "string" && /^[a-f0-9]{64}$/.test(x);
const short = (x, n) => typeof x === "string" && x.length > 0 && x.length <= n;
function keys(obj, names) {
  return obj && typeof obj === "object" && !Array.isArray(obj) &&
    Object.keys(obj).length === names.length && names.every(k => Object.hasOwn(obj, k));
}
export function validate(r) {
  function require(ok, message) { if (!ok) throw new Error("Invalid replay. " + message); }
  require(keys(r, ["format","id","origin","title","start","fixture","steps","pauseAfter","verification"]) &&
    (r.format === "okusta-replay/1" || r.format === "zerkalo-replay/1") && r.start === "fresh" && short(r.title,180) && short(r.id,128), "Header.");
  const o = r.origin;
  const policy = o?.actor === "policy";
  require(keys(o, policy ? ["actor","run","episode","model","adapterSha256"] : ["actor","run","episode"]) &&
    (policy || o.actor === "scripted") && short(o.run,256) && short(o.episode,256) &&
    (!policy || short(o.model,512) && hex(o.adapterSha256)), "Producer.");
  require(keys(r.fixture, ["sha256","runtime"]) && hex(r.fixture.sha256) && short(r.fixture.runtime,128), "Fixture revision.");
  require(Array.isArray(r.steps) && r.steps.length >= 1 && r.steps.length <= 8, "Step count.");
  const end = r.steps.length-1, v = r.verification;
  require(Number.isInteger(r.pauseAfter) && r.pauseAfter >= 0 && r.pauseAfter <= end &&
    keys(v,["kind","assertStep","reference","candidate"]) && v.kind === "counterexample" && v.assertStep === end, "Cursor or grade.");
  for (const [i,s] of r.steps.entries()) {
    const last = i === end;
    require(keys(s,last ? ["op","selector","property","expected"] : ["op","selector"]) &&
      typeof s.selector === "string" && /^#[A-Za-z][A-Za-z0-9_-]{0,63}$/.test(s.selector) &&
      (last ? s.op === "assert" && s.property === "text" && typeof s.expected === "string" && s.expected.length <= 128 :
        s.op === "click"), "Step " + (i+1) + ".");
    if (playable(r)) require((last ? ["#out","#active"] : ["#one","#two","#three","#close"]).includes(s.selector), "Unknown tab control.");
  }
  for (const [g,pass] of [[v.reference,true],[v.candidate,false]]) {
    require(keys(g,["actual","observed","passed"]) && g.observed === true && typeof g.actual === "string" &&
      g.actual.length <= 8192 && g.passed === pass && (g.actual === r.steps[end].expected) === pass, "Inconsistent observations.");
  }
  return r;
}
export function stable(value) {
  if (Array.isArray(value)) return value.map(stable);
  if (value && typeof value === "object")
    return Object.fromEntries(Object.keys(value).sort().map(k => [k, stable(value[k])]));
  return value;
}
export function describe(r) {
  const show = JSON.stringify;
  return [...r.steps.map((s,i) => (i+1) + ". " + (s.op === "click" ? "Click " + s.selector :
    "Expect " + s.selector + " text " + show(s.expected))),
    "Recorded " + show(r.verification.candidate.actual), r.origin.actor + " · " + r.origin.run + " · " + r.origin.episode,
    ...(r.origin.model ? [r.origin.model, "Adapter " + r.origin.adapterSha256] : []), "Fixture " + r.fixture.sha256].join("\n");
}
