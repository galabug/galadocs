#!/usr/bin/env python3
"""Local browser interface for the portable Python image compressor."""

import argparse
import hmac
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import json
import os
from pathlib import Path
import re
import secrets
import signal
import subprocess
import sys
import threading
import webbrowser


ROOT = Path(__file__).resolve().parent
EXTENSIONS = {'.jpg', '.jpeg', '.png', '.gif', '.webp'}
PROFILES = {'smart', 'gentle', 'reference'}


def plan_output(source: Path, parent: str, name: str) -> Path:
    source = source.expanduser().resolve()
    directory = Path(parent).expanduser().resolve() if parent else source.parent
    name = name.strip() or source.stem + '-compressed'
    if name in {'.', '..'} or any(character in name for character in '/\\\0'):
        raise ValueError('结果目录名称不能包含路径分隔符')
    if directory.exists() and not directory.is_dir():
        raise ValueError('输出位置必须是文件夹')
    output = directory / name
    number = 2
    while output.exists():
        output = directory / f'{name}-{number}'
        number += 1
    output = output.resolve()
    if output == source or source in output.parents:
        raise ValueError('输出位置必须在输入文件夹之外，请选择它的上一级或其他位置')
    return output


def browse_directory(value: str) -> dict:
    path = Path(value).expanduser().resolve() if value else Path.home()
    if path.is_file():
        path = path.parent
    if not path.is_dir():
        raise ValueError('找不到这个文件夹，请检查路径')
    entries = []
    for child in path.iterdir():
        if child.name.startswith('.'):
            continue
        try:
            folder = child.is_dir()
            if folder or child.suffix.lower() in EXTENSIONS:
                entries.append({'name': child.name, 'path': str(child), 'directory': folder})
        except OSError:
            continue
    entries.sort(key=lambda item: (not item['directory'], item['name'].casefold()))
    return {'path': str(path), 'parent': str(path.parent), 'entries': entries[:500],
            'truncated': len(entries) > 500}


