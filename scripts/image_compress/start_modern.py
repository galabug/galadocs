#!/usr/bin/env python3
"""Portable launcher: install dependencies locally, then run the compressor."""

import argparse
import json
import os
from pathlib import Path
import platform
import shlex
import shutil
import subprocess
import sys
import venv


ROOT = Path(__file__).resolve().parent


def runtime_python() -> Path:
    """Never reuse a virtualenv moved from another directory or computer."""
    if sys.version_info < (3, 7):
        raise RuntimeError('Please install Python 3.7 or newer.')
    identity = {
        'directory': str(ROOT), 'system': platform.system(), 'machine': platform.machine(),
        'version': list(sys.version_info[:3]), 'python': str(Path(sys.executable).resolve()),
    }
    environment = ROOT / '.runtime'
    marker = environment / 'installation.json'
    python = environment / ('Scripts/python.exe' if os.name == 'nt' else 'bin/python')
    installed = {}
    if marker.is_file():
        try:
            installed = json.loads(marker.read_text(encoding='utf-8'))
        except (OSError, ValueError):
            pass
    if installed.get('identity') != identity or not python.is_file():
        if environment.exists():
            shutil.rmtree(environment)
        print('首次运行或程序位置已改变：正在创建本机运行环境……', flush=True)
        venv.EnvBuilder(with_pip=True).create(environment)
    requirements = ROOT / 'requirements.txt'
    advanced = ROOT / 'requirements-advanced.txt'
    signature = requirements.read_text(encoding='utf-8') + advanced.read_text(encoding='utf-8')
    probe = subprocess.run(
        [str(python), '-c', 'import PIL, numpy'], capture_output=True
    )
    if probe.returncode or installed.get('requirements') != signature or installed.get('identity') != identity:
        print('正在安装图片处理依赖（首次需要联网）……', flush=True)
        if sys.version_info < (3, 8):
            subprocess.run([str(python), '-m', 'pip', 'install', '--disable-pip-version-check',
                            '--upgrade', 'pip==24.0'], check=True)
        subprocess.run(
            [str(python), '-m', 'pip', 'install', '--disable-pip-version-check',
             '-r', str(requirements)], check=True
        )
        for specification in advanced.read_text(encoding='utf-8').splitlines():
            if not specification.strip() or specification.startswith('#'):
                continue
            result = subprocess.run(
                [str(python), '-m', 'pip', 'install', '--disable-pip-version-check',
                 '--only-binary=:all:', specification],
            )
            if result.returncode:
                print(f'此平台无法安装可选组件 {specification}，使用其余可用编码器。', flush=True)
        marker.write_text(json.dumps({'identity': identity, 'requirements': signature}), encoding='utf-8')
    return python


def choose_input() -> Path:
    try:
        import tkinter as tk
        from tkinter import filedialog, messagebox
        window = tk.Tk()
        window.withdraw()
        try:
            folder = messagebox.askyesnocancel(
                '图片压缩', '请选择压缩方式：\n是：选择整个文件夹\n否：选择一张图片\n取消：退出',
                parent=window,
            )
            if folder is None:
                raise KeyboardInterrupt
            if folder:
                selected = filedialog.askdirectory(title='选择要压缩的图片文件夹', parent=window)
            else:
                selected = filedialog.askopenfilename(title='选择图片', parent=window)
        finally:
            window.destroy()
        if not selected:
            raise KeyboardInterrupt
        return Path(selected)
    except (ImportError, RuntimeError):
        pass
    except Exception as error:
        # A headless Linux machine may have tkinter but no display server.
        print(f'图形选择器不可用，使用路径输入：{error}')
    text = input('请输入图片或文件夹完整路径（可拖入终端）：\n> ').strip()
    if not text:
        raise KeyboardInterrupt
    if os.name != 'nt':
        parts = shlex.split(text)
        if len(parts) == 1:
            text = parts[0]
    else:
        text = text.strip('"')
    return Path(text)


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('input', nargs='?', type=Path)
    parser.add_argument('-o', '--output', type=Path)
    parser.add_argument('--profile', choices=('smart', 'reference', 'gentle'), default='smart')
    parser.add_argument('--no-flat', action='store_true', help='Do not create the 0000 directory')
    parser.add_argument('--setup-only', action='store_true', help='Install dependencies and exit')
    interface = parser.add_mutually_exclusive_group()
    interface.add_argument('--gui', action='store_true', help='Open the graphical interface')
    interface.add_argument('--cli', action='store_true', help='Use interactive command-line input')
    args = parser.parse_args()
    try:
        if args.setup_only:
            runtime_python()
            print('安装完成，可以离线使用。')
            return 0
        if args.gui or (args.input is None and not args.cli):
            if args.input or args.output or args.no_flat or args.profile != 'smart':
                parser.error('请在图形界面中设置参数，或指定输入路径使用命令行')
            from gui import launch
            return launch()
        source = (args.input or choose_input()).expanduser().resolve()
        if not source.exists():
            raise ValueError(f'输入不存在：{source}')
        output = args.output.expanduser().resolve() if args.output else source.with_name(source.stem + '-compressed')
        if not args.output:
            number = 2
            while output.exists():
                output = source.with_name(f'{source.stem}-compressed-{number}')
                number += 1
        if output.exists():
            raise ValueError(f'输出目录已存在，请指定新目录：{output}')
        if source == output or source in output.parents:
            raise ValueError('输出目录必须位于输入目录之外')
        python = runtime_python()
        command = [str(python), str(ROOT / 'compress.py'), str(source), '-o', str(output),
                   '--profile', args.profile]
        if not args.no_flat:
            command.append('--flat')
        result = subprocess.run(command)
        print(f'\n输出位置：{output}', flush=True)
        return result.returncode
    except KeyboardInterrupt:
        print('\n已取消。')
        return 130
    except Exception as error:
        print(f'运行失败：{error}\n请查看“开始使用.txt”中的安装说明。', file=sys.stderr)
        return 1


if __name__ == '__main__':
    sys.exit(main())
