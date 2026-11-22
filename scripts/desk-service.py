"""Okusta's optional loopback companion for SQLite, exports and hosted model calls."""
import base64
import hmac
import json
import os
from pathlib import Path
import re
import secrets
import sqlite3
import stat
from contextlib import closing
from datetime import datetime
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from qwen_runtime import option, read_runtime, save_runtime
from tempfile import TemporaryFile
from urllib.error import HTTPError, URLError
from urllib.request import HTTPRedirectHandler, Request, build_opener
from http.client import HTTPException

BASES = {"openai": "https://api.openai.com/v1", "deepseek": "https://api.deepseek.com",
         "anthropic": "https://api.anthropic.com/v1",
         "groq": "https://api.groq.com/openai/v1",
         "gemini": "https://generativelanguage.googleapis.com/v1beta/openai",
         "openrouter": "https://openrouter.ai/api/v1"}
DB_ID = 0x52444A31
RECORD = re.compile(r"(clip|note|questions|collection):[A-Za-z0-9_-]+")
MAX_BODY = 64 * 1024 * 1024


def path_for(value):
    path = Path(value or "").expanduser()
    if not path.is_absolute():
        raise ValueError("Enter an absolute path or one beginning with ~/.")
    return path.resolve()


def replay_signature(record):
    formats = {"zerkalo-replay/1": "okusta-replay/1", "zerkalo-collection/1": "okusta-collection/1"}
    if isinstance(record, dict) and isinstance(record.get("format"), str) and record["format"] in formats:
        return {**record, "format": formats[record["format"]]}
    return record


def merge(old, new, key):
    if old is None or old == new:
        return new
    if (key.startswith("clip:") and isinstance(old, dict) and isinstance(new, dict)
            and old.get("kind") == new.get("kind") == "replay"
            and replay_signature(old["replay"]) == replay_signature(new["replay"])):
        return old
    if key.startswith("questions:"):
        return old + [item for item in new if item not in old]
    raise ValueError("Conflicting journal record " + key + ". Open the destination without copying.")


def database(action, data):
    path = path_for(data["path"])
    create = action == "open"
    if create:
        path.parent.mkdir(parents=True, exist_ok=True)
    # mode=rw prevents a missing or moved journal from being silently recreated.
    uri = path.as_uri() + ("?mode=rwc" if create else "?mode=rw")
    with closing(sqlite3.connect(uri, uri=True, timeout=10)) as db, db:
        db.execute("PRAGMA trusted_schema=OFF")
        db.execute("BEGIN IMMEDIATE" if action != "read" else "BEGIN")
        app_id = db.execute("PRAGMA application_id").fetchone()[0]
        if app_id != DB_ID:
            if not create or app_id or db.execute("SELECT 1 FROM sqlite_master LIMIT 1").fetchone():
                raise ValueError("Choose a Okusta database or a new file.")
            db.execute(f"PRAGMA application_id={DB_ID}")
            db.execute("CREATE TABLE journal (key TEXT PRIMARY KEY, value TEXT NOT NULL)")
        if action in ("split", "delete"):
            entry_id = data["id"]
            if not re.fullmatch(r"[A-Za-z0-9_-]+", entry_id):
                raise ValueError("Invalid entry ID.")
            keys = [prefix + ":" + entry_id for prefix in ("clip", "note", "questions")]
            if action == "delete":
                db.executemany("DELETE FROM journal WHERE key=?", [(k,) for k in keys])
                return {"id": entry_id}
            records = dict(db.execute("SELECT key,value FROM journal WHERE key IN (?,?,?)", keys))
            if keys[0] not in records:
                raise ValueError("This entry was deleted.")
            stamp = data["stamp"]
            if not re.fullmatch(r"[0-9a-f]{32}", stamp["id"]):
                raise ValueError("Invalid split ID.")
            for key, raw in records.items():
                if key == keys[0]:
                    raw = json.dumps({**json.loads(raw), **stamp})
                dest = key.split(":")[0] + ":" + stamp["id"]
                db.execute("INSERT INTO journal VALUES (?,?)", (dest, raw))
            return stamp
        if action == "read":
            keys = data.get("keys")
            if keys is None:
                rows = db.execute("SELECT key,value FROM journal")
            else:
                rows = db.execute("SELECT key,value FROM journal WHERE key IN (" +
                                  ",".join("?" for _ in keys) + ")", keys)
            return {k: json.loads(v) for k, v in rows}
        for key, value in data.get("records", {}).items():
            if not RECORD.fullmatch(key):
                raise ValueError("Unexpected journal key.")
            if action == "write" and key.startswith("collection:"):
                members = value.get("members") if isinstance(value, dict) else None
                if (not isinstance(members, list) or len(members) > 12 or
                        not all(isinstance(m, str) and re.fullmatch(r"[A-Za-z0-9_-]+", m) for m in members) or
                        len(set(members)) != len(members) or key != "collection:" + str(value.get("id"))):
                    raise ValueError("Invalid collection.")
                for member in members:
                    if not db.execute("SELECT 1 FROM journal WHERE key=?", ("clip:" + member,)).fetchone():
                        raise ValueError("A collection member was deleted before saving.")
                db.execute("INSERT OR REPLACE INTO journal VALUES (?,?)", (key, json.dumps(value)))
                continue
            if action == "write" and key.startswith(("note:", "questions:")):
                parent_key = "clip:" + key.split(":", 1)[1]
                if not db.execute("SELECT 1 FROM journal WHERE key=?", (parent_key,)).fetchone():
                    raise ValueError("The entry was deleted before the reply arrived.")
            previous = db.execute("SELECT value FROM journal WHERE key=?", (key,)).fetchone()
            merged = merge(json.loads(previous[0]) if previous else None, value, key)
            db.execute("INSERT OR REPLACE INTO journal VALUES (?,?)", (key, json.dumps(merged)))
        return {"path": str(path)}


