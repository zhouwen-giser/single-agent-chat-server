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
