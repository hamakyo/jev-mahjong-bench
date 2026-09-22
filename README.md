<div align="center">

# jev-mahjong-bench

**Jev vs GPT for riichi mahjong decisions and paired games**

Measure decision latency, reference-action agreement, legality, calibration, and usage on exactly the same mahjong states.

[![CI](https://github.com/hamakyo/jev-mahjong-bench/actions/workflows/ci.yml/badge.svg)](https://github.com/hamakyo/jev-mahjong-bench/actions/workflows/ci.yml)
[![Node.js 20+](https://img.shields.io/badge/Node.js-20%2B-339933?logo=node.js&logoColor=white)](https://nodejs.org/)
[![pnpm 10.34.5](https://img.shields.io/badge/pnpm-10.34.5-F69220?logo=pnpm&logoColor=white)](https://pnpm.io/)
[![Python 3.11+](https://img.shields.io/badge/Python-3.11%2B-3776AB?logo=python&logoColor=white)](https://www.python.org/)
[![RiichiEnv 0.4.10](https://img.shields.io/badge/RiichiEnv-0.4.10-4B5563)](https://github.com/smly/RiichiEnv)
[![License: MIT](https://img.shields.io/badge/license-MIT-yellow.svg)](LICENSE)

[日本語版](README.ja.md)

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

The replay importer and full-game bridge use Python through `uv`.  The
RiichiEnv dependency is pinned to `0.4.10` in `pyproject.toml`/`uv.lock`.

### Run Jev and GPT

```bash
cp .env.example .env
# fill TYPESAFE_API_KEY and OPENAI_API_KEY
set -a && source .env && set +a

pnpm bench -- \
  --agents jev,gpt,hybrid,random \
  --dataset datasets/sample.jsonl \
  --hybrid-threshold 0.75 \
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

For real evaluations, document the source of `referenceAction`. If Mortal is the reference, report **Mortal agreement**, not absolute accuracy. Mixed or undocumented policies use **Reference agreement** with a policy-count breakdown.

Replay-derived samples also contain `state.tileEncoding: "mpsz"`, visible
`state.mjaiEvents`, `observedAction`, and privacy-safe provenance.  The raw game
ID is never written; provenance stores only `sha256(platform + gameId)`.

## MJAI replay import

Tenhou XML and Mahjong Soul protobuf conversion is an external preprocessing
step.  This repository accepts the resulting MJAI JSONL (or `.mjson`) only.
Plain and gzip-compressed files are supported; directories are processed
recursively in dictionary order.

```bash
pnpm dataset:import -- \
  --input path/to/replays \
  --platform tenhou \
  --out datasets/tenhou.jsonl

# If start_game.id is absent:
pnpm dataset:import -- \
  --input one-game.jsonl \
  --platform majsoul \
  --game-id local-game-001 \
  --out datasets/majsoul.jsonl

pnpm dataset:validate -- --dataset datasets/tenhou.jsonl
pnpm dataset:stats -- --dataset datasets/tenhou.jsonl --out results/tenhou-stats.json
```

Validation compares `legalActions` exactly with the rule-aware legal discard
set returned by replaying the same MJAI prefix in RiichiEnv. This preserves
restrictions such as kuikae that cannot be derived from the hand alone, then
checks that the replayed state and observed action agree. Tenhou and Mahjong
Soul inputs use their corresponding RiichiEnv rules (`tenhou` and `mjsoul`).

`fixtures/mjai/seed-42.mjai.jsonl` is a small fixed-seed RiichiEnv fixture.
Replay-derived data may be subject to the terms of the original platform and
should not be redistributed without checking those terms.

## CLI

```text
--agents <list>       jev,gpt,hybrid,hybrid@0.30,mortal,random
--dataset <path>      JSONL dataset
--out <dir>           report directory
--concurrency <n>     concurrent decisions per agent (default: 1)
--seed <n>            deterministic random seed (default: 42)
--hybrid-threshold <n> Jev confidence threshold for hybrid (default: 0.75)
--paired-runs <n>     paired tournament seed blocks (exclusive with --games)
--port <n>            watch server port; 0 selects an ephemeral port
--exit-on-complete <bool> watch-only flag for CI smoke tests
```

Mortal is configured with a JSON file. `command` is an argv array (never a
shell command), and `{seat}` is replaced with the numeric seat. `modelPath` is
hashed at runtime; it is not copied into the report.

```json
{
  "command": ["/path/to/mortal", "--seat", "{seat}"],
  "version": "mortal-v4",
  "modelPath": "/models/mortal.pth",
  "config": {"temperature": 0}
}
```

```bash
pnpm reference:mortal -- \
  --dataset datasets/tenhou.jsonl \
  --out datasets/tenhou-mortal.jsonl \
  --config mortal.json
```

Mortal subprocess execution is serialized (`concurrency=1`), reuses one
process per game/seat, sends only the new MJAI suffix, and restarts/replays the
prefix if observation order regresses. The bridge supplies a cumulative
per-seat MJAI history. A wrapper should emit one JSON response for each
response-triggering event; the adapter drains intermediate pass/call responses
and uses the final discard response for the requested state. Illegal,
malformed, crashed, or timed out responses are explicit errors.

Each run writes `report.json` and `report.md`.

## Full-game tournament

The long-lived Python bridge exposes `startGame`, `step`, and `finish`. v1 is
four-player only; Random, Jev, GPT, Hybrid, and Mortal agents can be mixed and seats
can rotate between games. Complete-game Jev/GPT prompts receive each legal
`{id,type,mjai}` action, so the model can select calls, riichi, wins, passes,
and draws as well as discards.

```bash
pnpm tournament -- \
  --seats jev,gpt,mortal,random \
  --games 10 \
  --mode 4p-red-half \
  --rule tenhou \
  --seed 42 \
  --seat-policy rotate \
  --mortal-config mortal.json \
  --out results/tournament
```

The output includes `tournament.json`, `games.jsonl`, `decisions.jsonl`,
`tournament.md`, `games/<gameId>.mjai.jsonl`, and `replay/`. Agent failures use legal `none`/pass when
available, otherwise the normalized MJAI action with the smallest stable JSON
ordering; requested and applied actions remain separate in every decision
record.

### Live tournament dashboard

`tournament:watch` adds a read-only observer path to the same tournament runner.
It does not change agent inputs, game actions, or the normal tournament
artifacts. The default bind address is loopback; `--port 0` is useful for tests.

```bash
pnpm tournament:watch -- \
  --seats jev,gpt,mortal,hybrid \
  --paired-runs 25 \
  --mode 4p-red-half \
  --rule tenhou \
  --seed 42 \
  --port 3000 \
  --out results/live
```

Open the printed URL in a browser. The spectator stream removes concealed
`start_kyoku.tehais` and `tsumo.pai` fields. `?mode=debug` exposes local-only
diagnostics such as the current LLM state, legal actions, fallback information,
and provider metadata; do not expose debug mode beyond a trusted machine. Use
`--exit-on-complete true` for CI or smoke tests. The server uses only Node's
standard `http` module and keeps a bounded SSE replay buffer for reconnects.

While a watch run is active, the dashboard exposes phase-safe Pause, Resume, and
single-step controls. Pause waits for the current provider decision batch to
finish; it never changes the order of concurrent seat requests. Step advances
exactly one phase: game-start, decision-batch, environment-step, or game-end.

The Live and Replay dashboards share an English/Japanese language selector in
the header. Locale resolution is `?locale=en|ja`, then
`localStorage["jev-mahjong.locale"]`, then the browser's language list, and
finally English. The selector stores only that locale preference; tournament
snapshots, Replay cursors, events, and raw agent/model/action IDs remain
unchanged. For example, use `http://127.0.0.1:3000/?locale=ja` to force
Japanese for one page load.

The primary Spectator view is a fixed four-seat table: player indexes stay at
bottom/right/top/left while the current East/South/West/North wind and dealer
labels update at each hand. Hands, melds, and rivers use the same top-down
orientation in Live, Replay, and video export. Rivers wrap six tiles per row;
the current discard and riichi declaration are highlighted. Spectator exposes
concealed-hand counts and tile backs only. Debug mode may show reconstructed
hands and provider diagnostics.

Tile faces are vendored locally from
[FluffyStuff/riichi-mahjong-tiles](https://github.com/FluffyStuff/riichi-mahjong-tiles)
under its public-domain/CC0 notice in
`src/live/dashboard/assets/tiles/NOTICE.md`. MJAI tile IDs, including red
fives, are mapped centrally in `src/live/dashboard/tiles.ts`.

### Offline replay

Normal tournament runs and tournament:watch save internal observer events,
privacy-safe checkpoints, and byte-offset indexes under the replay/ directory.
Replay never creates an agent or provider and reconstructs snapshots from the
nearest checkpoint.

```bash
pnpm replay:serve -- --input results/live --port 3000
```

The replay UI supports play/pause and decision-level navigation: previous/next
decision, previous/next hand, hand start/end, and playback speed. The URL
parameter `decision=<index>` is the primary selection; the existing
`cursor=<sequence>` remains a compatibility/debug entry point. Raw event
positions are shown only in Debug. Spectator replay applies the same public
projector as the live stream and contains only table state plus public
selection metadata; concealed tiles and provider diagnostics remain
unavailable. Debug places the selected decision's analysis inspector beside
the table.

### Video export

Video export is optional and requires the Playwright package, an installed
Chromium browser, and ffmpeg and ffprobe on PATH. After installing dependencies,
install the browser once with `pnpm exec playwright install chromium`. It reads
only the saved replay artifact and passes encoder arguments without a shell.

```bash
pnpm video:export -- \
  --input results/live \
  --game-id GAME_ID \
  --locale ja \
  --format mp4 \
  --fps 30 \
  --speed 1 \
  --out results/live/replay.mp4
```

Spectator is the default. Debug video requires --debug true; the command also
writes a sidecar JSON containing source, cursor range, seed, viewport, codec,
tool versions, locale, and video SHA-256. Video export always passes the
explicit locale to the browser and does not use browser localStorage or
`navigator.language`; omit `--locale` to use English.

### LLM input and Mortal history

Complete-game observations keep two deliberately separate interfaces. The
bounded `state` contains only the current public state and is sent to Jev, GPT,
and Hybrid. It never contains `state.mjaiEvents`. Mortal receives the cumulative
per-seat `events` history and the append-only `newEvents` suffix instead. This
keeps long replay histories out of provider inputs while preserving the full
prefix required by an external Mortal process.

Before a provider call, the canonical UTF-8 JSON size is checked against the
16 KiB limit. Every game decision records `decisionInputBytes`, `stateBytes`,
and `recentEventCount` (currently zero because recent events are not part of
the initial contract). Tournament summaries include average and maximum input
bytes, escalation counts/rates, provider token totals, and retry counts.

GPT uses a shared Responses API request path for decision and full-game calls.
Temporary 429/503 responses are retried at most three times with a 30-second
retry budget, preferring `Retry-After` and otherwise using bounded exponential
backoff with jitter. Quota, billing, spend-limit, and other permanent errors
are not retried. Retry attempts, statuses, request IDs, and total backoff are
kept in decision metadata; `max_output_tokens` is fixed at 128.

For a paired benchmark, use `--paired-runs` instead of `--games`. Each base
seed runs every unique circular seat rotation, so four distinct agents produce
four games per pair block. Duplicate seat assignments are de-duplicated.

```bash
pnpm tournament -- \
  --seats jev,gpt,mortal,random \
  --paired-runs 25 \
  --mode 4p-red-half \
  --rule tenhou \
  --seed 42 \
  --seat-policy rotate \
  --mortal-config mortal.json \
  --out results/paired
```

`tournament.json` records the seed schedule, pair/rotation identifiers,
dependency versions, model metadata, and a canonical configuration SHA-256.
It also contains per-seat outcomes, Wilson rate intervals, pair-block score and
rank intervals, and pairwise differences. `tournament.md` is the compact human
comparison. Latency and token usage remain in the raw game and decision logs.

Multiple Hybrid thresholds can occupy separate seats in the same paired game:

```bash
pnpm tournament -- \
  --seats jev,gpt,hybrid@0.30,hybrid@0.40 \
  --paired-runs 25 \
  --mode 4p-red-half --rule tenhou --seed 42 \
  --out results/hybrid-calibration
```

`hybrid@<threshold>` is included in the agent ID and tournament configuration
hash. The legacy `hybrid` seat still uses `--hybrid-threshold` (default `0.75`).

### Jev confidence Hybrid

Hybrid calls Jev first. A legal Jev action with confidence at or above the
threshold is kept; missing, invalid, low-confidence, or illegal Jev output is
escalated once to GPT. GPT is checked against the same closed legal-action set,
and a legal Jev action is recorded as an explicit fallback if GPT fails.

```bash
pnpm bench -- \
  --agents jev,gpt,hybrid \
  --hybrid-threshold 0.75 \
  --dataset datasets/tenhou-mortal.jsonl \
  --out results/hybrid

pnpm hybrid:sweep -- \
  --dataset datasets/tenhou-mortal.jsonl \
  --out results/hybrid-sweep

# Reuse provider-calls.jsonl without making provider calls again.
pnpm hybrid:sweep -- \
  --dataset datasets/tenhou-mortal.jsonl \
  --cache-in results/hybrid-sweep/provider-calls.jsonl \
  --thresholds 0.10,0.60,0.70 \
  --out results/hybrid-sweep-re-eval
```

The sweep calls Jev and GPT exactly once per sample to produce same-sample
baselines, then derives every threshold result from those cached responses.
Threshold latency and token metrics count GPT only for decisions escalated by
that threshold, while `usage.physical` records the full collection cost and
`usage.estimatedByThreshold` records per-threshold usage. The default candidates
are `0.20,0.25,0.30,0.35,0.40,0.50`; `hybrid-sweep.json` includes confidence
distribution, provider-specific metrics, fallback/error reasons, and a Pareto
frontier. It writes `provider-calls.jsonl`, `hybrid-sweep.json`,
`hybrid-sweep.md`, and raw per-sample `decisions.jsonl`.

Split calibration and evaluation data by provenance game rather than by sample:

```bash
pnpm dataset:split -- \
  --dataset datasets/mortal-reference.jsonl \
  --calibration-out datasets/calibration.jsonl \
  --evaluation-out datasets/evaluation.jsonl \
  --ratio 0.7 --seed 42 --manifest datasets/split.json
```

The manifest records input/output SHA-256 values, sample/game counts, and the
assertion that no `gameIdHash` occurs in both split.

For a held-out study, run the full threshold sweep on calibration data, choose
at least two Pareto candidates before opening evaluation data, then evaluate
only those candidates. Do not retune the threshold from the held-out results.
The checked-in [calibration record](docs/hybrid-calibration.md) shows this order
with dataset hashes, two preselected candidates, held-out metrics, and paired
full-game results; the bundled toy fixture is explicitly not enough to change
the production default.

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
MJAI JSONL -> uv importer -> dataset.jsonl
            |
    v
Benchmark runner
    |
    +-- JevAgent ------> TypeSafe System One / Choice
    +-- GptAgent ------> OpenAI Responses API / Structured Outputs
    +-- HybridAgent ---> Jev confidence gate -> GPT escalation
    +-- RandomAgent ---> deterministic offline baseline
    +-- MortalAgent --> external MJAI JSONL subprocess
    |
    v
records -> metrics -> report.json + report.md

dataset.jsonl -> uv RiichiEnv bridge -> GameAgent tournament
                              |
                              v
             tournament.json + decisions.jsonl + MJAI logs
```

Tournament watch adds a read-only path:

```text
RiichiEnvBridge -> TournamentObserver -> public projector -> Snapshot/SSE -> browser
                                      \-> debug projector -> local debug view
```

## Roadmap

### Implemented scope

- [x] common agent contract
- [x] Jev adapter
- [x] GPT adapter
- [x] deterministic offline baseline
- [x] JSONL dataset loader
- [x] latency / legality / reference-match metrics
- [x] ECE and Brier score
- [x] JSON + Markdown reports
- [x] tests and GitHub Actions
- [x] import MJAI replay states with red tiles, calls, riichi, provenance, and deterministic IDs
- [x] Mortal reference adapter with model hashing and serialized subprocess execution
- [x] pinned RiichiEnv JSONL bridge and four-player tournament output
- [x] paired tournament schedules, outcome extraction, confidence intervals, and pairwise reports
- [x] Jev-confidence Hybrid agent and threshold sweep
- [x] read-only tournament observer, spectator/debug projector, snapshot store, SSE, and dashboard

### Explicitly out of scope for v1

- Tenhou XML or Mahjong Soul protobuf acquisition/conversion
- three-player mahjong, distributed execution, training, and online play
- Mortal weights, AGPL code, credentials, or automatic model downloads

## References

- [TypeSafe AI JavaScript SDK](https://github.com/typesafe-ai/typesafe-sdk-js)
- [OpenAI Responses API](https://developers.openai.com/api/docs/guides/migrate-to-responses)

## License

MIT
