---
name: codex-spark-router
description: "Route tightly scoped UI polish, syntax/type cleanup, narrow fixture fixes, or verified documentation-drift edits to GPT-5.3-Codex-Spark with a conservative policy."
---

# Codex Spark Router

Use this skill only for deterministic, small, text-editing tasks that are safe for GPT-5.3-Codex-Spark, preserving existing structure and minimizing change.

This policy is bounded by `references/task-matrix.md`.

## All-conditions eligibility gate
A Spark handoff is allowed only when **all** are true:

- The request has a single objective, fixed target path(s), and no unresolved ambiguity.
- The work is constrained to:
  - focused UI polish in an existing view/component,
  - local mechanical type/syntax repair,
  - a narrow fixture/test edit, or
  - a documented drift-only docs update.
- The fix is likely to be one small change in an existing app with minimal files.
- Existing patterns and data flow are preserved and no new dependencies, architecture, or migration changes are introduced.
- The request is not about architecture, security, math/science claims, broad refactors, schema/migration/data-model changes, ambiguous debugging strategy, or multi-system integration.
- User-visible behavior changes are small and one-shot verifiable.

If any condition fails, do not dispatch to Spark; route to the broader model flow.

## Bounded dispatch contract
For eligible tasks, dispatch exactly one Spark attempt with:

- explicit task summary,
- explicit file targets,
- explicit no-change boundaries,
- explicit verification expectation.

Required constraints to the prompt:

- preserve existing architecture and behavior except for the targeted fix,
- avoid dependency, workflow, route, schema, security, or migration changes,
- keep diffs minimal and constrained to the target task,
- stop after the first verification pass.

For UI polish specifically: perform the change in the existing surface, verify in-browser if available in scope, then stop.

## One retry maximum
- First attempt: launch Spark with the bounded prompt.
- Retry only once if output is non-conforming or misses obvious constraints.
- On second failure, stop and reroute to non-Spark Codex flow.

## Independent diff/test verification
After each Spark attempt, perform an independent check:

1. Confirm prompt constraints are reflected in the changed hunks only.
2. Ensure diff stays within scoped paths and remains small.
3. Run only user-requested or already approved verification commands and do not broaden them.

## Rerouting
Reroute away from Spark when any boundary is violated:

- scope is broader than bounded single-objective work,
- ambiguity remains unresolved,
- ineligible conditions appear,
- or the result is not directly verifiable with the user-requested checks.

When Spark succeeds, report completion with bounded evidence and stop.
