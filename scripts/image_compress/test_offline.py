import contextlib
import io
import os
from pathlib import Path
import tempfile
import unittest
from unittest.mock import Mock, patch

import prepare_offline
import start_modern
from package import build_package


class OfflineTests(unittest.TestCase):
    def test_target_markers_are_not_evaluated_against_download_host(self):
        self.assertEqual(prepare_offline.requirements_for('requirements.txt', (3, 7)),
                         ['Pillow==9.5.0', 'numpy==1.21.6'])
        self.assertEqual(prepare_offline.requirements_for('requirements.txt', (3, 12)),
                         ['Pillow>=11.3.0,<12', 'numpy>=2.0.2,<3'])

    def test_missing_offline_directory_fails_without_network(self):
        with tempfile.TemporaryDirectory() as folder, patch.dict(os.environ, {
                'IMAGE_COMPRESS_OFFLINE': '1', 'IMAGE_COMPRESS_WHEEL_DIR': folder + '/missing'}):
            with self.assertRaisesRegex(RuntimeError, 'prepare_offline.py'):
                start_modern.dependency_source()

    def test_first_install_and_reuse_are_offline(self):
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder)
            (root / 'wheels').mkdir()
            for filename in ('requirements.txt', 'requirements-advanced.txt'):
                (root / filename).write_bytes((start_modern.ROOT / filename).read_bytes())
            def create(environment):
                python = environment / ('Scripts/python.exe' if os.name == 'nt' else 'bin/python')
                python.parent.mkdir(parents=True)
                python.write_bytes(b'fake interpreter')
            environment = dict(os.environ)
            for name in ('IMAGE_COMPRESS_OFFLINE', 'IMAGE_COMPRESS_WHEEL_DIR'):
                environment.pop(name, None)
            environment['PIP_FIND_LINKS'] = 'https://example.invalid/should-not-be-used'
            with patch.object(start_modern, 'ROOT', root), \
                    patch.dict(os.environ, environment, clear=True), \
                    patch.object(start_modern.venv, 'EnvBuilder') as builder, \
                    patch.object(start_modern.subprocess, 'run', return_value=Mock(returncode=0)) as run, \
                    contextlib.redirect_stdout(io.StringIO()):
                builder.return_value.create.side_effect = create
                start_modern.runtime_python()
                installs = [call for call in run.call_args_list if 'install' in call[0][0]]
                self.assertTrue(installs)
                for call in installs:
                    self.assertIn('--no-index', call[0][0])
                    self.assertIn(str((root / 'wheels').resolve()), call[0][0])
                    self.assertEqual(call[1]['env']['PIP_CONFIG_FILE'], os.devnull)
                    self.assertNotIn('PIP_FIND_LINKS', call[1]['env'])
                run.reset_mock()
                start_modern.runtime_python()
                self.assertEqual(run.call_count, 1)  # Local import probe; no pip calls.

    def test_portable_package_includes_offline_dependencies(self):
        import zipfile
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder)
            wheels = root / 'wheels'
            wheels.mkdir()
            (wheels / 'example.whl').write_bytes(b'wheel')
            (wheels / 'offline-info.json').write_text('{}')
            target = root / 'offline.zip'
            build_package(target, wheels)
            with zipfile.ZipFile(target) as archive:
                self.assertEqual(archive.read('ImageCompressor/wheels/example.whl'), b'wheel')
                self.assertIn('ImageCompressor/prepare_offline.py', archive.namelist())


if __name__ == '__main__':
    unittest.main()
