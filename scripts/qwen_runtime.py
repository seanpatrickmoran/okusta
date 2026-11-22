"""Shared on-disk vLLM settings. Importing this module does not initialize CUDA."""
import json
import os
import re
import sys
from decimal import Decimal, ROUND_DOWN
from pathlib import Path
from tempfile import NamedTemporaryFile

GB = 10**9
CENTIGB = GB // 100
DEFAULT_CONTEXT = 32768


def option(name, default=None):
    """An Okusta setting takes precedence over its pre-rename equivalent."""
    return os.environ.get("OKUSTA_" + name, os.environ.get("ZERKALO_" + name, default))


def settings_path():
    folder = os.environ.get("XDG_CONFIG_HOME") or Path.home() / ".config"
    return Path(folder) / "okusta" / "local-model.json"


def validate_runtime(context, gpu):
    if not re.fullmatch(r"[0-9]+", str(context)) or int(context) < 2:
        raise ValueError("Enter a context length of at least two tokens.")
    memory = ""
    if gpu not in (None, "", "auto"):
        value = str(gpu)
        if not re.fullmatch(r"(?:[0-9]{1,9}(?:\.[0-9]*)?|\.[0-9]+)", value):
            raise ValueError("Enter GPU memory as a positive number of decimal GB.")
        gb = Decimal(value).quantize(Decimal("0.01"), rounding=ROUND_DOWN)
        if gb <= 0:
            raise ValueError("GPU memory rounds down to 0.00 GB.")
        memory = str(gb)
    return {"contextTokens": int(context), "gpuGB": memory}


def read_runtime():
    path = settings_path()
    for candidate in (path, path.parents[1] / "zerkalo/local-model.json", path.parents[1] / "reading-desk/qwen.json"):
        try:
            data = json.loads(candidate.read_text(encoding="utf8"))
        except FileNotFoundError:
            continue
        return validate_runtime(data["contextTokens"], data["gpuGB"])
    return None


def save_runtime(data):
    runtime = validate_runtime(data["contextTokens"], data["gpuGB"])
    path = settings_path()
    path.parent.mkdir(parents=True, exist_ok=True)
    with NamedTemporaryFile("w", encoding="utf8", dir=path.parent, delete=False) as handle:
        tmp = Path(handle.name)
        try:
            json.dump(runtime, handle)
            handle.write("\n")
            handle.flush()
            os.fsync(handle.fileno())
            handle.close()
            tmp.replace(path)
        finally:
            tmp.unlink(missing_ok=True)
    return str(path)


def launch_limits(total_bytes, context, memory_gb):
    runtime = validate_runtime(context, memory_gb)
    if total_bytes <= 0:
        raise ValueError("CUDA reported an empty device.")
    budget = (int(Decimal(runtime["gpuGB"]) * GB) if runtime["gpuGB"]
              else (total_bytes * 3 // 4) // CENTIGB * CENTIGB)
    if not 0 < budget <= total_bytes:
        available = Decimal(total_bytes // CENTIGB) / 100
        raise ValueError(f"GPU budget exceeds the CUDA device capacity of {available:.2f} GB.")
    fraction = (Decimal(budget) / total_bytes).quantize(Decimal("0.000000000001"), rounding=ROUND_DOWN)
    return runtime["contextTokens"], budget, str(fraction)


def adapter_args(model_id):
    location = option("LORA_PATH")
    if not location:
        return []
    path = Path(location).expanduser().resolve()
    name = option("LORA_NAME", "collection")
    if not re.fullmatch(r"[A-Za-z0-9_.-]+", name) or name == model_id:
        raise ValueError("Choose a distinct served adapter name using letters, digits, dots, dashes or underscores.")
    with (path / "adapter_config.json").open(encoding="utf8") as stream:
        config = json.load(stream)
    if config.get("peft_type") != "LORA":
        raise ValueError("The selected adapter_config.json must describe a PEFT LoRA.")
    if not any((path / w).is_file() for w in ("adapter_model.safetensors", "adapter_model.bin")):
        raise ValueError(f"Missing trained adapter weights in {path}.")
    ranks = [config.get("r"), *(config.get("rank_pattern") or {}).values()]
    if not all(type(r) is int and r > 0 for r in ranks):
        raise ValueError("Invalid LoRA rank in adapter_config.json.")
    rank = next((n for n in (8, 16, 32, 64, 128, 256, 320, 512) if n >= max(ranks)), None)
    if rank is None:
        raise ValueError("This launcher supports adapters up to rank 512.")
    module = {"name": name, "path": str(path), "base_model_name": model_id}
    return ["--enable-lora", "--lora-modules", json.dumps(module), "--max-lora-rank", str(rank),
            "--enable-auto-tool-choice", "--tool-call-parser", option("TOOL_PARSER", "hermes")]


def launch(model_id, model_path):
    runtime = read_runtime() or {"contextTokens": DEFAULT_CONTEXT, "gpuGB": ""}
    context = option("CONTEXT", os.environ.get("QWEN_MAX_MODEL_LEN", runtime["contextTokens"]))
    memory = option("GPU_GB", os.environ.get("QWEN_GPU_MEMORY_GB", runtime["gpuGB"]))
    if model_id == "Qwen/Qwen3-4B" and int(context) > 32768:
        raise ValueError("The original Qwen3-4B launcher supports up to 32768 tokens. Use Instruct-2507 for more.")
    adapter = adapter_args(model_id)
    import torch
    size = torch.cuda.get_device_properties(0).total_memory
    length, budget, fraction = launch_limits(size, context, memory)
    print(f"{model_id} · context {length:,} tokens · GPU budget {Decimal(budget)/GB:.2f} GB", flush=True)
    args = ["vllm", "serve", model_path, "--served-model-name", model_id,
            "--host", "127.0.0.1", "--port", option("PORT", "8765"), "--max-model-len", str(length),
            "--gpu-memory-utilization", fraction, "--allowed-origins", "[]"]
    os.execvp(args[0], args + adapter)


if __name__ == "__main__":
    try:
        launch(*sys.argv[1:])
    except (OSError, ValueError, KeyError, ImportError, RuntimeError, AssertionError) as exc:
        sys.exit(f"Okusta could not start vLLM: {exc}")
