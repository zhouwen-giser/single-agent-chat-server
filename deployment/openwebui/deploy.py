#!/usr/bin/env python3
"""Install the independent Open WebUI entrance for the running SACS instance."""
import argparse
import fcntl
import json
import os
from pathlib import Path
import secrets
import socket
import subprocess

ROOT = Path('/mnt/data/openwebui-sacs-live')
TAG = 'ghcr.io/open-webui/open-webui:v0.11.3-slim'
ENDPOINT = 'http://17.26.1.20:18084'
LOCAL_ENDPOINT = 'http://127.0.0.1:18084'
BINDINGS = [('17.26.1.20', 18084), ('127.0.0.1', 18084)]
SACS_CONTAINER = 'sacs-dev-server-1'
SACS_NETWORK = 'sacs-dev_outbound'
SACS_URL = 'http://' + SACS_CONTAINER + ':3000/v1'


def run(args):
    return subprocess.check_output(args, stderr=subprocess.PIPE, text=True)


def private(path, content):
    temp = path.with_suffix('.next')
    with temp.open('w') as file:
        os.chmod(temp, 0o600)
        file.write(content)
    temp.replace(path)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('action', choices=['install', 'status'])
    parser.add_argument('--allow-anonymous', action='store_true')
    args = parser.parse_args()
    os.umask(0o077)
    ROOT.mkdir(exist_ok=True, parents=True, mode=0o700)
    shared = ROOT / 'shared'
    shared.mkdir(exist_ok=True, mode=0o700)
    with (ROOT / 'deploy.lock').open('a') as lock:
        fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        path = shared / 'settings.json'
        if not path.exists():
            if args.action != 'install':
                raise RuntimeError('Not installed')
            inspected = json.loads(run(['docker', 'image', 'inspect', TAG]))[0]
            digest = next(x for x in inspected['RepoDigests'] if x.startswith('ghcr.io/open-webui/open-webui@sha256:'))
            private(path, json.dumps({'image': digest, 'secret': secrets.token_hex(32)}, indent=2)+'\n')
        settings = json.loads(path.read_text())
        env = dict(os.environ, OPENWEBUI_IMAGE=settings['image'],
                   OPENWEBUI_ENV_FILE=str(shared / 'runtime.env'))
        command = ['docker', 'compose', '-p', 'openwebui-sacs', '-f', str(Path(__file__).with_name('compose.yaml'))]
        if args.action == 'status':
            print(subprocess.check_output(command+['ps'], env=env, text=True))
            return
        backend = json.loads(run(['docker', 'inspect', SACS_CONTAINER]))[0]
        if not backend.get('State', {}).get('Running'):
            raise RuntimeError('SACS must be running before deploying its UI')
        if SACS_NETWORK not in backend.get('NetworkSettings', {}).get('Networks', {}):
            raise RuntimeError('SACS is not connected to its entrance network')
        ids = run(['docker', 'ps', '-q', '--filter', 'label=com.docker.compose.project=openwebui-sacs', '--filter', 'label=com.docker.compose.service=openwebui']).split()
        owned_bindings = set()
        if ids:
            for container in json.loads(run(['docker', 'inspect', *ids])):
                ports = container.get('NetworkSettings', {}).get('Ports', {}).get('8080/tcp') or []
                owned_bindings.update((p['HostIp'], int(p['HostPort'])) for p in ports)
        for address in BINDINGS:
            if address not in owned_bindings:
                with socket.socket() as probe:
                    probe.bind(address)
        credentials_path = shared / 'admin-credentials.json'
        credentials = None
        if not args.allow_anonymous:
            if not credentials_path.exists():
                private(credentials_path, json.dumps({
                    'url': ENDPOINT, 'email': 'admin@sacs.local',
                    'password': secrets.token_urlsafe(32),
                }, indent=2)+'\n')
            credentials = json.loads(credentials_path.read_text())
        headers = {
            'X-OpenWebUI-Chat-Id': '{{CHAT_ID}}',
            'X-OpenWebUI-Message-Id': '{{MESSAGE_ID}}',
            'X-OpenWebUI-User-Message-Id': '{{USER_MESSAGE_ID}}',
            'X-OpenWebUI-User-Message-Parent-Id': '{{USER_MESSAGE_PARENT_ID}}',
            'X-OpenWebUI-Task': '{{TASK}}',
        }
        config = {
            'WEBUI_AUTH': 'false' if args.allow_anonymous else 'true',
            'ENABLE_SIGNUP': 'false',
            'WEBUI_SECRET_KEY': settings['secret'],
            'WEBUI_URL': ENDPOINT,
            'CORS_ALLOW_ORIGIN': ';'.join([ENDPOINT, LOCAL_ENDPOINT]),
            'ENABLE_OLLAMA_API': 'false', 'ENABLE_OPENAI_API': 'true',
            'OPENAI_API_BASE_URLS': SACS_URL,
            'OPENAI_API_KEYS': 'sacs-development-anonymous',
            'OPENAI_API_CONFIGS': json.dumps({'0': {'enable': True, 'headers': headers}}, separators=(',', ':')),
            'DEFAULT_MODELS': 'sdar-single-agent',
            'ENABLE_FORWARD_USER_INFO_HEADERS': 'false',
            'ENABLE_OPENAI_API_PASSTHROUGH': 'false',
            'AIOHTTP_CLIENT_TIMEOUT': '180', 'AIOHTTP_CLIENT_TIMEOUT_MODEL_LIST': '15',
            'ENABLE_TITLE_GENERATION': 'false', 'ENABLE_TAGS_GENERATION': 'false',
            'ENABLE_FOLLOW_UP_GENERATION': 'false',
            'ENABLE_CODE_EXECUTION': 'false', 'ENABLE_CODE_INTERPRETER': 'false',
            'ENABLE_WEB_SEARCH': 'false', 'ENABLE_IMAGE_GENERATION': 'false',
            'ENABLE_VERSION_UPDATE_CHECK': 'false', 'OFFLINE_MODE': 'true',
            'RAG_EMBEDDING_MODEL_AUTO_UPDATE': 'false', 'WHISPER_MODEL_AUTO_UPDATE': 'false',
            'DO_NOT_TRACK': 'true', 'SCARF_NO_ANALYTICS': 'true',
        }
        if credentials:
            config.update(WEBUI_ADMIN_EMAIL=credentials['email'],
                          WEBUI_ADMIN_PASSWORD=credentials['password'],
                          WEBUI_ADMIN_NAME='SACS Admin')
        private(shared/'runtime.env', '\n'.join(k+"='"+v.replace("'", "\\'")+"'" for k,v in config.items())+'\n')
        subprocess.run(command+['config', '--quiet'], env=env, check=True)
        subprocess.run(command+['up', '-d', '--pull', 'never', '--wait', '--wait-timeout', '300'], env=env, check=True)
        print(json.dumps({'status':'READY','endpoint':ENDPOINT,'localEndpoint':LOCAL_ENDPOINT,'image':settings['image'],
                          'mode':'shared-anonymous' if args.allow_anonymous else 'authenticated',
                          'upstream':SACS_URL,
                          'bootstrapCredentialsFile':str(credentials_path) if credentials else None}))


if __name__ == '__main__':
    try:
        main()
    except Exception as error:
        print('Open WebUI deployment stopped: '+type(error).__name__)
        raise SystemExit(1)
