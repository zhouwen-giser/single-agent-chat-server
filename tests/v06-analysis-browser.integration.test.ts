import { execFileSync } from "node:child_process";
import { mkdir, readFile } from "node:fs/promises";
import { afterAll, beforeAll, describe, it, expect, jest } from "@jest/globals";
import { chromium, type Browser, type Page } from "playwright-core";
import {
  createBrowserAnalysisFixture,
  browserJwt,
  browserSecrets,
} from "./helpers/browser-analysis.js";
import { publicExample } from "./helpers/frozen-wsgs-http.js";
import type { GroundingResult12 } from "../packages/wsgs-geospatial-consumer/src/frozen-world-analysis.js";
import { frozenNow } from "./helpers/memory-frozen-analysis.js";
jest.setTimeout(120000);
const evidenceDir = process.env.SACS_BROWSER_EVIDENCE_DIR ?? ".tmp/v06-browser";
let browser: Browser;
beforeAll(async () => {
  browser = await chromium.launch({ headless: true });
});
afterAll(async () => {
  await browser?.close();
});
async function login(page: Page, url: string, user = "browser-user") {
  await page.clock.setFixedTime(frozenNow());
  await page.goto(url + "/analysis");
  await page.locator("#jwt").fill(browserJwt(user));
  await page.getByRole("button", { name: "登录", exact: true }).click();
  await page.locator("#workspace").waitFor({ state: "visible" });
}
async function query(page: Page, text = "查询历史轨迹") {
  await page.locator("#query").fill(text);
  await page.locator("#start").click();
  await page.waitForFunction(
    () => document.getElementById("revision")?.dataset["analysisId"],
  );
  await page.waitForFunction(() =>
    document
      .getElementById("connection")
      ?.textContent?.includes("观察窗口结束"),
  );
  expect(await page.locator("#error").isVisible()).toBe(false);
}
describe("actual Chromium world reference client", () => {
  it("draws disjoint line/polygon/point geometry and reports unknown representation without fetching it", async () => {
    const moduleText = execFileSync(
      "node_modules/esbuild/bin/esbuild",
      [
        "apps/analysis-web/src/map.ts",
        "--bundle",
        "--format=esm",
        "--platform=browser",
      ],
      { encoding: "utf8" },
    );
    const fixture = await createBrowserAnalysisFixture({}, async (server) => {
      server.get("/analysis/test-map.js", async (_request, reply) =>
        reply.type("application/javascript").send(moduleText),
      );
    });
    const context = await browser.newContext();
    const page = await context.newPage();
    try {
      await page.goto(fixture.baseUrl + "/analysis");
      const result = await page.evaluate(async () => {
        const path = "/analysis/test-map.js";
        const module = await import(path);
        const svg = document.createElementNS(
            "http://www.w3.org/2000/svg",
            "svg",
          ),
          status = document.createElement("p");
        document.body.append(svg, status);
        const engine = new module.SvgMapEngine(svg, status, () => undefined);
        engine.replaceScene({
          layersById: {
            points: {
              layerId: "points",
              visibleByDefault: true,
              access: {
                kind: "INLINE_GEOJSON",
                data: {
                  type: "MultiPoint",
                  coordinates: [
                    [1, 2],
                    [3, 4],
                  ],
                },
              },
            },
            lines: {
              layerId: "lines",
              visibleByDefault: true,
              access: {
                kind: "INLINE_GEOJSON",
                data: {
                  type: "MultiLineString",
                  coordinates: [
                    [
                      [1, 2],
                      [3, 4],
                    ],
                    [
                      [10, 20],
                      [11, 21],
                    ],
                  ],
                },
              },
            },
            polygon: {
              layerId: "polygon",
              visibleByDefault: true,
              access: {
                kind: "INLINE_GEOJSON",
                data: {
                  type: "Polygon",
                  coordinates: [
                    [
                      [0, 0],
                      [0, 2],
                      [2, 2],
                      [0, 0],
                    ],
                  ],
                },
              },
            },
            unknown: {
              layerId: "unknown",
              visibleByDefault: true,
              access: {
                kind: "PAYLOAD_REFERENCE",
                payloadRef: "https://attacker.invalid/private",
              },
            },
          },
        });
        return {
          points: svg.querySelectorAll("circle").length,
          lines: Array.from(svg.querySelectorAll("polyline")).map((x) =>
            x.getAttribute("points"),
          ),
          polygons: svg.querySelectorAll("path").length,
          text: status.textContent,
        };
      });
      expect(result.points).toBe(2);
      expect(result.lines).toEqual(["0,0 2,-2", "9,-18 10,-19"]);
      expect(result.polygons).toBe(1);
      expect(result.text).toContain("1 个无几何或未知表示");
      expect(fixture.peer.requests).toHaveLength(0);
    } finally {
      await context.close();
      await fixture.close();
    }
  });
  it("authenticates same-origin sessions, fences CSRF and keeps service keys server-side", async () => {
    const fixture = await createBrowserAnalysisFixture();
    const context = await browser.newContext();
    const page = await context.newPage();
    try {
      const anonymous = await context.request.get(
        fixture.baseUrl + "/analysis/api/v1/analyses",
      );
      expect(anonymous.status()).toBe(401);
      const forged = await context.request.post(
        fixture.baseUrl + "/analysis/session",
        {
          headers: { origin: fixture.baseUrl },
          data: { jwt: "forged", userId: "admin" },
        },
      );
      expect(forged.status()).toBe(401);
      const cross = await context.request.post(
        fixture.baseUrl + "/analysis/session",
        {
          headers: { origin: "https://attacker.invalid" },
          data: { jwt: browserJwt() },
        },
      );
      expect(cross.status()).toBe(403);
      await login(page, fixture.baseUrl);
      expect(await page.locator("#jwt").inputValue()).toBe("");
      const cookies = await context.cookies();
      expect(cookies).toHaveLength(1);
      expect(cookies[0]).toMatchObject({
        httpOnly: true,
        sameSite: "Strict",
        path: "/analysis",
      });
      expect(await page.evaluate(() => document.cookie)).toBe("");
      expect(await page.evaluate(() => Object.keys(localStorage))).toEqual([]);
      const noCsrf = await context.request.post(
        fixture.baseUrl + "/analysis/ag-ui",
        { headers: { origin: fixture.baseUrl }, data: {} },
      );
      expect(noCsrf.status()).toBe(403);
      const script = await readFile(
        "dist/apps/analysis-web/public/app.js",
        "utf8",
      );
      for (const value of Object.values(browserSecrets))
        expect(script).not.toContain(value);
      const manifest = JSON.parse(
        await readFile(
          "dist/apps/analysis-web/public/bundle-manifest.json",
          "utf8",
        ),
      );
      expect(manifest.nodeBuiltins).toEqual([]);
      fixture.setClock(frozenNow().getTime() + 300000);
      expect(
        (
          await context.request.get(fixture.baseUrl + "/analysis/session")
        ).status(),
      ).toBe(401);
      expect(fixture.peer.requests).toHaveLength(0);
    } finally {
      await context.close();
      await fixture.close();
    }
  });
  it("draws public trace geometries and time gaps; local navigation creates no work", async () => {
    const fixture = await createBrowserAnalysisFixture({
      examples: ["trace"],
      transformResult: (result) => {
        const trace = result.worldAnalysisFindings.findings[0];
        if (trace?.findingKind === "HISTORICAL_TRACE")
          trace.trajectoryGaps.push({
            period: trace.requestedPeriods[0]!,
            kind: "UNKNOWN_GAP",
            reasonCodes: ["SOURCE_PARTIAL"],
          });
        const event =
          publicExample<GroundingResult12>("event-incomplete")
            .worldAnalysisFindings.findings[0]!;
        result.worldAnalysisFindings.findings.push(event);
      },
    });
    const context = await browser.newContext();
    const page = await context.newPage();
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    try {
      await login(page, fixture.baseUrl);
      await query(page);
      expect(await page.locator("#map .geometry").count()).toBeGreaterThan(0);
      const visible = await page.locator("#map circle").first().boundingBox();
      const mapBox = await page.locator("#map").boundingBox();
      expect(
        visible &&
          mapBox &&
          visible.width > 0 &&
          visible.height > 0 &&
          visible.x >= mapBox.x &&
          visible.y >= mapBox.y &&
          visible.x < mapBox.x + mapBox.width &&
          visible.y < mapBox.y + mapBox.height,
      ).toBe(true);
      expect(await page.locator("#timeline .gap").count()).toBeGreaterThan(0);
      const network = fixture.peer.captured.length;
      const old = await page.locator("#map").getAttribute("viewBox");
      await page.locator("#zoom-in").click();
      expect(await page.locator("#map").getAttribute("viewBox")).not.toBe(old);
      await page.locator("#pan-right").click();
      await page.locator("#fit").click();
      await page.locator("#findings button").first().click();
      await page.locator("#timeline button").first().click();
      const checkbox = page.locator("#layers input").first();
      await checkbox.uncheck();
      await checkbox.check();
      expect(fixture.peer.requests).toHaveLength(1);
      expect(fixture.peer.captured).toHaveLength(network);
      expect(errors).toEqual([]);
      await mkdir(evidenceDir, {
        recursive: true,
      });
      await page.locator("#map").screenshot({
        path: evidenceDir + "/map.png",
      });
      await page.screenshot({
        path: evidenceDir + "/trace.png",
        fullPage: true,
      });
    } finally {
      await context.close();
      await fixture.close();
    }
  });
  it("retains candidate, evidence and product identities and restores its authorized directory", async () => {
    const fixture = await createBrowserAnalysisFixture();
    const context = await browser.newContext();
    const page = await context.newPage();
    try {
      await login(page, fixture.baseUrl);
      await query(page, "查询历史指标排名");
      const source = fixture.peer.results[0]!;
      const choice = source.worldAnalysisFindings.choices[0]!;
      expect(
        await page
          .locator("#choices .card")
          .first()
          .getAttribute("data-candidate-id"),
      ).toBe(choice.candidates[0]!.candidateId);
      await page.locator("#choices button").first().click();
      expect(await page.locator("#inspection").textContent()).toContain(
        choice.choiceId,
      );
      expect(await page.locator("#evidence button").count()).toBeGreaterThan(0);
      const analysisId = await page
        .locator("#revision")
        .getAttribute("data-analysis-id");
      const count = fixture.peer.requests.length;
      await page.reload();
      await page.locator("#workspace").waitFor({ state: "visible" });
      await page.locator("#directory button").first().click();
      await page.waitForFunction(
        (id) =>
          document.getElementById("revision")?.dataset["analysisId"] === id,
        analysisId,
      );
      expect(fixture.peer.requests).toHaveLength(count);
      await page.locator("#choices button").first().click();
      await page.locator("#logout").click();
      await page.locator("#login-panel").waitFor({ state: "visible" });
      await page.locator("#jwt").fill(browserJwt("other-user"));
      await page.getByRole("button", { name: "登录", exact: true }).click();
      await page.locator("#workspace").waitFor({ state: "visible" });
      expect(await page.locator("#inspection").textContent()).not.toContain(
        choice.choiceId,
      );
      expect(
        await page.locator("#revision").getAttribute("data-analysis-id"),
      ).toBeNull();
      expect(await page.locator("#query").inputValue()).toBe("");
      expect(await page.locator("#directory button").count()).toBe(0);
      const foreign = await browser.newContext();
      const foreignPage = await foreign.newPage();
      try {
        await login(foreignPage, fixture.baseUrl, "other-user");
        expect(await foreignPage.locator("#directory button").count()).toBe(0);
        expect(
          (
            await foreign.request.get(
              fixture.baseUrl +
                "/analysis/api/v1/analyses/" +
                analysisId +
                "/snapshot",
            )
          ).status(),
        ).toBe(404);
      } finally {
        await foreign.close();
      }
    } finally {
      await context.close();
      await fixture.close();
    }
  });
  it("renders public text as text, blocks external resources and reports no-data honestly", async () => {
    const fixture = await createBrowserAnalysisFixture({
      examples: ["trace-no-data"],
      transformResult: (result) => {
        result.warnings.push(
          '<img src="https://attacker.invalid/pixel" onerror="window.injected=true">',
        );
      },
    });
    const context = await browser.newContext();
    const page = await context.newPage();
    const external: string[] = [];
    page.on("request", (req) => {
      if (!req.url().startsWith(fixture.baseUrl)) external.push(req.url());
    });
    try {
      await login(page, fixture.baseUrl);
      await query(page);
      expect(await page.locator("#map .geometry").count()).toBe(0);
      expect(await page.locator("#map-status").textContent()).toContain("尚无");
      expect(await page.locator("#summary").textContent()).toContain("<img");
      expect(await page.locator("#summary img").count()).toBe(0);
      expect(external).toEqual([]);
      const response = await context.request.get(fixture.baseUrl + "/analysis");
      expect(response.headers()["content-security-policy"]).toContain(
        "connect-src 'self'",
      );
      const unavailable = await context.request.get(
        fixture.baseUrl + "/analysis/api/v1/providers/private",
      );
      expect(unavailable.status()).toBe(404);
    } finally {
      await context.close();
      await fixture.close();
    }
  });
});
