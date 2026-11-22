#!/usr/bin/env bash
set -eu
# A positional path can point to a local copy of the selected checkpoint.
served_model=Qwen/Qwen3-4B-Instruct-2507
if [[ ${1:-} == --original ]]; then
  served_model=Qwen/Qwen3-4B
  shift
fi
if (( $# > 1 )); then
  echo "Usage: bash scripts/start-qwen.sh [--original] [checkpoint-directory]" >&2
  exit 2
fi
model_path=${1:-$served_model}
script_dir=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)
exec python "$script_dir/qwen_runtime.py" "$served_model" "$model_path"