class JobManager:
    def __init__(self):
        self.lock = threading.Lock()
        self.cancelled = threading.Event()
        self.process = None
        self.state = {'status': 'idle', 'message': '选择图片或文件夹，开始压缩',
                      'current': 0, 'total': 0, 'logs': [], 'output': '', 'flat_output': '',
                      'success': 0, 'failed': 0, 'before': 0, 'after': 0, 'saved_percent': 0}

    def snapshot(self) -> dict:
        with self.lock:
            return {**self.state, 'logs': list(self.state['logs'])}

    def update(self, **values) -> None:
        with self.lock:
            self.state.update(values)

    def start(self, options: dict) -> None:
        value = str(options.get('input', '')).strip()
        if not value:
            raise ValueError('请先选择图片或文件夹')
        source = Path(value).expanduser().resolve()
        if not source.exists():
            raise ValueError('输入路径不存在')
        if source.is_file() and source.suffix.lower() not in EXTENSIONS:
            raise ValueError('请选择 JPG、PNG、WebP 或 GIF 图片')
        profile = options.get('profile', 'smart')
        if profile not in PROFILES:
            raise ValueError('压缩模式无效')
        if not isinstance(options.get('flat', True), bool):
            raise ValueError('汇总目录选项无效')
        output = plan_output(source, str(options.get('parent', '')).strip(),
                             str(options.get('name', '')).strip())
        with self.lock:
            if self.state['status'] in {'setup', 'running', 'stopping'}:
                raise ValueError('已有任务正在运行')
            self.cancelled.clear()
            self.state.update(status='setup', message='正在准备运行环境，首次使用需要联网',
                              current=0, total=0, logs=[], output=str(output), flat_output='',
                              success=0, failed=0, before=0, after=0, saved_percent=0)
        threading.Thread(target=self.run, args=(source, output, profile, options.get('flat', True)),
                         daemon=True).start()

    def log(self, line: str) -> None:
        with self.lock:
            self.state['logs'].append(line)
            self.state['logs'] = self.state['logs'][-200:]
            progress = re.match(r'^\[(\d+)/(\d+)\]\s*(.*)', line)
            if progress:
                self.state.update(current=int(progress[1]), total=int(progress[2]),
                                  message=progress[3])
            if line.startswith('{'):
                try:
                    summary = json.loads(line)
                    if isinstance(summary, dict) and 'output' in summary and 'success' in summary:
                        for key in ('output', 'flat_output', 'success', 'failed', 'before',
                                    'after', 'saved_percent'):
                            if key in summary:
                                self.state[key] = summary[key]
                except ValueError:
                    pass

    def execute(self, command: list) -> int:
        environment = dict(os.environ, PYTHONIOENCODING='utf-8', PYTHONUNBUFFERED='1')
        options = {'start_new_session': True} if os.name != 'nt' else {
            'creationflags': subprocess.CREATE_NEW_PROCESS_GROUP
        }
        with self.lock:
            if self.cancelled.is_set():
                return -1
            self.process = subprocess.Popen(command, stdout=subprocess.PIPE,
                                            stderr=subprocess.STDOUT, text=True,
                                            encoding='utf-8', errors='replace', env=environment,
                                            **options)
            process = self.process
        try:
            for line in process.stdout:
                self.log(line.rstrip())
            return process.wait()
        finally:
            process.stdout.close()
            with self.lock:
                self.process = None

    def run(self, source: Path, output: Path, profile: str, flat: bool) -> None:
        try:
            setup = self.execute([sys.executable, '-u', str(ROOT / 'start.py'), '--setup-only'])
            if self.cancelled.is_set():
                self.update(status='cancelled', message='任务已停止，已完成的图片会保留')
                return
            if setup:
                raise RuntimeError('运行环境准备失败，请查看日志；首次安装需要联网')
            python = ROOT / '.runtime' / ('Scripts/python.exe' if os.name == 'nt' else 'bin/python')
            command = [str(python), '-u', str(ROOT / 'compress.py'), str(source),
                       '-o', str(output), '--profile', profile]
            if flat:
                command.append('--flat')
            self.update(status='running', message='正在读取图片并压缩，请稍候')
            code = self.execute(command)
            state = self.snapshot()
            if self.cancelled.is_set():
                self.update(status='cancelled', message='任务已停止，已完成的图片会保留')
            elif code == 0 or state['success'] + state['failed'] > 0:
                self.update(status='done', message=f'处理完成：成功 {state["success"]} 张，失败 {state["failed"]} 张')
            else:
                raise RuntimeError('压缩未完成，请查看日志中的原因')
        except Exception as error:
            self.log(str(error))
            self.update(status='error', message=str(error))

    def cancel(self) -> None:
        with self.lock:
            if self.state['status'] not in {'setup', 'running', 'stopping'}:
                return
            self.cancelled.set()
            self.state.update(status='stopping', message='正在停止任务……')
            process = self.process
        if process is not None and process.poll() is None:
            try:
                if os.name == 'nt':
                    subprocess.run(['taskkill', '/PID', str(process.pid), '/T', '/F'],
                                   capture_output=True, timeout=10)
                else:
                    os.killpg(process.pid, signal.SIGTERM)
            except (OSError, subprocess.TimeoutExpired):
                pass


class GuiServer(ThreadingHTTPServer):
    daemon_threads = True

    def __init__(self, address):
        self.token = secrets.token_urlsafe(32)
        self.jobs = JobManager()
        super().__init__(address, Handler)


