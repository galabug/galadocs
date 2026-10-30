#!/bin/sh
SCRIPT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
if command -v python3 >/dev/null 2>&1; then
  python3 "$SCRIPT_DIR/start.py" "$@"
  result=$?
elif command -v python >/dev/null 2>&1; then
  python "$SCRIPT_DIR/start.py" "$@"
  result=$?
elif command -v python2.7 >/dev/null 2>&1; then
  python2.7 "$SCRIPT_DIR/start.py" "$@"
  result=$?
else
  echo 'Please install Python 3.7 or newer from python.org.'
  result=1
fi
if [ "$#" -eq 0 ]; then
  printf '\nPress Enter to close...'
  read -r answer
fi
exit "$result"
