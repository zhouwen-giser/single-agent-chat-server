import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "@jest/globals";

function pythonScenario(scenario: string): void {
  const output = execFileSync(
    "python3",
    [
      "-B",
      "-c",
      `
import importlib.util,tempfile,sys,json
from pathlib import Path
spec=importlib.util.spec_from_file_location('ui','deployment/openwebui/deploy.py')
d=importlib.util.module_from_spec(spec);spec.loader.exec_module(d)
digest='ghcr.io/open-webui/open-webui@sha256:'+'a'*64
backend={'State':{'Running':True},'NetworkSettings':{'Networks':{d.SACS_NETWORK:{}}}}
containers=[];probes=[]
def run(args):
 if args[:3]==['docker','image','inspect']:return json.dumps([{'RepoDigests':[digest]}])
 if args[:2]==['docker','inspect']:return json.dumps([backend] if args[2]==d.SACS_CONTAINER else containers)
 if args[:2]==['docker','ps']:return 'owned-ui' if containers else ''
 return ''
d.run=run;commands=[]
d.subprocess.run=lambda args,**kwargs:commands.append(args)
class Probe:
 def __enter__(self):return self
 def __exit__(self,*args):pass
 def bind(self,address):
  assert address in [('17.26.1.20',18084),('127.0.0.1',18084)]
  probes.append(address)
d.socket.socket=Probe
with tempfile.TemporaryDirectory() as folder:
 d.ROOT=Path(folder)/'ui'
 sys.argv=['deploy.py','install']
${scenario}
print('PASS')
`,
    ],
    { encoding: "utf8" },
  );
  expect(output.trim().endsWith("PASS")).toBe(true);
}

describe("independent Open WebUI deployment", () => {
  it("publishes only the UI and joins only its default and SACS entrance networks", () => {
    const compose = readFileSync("deployment/openwebui/compose.yaml", "utf8");
    expect(compose).toContain("17.26.1.20:18084:8080");
    expect(compose).toContain("127.0.0.1:18084:8080");
    expect(compose).toContain("data:/app/backend/data");
    expect(compose).toContain("name: sacs-dev_outbound");
    expect(compose).toContain("- default\n      - sacs-entrance");
    expect(compose).not.toMatch(
      /docker\.sock|privileged:|sacs-dev_data|sacs-dev_backend|sdar-sz|wsgs_default|0\.0\.0\.0:18084/,
    );
  });

  it("defaults to login, preserves credentials, image, secret and volume, and forwards conversation identifiers", () => {
    pythonScenario(`
 d.main()
 assert probes==[('17.26.1.20',18084),('127.0.0.1',18084)]
 settings=d.ROOT/'shared'/'settings.json';original=settings.read_bytes()
 credentials=d.ROOT/'shared'/'admin-credentials.json';admin=credentials.read_bytes()
 assert json.loads(original)['image']==digest
 assert len(json.loads(admin)['password'])>=32
 for path in [settings,credentials,d.ROOT/'shared'/'runtime.env']:
  assert path.stat().st_mode&0o777==0o600
 d.main()
 assert settings.read_bytes()==original and credentials.read_bytes()==admin
 environment=(d.ROOT/'shared'/'runtime.env').read_text()
 for placeholder in ['CHAT_ID','MESSAGE_ID','USER_MESSAGE_ID','USER_MESSAGE_PARENT_ID','TASK']:
  assert '{{'+placeholder+'}}' in environment
 assert "WEBUI_AUTH='true'" in environment
 assert "ENABLE_SIGNUP='false'" in environment
 assert "WEBUI_ADMIN_EMAIL='admin@sacs.local'" in environment
 assert "CORS_ALLOW_ORIGIN='http://17.26.1.20:18084;http://127.0.0.1:18084'" in environment
 assert "OPENAI_API_BASE_URLS='http://sacs-dev-server-1:3000/v1'" in environment
 assert "AIOHTTP_CLIENT_TIMEOUT='180'" in environment
 assert "ENABLE_TITLE_GENERATION='false'" in environment
 assert all('openwebui-sacs' in c and 'down' not in c for c in commands)
 assert any(c[-7:]==['up','-d','--pull','never','--wait','--wait-timeout','300'] for c in commands)
`);
  });

  it("retains explicit anonymous mode without generating administrator credentials", () => {
    pythonScenario(`
 sys.argv+=['--allow-anonymous'];d.main()
 assert not (d.ROOT/'shared'/'admin-credentials.json').exists()
 environment=(d.ROOT/'shared'/'runtime.env').read_text()
 assert "WEBUI_AUTH='false'" in environment
 assert 'WEBUI_ADMIN_PASSWORD' not in environment
`);
  });

  it("checks a newly added loopback binding even when the existing LAN port belongs to this UI", () => {
    pythonScenario(`
 containers.append({'NetworkSettings':{'Ports':{'8080/tcp':[{'HostIp':'17.26.1.20','HostPort':'18084'}]}}})
 def busy(self,address):
  assert address==('127.0.0.1',18084)
  raise OSError('loopback occupied')
 Probe.bind=busy
 try:d.main();raise AssertionError('occupied loopback accepted')
 except OSError:pass
 assert commands==[]
 assert not (d.ROOT/'shared'/'runtime.env').exists()
 assert not (d.ROOT/'shared'/'admin-credentials.json').exists()
`);
  });

  it("reuses both existing bindings without probing the running UI ports", () => {
    pythonScenario(`
 containers.append({'NetworkSettings':{'Ports':{'8080/tcp':[{'HostIp':'17.26.1.20','HostPort':'18084'},{'HostIp':'127.0.0.1','HostPort':'18084'}]}}})
 def unexpected(self,address):raise AssertionError('owned port must not be probed')
 Probe.bind=unexpected
 d.main()
 assert len(commands)==2
`);
  });

  it("stops before starting the UI when SACS is unavailable, on the wrong network or the port is occupied", () => {
    pythonScenario(`
 backend['State']['Running']=False
 try:d.main();raise AssertionError('stopped SACS accepted')
 except RuntimeError:pass
 backend['State']['Running']=True;backend['NetworkSettings']['Networks']={}
 try:d.main();raise AssertionError('wrong SACS network accepted')
 except RuntimeError:pass
 backend['NetworkSettings']['Networks']={d.SACS_NETWORK:{}}
 def busy(self,address):raise OSError('port occupied')
 Probe.bind=busy
 try:d.main();raise AssertionError('occupied port accepted')
 except OSError:pass
 assert commands==[]
 assert not (d.ROOT/'shared'/'runtime.env').exists()
 assert not (d.ROOT/'shared'/'admin-credentials.json').exists()
`);
  });
});
