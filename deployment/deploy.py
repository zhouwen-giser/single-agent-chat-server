#!/usr/bin/env python3
"""Owns only sacs-dev resources. Never prints private command output."""
import argparse
import fcntl
import hashlib
import ipaddress
import json
import os
from pathlib import Path
import secrets
import shutil
import socket
import subprocess
import sys
import time


def run(args, *, env=None, timeout=300, data=None):
    result = subprocess.run(args, input=data, stdout=subprocess.PIPE,
                            stderr=subprocess.PIPE, env=env, timeout=timeout)
    if result.returncode:
        raise RuntimeError("Command failed: " + args[0] + " (private output suppressed)")
    return result.stdout


def digest(path):
    checksum = hashlib.sha256()
    with path.open('rb') as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b''):
            checksum.update(chunk)
    return checksum.hexdigest()


def verify(package):
    names = set()
    for line in (package / 'SHA256SUMS').read_text().splitlines():
        expected, name = line.split('  ', 1)
        if Path(name).name != name or name in names or (package / name).is_symlink():
            raise RuntimeError('Invalid package manifest')
        if digest(package / name) != expected:
            raise RuntimeError('Package checksum mismatch: ' + name)
        names.add(name)
    if names != {p.name for p in package.iterdir()} - {'SHA256SUMS'}:
        raise RuntimeError('Unexpected package content')
    required = {'manifest.json', 'images.tar', 'compose.yaml', 'deploy.py', 'deploy.sh',
                'preflight.mjs', 'runtime.defaults.json', '.env.example', 'README.md'}
    if names != required:
        raise RuntimeError('Incomplete package')
    return json.loads((package / 'manifest.json').read_text())


def write_private(path, text):
    temp = path.with_suffix(path.suffix + '.next')
    with temp.open('w') as stream:
        os.chmod(temp, 0o600)
        stream.write(text)
    temp.replace(path)


def write_env(path, config):
    lines = []
    for key, value in config.items():
        value = str(value)
        if '\n' in value or '\r' in value or '\x00' in value:
            raise RuntimeError('Environment value must be single-line: ' + key)
        lines.append(key + "='" + value.replace('\\', '\\\\').replace("'", "\\'") + "'")
    write_private(path, '\n'.join(lines) + '\n')


def compose(package, shared, manifest, args):
    env = dict(os.environ, SACS_IMAGE=manifest['image'],
               SACS_POSTGRES_IMAGE=manifest['postgresImage'],
               SACS_RUNTIME_ENV=str(shared / 'runtime.env'),
               SACS_PG_ENV=str(shared / 'postgres.env'),
               SACS_BIND_IP=args.bind, SACS_PORT=str(args.port))
    command = ['docker', 'compose', '--project-directory', str(package), '-p', 'sacs-dev',
               '-f', str(package / 'compose.yaml')]
    return lambda *argv, **kwargs: run(command + list(argv), env=env, **kwargs)


def private_configuration(shared, defaults, model_container):
    path = shared / 'runtime.json'
    if path.exists():
        config = json.loads(path.read_text())
    else:
        inspected = json.loads(run(['docker', 'inspect', model_container]))[0]
        source = dict(item.split('=', 1) for item in inspected['Config']['Env'])
        if not all(source.get(key) for key in ['MODEL_NAME', 'MODEL_BASE_URL']):
            raise RuntimeError('Existing model configuration incomplete')
        config = dict(defaults)
        password = secrets.token_hex(32)
        config.update({
            'NODE_ENV': 'production', 'SACS_AUTH_MODE': 'development-anonymous',
            'SACS_ALLOW_INSECURE_ANONYMOUS': 'true',
            'CHAT_SERVER_SERVICE_KEY': secrets.token_hex(32),
            'AG_UI_SERVICE_KEY': secrets.token_hex(32),
            'OPENWEBUI_USER_JWT_SECRET': secrets.token_hex(32),
            'CHAT_SERVER_HOST': '0.0.0.0', 'CHAT_SERVER_PORT': '3000',
            'CHAT_SERVER_REQUEST_TIMEOUT_MS': '120000',
            'CHAT_HTTP_STREAM_BUDGET_MS': '120000',
            'POSTGRES_USER': 'sacs', 'POSTGRES_DB': 'sacs', 'POSTGRES_PASSWORD': password,
            'DATABASE_URL': 'postgresql://sacs:' + password + '@postgres:5432/sacs',
            'WSGS_BASE_URL': 'http://17.26.1.20:18082',
            'WSGS_OPERATION_TIMEOUT_MS': '120000',
            'SACS_WSGS_ANALYSIS_ENABLED': 'true',
            'SACS_WSGS_ANALYSIS_POLL_INTERVAL_MS': '1000',
            'SACS_WSGS_ANALYSIS_MAX_WAIT_MS': '120000',
            'SDAR_A2A_BASE_URL': 'http://17.26.1.20:10999',
            'CONVERSATION_MODEL_BASE_URL': source['MODEL_BASE_URL'],
            'CONVERSATION_MODEL_NAME': source['MODEL_NAME'],
            'CONVERSATION_MODEL_API_KEY': source.get('MODEL_API_KEY', ''),
            'CONVERSATION_MODEL_TIMEOUT_MS': '120000',
        })
        write_private(path, json.dumps(config, indent=2) + '\n')
    # Existing operator settings and credentials always win; no automatic rotation.
    write_env(shared / 'runtime.env', config)
    write_env(shared / 'postgres.env', {k: config[k] for k in ['POSTGRES_USER', 'POSTGRES_DB', 'POSTGRES_PASSWORD']})


