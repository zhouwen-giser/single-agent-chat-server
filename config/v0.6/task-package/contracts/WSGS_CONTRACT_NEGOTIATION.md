# Contract — WSGS Grounding 1.0 / 1.1 Negotiation

## 1. Profiles

Supported consumer selections:

```ts
type WsgsContractSelection =
  | {
      contractVersion: "sacs-wsgs-grounding/1.0";
      resultProfile: null;
    }
  | {
      contractVersion: "sacs-wsgs-grounding/1.1";
      resultProfile: "sacs-wsgs-geospatial-findings/1.0";
    };
```

## 2. Request headers

For 1.0:

```text
wsgs-contract-version: sacs-wsgs-grounding/1.0
```

The implementation may omit this header only if exact legacy compatibility tests prove omission is the frozen 1.0 behavior.

For 1.1, both headers are mandatory:

```text
wsgs-contract-version: sacs-wsgs-grounding/1.1
wsgs-result-profile: sacs-wsgs-geospatial-findings/1.0
```

There must be exactly one value for each. No comma list, whitespace repair or duplicate acceptance.

## 3. Response validation

For every WSGS response:

- validate HTTP status;
- enforce bounded body bytes;
- parse JSON once;
- verify negotiated response headers;
- validate the corresponding authoritative schema;
- reject forbidden authority/decision fields;
- verify geospatial profile/hash through the consumer lock;
- preserve WSGS safe error code, retryability and stage.

## 4. Authoritative lock

S00 must import or generate a SACS consumer lock from the exact WSGS source lock at:

```text
contracts/wsgs-v0.2.1-sacs-geospatial/contract-release-lock.json
```

The SACS lock must record at least:

```text
WSGS repository
WSGS source SHA
contract lock bytes SHA-256
contract version
result profile
schema artifact path → SHA-256
required request headers
required response headers
capability operation/product inventory
```

A lock with `TASK_PACKAGE_PROVISIONAL` provenance is never READY.

## 5. Capability behavior

`GET /v1/capabilities` must use the same selected contract. The adapter distinguishes:

```text
contract available
required operations available
optional operation advertised but unavailable
result profile available
service not ready
caller not authorized
contract mismatch
```

Do not infer availability from a software version string alone.

## 6. Downgrade rules

A request that requires 1.1 findings cannot silently downgrade to 1.0. It returns a typed capability error.

A request that only requires legacy grounding may use 1.0 when configured. The selection must be explicit in the request plan and evidence.

## 7. Required errors

```text
WSGS_CONTRACT_SELECTION_INVALID
WSGS_CONTRACT_NOT_AUTHORIZED
WSGS_CONTRACT_RESPONSE_HEADER_MISMATCH
WSGS_CONTRACT_SCHEMA_HASH_MISMATCH
WSGS_CONTRACT_PAYLOAD_INVALID
WSGS_REQUIRED_OPERATION_UNAVAILABLE
WSGS_REQUIRED_RESULT_PROFILE_UNAVAILABLE
WSGS_OPTIONAL_CAPABILITY_UNAVAILABLE
WSGS_SILENT_DOWNGRADE_FORBIDDEN
```

## 8. Security

- Service identity comes from SACS configuration, never request body.
- Bearer tokens are not persisted in source locks, logs, telemetry or reports.
- Contract headers are server-controlled.
- User input cannot select a more privileged WSGS contract.