class Handler(BaseHTTPRequestHandler):
    def log_message(self, *_args):
        pass

    def allowed_host(self) -> bool:
        port = self.server.server_port
        return self.headers.get('Host') in {f'127.0.0.1:{port}', f'localhost:{port}'}

    def authorized(self) -> bool:
        if not self.allowed_host():
            return False
        origin = self.headers.get('Origin')
        if origin and origin not in {f'http://127.0.0.1:{self.server.server_port}',
                                     f'http://localhost:{self.server.server_port}'}:
            return False
        return hmac.compare_digest(self.headers.get('Authorization', '').encode('utf-8'),
                                   ('Bearer ' + self.server.token).encode('utf-8'))

    def respond(self, status: int, data, content_type='application/json; charset=utf-8') -> None:
        body = data if isinstance(data, bytes) else json.dumps(data, ensure_ascii=False).encode('utf-8')
        self.send_response(status)
        self.send_header('Content-Type', content_type)
        self.send_header('Content-Length', str(len(body)))
        self.send_header('Cache-Control', 'no-store')
        self.send_header('X-Content-Type-Options', 'nosniff')
        self.send_header('X-Frame-Options', 'DENY')
        self.send_header('Referrer-Policy', 'no-referrer')
        self.send_header('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; frame-ancestors 'none'")
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self):
        from urllib.parse import parse_qs, urlsplit
        path = urlsplit(self.path)
        if not self.allowed_host():
            self.respond(403, {'error': 'Forbidden'})
            return
        if path.path in {'/', '/gui.js'}:
            filename = 'gui.html' if path.path == '/' else 'gui.js'
            mime = 'text/html; charset=utf-8' if filename.endswith('.html') else 'text/javascript; charset=utf-8'
            self.respond(200, (ROOT / filename).read_bytes(), mime)
            return
        if not self.authorized():
            self.respond(403, {'error': '请从启动器打开完整的界面地址'})
            return
        try:
            if path.path == '/api/state':
                self.respond(200, self.server.jobs.snapshot())
            elif path.path == '/api/browse':
                self.respond(200, browse_directory(parse_qs(path.query).get('path', [''])[0]))
            else:
                self.respond(404, {'error': 'Not found'})
        except (OSError, ValueError) as error:
            self.respond(400, {'error': str(error)})

    def do_POST(self):
        if not self.authorized():
            self.respond(403, {'error': 'Unauthorized'})
            return
        try:
            size = int(self.headers.get('Content-Length', 0))
            if size < 0 or size > 16384:
                raise ValueError('请求过大')
            data = json.loads(self.rfile.read(size) or b'{}')
            if not isinstance(data, dict):
                raise ValueError('无效请求')
            if self.path == '/api/start':
                self.server.jobs.start(data)
            elif self.path == '/api/cancel':
                self.server.jobs.cancel()
            elif self.path == '/api/open':
                state = self.server.jobs.snapshot()
                if data.get('kind') not in {'output', 'flat_output'}:
                    raise ValueError('无效的结果目录')
                path = state.get(data['kind'])
                if not path or not Path(path).is_dir():
                    raise ValueError('结果目录尚未生成')
                if os.name == 'nt':
                    os.startfile(path)
                else:
                    subprocess.Popen(['open' if sys.platform == 'darwin' else 'xdg-open', path])
            elif self.path == '/api/exit':
                if self.server.jobs.snapshot()['status'] in {'setup', 'running', 'stopping'}:
                    raise ValueError('请先停止正在运行的任务')
                threading.Thread(target=self.server.shutdown, daemon=True).start()
            else:
                self.respond(404, {'error': 'Not found'})
                return
            self.respond(200, {'ok': True})
        except (OSError, ValueError) as error:
            self.respond(400, {'error': str(error)})


def launch(open_browser=True, port=0) -> int:
    server = GuiServer(('127.0.0.1', port))
    url = f'http://127.0.0.1:{server.server_port}/#{server.token}'
    print(f'图片压缩界面：{url}', flush=True)
    print('关闭工具请点击界面上的“退出工具”，或在此窗口按 Ctrl+C。', flush=True)
    if open_browser:
        webbrowser.open(url)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        server.jobs.cancel()
    finally:
        server.server_close()
    return 0


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--no-browser', action='store_true')
    parser.add_argument('--port', type=int, default=0)
    arguments = parser.parse_args()
    sys.exit(launch(not arguments.no_browser, arguments.port))
