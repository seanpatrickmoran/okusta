// Track the reading position in the document. The cabinet has its own scrollbar.
export function journalNavigation(days, clips) {
  const sidebar = days.closest("aside");
  let targets = [], current = null, jumpY = null, frame = 0;

  function select(id, reveal) {
    const button = id && document.getElementById("jump-" + id);
    if (button?.getAttribute("aria-current") === "location") return;
    days.querySelector('[aria-current="location"]')?.removeAttribute("aria-current");
    current = button ? id : null;
    if (!button) return;
    button.setAttribute("aria-current", "location");
    if (reveal && days.scrollHeight > days.clientHeight) {
      const item = button.getBoundingClientRect(), list = days.getBoundingClientRect();
      if (item.top < list.top) days.scrollTop += item.top - list.top;
      else if (item.bottom > list.bottom) days.scrollTop += item.bottom - list.bottom;
    }
  }

  function sync() {
    frame = 0;
    if (!targets.length || window.scrollY === jumpY) return;
    jumpY = null;
    const viewport = document.documentElement.clientHeight;
    const inset = getComputedStyle(sidebar).position === "sticky" ? Math.max(0, sidebar.getBoundingClientRect().bottom) : 0;
    const readingLine = inset + (viewport - inset) * 0.25;
    let first = 0, end = targets.length;
    // At the bottom, even a short final post can become current.
    if (window.scrollY > 0 && window.scrollY + viewport >= document.scrollingElement.scrollHeight - 1) {
      first = end;
    } else {
      while (first < end) {
        const middle = Math.floor((first + end) / 2);
        if (targets[middle].getBoundingClientRect().top <= readingLine) first = middle + 1;
        else end = middle;
      }
    }
    const target = targets[Math.max(0, first - 1)];
    const day = target.closest(".journal-day");
    const list = document.getElementById("index-" + day.dataset.day);
    select(list.hidden ? day.id : target.id, true);
  }

  function schedule() {
    if (!frame) frame = requestAnimationFrame(sync);
  }
  window.addEventListener("scroll", schedule, {passive: true});
  window.addEventListener("resize", schedule);
  const layout = new ResizeObserver(schedule);
  layout.observe(clips);
  layout.observe(sidebar);

  return {
    get current() { return current; },
    refresh(id) {
      targets = clips.querySelectorAll(".journal-day, .journal-day > article");
      if (id !== current) jumpY = null;
      select(id, false);
      schedule();
    },
    jumpTo(target, moveFocus) {
      if (moveFocus) target.focus({preventScroll: true});
      target.scrollIntoView({block: "start", behavior: "instant"});
      // Several short posts may share the same landing position near the page end.
      jumpY = window.scrollY;
      select(target.id, true);
    },
    collapse(day) {
      if (document.getElementById(current)?.closest(".journal-day") === day) select(day.id, false);
    }
  };
}
