- source_spec: `_bmad-output/implementation-artifacts/spec-1-1-establish-pnpm-workspace-and-application-skeleton.md`
  summary: Make the API development host configurable for access from a physical mobile device or container.
  evidence: The Express skeleton binds to loopback; cross-device reachability is not required by Story 1.1 and should be decided with the first mobile-to-API development flow.
- source_spec: `_bmad-output/implementation-artifacts/spec-1-1-establish-pnpm-workspace-and-application-skeleton.md`
  summary: Separate Express app construction from listener startup when API behavior and tests are introduced.
  evidence: The current minimal API entry point starts listening on import; no API tests or importable integration surface are required by Story 1.1.
