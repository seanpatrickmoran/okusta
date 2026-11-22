import assert from "node:assert/strict";
import test from "node:test";
import {readFileSync} from "node:fs";
import vm from "node:vm";

class Node {
  constructor(tag, value = "") { this.tag = tag; this.textContent = value; this.children = []; }
  append(...children) { this.children.push(...children); }
  walk() { return [this, ...this.children.flatMap(n => n.walk())]; }
}
test("journal formats Markdown wrappers, contains program code, and leaves HTML inert", () => {
  const document = {createElement: tag => new Node(tag), createTextNode: text => new Node("text", text)};
  const context = vm.createContext({document, URL});
  for (const file of ["vendor/marked.js", "markdown.js"]) {
    vm.runInContext(readFileSync(new URL("../src/" + file, import.meta.url), "utf8"), context);
  }
  const markup = ["````markdown", "## Result", "**Two** values", "| a | b |", "|---|---|", "| 1 | 2 |", "",
      "```python", "print('<tag>')", "```", "````", "",
      "[Source](https://example.org)", "", "<b>Hello</b>", "", "![figure](https://example.org/pic.png)"].join("\n");
  const nodes = context.okustaRenderMarkdown(markup).walk();
  for (const tag of ["h4", "strong", "table", "pre", "code", "a"]) assert.ok(nodes.some(n => n.tag === tag), tag);
  assert.equal(nodes.find(n => n.tag === "code").textContent, "print('<tag>')");
  assert.equal(nodes.find(n => n.tag === "a").href, "https://example.org/");
  assert.ok(!nodes.some(n => ["b", "img"].includes(n.tag)));
});
