"""Exercise actual SQLite files and the helper HTTP boundary with simulated provider streams."""
import importlib.util
import io
import json
from pathlib import Path
import sqlite3
import sys
import tempfile
import threading
import unittest
from contextlib import closing
from unittest.mock import patch
from urllib.error import HTTPError
from urllib.request import Request, urlopen

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "scripts"))
spec = importlib.util.spec_from_file_location("desk_service", Path(__file__).resolve().parents[1] / "scripts/desk-service.py")
desk = importlib.util.module_from_spec(spec)
spec.loader.exec_module(desk)


class HelperTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.server = desk.ThreadingHTTPServer(("127.0.0.1", 0), desk.Handler)
        self.server.bearer = b"Bearer pairing-test"
        threading.Thread(target=self.server.serve_forever, daemon=True).start()
        self.addCleanup(self.server.server_close)
        self.addCleanup(self.server.shutdown)

    def post(self, route, data, token="pairing-test", origin="moz-extension://abc"):
        request = Request(f"http://127.0.0.1:{self.server.server_port}" + route,
                          data=json.dumps(data).encode(), headers={"Origin": origin,
                          "Content-Type": "application/json", "Authorization": "Bearer " + token})
        try:
            with urlopen(request, timeout=4) as reply:
                return reply.read().decode() if reply.headers.get_content_type() == "text/event-stream" else json.load(reply)
        except HTTPError as exc:
            with exc:
                raise ValueError(json.load(exc)["error"]["message"]) from None

    def test_okusta_keys_take_precedence_over_legacy_config(self):
        home = Path(self.tmp.name)
        with patch.object(Path, "home", return_value=home), patch.dict(desk.os.environ, {}, clear=True):
            for folder in ("zerkalo", "okusta"):
                path = home / ".config" / folder / "keys.json"
                path.parent.mkdir(parents=True)
                path.write_text(json.dumps({"openrouter": folder}))
                path.chmod(0o600)
                self.assertEqual(desk.credential("openrouter"), folder)
            desk.os.environ["ZERKALO_KEYS_FILE"] = str(home / ".config/zerkalo/keys.json")
            self.assertEqual(desk.credential("openrouter"), "zerkalo")
            desk.os.environ["OKUSTA_KEYS_FILE"] = str(home / "missing.json")
            self.assertEqual(desk.credential("openrouter"), "")

    def test_storage_and_export(self):
        root = Path(self.tmp.name)
        db = {"path": str(root / "journal.sqlite")}
        clip = {"clip:old": {"text": "saved clip"}, "note:old": {"text": "saved answer"}}
        self.post("/journal/open", {**db, "records": clip})
        self.post("/journal/open", {**db, "records": clip})
        with self.assertRaisesRegex(ValueError, "Conflicting"):
            self.post("/journal/open", {**db, "records": {"clip:new": {}, "note:old": {"text": "changed"}}})
        self.assertEqual(self.post("/journal/read", db), clip)
        for q in ("one", "two", "one"):
            self.post("/journal/write", {**db, "records": {"questions:old": [{"question": q}]}})
        self.assertEqual(self.post("/journal/read", {**db, "keys": ["questions:old"]}),
                         {"questions:old": [{"question": "one"}, {"question": "two"}]})
        folder = self.post("/folder", {"folder": str(root / "exports")})["path"]
        output = {"folder": folder, "format": "md", "text": "saved answer"}
        first = Path(self.post("/export", output)["path"])
        self.assertEqual(first.read_text(), "saved answer")
        self.assertNotEqual(str(first), self.post("/export", output)["path"])
        with self.assertRaisesRegex(ValueError, "Pair"):
            self.post("/journal/read", db, token="wrong")
        with self.assertRaisesRegex(ValueError, "Pair"):
            self.post("/journal/read", db, origin="https://example.org")
        with closing(sqlite3.connect(root / "other.db")) as other:
            other.execute("CREATE TABLE other(x)")
        with self.assertRaisesRegex(ValueError, "Okusta database"):
            self.post("/journal/open", {"path": str(root / "other.db")})
        (root / "journal.sqlite").unlink()
        with self.assertRaises(ValueError):
            self.post("/journal/read", db)
        self.assertFalse((root / "journal.sqlite").exists())

    def test_hosted_providers_through_shared_transport(self):
        calls = []
        def upstream(request, timeout):
            if request.full_url == desk.BASES["openrouter"] + "/models":
                self.assertIsNone(request.get_header("Authorization"))
                return io.BytesIO(b'{"data":[{"id":"example-id","architecture":{"input_modalities":["text","image"]}}]}')
            calls.append((request, json.loads(request.data)))
            if request.get_header("Authorization") == "Bearer invalid":
                raise HTTPError(request.full_url, 401, "upstream private detail", {}, io.BytesIO())
            return io.BytesIO(
                b': keepalive\r\n\r\ndata: {"choices":\r\ndata: [{"delta":{"content":"OK","reasoning":"private field"},'
                b'"finish_reason":"stop"}]}\r\n\r\ndata: [DONE]\r\n\r\n')
        with patch.object(desk.provider_http, "open", side_effect=upstream), patch.dict(desk.os.environ, clear=True):
            for provider, base in desk.BASES.items():
                data = {"provider": provider, "model": "example-id"}
                key = "sample-" + provider
                keys_file = Path(self.tmp.name) / "keys.json"
                keys_file.write_text(json.dumps({provider: key}))
                keys_file.chmod(0o600)
                desk.os.environ["OKUSTA_KEYS_FILE"] = str(keys_file)
                self.assertEqual(self.post("/model/test", data)["imageInput"], provider == "openrouter")
                args, request = calls[-1]
                self.assertEqual(args.full_url, base + "/chat/completions")
                self.assertEqual(args.get_header("Authorization"), "Bearer " + key)
                self.assertTrue(request["stream"])
                self.assertEqual(request["messages"], [{"role": "user", "content": "Reply with OK."}])
                messages = [{"role": "user", "content": "clipping"}]
                stream = self.post("/v1/chat/completions", {**data, "messages": [{**messages[0], "unused": "discard"}]})
                self.assertNotIn("private field", stream)
                self.assertIn('"content": "OK"', stream)
                self.assertIn("[DONE]", stream)
                self.assertEqual(calls[-1][1]["messages"], messages)
                desk.os.environ[provider.upper() + "_API_KEY"] = "invalid"
                with self.assertRaisesRegex(ValueError, "HTTP 401"):
                    self.post("/model/test", data)
                del desk.os.environ[provider.upper() + "_API_KEY"]
                self.assertEqual(desk.credential(provider), key)
                keys_file.chmod(0o644)
                with self.assertRaisesRegex(ValueError, "permissions"):
                    self.post("/model/test", data)
                keys_file.unlink()
                with self.assertRaisesRegex(ValueError, "Configure the helper"):
                    self.post("/v1/chat/completions", {**data, "messages": messages})

    def test_safari_pairing_and_openrouter_stream(self):
        origin = "safari-web-extension://1C606D08-1975-43B2-984F-EE23C58FEF55"
        url = f"http://127.0.0.1:{self.server.server_port}/status"
        headers = {"Origin": origin, "Access-Control-Request-Method": "POST",
                   "Access-Control-Request-Headers": "authorization,content-type"}
        with urlopen(Request(url, headers=headers, method="OPTIONS"), timeout=4) as preflight:
            self.assertEqual(preflight.status, 204)
            self.assertEqual(preflight.headers["Access-Control-Allow-Origin"], origin)
            self.assertIn("Authorization", preflight.headers["Access-Control-Allow-Headers"])
        with self.assertRaisesRegex(ValueError, "Pair"):
            self.post("/status", {}, token="", origin=origin)
        for denied in ("https://example.org", "null", origin + ".example.org", origin + "/page"):
            with self.subTest(origin=denied), self.assertRaises(HTTPError) as caught:
                urlopen(Request(url, headers={**headers, "Origin": denied}, method="OPTIONS"), timeout=4)
            self.assertEqual(caught.exception.code, 403)
            self.assertIsNone(caught.exception.headers.get("Access-Control-Allow-Origin"))
            caught.exception.close()
        def upstream(request, timeout):
            if request.full_url == "https://openrouter.ai/api/v1/models":
                return io.BytesIO(b'{"data":[]}')
            self.assertEqual(request.full_url, "https://openrouter.ai/api/v1/chat/completions")
            self.assertEqual(json.loads(request.data)["model"], "openrouter/free")
            return io.BytesIO(b'data: {"choices":[{"delta":{"content":"OK"},"finish_reason":"stop"}]}\n\ndata: [DONE]\n\n')
        with patch.dict(desk.os.environ, {"OPENROUTER_API_KEY": "fixture-key"}), patch.object(desk.provider_http, "open", side_effect=upstream):
            self.assertTrue(self.post("/status", {}, origin=origin)["keys"]["openrouter"])
            route = {"provider": "openrouter", "model": "openrouter/free"}
            self.assertEqual(self.post("/model/test", route, origin=origin)["model"], route["model"])
            messages = [{"role": "user", "content": "Test from Safari"}]
            response = self.post("/v1/chat/completions", {**route, "messages": messages}, origin=origin)
            self.assertIn('"content": "OK"', response)
            self.assertIn("[DONE]", response)

    def test_image_request_preserves_one_inline_crop(self):
        calls = []
        crop = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+j03sAAAAASUVORK5CYII="
        parts = [{"type": "text", "text": "Describe this region."}, {"type": "image_url", "image_url": {"url": crop}}]
        messages = [{"role": "user", "content": parts}, {"role": "assistant", "content": "A square."},
                    {"role": "user", "content": "What color?"}]
        def upstream(request, timeout):
            calls.append(json.loads(request.data)["messages"])
            return io.BytesIO(b'data: {"choices":[{"delta":{"content":"White"},"finish_reason":"stop"}]}\n\ndata: [DONE]\n\n')
        route = {"provider": "openrouter", "model": "vision"}
        with patch.object(desk.provider_http, "open", side_effect=upstream), patch.dict(desk.os.environ, {
                "OPENROUTER_API_KEY": "fixture", "OPENAI_API_KEY": "fixture"}):
            self.assertIn("White", self.post("/v1/chat/completions", {**route, "messages": messages}))
            with self.assertRaisesRegex(ValueError, "text messages"):
                self.post("/v1/chat/completions", {**route, "provider": "openai", "messages": messages})
            remote = [parts[0], {"type": "image_url", "image_url": {"url": "https://example.org/image.png"}}]
            with self.assertRaisesRegex(ValueError, "embedded PNG"):
                self.post("/v1/chat/completions", {**route, "messages": [{"role": "user", "content": remote}]})
        self.assertEqual(calls, [messages])


if __name__ == "__main__":
    unittest.main()
