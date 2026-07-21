#!/bin/bash
# Stop hook. If source changed this turn (flag set by mark-dirty.sh), run the full
# suite before the turn is allowed to finish. A failure is surfaced back to the
# assistant (exit 2) so a regression can't be quietly handed off. Green clears the flag.
flag="$CLAUDE_PROJECT_DIR/.claude/.needs-test"
[ -f "$flag" ] || exit 0

cd "$CLAUDE_PROJECT_DIR" || exit 0
out=$(npm test 2>&1)
if [ $? -ne 0 ]; then
  echo "GUARD: npm test FAILED — extraction/privacy regression before hand-off. Fix before done." >&2
  printf '%s\n' "$out" | tail -20 >&2
  exit 2
fi
rm -f "$flag"
exit 0
