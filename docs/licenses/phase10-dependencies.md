# Phase 10 dependency license record

P10 adds no dependency. The production inventory reports the already locked
optional A2A SDK peer below with a conjunctive SPDX expression:

| Package              | Locked version | SPDX expression                 | Purpose                                    |
| -------------------- | -------------- | ------------------------------- | ------------------------------------------ |
| `@bufbuild/protobuf` | `2.13.0`       | `(Apache-2.0 AND BSD-3-Clause)` | Optional protobuf peer selected by A2A SDK |

Both license obligations are already in the project allowlist. The gate accepts
this one exact conjunctive expression; it still rejects unknown packages,
licenses, disjunctions, exceptions, or arbitrary SPDX expressions.
