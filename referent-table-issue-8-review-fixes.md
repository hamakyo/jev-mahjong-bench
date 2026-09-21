| 出典 | 目的 | 具体対象 | 役割 | 前後関係 | 候補語 | 初出定義 |
| --- | --- | --- | --- | --- | --- | --- |
| Issue #8レビュー P1 | 同一cacheを安全に再評価する | cache top-levelと各rowのJev/GPT model・reasoning effort | 条件 | provider収集 → cache保存 → cache検証 → threshold評価 | row provider signature | row provider signatureとは、cache全体のprovider設定と各sample rowに記録されたprovider設定が一致する条件を指す。 |
| Issue #8レビュー P1 | 元datasetと分割データを保護する | dataset、calibration出力、evaluation出力、manifestの正規化済み絶対パス | 条件 | 引数検証 → 読み込み → 書き込み | split path collision | split path collisionとは、4つの入出力パスのいずれかが同一となり、入力または成果物を上書きする状態を指す。 |
| Issue #8レビュー P1 | threshold候補を実データで選定可能にする | calibration sweep、held-out evaluation、paired full-gameの実行結果 | 記録 | calibration → 事前候補選択 → evaluation → paired tournament → 採用判断 | calibration evidence | calibration evidenceとは、固定seed・dataset hash・model metadataとともに保存したthreshold比較結果を指す。 |
