# Structural Agency Explorer

Static explorer for structural-agency conversations mined from
[WildChat](https://huggingface.co/datasets/allenai/WildChat-1M), labelled by
institutional domain, by the action the person was pursuing, and by the request
they made of the model.

**https://ehuang996.github.io/wildchat-agency-explorer/**

## Tabs

- **Examples** — all published conversations, searchable, filterable by
  domain / action, 50 per page. Only the user turn is shown; assistant
  responses are not published.
- **Prompts** — the action labelling prompt.
- **Analysis** — the domain × action cross-tab, plus label distributions.
- **Upload** — load a verification JSONL and see a confusion matrix and
  disagreement list against the stored labels. The file is read in the browser
  and never uploaded anywhere.

## How the labels are produced

| Stage | What it decides |
|---|---|
| Domain | A recall gate, then nine parallel per-domain weak-to-strong cascades, then a general residual filter. |
| Action | what the user asked the model to do — compose, revise, inform, explain, advise, search, or other; one or more per conversation, no upper cap. |

Actions are annotated by a Claude Opus 4.8 pass that is shown only the user
turn — never the assistant reply — and is independent of the domain pipeline,
so the domain × action cross-tab relates two separately produced labels.

## What is not here

Every conversation was reviewed for personally identifying information by an
LLM judge. The corpus is 11,892 conversations. Four were discarded at the labelling stage
because the judge refused to answer, leaving 11,888 labelled. Of those,
**2,484 are withheld and 9,404 are published** — 2,480 flagged by the reviewer,
plus 4 whose review errored and so were never cleared.
Flagged rows are excluded entirely rather than published in redacted form.

Because advocacy conversations tend to name employers, landlords and officials,
they are flagged more often — `self_advocacy` is 4.9% of the published subset
against 7.3% of the full corpus. Distributions here are of the published subset,
not of the corpus.

## Running locally

```bash
python3 -m http.server 8811
```

Everything is static: no build step, no dependencies, no network calls.
