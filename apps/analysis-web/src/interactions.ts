import {
  AnalysisControlClient,
  presentFrozenChoice,
  type AnalysisControlTransport,
  type HeadlessAnalysisReferenceClient,
  type FrozenAnalysisInteractionContext,
} from "../../../packages/analysis-client/src/index.js";
import {
  queryScopeSchema,
  type QueryScope,
} from "../../../packages/analysis-contract/src/query-scope.js";
import { hashCanonicalJson } from "../../../packages/world-explanation-contract/src/index.js";
import type { WorldAnalysisViewModel } from "../../../packages/world-explanation-runtime/src/analysis-view.js";
import type { BrowserTransport } from "./transport.js";
import type { SvgMapEngine } from "./map.js";
const $ = <T extends HTMLElement = HTMLElement>(id: string): T => {
  const node = document.getElementById(id);
  if (!node) throw Error("BROWSER_ELEMENT_MISSING");
  return node as T;
};
type Wire = Parameters<AnalysisControlTransport["send"]>[0];
export interface InteractionPorts {
  client: () => HeadlessAnalysisReferenceClient;
  engine: SvgMapEngine;
  transport: BrowserTransport;
  observe: (analysisId: string) => Promise<void>;
  detach: () => Promise<void>;
  safe: (action: () => void | Promise<void>) => Promise<void>;
  text: () => string;
}
/** Explicit gestures only; navigation and local drawing never hold this control path. */
export class BrowserAnalysisInteractions {
  private readonly control: AnalysisControlClient;
  private busy = false;
  private pendingWire?: Wire;
  private queryReview?: {
    draftRevision: number;
    revisionId: string;
    scopeHash: string;
    originalText: string;
    contextMode: "CONTINUE" | "REPLACE";
  };
  private points: [number, number][] = [];
  constructor(private readonly ports: InteractionPorts) {
    this.control = new AnalysisControlClient({
      send: async (wire) => {
        if (wire.method === "POST") this.pendingWire = structuredClone(wire);
        return ports.transport.send(wire);
      },
    });
    const on = (id: string, action: () => void | Promise<void>) =>
      $(id).addEventListener("click", () => {
        void ports.safe(action);
      });
    on("confirm-choice", () => this.confirmChoice());
    on("cancel", () => this.cancel());
    on("refresh-source", () => this.refresh());
    on("retry-command", () => this.retry());
    on("detach", ports.detach);
    on("apply-draft", () =>
      this.setDraft(
        queryScopeSchema.parse({
          geometry: JSON.parse($<HTMLTextAreaElement>("draft-geometry").value),
        }),
      ),
    );
    on("clear-draft", () => this.clearDraft());
    on("finish-draw", () => this.finishDrawing());
    on("review-query", () => this.reviewQuery());
    on("confirm-query", () => this.confirmQuery());
    $("draw-mode").addEventListener("change", () => {
      void ports.safe(async () => {
        this.points = [];
        await this.clearDraft();
      });
    });
    for (const id of ["draft-geometry", "context-mode", "query"])
      $(id).addEventListener("input", () => {
        this.queryReview = undefined;
        this.update();
      });
    document.getElementById("map")?.addEventListener(
      "click",
      (event) => {
        const mode = $<HTMLSelectElement>("draw-mode").value;
        if (mode === "NONE") return;
        event.stopImmediatePropagation();
        event.preventDefault();
        const mouse = event as MouseEvent;
        void ports.safe(() =>
          this.drawPoint(mode, mouse.clientX, mouse.clientY),
        );
      },
      true,
    );
    setInterval(() => this.update(), 1000);
  }
  reset(): void {
    this.queryReview = undefined;
    this.pendingWire = undefined;
    this.points = [];
    this.busy = false;
    $("query-review").hidden = true;
    $<HTMLTextAreaElement>("draft-geometry").value = "";
    this.ports.engine.setDraft(undefined);
    this.update();
  }
  update(): void {
    const client = this.ports.client(),
      state = client.state.sharedState,
      v = state?.worldExplanation as unknown as
        WorldAnalysisViewModel | undefined;
    const context = this.context();
    const selected = client.selectedChoice;
    let choiceEnabled = false,
      message = "先检查候选，再显式确认。";
    if (selected && context) {
      if (selected.revisionId !== context.activeRevisionId)
        message = "分析条件已变化，请重新检查当前候选。";
      else {
        const presentation = presentFrozenChoice(context, selected.choice);
        choiceEnabled = presentation.enabled;
        message = selected.choice.displayName + " · " + presentation.message;
      }
    }
    $("selected-choice").textContent = message;
    this.enable("confirm-choice", choiceEnabled && !this.busy);
    const run = state?.analysis.runsById[v?.runId ?? ""];
    const terminal =
      run &&
      [
        "SUCCEEDED",
        "PARTIAL",
        "FAILED",
        "CANCELLED",
        "WAITING_INTERVENTION",
      ].includes(run.status);
    this.enable(
      "cancel",
      !!state && !terminal && run?.status !== "CANCEL_REQUESTED" && !this.busy,
    );
    this.enable("detach", !!state);
    this.enable("refresh-source", !!context && !this.busy);
    this.enable("retry-command", !!this.pendingWire && !this.busy);
    const draft = client.mapPresentation.local.unsubmittedEditDraft;
    const current =
      !!draft && draft["basedOnRevisionId"] === context?.activeRevisionId;
    this.enable("review-query", current && !this.busy);
    const valid =
      this.queryReview &&
      current &&
      this.queryReview.draftRevision === draft?.["draftRevision"] &&
      this.queryReview.revisionId === context?.activeRevisionId;
    this.enable("confirm-query", !!valid && !this.busy);
    $("draft-status").textContent = draft
      ? `本地草稿 ${String(draft["draftRevision"])} · ${current ? "尚未提交" : "Revision 已变化，请重新绘制"}`
      : "尚无草稿。";
  }
  private context(): FrozenAnalysisInteractionContext | undefined {
    const state = this.ports.client().state.sharedState;
    if (
      !state?.worldExplanation ||
      this.ports.client().state.needsFullStateSnapshot
    )
      return undefined;
    return {
      view: state.worldExplanation as unknown as WorldAnalysisViewModel,
      activeRevisionId: state.analysis.activeRevisionId,
      activeRevisionNumber: state.analysis.session.latestRevisionNumber,
      ...(state.pendingIntervention?.status === "OPEN"
        ? { interventionId: state.pendingIntervention.interventionId }
        : {}),
    };
  }
  private enable(id: string, enabled: boolean): void {
    $<HTMLButtonElement>(id).disabled = !enabled;
  }
  private text(): string {
    const text = this.ports.text().trim();
    if (!text) throw Error("请先填写明确的查询条件。");
    return text;
  }
  private ids() {
    const id = crypto.randomUUID();
    return { commandId: "command-" + id, idempotencyKey: "browser-" + id };
  }
  private async execute(
    action: () => Promise<unknown>,
    remember = true,
  ): Promise<void> {
    if (this.busy) throw Error("BROWSER_CONTROL_BUSY");
    const context = this.context();
    if (!context) throw Error("BROWSER_FULL_SNAPSHOT_REQUIRED");
    this.busy = true;
    if (remember) this.pendingWire = undefined;
    this.update();
    const owner = this.ports.client();
    try {
      await action();
      if (owner !== this.ports.client()) return;
      $("connection").textContent = "控制已接收，等待权威 Snapshot…";
      await this.ports.observe(context.view.analysisId);
    } finally {
      if (owner === this.ports.client()) {
        this.busy = false;
        this.update();
      }
    }
  }
  private async confirmChoice(): Promise<void> {
    await this.execute(() =>
      this.ports.client().resolveSelection(this.control, {
        confirmed: true,
        ...this.ids(),
        originalText: this.text(),
      }),
    );
  }
  private async cancel(): Promise<void> {
    const context = this.context();
    if (!context) throw Error("BROWSER_FULL_SNAPSHOT_REQUIRED");
    await this.execute(async () => {
      $("connection").textContent = "正在提交取消意图，等待持久化与来源确认…";
      return this.control.cancelAnalysis(context.view.analysisId, {
        ...this.ids(),
        expectedRevisionId: context.activeRevisionId,
        expectedRevisionNumber: context.activeRevisionNumber,
        reason: "USER_REQUESTED",
      });
    });
  }
  private async refresh(): Promise<void> {
    const context = this.context();
    if (!context) throw Error("BROWSER_FULL_SNAPSHOT_REQUIRED");
    await this.execute(() =>
      this.control.queryFrozenAnalysis({
        context,
        ...this.ids(),
        originalText: this.text(),
        contextMode: "CONTINUE",
      }),
    );
  }
  private async retry(): Promise<void> {
    const wire = this.pendingWire;
    if (!wire) throw Error("BROWSER_REPLAY_UNAVAILABLE");
    const context = this.context();
    if (
      !context ||
      !wire.path.startsWith(
        `/api/v1/analyses/${encodeURIComponent(context.view.analysisId)}/`,
      )
    )
      throw Error("BROWSER_REPLAY_ANALYSIS_CONFLICT");
    await this.execute(async () => {
      const response = await this.ports.transport.send(structuredClone(wire));
      if (response.status < 200 || response.status >= 300)
        throw Error("BROWSER_REPLAY_REJECTED");
      return response.body;
    }, false);
  }
  private async setDraft(scope: QueryScope): Promise<void> {
    this.points = [];
    $<HTMLSelectElement>("draw-mode").value = scope.geometry.type;
    if (scope.geometry.type === "Circle")
      $<HTMLInputElement>("radius").value = String(scope.geometry.radiusMeters);
    await this.ports
      .client()
      .dispatchMapAction({ type: "SET_QUERY_SCOPE", scope });
    this.queryReview = undefined;
    $<HTMLTextAreaElement>("draft-geometry").value = JSON.stringify(
      scope.geometry,
      null,
      2,
    );
    this.ports.engine.setDraft(scope.geometry);
    this.update();
  }
  private async clearDraft(): Promise<void> {
    this.points = [];
    await this.ports.client().dispatchMapAction({ type: "CLEAR_QUERY_SCOPE" });
    this.queryReview = undefined;
    $("query-review").hidden = true;
    $<HTMLTextAreaElement>("draft-geometry").value = "";
    this.ports.engine.setDraft(undefined);
    this.update();
  }
  private async drawPoint(mode: string, x: number, y: number): Promise<void> {
    const position = this.ports.engine.screenPosition(x, y);
    if (!position) throw Error("BROWSER_DRAW_POSITION_INVALID");
    if (mode === "Point")
      await this.setDraft({
        geometry: { type: "Point", coordinates: position },
      });
    else if (mode === "Circle")
      await this.setDraft(
        queryScopeSchema.parse({
          geometry: {
            type: "Circle",
            center: position,
            radiusMeters: Number($<HTMLInputElement>("radius").value),
          },
        }),
      );
    else {
      if (this.points.length >= 255) throw Error("BROWSER_DRAW_LIMIT");
      this.points.push(position);
      $("draft-status").textContent =
        `已记录 ${this.points.length} 个本地点；结束绘制后再检查。`;
    }
  }
  private async finishDrawing(): Promise<void> {
    const mode = $<HTMLSelectElement>("draw-mode").value;
    if (mode === "LineString")
      await this.setDraft(
        queryScopeSchema.parse({
          geometry: { type: mode, coordinates: this.points },
        }),
      );
    else if (mode === "Polygon")
      await this.setDraft(
        queryScopeSchema.parse({
          geometry: {
            type: mode,
            coordinates: [[...this.points, this.points[0]]],
          },
        }),
      );
    else throw Error("请先选择线或闭合面绘制。");
  }
  private reviewQuery(): void {
    const draft =
        this.ports.client().mapPresentation.local.unsubmittedEditDraft,
      context = this.context();
    if (
      !draft ||
      !context ||
      draft["basedOnRevisionId"] !== context.activeRevisionId
    )
      throw Error("QUERY_DRAFT_CONFLICT");
    const scope = queryScopeSchema.parse(draft["scope"]),
      contextMode = $<HTMLSelectElement>("context-mode").value as
        "CONTINUE" | "REPLACE";
    this.queryReview = {
      draftRevision: Number(draft["draftRevision"]),
      revisionId: context.activeRevisionId,
      scopeHash: hashCanonicalJson(scope.geometry),
      originalText: this.text(),
      contextMode,
    };
    $("query-review").textContent = JSON.stringify(
      { ...this.queryReview, geometry: scope.geometry },
      null,
      2,
    );
    $("query-review").hidden = false;
    this.update();
  }
  private async confirmQuery(): Promise<void> {
    const review = this.queryReview;
    if (!review) throw Error("QUERY_CONFIRMATION_REQUIRED");
    const draft =
      this.ports.client().mapPresentation.local.unsubmittedEditDraft;
    if (
      !draft ||
      review.scopeHash !==
        hashCanonicalJson(queryScopeSchema.parse(draft["scope"]).geometry)
    )
      throw Error("QUERY_DRAFT_CONFLICT");
    await this.execute(() =>
      this.ports.client().submitNewQuery(this.control, {
        confirmed: true,
        ...this.ids(),
        expectedDraftRevision: review.draftRevision,
        originalText: review.originalText,
        contextMode: review.contextMode,
      }),
    );
  }
}
