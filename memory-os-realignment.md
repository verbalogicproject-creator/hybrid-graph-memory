# Memory OS — realignment after Waves A–C

**For:** Antigravity (Gemini)
**Repo:** `/root/antigravity-memory-os`
**Date:** 2026-08-23 (later same day)
**Follows:** `memory-os-execution-approval.md`
**Carries the user's approval.** Supersedes the Wave D priority in the approval document.

---

## §0. Your work was verified, not taken on report

Phase 1 and Waves A, B, C are accepted. This was checked rather than believed:

- The audit suite was **re-run independently from another session** — 11/11 green, reproduced.
- The provider-selection log line required by §1.2 item 4 appears and is correct:
  `[memory] embedder: embeddinggemma-300m-q4 (local) — probe succeeded`.
- `EmbeddingSpaceMismatchError` exists in `types.ts:147` and is thrown from
  `hybrid_retriever.ts:219`.
- All five MCP tools are defined in `server.ts`.
- Five commits in wave order, **with Phase 1 correctly isolated before the gate** — the sequencing
  instruction in §2 of the approval document was respected exactly.

That is the standard this estate asks for and you met it. The rest of this document is
re-prioritisation, not correction.

---

## §1. What changed upstream

The consuming project (**Codio** — a live-voice-driven browser app builder) now has an explicit
governing objective:

> **Reliably producing and exporting working apps and websites is the top objective.**

That reframes what this memory engine is *for*. Reliable app output is governed by five levers:
generation correctness, **constraint**, **validation**, **repair**, and **export fidelity**. The
first has diminishing returns. The others compound.

**Your Waves A–C landed on levers 2 and 4, which is why they matter more than a retrieval upgrade
normally would:**

- **Wave C — operational assets with exact trigger tags** is *constraint*. When
  "scaffold a Next.js page" or "wire Stripe checkout" is a stored workflow asset retrieved by exact
  tag, the agent **replays a known-good procedure instead of improvising one**. That is the single
  highest-leverage mechanism available for output reliability. Exact-tag matching is load-bearing:
  a fuzzy match on a scaffold procedure produces a wrong app.
- **Waves A and B — provenance and the AST graph** are *repair*. `commitHash`/`startLine`/`endLine`
  let the agent locate the exact lines to change; `renders`, `calls`, and `depends_on` let it know
  what else breaks if it does.

This engine is now on the consuming project's critical path. "Good" is no longer retrieval quality
in the abstract — it is **whether a replayed asset produces a working app.**

---

## §2. The consequence: the asset store is now a correctness surface

If scaffolds are stored as operational assets and replayed to generate applications, then **a
malformed, mistargeted, or stale asset silently produces broken apps — at scale, and repeatably.**

Right now `agy_ingest_operational_asset` is an **ungated write path** into exactly that surface.
Anything can be registered, in any shape, targeting nothing in particular, and it will be retrieved
by exact tag with full confidence.

Compare the sibling corpus, `nlke-declarum-model-02-codio`: content enters through
`evidence_gate.py`, admission is an explicit human act, and `docs/QUARANTINE.md` records rejected
material with its disposition. That discipline exists because unvetted content in a retrieval store
is indistinguishable from vetted content at query time.

Operational assets have no equivalent, and they are now more consequential than the prose corpus —
prose informs an answer, an asset **becomes the app**.

Closing that asymmetry is the next work.

---

## §3. Re-prioritisation

**Wave D is demoted.** It is not cancelled and it is not wrong — it is simply low-value against the
new objective:

- *Token counts on results* — marginal. The consumer budgets context; a count is a convenience.
- *Measurement-gated vector acceleration* — the gate was the right call and it will almost certainly
  return "no bottleneck." Your own audit measured **422k+ ops/sec on ARM64**, and a single generated
  React project is tens to low-hundreds of files. Profiling will confirm the JS loop is fine. That is
  the correct answer, arrived at by burning a cycle to prove a negative.

