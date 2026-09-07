#!/usr/bin/env bash
# Point Claude Code at Bifrost instead of api.anthropic.com.
#
#   source /path/to/sa-agent/backend/scripts/claude-bifrost.sh
#   claude
#
# Or:
#
#   /path/to/sa-agent/backend/scripts/claude
#
# Only this shell is affected. The gateway's Anthropic Messages API lives at
# `$BIFROST_BASE_URL/anthropic` — the origin alone 404s.
#
# The gateway authenticates on `x-bf-vk`, not Anthropic's `x-api-key`. Claude
# Code with a subscription login sends an OAuth bearer and ignores
# ANTHROPIC_API_KEY, which is exactly `401 virtual key is required`. A custom
# header is independent of whichever auth mode the CLI is in.
#
# Still unset ANTHROPIC_AUTH_TOKEN so a leftover Claude login does not win.
#
# The LangChain /chat agent is separate: it reads BIFROST_* and speaks
# Chat Completions at `$BIFROST_BASE_URL/v1`.

_sa_env="$(cd "$(dirname "${BASH_SOURCE[0]:-$0}")/.." && pwd)/.env"

if [ ! -f "$_sa_env" ]; then
  echo "claude-bifrost: no .env at $_sa_env" >&2
  return 1 2>/dev/null || exit 1
fi

set -a
# shellcheck disable=SC1090
. "$_sa_env"
set +a

if [ -z "$BIFROST_BASE_URL" ] || [ -z "$BIFROST_API_KEY" ]; then
  echo "claude-bifrost: set BIFROST_BASE_URL and BIFROST_API_KEY in $_sa_env" >&2
  return 1 2>/dev/null || exit 1
fi

_base="${BIFROST_BASE_URL%/}"
_base="${_base%/anthropic}"
export ANTHROPIC_BASE_URL="${_base}/anthropic"
export ANTHROPIC_API_KEY="$BIFROST_API_KEY"
_vk_header="${BIFROST_AUTH_HEADER:-x-bf-vk}"
export ANTHROPIC_CUSTOM_HEADERS="${_vk_header}: $BIFROST_API_KEY"

# Any provider the gateway routes — not only Claude ids. Type them with
# /model; the picker only lists Claude names.
export ANTHROPIC_MODEL="${CLAUDE_BIFROST_MODEL:-dashscope/qwen3.8-max}"
export ANTHROPIC_SMALL_FAST_MODEL="${CLAUDE_BIFROST_SMALL_MODEL:-huawei/glm-5.2}"
export ANTHROPIC_DEFAULT_HAIKU_MODEL="$ANTHROPIC_SMALL_FAST_MODEL"

unset ANTHROPIC_AUTH_TOKEN
unset _vk_header
unset _base

echo "Claude Code → $ANTHROPIC_BASE_URL"
echo "  model       $ANTHROPIC_MODEL"
echo "  small/fast  $ANTHROPIC_SMALL_FAST_MODEL"
echo "  key header  ${ANTHROPIC_CUSTOM_HEADERS%%:*}"

unset _sa_env
