#!/bin/sh
set -e

BASE=${1:-http://localhost:3000}

echo "=== Smoke test: $BASE ==="

echo "--- GET /health ---"
curl --fail --silent "$BASE/health" | grep -q '"OK"' && echo "OK"

echo "--- GET / ---"
curl --fail --silent "$BASE/" | grep -q '"hostname"' && echo "OK"

echo "=== All checks passed ==="
