#!/usr/bin/env bash
set -euo pipefail

env_files=()

while (($#)); do
  case "$1" in
    --)
      shift
      break
      ;;
    *)
      env_files+=("$1")
      shift
      ;;
  esac
done

if ((${#env_files[@]} == 0)); then
  echo "run-with-env requires at least one env file before --" >&2
  exit 2
fi

if (($# == 0)); then
  echo "run-with-env requires a command after --" >&2
  exit 2
fi

set -a
for env_file in "${env_files[@]}"; do
  if [[ ! -f "$env_file" ]]; then
    echo "missing env file: $env_file" >&2
    exit 1
  fi

  . "$env_file"
done
set +a

exec "$@"
