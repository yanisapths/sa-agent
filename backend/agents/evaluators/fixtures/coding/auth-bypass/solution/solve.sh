#!/bin/sh
set -e
cp "$(dirname "$0")/auth.ts" "$EVAL_WORKSPACE/src/auth.ts"
