#!/usr/bin/env bash
set -euo pipefail

run_stapler() {
  local attempt status delay=15

  for attempt in 1 2 3 4; do
    if xcrun stapler "$@"; then
      return 0
    else
      status=$?
    fi

    if (( status != 68 || attempt == 4 )); then
      return "$status"
    fi

    echo "Stapler returned error 68 during $1. Retrying in ${delay}s."
    sleep "$delay"
    delay=$((delay * 2))
  done
}

run_stapler staple "$1"
run_stapler validate "$1"
