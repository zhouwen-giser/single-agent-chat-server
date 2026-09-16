import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "@jest/globals";

describe("independent Open WebUI development deployment", () => {
  it("binds only the development endpoint and never mounts shared data or Docker", () => {
    const compose = readFileSync("deployment/openwebui/compose.yaml", "utf8");
    expect(compose).toContain("17.26.1.20:18084:8080");
    expect(compose).toContain("data:/app/backend/data");
    expect(compose).not.toMatch(
      /docker\.sock|external:|privileged:|sacs-dev_data/,
    );
  });
  it("requires anonymous acknowledgement, pins the image and retains its secret and volume", () => {
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
with tempfile.TemporaryDirectory() as folder:
 d.ROOT=Path(folder)/'ui'
 sys.argv=['deploy.py','install']
 try:d.main();raise AssertionError('anonymous flag not required')
 except RuntimeError:pass
 assert not d.ROOT.exists()
 digest='ghcr.io/open-webui/open-webui@sha256:'+'a'*64
 def run(args):
  if args[:3]==['docker','image','inspect']:return json.dumps([{'RepoDigests':[digest]}])
  return ''
 d.run=run;commands=[]
 d.subprocess.run=lambda args,**kwargs:commands.append(args)
 class Probe:
  def __enter__(self):return self
  def __exit__(self,*args):pass
  def bind(self,address):assert address==('17.26.1.20',18084)
 d.socket.socket=Probe
 sys.argv=['deploy.py','install','--allow-anonymous'];d.main()
 settings=d.ROOT/'shared'/'settings.json';original=settings.read_bytes()
 assert json.loads(original)['image']==digest
 assert settings.stat().st_mode&0o777==0o600
 d.main();assert settings.read_bytes()==original
 environment=(d.ROOT/'shared'/'runtime.env').read_text()
 for placeholder in ['CHAT_ID','MESSAGE_ID','USER_MESSAGE_ID','USER_MESSAGE_PARENT_ID','TASK']:
  assert '{{'+placeholder+'}}' in environment
 assert "WEBUI_AUTH='false'" in environment
 assert "OPENAI_API_BASE_URLS='http://17.26.1.20:18083/v1'" in environment
 assert "AIOHTTP_CLIENT_TIMEOUT='180'" in environment
 assert "ENABLE_TITLE_GENERATION='false'" in environment
 assert all('openwebui-sacs' in c and 'down' not in c for c in commands)
print('PASS')
`,
      ],
      { encoding: "utf8" },
    );
    expect(output.trim().endsWith("PASS")).toBe(true);
  });
});
