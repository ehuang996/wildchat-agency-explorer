# Structural Agency Explorer

Static explorer for structural-agency conversations mined from
[WildChat](https://huggingface.co/datasets/allenai/WildChat-1M), labelled by
institutional domain, by the action the person was pursuing, and by the request
they made of the model.

**https://ehuang996.github.io/wildchat-agency-explorer/**

## Tabs

- **Examples** — all 9,408 published conversations, searchable, filterable by
  domain / action / request, 50 per page. Assistant responses load on demand.
- **Prompts** — every production prompt: the nine per-domain filters, the recall
  gate, the general residual filter, and the two labelling passes.
- **Analysis** — the action × request cross-tab, plus label distributions.
- **Verify** — a blind agreement check. Eight conversations are shown with
  candidate labels and no indication of what the model decided; your yes/no
  answers download as JSONL.

## How the labels are produced

| Stage | What it decides |
|---|---|
| Domain | A recall gate, then nine parallel per-domain weak-to-strong cascades, then a general residual filter. |
| Action (why) | 1–3 of 6 codes: the real-world undertaking the person is pursuing. |
| Request (what) | 1–3 of 5 codes: the deliverable they asked the model for. |

Action and request are annotated in two **independent** passes — neither judge
sees the other's verdict — so a strong cell in the cross-tab is a finding about
how people use the model rather than two codes overlapping by definition.

## What is not here

Every conversation was reviewed for personally identifying information by an
LLM judge. Of 11,892 rows, **2,484 are withheld and 9,408 are published** — 2,480
flagged by the reviewer, plus 4 whose review errored and so were never cleared.
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
