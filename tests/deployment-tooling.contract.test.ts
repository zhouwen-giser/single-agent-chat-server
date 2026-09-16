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
});
