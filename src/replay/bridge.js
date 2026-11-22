// Only the parent that mounted this packaged page receives a command channel.
window.addEventListener("message", function connect(event) {
  if (event.source !== parent || event.data?.type !== "connect" || !event.ports[0]) return;
  window.removeEventListener("message", connect);
  const port = event.ports[0];
  const active = document.querySelector("#active"), content = document.querySelector("#out");
  const buttons = ["#one","#two","#three","#close"];
  document.addEventListener("click", e => {
    if (e.isTrusted) port.postMessage({type:"manual"});
  }, true);
  function reflect() {
    for (const id of buttons.slice(0,3)) {
      document.querySelector(id).setAttribute("aria-pressed", String(id.slice(1) === active.textContent));
    }
  }
  document.addEventListener("click",reflect);
  port.onmessage = ({data}) => {
    try {
      if (!Array.isArray(data.clicks) || data.clicks.length > 7 || data.clicks.some(s => !buttons.includes(s)) ||
          ![null,"#active","#out"].includes(data.read)) throw Error();
      for (const id of data.clicks) document.querySelector(id).click();
      reflect();
      const actual = data.read === null ? null : (data.read === "#active" ? active : content).textContent;
      port.postMessage({type:"result",actual});
    } catch { port.postMessage({type:"error"}); }
  };
  port.postMessage({type:"ready"});
});
