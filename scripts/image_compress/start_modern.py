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


def dependency_source():
    folder = Path(os.environ.get('IMAGE_COMPRESS_WHEEL_DIR', str(ROOT / 'wheels'))).expanduser().resolve()
    offline = os.environ.get('IMAGE_COMPRESS_OFFLINE') == '1' or folder.is_dir()
    if offline and not folder.is_dir():
        raise RuntimeError('离线依赖目录不存在：{}。请先在联网电脑运行 prepare_offline.py，再复制整个工具目录。'.format(folder))
    return offline, folder


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
        try:
            venv.EnvBuilder(with_pip=True).create(environment)
        except (OSError, subprocess.CalledProcessError) as error:
            raise RuntimeError('无法创建 Python 运行环境，请确认此 Python 已安装 venv / ensurepip。'
                               '内网电脑需要预先准备相应系统组件。原始错误：{}'.format(error))
    requirements = ROOT / 'requirements.txt'
    advanced = ROOT / 'requirements-advanced.txt'
    signature = requirements.read_text(encoding='utf-8') + advanced.read_text(encoding='utf-8')
    probe = subprocess.run(
        [str(python), '-c', 'import PIL, numpy'], capture_output=True
    )
    if probe.returncode or installed.get('requirements') != signature or installed.get('identity') != identity:
        offline, wheels = dependency_source()
        install = [str(python), '-m', 'pip', 'install', '--disable-pip-version-check']
        pip_environment = dict(os.environ)
        if offline:
            pip_environment = {key: value for key, value in os.environ.items() if not key.startswith('PIP_')}
            pip_environment.update(PIP_CONFIG_FILE=os.devnull, PIP_NO_INDEX='1', PIP_DISABLE_PIP_VERSION_CHECK='1')
            print('正在从本地 wheels 目录安装依赖，全程不访问网络……', flush=True)
            install.extend(['--no-index', '--find-links', str(wheels), '--only-binary=:all:'])
        else:
            print('正在联网安装依赖；内网电脑请先准备 wheels 离线依赖包。', flush=True)
        if sys.version_info < (3, 8):
            subprocess.run(install + ['--upgrade', 'pip==24.0'], check=True, env=pip_environment)
        try:
            subprocess.run(install + ['-r', str(requirements)], check=True, env=pip_environment)
        except subprocess.CalledProcessError:
            raise RuntimeError('依赖安装失败。{}请确认依赖包与目标电脑的系统、CPU 架构和 Python 小版本匹配。'.format(
                '当前为离线安装，未尝试联网；' if offline else '内网使用请在联网电脑准备 wheels 目录；'))
        for specification in advanced.read_text(encoding='utf-8').splitlines():
            if not specification.strip() or specification.startswith('#'):
                continue
            result = subprocess.run(
                install + ['--only-binary=:all:', specification],
                env=pip_environment,
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
    parser.add_argument('--flat-name', default='0000', help='Name of the optional collection')
    parser.add_argument('--setup-only', action='store_true', help='Install dependencies and exit')
    parser.add_argument('--offline', action='store_true', help='Install only from local wheels, never from an index')
    parser.add_argument('--wheel-dir', type=Path, help='Local offline dependency directory')
    interface = parser.add_mutually_exclusive_group()
    interface.add_argument('--gui', action='store_true', help='Open the graphical interface')
    interface.add_argument('--cli', action='store_true', help='Use interactive command-line input')
    args = parser.parse_args()
    if args.offline or args.wheel_dir:
        os.environ['IMAGE_COMPRESS_OFFLINE'] = '1'
    if args.wheel_dir:
        os.environ['IMAGE_COMPRESS_WHEEL_DIR'] = str(args.wheel_dir.expanduser().resolve())
    try:
        if args.setup_only:
            runtime_python()
            print('安装完成，可以离线使用。')
            return 0
        if args.gui or (args.input is None and not args.cli):
            if args.input or args.output or args.no_flat or args.profile != 'smart' or args.flat_name != '0000':
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
            command.extend(['--flat', '--flat-name', args.flat_name])
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
