import io
import zipfile
import json
from pathlib import Path
import tempfile
import threading
import unittest
from unittest.mock import Mock, patch
from urllib.error import HTTPError
from urllib.request import Request, urlopen

from gui import GuiServer, ImportStore, JobManager, browse_directory, plan_output
import start_modern as start


class GuiTests(unittest.TestCase):
    def setUp(self):
        self.directory = tempfile.TemporaryDirectory()
        self.root = Path(self.directory.name)

    def tearDown(self):
        self.directory.cleanup()

    def test_output_validation_and_numbering(self):
        source = self.root / '原图'
        source.mkdir()
        target = self.root / '结果'
        target.mkdir()
        (target / '压缩图片').mkdir()
        self.assertEqual(plan_output(source, str(target), '压缩图片'), target.resolve() / '压缩图片-2')
        with self.assertRaises(ValueError):
            plan_output(source, str(source), 'inside')
        with self.assertRaises(ValueError):
            plan_output(source, str(target), '../escape')

    def test_browser_shows_folders_and_images_with_unicode_names(self):
        (self.root / '中文目录').mkdir()
        (self.root / '图片.png').write_bytes(b'image')
        (self.root / 'secret.txt').write_text('not listed')
        (self.root / '.hidden').mkdir()
        result = browse_directory(str(self.root))
        self.assertEqual([item['name'] for item in result['entries']], ['中文目录', '图片.png'])
        self.assertEqual(result['path'], str(self.root.resolve()))

    def test_progress_and_summary_are_delivered_to_ui(self):
        jobs = JobManager()
        jobs.log('[2/4] 卡片/图片.png: 60%')
        jobs.log(json.dumps({'output': '/result', 'flat_output': '/0000', 'success': 4,
                             'failed': 0, 'before': 1000, 'after': 400, 'saved_percent': 60}))
        jobs.log(json.dumps({'event': 'file', 'file': '卡片/图片.png', 'status': 'ok',
                             'before': 1000, 'after': 400, 'saved_percent': 60}))
        state = jobs.snapshot()
        self.assertEqual(state['items'][0]['after'], 400)
        state['items'][0]['after'] = 999
        self.assertEqual(jobs.snapshot()['items'][0]['after'], 400)
        self.assertEqual((state['current'], state['total']), (2, 4))
        self.assertEqual(state['flat_output'], '/0000')
        self.assertEqual(state['saved_percent'], 60)
        state['logs'].clear()
        self.assertTrue(jobs.snapshot()['logs'])

    def test_complete_job_reports_success(self):
        jobs = JobManager()
        output = self.root / 'result'
        def execute(command):
            if '--setup-only' not in command:
                jobs.log(json.dumps({'output': str(output), 'success': 1, 'failed': 0,
                                     'before': 100, 'after': 50, 'saved_percent': 50}))
            return 0
        with patch.object(jobs, 'execute', side_effect=execute):
            jobs.run(self.root / 'input.png', output, 'smart', True)
        self.assertEqual(jobs.snapshot()['status'], 'done')
        self.assertEqual(jobs.snapshot()['success'], 1)

    def test_cancellation_during_setup_does_not_start_compression(self):
        jobs = JobManager()
        def cancelled_setup(_command):
            jobs.cancelled.set()
            return -1
        with patch.object(jobs, 'execute', side_effect=cancelled_setup) as execute:
            jobs.run(self.root / 'input.png', self.root / 'output', 'smart', True)
        self.assertEqual(execute.call_count, 1)
        self.assertEqual(jobs.snapshot()['status'], 'cancelled')

    def test_setup_failure_is_visible(self):
        jobs = JobManager()
        with patch.object(jobs, 'execute', return_value=1):
            jobs.run(self.root / 'input.png', self.root / 'output', 'smart', True)
        self.assertEqual(jobs.snapshot()['status'], 'error')
        self.assertIn('准备失败', jobs.snapshot()['message'])

    def test_second_job_cannot_start_while_running(self):
        source = self.root / 'input.png'
        source.write_bytes(b'image')
        jobs = JobManager()
        jobs.update(status='running')
        with self.assertRaises(ValueError):
            jobs.start({'input': str(source)})

    def test_import_preserves_paths_and_rejects_partial_and_unsafe_uploads(self):
        store = ImportStore()
        try:
            identifier = store.create('相册')['import_id']
            for path in ('../escape.png', '/absolute.png', 'a/../b.png', 'a\\b.png', 'a.txt'):
                with self.assertRaises(ValueError):
                    store.write(identifier, path, io.BytesIO(b'x'), 1)
            with self.assertRaises(ValueError):
                store.source(identifier)
            with self.assertRaises(ValueError):
                store.write(identifier, 'partial.png', io.BytesIO(b'x'), 2)
            self.assertFalse((store.root / identifier / 'partial.png').exists())
            store.write(identifier, '横幅/图片.png', io.BytesIO(b'image'), 5)
            with self.assertRaises(FileExistsError):
                store.write(identifier, '横幅/图片.png', io.BytesIO(b'x'), 1)
            self.assertEqual(store.commit(identifier)['files'], 1)
            self.assertEqual((Path(store.source(identifier)) / '横幅/图片.png').read_bytes(), b'image')
            with self.assertRaises(ValueError):
                store.write(identifier, 'late.png', io.BytesIO(b'x'), 1)
        finally:
            store.cleanup()

    def test_default_launcher_opens_gui(self):
        with patch('sys.argv', ['start.py']), patch('gui.launch', return_value=0) as launch:
            self.assertEqual(start.main(), 0)
        launch.assert_called_once_with()


class GuiHttpTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.server = GuiServer(('127.0.0.1', 0))
        cls.thread = threading.Thread(target=cls.server.serve_forever, daemon=True)
        cls.thread.start()
        cls.url = f'http://127.0.0.1:{cls.server.server_port}'

    @classmethod
    def tearDownClass(cls):
        cls.server.shutdown()
        cls.server.server_close()
        cls.thread.join(timeout=5)

    def request(self, path, authenticated=True, data=None, **headers):
        if authenticated:
            headers['Authorization'] = 'Bearer ' + self.server.token
        body = json.dumps(data).encode() if data is not None else None
        return urlopen(Request(self.url + path, data=body, headers=headers), timeout=5)

    def test_ui_assets_are_self_contained_and_served(self):
        for path in ('/', '/gui.js'):
            with self.request(path, authenticated=False) as response:
                self.assertEqual(response.status, 200)
                self.assertTrue(response.read())
                self.assertEqual(response.headers['X-Frame-Options'], 'DENY')

    def test_api_requires_session_token(self):
        with self.assertRaises(HTTPError) as result:
            self.request('/api/state', authenticated=False)
        self.assertEqual(result.exception.code, 403)
        with self.request('/api/state') as response:
            self.assertEqual(json.load(response)['status'], 'idle')

    def test_foreign_origin_and_host_are_rejected(self):
        for headers in ({'Origin': 'https://example.com'}, {'Host': 'example.com'}):
            with self.assertRaises(HTTPError) as result:
                self.request('/api/state', **headers)
            self.assertEqual(result.exception.code, 403)

    def test_unauthorized_request_cannot_start_a_job(self):
        with patch.object(self.server.jobs, 'start') as start_job:
            with self.assertRaises(HTTPError) as result:
                self.request('/api/start', authenticated=False, data={'input': '/tmp'})
            self.assertEqual(result.exception.code, 403)
            start_job.assert_not_called()

    def test_browser_import_api_and_start_use_local_staging(self):
        from urllib.parse import urlencode
        with self.request('/api/import', data={'name': '产品'}) as response:
            session = json.load(response)
        route = '/api/import-file?' + urlencode({'session': session['import_id'], 'path': '横幅/图片.png'})
        request = Request(self.url + route, data=b'image', headers={'Authorization': 'Bearer ' + self.server.token})
        with urlopen(request, timeout=5) as response:
            self.assertEqual(response.status, 200)
        with self.request('/api/import-ready', data={'import_id': session['import_id']}) as response:
            self.assertEqual(json.load(response)['files'], 1)
        with patch.object(self.server.jobs, 'start') as start_job:
            with self.request('/api/start', data={'import_id': session['import_id']}) as response:
                self.assertEqual(response.status, 200)
            options = start_job.call_args[0][0]
            self.assertEqual((Path(options['input']) / '横幅/图片.png').read_bytes(), b'image')
            self.assertTrue(options['parent'].endswith('ImageCompressor'))

    def test_download_single_zip_and_invalid_paths(self):
        from urllib.parse import quote
        with tempfile.TemporaryDirectory() as folder:
            output = Path(folder)
            (output / '横幅').mkdir()
            (output / '横幅/图片.png').write_bytes(b'compressed')
            state = {'status': 'done', 'output': folder, 'items': [
                {'file': '横幅/图片.png', 'status': 'ok'}]}
            with patch.object(self.server.jobs, 'snapshot', return_value=state):
                with self.request('/api/download?file=' + quote('横幅/图片.png')) as response:
                    self.assertEqual(response.read(), b'compressed')
                    self.assertIn('filename*=', response.headers['Content-Disposition'])
                with self.request('/api/download-all') as response:
                    with zipfile.ZipFile(io.BytesIO(response.read())) as archive:
                        self.assertEqual(archive.read('横幅/图片.png'), b'compressed')
                for path in ('../escape.png', 'missing.png'):
                    with self.assertRaises(HTTPError):
                        self.request('/api/download?file=' + quote(path))
                with self.assertRaises(HTTPError):
                    self.request('/api/download-all', authenticated=False)

    def test_invalid_job_request_is_reported_without_stopping_server(self):
        with self.assertRaises(HTTPError) as result:
            self.request('/api/start', data={'input': ''})
        self.assertEqual(result.exception.code, 400)
        with self.request('/api/state') as response:
            self.assertEqual(response.status, 200)


if __name__ == '__main__':
    unittest.main()