**Wave E is introduced and takes priority.** It is the missing half of Wave C.

---

## §4. Wave E — operational-asset integrity (approved, do this next)

### E1. Schema validation at ingest
Reject malformed operational assets rather than storing them. At minimum, a `workflow` must declare
ordered steps and the tools each step requires; a `prompt` must declare its variables and output
shape. Ingest of an invalid asset must fail with a specific, actionable error naming the missing
field — never store-and-hope.

### E2. Declared targeting and provenance
Every operational asset declares **what it targets** — framework and version range (e.g.
`next@15.x`, `stripe-node@17.x`) — and **where it came from** (authored by, source document,
commit). An asset with no declared target cannot be assessed for correctness later, which makes it
permanently unsafe to replay.

### E3. An admission gate
Mirror the sibling corpus's discipline. Assets enter as **candidates**; promotion to retrievable is
an explicit act, not a side effect of ingest. `agy_load_operational_asset` returns only admitted
assets. Keep rejected candidates with their disposition rather than deleting them — a rejected
scaffold is evidence about what does not work.

### E4. Staleness detection
An asset that was correct in August is wrong in November when its target framework moves. Given E2's
declared targets, surface a staleness signal on retrieval — at minimum, the asset's target version
and its age, so the consumer can decide. Do not auto-update or auto-retire; **report, do not act.**

### E5. Retrieval reports asset trust
`agy_load_operational_asset` should return admission state, target, and staleness alongside the
content, so a consumer that replays a scaffold can record *which version of which asset* produced a
given app. That is what makes a bad app traceable to a bad asset instead of blamed on the model.

### Then, and only then
Wave D as originally scoped: token counts, followed by the measurement-gated profiling. Report the
measurement either way — a documented "no bottleneck, here are the numbers" is a useful result and
closes the question permanently.

---

## §5. One outstanding verification

The audit suite ran with the local stack **up**, so it exercised the happy-path probe. The fallback
is the path that matters for users without local models, and it has not been observed failing over
for real.

**Stop the llama.cpp stack, then run a search.** Expect the Gemini fallback to engage with a log line
naming the reason. Then unset the key and confirm the clean, actionable failure. Report both
observed outputs. If the existing test simulates this with an unreachable URL rather than a stopped
server, say so — that is a legitimate test, but the distinction should be recorded rather than
implied.

---

## §6. The boundary you drew was correct — hold it

From your Wave C report:

> *"Prompts and workflows are ingested, indexed, and retrieved strictly as context strings. The
> engine does not track runtime execution steps or context token budgets (preserved for the
> @aria/core agent layer)."*

That is exactly right and it is worth stating plainly because the temptation grows as the asset
store becomes more central to correctness.

**This repository is a memory engine. It retrieves and reports. It does not execute, orchestrate, or
decide.** Workflow state ("step 2 of 5") belongs to the agent, which can observe what actually
happened; this engine can only know what it handed over. Two sources of truth for task progress is a
bug generator.

E4's "report, do not act" rule is the same principle applied to staleness.

---

## §7. Standing constraints — unchanged

All four from `memory-os-execution-approval.md` §1.2 remain binding: **no auto-re-embed** (cost
guard), **768d fixed**, **additive schema only**, and **no changes to RRF fusion, the lexical
scorer, the reranker stage, or time decay**. One wave per commit, each independently verifiable and
revertable. Do not modify anything outside `/root/antigravity-memory-os`. If a task requires
breaking a constraint, **stop and report** rather than deciding.

---

## §8. Report back

Per wave, as before:

```yaml
status: complete | partial | blocked
summary:
changed_files:
verification:      # observed output — test results, log lines, query results
measurements:      # required for Wave D profiling
constraints_hit:
risks_or_unknowns:
next_wave_ready:
```

Evidence means observed output. A description of what the code should now do is not verification —
which is the standard your Waves A–C already met.
