# Embedder comparison: what the production GGUF is missing

**The quantization A/B this directory was built for could not be run, because the
two GGUF files are not the same model.** That is the finding. What follows is what
was measured instead.

## The defect

`/v1/models` reports a parameter count, and quantization never changes it:

```
:8145  embeddinggemma-300m-q4   Q4_0   n_params = 302,863,104
:8146  embeddinggemma-300m-q8   Q8_0   n_params = 307,581,696
```

Diffing the two GGUF tensor tables (`gguf` v3 headers, 314 vs 316 tensors) shows
exactly which 4,718,592 parameters are absent from the file in production:

```
present in Q8, absent from Q4:
   + dense_2.weight   [768, 3072]
   + dense_3.weight   [3072, 768]

general.name  Q4: "Embeddinggemma 300m Qat Q4_0 Unquantized"  (finetune=qat-unquantized)
              Q8: "Embeddinggemma 300m"
```

Those are EmbeddingGemma's two dense projection layers. The Q4 conversion dropped
them, so `:8145` emits raw mean-pooled transformer output rather than the space
the model was trained to produce. Cross-arm cosine is ~0 (median −0.023), not the
>0.99 two quantizations of the same weights would give.

This is not a llama.cpp fault and not a quantization artifact. It is one bad
conversion.

## What was measured instead

The 2x2 still ran, with the row factor relabelled from "quantization" to
"projection head". All 333 indexed chunks, the 35 labelled calibration queries
from `../disambiguation-gate/calibration_queries.json`, max-cosine over the whole
corpus so the numbers are comparable to the bands in the repository `README.md`.

| cell | margin | in_domain | out_of_domain | content_free |
|---|---|---|---|---|
| `q4:current` — **production today** | **0.021** | 0.458–0.627 | 0.381–0.437 | 0.440–0.551 |
| `q4:prefixed` | 0.067 | 0.403–0.604 | 0.233–0.336 | 0.352–0.432 |
| `q8:current` | 0.035 | 0.337–0.537 | 0.222–0.302 | 0.304–0.394 |
| `q8:prefixed` | **0.124** | 0.309–0.598 | 0.063–0.185 | 0.240–0.345 |

Margin is `min(in_domain) − max(out_of_domain)`. Figures are from the first run
and are quoted to three decimals because a repeat run moved them in the fourth;
see the noise section below.

The `q4:current` cell reproduces the production baseline the repository `README.md`
documents — in-domain 0.458–0.627, margin 0.024 there against 0.021 here — which
is the evidence that this harness measures the same thing.

Rank agreement between the two models is low: top-10 Jaccard median 0.33
(`current`) and 0.43 (`prefixed`), Kendall tau-b median 0.07 and 0.10. They return
substantially different results, not reorderings of the same ones.

## Two effects, and they interact — but only one of them is above the noise

Prefixes alone are worth about +0.046 of margin. Both together are worth about
**+0.102**, roughly 1.7x the sum of the parts, so the factors interact and varying
one at a time would have understated the combination. That is why the 2x2 was run
as a 2x2.

**The projection head alone (+0.014) is not separable from measurement noise.**
Repeating the identical run moved every band by 1e-3 to 5e-3 and moved the four
margins to 0.023 / 0.0718 / 0.0321 / 0.1232. The cause is below: embeddings are
not reproducible under concurrent load. The prefix effect and the combined effect
are 10-40x that noise and are safe to rely on; the head-only delta is 3-4x it, on
an extremum statistic, and is not.

The case for restoring the projection head does not rest on that delta. It rests
on the file being a defective conversion: `:8145` is not emitting the space the
model was trained to produce, whatever that turns out to be worth.

## Embeddings are nondeterministic under concurrency

The same text, embedded eight times through this server, returns **four distinct
vectors** when four requests are in flight, and bit-identical vectors when sent
sequentially:

