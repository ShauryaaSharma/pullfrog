#!/usr/bin/env bash
# determines which agents need testing based on changed files.
# reads changed file paths from stdin (JSON array or newline-delimited).
# outputs a JSON array of agent names to stdout.
#
# only agents whose harness file changed are included.
# shared.ts/index.ts and other non-harness action changes fall back to claude as a canary.
set -euo pipefail

# read stdin - auto-detect JSON array vs newline-delimited
input=$(cat)
if echo "$input" | jq -e 'type == "array"' > /dev/null 2>&1; then
  files=$(echo "$input" | jq -r '.[]')
else
  files="$input"
fi

# find which agent harness files changed
changed_agents=()
has_non_agent_change=false

while IFS= read -r file; do
  [[ -z "$file" ]] && continue
  case "$file" in
    action/agents/shared.ts|action/agents/index.ts)
      has_non_agent_change=true
      ;;
    action/agents/*.ts)
      changed_agents+=("$(basename "$file" .ts)")
      ;;
    action/*)
      has_non_agent_change=true
      ;;
  esac
done <<< "$files"

# output agents based on change type.
# non-agent action changes run claude as a canary.
if [[ ${#changed_agents[@]} -gt 0 ]]; then
  printf '%s\n' "${changed_agents[@]}" | sort -u | jq -R . | jq -sc .
elif $has_non_agent_change; then
  echo '["claude"]'
else
  echo '[]'
fi
