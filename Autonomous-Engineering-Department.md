# Withdrawn autonomous-department concept

**Status: HISTORICAL DESIGN NOTE — not current behavior, benchmark evidence, or
an autonomy/safety guarantee.**

This document originally described a proposed graph-backed agent department as if
subgraph checkout necessarily produced isolated context, correct code, and
noise-free answers. Those outcomes do not follow from graph traversal and have
not been measured here. A language model can still omit dependencies, select an
irrelevant neighborhood, or make unsupported statements.

The design ideas remain plausible future work: retrieve a bounded dependency
neighborhood, show downstream impact candidates, let specialized agents exchange
admitted evidence, and visualize graph changes for human inspection. Each requires
an explicit authorization boundary, deterministic task contract, failure handling,
and independent verification.

The graph is an input to judgment, not a single source of truth. The 3D renderer is
an inspection surface, not evidence that its layout is physically or semantically
exact. See `README.md` and the canonical claim ledger for the active boundary.
