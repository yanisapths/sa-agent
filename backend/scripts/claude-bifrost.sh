#!/usr/bin/env bash
# Point Claude Code (or Codex) at Bifrost instead of Anthropic.
#
#   source /path/to/sa-agent/backend/scripts/claude-bifrost.sh
#   claude
#
# Only this shell is affected, so an unset session still uses your normal
# Claude login. The gateway speaks the Anthropic Messages API at
# `$BIFROST_BASE_URL/anthropic`.
#
# The key has to travel in its own header. A Claude subscription login sends an
# OAuth bearer token and ignores ANTHROPIC_API_KEY, and the gateway answers
# that with `401 virtual key is required`. A custom header is independent of
# whichever auth mode Claude Code is in, so it works either way.
#
# This is separate from the backend agent: /chat reads BIFROST_* directly and
# does not need any of this.

_sa_env="$(cd "$(dirname "${BASH_SOURCE[0]:-$0}")/.." && pwd)/.env"

if [ ! -f "$_sa_env" ]; then
  echo "claude-bifrost: no .env at $_sa_env" >&2
  return 1 2>/dev/null || exit 1
fi

# Read the gateway settings already configured for the backend.
set -a
# shellcheck disable=SC1090
. "$_sa_env"
set +a

if [ -z "$BIFROST_BASE_URL" ] || [ -z "$BIFROST_API_KEY" ]; then
  echo "claude-bifrost: set BIFROST_BASE_URL and BIFROST_API_KEY in $_sa_env" >&2
  return 1 2>/dev/null || exit 1
fi

export ANTHROPIC_BASE_URL="${BIFROST_BASE_URL%/}/anthropic"

# The one that actually authenticates, whatever Claude Code sends alongside it.
export ANTHROPIC_CUSTOM_HEADERS="${AUTH_HEADER:-${BIFROST_AUTH_HEADER:-x-bf-vk}}: $BIFROST_API_KEY"
# Used only when you are not signed in to a Claude subscription.
export ANTHROPIC_API_KEY="$BIFROST_API_KEY"

# Must be a provider that speaks Anthropic wire format — the `*_claude` ones.
export ANTHROPIC_MODEL="${CLAUDE_BIFROST_MODEL:-huawei_claude/glm-5.2}"
# Background chores (titles, summaries) go to something cheaper.
export ANTHROPIC_SMALL_FAST_MODEL="${CLAUDE_BIFROST_SMALL_MODEL:-dashscope_claude/deepseek-v4-flash-0731}"
export ANTHROPIC_DEFAULT_HAIKU_MODEL="$ANTHROPIC_SMALL_FAST_MODEL"

# A subscription login would otherwise win over the key above.
unset ANTHROPIC_AUTH_TOKEN

echo "Claude Code → $ANTHROPIC_BASE_URL"
echo "  model       $ANTHROPIC_MODEL"
echo "  small/fast  $ANTHROPIC_SMALL_FAST_MODEL"
echo "  key header  ${ANTHROPIC_CUSTOM_HEADERS%%:*}"

unset _sa_env
