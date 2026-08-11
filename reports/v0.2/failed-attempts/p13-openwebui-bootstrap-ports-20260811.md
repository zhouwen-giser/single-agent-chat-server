# Failed Attempt

- Phase: P13
- Timestamp: 2026-08-11
- Candidate SHA: `40e7ae4e2346bb932ccd7e6b89aea3793cc08c42`
- Command/scenario: fresh Open WebUI candidate topology bootstrap
- Result: Docker image attempt timed out; first pip port bind failed

## Failure

The Open WebUI container command timed out while the 0.10.2 image was absent;
post-checks proved no container, image, or listener remained. The required
pip-installed Open WebUI 0.10.2 was then started with a fresh data directory,
but its first port `18085` became occupied during the lengthy initial migration
and model load, so final bind failed and the process exited.

## Root cause

The Docker path was not locally cached and was unnecessary for the task's pip
Open WebUI requirement. The first pip port was not reserved across the full
startup window.

## Fix/disposition

Use the installed `open-webui 0.10.2` distribution, retain the successfully
migrated isolated data directory, verify `18086` is free immediately before
restart, and configure the OpenAI connection through the official config API.

## Retest evidence

Health returned HTTP 200 on `18086`; model discovery returned
`sdar-single-agent`; run `p13-40e7ae4-northbound` passed the full real Open
WebUI matrix with zero skips.
