import { readFile, readdir } from "node:fs/promises";
import { extname, join, relative, resolve } from "node:path";

const rootArgumentIndex = process.argv.indexOf("--root");
const root = resolve(
  rootArgumentIndex === -1
    ? process.cwd()
    : (process.argv[rootArgumentIndex + 1] ?? ""),
);
if (
  rootArgumentIndex !== -1 &&
  process.argv[rootArgumentIndex + 1] === undefined
) {
  throw new Error("--root requires a directory");
}

const SOURCE_EXTENSIONS = new Set([".ts", ".tsx", ".js", ".mjs"]);
const FORBIDDEN_SPATIAL_DEPENDENCY =
  /(?:^|[/@_-])(?:@turf|turf|h3-js|proj4|geolib|jsts|s2-geometry|geojson-area|wkx|postgis)(?:$|[/@_.-])/iu;
const DOWNSTREAM_TOKEN = /(?:^|[/@_-])(?:gowm|gdps|stas)(?:$|[/@_.-])/iu;
const DOWNSTREAM_CLIENT_QUALIFIER =
  /(?:client|sdk|api|gateway|connector|adapter|service)/iu;
const violations = [];

await inspectDependencies();
const files = (
  await Promise.all(
    ["apps", "packages"].map((directory) => walk(join(root, directory))),
  )
).flat();

