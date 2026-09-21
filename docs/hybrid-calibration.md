# Hybrid calibration record

実測校正の記録。実施日は 2026-09-22 JST。既定 threshold はこの記録では変更せず、`0.75` を維持する。

## 固定条件

- Jev: `system-one`, reasoning effort `default`
- GPT: `gpt-5.6-luna`, reasoning effort `none`
- 入力: `datasets/sample.jsonl`（リポジトリ同梱のtoy fixture。production thresholdの決定根拠には不十分）
- split: ratio `0.6`, seed `42`
- 入力dataset SHA-256: `5f954ff4bf5d8bd8eab8db231f96514b451c861f70ed52bc1e2bfacc537d364a`
- calibration SHA-256: `1ddc45b153e3a38c40c7ea2bc6436928fe037d36c33e1db8e565b5114a1fc577`
- evaluation SHA-256: `75bee0d022433731b1acf3d5ea0d9a81d963f878a9bad079ce30990a83f26823`
- calibration/evaluation: `3/2` samples, `3/2` groups
- `gameIdHash` overlap: `false` (`0`)

Calibration/evaluationは次の順序で実行した。

1. calibrationで既定候補を全て評価
2. calibrationのPareto frontierから `0.30` と `0.50` を事前選択
3. evaluationでは選択済み2候補だけを評価
4. evaluation結果を見て候補を再調整していない

## Calibration sweep

Jev confidenceの有効値は `0.50, 0.57, 0.64`。分布は min `0.500`、p10 `0.514`、p25 `0.535`、median `0.570`、mean `0.570`、p75 `0.605`、p90 `0.626`、p95 `0.633`、max `0.640`。有効数は `3`、missing/non-finite/out-of-range/illegal Jev actionはすべて `0`。histogramは `0.5-0.6: 2`、`0.6-0.7: 1`、その他は `0`。

| threshold | reference agreement | escalation | Jev/GPT/fallback/error | estimated p50/p95 ms | Jev input/output | GPT input/output | total |
| ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| 0.20 | 100.0% | 0.0% | 3/0/0/0 | 294.8 / 568.6 | 2774 / 366 | 0 / 0 | 3140 |
| 0.25 | 100.0% | 0.0% | 3/0/0/0 | 294.8 / 568.6 | 2774 / 366 | 0 / 0 | 3140 |
| 0.30 | 100.0% | 0.0% | 3/0/0/0 | 294.8 / 568.6 | 2774 / 366 | 0 / 0 | 3140 |
| 0.35 | 100.0% | 0.0% | 3/0/0/0 | 294.8 / 568.6 | 2774 / 366 | 0 / 0 | 3140 |
| 0.40 | 100.0% | 0.0% | 3/0/0/0 | 294.8 / 568.6 | 2774 / 366 | 0 / 0 | 3140 |
| 0.50 | 100.0% | 0.0% | 3/0/0/0 | 294.8 / 568.6 | 2774 / 366 | 0 / 0 | 3140 |

物理collectionはJev/GPT各 `3` calls、`2774/366` と `749/48` tokens、total `3937` tokensだった。threshold別の推定GPT利用量とは分離している。

## Held-out evaluation

事前選択した候補だけを評価した。referenceは2 sampleで、0.30はJev採用、0.50は2件ともGPT採用となった。

| threshold | reference agreement | escalation | Jev/GPT/fallback/error | estimated p50/p95 ms | Jev input/output | GPT input/output | total |
| ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| 0.30 | 50.0% | 0.0% | 2/0/0/0 | 403.3 / 553.5 | 1813 / 228 | 0 / 0 | 2041 |
| 0.50 | 50.0% | 100.0% | 0/2/0/0 | 2211.6 / 2323.1 | 1813 / 228 | 505 / 32 | 2578 |

この結果だけでproduction defaultを変更しない。特に2 sampleではagreement差を推定できず、0.50はcost/latencyだけが増えている。

## Paired full-game comparison

候補2つを、単一の完走済み`--paired-runs 1` scheduleで比較した。実行条件は次のとおり。

```bash
pnpm tournament -- \
  --seats hybrid@0.30,hybrid@0.50,random,random \
  --paired-runs 1 \
  --mode 4p-red-half \
  --rule tenhou \
  --seed 42 \
  --out results/issue-8-evidence/paired-full-game-valid
```

出力manifestは`status=complete`、4 games、4 rotationsで、全gameが同じ`pairId=pair-0`、`baseSeed=42`だった。rotationごとに別実行したgameや、別の`--games`実行結果をこの集計へ混ぜていない。実行した候補の設定SHA-256は `hybrid@0.30=e4ab0338bfe93ac79262482d0e4ee60afb380bb4b35b2c2e7654ea3b164ff537`、`hybrid@0.50=f98789c289e49bcb6c09a394fab4d84928fc781b63d4743f611acaad9af47c6c`。tournament config SHA-256は `3b72eec4ed9e31ba092d9aada11904c864fd252aa2eec12475dd8cbd1b27c788`。

このrunはpaired observationが1 pairだけなので、score/rankの95% CIは算出していない（`—`）。rateもこの小標本の点推定として記録する。CIを根拠に候補を選ぶには、同じpaired scheduleを複数pair完走させる必要がある。

| agent | games | mean score [95% CI] | mean rank [95% CI] | 1st | win | deal-in | riichi | call | escalation | p50/p95 ms | Jev input/output | GPT input/output | fallback/error |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| hybrid@0.30 | 4 | 26625 [—] | 2.0 [—] | 50.0% | 2.4% | 0.0% | 0.0% | 85.7% | 40.4% (387/959) | 282.6 / 2159.4 | 2507929 / 560376 | 469865 / 19460 | 0 / 0 |
| hybrid@0.50 | 4 | 27125 [—] | 2.0 [—] | 50.0% | 0.0% | 2.4% | 0.0% | 88.1% | 67.5% (645/956) | 1456.2 / 2298.9 | 2403565 / 529315 | 811317 / 32451 | 0 / 0 |

paired score difference (`0.30 - 0.50`) は `-500`、95% CIは未算出。rank differenceは `0.0`、95% CIは未算出。両候補ともfallback/errorは`0/0`だった。これらは1 pairの点推定であり、採用判断の根拠にはしない。

### Decision

`0.30` と `0.50` は、calibration frontierから事前に選び、held-outとfull-gameで比較する候補として採用した。toy fixtureのheld-outではagreementは同率だが、`0.30` はescalation、GPT tokens、estimated latencyが少ない。full-gameの1 pairではscore差は`-500`で、CIを算出できる数ではない。したがって、production default `0.75` は変更しない。production datasetで同じ手順を複数pair完走させ、十分なgame/pair数を得た後にdefault変更を別コミットで判断する。

再現用のraw成果物はローカルの `results/issue-8-evidence/` に保存している。providerのraw responseをリポジトリへ追加せず、上記hashと集計値をこの文書へ固定した。
