"""Build unpacked desktop extensions with Python's standard library."""
import argparse
import hashlib
import base64
import json
import shutil
from pathlib import Path
from zipfile import ZIP_DEFLATED, ZipFile

ROOT = Path(__file__).resolve().parent
SRC = ROOT / "src"
DIST = ROOT / "dist"


def build(browser, package=False):
    out = DIST / browser
    out.mkdir(parents=True, exist_ok=True)
    manifest = json.loads((SRC / "manifest.json").read_text(encoding="utf-8"))
    if browser == "chrome":
        manifest["background"] = {"service_worker": "background.js", "type": "module"}
    elif browser == "safari":
        # Use a document background so the shared ES modules can fetch loopback services.
        manifest["background"] = {"scripts": ["background.js"], "type": "module", "persistent": False}
        manifest["options_page"] = manifest.pop("options_ui")["page"]
        manifest["browser_specific_settings"] = {"safari": {"strict_min_version": "18.4"}}
    elif browser == "firefox":
        manifest["background"] = {"scripts": ["background.js"], "type": "module"}
        manifest["browser_specific_settings"] = {
            "gecko": {
                "id": "reading-desk@local.invalid",
                "strict_min_version": "140.0",
                "data_collection_permissions": {
                    "required": ["websiteContent", "browsingActivity"],
                    "optional": ["authenticationInfo"],
                },
            }
        }
    else:
        raise ValueError(f"Unknown browser: {browser}")

    fixture = SRC / "replay"
    digest = hashlib.sha256()
    for name in ("app.js", "index.fragment.html"):
        for part in (name.encode(), (fixture / name).read_bytes()):
            digest.update(len(part).to_bytes(8, "big") + part)
    if f'tabsDigest = "{digest.hexdigest()}"' not in (fixture / "record.js").read_text():
        raise ValueError("Packaged tabs revision differs from the player registry")
    if browser == "chrome":
        manifest["sandbox"] = {"pages": ["replay/tabs.html"]}
        manifest["content_security_policy"] = {
            "extension_pages": "script-src 'self'; object-src 'self'",
            "sandbox": "sandbox allow-scripts; default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'",
        }
    frame = (fixture / "tabs.template").read_text()
    for token, name in [("<!-- FIXTURE -->", "index.fragment.html"), ("/* APP */", "app.js"), ("/* BRIDGE */", "bridge.js")]:
        frame = frame.replace(token, (fixture / name).read_bytes().decode())
    frame_path = out / "replay/tabs.html"
    frame_path.parent.mkdir(exist_ok=True)
    frame_path.write_text(frame, encoding="utf-8")
    files = [frame_path]
    for source in sorted(SRC.rglob("*")):
        if not source.is_file() or source.name == "panel.css":
            continue
        if source.parent == fixture and source.name in ("tabs.template", "app.js", "index.fragment.html", "bridge.js"):
            continue
        dest = out / source.relative_to(SRC)
        dest.parent.mkdir(parents=True, exist_ok=True)
        if source.name == "manifest.json":
            dest.write_text(json.dumps(manifest, indent=2) + "\n", encoding="utf-8")
        elif source.name == "panel.js":
            token = '/* BUILD_PANEL_CSS */ ""'
            script = source.read_text(encoding="utf-8")
            if script.count(token) != 1:
                raise ValueError("Expected one panel stylesheet insertion point")
            css = "\n".join((SRC / name).read_text(encoding="utf-8") for name in ("theme.css", "titlebar.css", "panel.css", "markdown.css"))
            icon_token = '/* BUILD_APP_ICON */ ""'
            if script.count(icon_token) != 1:
                raise ValueError("Expected one title-bar icon insertion point")
            book = (SRC / "icons/okusta-16.png").read_bytes()
            icon = "data:image/png;base64," + base64.b64encode(book).decode("ascii")
            script = script.replace(token, json.dumps(css)).replace(icon_token, json.dumps(icon))
            dest.write_text(script, encoding="utf-8")
        else:
            shutil.copyfile(source, dest)
        files.append(dest)
    print(out.relative_to(ROOT))
    if package:
        archive = DIST / ("okusta-" + browser + "-" + manifest["version"] + ".zip")
        with ZipFile(archive, "w", ZIP_DEFLATED) as z:
            for file in files:
                z.write(file, file.relative_to(out))
        print(archive.relative_to(ROOT))


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--zip", action="store_true", help="also produce per-browser extension ZIPs")
    args = parser.parse_args()
    for name in ["chrome", "firefox", "safari"]:
        build(name, args.zip)
