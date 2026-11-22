// This classic script runs in the journal and in the isolated panel.
(() => {
  const {lexer} = globalThis.marked;
  globalThis.okustaRenderMarkdown = function renderMarkdown(source) {
    const root = document.createElement("div");
    root.className = "answer-markdown";
    function write(parent, tokens, depth = 0) {
      for (const t of tokens || []) {
        const child = tag => {
          const node = document.createElement(tag);
          parent.append(node);
          return node;
        };
        const plain = value => parent.append(document.createTextNode(value || ""));
        if (depth > 48) { plain(t.raw); continue; }
        const nested = node => write(node, t.tokens, depth + 1);
        switch (t.type) {
          case "space": break;
          case "br": child("br"); break;
          case "hr": child("hr"); break;
          case "heading": nested(child("h" + Math.min(6, t.depth + 2))); break;
          case "paragraph": nested(child("p")); break;
          case "blockquote": nested(child("blockquote")); break;
          case "strong": case "em": case "del": nested(child(t.type)); break;
          case "codespan": child("code").textContent = t.text; break;
          case "code": {
            if (/^(?:md|markdown)$/i.test(t.lang?.trim() || "") && depth < 4) {
              write(child("section"), lexer(t.text), depth + 1);
            } else {
              const code = document.createElement("code");
              code.textContent = t.text;
              child("pre").append(code);
            }
            break;
          }
          case "list": {
            const list = child(t.ordered ? "ol" : "ul");
            if (t.ordered && Number.isInteger(t.start)) list.start = t.start;
            for (const item of t.items) {
              const li = document.createElement("li");
              if (item.task) li.append(document.createTextNode(item.checked ? "☑ " : "☐ "));
              write(li, item.tokens, depth + 1); list.append(li);
            }
            break;
          }
          case "checkbox": break;
          case "table": {
            const wrapper = child("div");
            wrapper.className = "table-scroll";
            const table = document.createElement("table");
            wrapper.append(table);
            for (const [index, cells] of [t.header, ...t.rows].entries()) {
              const row = document.createElement("tr");
              for (const cell of cells) {
                const node = document.createElement(index ? "td" : "th");
                write(node, cell.tokens, depth + 1); row.append(node);
              }
              table.append(row);
            }
            break;
          }
          case "link": {
            let url;
            try { url = new URL(t.href); } catch {}
            if (url && ["http:", "https:"].includes(url.protocol)) {
              const link = child("a");
              link.href = url.href; link.target = "_blank"; link.rel = "noreferrer noopener";
              nested(link);
            } else nested(parent);
            break;
          }
          case "text": if (t.tokens) nested(parent); else plain(t.text); break;
          case "image": case "escape": plain(t.text); break;
          default: plain(t.raw);
        }
      }
    }
    try { write(root, lexer(source)); }
    catch { root.textContent = source; }
    return root;
  };
})();
