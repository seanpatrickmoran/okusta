"""Optional native interaction check. Run after build.py with Playwright and a browser."""
import argparse
from pathlib import Path
from playwright.sync_api import sync_playwright


def check_streaming_panel(page, files):
    page.evaluate("""() => {
      window.part = text => window.onChunk(text);
      window.okustaReply = (id, onText, prompt, route, regenerate, followup, panel, signal) => {
        window.submitted = {prompt, panel};
        window.onChunk = onText;
        return new Promise((resolve, reject) => {
          window.finish = text => resolve({turn: {text, finishReason: "stop"}, recorded: false});
          signal.addEventListener("abort", () => reject(signal.reason), {once: true});
        });
      };
      window.panelHeight = () => panelRoot.querySelector(".window").offsetHeight;
      window.atBottom = () => {
        const b = panelRoot.querySelector(".body");
        return b.scrollHeight - b.clientHeight - b.scrollTop <= 1;
      };
      control("Reset panel").click();
      control("Query").click();
    }""")
    initial = page.evaluate("panelHeight()")
    prompt = "A line of the query.\n" * 9 + "Last line"
    page.keyboard.insert_text(prompt)
    assert page.evaluate("panelHeight()") > initial + 60
    page.keyboard.press("Enter")
    assert page.evaluate("submitted.prompt") == page.evaluate("submitted.panel.clip.prompt") == prompt
    assert page.evaluate('!control("Stop response").disabled')
    # Type the next query during the first response. Its submitted value checks the immediate clear.
    page.keyboard.insert_text("Follow-up")
    page.evaluate('part("Streaming paragraph.\\n\\n".repeat(120))')
    page.wait_for_function('panelRoot.querySelector(".body").scrollTop > 0 && atBottom()')
    assert page.evaluate('panelRoot.querySelector(".window").getBoundingClientRect().bottom <= innerHeight')
    rect = page.evaluate('panelRoot.querySelector(".body").getBoundingClientRect().toJSON()')
    page.mouse.move(rect["left"] + 20, rect["top"] + 20)
    page.mouse.wheel(0, -400)
    page.wait_for_function("!atBottom()")
    page.evaluate('part("Streaming paragraph.\\n\\n".repeat(180) + "MORE")')
    page.wait_for_function('panelRoot.querySelector(".model-note").textContent.endsWith("MORE")')
    assert not page.evaluate("atBottom()")
    page.evaluate('control("Stop response").click()')
    page.wait_for_function('panelRoot.querySelector(".model-note small")?.textContent === "Response stopped."')
    assert page.evaluate('panelRoot.querySelector(".model-note .answer-markdown").textContent.endsWith("MORE")')
    page.evaluate('control("Send").click()')
    assert page.evaluate("submitted.prompt") == "Follow-up"
    page.evaluate('part("Next paragraph.\\n\\n".repeat(120))')
    page.wait_for_function('panelRoot.querySelector(".body").scrollTop > 0 && atBottom()')
    page.evaluate('finish("Done.")')
    page.wait_for_function('control("Send") !== null')
    # Streaming, completion and a rapid follow-up must only repaint their own turn.
    for question, answer in [("Second question", "Second answer"), ("Third question", "Third answer")]:
        page.keyboard.insert_text(question)
        page.keyboard.press("Enter")
        page.evaluate('part("In flight")')
        page.evaluate("text => finish(text)", answer)
        page.wait_for_function('control("Send") !== null')
    assert page.evaluate("""Array.from(panelRoot.querySelectorAll(".model-note"), entry => [
        entry.querySelector("h2").textContent, entry.querySelector(".answer-markdown").textContent
    ]).slice(1)""") == [["Follow-up", "Done."], ["Second question", "Second answer"], ["Third question", "Third answer"]]
    handle = page.evaluate('panelRoot.querySelector("[data-edge=s]").getBoundingClientRect().toJSON()')
    x, y = handle["left"] + 20, handle["top"] + handle["height"] / 2
    page.mouse.move(x, y)
    page.mouse.down()
    page.mouse.move(x, y - 45)
    page.mouse.up()
    assert page.evaluate('panelRoot.querySelector(".window").hasAttribute("data-resized")')
    fixed = page.evaluate("panelHeight()")
    page.evaluate('control("Reset panel").click()')
    assert page.evaluate('panelRoot.querySelectorAll(".model-note").length') == 0
    page.keyboard.insert_text(prompt * 2)
    assert page.evaluate("panelHeight()") == fixed
    page.keyboard.press("Enter")
    page.evaluate('part("A longer answer.\\n\\n".repeat(120))')
    page.wait_for_function('panelRoot.querySelector(".body").scrollTop > 0 && atBottom()')
    assert page.evaluate("panelHeight()") == fixed
    page.evaluate('control("Stop response").click()')
    page.wait_for_function('control("Send") !== null')
    page.evaluate('control("Close clipping window").click(); window.panelRoot = null')
    page.add_script_tag(path=files / "panel.js")
    page.evaluate('control("Query").click()')
    reopened = page.evaluate("panelHeight()")
    page.keyboard.insert_text(prompt)
    assert page.evaluate("panelHeight()") > reopened + 60


