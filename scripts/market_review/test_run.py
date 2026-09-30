import unittest
from unittest.mock import patch
from types import SimpleNamespace

from run import main


class RunTests(unittest.TestCase):
    @patch('run.subprocess.run')
    def test_successful_collection_builds_and_deploys(self, execute):
        execute.side_effect = [SimpleNamespace(returncode=0), SimpleNamespace(returncode=0)]
        self.assertEqual(main(['--end', '2026-09-29']), 0)
        self.assertEqual(execute.call_count, 2)
        self.assertEqual(execute.call_args_list[1].args[0],
                         ['npm', 'run', 'deploy:mac-build-server'])

    @patch('run.subprocess.run')
    def test_failed_collection_does_not_deploy(self, execute):
        execute.return_value = SimpleNamespace(returncode=1)
        self.assertEqual(main([]), 1)
        execute.assert_called_once()

    @patch('run.subprocess.run')
    def test_custom_output_does_not_replace_production_dashboard(self, execute):
        execute.return_value = SimpleNamespace(returncode=0)
        self.assertEqual(main(['--output', '/tmp/review.json']), 0)
        execute.assert_called_once()


if __name__ == '__main__':
    unittest.main()
