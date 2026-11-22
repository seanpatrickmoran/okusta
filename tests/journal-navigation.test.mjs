import test from "node:test";
import assert from "node:assert/strict";
import {journalNavigation} from "../src/journal-navigation.js";

test("the day index follows reading in both directions and honors explicit jumps", t => {
  const nodes = new Map(), buttons = [];
  const win = new EventTarget();
  win.scrollY = 0;
  const viewport = 600, pageHeight = 2100;
  let pending, sticky = false;
  globalThis.window = win;
  globalThis.document = {
    documentElement: {clientHeight: viewport}, scrollingElement: {scrollHeight: pageHeight},
    getElementById: id => nodes.get(id)
  };
  globalThis.getComputedStyle = () => ({position: sticky ? "sticky" : "static"});
  globalThis.requestAnimationFrame = callback => { pending = callback; return 1; };
  globalThis.ResizeObserver = class { observe() {} };
  t.after(() => {
    for (const key of ["window", "document", "getComputedStyle", "requestAnimationFrame", "ResizeObserver"]) delete globalThis[key];
  });
  const sidebar = {getBoundingClientRect: () => ({bottom: 100})};
  const days = {closest: () => sidebar, scrollHeight: 700, clientHeight: 300, scrollTop: 0,
    getBoundingClientRect: () => ({top: 15, bottom: 315}),
    querySelector: () => buttons.find(b => b.current)};
  function target(id, y, parent, menuTop) {
    const e = {id, dataset: {}, closest: () => parent || e,
      getBoundingClientRect: () => ({top: y - win.scrollY}),
      scrollIntoView: () => { win.scrollY = Math.min(pageHeight - viewport, y - 12); },
      focus: t.mock.fn()};
    if (!parent) {
      e.dataset.day = id.slice(4);
      nodes.set("index-" + e.dataset.day, {hidden: false});
    }
    const button = {getAttribute() { return this.current; }, setAttribute(key, value) { this.current = value; },
      removeAttribute() { delete this.current; },
      getBoundingClientRect: () => ({top: menuTop - days.scrollTop, bottom: menuTop + 20 - days.scrollTop})};
    buttons.push(button);
    nodes.set("jump-" + id, button); nodes.set(id, e);
    return e;
  }
  const day1 = target("day-first", 30, null, 20), a = target("entry-a", 90, day1, 45);
  const b = target("entry-b", 900, day1, 330), c = target("entry-c", 1400, day1, 355);
  const day2 = target("day-last", 1730, null, 380), d = target("entry-d", 1790, day2, 405);
  const all = [day1, a, b, c, day2, d];
  const nav = journalNavigation(days, {querySelectorAll: () => all});
  function paint() { const frame = pending; pending = null; frame(); }
  function scroll(y) { win.scrollY = y; win.dispatchEvent(new Event("scroll")); paint(); }
  function selected(e) {
    assert.equal(nav.current, e.id);
    assert.deepEqual(buttons.filter(b => b.current === "location"), [nodes.get("jump-" + e.id)]);
  }
  nav.refresh(day1.id); paint(); selected(a);
  nav.jumpTo(a, true); selected(a);
  assert.equal(a.focus.mock.callCount(), 1);
  scroll(765); selected(b);
  assert.equal(days.scrollTop, 35); assert.equal(win.scrollY, 765);
  scroll(1280); selected(c);
  scroll(400); selected(a);
  assert.equal(a.focus.mock.callCount(), 1);
  sticky = true;
  scroll(705); selected(b);
  sticky = false;
  nodes.get("index-last").hidden = true;
  scroll(1500); selected(day2);
  nodes.get("index-last").hidden = false;
  nav.jumpTo(day2, false);
  scroll(1500); selected(day2);
  nav.jumpTo(d, true);
  scroll(1500); selected(d);
  scroll(1480); selected(c);
  scroll(1500); selected(d);
  nodes.get("index-last").hidden = true;
  nav.collapse(day2); selected(day2);
  nav.refresh(day2.id); paint(); selected(day2);
});
