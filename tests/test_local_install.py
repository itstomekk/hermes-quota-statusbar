import json
import os
from pathlib import Path
import tempfile
import unittest

from scripts.install_local import HEADER, deploy_local, restore_local


class LocalInstallTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.home = self.root / 'home'
        self.package = self.home / 'plugins' / 'provider-usage'
        (self.package / 'desktop').mkdir(parents=True)
        (self.package / 'dashboard').mkdir()
        (self.package / 'desktop' / 'plugin.js').write_bytes(b'export default {};\n')
        (self.package / 'dashboard' / 'plugin_api.py').write_bytes(b'# customized backend\n')
        self.runtime = self.home / 'desktop-plugins' / 'provider-usage'
        self.runtime.mkdir(parents=True)
        (self.runtime / 'plugin.js').write_bytes(b'old runtime')
        (self.runtime / '.hermes-package.json').write_text('{"package":"provider-usage"}')

    def test_install_detaches_and_verifies_backup(self):
        bundle = deploy_local(self.home, self.package)
        self.assertEqual((self.runtime / 'plugin.js').read_bytes(), HEADER + (self.package / 'desktop' / 'plugin.js').read_bytes())
        self.assertFalse((self.runtime / '.hermes-package.json').exists())
        self.assertTrue((bundle / 'previous-package-marker.json').exists())
        self.assertEqual((bundle / 'previous-runtime.js').read_bytes(), b'old runtime')
        self.assertTrue((bundle / 'manifest.json').exists())

    def test_restore_after_missing_files_and_upstream_replacement(self):
        bundle = deploy_local(self.home, self.package)
        (self.runtime / 'plugin.js').unlink()
        (self.package / 'desktop' / 'plugin.js').write_bytes(b'upstream replacement')
        (self.package / 'dashboard' / 'plugin_api.py').unlink()
        restore_local(self.home, bundle)
        self.assertEqual((self.runtime / 'plugin.js').read_bytes(), HEADER + b'export default {};\n')
        self.assertEqual((self.package / 'dashboard' / 'plugin_api.py').read_bytes(), b'# customized backend\n')

    def test_corrupt_backup_refused_before_any_write(self):
        bundle = deploy_local(self.home, self.package)
        before = (self.runtime / 'plugin.js').read_bytes()
        (bundle / 'files' / 'desktop' / 'plugin.js').write_bytes(b'corrupted backup')
        with self.assertRaises(ValueError):
            restore_local(self.home, bundle)
        self.assertEqual((self.runtime / 'plugin.js').read_bytes(), before)


if __name__ == '__main__':
    unittest.main()
