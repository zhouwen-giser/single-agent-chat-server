# P08 local gate retries

## Targeted regression pass

The first targeted P08 regression run found two test-harness alignment issues:

- legacy empty-database and v0.2-upgrade expectations still ended at migration
  `0008` after append-only migration `0009` was added;
- the strengthened result JSON Schema used the optional `uri` format, while the
  repository's deliberately minimal AJV instance does not install format
  plugins.

The migration expectation now includes `0009`, and the URL contract uses its
existing explicit HTTP(S) pattern without relying on an optional format plugin.
The run also identified legacy Chat-repository joins that still used the
nullable compatibility `thread_id`; those joins now authorize through the
canonical `conversation_thread_id`. Failed runs are not acceptance evidence.
