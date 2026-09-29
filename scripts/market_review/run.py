"""Prefer the project-local environment without changing the user's global Python."""
import os
from pathlib import Path
import sys

ROOT = Path(__file__).resolve().parents[2]
local = ROOT / '.venv-review/bin/python'
python = str(local) if local.exists() else sys.executable
os.execv(python, [python, str(Path(__file__).with_name('collect.py')), *sys.argv[1:]])
