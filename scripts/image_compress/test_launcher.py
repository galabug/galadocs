import contextlib
import io
import sys
import unittest
from unittest.mock import patch

import start


class LauncherTests(unittest.TestCase):
    def test_python27_launcher_finds_python3_on_path(self):
        with patch.object(start.sys, 'version_info', (2, 7, 18)), \
                patch.object(start, 'find_executable', side_effect=lambda name: '/python3' if name == 'python3' else None), \
                patch.object(start.subprocess, 'call', return_value=0) as call:
            self.assertEqual(start.find_python3(), ['/python3'])
        self.assertIn('sys.version_info >= (3, 7)', call.call_args[0][0][-1])

    def test_python37_is_accepted_as_engine(self):
        with patch.object(start.sys, 'version_info', (3, 7, 17)), \
                patch.object(start, 'find_executable', return_value=None), \
                patch.object(start.subprocess, 'call', return_value=0):
            self.assertEqual(start.find_python3(), [sys.executable])

    def test_missing_python3_is_reported_without_running_engine(self):
        output = io.StringIO()
        with patch.object(start, 'find_python3', return_value=None), \
                patch.object(start.subprocess, 'call') as call, contextlib.redirect_stderr(output):
            self.assertEqual(start.main(), 1)
        call.assert_not_called()
        self.assertIn('launcher supports Python 2.7', output.getvalue())
        self.assertIn('Python 3', output.getvalue())

    def test_paths_with_spaces_and_unicode_are_forwarded_as_arguments(self):
        arguments = ['start.py', '/中文目录/图片 文件.png', '-o', '/结果 目录', '--profile', 'gentle']
        with patch.object(start, 'find_python3', return_value=[sys.executable]), \
                patch.object(start.sys, 'argv', arguments), \
                patch.object(start.subprocess, 'call', return_value=7) as call:
            self.assertEqual(start.main(), 7)
        forwarded = call.call_args[0][0]
        self.assertTrue(forwarded[1].endswith('start_modern.py'))
        self.assertEqual(forwarded[2:], arguments[1:])
        self.assertNotIn('shell', call.call_args[1])


if __name__ == '__main__':
    unittest.main()