```
sequential x4   identical
concurrent x8   4 distinct of 8;  worst self-cosine 0.997556;  max elementwise delta 1.3e-2
```

`-np 4 -cb` batches requests continuously, and batched matrix multiplication is
not associative in floating point, so a vector depends on which other requests
shared its batch. Consequences beyond this experiment:

- Re-indexing the same corpus twice produces different stored vectors.
- Any evaluation is reproducible only to about +/-0.003 in cosine per pair, and
  worse for min/max statistics over a query set.
- `PROTOCOL.md`'s freeze manifest assumes a run can be reproduced from recorded
  inputs. It cannot be, at full precision, while embeddings are batched.

For measurement, drive the embedder with one request in flight (this runner sets
`CONCURRENCY = 1` for that reason) or serve a dedicated `-np 1` instance. Neither
is necessary for serving, where the noise is far below retrieval's sensitivity.

## What does not improve

Content-free input still scores above off-topic input in **every** cell. Even at
`q8:prefixed`, junk (0.240–0.345) outranks genuine off-topic questions
(0.063–0.185) and overlaps the bottom of the answerable band (0.309–0.598).

Cosine separates off-topic text from in-domain text. It does not separate
gibberish, in any of these four configurations, because content-free input embeds
near the corpus centroid. The lexical anchor in `hybrid_retriever.ts` is load
bearing regardless of which embedder is served.

## Consequences before anything is changed

- **Switching the served model invalidates the shipped thresholds.**
  `disambiguationThreshold` is 0.5. In `q8:prefixed` the in-domain band runs
  0.309–0.598, so a 0.5 bar would refuse most answerable queries. Recalibrate
  before, not after.
- **It also invalidates C11.** The `CLAIMS.md` row scopes H7 to
  `embeddinggemma-300m-q4`. A different embedder requires a newly generated split
  under a new seed, per the re-tuning rule in `PROTOCOL.md`; the existing test
  split may not be reused.
- **Stored vectors are in the abandoned space.** All 333 live in the unprojected
  space; a switch requires a re-index. `hybrid_retriever.ts:299` fails closed on a
  model-name mismatch, but it keys on the alias *string* — serving a different
  model under the existing `embeddinggemma-300m-q4` alias defeats the guard while
  every stored vector is silently wrong. Change the `--alias` too.
- **A wider margin is not better retrieval.** Margin is a gate-relevant separation
  statistic. Whether any of this improves ranking is C4, and it remains not
  demonstrated.

## Running it

```sh
EMBED_Q8_ENABLED=1 ./rag-loader.sh start          # in Termux, not in the proot
npx tsx research/embedder-quantization/run_quantization_ab.ts --allow-model-mismatch
npx tsx research/embedder-quantization/run_quantization_ab.ts --limit 40 --out /tmp/smoke.json
```

The runner refuses to proceed when the two endpoints report the same `ftype`, and
now also when they report different `n_params` — the check that would have caught
this defect immediately. `--allow-model-mismatch` is required here precisely
because the arms *are* different models. Results land in `ab_result.json`, which
is in `excludedPathPrefixes` so it is not itself indexed.

The Q8 tenant must be launched from Termux: inside the proot it cannot open
`/dev/dri/renderD128`, falls back to CPU, and the backend becomes a second
uncontrolled variable.

## Status of these numbers

**Diagnostic. No preregistered hypothesis, no bounds, no held-out split — this
decides nothing and may not be cited for a row in `CLAIMS.md`.**
`../disambiguation-gate/` shows the shape a confirmatory version takes: rule into
`PROTOCOL.md` first, split fixed in advance, run once whatever the outcome.

It is also not C6. `PROTOCOL.md` H5 asks whether graph anchoring *reduces* INT4
neighbour degradation; nothing here bears on that, and the quantization question
it would need as input is still unmeasured — that requires two conversions of the
same model, which is what this directory failed to obtain.

Scope: one corpus, one device, one pooling mode, 35 queries the tuner authored.
