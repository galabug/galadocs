#!/usr/bin/env python3
"""Download wheels on an online computer for an offline installation."""

import argparse
import json
from pathlib import Path
import platform
import re
import subprocess
import sys


ROOT = Path(__file__).resolve().parent


def requirements_for(filename, version):
    """Evaluate our python_version markers against the target, not the download host."""
    selected = []
    for line in (ROOT / filename).read_text(encoding='utf-8').splitlines():
        line = line.strip()
        if not line or line.startswith('#'):
            continue
        specification, separator, marker = line.partition(';')
        matches = True
        if separator:
            for condition in marker.strip().split(' and '):
                match = re.fullmatch(r"python_version\s*(<|>=)\s*'([0-9.]+)'", condition.strip())
                if not match:
                    raise ValueError('Unsupported requirements marker: ' + condition)
                boundary = tuple(int(part) for part in match[2].split('.'))
                matches = matches and (version < boundary if match[1] == '<' else version >= boundary)
        if matches:
            selected.append(specification.strip())
    return selected


def main():
    parser = argparse.ArgumentParser(description='在联网电脑下载离线依赖，可为其他系统准备安装包')
    parser.add_argument('--dest', type=Path, default=ROOT / 'wheels')
    parser.add_argument('--python-version', help='目标 Python 小版本，例如 3.12')
    parser.add_argument('--platform', action='append', help='目标 wheel 平台，可重复指定')
    parser.add_argument('--abi', help='目标 ABI，例如 cp312 或 cp37m')
    parser.add_argument('--implementation', help='目标实现，例如 cp')
    args = parser.parse_args()
    cross = any((args.python_version, args.platform, args.abi, args.implementation))
    if cross and not all((args.python_version, args.platform, args.abi, args.implementation)):
        parser.error('为其他电脑打包时，必须同时指定 --python-version、--platform、--abi、--implementation')
    version = tuple(int(part) for part in args.python_version.split('.')[:2]) if cross else sys.version_info[:2]
    if len(version) != 2 or version < (3, 7):
        parser.error('目标 Python 版本必须为 3.7 或更新版本')
    destination = args.dest.expanduser().resolve()
    destination.mkdir(parents=True, exist_ok=True)
    command = [sys.executable, '-m', 'pip', 'download', '--disable-pip-version-check',
               '--only-binary=:all:', '--dest', str(destination)]
    if cross:
        command.extend(['--python-version', args.python_version, '--abi', args.abi,
                        '--implementation', args.implementation])
        for target in args.platform:
            command.extend(['--platform', target])
    base = requirements_for('requirements.txt', version)
    # pip 24.0 is the last version supporting Python 3.7; bundle it for its bootstrap step.
    if version < (3, 8):
        base.append('pip==24.0')
    subprocess.run(command + base, check=True)
    missing = []
    for specification in requirements_for('requirements-advanced.txt', version):
        if subprocess.run(command + [specification]).returncode:
            missing.append(specification)
            print('此目标没有可用的预编译增强组件：' + specification, flush=True)
    metadata = {'python_version': list(version), 'platform': args.platform or [platform.platform()],
                'abi': args.abi, 'optional_unavailable': missing}
    (destination / 'offline-info.json').write_text(json.dumps(metadata, ensure_ascii=False, indent=2), encoding='utf-8')
    print('离线依赖已准备：{}\n将 wheels 放到工具目录中，首次安装会自动使用本地依赖，不访问网络。'.format(destination))
    if missing:
        print('部分增强组件不可用：基础压缩仍可使用，部分图片压缩率可能较低。')
    return 0


if __name__ == '__main__':
    sys.exit(main())