def db_versions(comp):
    sql = 'SELECT version,checksum FROM chat_service.schema_migrations ORDER BY version'
    raw = comp('exec', '-T', 'postgres', 'psql', '-X', '-U', 'sacs', '-d', 'sacs', '-At', '-F', '|', '-c', sql)
    return dict(line.split('|', 1) for line in raw.decode().splitlines())


def ready(comp):
    # /ready performs a real model probe. Do it once, not every health interval.
    check = "const r=await fetch('http://127.0.0.1:3000/ready',{signal:AbortSignal.timeout(150000)});if(!r.ok)process.exit(1);console.log('readiness PASS');"
    comp('exec', '-T', 'server', 'node', '--input-type=module', '-e', check, timeout=180)


def assert_rollback_compatible(current, target, applied):
    # No down migration: only an exact schema set is allowed for automatic rollback.
    if current['migrations'] != target['migrations'] or applied != target['migrations']:
        raise RuntimeError('Rollback refused: schema differs; restore requires separate operator approval')


def point(link, destination):
    temp = link.with_name(link.name + '.next')
    if temp.is_symlink():
        temp.unlink()
    temp.symlink_to(destination)
    temp.replace(link)


def check_port(bind, port):
    existing = run(['docker', 'ps', '-q', '--filter', 'label=com.docker.compose.project=sacs-dev', '--filter', 'label=com.docker.compose.service=server']).decode().split()
    if existing:
        inspected = json.loads(run(['docker', 'inspect', *existing]))
        for container in inspected:
            ports = container.get('NetworkSettings', {}).get('Ports', {}).get('3000/tcp') or []
            if any(p['HostIp'] == bind and p['HostPort'] == str(port) for p in ports):
                return
    # An existing SACS on another port is not proof that this target is free.
    with socket.socket() as probe:
        probe.bind((bind, port))


