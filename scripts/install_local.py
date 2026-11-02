"""Optional helper: install this fork's desktop UI and keep a checksummed recovery bundle.

Copies desktop/plugin.js into <hermes home>/desktop-plugins/provider-usage/plugin.js
(with a one-line "local override" header) and writes a backup bundle under
<hermes home>/backups/provider-usage/ that `--restore` can put back.
No scheduler, auth/config modification, backend reload, or gateway restart.

Hermes home is --home, else $HERMES_HOME, else %LOCALAPPDATA%/hermes on Windows,
else ~/.hermes.
"""
import argparse
from datetime import datetime, timezone
import hashlib
import json
import os
from pathlib import Path
import shutil
from uuid import uuid4

HEADER = b'// User-local Provider Usage override. Keep standalone; do not adopt as a package copy.\n'
FILES = (
    'desktop/plugin.js', 'dashboard/plugin_api.py', 'dashboard/manifest.json',
    '__init__.py', 'plugin.yaml', 'README.md',
    'tests/test_compact_usage.cjs', 'tests/test_desktop_setup.cjs',
    'tests/test_provider_usage.py', 'tests/test_hermes_oauth_fallback.py',
    'tests/test_local_install.py', 'tests/test_update_protection.mjs',
    'tests/test_codex_limit_fallback.py',
    'scripts/install_local.py',
)


def digest(data):
    return hashlib.sha256(data).hexdigest()


def atomic_write(path, data):
    path.parent.mkdir(parents=True, exist_ok=True)
    staged = path.with_name(path.name + '.installing-' + uuid4().hex)
    try:
        staged.write_bytes(data)
        os.replace(staged, path)
    finally:
        staged.unlink(missing_ok=True)
    if path.read_bytes() != data:
        raise RuntimeError('Installed bytes failed verification: ' + str(path))


def detach_marker(runtime, archive):
    marker = runtime / '.hermes-package.json'
    if marker.exists():
        archive.mkdir(parents=True, exist_ok=True)
        marker.rename(archive / ('previous-package-marker-' + uuid4().hex + '.json'))


def deploy_local(home, package):
    home, package = Path(home), Path(package)
    bundle = home / 'backups' / 'provider-usage' / (datetime.now(timezone.utc).strftime('%Y%m%dT%H%M%SZ') + '-local-' + uuid4().hex[:8])
    bundle.mkdir(parents=True)
    hashes = {}
    for rel in FILES:
        source = package / rel
        if source.is_file():
            data = source.read_bytes()
            atomic_write(bundle / 'files' / rel, data)
            hashes[rel] = digest(data)
    if 'desktop/plugin.js' not in hashes:
        raise ValueError('No desktop entry point')
    runtime = home / 'desktop-plugins' / 'provider-usage'
    if (runtime / 'plugin.js').exists():
        shutil.copy2(runtime / 'plugin.js', bundle / 'previous-runtime.js')
    marker = runtime / '.hermes-package.json'
    if marker.exists():
        shutil.copy2(marker, bundle / 'previous-package-marker.json')
    data = HEADER + (bundle / 'files' / 'desktop' / 'plugin.js').read_bytes()
    atomic_write(bundle / 'manifest.json', json.dumps({'files': hashes, 'installed_sha256': digest(data)}, indent=2).encode())
    shutil.copy2(__file__, bundle / 'restore.py')
    atomic_write(runtime / 'plugin.js', data)
    detach_marker(runtime, bundle)
    return bundle


def restore_local(home, bundle):
    home, bundle = Path(home), Path(bundle)
    manifest = json.loads((bundle / 'manifest.json').read_text())
    files = {}
    for rel, expected in manifest['files'].items():
        if rel not in FILES:
            raise ValueError('Unexpected recovery path: ' + rel)
        data = (bundle / 'files' / rel).read_bytes()
        if digest(data) != expected:
            raise ValueError('Corrupt backup: ' + rel)
        files[rel] = data
    installed = HEADER + files['desktop/plugin.js']
    if digest(installed) != manifest['installed_sha256']:
        raise ValueError('Corrupt installed checksum')
    # Verify the whole bundle before replacing any target.
    package = home / 'plugins' / 'provider-usage'
    recovery = home / 'backups' / 'provider-usage' / ('pre-restore-' + uuid4().hex)
    for rel, data in files.items():
        target = package / rel
        if target.exists() and target.read_bytes() != data:
            atomic_write(recovery / 'package' / rel, target.read_bytes())
        atomic_write(target, data)
    runtime = home / 'desktop-plugins' / 'provider-usage'
    if (runtime / 'plugin.js').exists():
        atomic_write(recovery / 'runtime.js', (runtime / 'plugin.js').read_bytes())
    atomic_write(runtime / 'plugin.js', installed)
    detach_marker(runtime, recovery)


def default_home():
    if os.environ.get('HERMES_HOME'):
        return Path(os.environ['HERMES_HOME'])
    if os.environ.get('LOCALAPPDATA'):
        return Path(os.environ['LOCALAPPDATA']) / 'hermes'
    return Path.home() / '.hermes'


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--home', type=Path, default=default_home())
    parser.add_argument('--restore', type=Path, help='Recovery bundle directory')
    args = parser.parse_args()
    if args.restore:
        restore_local(args.home, args.restore)
        print('Restored and verified. Backend restoration may need a separately approved restart.')
    else:
        print('Recovery bundle:', deploy_local(args.home, Path(__file__).resolve().parents[1]))
