import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { parseEnv } from "node:util";
import { describe, expect, it } from "@jest/globals";

describe("development deployment tooling", () => {
  it("documents parsed runtime settings rather than forwarding a partial Compose list", () => {
    const template = parseEnv(readFileSync(".env.example", "utf8"));
    for (const file of [
      "apps/server/src/config.ts",
      "packages/wsgs-http-adapter/src/index.ts",
      "packages/sdar-a2a-adapter/src/config.ts",
      "packages/conversation-model/src/config.ts",
      "packages/persistence/src/config.ts",
    ]) {
      const source = readFileSync(file, "utf8");
      for (const match of source.matchAll(
        /^\s+((?:CHAT_|AG_UI_|OPENWEBUI_|DATABASE_|IDEMPOTENCY_|SDAR_|WSGS_|CONVERSATION_|SACS_AUTH_|SACS_ALLOW_)[A-Z0-9_]+):/gm,
      )) {
        expect(template).toHaveProperty(match[1]!);
      }
    }
    const compose = readFileSync("deployment/compose.yaml", "utf8");
    expect(compose).toContain("env_file: ${SACS_RUNTIME_ENV:?required}");
    expect(compose).toContain("env_file: ${SACS_PG_ENV:?required}");
    expect(compose).not.toContain("5432:");
    expect(compose).toContain("- /tmp:size=64m,mode=1777");
  });
  it("preserves configuration on reinstall, isolates PG secrets and blocks incompatible rollback", () => {
    const output = execFileSync(
      "python3",
      [
        "-B",
        "-c",
        `
import importlib.util,tempfile,json,os
from pathlib import Path
spec=importlib.util.spec_from_file_location('deploy','deployment/deploy.py')
d=importlib.util.module_from_spec(spec);spec.loader.exec_module(d)
calls=[]
def fake_run(args,**kwargs):
 calls.append(args)
 return json.dumps([{'Config':{'Env':['MODEL_NAME=kimi-k3','MODEL_BASE_URL=http://model/v1','MODEL_API_KEY=private-test-value']}}]).encode()
d.run=fake_run
with tempfile.TemporaryDirectory() as folder:
 p=Path(folder)
 d.private_configuration(p,{},'wsgs-dev-grounding-api-1')
 first=(p/'runtime.json').read_bytes()
 d.private_configuration(p,{},'wsgs-dev-grounding-api-1')
 assert first==(p/'runtime.json').read_bytes() and len(calls)==1
 assert (p/'runtime.env').stat().st_mode & 0o777 == 0o600
 assert 'private-test-value' not in (p/'postgres.env').read_text()
 d.write_env(p/'special.env',{'VALUE':"dollar$quote'"})
 assert "dollar$quote" in (p/'special.env').read_text()
 try:d.write_env(p/'bad.env',{'VALUE':'line\\nbreak'});raise AssertionError('accepted newline')
 except RuntimeError:pass
 m={'migrations':{'0001.sql':'abc'}}
 d.assert_rollback_compatible(m,m,m['migrations'])
 for target,applied in [({'migrations':{}},m['migrations']),(m,{'0001.sql':'changed'})]:
  try:d.assert_rollback_compatible(m,target,applied);raise AssertionError('unsafe rollback')
  except RuntimeError:pass
print('PASS')
`,
      ],
      { encoding: "utf8" },
    );
    expect(output.trim()).toBe("PASS");
  });
  it("rejects modified, missing, extra and symlink package files", () => {
    const output = execFileSync(
      "python3",
      [
        "-B",
        "-c",
        `
import importlib.util,tempfile,json
from pathlib import Path
spec=importlib.util.spec_from_file_location('deploy','deployment/deploy.py')
d=importlib.util.module_from_spec(spec);spec.loader.exec_module(d)
with tempfile.TemporaryDirectory() as folder:
 p=Path(folder)
 names=['manifest.json','images.tar','compose.yaml','deploy.py','deploy.sh','preflight.mjs','runtime.defaults.json','.env.example','README.md']
 for name in names:(p/name).write_text('{}')
 (p/'SHA256SUMS').write_text(''.join(d.digest(p/name)+'  '+name+'\\n' for name in names))
 assert d.verify(p)=={}
 def rejected():
  try:d.verify(p);raise AssertionError('accepted unsafe package')
  except (RuntimeError,FileNotFoundError):pass
 (p/'README.md').write_text('changed');rejected()
 (p/'README.md').unlink();rejected()
 (p/'README.md').symlink_to(p/'manifest.json');rejected()
 (p/'README.md').unlink();(p/'README.md').write_text('{}')
 (p/'.env').write_text('private');rejected()
print('PASS')
`,
      ],
      { encoding: "utf8" },
    );
    expect(output.trim()).toBe("PASS");
  });
  it("retains the successful marker on startup failure and restores only schema-compatible application images", () => {
    const output = execFileSync(
      "python3",
      [
        "-B",
        "-c",
        `
import importlib.util,tempfile,json,sys
from pathlib import Path
spec=importlib.util.spec_from_file_location('deploy','deployment/deploy.py')
d=importlib.util.module_from_spec(spec);spec.loader.exec_module(d)
with tempfile.TemporaryDirectory() as folder:
 root=Path(folder)/'live';root.mkdir();(root/'shared').mkdir()
 incoming=Path(folder)/'incoming';incoming.mkdir()
 old=root/'releases'/'old';old.mkdir(parents=True)
 for p in [incoming,old]:
  (p/'SHA256SUMS').write_text('manifest');(p/'images.tar').write_text('image')
  (p/'runtime.defaults.json').write_text('{}')
 (root/'current').symlink_to(old)
 m={'image':'sacs:test','imageId':'image-id','postgresImage':'pg:test','postgresImageId':'image-id','migrations':{'0001.sql':'hash'},'sourceSha':'test'}
 d.__file__=str(incoming/'deploy.py');d.verify=lambda p:m
 d.private_configuration=lambda *a:None
 def run(args,**kw):
  if args[:3]==['docker','image','inspect']:return b'[{"Id":"image-id"}]'
  if args[:2]==['docker','ps']:return b'owned-container'
  return b''
 d.run=run;d.check_port=lambda *a:None;calls=[];fail=True
 def compose(package,*a):
  def comp(*args,**kw):
   calls.append((str(package),args))
   if args[0]=='exec' and 'pg_dump' in args:return b'backup'
   if args[0]=='up' and args[-1]=='server' and package!=old and fail:raise RuntimeError('startup failure')
   return b''
  return comp
 d.compose=compose;d.db_versions=lambda comp:m['migrations'];d.ready=lambda comp:None
 sys.argv=['deploy.py','install','--root',str(root)]
 try:d.main();raise AssertionError('ignored startup failure')
 except RuntimeError:pass
 assert (root/'current').resolve()==old
 assert any(p==str(old) and a[0]=='up' and a[-1]=='server' for p,a in calls)
 assert not (root/'shared'/'deployment-receipt.json').exists()
 assert any(a[-1]=='postgres' and a[0]=='up' for p,a in calls)
 fail=False;d.main()
 assert (root/'current').resolve()!=old and (root/'previous').resolve()==old
 sys.argv=['deploy.py','rollback','--root',str(root)];d.main()
 assert (root/'current').resolve()==old
 assert all(not any(x in a for x in ['down','pg_restore']) for p,a in calls)
print('PASS')
`,
      ],
      { encoding: "utf8" },
    );
    expect(output.trim().endsWith("PASS")).toBe(true);
  });
  it("rejects occupied targets even when SACS already exists on another port", () => {
    const output = execFileSync(
      "python3",
      [
        "-B",
        "-c",
        `
import importlib.util,socket,json
spec=importlib.util.spec_from_file_location('deploy','deployment/deploy.py')
d=importlib.util.module_from_spec(spec);spec.loader.exec_module(d)
with socket.socket() as server:
 server.bind(('127.0.0.1',0));port=server.getsockname()[1]
 mapped=port+1
 def run(args,**kw):
  if args[:2]==['docker','ps']:return b'owned-container'
  return json.dumps([{'NetworkSettings':{'Ports':{'3000/tcp':[{'HostIp':'127.0.0.1','HostPort':str(mapped)}]}}}]).encode()
 d.run=run
 try:d.check_port('127.0.0.1',port);raise AssertionError('accepted foreign port owner')
 except OSError:pass
 mapped=port;d.check_port('127.0.0.1',port)
print('PASS')
`,
      ],
      { encoding: "utf8" },
    );
    expect(output.trim()).toBe("PASS");
  });
});
