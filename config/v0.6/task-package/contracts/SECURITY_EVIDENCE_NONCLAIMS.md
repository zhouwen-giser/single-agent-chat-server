# Contract — Security, Evidence and Non-Claims

## 1. Input authority

Reject authority/security fields recursively in user-controlled bodies, including:

```text
principalId
actorId
servicePrincipalId
dataScope
datasetScope
permissions
authorization
accessToken
token
```

User-controlled public tool args cannot be executed downstream.

## 2. Scope isolation

Analysis existence, Grounding result references, choices and evidence are all principal/thread scoped. Cross-scope access returns safe not-found.

## 3. Payload safety

- Parse bounded JSON.
- Reject dangerous object keys where applicable.
- Verify canonical hashes before use.
- Preserve immutable source bytes for contract locks.
- Do not log payload bodies.
- Do not render HTML from upstream text without escaping/sanitization.

## 4. SSRF/network boundary

WSGS base URL is server configuration. User requests cannot override host, scheme, path or headers. Only `http`/`https` are accepted; credentials, query and fragment in base URL are forbidden.

## 5. No hidden reasoning

Only published WSGS status, evidence, safe summaries, typed gaps and SACS-owned operational state are presented. Do not reveal hidden model reasoning or internal Provider arguments.

## 6. Evidence classification

Allowed acceptance statuses:

```text
PASS
FAIL
BLOCKED_EXTERNAL
NOT_RUN
NOT_REQUESTED
```

`PASS` requires reproducible evidence. `BLOCKED_EXTERNAL` requires a locked external source showing the missing contract/capability. A local fixture cannot convert a real-integration row to PASS.

## 7. Prohibited claims

Do not claim:

```text
native WSGS analysis integration
provider-level streaming progress
production release readiness
full historical completeness
current optimality from historical ranking
device execution
route feasibility
formal deployment acceptance
```

unless the exact corresponding evidence exists.

## 8. Publication

The Goal may create/update a Draft PR if credentials and repository policy allow. It never authorizes merge, tag, release, deployment, shared-service restart or upstream repository writes.