def receipt(shared, manifest, release, args):
    write_private(shared / 'deployment-receipt.json', json.dumps({
        'status': 'READY', 'sourceSha': manifest['sourceSha'], 'imageId': manifest['imageId'],
        'release': str(release), 'endpoint': f'http://{args.bind}:{args.port}',
        'businessAcceptance': 'NOT_RUN', 'timestamp': time.time(),
    }, indent=2) + '\n')


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('action', choices=['preflight', 'install', 'status', 'rollback'])
    parser.add_argument('--root', default='/mnt/data/sacs-live')
    parser.add_argument('--bind', default='17.26.1.20')
    parser.add_argument('--port', type=int, default=18083)
    parser.add_argument('--model-container', default='wsgs-dev-grounding-api-1')
    args = parser.parse_args()
    os.umask(0o077)
    ipaddress.ip_address(args.bind)
    if not 1024 <= args.port <= 65535:
        raise RuntimeError('Invalid port')
    root = Path(args.root).resolve()
    if root in (Path('/'), Path('/mnt'), Path('/mnt/data'), Path.home()):
        raise RuntimeError('Unsafe deployment root')
    package = Path(__file__).resolve().parent
    manifest = verify(package)
    run(['docker', 'info'])
    run(['docker', 'compose', 'version'])
    root.mkdir(parents=True, exist_ok=True)
    with (root / 'deploy.lock').open('a') as lock:
        fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        shared = root / 'shared'
        shared.mkdir(exist_ok=True, mode=0o700)
        current = root / 'current'
        if args.action in ('status', 'rollback'):
            if not current.is_symlink():
                raise RuntimeError('No successful release')
            package = current.resolve()
            manifest = verify(package)
            comp = compose(package, shared, manifest, args)
            if args.action == 'status':
                print(comp('ps').decode())
                return
            previous = root / 'previous'
            if not previous.is_symlink():
                raise RuntimeError('No previous release')
            target = previous.resolve()
            target_manifest = verify(target)
            assert_rollback_compatible(manifest, target_manifest, db_versions(comp))
            old_comp = compose(target, shared, target_manifest, args)
            old_comp('up', '-d', '--no-deps', '--wait', '--wait-timeout', '240', 'server')
            ready(old_comp)
            point(previous, package)
            point(current, target)
            receipt(shared, target_manifest, target, args)
            print('Application rollback complete; database unchanged.')
            return
        # Refuse a foreign port owner before touching any containers.
        check_port(args.bind, args.port)
        if shutil.disk_usage(root).free < (package / 'images.tar').stat().st_size * 2 + 1024**3:
            raise RuntimeError('Insufficient free disk space')
        private_configuration(shared, json.loads((package / 'runtime.defaults.json').read_text()), args.model_container)
        print('Loading verified images (only SACS and its dedicated PostgreSQL).', flush=True)
        run(['docker', 'load', '-i', str(package / 'images.tar')], timeout=600)
        for tag, expected in [(manifest['image'], manifest['imageId']), (manifest['postgresImage'], manifest['postgresImageId'])]:
            actual = json.loads(run(['docker', 'image', 'inspect', tag]))[0]['Id']
            if actual != expected:
                raise RuntimeError('Image identity mismatch')
        comp = compose(package, shared, manifest, args)
        comp('config', '--quiet')
        # Candidate config, contract and upstream checks without starting a database/task.
        comp('run', '--rm', '--no-deps', '-v', str(package / 'preflight.mjs') + ':/app/preflight.mjs:ro',
             'server', 'node', '/app/preflight.mjs', timeout=180)
        print('Configuration, WSGS 1.2 and SDAR Agent Card preflight PASS.', flush=True)
        if args.action == 'preflight':
            return
        release = root / 'releases' / digest(package / 'SHA256SUMS')[:16]
        if not release.exists():
            shutil.copytree(package, release)
        verify(release)
        comp = compose(release, shared, manifest, args)
        old = current.resolve() if current.is_symlink() else None
        if old:
            backup = shared / ('backup-' + str(time.time_ns()) + '.dump')
            write_private(backup.with_suffix('.json'), json.dumps({'release': str(old), 'createdAt': time.time()}))
            with backup.open('wb') as stream:
                stream.write(comp('exec', '-T', 'postgres', 'pg_dump', '-U', 'sacs', '-d', 'sacs', '-Fc'))
        comp('up', '-d', '--wait', '--wait-timeout', '120', 'postgres')
        migrate = "import {setupPersistence,parsePersistenceConfig} from './dist/packages/persistence/src/index.js';const p=await setupPersistence(parsePersistenceConfig(process.env));await p.close();"
        comp('run', '--rm', '--no-deps', 'server', 'node', '--input-type=module', '-e', migrate)
        try:
            comp('up', '-d', '--no-deps', '--wait', '--wait-timeout', '240', 'server', timeout=300)
            ready(comp)
        except Exception:
            if old:
                old_manifest = verify(old)
                assert_rollback_compatible(manifest, old_manifest, db_versions(comp))
                compose(old, shared, old_manifest, args)('up', '-d', '--no-deps', '--wait', '--wait-timeout', '240', 'server')
            raise
        if old and old != release:
            point(root / 'previous', old)
        point(current, release)
        receipt(shared, manifest, release, args)
        print(f'SACS READY: http://{args.bind}:{args.port}; shared anonymous development access.')


if __name__ == '__main__':
    try:
        main()
    except Exception as error:
        # Never print arbitrary subprocess/config exceptions with sensitive values.
        print('Deployment stopped (' + type(error).__name__ + '); no upstream service was changed.', file=sys.stderr)
        sys.exit(1)
