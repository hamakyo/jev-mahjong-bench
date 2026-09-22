# Published benchmarks

This directory contains intentionally curated, Git-tracked benchmark records.
Normal generated output remains under `results/` and is not committed.

Each publication uses this layout:

```text
benchmarks/<category>/<YYYY-MM-DD>-<slug>-<config-hash-6>/
  manifest.json
  summary.json
  report.md
```

- `manifest.json` records the source run, benchmark commit, canonical config
  hash, dataset hash, safe model identity, and allow-listed configuration.
- `summary.json` contains aggregate metrics using the canonical run vocabulary.
- `report.md` is the human-readable record.

Publish a completed Web UI run explicitly:

```bash
pnpm benchmark:publish -- \
  --run-id <run-id> \
  --category hybrid \
  --slug hybrid-calibration
```

`category` and `slug` accept lowercase letters, numbers, and single hyphens.
When omitted, they are derived from the run type and agent IDs. Repeating the
same publication is idempotent; a different run may not overwrite an existing
publication path.

## Retention and safety policy

Only aggregate results belong in Git. Do not add raw decisions, game logs,
replay checkpoints, provider-call caches or responses, stdout/stderr logs,
videos, or generated datasets. Keep temporary CI results in GitHub Actions
artifacts. If a long-lived raw reproduction bundle is needed, review it for
redistribution and secrets first, then attach it to a GitHub Release.

Publishing rejects secret-bearing configuration keys and common credential
value patterns. Custom provider headers and credential environment-variable
metadata are not serialized. Dataset files must be inside the repository and
are represented by their relative path and SHA-256 digest.
