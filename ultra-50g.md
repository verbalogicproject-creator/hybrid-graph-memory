# ULTRA integration — historical design note

**Status: PROPOSAL — not demonstrated cross-domain reasoning, link correctness,
security discovery, or retrieval improvement.**

ULTRA is a zero-shot relation-prediction model for knowledge graphs. An earlier
version of this note assumed that its general design transferred correctly to this
repository's AST relation schema. That transfer has not been established; it
requires held-out labeled edges and neutral baselines.

The implemented bridge has a defensible narrower role:

- verify the pinned local model artifact before loading it;
- use the checkpoint's supported Hugging Face wrapper and isolated PyG 2.4 runtime;
- score proposed relation candidates during an explicitly invoked run;
- record model name/version, confidence, evidence checksum, and
  `model_inferred` origin;
- keep proposals out of default retrieval until independent admission;
- treat confidence as a model score, never proof of a dependency or vulnerability.

Cross-domain legal, infrastructure, and code links remain untested and require
domain-specific schemas, privacy controls, labeled evaluation, and expert review.
A ranked subgraph may provide additional context to an agent, but it cannot prevent
hallucination or establish autonomous reasoning. Earlier "frontal lobe" and
"Butterfly Effect Predictor" wording was a design metaphor, not a result.

`README.md` and `research/vector-topology-primitives/canonical/` take precedence.


Runtime validation is available through `agy-memory system2 --check`. The regression
contract rejects the former raw-`Ultra.from_pretrained` API, verifies model bytes
against the pinned checksum, and packages the Python bridge with the npm artifact.