def export_file(data):
    folder = path_for(data["folder"])
    fmt = data["format"]
    if fmt not in ("md", "json"):
        raise ValueError("Choose Markdown or JSON.")
    folder.mkdir(parents=True, exist_ok=True)
    name = "okusta-" + datetime.now().strftime("%Y%m%d-%H%M%S-") + secrets.token_hex(3)
    path = folder / (name + "." + fmt)
    with path.open("x", encoding="utf-8") as output:
        output.write(data["text"])
    return {"path": str(path)}


def credential(provider):
    env_key = os.environ.get(provider.upper() + "_API_KEY")
    if env_key:
        return env_key
    override = option("KEYS_FILE")
    if override:
        path = Path(override).expanduser()
    else:
        folder = Path.home() / ".config"
        path = folder / "okusta/keys.json"
        if not path.exists():
            path = folder / "zerkalo/keys.json"
    try:
        with path.open(encoding="utf8") as source:
            info = os.fstat(source.fileno())
            if not stat.S_ISREG(info.st_mode) or (os.name == "posix" and
                    (info.st_uid != os.getuid() or info.st_mode & 0o077)):
                raise ValueError("The keys file must belong to you and use permissions 600 or 400.")
            keys = json.load(source)
    except FileNotFoundError:
        return ""
    except (UnicodeError, json.JSONDecodeError):
        raise ValueError("The helper keys file must contain a JSON object.") from None
    if not isinstance(keys, dict) or not isinstance(keys.get(provider, ""), str):
        raise ValueError("Use provider names and string values in the helper keys file.")
    return keys.get(provider, "").strip()


