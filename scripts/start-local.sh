#!/usr/bin/env bash
set -eu
# Supply a model ID or a local checkpoint. The existing starter model is the default.
model_path=${1:-${OKUSTA_MODEL:-${ZERKALO_MODEL:-Qwen/Qwen3-4B-Instruct-2507}}}
model_id=${OKUSTA_SERVED_NAME:-${ZERKALO_SERVED_NAME:-$model_path}}
script_dir=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)
exec python "$script_dir/qwen_runtime.py" "$model_id" "$model_path"
