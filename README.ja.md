# jev-mahjong-bench

**Jev / GPT / Mortal / Hybrid のための再現可能なリーチ麻雀ベンチマーク**

[![CI](https://github.com/hamakyo/jev-mahjong-bench/actions/workflows/ci.yml/badge.svg)](https://github.com/hamakyo/jev-mahjong-bench/actions/workflows/ci.yml)
[![Node.js 20+](https://img.shields.io/badge/Node.js-20%2B-339933?logo=node.js&logoColor=white)](https://nodejs.org/)
[![pnpm 10.34.5](https://img.shields.io/badge/pnpm-10.34.5-F69220?logo=pnpm&logoColor=white)](https://pnpm.io/)
[![Python 3.11+](https://img.shields.io/badge/Python-3.11%2B-3776AB?logo=python&logoColor=white)](https://www.python.org/)
[![RiichiEnv 0.4.10](https://img.shields.io/badge/RiichiEnv-0.4.10-4B5563)](https://github.com/smly/RiichiEnv)
[![License: MIT](https://img.shields.io/badge/license-MIT-yellow.svg)](LICENSE)

[English](README.md)

## 概要

同じ麻雀局面・合法手集合を Jev、GPT、Mortal、Random、Hybrid に与え、
打牌判断と完全対局の品質・速度・コストを再現可能な形で比較します。
MJAI JSONL を共通入力とし、Node.js 側は pnpm、RiichiEnv 連携を含む Python
側は uv で管理します。RiichiEnv は `0.4.10` に固定しています。

主な機能は次のとおりです。

- MJAI実牌譜からのDecisionSample生成、検証、統計出力
- Mortalを外部JSONL subprocessとして使う参照方策
- Jev / GPT / Mortal / Randomによる4人完全対局
- seedと席順を揃えたpaired tournament、局単位成績、ペア差分、95%区間
- Jevの確信度に応じてGPTへエスカレーションするHybridと閾値スイープ

`referenceAction` やMortalとの一致率は比較指標であり、数学的な正解率では
ありません。

## クイックスタート

Node.js 20以上、pnpm 10以上、Python 3.11以上、uvが必要です。

```bash
pnpm install
pnpm check
pnpm bench:sample
```

サンプルベンチマークはオフラインで実行できます。

## 判断ベンチマーク

```bash
cp .env.example .env
# TYPESAFE_API_KEY と OPENAI_API_KEY を設定する
set -a && source .env && set +a

pnpm bench -- \
  --agents jev,gpt,hybrid,random \
  --hybrid-threshold 0.75 \
  --dataset datasets/sample.jsonl \
  --out results/live
```

GPTのモデルと推論設定は環境変数で固定できます。

```bash
OPENAI_MODEL=gpt-5.6-luna
OPENAI_REASONING_EFFORT=none
```

計測する主な指標は、成功率、合法手率、参照方策との一致率、平均・p50・p95
レイテンシ、確信度、ECE、Brier score、入力／出力token数です。

## MJAIデータセットの取り込み

Tenhou XMLや雀魂protobufからMJAI JSONLへ変換する工程は外部工程です。この
リポジトリは変換後のMJAI JSONL（`.jsonl` / `.mjson`、gzip対応）を入力に
します。ディレクトリを指定した場合は辞書順で再帰処理します。

```bash
pnpm dataset:import -- \
  --input path/to/replays \
  --platform tenhou \
  --out datasets/tenhou.jsonl

# start_game.idがない場合はgame-idを指定する
pnpm dataset:import -- \
  --input one-game.jsonl \
  --platform majsoul \
  --game-id local-game-001 \
  --out datasets/majsoul.jsonl

pnpm dataset:validate -- --dataset datasets/tenhou.jsonl
pnpm dataset:stats -- --dataset datasets/tenhou.jsonl \
  --out results/tenhou-stats.json
```

生成サンプルにはMPSZ符号化された局面、判断時点までに観測可能なMJAI
イベント、`observedAction`、秘匿情報を含まないprovenanceが入ります。生の
ゲームIDは保存せず、`sha256(platform + gameId)`のみを保存します。

validatorはRiichiEnvで同じMJAI prefixを再生し、ルールを反映した合法打牌集合
と保存された`legalActions`を完全一致で検証します。喰い替え制約、赤牌、副露、
立直、Tenhou／雀魂ルール差分もこの再生経路で検証します。

## Mortal参照方策

Mortalは設定ファイルからargv配列として起動します。シェルは介さず、
`{seat}`は座席番号に置換されます。モデル本体は同梱せず、実行時にSHA-256を
記録します。

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

ゲーム・座席ごとにプロセスを再利用し、連続サンプルではMJAIイベントの差分
だけを送ります。イベント順が戻った場合はプロセスを再起動してprefixを再生
します。異常終了、タイムアウト、壊れた応答、非合法手は明示的なエラーです。

## 完全対局とpaired tournament

長寿命Python bridgeの`startGame`、`step`、`finish`を通じてRiichiEnvを操作
します。v1は4人麻雀のみで、完全対局の合法手には捨て牌だけでなく、チー、
ポン、カン、立直、ロン、ツモ、パスなどのMJAI操作が含まれます。

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

同じbase seedで全ての一意な循環席替えを実行する場合は、`--games`の代わりに
`--paired-runs`を使います。重複する席配置は除外されます。

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

出力は`tournament.json`、`tournament.md`、`games.jsonl`、`decisions.jsonl`、
`games/<gameId>.mjai.jsonl`、`replay/`です。seed schedule、席順、依存バージョン、モデル
情報、canonical設定SHA-256、エージェント別成績、Wilson区間、score/rankの
Student-t区間、ペア差分を保存します。

### ライブ対局ダッシュボード

`tournament:watch`は、既存の対局実行へ読み取り専用の監視経路を追加します。
agent入力、適用操作、通常の対局成果物は変更しません。既定のlisten先は
loopbackで、`--port 0`はテスト用の一時ポートです。

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

表示されたURLをブラウザで開きます。Spectator用ストリームでは
`start_kyoku.tehais`と`tsumo.pai`を除去します。`?mode=debug`では現在のLLM
state、合法手、fallback、provider metadataなどの診断情報をローカル専用で
表示します。debugモードを信頼できないネットワークへ公開しないでください。
CIやsmoke testでは`--exit-on-complete true`を指定できます。サーバーはNode標準
の`http`だけを使い、SSE再接続用にイベントを有限件数保持します。

watchの`--port 0`は空いているポートを自動割り当てします。通常のwatchは対局
終了後も最終snapshotを提供し、CIでは`--exit-on-complete true`で終了させます。

watch実行中は、局面の安全な境界でPause、Resume、1フェーズだけ進める
Stepを操作できます。Pauseは実行中のprovider判断を中断せず、同時に要求された
座席の判断batchが完了してから停止します。Stepはgame-start、
decision-batch、environment-step、game-endのいずれか1つだけ進めます。

LiveとReplayのheaderにはEnglish／日本語の言語selectorがあります。localeの
解決順は、URLの`?locale=en|ja`、`localStorage["jev-mahjong.locale"]`、
ブラウザの言語一覧、英語の順です。localStorageへ保存するのはlocaleだけで、
tournamentのsnapshot、Replay cursor、event、agent/model/actionのraw IDは
変更しません。たとえば`http://127.0.0.1:3000/?locale=ja`で、そのページを
日本語に固定できます。

Spectatorの主画面は、四席を固定した卓上表示です。player indexは画面下・右・上・左に
固定され、局ごとに東南西北と親の表示だけが更新されます。手牌・副露・河は同じ卓上視点
で回転し、河は6枚ごとに折り返します。最新打牌と立直宣言を強調表示します。Spectator
では非公開手牌を枚数と牌背だけで表示し、Debugでのみ復元した手牌とprovider診断を表示
できます。Live、Replay、動画書き出しは同じrendererを使います。

牌画像は[FluffyStuff/riichi-mahjong-tiles](https://github.com/FluffyStuff/riichi-mahjong-tiles)
からローカルvendorしています。public domain／CC0の出典は
`src/live/dashboard/assets/tiles/NOTICE.md`に記録し、MJAIの牌IDと赤牌を含むasset対応は
`src/live/dashboard/tiles.ts`へ集約しています。

### オフラインReplay

通常のtournamentとtournament:watchは、providerを再実行せずに復元できる内部
イベント、privacy-safe checkpoint、byte offset indexをreplay/へ保存します。

```bash
pnpm replay:serve -- --input results/live --port 3000
```

Replay画面では再生／停止、判断単位の前後移動、前後の局、局頭／局末、速度変更、
Spectator／Debug切替を行えます。URLは`decision=<index>`を主な選択方法とし、
既存の`cursor=<sequence>`も互換・Debug用に残しています。raw eventの位置はDebug
だけに表示します。Spectatorはliveと同じ公開projectorを通り、卓と公開判断メタデータ
だけを表示するため、手牌やprovider診断は表示されません。Debugでは選択した判断の
Analysis inspectorを卓の横に表示します。

### 動画書き出し

動画書き出しは任意機能で、Playwright、Chromium、ffmpeg、ffprobeが必要です。
依存関係をインストールした後、`pnpm exec playwright install chromium`で
ブラウザを一度インストールしてください。保存済みReplayだけを入力にし、
encoderはshellを介さず起動します。

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

既定はSpectatorです。Debug動画は--debug trueを明示した場合だけ作成でき、
入力artifact、cursor範囲、seed、viewport、codec、tool version、動画SHA-256を
localeをsidecar JSONへ保存します。動画書き出しはbrowserのlocalStorageや
`navigator.language`を使わず、全frameへ明示したlocaleを渡します。`--locale`を
省略した場合は英語です。

### LLM入力とMortal履歴

完全対局のObservationでは、LLM入力とMortal履歴を分離しています。`state`は
現在の公開局面だけを含む有界な状態で、Jev、GPT、Hybridへ渡されます。
`state.mjaiEvents`はLLMへ渡しません。一方、Mortalには座席ごとの累積`events`
と、前回から追加された`newEvents`のsuffixを渡します。長い牌譜履歴でLLM入力が
膨張することを防ぎながら、外部Mortalに必要な完全prefixを保持します。

provider呼び出し前にcanonicalなUTF-8 JSONサイズを計算し、16 KiBを超える入力は
呼び出し前に拒否します。各判断ログには`decisionInputBytes`、`stateBytes`、
`recentEventCount`（初期契約ではrecent eventを使わないため現在は0）を保存します。
対局集計には平均・最大入力bytes、Hybridのエスカレーション数・率、provider別
token数、retry数も含まれます。

GPTは判断用と完全対局用で共通のResponses API request経路を使います。一時的な
429/503は最大3回、retry総予算30秒まで再試行し、`Retry-After`を優先します。
指定がない場合は上限付き指数backoffとjitterを使います。quota、billing、spend
limitなどの恒久的エラーは再試行しません。試行回数、status、request ID、backoff
合計は判断metadataに保存し、`max_output_tokens`は128に固定します。

## Jev確信度Hybrid

HybridはまずJevに判断を依頼します。合法なJev手の確信度が閾値以上ならJevを
採用し、確信度の欠落・範囲外・閾値未満・非合法手ではGPTへ一度だけ
エスカレーションします。GPTが失敗した場合は合法なJev手へ明示的にfallback
します。

```bash
pnpm hybrid:sweep -- \
  --dataset datasets/tenhou-mortal.jsonl \
  --out results/hybrid-sweep

# provider-calls.jsonlを再利用してproviderを再呼び出しせず再評価する
pnpm hybrid:sweep -- \
  --dataset datasets/tenhou-mortal.jsonl \
  --cache-in results/hybrid-sweep/provider-calls.jsonl \
  --thresholds 0.10,0.60,0.70 \
  --out results/hybrid-sweep-re-eval
```

スイープでは各サンプルについてJevとGPTをそれぞれ一度だけ実行し、同じ応答
から全閾値を算出します。GPT-only baselineは全サンプル集合で作成し、閾値別の
Hybrid usageはその閾値でGPTが呼び出された判断だけを集計します。thresholdの
既定候補は`0.20,0.25,0.30,0.35,0.40,0.50`で、`provider-calls.jsonl`、
confidence分布、provider別token、fallback/error理由、Pareto frontierを保存します。

完全対局では`hybrid@0.30`と`hybrid@0.40`を同じpaired gameの別席として比較できます。
従来の`hybrid`と`--hybrid-threshold`も後方互換で、既定値は`0.75`です。

calibration/evaluationは牌譜由来sampleが分離されないよう、`gameIdHash`単位で分割します。

```bash
pnpm dataset:split -- \
  --dataset datasets/mortal-reference.jsonl \
  --calibration-out datasets/calibration.jsonl \
  --evaluation-out datasets/evaluation.jsonl \
  --ratio 0.7 --seed 42 --manifest datasets/split.json
```

manifestには入力・出力datasetのSHA-256、sample/game数、seed、ratio、両split間の
`gameIdHash`重複なしが記録されます。

held-out評価では、まずcalibration setで全thresholdをsweepし、evaluation setを
見る前にPareto frontierから少なくとも2候補を選びます。その後は選択済み候補
だけをevaluation setで評価し、結果を見てthresholdを再調整しません。
実測の順序、dataset SHA-256、事前選択した2候補、held-out指標、paired完全対局の
結果は [校正記録](docs/hybrid-calibration.md) に固定しています。今回は同梱toy
fixtureのため、production defaultは変更していません。

## 公平性と対象範囲

- すべてのエージェントに同じ局面と合法手集合を入力する
- モデルID、推論設定、seed、ルール、席順を記録する
- 速度比較では原則concurrency 1を使う
- 平均だけでなくp50/p95と不確実性を報告する
- `referenceAction`は絶対的な正解ではなく比較用の方策である

v1の対象外は、Tenhou XML／雀魂protobufの取得・直接変換、三麻、分散実行、
学習、オンライン対局、Mortalの重み・AGPLコード・資格情報の同梱です。

## アーキテクチャ

```text
MJAI JSONL -> uv importer -> DecisionSample JSONL
                         |
                         +-> Jev / GPT / Mortal / Hybrid benchmark
                         +-> RiichiEnv bridge -> four-player tournament
                         +-> JSON / Markdown / MJAI reports
```

対局watchの読み取り専用経路:

```text
RiichiEnvBridge -> TournamentObserver -> 公開projector -> Snapshot/SSE -> ブラウザ
                                      \-> debug projector -> ローカル診断画面
```

## ライセンス

MIT

元の英語ドキュメントと実装の詳細は[README.md](README.md)を参照してください。
