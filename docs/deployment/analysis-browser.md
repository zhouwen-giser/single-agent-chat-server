# Browser world analysis reference client

SACS serves its own reference page at `/analysis` when explicitly enabled. It uses the existing AG-UI v0.3 Grounding handler, validated Snapshot/Activity reducer and Analysis Control API. Open WebUI's source is unchanged. The directory lists at most 100 newest analyses bound to the authenticated identity's AG-UI threads; OpenAI chat thread bindings keep their existing presentation and are not silently remapped into AG-UI threads.

Build the page independently or with the normal build:

```bash
corepack pnpm build:analysis-web
corepack pnpm build
```

After ordinary PostgreSQL, model and signed identity configuration, set:

```dotenv
SACS_WSGS_ANALYSIS_ENABLED=true
SACS_ANALYSIS_WEB_ENABLED=true
SACS_ANALYSIS_WEB_ORIGIN=https://sacs.example
```

The origin must exactly identify the public same-origin URL, with no path, query or credentials. For isolated local use, an explicit `http://127.0.0.1:PORT` origin is supported. In HTTPS deployments terminate TLS at the existing trusted ingress; browser cookies use Secure when the configured public origin is HTTPS. Keep the unauthenticated SDAR upstream on its trusted isolated network.

A trusted identity issuer supplies the existing HS256 `open-webui` user JWT with its normal maximum 600-second lifetime. The reference login accepts that signed token, clears the input and exchanges it for an HttpOnly, SameSite=Strict cookie. The session lasts at most 300 seconds and never exceeds the JWT expiry. It is checked on every API request. Production service keys remain server-side, with no browser localStorage or URL credential transport. Anonymous mode cannot enable the page.

POST requests require the configured Origin and session CSRF nonce. The server bridge only forwards whitelisted Analysis/AG-UI requests to its own listening loopback port, injecting the existing service authentication. It cannot forward a user URL or arbitrary headers. SSE is relayed as it arrives; disconnect detaches the observer and leaves published work to the existing runtime. Re-authenticate when the short session expires.

The map is an offline SVG longitude/latitude diagram. It draws each public Point, MultiPoint, LineString, MultiLineString, Polygon or MultiPolygon independently, with pan, zoom, fit, layer visibility and inspection. It does not fetch tiles, payload references or Provider resources. Road/H3 references without published coordinates remain unknown. Gaps and provisional/partial qualifiers remain visible. Cards and navigation use published stable relationships; multiple relationships do not authorize a guessed candidate. Text is rendered using text nodes under a same-origin CSP.

Run actual Chromium checks with generated local identities and public fixture HTTP peers:

```bash
corepack pnpm exec playwright-core install chromium
corepack pnpm test:v06:browser
```

The launcher builds the page, excludes developer `.env` and live service settings, and uses Chromium 141.0.7390.37 associated with the pinned browser library. These are consumer/browser development checks, not real WSGS or device qualification. PostgreSQL-backed directory checks run through the existing isolated PostgreSQL harness.

## Explicit controls and recovery

Inspect a candidate before pressing **确认所选候选**. The server checks the active Revision, persisted intervention, precise selector and expiry again. Expired cards remain readable; fill in the query and explicitly requery. A control receipt triggers observation of the same Analysis, and only its authoritative Snapshot changes the current view.

Draw a point, line, explicitly closed polygon or Circle center/radius on the map, or import exact geometry JSON. Drawing, clearing and editing are local. Review the geometry/hash and CONTINUE/REPLACE mode before confirming submission. A changed/cleared draft invalidates the old confirmation. Circle stays Circle on the wire; its preview is a center marker, and the upstream decides actual spatial support. A local fixture acceptance does not establish real spatial query success.

**断开观察** preserves the last view without canceling. **恢复观察** requests complete State/Activity and never repeats START. **请求取消分析** first submits the intent; `CANCEL_REQUESTED` comes from persisted state, and `CANCELLED` requires the public source terminal status. When the bounded observer ends while the source is still running, keep the view and recover observation explicitly.

Controls disable while pending. If a reply is uncertain, **同键重放上次控制** sends the exact same command bytes/key, without an automatic retry. Switching Analysis or user clears local controls and pending replay. The displayed Activity is scoped to the current Revision; old records retain their history in the client/store.

Run the browser controls against actual local PostgreSQL:

```bash
corepack pnpm test:v06:browser:postgres
```

The launcher always rebuilds the browser bundle, excludes real credentials/database settings, creates its own temporary database container, and cleans it up. Ordinary test screenshots go to `.tmp/v06-browser`; phase validation supplies a separate evidence directory, preserving historical receipts. The database fixture uses the allowed 1-second recovery tick for bounded browser tests; the process recovery qualification separately uses the production 30-second tick and 180-second lease.

## Current functional qualification

Use `pnpm verify:v06:development` for the complete local consumer qualification.
It runs real browser/database/process checks and preserves source/exit/output
identity. The full process portion takes several minutes under the production
lease/tick budget. Inspect `node scripts/verify-v06-functional.mjs development
--list` before running if needed. GitHub CI has a dedicated functional-v06 job.

`pnpm verify:v06:integration` and `pnpm verify:v06:release` fail closed when
current private/real evidence is absent. A Source development PASS does not
qualify real WSGS, model quality, capacity, or conditional Native/SDAR extensions.
Current phase evidence is in reports/v0.6/functional-closure. The page remains
opt-in and authenticated in production; no automatic shared deployment occurs.
