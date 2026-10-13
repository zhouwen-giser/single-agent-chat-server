import {
  HeadlessAnalysisReferenceClient,
  presentFrozenAnalysis,
} from "../../../packages/analysis-client/src/index.js";
import type { FocusTarget } from "../../../packages/analysis-contract/src/index.js";
import type { WorldAnalysisViewModel } from "../../../packages/world-explanation-runtime/src/analysis-view.js";
import { BrowserTransport } from "./transport.js";
import { SvgMapEngine } from "./map.js";

const $ = <T extends HTMLElement = HTMLElement>(id: string): T => {
  const node = document.getElementById(id);
  if (!node) throw Error("BROWSER_ELEMENT_MISSING");
  return node as T;
};
const make = (tag: string, text?: string, cls?: string): HTMLElement => {
  const node = document.createElement(tag);
  if (text !== undefined) node.textContent = text;
  if (cls) node.className = cls;
  return node;
};
const button = (
  text: string,
  action: () => void | Promise<void>,
): HTMLButtonElement => {
  const node = document.createElement("button");
  node.type = "button";
  node.textContent = text;
  node.addEventListener("click", () => {
    void safe(action);
  });
  return node;
};
const transport = new BrowserTransport();
const engine = new SvgMapEngine(
  $("map") as unknown as SVGSVGElement,
  $("map-status"),
  (layerId) => {
    const links =
      view()?.linkage?.features.filter((f) => f.layerId === layerId) ?? [];
    void safe(async () => {
      if (links.length === 1) await inspect(links[0]!.focus, links[0]);
      else
        showInspection({
          layerId,
          message: "关联不唯一，保持本地检查，不能推定候选。",
        });
    });
  },
);
let client = new HeadlessAnalysisReferenceClient(engine);
let threadId = "web-" + crypto.randomUUID();
let activeStream: AbortController | undefined;
let lastText = "";
let currentUser = "";
let sessionGeneration = 0;
const view = () =>
  client.state.sharedState?.worldExplanation as unknown as
    WorldAnalysisViewModel | undefined;
