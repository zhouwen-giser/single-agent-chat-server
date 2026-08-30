# WSGS geospatial consumer intake

This directory is the intake boundary for an upstream-owned WSGS geospatial
finding profile. `provisional-consumer-intake.json` records only observations
from the task package. It is not an authoritative WSGS handoff and cannot
enable geospatial requested products or result-extension consumption.

The generated lock remains `BLOCKED` until an authoritative WSGS handoff binds
the exact source revisions, grounding contract, geospatial schemas, transport
mode, requested products, and currentness mode. Replacing the intake requires
regenerating and validating `dependencies/wsgs-geospatial-consumer-lock.json`.
