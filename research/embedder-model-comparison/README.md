# Embedder model comparison

Compares two **different** embedding models on this corpus, each addressed in
its own trained prompt format.

Diagnostic only. It issues no verdict about retrieval quality and none may be
inferred — see `CLAIMS.md` C4–C6, all "not demonstrated". Separation on a
35-query calibration set is not nDCG on a held-out set.

## Why this is a separate runner

`research/embedder-quantization/run_quantization_ab.ts` answers a different
question: *same model, two precisions?* There, per-chunk `cos(a, b)` is the
primary metric and a value near 1.0 is the expected result — which is precisely
how the defective EmbeddingGemma GGUF was caught, when it came back at median
−0.023 instead.

For two different models that statistic carries **no information**. Two
independently trained encoders do not share a coordinate system, so the cosine
between their outputs is an arbitrary number with no scale. This runner does not
compute it, and the omission is deliberate: publishing a number that looks like
the quantization runner's headline metric, but means nothing, is an invitation
to the same misreading in reverse.

What survives across models:

| Metric | Cross-model valid? | Why |
|---|---|---|
| per-chunk `cos(a, b)` | **no** | different coordinate systems |
| within-arm margin | yes | each model judged only against itself |
| rank agreement (Jaccard, τ-b) | yes | compares orderings of shared chunk ids, never vectors |

## Prompt formats

Each model is addressed the way its authors trained it. This is not a detail: on
this same corpus, feeding EmbeddingGemma bare text instead of its prefixes cost
0.046 of separation. A comparison that applied one model's format to the other
would be measuring the mismatch, not the model.

| Format | Query | Document |
|---|---|---|
| `embeddinggemma` | `task: search result \| query: …` | `title: none \| text: …` |
| `qwen3` | `Instruct: {task}\nQuery:…` | *(bare)* |
| `none` | *(bare)* | *(bare)* |

## What is deliberately held fixed

`MAX_CHARS = 1200`, the production truncation. Qwen3-Embedding advertises a
32768-token context against EmbeddingGemma's 2048, which is a real potential
advantage — and it is **not** measured here, because letting one arm read more
of each chunk than the other would confound the two effects. That is a separate
experiment.

`CONCURRENCY = 1`. Both tenants run `-np 4 -cb`, and continuous batching makes a
vector depend on which other requests shared its batch: the same text embedded
8 times with 4 in flight returned 4 distinct vectors (worst self-cosine
0.997556), while sequential requests are bit-identical.

## Running it

Start the second tenant from Termux. The ALT tenant is already parameterized, so
no edit to `rag-loader.sh` is needed:

```sh
EMBED_ALT_ENABLED=1 \
EMBED_ALT_MODEL=$HOME/kg-factory/models/gguf/qwen/Qwen3-Embedding-0.6B-Q4_K_M.gguf \
EMBED_ALT_ALIAS=qwen3-embedding-0.6b-q4km \
./rag-loader.sh start
```

Then, from the repo:

```sh
npx tsx research/embedder-model-comparison/run_model_comparison.ts
```

Defaults are arm A = EmbeddingGemma Q8 on `:8145` in `embeddinggemma` format,
arm B = Qwen3 on `:8146` in `qwen3` format. Override with `--a-url`,
`--a-alias`, `--a-format` and the `--b-*` equivalents; `--limit N` shortens the
corpus for a smoke run.

## Serving a non-Gemma model: pooling

`embed-server.sh` used to hardcode `--pooling mean`. That is correct for
EmbeddingGemma and wrong for almost anything else. Qwen3-Embedding declares
`pooling_type = 3` (LAST) in its GGUF and is trained for it; served under mean
pooling it emits output the model was never trained to produce.

This is the **same class of error as the missing projection head** — a serving
misconfiguration that produces plausible-looking vectors of the wrong thing.
Had the tenant merely started, the comparison would have measured a crippled
Qwen3 and likely concluded EmbeddingGemma wins. It was caught only because the
server also ran out of memory and the log had to be read:

```
W llama_init_from_model: model default pooling_type is [3], but [1] was specified
```

`POOLING` is now a variable in `embed-server.sh`, defaulting to `mean` so the
primary is unchanged. Setting it **empty** omits the flag and lets the GGUF's
declared `pooling_type` win, which is the right default for an A/B tenant
serving arbitrary models. `rag-loader.sh` passes `EMBED_ALT_POOLING` empty by
default, written `${EMBED_ALT_POOLING-}` rather than `:-` so an explicitly empty
value survives.

Before trusting any run, confirm the warning above is **absent** from
`server-embed-alt-rag.log`.

The alt tenant also gets its own `EMBED_ALT_CTX` / `EMBED_ALT_BATCH` rather than
inheriting the primary's. At the inherited `-b/-ub 2048`, Qwen3-0.6B (28 layers,
n_embd 1024) asked for a 1578098688-byte OpenCL compute buffer and the server
died with `failed to allocate compute pp buffers`. The alt default is 512, still
far above what this harness sends (1200 chars, roughly 300 tokens).

## Guards

- Refuses if both arms report the same alias, or the same `n_params` — that
  means one model is being compared against itself, which would report perfect
  rank agreement and read like a clean result rather than a misconfiguration.
  This is the **inverse** of the quantization runner's guard, where *equal*
  parameter counts are the requirement.
- Rejects an unknown `--a-format`/`--b-format` rather than falling through to
  `undefined`, which would embed the literal string `"undefined"` for every
  document.

## Note on the Qwen3 GGUF

`Qwen3-Embedding-0.6B-Q4_K_M.gguf` was checked against the failure mode that
broke the EmbeddingGemma Q4: `n_params = 595,776,512`, matching the advertised
0.6B, with `qwen3.pooling_type = 3` (LAST), `embedding_length = 1024`. Nothing
is missing. Qwen3-Embedding's output is the last hidden state, so it has no
separate dense projection head to lose — the EmbeddingGemma failure does not
have an analogue here. Note this is a **Q4_K_M** file, so any deficit it shows
against the Q8 arm confounds model with quantization.
