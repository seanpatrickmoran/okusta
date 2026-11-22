# Okusta 0.90

Okusta is a local-first browser journal for prompts, screenshot regions, picked page elements, and conversations. Its toolbar icon shows a curved silver dagger over plum-black smoke. Open it on an ordinary webpage with the toolbar button or **Alt+Shift+J**.

## Install or upgrade

The ZIP includes ready-to-load builds for Firefox, Chrome and macOS Safari. For a **new** installation:

```bash
mkdir -p ~/git
unzip ~/Downloads/okusta-0.90.zip -d ~/git
cd ~/git/okusta
```

| Browser | Load the extension | Reload after an update |
|---|---|---|
| Firefox desktop 140+ | Open `about:debugging#/runtime/this-firefox`, choose **Load Temporary Add-on**, and select `dist/firefox/manifest.json`. | Click **Reload**, then refresh open journal and article tabs. Reload the temporary add-on after restarting Firefox. |
| Chrome | Open `chrome://extensions`, enable **Developer mode**, click **Load unpacked**, and choose `dist/chrome`. | Reload the existing extension card, then refresh open journal and article tabs. |
| Safari 18.4+ on Mac | In **Safari → Settings → Advanced**, enable **Show features for web developers**. Under **Developer → Add Temporary Extension**, approve the unsigned extension prompt and choose the **dist/safari** folder. Enable Okusta under **Extensions** if needed. | Reload Okusta from the **Temporary** list and refresh open tabs. Safari removes temporary extensions after 24 hours or when you quit. |

### Upgrade an existing Zerkalo or Reading Desk installation

Extract the ZIP, then reload Okusta using your existing extension registration and browser profile. For Chromium unpacked extensions, keep the exact directory already loaded in the browser so its profile journal and model settings stay attached. For example, if the browser loads `~/git/zerkalo/dist/chrome`, copy the updated files into the original project directory before clicking **Reload**:

```bash
unzip -o ~/Downloads/okusta-0.90.zip -d ~/git
cp -a ~/git/okusta/. ~/git/zerkalo/
```

Use the original Reading Desk folder instead if that is your registered location. Merge personal source edits before copying. In Firefox, reload the existing temporary add-on or select the new Firefox manifest in the same profile. The Firefox add-on ID and SQLite schema are preserved. An existing SQLite journal can also be reopened at its original path from Settings.

Restart the optional helper from the updated files and pair its token again. New configuration belongs under `~/.config/okusta`. Okusta reads the existing Zerkalo keys file and local model settings when their new files are absent. Existing `ZERKALO_*` launcher overrides and the `READING_DESK_TOKEN` pairing override remain supported; new examples use `OKUSTA_*`. Your existing vLLM environment and checkpoints can be reused. The replay importer accepts both Okusta and Zerkalo replay headers.

### First OpenRouter test in Safari

1. Set `OPENROUTER_API_KEY` in the Mac terminal that will run the helper, or add an `openrouter` entry to the private keys file described below. From the extracted Okusta directory run `python3 scripts/desk-service.py` and leave it running. Use the helper in this release for Safari pairing.
2. Open an ordinary webpage, click Okusta, then click the book icon. Under **Journal → Settings → Local helper**, paste the printed pairing token and click **Pair helper**. If Safari asks for website permissions, allow access to the page you're using and to `127.0.0.1` for the helper. You can review website access in **Safari → Settings → Extensions → Okusta**.
3. Under **Model connection**, choose **OpenRouter**, enter `openrouter/free`, then click **Test & use model**. A successful test shows **Verified openrouter/free. Ready to send.** Back in the page panel, click the lightning bolt, press T for text and pick a paragraph, open **Query**, type “What is the main claim?” and press Enter. The reply should appear in the panel.

