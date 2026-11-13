import os
from pathlib import Path
import subprocess
import tempfile
import unittest


STARTUP = Path(__file__).with_name('startup.sh')
PROJECT = 'ari'


class CheckoutTests(unittest.TestCase):
    def test_startup_clones_github_and_preserves_existing_work(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            home = root / 'home'
            home.mkdir()
            source = root / 'source'
            subprocess.run(['git', 'init', '-q', '-b', 'main', str(source)], check=True)
            (source / 'tracked').write_text('committed\n')
            subprocess.run(['git', '-C', str(source), 'add', '.'], check=True)
            subprocess.run(['git', '-C', str(source), '-c', 'user.name=Test',
                            '-c', 'user.email=test@example.invalid', 'commit', '-qm', 'Fixture'], check=True)
            config = root / 'gitconfig'
            url = f'https://github.com/foxberry-dev/{PROJECT}.git'
            config.write_text(f'[url "{source}"]\n\tinsteadOf = {url}\n')
            environment = dict(os.environ, HOME=str(home), GIT_CONFIG_GLOBAL=str(config),
                               GIT_CONFIG_NOSYSTEM='1')
            script = STARTUP.read_text().split('export PATH=', 1)[0]
            checkout = home / PROJECT

            def start():
                return subprocess.run(['bash', '-c', script], env=environment, capture_output=True)

            self.assertEqual(start().returncode, 0)
            self.assertEqual((checkout / 'tracked').read_text(), 'committed\n')
            origin = subprocess.check_output(['git', '-C', str(checkout), 'config', '--get',
                                              'remote.origin.url'], env=environment, text=True)
            self.assertEqual(origin.strip(), url)
            (checkout / 'tracked').write_text('local edit\n')
            (checkout / 'untracked').write_text('local file\n')
            config.unlink()
            self.assertEqual(start().returncode, 0)
            self.assertEqual((checkout / 'tracked').read_text(), 'local edit\n')
            self.assertEqual((checkout / 'untracked').read_text(), 'local file\n')

    def test_startup_preserves_non_repository_files(self):
        with tempfile.TemporaryDirectory() as directory:
            checkout = Path(directory) / PROJECT
            checkout.mkdir()
            (checkout / 'keep').write_text('important\n')
            environment = dict(os.environ, HOME=directory)
            script = STARTUP.read_text().split('export PATH=', 1)[0]
            result = subprocess.run(['bash', '-c', script], env=environment, capture_output=True)
            self.assertNotEqual(result.returncode, 0)
            self.assertEqual((checkout / 'keep').read_text(), 'important\n')
            self.assertFalse((checkout / '.git').exists())


if __name__ == '__main__':
    unittest.main()
