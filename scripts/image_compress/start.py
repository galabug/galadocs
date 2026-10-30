#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""Python 2.7/3 compatible launcher; the compression engine uses Python 3.7+."""
from __future__ import print_function

import os
import subprocess
import sys


def find_executable(name):
    extensions = ['']
    if os.name == 'nt':
        extensions += os.environ.get('PATHEXT', '.EXE;.BAT;.CMD').split(';')
    folders = [''] if os.path.dirname(name) else os.environ.get('PATH', '').split(os.pathsep)
    for folder in folders:
        for extension in extensions:
            candidate = os.path.join(folder, name + extension)
            if os.path.isfile(candidate) and os.access(candidate, os.X_OK):
                return os.path.abspath(candidate)
    return None


def find_python3():
    candidates = []
    configured = os.environ.get('IMAGE_COMPRESS_PYTHON3')
    if configured:
        executable = find_executable(configured)
        if executable:
            candidates.append([executable])
    if sys.version_info >= (3, 7):
        candidates.append([sys.executable])
    for name in ('python3', 'python3.13', 'python3.12', 'python3.11', 'python3.10',
                 'python3.9', 'python3.8', 'python3.7', 'python'):
        executable = find_executable(name)
        if executable:
            candidates.append([executable])
    if os.name == 'nt':
        launcher = find_executable('py')
        if launcher:
            candidates.extend([[launcher, '-3.12'], [launcher, '-3.11'], [launcher, '-3'],
                               [launcher, '-3.8'], [launcher, '-3.7']])
    else:
        for executable in ('/opt/homebrew/bin/python3', '/usr/local/bin/python3', '/usr/bin/python3'):
            if os.path.isfile(executable):
                candidates.append([executable])
    seen = set()
    with open(os.devnull, 'wb') as sink:
        for command in candidates:
            key = tuple(command)
            if key in seen:
                continue
            seen.add(key)
            try:
                code = subprocess.call(command + ['-c',
                    'import sys; sys.exit(0 if sys.version_info >= (3, 7) else 1)'],
                    stdout=sink, stderr=sink)
                if code == 0:
                    return command
            except OSError:
                pass
    return None


def main():
    command = find_python3()
    if command is None:
        print('Python 3.7+ was not found. Please install Python 3.7 or newer.', file=sys.stderr)
        print('This launcher supports Python 2.7, but the GUI and compression engine require Python 3.',
              file=sys.stderr)
        print('You can set IMAGE_COMPRESS_PYTHON3 to the Python 3 executable path.', file=sys.stderr)
        return 1
    script = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'start_modern.py')
    try:
        return subprocess.call(command + [script] + sys.argv[1:])
    except KeyboardInterrupt:
        return 130


if __name__ == '__main__':
    sys.exit(main())
