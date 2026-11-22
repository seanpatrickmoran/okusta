import json
import os
from decimal import Decimal
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest
from unittest.mock import patch

SCRIPTS = Path(__file__).resolve().parents[1] / "scripts"
sys.path.insert(0, str(SCRIPTS))
import qwen_runtime as runtime


class QwenLimitsTest(unittest.TestCase):
    def test_floor_and_convert_on_selected_device(self):
        total = 32 * 1024**3
        for value, expected in (("23.99999", 23990000000), ("19.99", 19990000000),
                                (".555", 550000000), ("auto", 25760000000)):
            ctx, budget, fraction = runtime.launch_limits(total, 32768, value)
            self.assertEqual((ctx, budget), (32768, expected))
            self.assertLessEqual(Decimal(fraction) * total, expected)
            self.assertLess(expected - Decimal(fraction) * total, 1)
        for bad in ("0.009", "-1", "NaN", "35.0"):
            with self.assertRaises(ValueError):
                runtime.launch_limits(total, 32768, bad)

    def test_real_launcher_with_fake_cuda_and_vllm(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            (root / "torch.py").write_text("from types import SimpleNamespace as N\ncuda=N(get_device_properties=lambda n:N(total_memory=32*1024**3))")
            binary = root / "vllm"
            binary.write_text('#!/bin/sh\nprintf "%s\\n" "$@"\n')
            binary.chmod(0o700)
            with patch.dict(os.environ, {"XDG_CONFIG_HOME": directory}):
                runtime.save_runtime({"contextTokens": 20000, "gpuGB": "24.0099"})
                env = dict(os.environ, PYTHONPATH=directory, PATH=directory + ":" + os.environ["PATH"])
                def run(extra):
                    proc = subprocess.run(["bash", str(SCRIPTS / "start-qwen.sh"), "--original", "/a b/checkpoint"],
                                          env={**env, **extra}, capture_output=True, text=True, check=True)
                    return proc.stdout.splitlines()
                saved = run({})
                self.assertIn("24.00 GB", saved[0])
                self.assertIn("20000", saved)
                self.assertIn("/a b/checkpoint", saved)
                override = run({"QWEN_GPU_MEMORY_GB": "22.999", "QWEN_MAX_MODEL_LEN": "16000"})
                self.assertIn("22.99 GB", override[0])
                self.assertIn("16000", override)


    def test_previous_settings_and_launcher_overrides(self):
        with tempfile.TemporaryDirectory() as tmp, patch.dict(os.environ, {
                "XDG_CONFIG_HOME": tmp, "ZERKALO_PORT": "9321"}, clear=True):
            old_path = Path(tmp) / "zerkalo/local-model.json"
            old_path.parent.mkdir()
            previous = {"contextTokens": 8192, "gpuGB": "12.00"}
            old_path.write_text(json.dumps(previous))
            self.assertEqual(runtime.read_runtime(), previous)
            runtime.save_runtime({"contextTokens": 4096, "gpuGB": "8.00"})
            self.assertEqual(runtime.read_runtime()["contextTokens"], 4096)
            self.assertEqual(json.loads(old_path.read_text()), previous)
            self.assertEqual(runtime.option("PORT"), "9321")
            os.environ["OKUSTA_PORT"] = "9200"
            self.assertEqual(runtime.option("PORT"), "9200")

    def test_trained_adapter_launch_arguments(self):
        with tempfile.TemporaryDirectory() as tmp, patch.dict(os.environ, {"OKUSTA_LORA_PATH": "/missing"}):
            path = Path(tmp)
            os.environ["OKUSTA_LORA_PATH"] = str(path)
            (path / "adapter_config.json").write_text(json.dumps({"peft_type": "LORA", "r": 16, "rank_pattern": {"q_proj": 32}}))
            with self.assertRaisesRegex(ValueError, "Missing trained"):
                runtime.adapter_args("base")
            (path / "adapter_model.safetensors").touch()
            args = runtime.adapter_args("base")
            self.assertEqual(args[args.index("--max-lora-rank") + 1], "32")
            self.assertEqual(json.loads(args[args.index("--lora-modules") + 1]),
                             {"name": "collection", "base_model_name": "base", "path": str(path)})
            self.assertIn("--enable-auto-tool-choice", args)
            os.environ["OKUSTA_LORA_NAME"] = "base"
            with self.assertRaisesRegex(ValueError, "distinct"):
                runtime.adapter_args("base")
