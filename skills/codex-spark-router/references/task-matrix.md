# Codex Spark Task Matrix

## Eligible examples
- one small UI polish change in an existing component or screen,
- local TS/JS type annotation or syntax correction,
- one narrow fixture or test-string adjustment,
- verified docs-only drift correction in the existing file set.

## Ineligible examples
- architecture, security, or threat-model decisions,
- schema design, migration, or API contract changes,
- math/science claims, ambiguous root-cause debugging, or broad performance work,
- multi-system or cross-repo integration tasks,
- tasks requiring large refactors or new dependencies.

## Exact-target prompt pattern
`Use GPT-5.3-Codex-Spark for: <brief objective>. Edit only these files: <explicit paths>. Keep changes minimal, preserve existing structure/data flow, do not change architecture/dependencies, and stop after the requested verification check.`
