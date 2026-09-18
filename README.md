<div align="center">

# jev-mahjong-bench

**Jev vs GPT for riichi mahjong discard decisions**

Measure decision latency, reference-action agreement, legality, calibration, and usage on exactly the same mahjong states.

[![CI](https://github.com/hamakyo/jev-mahjong-bench/actions/workflows/ci.yml/badge.svg)](https://github.com/hamakyo/jev-mahjong-bench/actions/workflows/ci.yml)

</div>

## What this repository measures

The first stage is a **decision benchmark**: given a riichi-mahjong state and its legal discards, each agent must return exactly one discard.

| Metric | Meaning |
| --- | --- |
| success rate | request completed without an agent/API error |
| legal-action rate | returned action was in `legalActions` |
| reference match | exact agreement with optional `referenceAction` |
| mean / p50 / p95 latency | wall-clock decision latency |
| average confidence | agent-reported confidence, when available |
| reference ECE | confidence calibration against reference agreement |
| Brier score | quality of a full probability distribution, when available |
| token usage | input/output usage when exposed by the provider |

> `referenceAction` is a comparison target, not mathematical ground truth. The bundled dataset is only a toy fixture for testing the harness.

## Why Jev fits

A discard is a closed-set decision: game state in, one legal action out. Jev's `Choice` primitive returns a choice plus probabilities/confidence, so the benchmark can measure speed and calibration as well as agreement.

GPT is constrained to the same action set with Structured Outputs. The default is `gpt-5.6-luna`, configurable with `OPENAI_MODEL`.

## Quick start

Requires Node.js 20+ and pnpm 10+.

```bash
pnpm install
pnpm check
pnpm bench:sample
```

The sample benchmark is fully offline.

### Run Jev and GPT

```bash
cp .env.example .env
# fill TYPESAFE_API_KEY and OPENAI_API_KEY
set -a && source .env && set +a

pnpm bench -- \
  --agents jev,gpt,random \
  --dataset datasets/sample.jsonl \
  --out results/live
```

Optional:

```bash
OPENAI_MODEL=gpt-5.6-luna
OPENAI_REASONING_EFFORT=none
```

## Dataset format

One JSON object per line:

```json
{
  "id": "example-001",
  "state": {
    "round": "E1",
    "seat": "S",
    "scores": [25000, 25000, 25000, 25000],
    "hand": ["1m", "2m", "3m", "4p", "5p", "6p", "2s", "3s", "4s", "7s", "8s", "9s", "5z"],
    "drawnTile": "9m",
    "doraIndicators": ["4p"],
    "discards": {"E": [], "S": [], "W": [], "N": []}
  },
  "legalActions": ["1m", "2m", "3m", "4p", "5p", "6p", "2s", "3s", "4s", "7s", "8s", "9s", "5z"],
  "referenceAction": "5z",
  "source": "your-source"
}
```

For real evaluations, document the source of `referenceAction`. If Mortal is the reference, report **Mortal agreement**, not absolute accuracy.

## CLI

```text
--agents <list>       jev,gpt,random
--dataset <path>      JSONL dataset
--out <dir>           report directory
--concurrency <n>     concurrent decisions per agent (default: 1)
--seed <n>            deterministic random seed (default: 42)
```

Each run writes `report.json` and `report.md`.

## Fair-comparison rules

1. Feed every agent exactly the same state and legal-action set.
2. Ask for only the action, never a chain-of-thought explanation.
3. Pin model IDs and record them with the experiment.
4. Use concurrency 1 for latency comparisons unless concurrency is the variable.
5. Report distributions (especially p50/p95), not only averages.
6. Separate provider/network effects from model latency in serious experiments.
7. Treat Jev confidence as its own signal; GPT is not assigned an invented confidence score.

## Architecture

```text
dataset.jsonl
    |
    v
Benchmark runner
    |
    +-- JevAgent ------> TypeSafe System One / Choice
    +-- GptAgent ------> OpenAI Responses API / Structured Outputs
    +-- RandomAgent ---> deterministic offline baseline
    |
    v
records -> metrics -> report.json + report.md
```

## Roadmap

### Phase 1 — discard benchmark

- [x] common agent contract
- [x] Jev adapter
- [x] GPT adapter
- [x] deterministic offline baseline
- [x] JSONL dataset loader
- [x] latency / legality / reference-match metrics
- [x] ECE and Brier score
- [x] JSON + Markdown reports
- [x] tests and GitHub Actions
- [ ] import real Tenhou/Majsoul states
- [ ] add a Mortal reference adapter

### Phase 2 — full-game benchmark

Run paired games in a riichi environment such as RiichiEnv and measure average final score/rank, 1st/4th-place rate, win/deal-in rate, riichi/call rate, and time per decision/hanchan. Fix wall seeds where possible and rotate seats.

### Phase 3 — Jev -> GPT escalation

```text
high Jev confidence -> play Jev decision
low Jev confidence  -> send the same state to GPT
```

Compare strength, latency, and usage with Jev-only and GPT-only runs.

## References

- [TypeSafe AI JavaScript SDK](https://github.com/typesafe-ai/typesafe-sdk-js)
- [OpenAI Responses API](https://developers.openai.com/api/docs/guides/migrate-to-responses)

## License

MIT