This temporary install works directly from the folder on a Mac. For an installable app or an iOS target, see [Apple’s packaging guide](https://developer.apple.com/documentation/safariservices/packaging-a-web-extension-for-safari).

## Screenshot questions in 0.90

Use `google/gemma-3-4b-it` as a 4B starting point on either route.

- **Local vLLM** — In your serving environment run `bash scripts/start-local.sh google/gemma-3-4b-it`. If downloading the weights for the first time, accept Google's terms on the Hugging Face model page and authenticate the machine that downloads them. In **Journal → Settings → Model connection**, select **Local model**, enter the served model ID and click **Test & use model**. Okusta sends a fixed 64 × 64 PNG to check that the endpoint accepts an image.
- **OpenRouter** — Restart the bundled helper, pair its token and select **OpenRouter**. Enter the exact model ID and click **Test & use model**. The helper verifies a text reply and checks the model's advertised image-input capability. A saved route from an earlier release needs this check once to enable its eye.

When the eye opens, click it to hide the panel and freeze the visible tab. Drag across the part you want, in either direction. Release to preview the crop and its pixel dimensions. Click **Send** for a description, or open **Query** and ask a question. Escape cancels a selection. Clicking the eye again lets you replace the crop. The extension discards the full-tab snapshot after selection. Each submitted turn about the crop sends the selected PNG with the page title, source address, and applicable conversation to the active model.

The disk and Autorecord save the crop with its entry. You can see it in the journal, ask follow-ups, split the entry and export it with Markdown or JSON. The closed gray eye means image capture is unavailable for the current browser or model connection. Text-only models continue to work with ordinary questions and element picks.

## Write, pick and branch

- **Query** — open the toolbar panel. Use the Query speech bubble, or press the Send triangle to open the field. The editor has its own document, so webpage shortcuts stay outside the input. Enter sends, Shift+Enter inserts a line break, and Escape closes the editor. Each submitted query and its reply appear together in order under the original clipping. Sending clears the field so you can draft the next query. Click the square to stop a pending or streaming reply. Any text already received stays visible. Only completed turns enter the conversation history. With Autorecord off, queries and replies stay in the open panel. Press the disk to save the current clipping or conversation. Press it again to include later replies. A direct prompt includes only your text and any prior turns from that entry. Ordinary browser highlights are ignored.
- **Pick a page element** — Click the lightning bolt for structural HTML. Press T while picking to switch between HTML and readable text. Hover to preview, use ↑ or ↓ to move between parent and child, then click or press Enter. Escape cancels. Send explains the element, and Query asks a question about it.
- **Reset panel** — the counterclockwise arrow beside the model status dot clears the picked source, typed query, and panel conversation. Your next query starts fresh. Saved entries stay in the journal.
- **Journal** — the book opens a continuous journal, newest day first. Expand a date in the cabinet and select a title to jump to that entry. As you scroll through the journal, the cabinet highlights the entry you are reading. A collapsed date stays closed and highlights as a group. Hover over a shortened title or focus it with Tab to reveal the full title and time. Read saved conversations offline. Markdown answers render in both the panel and the journal, including explicitly fenced `markdown` or `md` blocks. Programming-language and unlabelled code fences preserve literal text. Source captures are always displayed literally.
- **Window** — drag the title bar to move the panel. The panel grows vertically with your query and reply up to the viewport height. Scroll to read earlier text during a reply. Following resumes on the next submission. Drag an edge or corner to set the panel size until you close and reopen it. Journal → Settings → Appearance → Dark mode changes the journal and all open panels in this browser profile.
- **Autorecord** — Journal → Settings → Recording. When enabled, the disk is hidden and each completed panel reply records the current conversation. Toggling this setting alone writes no entries. Closing a panel discards unsaved turns. Follow-ups submitted from inside a journal entry continue that saved entry.
- **Continue** — the text icon beneath an entry opens a follow-up. Press Enter to send or Shift+Enter for a new line. The active provider receives this entry’s source if present, its saved conversation, and the new question. The reply is appended to the entry.
- **Split** — the fork icon copies the entire saved entry and transcript into a new entry dated today, then opens its follow-up field. Splitting works offline. A copied entry has its own ID and future turns.
- **Delete** — the trash icon asks for confirmation, then removes the entry and its replies from the active journal. Other branches, exported files and separate stores keep their own copies.
- A length-limited reply is marked **Partial answer**. **Regenerate** keeps the earlier answer alongside its replacement.

## Journal and exports

Open **Settings** to the left of **Journal days**. The default store is the current browser profile. Firefox’s `about:support` and Chrome’s `chrome://version` show the profile directory.

To use an actual SQLite file, pair the helper, choose **SQLite file** and enter a path such as `~/Documents/Okusta/journal.sqlite`. **Copy current entries** merges records when switching stores. Conflicting clippings or default notes stop the copy. Leave the box unchecked to open the destination as it stands. The database uses a `journal(key, value)` table and can be opened with a SQLite reader offline. Browsers using the same helper can use the same file. Refresh the journal to see changes from another browser.

Markdown and JSON exports include all journal days. Download through the browser or enter a custom export folder when using the helper.

## Organize clippings with a local LoRA

Okusta can use a named adapter for **Journal → Collections** while the panel and journal chat use the provider in **Model connection**. The extension ships the organizer and offline replay players. AutoScript’s collection pilot writes the trained weights to `runs/collection-001/sft/adapter/` when its `fit` stage finishes.

On the workstation serving vLLM, use the base checkpoint and revision used by the fit. For the pilot’s default Qwen base, run this from the updated Okusta directory. If vLLM is already using port 8765, stop that server before relaunching it.

```bash
conda activate reading-desk-qwen
OKUSTA_LORA_PATH="$HOME/git/autoscript/runs/collection-001/sft/adapter" \
  bash scripts/start-local.sh Qwen/Qwen3-4B-Instruct-2507
```

You can pass a local base checkpoint directory as the argument to `start-local.sh`. Set `OKUSTA_SERVED_NAME` to preserve an existing base-model alias. The launcher registers the LoRA at startup as `collection`, reads its rank from the PEFT config, and enables native tool calls. Use `OKUSTA_LORA_NAME` for a different adapter alias and `OKUSTA_TOOL_PARSER` for a different base model’s tool parser. On a separate browser machine, forward the server port to its loopback address using your existing SSH connection.

1. Reload the extension and journal tab. If the journal uses SQLite, restart the updated `scripts/desk-service.py` and pair it again.
2. In **Journal → Settings → Collection adapter**, enter the served name and port (defaults `collection` and `8765`). **Test & use adapter** checks the server’s model list and sends a synthetic native-tool request. The test uses no saved clippings.
3. Open **Collections → Organize selected clippings**. Name the destination, describe what belongs in it, check 1–12 entries, and choose **Organize clippings**. For example, select two reported results and one proposal and ask “Keep only entries that report a measured result.”
4. Watch the activity list as the adapter searches the selection, reads clipping bodies, replaces the destination’s members, and reopens the collection. Finish succeeds after readback matches the latest save and the members still exist. Review the links to judge whether the chosen clippings meet your criterion.

Every run has its own destination ID, even if names repeat. A save writes real clipping references to the active journal. **Stop**, closing the journal tab, or hitting the 16-turn limit ends the run and preserves its last save. Saved collections remain browsable with the model offline and travel with journal copies and exports. SQLite reads still require the paired helper. Deleted source entries appear as deleted members.

For an offline example before training, use **Import replay…** with `examples/collection.okusta-replay.json`. It steps through a scripted run in a synthetic journal. You can also import the pilot’s own policy replay after evaluation.

## Local models

Point **Settings → Model connection → Local model** at a loopback port serving OpenAI-compatible `/v1/models` and streaming `/v1/chat/completions`. The default port is `8765`. A single base model is discovered automatically, including when it serves named LoRAs. With multiple base models, enter the exact served ID and choose **Test & use model**. A hosted account and the helper are unnecessary for this route.

Use your existing server or launch vLLM in your working Conda environment:

```bash
conda activate reading-desk-qwen
bash scripts/start-local.sh /path/to/your/checkpoint
```

You can also pass a model ID, or set `OKUSTA_SERVED_NAME` when a local checkpoint directory should be served under an alias. The no-argument launcher defaults to stock Qwen3-4B-Instruct-2507. The previous `scripts/start-qwen.sh` entry point remains available.

**Local model limits** controls generation budgets for the next request. The bundled vLLM launcher also reads context and GPU limits on startup. GPU memory uses decimal GB rounded down to hundredths. The automatic budget is 75% of the visible device. Context includes both prompt and output. The paired helper writes startup settings to `~/.config/okusta/local-model.json` (or under `XDG_CONFIG_HOME`). Restart vLLM to apply them. With a different server, configure that server’s own startup limits. If your model is running on a remote workstation, forward its port to your browser’s loopback and run its launcher on the workstation.

## Hosted APIs and credentials

Hosted models run at the chosen provider. Start the bundled helper in your existing Python environment. It uses the standard library and calls the providers’ Chat Completions APIs over HTTPS.

```bash
python scripts/desk-service.py
```

Pair the printed token under **Settings → Local helper**. The helper listens on `127.0.0.1:8766`. The browser keeps its pairing token in extension session storage. Set `OKUSTA_TOKEN` to a private, high-entropy value if you want a stable helper token.

| Provider | Helper environment variable | Suggested model for a first test |
|---|---|---|
| Groq | `GROQ_API_KEY` | `openai/gpt-oss-120b` |
| Gemini | `GEMINI_API_KEY` | `gemini-3.5-flash-lite` |
| OpenRouter | `OPENROUTER_API_KEY` | `openrouter/free` |
| OpenAI | `OPENAI_API_KEY` | A chat model available to your account |
| DeepSeek | `DEEPSEEK_API_KEY` | A chat model available to your account |
| Anthropic | `ANTHROPIC_API_KEY` | A chat model available to your account |

Set the variable for your provider in the helper’s environment, or use a private JSON file:

```bash
mkdir -p ~/.config/okusta
(umask 077 && touch ~/.config/okusta/keys.json)
chmod 600 ~/.config/okusta/keys.json
${EDITOR:-vi} ~/.config/okusta/keys.json
```

```json
{
  "openai": "your OpenAI key",
  "deepseek": "your DeepSeek key",
  "anthropic": "your Anthropic key",
  "groq": "your Groq key",
  "gemini": "your Gemini key",
  "openrouter": "your OpenRouter key"
}
```

Include only the providers you use. The helper reads the file when needed. Environment variables take precedence. Set `OKUSTA_KEYS_FILE` to use another file path. On Unix the file must be owned by the helper user and private to that user. If your Anthropic key needs a workspace, set `ANTHROPIC_WORKSPACE_ID`.

Select the provider and model ID and click **Test & use model**. The test sends a short synthetic prompt and can incur a charge. Only the helper reads provider secrets. Polling checks local readiness. The browser sends the selected entry to the configured provider only on a model action.

New HTML picks retain structural tags and selected descriptive attributes. Capture removes form controls, scripts, comments, explicitly hidden nodes and arbitrary data attributes. Model-facing source URLs and captured HTML links keep the origin and path. The journal retains its original source link. Existing saved snapshots keep their earlier contents. Selected prose and your prompts are sent as text, so any sensitive details visible in that text are still included. Markdown replies render through a fixed set of DOM elements in both views.

## Build and verify

Edit `src/panel.js` and `panel.css` for the overlay, `desk.js`, `desk.html` and `desk.css` for the journal, and `titlebar.css` for the shared window chrome. Both views use `theme.css` for colors and `markdown.css` for replies. `model.js` builds requests. `markdown.js` renders locally bundled Marked tokens using DOM nodes. Its license is included under `src/vendor`.

```bash
python build.py --zip
node --test tests/*.mjs
python -m unittest discover -s tests
```

With Playwright and its browser installed, run `python tests/browser_prompt.py chromium`, `python tests/browser_prompt.py firefox`, or `python tests/browser_prompt.py webkit` for the typing regression. The fixture registers a page-wide capture shortcut for `t` before opening the panel and checks both editor typing and page shortcuts after leaving the editor. The WebKit fixture exercises the Safari build’s page scripts. Use the temporary extension in macOS Safari to test its toolbar, permissions and journal with a real provider.

Use the desktop browser extension managers above to reload after building. On browser-internal pages that restrict panel injection, the toolbar opens the journal.
