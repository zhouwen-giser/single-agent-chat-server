# P09 failed attempt: direct Jest invocation omitted ESM loader

- Date: 2026-08-11
- Gate: targeted unit regression
- Result: failed as required

A direct `pnpm exec jest` command bypassed the repository's required
`node --experimental-vm-modules` launcher. All three selected TypeScript ESM
suites failed during loading and executed zero tests. The attempt was not used
as evidence. The repository-owned `pnpm test:unit` command was used instead.
