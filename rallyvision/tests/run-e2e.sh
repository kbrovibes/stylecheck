#!/bin/bash
# Runs the e2e suite detached; log in tests/out/e2e.log
cd "$(dirname "$0")/.."
mkdir -p tests/out
PORT=${PORT:-3411} nohup node tests/e2e.mjs > tests/out/e2e.log 2>&1 &
echo "started pid $!"
