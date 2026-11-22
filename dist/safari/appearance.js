// Profile-local appearance is shared by journal tabs and isolated panel scripts.
(() => {
  const storage = (globalThis.browser ?? chrome).storage;

  function watchValue(key, apply) {
    let changed = false;
    function onChange(changes, area) {
      if (area !== "local" || !Object.hasOwn(changes, key)) return;
      changed = true;
      apply(changes[key].newValue);
    }
    storage.onChanged.addListener(onChange);
    apply(undefined);
    storage.local.get(key).then(values => {
      if (!changed) apply(values[key]);
    }).catch(() => {});
    return () => {
      changed = true;
      storage.onChanged.removeListener(onChange);
    };
  }

  function watch(element, notify) {
    const system = globalThis.matchMedia?.("(prefers-color-scheme: dark)");
    let preference;
    function apply() {
      const dark = preference ?? system?.matches ?? false;
      element.dataset.theme = dark ? "dark" : "light";
      notify?.(dark);
    }
    system?.addEventListener("change", apply);
    const stop = watchValue("darkMode", value => { preference = value; apply(); });
    return () => { stop(); system?.removeEventListener("change", apply); };
  }
  function watchBoolean(key, notify) {
    return watchValue(key, value => notify(value === true));
  }
  globalThis.okustaAppearance = {watch, watchBoolean, setDark: dark => storage.local.set({darkMode: dark})};
})();
