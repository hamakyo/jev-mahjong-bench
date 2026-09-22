# Issue 12 referent table

Replay UXと牌表示の実装で用いた指示対象・役割の対応表です。

| 出典 | 目的 | 具体対象 | 役割 | 前後関係 | 候補語 | 初出定義 |
| --- | --- | --- | --- | --- | --- | --- |
| Issue #12「Replay navigation」・`src/replay/timeline.ts` | raw MJAIイベント列を人が操作できる移動単位へ変換する | 読込済み`ReplayEventRecord[]`から局境界と`decision:end`のsequence、局内判断番号、actor、agent、適用actionを一度だけ導出した索引 | 値 | raw MJAI event stream → previous/next decision・hand start/end・play/pause | `ReplayNavigationIndex` | `ReplayNavigationIndex`とは、永続Replayを変更せず、読込時にイベント列から導出する局・判断単位の移動先一覧を指す。 |
| Issue #12「selected replay position」・`src/replay/server.ts` | 卓、進捗表示、Analysis inspectorを同じ位置に同期する | raw sequence cursorと、その位置以前の直近判断および所属局を束ねてsnapshot応答へ付ける選択情報 | 状態 | navigation selection → snapshot reconstruction → table/inspector render | `ReplaySelection` | `ReplaySelection`とは、内部cursorと現在局・選択判断を結び付ける表示時の選択状態を指す。 |
| Issue #12「Replay / Spectator」 | 通常観戦で卓と操作を最優先する | 卓、局情報、点数、現在actor、最新action、判断/局単位の操作だけを置く主表示 | 目的 | ReplaySelection → minimal replay view | `Replay view` | `Replay view`とは、benchmark診断を除き、対局経過の閲覧に必要な情報だけを示す主表示を指す。 |
| Issue #12「Analysis / Debug」・`src/live/dashboard/renderer.ts` | 選択判断のbenchmark診断を詳細表示する | requested/applied action、Jev診断、Hybrid経路、provider/model、latency、token、retry/fallback/error、raw MJAIを表示する副表示 | 目的 | ReplaySelection → selected decision metadata → inspector | `Analysis inspector` | `Analysis inspector`とは、選択中の判断に対応する非公開診断情報をdebug modeだけで表示する副パネルを指す。 |
| Issue #12「Tile body」・`src/live/dashboard/renderer.ts` | 透明SVGを物理牌として見せる | 白またはアイボリーの背景、境界、角丸、影、一定aspect ratioを持つ外形の内側にSVG faceを置く共通DOM/CSS | 手段 | tile value → tile body → SVG face artwork | `Tile body` | `Tile body`とは、牌画像そのものではなく、画像を内包して厚みと輪郭を表す外形要素を指す。 |
| Issue #12「Seat orientation」「Concealed hand layout」「Rivers」 | 物理方向と麻雀の並びを狭い画面でも維持する | 座席ごとに全牌群を0°/+90°/180°/-90°回転し、手牌はnowrapかつ縮小、河は6列、副露は別領域にするレイアウト | 手段 | tile body groups → seat rotation and sizing → table placement | `Seat tile layout` | `Seat tile layout`とは、手牌・自摸牌・副露・河を座席方向、改行規則、縮尺に従って配置する共通レイアウトを指す。 |