for (const file of files) {
  if (!SOURCE_EXTENSIONS.has(extname(file))) continue;
  const name = relative(root, file).replaceAll("\\", "/");
  const raw = await readFile(file, "utf8");
  const source = stripComments(raw);

  for (const specifier of moduleSpecifiers(source)) {
    if (isDirectDownstreamModule(specifier)) {
      add(name, "DIRECT_DOWNSTREAM_CLIENT", `forbidden module ${specifier}`);
    }
    if (FORBIDDEN_SPATIAL_DEPENDENCY.test(specifier)) {
      add(
        name,
        "SPATIAL_COMPUTATION_DEPENDENCY",
        `forbidden module ${specifier}`,
      );
    }
  }

  if (
    /\bprocess\.env(?:\.|\[\s*["'`])(?:GOWM|GDPS|STAS)(?:[_A-Z0-9]|["'`\]])/u.test(
      source,
    )
  ) {
    add(
      name,
      "DIRECT_DOWNSTREAM_CONFIGURATION",
      "GOWM/GDPS/STAS environment routing is forbidden in SACS",
    );
  }
  if (containsDirectDownstreamEndpoint(source)) {
    add(
      name,
      "DIRECT_DOWNSTREAM_ENDPOINT",
      "literal GOWM/GDPS/STAS URL or endpoint is forbidden",
    );
  }
  if (
    /\b(?:new\s+|create)(?:Gowm|GOWM|Gdps|GDPS|Stas|STAS)(?:Http|Api|Gateway|Service)?Client\b/u.test(
      source,
    ) ||
    /\b(?:Gowm|GOWM|Gdps|GDPS|Stas|STAS)(?:Gateway|Api|Http|Service)Client\b/u.test(
      source,
    )
  ) {
    add(
      name,
      "DIRECT_DOWNSTREAM_CLIENT",
      "direct GOWM/GDPS/STAS client construction is forbidden",
    );
  }

  if (containsSpatialComputation(source)) {
    add(
      name,
      "SACS_SPATIAL_COMPUTATION",
      "coordinate calculation or spatial algorithm is forbidden",
    );
  }
  if (containsNodeReuseDecision(source)) {
    add(
      name,
      "SACS_NODE_REUSE_DECISION",
      "SACS may validate and display WSGS reuse sets but must not decide them",
    );
  }
  if (containsSemanticDagOwnership(source)) {
    add(
      name,
      "SACS_SEMANTIC_DAG_OWNERSHIP",
      "semantic DAG construction and capability matching belong to WSGS",
    );
  }
  if (containsToolEventInference(source)) {
    add(
      name,
      "FINAL_EVIDENCE_TOOL_EVENT_INFERENCE",
      "tool events must arrive through the WSGS analysis presentation boundary",
    );
  }
}

if (violations.length > 0) {
  throw new Error(
    `SACS_V05_ARCHITECTURE_BLOCKED\n${violations
      .map(({ file, rule, detail }) => `${file}: ${rule}: ${detail}`)
      .join("\n")}`,
  );
}

process.stdout.write(
  `SACS_V05_ARCHITECTURE_PASS files=${files.filter((file) => SOURCE_EXTENSIONS.has(extname(file))).length} rules=direct-downstream,spatial-computation,node-reuse,semantic-dag,tool-event-authority\n`,
);

async function inspectDependencies() {
  const packageJsonPath = join(root, "package.json");
  const packageJson = await readFile(packageJsonPath, "utf8")
    .then((value) => JSON.parse(value))
    .catch((error) => {
      if (error?.code === "ENOENT") return {};
      throw error;
    });
  const dependencies = {
    ...(packageJson.dependencies ?? {}),
    ...(packageJson.optionalDependencies ?? {}),
  };
  for (const dependency of Object.keys(dependencies)) {
    if (isDirectDownstreamModule(dependency)) {
      add(
        "package.json",
        "DIRECT_DOWNSTREAM_DEPENDENCY",
        `forbidden production dependency ${dependency}`,
      );
    }
    if (FORBIDDEN_SPATIAL_DEPENDENCY.test(dependency)) {
      add(
        "package.json",
        "SPATIAL_COMPUTATION_DEPENDENCY",
        `forbidden production dependency ${dependency}`,
      );
    }
  }
}

function isDirectDownstreamModule(specifier) {
  if (!DOWNSTREAM_TOKEN.test(specifier)) return false;
  const segments = specifier.toLowerCase().split(/[\/@_-]+/u);
  const exactPackage = segments.some((part) =>
    ["gowm", "gdps", "stas"].includes(part),
  );
  const leaf = specifier.toLowerCase().split("/").at(-1) ?? "";
  return (
    ["gowm", "gdps", "stas"].includes(leaf) ||
    (exactPackage && DOWNSTREAM_CLIENT_QUALIFIER.test(specifier))
  );
}

function containsDirectDownstreamEndpoint(source) {
  const literals = source.matchAll(/["'`]([^"'`\r\n]+)["'`]/gu);
  for (const match of literals) {
    const value = match[1];
    if (
      /https?:\/\/[^\s"'`]*(?:gowm|gdps|stas)(?:[./?#:]|$)/iu.test(value) ||
      /^\/(?:api\/)?(?:gowm|gdps|stas)(?:\/|$)/iu.test(value)
    ) {
      return true;
    }
  }
  return false;
}

function containsSpatialComputation(source) {
  if (
    /\b(?:haversine|pointInPolygon|polygonContains|spatialJoin|reproject|transformCoordinates|calculateDistance|computeDistance|calculateArea|computeArea|calculateCentroid|computeCentroid|createSpatialBuffer|computeSpatialBuffer)\b/u.test(
      source,
    )
  ) {
    return true;
  }
  const coordinateContext =
    /\b(?:coordinates?|longitude|latitude|lon|lat|geojson|geometry)\b/iu.test(
      source,
    );
  if (
    coordinateContext &&
    /\bMath\.(?:sin|cos|tan|asin|acos|atan|atan2)\s*\(/u.test(source)
  ) {
    return true;
  }
  return (
    /\bcoordinates?\s*\[[^\]]+\]\s*[+\-*/]/u.test(source) ||
    /\b(?:longitude|latitude|lon|lat)\b\s*[+\-*/]=?/u.test(source)
  );
}

function containsNodeReuseDecision(source) {
  return (
    /\b(?:function\s+|(?:const|let)\s+)(?:decide|compute|calculate|derive|determine|select|plan)[A-Za-z0-9_]*(?:Reuse|Reused|Invalidat|Rerun)[A-Za-z0-9_]*\b/u.test(
      source,
    ) ||
    /\b(?:shouldReuseNode|shouldInvalidateNode|shouldRerunNode)\b/u.test(
      source,
    ) ||
    /\b(?:const|let)\s+(?:reusedNodeIds|invalidatedNodeIds|rerunNodeIds)\s*=\s*[^;\n]*(?:\.filter|\.reduce|\.map)\s*\(/u.test(
      source,
    )
  );
}

function containsSemanticDagOwnership(source) {
  return /\b(?:build|compile|create|derive|plan)(?:Typed)?(?:Semantic|Query)?Dag\b|\b(?:match|select|discover)Capabilities?\b|\bplanSemanticQuery\b/u.test(
    source,
  );
}

function containsToolEventInference(source) {
  const inferenceName =
    "(?:(?:infer|reconstruct|derive|synthesize)[A-Za-z0-9_]*(?:Final|Evidence|Result)[A-Za-z0-9_]*(?:Tool|Step)[A-Za-z0-9_]*(?:Event|Call)[A-Za-z0-9_]*|(?:infer|reconstruct|derive|synthesize)[A-Za-z0-9_]*(?:Tool|Step)[A-Za-z0-9_]*(?:Event|Call)[A-Za-z0-9_]*(?:Final|Evidence|Result)[A-Za-z0-9_]*)";
  if (
    new RegExp(
      `\\b(?:function\\s+${inferenceName}|(?:const|let)\\s+${inferenceName}\\s*=|${inferenceName}\\s*\\()`,
      "u",
    ).test(source)
  ) {
    return true;
  }
  const finalEvidence =
    "(?:finalEvidence|finalResult|finalArtifact|completedEvidence|finalResultArtifact)";
  const toolEvent =
    "(?:eventType\\s*:\\s*[\"'`]TOOL_|[\"'`]TOOL_(?:CALL|STARTED|COMPLETED|FAILED)|[\"'`]TOOL_CALL_(?:START|END))";
  return (
    new RegExp(`\\b${finalEvidence}\\b[\\s\\S]{0,600}${toolEvent}`, "u").test(
      source,
    ) ||
    new RegExp(`${toolEvent}[\\s\\S]{0,600}\\b${finalEvidence}\\b`, "u").test(
      source,
    )
  );
}

function moduleSpecifiers(source) {
  const values = [];
  const pattern =
    /(?:\bfrom\s*|\bimport\s*\(\s*|\brequire\s*\(\s*|\bimport\s*)["']([^"']+)["']/gu;
  for (const match of source.matchAll(pattern)) values.push(match[1]);
  return values;
}

function stripComments(source) {
  let output = "";
  let quote;
  let escaped = false;
  for (let index = 0; index < source.length; index += 1) {
    const character = source[index];
    const next = source[index + 1];
    if (quote !== undefined) {
      output += character;
      if (escaped) escaped = false;
      else if (character === "\\") escaped = true;
      else if (character === quote) quote = undefined;
      continue;
    }
    if (character === '"' || character === "'" || character === "`") {
      quote = character;
      output += character;
      continue;
    }
    if (character === "/" && next === "/") {
      while (index < source.length && source[index] !== "\n") index += 1;
      output += "\n";
      continue;
    }
    if (character === "/" && next === "*") {
      index += 2;
      while (
        index < source.length &&
        !(source[index] === "*" && source[index + 1] === "/")
      ) {
        if (source[index] === "\n") output += "\n";
        index += 1;
      }
      index += 1;
      continue;
    }
    output += character;
  }
  return output;
}

function add(file, rule, detail) {
  if (!violations.some((item) => item.file === file && item.rule === rule)) {
    violations.push({ file, rule, detail });
  }
}

async function walk(directory) {
  const entries = await readdir(directory, { withFileTypes: true }).catch(
    (error) => {
      if (error?.code === "ENOENT") return [];
      throw error;
    },
  );
  return (
    await Promise.all(
      entries.map((entry) => {
        const path = join(directory, entry.name);
        return entry.isDirectory() ? walk(path) : [path];
      }),
    )
  ).flat();
}
