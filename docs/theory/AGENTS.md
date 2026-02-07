# Agent Theory Index

```json
{
  "cac": {
    "index": "v1",
    "manifest": [
      {
        "file": "unified_theory.json",
        "description": "Grand Unified Theory for General-Purpose Reasoning Engines over Structured Data Executing Compute",
        "primary_utility": "Axiomatic foundations, invariants, and formal runtime semantics"
      },
      {
        "file": "laws.json",
        "description": "Normative laws for agent-native runtime correctness and safety",
        "primary_utility": "Enforceable constraints for gates, policy, and verification"
      },
      {
        "file": "principles.json",
        "description": "Operational principles for architecture, control loops, and performance",
        "primary_utility": "Design guidance and implementation heuristics"
      },
      {
        "file": "agent_native_architecture.json",
        "description": "Reference architecture for OODA wave engines and adaptive orientation",
        "primary_utility": "Composable patterns, protocols, and adapter contracts"
      },
      {
        "file": "defects.json",
        "description": "Taxonomy and schema for runtime defects and recurrence prevention",
        "primary_utility": "Counterexample capture, clustering, and remediation automation"
      },
      {
        "file": "guardian_preparedness/scenarios.json",
        "description": "Adversarial thought experiments and machine-checkable acceptance predicates for Guardian safety",
        "primary_utility": "Preparedness scenario validation and engineering acceptance criteria"
      },
      {
        "file": "glossary/glossary.json",
        "description": "Normative glossary graph for shared terms and operational definitions",
        "primary_utility": "Semantic alignment across runtime, policy, and tooling"
      }
    ]
  }
}
```

## Agent Verification Loop

- Runtime/package manager: `bun` only.
- Canonical local verification path: `bun run check`.
- Bun pin validation: `bun run verify:bun` (expects `nix develop` toolchain).
- Fast preflight path: `bun run check:fast`.
- CI-like test mode: `bun run test:ci`.
- Debug noisy test logs only when needed: `VITEST_DEBUG_LOGS=1 bun run test`.
