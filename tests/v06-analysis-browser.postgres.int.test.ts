import { mkdir } from "node:fs/promises";
import { afterAll, beforeAll, describe, it, expect, jest } from "@jest/globals";
import { chromium, type Browser, type Page } from "playwright-core";
import {
  createBrowserAnalysisFixture,
  browserJwt,
} from "./helpers/browser-analysis.js";
import { publicCanonicalHash } from "../packages/wsgs-geospatial-consumer/src/frozen-world-analysis.js";
const databaseUrl = process.env.TEST_DATABASE_URL;
const suite = databaseUrl ? describe : describe.skip;
jest.setTimeout(120000);
const evidenceDir = process.env.SACS_BROWSER_EVIDENCE_DIR ?? ".tmp/v06-browser";
let browser: Browser;
beforeAll(async () => {
  if (databaseUrl) browser = await chromium.launch({ headless: true });
});
afterAll(async () => {
  await browser?.close();
});
type Fixture = Awaited<ReturnType<typeof createBrowserAnalysisFixture>>;
async function login(page: Page, fixture: Fixture) {
  await page.clock.setFixedTime(new Date(fixture.nowMillis()));
  await page.goto(fixture.baseUrl + "/analysis");
  await page
    .locator("#jwt")
    .fill(browserJwt("browser-user", fixture.nowMillis()));
  await page.getByRole("button", { name: "登录", exact: true }).click();
  await page.locator("#workspace").waitFor({ state: "visible" });
}
async function start(page: Page, text = "查询历史指标排名") {
  await page.locator("#query").fill(text);
  await page.locator("#start").click();
  await page.waitForFunction(
    () => document.getElementById("revision")?.dataset["analysisId"],
  );
  await page.waitForFunction(
    () => document.getElementById("start")?.getAttribute("disabled") === null,
  );
  expect(await page.locator("#error").isVisible()).toBe(false);
}
async function changed(page: Page, previous: string | null) {
  await page.waitForFunction((old) => {
    const id = document.getElementById("revision")?.dataset["revisionId"];
    return id && id !== old;
  }, previous);
  await page.waitForFunction(() =>
    document
      .getElementById("connection")
      ?.textContent?.includes("观察窗口结束"),
  );
}
suite("browser explicit controls over actual HTTP and PostgreSQL", () => {
  it("inspects locally and confirms one exact selector, with double-click and same-key replay creating one revision", async () => {
    const fixture = await createBrowserAnalysisFixture(
      {},
      undefined,
      databaseUrl,
    );
    const context = await browser.newContext();
    const page = await context.newPage();
    try {
      await login(page, fixture);
      await start(page);
      const old = await page
        .locator("#revision")
        .getAttribute("data-revision-id");
      const analysisId = await page
        .locator("#revision")
        .getAttribute("data-analysis-id");
      await page.locator("#choices button").first().click();
      expect(fixture.peer.requests).toHaveLength(1);
      await page.waitForFunction(
        () =>
          !(document.getElementById("confirm-choice") as HTMLButtonElement)
            .disabled,
      );
      await page.locator("#confirm-choice").dblclick();
      await changed(page, old);
      expect(fixture.peer.requests).toHaveLength(2);
      expect(
        await page.locator("#revision").getAttribute("data-analysis-id"),
      ).toBe(analysisId);
      const prior = fixture.peer.results[0]!,
        choice = prior.worldAnalysisFindings.choices[0]!;
      expect(fixture.peer.requests[1]?.analysisSelections).toEqual([
        {
          priorGroundingId: prior.groundingId,
          priorResultHash: prior.resultHash,
          findingSetHash: prior.worldAnalysisFindings.findingSetHash,
          choiceId: choice.choiceId,
          candidateId: choice.candidates[0]!.candidateId,
        },
      ]);
      await page.locator("#retry-command").click();
      await page.waitForFunction(() =>
        document
          .getElementById("connection")
          ?.textContent?.includes("观察窗口结束"),
      );
      expect(fixture.peer.requests).toHaveLength(2);
      const rows = await fixture.databaseProbe!.query<{
        revision_number: number;
      }>(
        "SELECT revision_number FROM chat_service.analysis_revision WHERE analysis_id=$1 ORDER BY revision_number",
        [analysisId],
      );
      expect(rows.rows.map((r) => r.revision_number)).toEqual([0, 1]);
    } finally {
      await context.close();
      await fixture.close();
    }
  });
  it("draws local geometry, invalidates old reviews, and submits exact Point/Line/Polygon/Circle with CONTINUE and REPLACE", async () => {
    const fixture = await createBrowserAnalysisFixture(
      {},
      undefined,
      databaseUrl,
    );
    const context = await browser.newContext();
    const page = await context.newPage();
    try {
      await login(page, fixture);
      await start(page);
      await page.locator("#draw-mode").selectOption("Point");
      await page.locator("#map").click({ position: { x: 300, y: 150 } });
      await page.waitForFunction(
        () =>
          document.getElementById("draft-geometry")?.textContent !== "" ||
          (document.getElementById("draft-geometry") as HTMLTextAreaElement)
            .value !== "",
      );
      expect(fixture.peer.requests).toHaveLength(1);
      await page.locator("#review-query").click();
      expect(await page.locator("#query-review").isVisible()).toBe(true);
      await page.locator("#clear-draft").click();
      expect(await page.locator("#confirm-query").isDisabled()).toBe(true);
      expect(fixture.peer.requests).toHaveLength(1);
      const scopes = [
        { type: "Point", coordinates: [116.39, 39.9] },
        {
          type: "LineString",
          coordinates: [
            [116.39, 39.9],
            [116.4, 39.91],
          ],
        },
        {
          type: "Polygon",
          coordinates: [
            [
              [116.39, 39.9],
              [116.4, 39.9],
              [116.4, 39.91],
              [116.39, 39.9],
            ],
          ],
        },
        { type: "Circle", center: [116.39, 39.9], radiusMeters: 125 },
      ];
      for (const [index, geometry] of scopes.entries()) {
        const old = await page
            .locator("#revision")
            .getAttribute("data-revision-id"),
          mode = index % 2 ? "REPLACE" : "CONTINUE";
        await page.locator("#draft-geometry").fill(JSON.stringify(geometry));
        await page.locator("#apply-draft").click();
        await page.locator("#context-mode").selectOption(mode);
        await page.locator("#review-query").click();
        expect(await page.locator("#query-review").textContent()).toContain(
          publicCanonicalHash(geometry),
        );
        expect(fixture.peer.requests).toHaveLength(index + 1);
        await page.locator("#confirm-query").click();
        await changed(page, old);
        const request = fixture.peer.requests[index + 1]!;
        expect(request.contextCapsule.mapSelections[0]).toMatchObject({
          geometry,
          geometryHash: publicCanonicalHash(geometry),
        });
        expect(request.contextCapsule.priorGroundings).toHaveLength(
          mode === "CONTINUE" ? 1 : 0,
        );
        expect(request.executionPolicy).toMatchObject({
          readOnly: true,
          allowApproximation: false,
        });
      }
      expect(fixture.peer.requests).toHaveLength(5);
      expect(await page.locator("#activity .badge").count()).toBe(1);
      expect(await page.locator("#radius").inputValue()).toBe("125");
      await mkdir(evidenceDir, {
        recursive: true,
      });
      await page.screenshot({
        path: evidenceDir + "/scope.png",
        fullPage: true,
      });
    } finally {
      await context.close();
      await fixture.close();
    }
  });
  it("keeps expired choices readable and replays an uncertain committed query with exactly the same command", async () => {
    const fixture = await createBrowserAnalysisFixture(
      {},
      undefined,
      databaseUrl,
    );
    const context = await browser.newContext();
    const page = await context.newPage();
    const commands: unknown[] = [];
    try {
      await login(page, fixture);
      await start(page);
      await page.locator("#choices button").first().click();
      fixture.setClock(fixture.nowMillis() + 61000);
      await page.clock.setFixedTime(new Date(fixture.nowMillis()));
      await page.waitForFunction(
        () =>
          (document.getElementById("confirm-choice") as HTMLButtonElement)
            .disabled,
      );
      expect(await page.locator("#selected-choice").textContent()).toContain(
        "过期",
      );
      expect(await page.locator("#choices .card").count()).toBeGreaterThan(0);
      expect(fixture.peer.requests).toHaveLength(1);
      const old = await page
        .locator("#revision")
        .getAttribute("data-revision-id");
      await page.route(
        "**/analysis/api/v1/analyses/*/proposals",
        async (route) => {
          commands.push(route.request().postDataJSON());
          const response = await route.fetch();
          expect(response.status()).toBe(202);
          await route.abort("failed");
        },
      );
      await page.locator("#refresh-source").click();
      await page.locator("#error").waitFor({ state: "visible" });
      expect(fixture.peer.requests).toHaveLength(2);
      expect(
        await page.locator("#revision").getAttribute("data-revision-id"),
      ).toBe(old);
      await page.unroute("**/analysis/api/v1/analyses/*/proposals");
      page.on("request", (request) => {
        if (request.url().endsWith("/proposals"))
          commands.push(request.postDataJSON());
      });
      await page.locator("#retry-command").click();
      await changed(page, old);
      expect(commands).toHaveLength(2);
      expect(commands[1]).toEqual(commands[0]);
      expect(fixture.peer.requests).toHaveLength(2);
    } finally {
      await context.close();
      await fixture.close();
    }
  });
  it("detaches and reconnects without START, and shows CANCEL_REQUESTED until a public terminal status", async () => {
    const fixture = await createBrowserAnalysisFixture(
      { async: true, repeatedRunning: 100000, deferCancel: true },
      undefined,
      databaseUrl,
    );
    const context = await browser.newContext();
    const page = await context.newPage();
    try {
      await login(page, fixture);
      await start(page, "查询仍在运行的历史轨迹");
      const old = await page
        .locator("#revision")
        .getAttribute("data-revision-id");
      await page.locator("#detach").click();
      expect(
        fixture.peer.captured.some((r) => r.path.endsWith(":cancel")),
      ).toBe(false);
      await page.locator("#reconnect").click();
      await page.waitForFunction(() =>
        document
          .getElementById("connection")
          ?.textContent?.includes("来源仍在运行"),
      );
      expect(fixture.peer.requests).toHaveLength(1);
      expect(
        await page.locator("#revision").getAttribute("data-revision-id"),
      ).toBe(old);
      await page.locator("#cancel").click();
      await page.waitForFunction(() =>
        document
          .getElementById("connection")
          ?.textContent?.includes("CANCEL_REQUESTED"),
      );
      expect(await page.locator("#revision").textContent()).not.toContain(
        "CANCELLED",
      );
      expect(
        [...fixture.peer.jobs.values()].every((row) => row.cancelled !== true),
      ).toBe(true);
      for (const row of fixture.peer.jobs.values())
        if (row.cancelRequested) row.cancelled = true;
      await page.waitForFunction(() =>
        document.getElementById("revision")?.textContent?.includes("CANCELLED"),
      );
      expect(fixture.peer.requests).toHaveLength(1);
      const status = await fixture.databaseProbe!.query<{
        last_source_status: string;
        cancel_requested: boolean;
      }>(
        "SELECT last_source_status,cancel_requested FROM chat_service.grounding_execution",
      );
      expect(status.rows[0]).toMatchObject({
        last_source_status: "CANCELLED",
        cancel_requested: true,
      });
    } finally {
      await context.close();
      await fixture.close();
    }
  });
});
