# P13 completion

Status: `PASSED_CANDIDATE_AWAITING_P14`

P13 produced an exact-head release candidate at
`40e7ae4e2346bb932ccd7e6b89aea3793cc08c42`. The implementation was delivered
in `cf19d7286ff0cba0cb00f6bdb1cd562541227aa9` and the durable AG-UI failure
closure in `40e7ae4e2346bb932ccd7e6b89aea3793cc08c42`; both were pushed immediately
and the final candidate matched the remote feature head.

The exact candidate passed unit 78/78, contract 57/57, adversarial security
9/9, native PostgreSQL integration 51/51, fixture E2E 1/1, OpenAI contract
19/19, and A2A contract 7/7. Architecture covered 59 production source files;
the migration gate covered six append-only migrations; the production license
inventory covered 89 entries; and the secret scan covered 406 tracked files.

Five required real gates passed with zero skips against one clean SDAR checkout
at `a9957c82c17ca01e77528f3817c03d86224aaf88`: source lock, pip Open WebUI
0.10.2, official `@ag-ui/client@0.0.57`, same-Task protocol consistency, and
bounded observation recovery. The Agent Card hash was
`767ad28a1d0af8e99a19d85ed79cbdf8478d746710a7bfa3671c953b8f696e17` and the
explicitly selected A2A endpoint was `http://127.0.0.1:9999/a2a`.

The real Open WebUI run `p13-40e7ae4-northbound` used a fresh pip-installed
Open WebUI 0.10.2 instance and official configuration API. Official AG-UI Task
`a00f10d4-a5bb-4653-9ced-d2f76896a1a3` completed after a real plan interrupt
and resume. Consistency Task `42d1b564-c27b-4ed3-94da-d93ba9a24197`, context
`bec0880d-477e-4cb2-a71f-6687608654fa`, completed with 13 published history
messages and one artifact. Bounded Task
`f78651cd-3675-4862-a317-63e91e05531d` ended observation while still working,
was recovered only with `getTask()` polling to `INPUT_REQUIRED` and
`awaiting_plan_confirmation`, then was canceled through top-level
`cancelTask()`. No cursor, Task resubscription, RAW event, or inferred Tool Call
was used. All nonterminal test Tasks retained by disconnect/idempotency probes
were subsequently canceled through the isolated official A2A adapter.

An SDAR restart during candidate qualification exposed a real SACS defect: an
execution exception could escape after `finally`, leaving a durable AG-UI Run
permanently `RUNNING`. The final candidate converts non-abort execution failure
to a sanitized, sequenced `run.error`, persists `ERROR`, completes the request,
and replays the same safe outcome. Unit and native PostgreSQL regressions cover
the repaired path.

Production image `sha256:26bd8ce9577669b7f061ffa7c59b8d4dc7a4049f4359ac1c0c76f6b380232f02`
passed the metadata gate. The Compose gate returned ready HTTP 200 with 12
migrated tables, user `node`, read-only root filesystem, all capabilities
dropped, and `no-new-privileges`; cleanup passed. CycloneDX 1.7 SBOM contained
3718 components with SHA-256
`2fb36bdbbd5fdc8986e706379b4230a8c3a25b44b85615776d455564071f0da0`.
GitHub Actions run 31448260553 passed quality and container jobs at the exact
candidate SHA.

AC-01 through AC-20 are satisfied for P13. AC-21 and AC-22 intentionally remain
pending for P14 latest-main integration and final ancestry proof. No browser
screenshot is claimed because the in-app browser runtime was unavailable; the
Open WebUI evidence is real HTTP through the installed 0.10.2 service. No PR,
merge, tag, release, deployment, or SDAR upstream change was performed in P13.