def check_image_picker(page):
    page.evaluate("""() => {
      const eye = panelRoot.querySelector(".tool-eye");
      if (!eye.disabled) throw new Error("Text-only route enabled capture");
      window.captures = 0;
      window.browser.runtime.sendMessage = async message => {
        if (message.type === "panel-capture") {
          if (getComputedStyle(panelRoot.host).display !== "none") throw new Error("Panel was visible");
          captures++;
          const frame = document.createElement("canvas");
          frame.width = 2 * innerWidth;
          frame.height = 2 * innerHeight;
          const ctx = frame.getContext("2d");
          ctx.fillStyle = "#ff0000"; ctx.fillRect(40, 40, 80, 40);
          return {ok: true, value: frame.toDataURL("image/png")};
        }
        return {ok: true, value: {state: "idle", model: "fixture", imageInput: true, canCapture: true}};
      };
      document.dispatchEvent(new Event("visibilitychange"));
    }""")
    page.wait_for_function('!panelRoot.querySelector(".tool-eye").disabled')
    sent_before = page.evaluate("sent.length")
    original = page.evaluate('panelRoot.querySelector("blockquote").textContent')
    page.evaluate('panelRoot.querySelector(".tool-eye").click()')
    page.wait_for_function("document.activeElement?.shadowRoot === null && document.activeElement !== panelRoot.host && captures === 1 && document.activeElement.tagName === 'DIV'")
    page.keyboard.press("Escape")
    page.wait_for_function('getComputedStyle(panelRoot.host).display !== "none"')
    assert page.evaluate('panelRoot.querySelector("blockquote").textContent') == original
    page.evaluate('panelRoot.querySelector(".tool-eye").click()')
    page.wait_for_function("captures === 2 && document.activeElement !== panelRoot.host && document.activeElement.tagName === 'DIV'")
    page.mouse.move(60, 40)
    page.mouse.down()
    page.mouse.move(20, 20)
    page.mouse.up()
    page.wait_for_function('panelRoot.querySelector(".crop-preview canvas") !== null')
    assert page.evaluate("""() => {
      const c = panelRoot.querySelector(".crop-preview canvas");
      return [c.width, c.height, ...c.getContext("2d").getImageData(40, 20, 1, 1).data];
    }""") == [80, 40, 255, 0, 0, 255]
    assert page.evaluate("sent.length") == sent_before
    page.evaluate('control("Send").click()')
    page.wait_for_function("n => sent.length > n", arg=sent_before)


def check(engine, executable):
    target = {"chromium": "chrome", "firefox": "firefox", "webkit": "safari"}[engine]
    files = Path(__file__).resolve().parents[1] / "dist" / target
    with sync_playwright() as pw:
        browser = getattr(pw, engine).launch(executable_path=executable)
        try:
            page = browser.new_page()
            page.set_content('<input id="goto"><main id="sample" data-internal="private">A public paragraph'
                             '<a href="https://example.org/doc?session=secret#here">Source</a>'
                             '<input value="private-field"><!--comment--></main>')
            page.evaluate("""() => {
              window.hotkeys = [];
              for (const target of [window, document]) {
                for (const name of ["keydown", "keypress", "keyup"]) {
                  target.addEventListener(name, e => {
                    if (e.key === "t") {
                      hotkeys.push(name);
                      e.preventDefault();
                      document.querySelector("#goto").focus();
                    }
                  }, true);
                }
              }
              const attach = Element.prototype.attachShadow;
              Element.prototype.attachShadow = function(options) {
                const root = attach.call(this, options);
                if (!window.panelRoot) window.panelRoot = root;
                return root;
              };
              window.browser = {
                runtime: {sendMessage: async () => ({ok: true, value: {state: "idle", model: "fixture"}})},
                storage: {local: {get: async () => ({})}, onChanged: {addListener() {}, removeListener() {}}}
              };
              window.sent = [];
              window.okustaReply = async (id, onText, prompt) => {
                sent.push(prompt);
                return {turn: {text:"Done",finishReason:"stop"}, recorded:false};
              };
              window.control = label => panelRoot.querySelector('button[aria-label="' + label + '"]');
            }""")
            for name in ["appearance.js", "vendor/marked.js", "markdown.js", "picker.js", "region-picker.js", "panel.js"]:
                page.add_script_tag(path=files / name)
            page.evaluate('control("Query").click()')
            # Native click targets the textarea inside its closed shadow tree.
            rect = page.evaluate("""() => {
              const r = panelRoot.querySelector("iframe").getBoundingClientRect();
              return {x:r.left+r.width/2, y:r.bottom-15};
            }""")
            page.mouse.click(**rect)
            page.keyboard.type("test")
            page.keyboard.press("Shift+Enter")
            page.keyboard.type("text")
            page.keyboard.press("Enter")
            page.wait_for_function("sent.length === 1")
            assert page.evaluate("sent[0]") == "test\ntext"
            assert page.evaluate("hotkeys") == []
            page.keyboard.press("Escape")
            assert page.evaluate('panelRoot.querySelector(".composer").hidden')
            page.locator("#goto").focus()
            page.keyboard.press("t")
            assert "keydown" in page.evaluate("hotkeys")
            point = page.locator("#sample").bounding_box()
            page.evaluate('control("Pick HTML node").click()')
            page.mouse.click(point["x"] + 3, point["y"] + 3)
            markup = page.evaluate('panelRoot.querySelector("blockquote").textContent')
            assert "A public paragraph" in markup and 'href="https://example.org/doc"' in markup
            assert all(value not in markup for value in ("data-internal", "private-field", "?session=", "<!--"))
            check_image_picker(page)
            check_streaming_panel(page, files)
            print(engine, "passed prompt editing, capture, stopping, follow-scroll, and panel sizing")
        finally:
            browser.close()


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("engine", choices=["chromium", "firefox", "webkit"])
    parser.add_argument("--executable")
    args = parser.parse_args()
    check(args.engine, args.executable)
