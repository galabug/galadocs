#!/usr/bin/env python3
"""Create a portable source bundle without machine-specific environments."""

import argparse
from pathlib import Path
import zipfile


FILES = (
    'start.py', 'start_modern.py', 'start.command', 'start.bat', 'compress.py', 'compare.py',
    'requirements.txt', 'requirements-advanced.txt', '开始使用.txt', 'README.md',
    'test_compress.py', 'TINYPNG-ANALYSIS.md', 'benchmark.csv',
    'gui.py', 'gui.html', 'gui.js', 'test_gui.py',
    'test_launcher.py',
)


def build_package(target: Path) -> None:
    root = Path(__file__).resolve().parent
    target.parent.mkdir(parents=True, exist_ok=True)
    with zipfile.ZipFile(target, 'x', compression=zipfile.ZIP_DEFLATED) as archive:
        for filename in FILES:
            data = (root / filename).read_bytes()
            if filename.endswith('.bat'):
                data = data.replace(b'\r\n', b'\n').replace(b'\n', b'\r\n')
            info = zipfile.ZipInfo('ImageCompressor/' + filename)
            info.create_system = 3
            mode = 0o755 if filename == 'start.command' else 0o644
            info.external_attr = (0o100000 | mode) << 16
            info.compress_type = zipfile.ZIP_DEFLATED
            archive.writestr(info, data)


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('output', type=Path)
    args = parser.parse_args()
    build_package(args.output.expanduser().resolve())
    print(args.output.expanduser().resolve())


if __name__ == '__main__':
    main()
