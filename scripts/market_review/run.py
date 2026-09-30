"""Collect market data, then rebuild and deploy the dashboard after success."""
from pathlib import Path
import subprocess
import sys

ROOT = Path(__file__).resolve().parents[2]


def main(args=None):
    args = list(sys.argv[1:] if args is None else args)
    local = ROOT / '.venv-review/bin/python'
    python = str(local) if local.exists() else sys.executable
    collected = subprocess.run(
        [python, str(Path(__file__).with_name('collect.py')), *args], cwd=ROOT)
    if collected.returncode:
        return collected.returncode
    # Diagnostic/custom output runs must not replace the deployed production dashboard.
    if '--demo' in args or any(arg == flag or arg.startswith(f'{flag}=')
                               for arg in args for flag in ('--output', '--database')):
        return 0
    deployed = subprocess.run(['npm', 'run', 'deploy:mac-build-server'], cwd=ROOT)
    return deployed.returncode


if __name__ == '__main__':
    raise SystemExit(main())
