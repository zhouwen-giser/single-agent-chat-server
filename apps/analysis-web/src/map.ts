import type { QueryScope } from "../../../packages/analysis-contract/src/query-scope.js";
import type {
  MapEngineAdapter,
  AnalysisClientMapAction,
} from "../../../packages/analysis-client/src/index.js";
import type {
  MapSharedState,
  FocusTarget,
} from "../../../packages/analysis-contract/src/index.js";
const ns = "http://www.w3.org/2000/svg";
type Position = [number, number];
type Bounds = { west: number; south: number; east: number; north: number };
const point = (v: unknown): v is Position =>
  Array.isArray(v) &&
  v.length === 2 &&
  v.every((x) => typeof x === "number" && Number.isFinite(x)) &&
  Math.abs(v[0]) <= 180 &&
  Math.abs(v[1]) <= 90;
const record = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);

/** Offline SVG port. It draws each published geometry independently, without joining gaps. */
export class SvgMapEngine implements MapEngineAdapter {
  private scene?: MapSharedState;
  private bounds: Bounds = { west: -180, south: -90, east: 180, north: 90 };
  private focus?: FocusTarget;
  private positions: Position[] = [];
  private origin: Position = [0, 0];
  private draft?: QueryScope["geometry"];
  private shapes = 0;
  private unknown = 0;
  constructor(
    private readonly svg: SVGSVGElement,
    private readonly status: HTMLElement,
    private readonly inspect: (layerId: string) => void,
  ) {}
  replaceScene(scene: Readonly<Record<string, unknown>>): void {
    this.scene = scene as MapSharedState;
    const initial = this.positions.length === 0;
    this.svg.replaceChildren();
    this.positions = [];
    for (const layer of Object.values(this.scene.layersById))
      if (layer.visibleByDefault && layer.access.kind === "INLINE_GEOJSON")
        this.collect(layer.access.data, 0);
    // Translate display coordinates only: large absolute coordinates lose SVG
    // float precision at close zoom. Original positions and public state stay exact.
    this.origin = this.positions[0] ?? [0, 0];
    this.positions = [];
    this.shapes = 0;
    this.unknown = 0;
    for (const layer of Object.values(this.scene.layersById)) {
      if (!layer.visibleByDefault) continue;
      if (layer.access.kind !== "INLINE_GEOJSON") {
        this.unknown++;
        continue;
      }
      const group = document.createElementNS(ns, "g");
      group.dataset["layerId"] = layer.layerId;
      group.addEventListener("click", () => this.inspect(layer.layerId));
      this.draw(layer.access.data, group, 0);
      this.svg.append(group);
    }
    if (initial && this.positions.length) this.fitAll();
    this.renderDraft();
    this.updateView();
    this.highlight();
    this.status.textContent = this.shapes
      ? `${this.shapes} 个独立公开几何；${this.unknown} 个无几何或未知表示。`
      : "尚无可绘制的公开几何；位置未知或来源未发布。";
  }
  screenPosition(x: number, y: number): Position | undefined {
    const matrix = this.svg.getScreenCTM();
    if (!matrix) return undefined;
    const local = new DOMPoint(x, y).matrixTransform(matrix.inverse());
    const position: Position = [
      local.x + this.origin[0],
      this.origin[1] - local.y,
    ];
    return point(position) ? position : undefined;
  }
  setDraft(geometry: QueryScope["geometry"] | undefined): void {
    this.draft = geometry ? structuredClone(geometry) : undefined;
    this.renderDraft();
    this.updateView();
  }
  private renderDraft(): void {
    this.svg.querySelector(".draft-preview")?.remove();
    if (!this.draft) return;
    const group = document.createElementNS(ns, "g");
    group.setAttribute("class", "draft-preview");
    const positions = this.positions,
      shapes = this.shapes,
      unknown = this.unknown;
    this.positions = [];
    const geometry =
      this.draft.type === "Circle"
        ? { type: "Point", coordinates: this.draft.center }
        : this.draft;
    this.draw(geometry, group, 0);
    this.positions = positions;
    this.shapes = shapes;
    this.unknown = unknown;
    this.svg.append(group);
  }
  setInspectionFocus(value: unknown): void {
    this.focus = record(value) ? (value as FocusTarget) : undefined;
    this.highlight();
  }
  disconnect(): void {
    /* Keep the last public view on observer detach. */
  }
  applyLocalMapAction(action: AnalysisClientMapAction): void {
    if (action.type === "PAN") {
      const v = action.viewport;
      if (
        [v["west"], v["south"], v["east"], v["north"]].every(
          (n) => typeof n === "number" && Number.isFinite(n),
        )
      )
        this.bounds = {
          west: v["west"]!,
          south: v["south"]!,
          east: v["east"]!,
          north: v["north"]!,
        };
      this.updateView();
    } else if (action.type === "ZOOM") this.zoom(action.zoom);
    else if (action.type === "FIT_LAYER" || action.type === "FIT_FINDING") {
      if (!this.scene) return;
      const wanted = Object.values(this.scene.layersById).filter((l) =>
        action.type === "FIT_LAYER"
          ? l.layerId === action.layerId
          : l.findingIds.includes(action.findingId),
      );
      const saved = this.positions;
      this.positions = [];
      for (const layer of wanted)
        if (layer.access.kind === "INLINE_GEOJSON")
          this.collect(layer.access.data, 0);
      this.fitAll();
      this.positions = saved;
    }
  }
  fitAll(): void {
    if (!this.positions.length) return;
    const xs = this.positions.map((p) => p[0]),
      ys = this.positions.map((p) => p[1]);
    const west = Math.min(...xs),
      east = Math.max(...xs),
      south = Math.min(...ys),
      north = Math.max(...ys);
    const padding = Math.max(east - west, north - south, 0.002) * 0.1;
    this.bounds = {
      west: west - padding,
      east: east + padding,
      south: south - padding,
      north: north + padding,
    };
    this.updateView();
  }
  pan(direction: number): Bounds {
    const offset = (this.bounds.east - this.bounds.west) * 0.2 * direction;
    return {
      ...this.bounds,
      west: this.bounds.west + offset,
      east: this.bounds.east + offset,
    };
  }
  private zoom(factor: number): void {
    if (!(factor >= 0.1 && factor <= 10)) return;
    const x = (this.bounds.west + this.bounds.east) / 2,
      y = (this.bounds.south + this.bounds.north) / 2;
    const w = Math.max(
        (this.bounds.east - this.bounds.west) / factor,
        0.000001,
      ),
      h = Math.max((this.bounds.north - this.bounds.south) / factor, 0.000001);
    this.bounds = {
      west: x - w / 2,
      east: x + w / 2,
      south: y - h / 2,
      north: y + h / 2,
    };
    this.updateView();
  }
  private updateView(): void {
    const w = Math.max(this.bounds.east - this.bounds.west, 0.000001),
      h = Math.max(this.bounds.north - this.bounds.south, 0.000001);
    this.svg.setAttribute(
      "viewBox",
      `${this.bounds.west - this.origin[0]} ${this.origin[1] - this.bounds.north} ${w} ${h}`,
    );
    for (const circle of Array.from(this.svg.querySelectorAll("circle")))
      circle.setAttribute("r", String(Math.max(w, h) * 0.012));
  }
  private highlight(): void {
    for (const group of Array.from(this.svg.querySelectorAll("g")))
      for (const shape of Array.from(group.children))
        shape.classList.toggle(
          "focused",
          this.focus?.layerId !== undefined &&
            group.dataset["layerId"] === this.focus.layerId,
        );
  }
  private collect(value: unknown, depth: number): void {
    if (depth > 8 || this.positions.length >= 32768) return;
    if (point(value)) this.positions.push(value);
    else if (Array.isArray(value))
      for (const child of value) this.collect(child, depth + 1);
    else if (record(value)) {
      if (value["type"] === "Feature")
        this.collect(value["geometry"], depth + 1);
      else if (value["type"] === "FeatureCollection")
        this.collect(value["features"], depth + 1);
      else if (value["type"] === "GeometryCollection")
        this.collect(value["geometries"], depth + 1);
      else this.collect(value["coordinates"], depth + 1);
    }
  }
  private draw(value: unknown, parent: SVGGElement, depth: number): void {
    if (depth > 8 || this.shapes >= 32768 || !record(value)) {
      this.unknown++;
      return;
    }
    const type = value["type"],
      coordinates = value["coordinates"];
    if (type === "Feature") {
      this.draw(value["geometry"], parent, depth + 1);
      return;
    }
    if (type === "FeatureCollection" || type === "GeometryCollection") {
      const entries =
        value[type === "FeatureCollection" ? "features" : "geometries"];
      if (Array.isArray(entries))
        for (const entry of entries.slice(0, 32768))
          this.draw(entry, parent, depth + 1);
      else this.unknown++;
      return;
    }
    const add = (
      tag: string,
      attrs: Record<string, string>,
      positions: Position[],
    ) => {
      if (this.positions.length + positions.length > 32768) {
        this.unknown++;
        return;
      }
      const shape = document.createElementNS(ns, tag);
      shape.setAttribute(
        "class",
        "geometry" + (tag === "circle" ? " point" : ""),
      );
      for (const [key, v] of Object.entries(attrs)) shape.setAttribute(key, v);
      parent.append(shape);
      this.positions.push(...positions);
      this.shapes++;
    };
    const line = (v: unknown): v is Position[] =>
      Array.isArray(v) && v.length >= 2 && v.length <= 32768 && v.every(point);
    const xy = (p: Position) =>
      `${p[0] - this.origin[0]},${this.origin[1] - p[1]}`;
    if (type === "Point" && point(coordinates))
      add(
        "circle",
        {
          cx: String(coordinates[0] - this.origin[0]),
          cy: String(this.origin[1] - coordinates[1]),
          r: "0.001",
        },
        [coordinates],
      );
    else if (
      type === "MultiPoint" &&
      Array.isArray(coordinates) &&
      coordinates.every(point)
    )
      for (const p of coordinates)
        add(
          "circle",
          {
            cx: String(p[0] - this.origin[0]),
            cy: String(this.origin[1] - p[1]),
            r: "0.001",
          },
          [p],
        );
    else if (type === "LineString" && line(coordinates))
      add(
        "polyline",
        { points: coordinates.map(xy).join(" "), fill: "none" },
        coordinates,
      );
    else if (
      type === "MultiLineString" &&
      Array.isArray(coordinates) &&
      coordinates.every(line)
    )
      for (const l of coordinates)
        add("polyline", { points: l.map(xy).join(" "), fill: "none" }, l);
    else if (
      type === "Polygon" &&
      Array.isArray(coordinates) &&
      coordinates.length &&
      coordinates.every(line)
    ) {
      if (
        !coordinates.every(
          (r) =>
            r.length >= 4 &&
            r[0]?.[0] === r.at(-1)?.[0] &&
            r[0]?.[1] === r.at(-1)?.[1],
        )
      ) {
        this.unknown++;
        return;
      }
      const paths = coordinates
        .map((r) => "M " + r.map(xy).join(" L ") + " Z")
        .join(" ");
      add("path", { d: paths, "fill-rule": "evenodd" }, coordinates.flat());
    } else if (type === "MultiPolygon" && Array.isArray(coordinates))
      for (const c of coordinates)
        this.draw({ type: "Polygon", coordinates: c }, parent, depth + 1);
    else this.unknown++;
  }
}