class NoProviderRedirect(HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        return None


provider_http = build_opener(NoProviderRedirect())


def openrouter_image_input(model):
    request = Request(BASES["openrouter"] + "/models", headers={"Accept": "application/json"})
    try:
        with provider_http.open(request, timeout=8) as response:
            catalog = json.load(response)
        for item in catalog["data"]:
            if item["id"] == model:
                modalities = (item.get("architecture") or {}).get("input_modalities")
                return isinstance(modalities, list) and "image" in modalities
    except HTTPError as exc:
        exc.close()
    except (HTTPException, URLError, OSError, ValueError, KeyError, TypeError, AttributeError):
        pass
    return False


def image_and_text(parts):
    if not isinstance(parts, list) or len(parts) != 2 or not all(isinstance(p, dict) for p in parts):
        raise ValueError("Expected text and one screenshot crop.")
    text, image = parts
    if text.get("type") != "text" or not isinstance(text.get("text"), str):
        raise ValueError("Expected text with the screenshot.")
    image_url = image.get("image_url")
    url = image_url.get("url") if isinstance(image_url, dict) else None
    prefix = "data:image/png;base64,"
    if image.get("type") != "image_url" or not isinstance(url, str) or not url.startswith(prefix):
        raise ValueError("Expected an embedded PNG screenshot.")
    raw = base64.b64decode(url[len(prefix):], validate=True)
    if not raw.startswith(bytes.fromhex("89504e470d0a1a0a")):
        raise ValueError("Expected an embedded PNG screenshot.")
    return [{"type": "text", "text": text["text"]}, {"type": "image_url", "image_url": {"url": url}}]


def text_messages(messages, allow_image=False):
    if not isinstance(messages, list) or not messages:
        raise ValueError("Expected a text conversation.")
    cleaned = []
    for message in messages:
        if not isinstance(message, dict) or message.get("role") not in ("system", "user", "assistant"):
            raise ValueError("Expected a role and text for each message.")
        content = message.get("content")
        if not isinstance(content, str):
            if not allow_image or message["role"] != "user":
                raise ValueError("This route expects text messages.")
            content = image_and_text(content)
            allow_image = False
        cleaned.append({"role": message["role"], "content": content})
    return cleaned


def provider_events(response):
    # SSE fields may span lines. Some services send comment lines as keep-alives.
    data = []
    for raw in response:
        line = raw.decode("utf-8").rstrip("\r\n")
        if not line and data:
            yield "\n".join(data)
            data.clear()
        elif line.startswith("data:"):
            data.append(line[5:].lstrip(" "))
    if data:
        yield "\n".join(data)


def completion(data, probe):
    provider = data.get("provider")
    model = data.get("model")
    if not isinstance(provider, str) or provider not in BASES or not isinstance(model, str) or not model.strip():
        raise ValueError("Choose a hosted provider and enter its model ID.")
    model = model.strip()
    key = credential(provider)
    if not key:
        raise ValueError("Configure the helper keys file or set " + provider.upper() + "_API_KEY for the helper.")
    headers = {"Content-Type": "application/json", "Accept": "text/event-stream", "Authorization": "Bearer " + key}
    if provider == "anthropic" and os.environ.get("ANTHROPIC_WORKSPACE_ID"):
        headers["anthropic-workspace-id"] = os.environ["ANTHROPIC_WORKSPACE_ID"]
    messages = ([{"role": "user", "content": "Reply with OK."}] if probe
                else text_messages(data.get("messages"), allow_image=provider == "openrouter"))
    limit_field = "max_completion_tokens" if provider in ("openai", "groq") else "max_tokens"
    body = {"model": model, "messages": messages, "stream": True, limit_field: 1024 if probe else 2048}
    req = Request(BASES[provider] + "/chat/completions", data=json.dumps(body).encode(), headers=headers)
    # Keep credentials on the configured origin. Return only display text and completion status.
    try:
        with provider_http.open(req, timeout=85) as response:
            finished = False
            for packet in provider_events(response):
                if packet == "[DONE]":
                    return
                event = json.loads(packet)
                if event.get("error"):
                    raise ValueError("The provider interrupted the reply.")
                for choice in event.get("choices") or []:
                    if choice.get("index", 0) != 0:
                        continue
                    reason = choice.get("finish_reason")
                    if reason == "error" or choice.get("error"):
                        raise ValueError("The provider interrupted the reply.")
                    content = (choice.get("delta") or {}).get("content")
                    if reason and reason not in ("stop", "length", "content_filter", "tool_calls", "function_call"):
                        reason = "other"
                    if isinstance(content, str) or reason:
                        finished |= bool(reason)
                        yield {"delta": {"content": content if isinstance(content, str) else ""}, "finish_reason": reason}
            if not finished:
                raise ValueError("The provider stream ended before the reply was complete.")
    except HTTPError as exc:
        with exc:
            reasons = {400: "Check the model ID and its Chat Completions support.", 401: "Check the API key.",
                       403: "Check account access.", 404: "Check the model ID.", 429: "Check quota or rate limits."}
            raise ValueError(f"Provider returned HTTP {exc.code}. " + reasons.get(exc.code, "Try again later.")) from None
    except (HTTPException, URLError, OSError, UnicodeError, json.JSONDecodeError, AttributeError, TypeError):
        raise ValueError("Could not reach the provider or read a valid reply.") from None


class Handler(BaseHTTPRequestHandler):
    server_version = "Okusta/0.90"
    def log_message(self, *args):
        pass

    def origin_allowed(self):
        origin = self.headers.get("Origin", "")
        return not origin or re.fullmatch(r"(?:chrome|moz|safari-web)-extension://[a-zA-Z0-9-]+", origin)

    def permitted(self):
        return self.headers.get("Host") == f"127.0.0.1:{self.server.server_port}" and self.origin_allowed()

    def headers_for(self, code, content_type):
        self.send_response(code)
        self.send_header("Content-Type", content_type)
        self.send_header("Cache-Control", "no-store")
        origin = self.headers.get("Origin")
        if origin and self.origin_allowed():
            self.send_header("Access-Control-Allow-Origin", origin)
            self.send_header("Vary", "Origin")

    def reply(self, value, code=200):
        body = json.dumps(value, ensure_ascii=False).encode()
        self.headers_for(code, "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_OPTIONS(self):
        if not self.permitted():
            return self.reply({}, 403)
        self.headers_for(204, "text/plain")
        self.send_header("Access-Control-Allow-Methods", "POST, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Authorization, Content-Type")
        self.end_headers()

    def do_POST(self):
        auth = self.headers.get("Authorization", "").encode()
        if not self.permitted() or not hmac.compare_digest(auth, self.server.bearer):
            return self.reply({"error": {"message": "Pair using the token in the helper terminal."}}, 403)
        try:
            size = int(self.headers.get("Content-Length", -1))
            if not 0 <= size <= MAX_BODY or self.headers.get_content_type() != "application/json":
                raise ValueError("Expected JSON up to 64 MiB.")
            data = json.loads(self.rfile.read(size))
            if not isinstance(data, dict):
                raise ValueError("Expected a JSON object.")
            if self.path == "/status":
                value = {"keys": {}, "hosted": True, "sdk": True, "openrouterImages": True}
                for provider in BASES:
                    try:
                        value["keys"][provider] = bool(credential(provider))
                    except (ValueError, OSError) as exc:
                        value["keys"][provider] = False
                        value["credentialError"] = str(exc)
            elif self.path == "/qwen/config":
                value = {"runtime": read_runtime()}
            elif self.path == "/qwen/config/save":
                value = {"path": save_runtime(data)}
            elif self.path in ("/journal/open", "/journal/read", "/journal/write", "/journal/delete", "/journal/split"):
                value = database(self.path.rsplit("/", 1)[1], data)
            elif self.path == "/folder":
                folder = path_for(data["folder"])
                folder.mkdir(parents=True, exist_ok=True)
                with TemporaryFile(dir=folder):
                    pass
                value = {"path": str(folder)}
            elif self.path == "/export":
                value = export_file(data)
            elif self.path == "/model/test":
                if not any_text(completion(data, True)):
                    raise ValueError("The test completed without a text reply. Check the model ID.")
                value = {"model": data["model"], "imageInput": data["provider"] == "openrouter"
                         and openrouter_image_input(data["model"])}
            elif self.path == "/v1/chat/completions":
                return self.stream_answer(data)
            else:
                return self.reply({"error": {"message": "Unknown operation."}}, 404)
            self.reply(value)
        except (ValueError, KeyError, TypeError, OSError, sqlite3.Error) as exc:
            self.reply({"error": {"message": str(exc)}}, 400)

    def stream_answer(self, data):
        def event(payload):
            self.wfile.write(("data: " + payload + "\n\n").encode())
            self.wfile.flush()
        with closing(completion(data, False)) as stream:
            first = next(stream, None)
            self.headers_for(200, "text/event-stream")
            self.end_headers()
            try:
                if first:
                    event(json.dumps({"choices": [first]}))
                for choice in stream:
                    event(json.dumps({"choices": [choice]}))
                event("[DONE]")
            except ValueError as exc:
                event(json.dumps({"error": {"message": str(exc)}}))
            except (BrokenPipeError, ConnectionResetError):
                pass


def any_text(stream):
    # Consume to completion so a partial reply followed by a provider error fails the test.
    received = False
    for choice in stream:
        received |= bool((choice["delta"].get("content") or "").strip())
    return received


if __name__ == "__main__":
    os.umask(0o077)
    token = os.environ.get("OKUSTA_TOKEN") or os.environ.get("READING_DESK_TOKEN") or secrets.token_urlsafe(32)
    with ThreadingHTTPServer(("127.0.0.1", 8766), Handler) as server:
        server.bearer = ("Bearer " + token).encode()
        print("Okusta on 127.0.0.1:8766\nPairing token: " + token, flush=True)
        try:
            server.serve_forever()
        except KeyboardInterrupt:
            pass