const showInspection = (value: unknown) => {
  $("inspection").textContent = JSON.stringify(value, null, 2);
};
async function safe(action: () => void | Promise<void>): Promise<void> {
  $("error").hidden = true;
  try {
    await action();
  } catch (error) {
    const text =
      error instanceof Error ? error.message : "BROWSER_OPERATION_FAILED";
    $("error").textContent = text;
    $("error").hidden = false;
    if (
      /SESSION_EXPIRED|INVALID_SIGNED_IDENTITY|invalid_user_identity/u.test(
        text,
      )
    )
      setAuthenticated(false);
  }
}
function setAuthenticated(active: boolean): void {
  $("login-panel").hidden = active;
  $("workspace").hidden = !active;
  $("logout").hidden = !active;
  $("identity").textContent = active ? `已认证 · ${currentUser}` : "尚未认证";
  if (!active) {
    transport.csrf = "";
    activeStream?.abort();
  }
}
async function acceptSession(result: Record<string, unknown>): Promise<void> {
  const user = String(result["userId"] ?? "");
  sessionGeneration += 1;
  if (user !== currentUser) {
    activeStream?.abort();
    await client.disconnect();
    client = new HeadlessAnalysisReferenceClient(engine);
    threadId = "web-" + crypto.randomUUID();
    clearView();
    $("directory").replaceChildren();
    $<HTMLTextAreaElement>("query").value = "";
    lastText = "";
  }
  currentUser = user;
  transport.csrf = String(result["csrf"] ?? "");
  setAuthenticated(true);
  await refreshDirectory();
}
async function refreshDirectory(): Promise<void> {
  const generation = sessionGeneration;
  const result = await transport.json("/analysis/api/v1/analyses");
  if (generation !== sessionGeneration) return;
  const rows = result["analyses"] as {
    analysisId: string;
    threadId: string;
    title: string;
    revisionNumber: number;
    status: string;
  }[];
  $("directory").replaceChildren();
  if (!rows.length) $("directory").append(make("p", "暂无此身份的 AG-UI 分析"));
  for (const entry of rows) {
    const node = button(
      `${entry.title} · r${entry.revisionNumber} · ${entry.status}`,
      async () => {
        activeStream?.abort();
        await client.disconnect();
        client = new HeadlessAnalysisReferenceClient(engine);
        threadId = entry.threadId;
        await observe(entry.analysisId);
      },
    );
    node.dataset["analysisId"] = entry.analysisId;
    $("directory").append(node);
  }
}
async function run(
  mode: "START" | "RECONNECT",
  text: string,
  analysisId?: string,
): Promise<void> {
  if (activeStream) throw Error("BROWSER_OBSERVATION_ACTIVE");
  const controller = new AbortController();
  activeStream = controller;
  $("start").setAttribute("disabled", "");
  const observer = client;
  const generation = observer.observationGeneration;
  const session = sessionGeneration;
  $("connection").textContent =
    mode === "START"
      ? "已提交只读查询，等待公开状态…"
      : "正在恢复完整 State / Activity…";
  try {
    const response = await transport.request(
      "/analysis/ag-ui",
      "POST",
      {
        threadId,
        runId: "run-" + crypto.randomUUID(),
        state: {},
        messages: text
          ? [
              {
                id: "message-" + crypto.randomUUID(),
                role: "user",
                content: text,
              },
            ]
          : [],
        tools: [],
        context: [],
        forwardedProps: { mode, ...(analysisId ? { analysisId } : {}) },
      },
      controller.signal,
    );
    if (!response.ok || !response.body) {
      const result = (await response.json()) as { error?: { code?: string } };
      throw Error(
        response.status === 401
          ? "BROWSER_SESSION_EXPIRED"
          : (result.error?.code ?? "BROWSER_OBSERVATION_FAILED"),
      );
    }
    const reader = response.body.getReader();
    while (!controller.signal.aborted) {
      const part = await reader.read();
      if (part.done) break;
      const effects = await observer.acceptSseChunk(part.value, generation);
      if (session !== sessionGeneration || observer !== client) return;
      render();
      if (effects.length) throw Error("BROWSER_FULL_SNAPSHOT_REQUIRED");
    }
    await observer.finishStream(generation);
    if (session !== sessionGeneration || observer !== client) return;
    render();
    if (client.state.runStatus === "ERROR")
      throw Error("BROWSER_SOURCE_RUN_ERROR");
    $("connection").textContent =
      "观察窗口结束，保留最后公开视图；可恢复观察。";
    await refreshDirectory();
  } catch (error) {
    await observer.disconnect();
    if (session !== sessionGeneration || observer !== client) return;
    $("connection").textContent = "观察已断开，最后视图保留；请恢复观察。";
    if (!controller.signal.aborted) throw error;
  } finally {
    if (activeStream === controller) activeStream = undefined;
    $("start").removeAttribute("disabled");
  }
}
async function observe(analysisId: string): Promise<void> {
  activeStream?.abort();
  await client.disconnect();
  client.reconnect();
  // Wait for the detached HTTP reader to release before opening its replacement.
  while (activeStream) await new Promise((resolve) => setTimeout(resolve, 10));
  await run("RECONNECT", "", analysisId);
}
async function inspect(
  focus: FocusTarget | undefined,
  value: unknown,
): Promise<void> {
  if (focus) await client.setInspectionFocus(focus);
  showInspection(value);
}
function clearView(): void {
  for (const id of [
    "revision",
    "activity",
    "summary",
    "findings",
    "timeline",
    "evidence",
    "products",
    "choices",
    "action-targets",
    "layers",
  ])
    $(id).replaceChildren();
  $("inspection").textContent = "点击 Finding、时间项或候选查看关联。";
  delete $("revision").dataset["analysisId"];
  delete $("revision").dataset["revisionId"];
  $("reconnect").setAttribute("disabled", "");
  engine.replaceScene({
    schemaVersion: "io.sacs/map-scene/v1",
    sceneRevision: 0,
    layersById: {},
    pinnedFocusById: {},
  });
}
function render(): void {
  const state = client.state.sharedState,
    v = view();
  if (!state || !v) return;
  const summary = presentFrozenAnalysis({
    view: v,
    activeRevisionId: state.analysis.activeRevisionId,
    activeRevisionNumber: state.analysis.session.latestRevisionNumber,
    ...(state.pendingIntervention?.status === "OPEN"
      ? { interventionId: state.pendingIntervention.interventionId }
      : {}),
  });
  $("reconnect").removeAttribute("disabled");
  $("revision").replaceChildren(
    make("h2", v.summary.title),
    make(
      "p",
      `Revision ${state.analysis.session.latestRevisionNumber} · ${v.status} · ${v.currentness}`,
    ),
  );
  $("revision").dataset["revisionId"] = v.revisionId;
  $("revision").dataset["analysisId"] = v.analysisId;
  $("summary").textContent = summary.text;
  for (const qualifier of summary.qualifiers)
    $("summary").append(make("p", qualifier, "badge"));
  for (const gap of v.typedGaps)
    $("summary").append(make("p", JSON.stringify(gap), "gap"));
  for (const warning of v.warnings)
    $("summary").append(make("p", warning, "gap"));
  $("activity").replaceChildren();
  for (const activity of Object.values(client.state.activitiesByMessageId))
    $("activity").append(
      make(
        "p",
        `${activity.activityType} · ${String(activity.content["status"] ?? "UNKNOWN")} · 公开 Activity r${activity.activityRevision}`,
        "badge",
      ),
    );
  $("layers").replaceChildren();
  for (const layer of Object.values(
    client.mapPresentation.rendered?.layersById ?? {},
  )) {
    const label = make("label");
    const input = document.createElement("input");
    input.type = "checkbox";
    input.checked = layer.visibleByDefault;
    input.dataset["layerId"] = layer.layerId;
    input.addEventListener("change", () => {
      void safe(async () => {
        await client.dispatchMapAction({
          type: "TOGGLE_LAYER",
          layerId: layer.layerId,
          visible: input.checked,
        });
      });
    });
    label.append(
      input,
      document.createTextNode(`${layer.title} · ${layer.currentness}`),
    );
    $("layers").append(label);
  }
  $("findings").replaceChildren();
  for (const finding of v.findings) {
    const id = String(finding["findingId"]),
      links = v.linkage?.findings.filter((f) => f.findingId === id) ?? [];
    const card = make("article", undefined, "card");
    card.dataset["findingId"] = id;
    card.append(
      make(
        "h3",
        `${String(finding["findingKind"])} · ${String(finding["semanticConcept"] ?? id)}`,
      ),
    );
    card.append(
      button("检查 Finding", () =>
        inspect(
          links.length === 1 && links[0]?.focusTargets.length === 1
            ? links[0].focusTargets[0]
            : undefined,
          finding,
        ),
      ),
    );
    if (v.map.layers.some((l) => l.findingIds.includes(id)))
      card.append(
        button("适配几何", () =>
          client.dispatchMapAction({ type: "FIT_FINDING", findingId: id }),
        ),
      );
    $("findings").append(card);
  }
  $("timeline").replaceChildren();
  if (!v.timeline.items.length)
    $("timeline").append(make("p", "来源未发布时间项。"));
  for (const item of v.timeline.items) {
    const link = v.linkage?.timeline.find((t) => t.itemId === item.itemId);
    const node = make(
      "article",
      undefined,
      "timeline-item" + (/GAP|BREAK|AMBIGUITY/u.test(item.kind) ? " gap" : ""),
    );
    node.dataset["itemId"] = item.itemId;
    node.append(
      make("strong", item.kind),
      make(
        "p",
        `${item.start} → ${item.end ?? "瞬时"} · ${item.bounds ?? "UNSPECIFIED"} · ${item.periodRole ?? "HISTORICAL"}`,
      ),
    );
    node.append(
      button("检查时间项", () =>
        inspect(
          link?.focusTargets.length === 1 ? link.focusTargets[0] : undefined,
          item,
        ),
      ),
    );
    $("timeline").append(node);
  }
  $("evidence").replaceChildren(make("h3", "公开证据"));
  for (const evidence of v.evidenceLinks ?? []) {
    const node = button(
      `${evidence.evidenceProductId} · ${evidence.findingId}`,
      () =>
        inspect(
          v.linkage?.findings.find((f) => f.findingId === evidence.findingId)
            ?.focusTargets[0],
          evidence,
        ),
    );
    node.dataset["evidenceId"] = evidence.evidenceProductId;
    $("evidence").append(node);
  }
  $("products").replaceChildren(make("h3", "来源产品"));
  for (const product of v.sourceProducts) {
    const id = String(
      product["sourceProductId"] ?? product["productId"] ?? "UNKNOWN",
    );
    const relation = v.linkage?.sourceProducts.find(
      (p) => p.sourceProductId === id,
    );
    const node = button(id, () =>
      inspect(
        relation?.findingIds.length === 1
          ? v.linkage?.findings.find(
              (f) => f.findingId === relation.findingIds[0],
            )?.focusTargets[0]
          : undefined,
        product,
      ),
    );
    node.dataset["productId"] = id;
    $("products").append(node);
  }
  $("choices").replaceChildren();
  for (const choice of summary.choices) {
    const node = make("article", undefined, "card");
    node.dataset["candidateId"] = choice.choice.candidateId;
    node.append(
      make("h3", choice.choice.displayName),
      make("p", choice.message),
      make("small", `有效至 ${choice.choice.validUntil}`),
    );
    node.append(
      button("检查候选", async () => {
        const selected = await client.inspectFrozenChoice(
          choice.choice.choiceId,
          choice.choice.candidateId,
        );
        showInspection(selected);
      }),
    );
    $("choices").append(node);
  }
  if (!summary.choices.length)
    $("choices").append(make("p", "来源未发布候选。"));
  $("action-targets").replaceChildren();
  for (const action of summary.actions) {
    const node = make("article", undefined, "card");
    node.append(
      make("h3", action.title),
      make("p", action.requirementLabels.join(" · ")),
      make("p", "executionAuthorized=false"),
    );
    $("action-targets").append(node);
  }
}
$("login-form").addEventListener("submit", (event) => {
  event.preventDefault();
  void safe(async () => {
    const field = $<HTMLInputElement>("jwt");
    const token = field.value;
    field.value = "";
    await acceptSession(
      await transport.json("/analysis/session", "POST", { jwt: token }),
    );
  });
});
$("logout").addEventListener("click", () => {
  void safe(async () => {
    await transport.json("/analysis/logout", "POST", {});
    await client.disconnect();
    sessionGeneration += 1;
    clearView();
    $("directory").replaceChildren();
    $<HTMLTextAreaElement>("query").value = "";
    lastText = "";
    currentUser = "";
    setAuthenticated(false);
  });
});
$("query-form").addEventListener("submit", (event) => {
  event.preventDefault();
  void safe(async () => {
    lastText = $<HTMLTextAreaElement>("query").value.trim();
    if (!lastText) throw Error("请输入明确的只读查询。");
    await client.disconnect();
    client = new HeadlessAnalysisReferenceClient(engine);
    threadId = "web-" + crypto.randomUUID();
    clearView();
    await run("START", lastText);
  });
});
$("refresh-directory").addEventListener("click", () => {
  void safe(refreshDirectory);
});
$("reconnect").addEventListener("click", () => {
  void safe(async () => {
    const id = view()?.analysisId;
    if (id) await observe(id);
  });
});
$("fit").addEventListener("click", () => engine.fitAll());
$("zoom-in").addEventListener("click", () => {
  void safe(() => client.dispatchMapAction({ type: "ZOOM", zoom: 1.5 }));
});
$("zoom-out").addEventListener("click", () => {
  void safe(() => client.dispatchMapAction({ type: "ZOOM", zoom: 1 / 1.5 }));
});
for (const [id, direction] of [
  ["pan-left", -1],
  ["pan-right", 1],
] as const)
  $(id).addEventListener("click", () => {
    void safe(() =>
      client.dispatchMapAction({
        type: "PAN",
        viewport: engine.pan(direction),
      }),
    );
  });
void transport
  .json("/analysis/session")
  .then(acceptSession)
  .catch(() => setAuthenticated(false));
