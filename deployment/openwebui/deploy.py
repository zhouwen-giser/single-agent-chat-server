#!/usr/bin/env python3
"""Install only the explicitly anonymous openwebui-sacs development project."""
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
    if args.action == 'install' and not args.allow_anonymous:
        raise RuntimeError('Explicit --allow-anonymous is required')
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
        ids = run(['docker', 'ps', '-q', '--filter', 'label=com.docker.compose.project=openwebui-sacs', '--filter', 'label=com.docker.compose.service=openwebui']).split()
        owns_port = False
        if ids:
            for container in json.loads(run(['docker', 'inspect', *ids])):
                ports = container.get('NetworkSettings', {}).get('Ports', {}).get('8080/tcp') or []
                owns_port |= any(p['HostIp']=='17.26.1.20' and p['HostPort']=='18084' for p in ports)
        if not owns_port:
            with socket.socket() as probe:
                probe.bind(('17.26.1.20', 18084))
        headers = {
            'X-OpenWebUI-Chat-Id': '{{CHAT_ID}}',
            'X-OpenWebUI-Message-Id': '{{MESSAGE_ID}}',
            'X-OpenWebUI-User-Message-Id': '{{USER_MESSAGE_ID}}',
            'X-OpenWebUI-User-Message-Parent-Id': '{{USER_MESSAGE_PARENT_ID}}',
            'X-OpenWebUI-Task': '{{TASK}}',
        }
        config = {
            'WEBUI_AUTH': 'false', 'ENABLE_SIGNUP': 'false',
            'WEBUI_SECRET_KEY': settings['secret'],
            'WEBUI_URL': 'http://17.26.1.20:18084',
            'CORS_ALLOW_ORIGIN': 'http://17.26.1.20:18084',
            'ENABLE_OLLAMA_API': 'false', 'ENABLE_OPENAI_API': 'true',
            'OPENAI_API_BASE_URLS': 'http://17.26.1.20:18083/v1',
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
        private(shared/'runtime.env', '\n'.join(k+"='"+v.replace("'", "\\'")+"'" for k,v in config.items())+'\n')
        subprocess.run(command+['config', '--quiet'], env=env, check=True)
        subprocess.run(command+['up', '-d', '--wait', '--wait-timeout', '300'], env=env, check=True)
        print(json.dumps({'status':'READY','endpoint':'http://17.26.1.20:18084','image':settings['image'],'mode':'shared-anonymous','upstream':'http://17.26.1.20:18083/v1'}))


if __name__ == '__main__':
    try:
        main()
    except Exception as error:
        print('Open WebUI deployment stopped: '+type(error).__name__)
        raise SystemExit(1)
