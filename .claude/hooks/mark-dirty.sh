#!/bin/bash
# PostToolUse hook. Reads the tool-call JSON on stdin, and if the edited file is
# part of the shipped extension, drops a flag so the Stop hook knows to run the
# suite. Keeps the guard off pure Q&A / docs turns.
input=$(cat)
file=$(printf '%s' "$input" | python3 -c "import sys,json;print(json.load(sys.stdin).get('tool_input',{}).get('file_path',''))" 2>/dev/null)
case "$file" in
  *lib/*.ts|*content.ts|*background.ts|*popup.tsx|*package.json)
    touch "$CLAUDE_PROJECT_DIR/.claude/.needs-test"
    ;;
esac
exit 0
