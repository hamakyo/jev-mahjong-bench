import { DEFAULT_HYBRID_THRESHOLDS } from "../benchmark/hybrid-sweep.js";

export const webDashboardHtml = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>Jev Mahjong Bench</title>
    <link rel="stylesheet" href="/assets/web.css">
  </head>
  <body>
    <header class="topbar">
      <a class="brand" href="/">Jev Mahjong <span>Bench</span></a>
      <nav><button data-view="dashboard" class="active" data-i18n="nav.runs">Runs</button><button data-view="compare" data-i18n="nav.compare">Compare</button><button data-view="new" data-i18n="nav.newRun">New run</button></nav>
      <div class="topbar-tools">
        <span class="local" data-i18n="header.local">Local control plane</span>
        <div class="language-switch" role="group" aria-label="Language" data-i18n-aria-label="language.label">
          <button type="button" data-locale="en" aria-pressed="true">EN</button>
          <button type="button" data-locale="ja" aria-pressed="false">日本語</button>
        </div>
      </div>
    </header>
    <main>
      <section id="dashboard-view">
        <div class="page-heading"><div><p class="eyebrow" data-i18n="dashboard.eyebrow">Experiments</p><h1 data-i18n="dashboard.title">Runs</h1><p data-i18n="dashboard.description">Launch, monitor, inspect, and replay benchmark work from one place.</p></div><button class="primary" data-view="new" data-i18n="nav.newRun">New run</button></div>
        <div id="research-snapshots"></div>
        <div id="running-section"></div>
        <section class="panel">
          <div class="panel-heading"><h2 data-i18n="dashboard.history">Run history</h2><span id="run-count" class="muted"></span></div>
          <div class="filter-bar">
            <label class="filter-search"><span data-i18n="filter.search">Search</span><input id="run-search" type="search" data-i18n-placeholder="filter.searchPlaceholder" placeholder="Agent, model, dataset, or run ID"></label>
            <label><span data-i18n="filter.status">Status</span><select id="run-status-filter"><option value="" data-i18n="filter.allStatuses">All statuses</option><option value="queued" data-i18n="status.queued">Queued</option><option value="running" data-i18n="status.running">Running</option><option value="completed" data-i18n="status.completed">Completed</option><option value="failed" data-i18n="status.failed">Failed</option><option value="cancelled" data-i18n="status.cancelled">Cancelled</option></select></label>
            <label><span data-i18n="filter.type">Run type</span><select id="run-type-filter"><option value="" data-i18n="filter.allTypes">All run types</option><option value="tournament" data-i18n="type.tournament">Tournament</option><option value="benchmark" data-i18n="type.benchmark">Decision benchmark</option><option value="hybrid-sweep" data-i18n="type.hybrid-sweep">Hybrid sweep</option></select></label>
            <label><span data-i18n="filter.since">Created since</span><input id="run-date-filter" type="date"></label>
          </div>
          <div class="selection-bar"><span id="selection-summary" class="muted"></span><button id="compare-selected" class="primary" type="button" disabled data-i18n="action.compareSelected">Compare selected</button></div>
          <div id="runs"></div>
        </section>
      </section>
      <section id="new-view" hidden>
        <div class="page-heading"><div><p class="eyebrow" data-i18n="new.eyebrow">Configure</p><h1 data-i18n="new.title">New run</h1><p data-i18n="new.description">The canonical CLI and artifact formats remain unchanged.</p></div></div>
        <section class="template-section"><div class="section-heading"><h2 data-i18n="templates.title">Experiment templates</h2><p data-i18n="templates.description">Prefill the existing form, then adjust any field before running.</p></div><div id="templates" class="template-grid"></div></section>
        <form id="run-form" class="panel form-grid">
          <label><span data-i18n="form.runType">Run type</span><select name="type" id="run-type"><option value="tournament" data-i18n="type.tournament">Tournament</option><option value="benchmark" data-i18n="type.benchmark">Decision benchmark</option><option value="hybrid-sweep" data-i18n="type.hybrid-sweep">Hybrid sweep</option></select></label>
          <div data-fields="tournament" class="field-group">
            <label class="wide"><span data-i18n="form.seats">Seats</span><input name="seats" value="random,random,random,random" required><small data-i18n="form.seatsHelp">Exactly four comma-separated agent or model IDs.</small></label>
            <label><span data-i18n="form.games">Games</span><input name="games" type="number" min="1" value="1"></label>
            <label><span data-i18n="form.pairedRuns">Paired runs (optional)</span><input name="pairedRuns" type="number" min="1" placeholder="25"></label>
            <label><span data-i18n="form.mode">Mode</span><input name="mode" value="4p-red-half"></label>
            <label><span data-i18n="form.rule">Rule</span><input name="rule" value="tenhou"></label>
            <label><span data-i18n="form.seatPolicy">Seat policy</span><select name="seatPolicy"><option value="rotate" data-i18n="form.rotate">Rotate</option><option value="fixed" data-i18n="form.fixed">Fixed</option></select></label>
            <label><span data-i18n="form.seed">Seed</span><input name="tournamentSeed" type="number" min="0" value="42"></label>
            <label><span data-i18n="form.timeout">Timeout (ms)</span><input name="timeoutMs" type="number" min="1" value="60000"></label>
          </div>
          <div data-fields="benchmark" class="field-group" hidden>
            <label class="wide"><span data-i18n="form.agents">Agents</span><input name="agents" value="random"><small data-i18n="form.agentsHelp">Comma-separated agent or model IDs.</small></label>
            <label class="wide"><span data-i18n="form.dataset">Dataset</span><input name="benchmarkDataset" value="datasets/sample.jsonl"></label>
            <label><span data-i18n="form.concurrency">Concurrency</span><input name="concurrency" type="number" min="1" value="1"></label>
            <label><span data-i18n="form.seed">Seed</span><input name="benchmarkSeed" type="number" min="0" value="42"></label>
          </div>
          <div data-fields="hybrid-sweep" class="field-group" hidden>
            <label class="wide"><span data-i18n="form.dataset">Dataset</span><input name="sweepDataset" value="datasets/sample.jsonl"></label>
            <label class="wide"><span data-i18n="form.thresholds">Thresholds</span><input name="thresholds" value="${DEFAULT_HYBRID_THRESHOLDS.join(",")}"></label>
            <label class="wide"><span data-i18n="form.existingCache">Existing cache (optional)</span><input name="cacheIn" placeholder="results/calibration/provider-calls.jsonl"></label>
          </div>
          <details class="advanced"><summary data-i18n="form.advanced">Provider and Hybrid options</summary><div class="field-group">
            <label><span data-i18n="form.modelsFile">Models file</span><input name="models" placeholder="models.yaml"></label>
            <label><span data-i18n="form.pricingFile">Pricing file</span><input name="pricing" placeholder="pricing.yaml"></label>
            <label><span data-i18n="form.hybridThreshold">Hybrid threshold</span><input name="hybridThreshold" type="number" min="0" max="1" step="0.01" placeholder="0.30"></label>
            <label><span data-i18n="form.hybridFallback">Hybrid fallback</span><input name="hybridFallback" placeholder="gpt"></label>
            <label><span data-i18n="form.mortalConfig">Mortal config</span><input name="mortalConfig" placeholder="mortal.json"></label>
          </div></details>
          <div id="form-error" class="error" hidden></div>
          <div class="form-actions"><button type="button" class="ghost" data-view="dashboard" data-i18n="action.cancel">Cancel</button><button type="submit" class="primary" data-i18n="action.startRun">Start run</button></div>
        </form>
      </section>
      <section id="compare-view" hidden>
        <div class="page-heading"><div><p class="eyebrow" data-i18n="compare.eyebrow">Research</p><h1 data-i18n="compare.title">Compare runs</h1><p data-i18n="compare.description">Compare canonical metrics from compatible completed runs.</p></div></div>
        <div id="compare"></div>
      </section>
      <section id="detail-view" hidden><div id="detail"></div></section>
    </main>
    <script src="/assets/web.js" defer></script>
  </body>
</html>`;

export const webDashboardCss = `
:root { color-scheme: dark; --bg:#0a0e0c; --panel:#111814; --panel-2:#172019; --line:#29352d; --text:#edf5ef; --muted:#8fa297; --green:#63dc91; --amber:#ffc66d; --red:#ff8178; --blue:#77bdfb; font-family:Inter,ui-sans-serif,system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif; }
* { box-sizing:border-box; }
[hidden] { display:none !important; }
body { margin:0; min-height:100vh; background:var(--bg); color:var(--text); }
button,input,select { font:inherit; }
button { cursor:pointer; }
.topbar { min-height:68px; padding:10px clamp(18px,4vw,56px); display:flex; align-items:center; gap:36px; border-bottom:1px solid var(--line); background:var(--bg); position:sticky; top:0; z-index:5; }
.brand { color:var(--text); text-decoration:none; font-weight:760; letter-spacing:-.02em; font-size:18px; }.brand span{color:var(--green)}
nav { display:flex; gap:8px; } nav button,.ghost { border:0; color:var(--muted); background:transparent; border-radius:8px; padding:9px 12px; } nav button:hover,nav button.active,.ghost:hover { color:var(--text); background:var(--panel-2); }
.topbar-tools { margin-left:auto; display:flex; align-items:center; gap:10px; }.local { color:var(--muted); font-size:13px; border:1px solid var(--line); border-radius:99px; padding:6px 10px; }.language-switch{display:flex;align-items:center;gap:2px;border:1px solid var(--line);border-radius:8px;padding:2px;background:var(--panel)}.language-switch button{border:0;border-radius:5px;padding:5px 8px;background:transparent;color:var(--muted);font-size:12px;font-weight:700;white-space:nowrap}.language-switch button:hover{color:var(--text)}.language-switch button[aria-pressed="true"]{background:var(--panel-2);color:var(--green)}
main { width:min(1180px,calc(100% - 32px)); margin:42px auto 80px; }
.page-heading { display:flex; justify-content:space-between; align-items:flex-end; gap:20px; margin-bottom:28px; }.page-heading h1{font-size:clamp(34px,6vw,58px);letter-spacing:-.055em;line-height:.95;margin:4px 0 14px}.page-heading p{color:var(--muted);margin:0;max-width:620px}.eyebrow{color:var(--green)!important;text-transform:uppercase;font-size:12px;font-weight:800;letter-spacing:.16em}
.primary { border:1px solid var(--green); color:#07120b; background:var(--green); font-weight:750; border-radius:9px; padding:10px 15px; }.primary:hover{filter:brightness(1.08)}.primary:disabled{opacity:.45;cursor:not-allowed}
.panel { background:var(--panel); border:1px solid var(--line); border-radius:14px; overflow:hidden; }.panel-heading{display:flex;align-items:center;justify-content:space-between;padding:18px 20px;border-bottom:1px solid var(--line)}.panel-heading h2{font-size:16px;margin:0}
.run-grid { display:grid; grid-template-columns:repeat(auto-fit,minmax(280px,1fr)); gap:12px; margin-bottom:28px; }.run-card{background:var(--panel);border:1px solid var(--line);border-radius:12px;padding:18px}.run-card h3{margin:12px 0 6px;font-size:16px}.run-card p{color:var(--muted);margin:0;font-size:13px}.run-card .actions{margin-top:16px}
.snapshot-section{margin-bottom:28px}.section-heading{display:flex;align-items:flex-end;justify-content:space-between;gap:16px;margin-bottom:12px}.section-heading h2{font-size:16px;margin:0}.section-heading p{color:var(--muted);font-size:12px;margin:4px 0 0}.snapshot-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(300px,1fr));gap:12px}.snapshot{background:var(--panel);border:1px solid var(--line);border-radius:12px;overflow:hidden}.snapshot-header{display:flex;align-items:flex-start;justify-content:space-between;gap:12px;padding:14px 16px;border-bottom:1px solid var(--line)}.snapshot-header h3{font-size:14px;margin:0 0 4px}.snapshot-header p{color:var(--muted);font-size:11px;margin:0}.snapshot-header button{border:0;background:transparent;color:var(--blue);padding:0;font-size:12px}.kpi-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr))}.kpi{padding:14px 16px;border-right:1px solid var(--line);border-bottom:1px solid var(--line)}.kpi:nth-child(2n){border-right:0}.kpi:nth-last-child(-n+2){border-bottom:0}.kpi>span{display:block;color:var(--muted);font-size:10px;font-weight:800;text-transform:uppercase;letter-spacing:.06em;margin-bottom:8px}.kpi dl{display:grid;grid-template-columns:minmax(0,1fr) auto;gap:4px 10px;margin:0;font-size:12px}.kpi dt{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:var(--muted)}.kpi dd{margin:0;color:var(--text);font-variant-numeric:tabular-nums}
.status { display:inline-flex;align-items:center;gap:7px;padding:5px 9px;border-radius:99px;background:#243029;color:var(--muted);font-size:11px;font-weight:800;text-transform:uppercase;letter-spacing:.08em}.status:before{content:"";width:7px;height:7px;border-radius:50%;background:currentColor}.status-running,.status-completed{color:var(--green)}.status-failed{color:var(--red)}.status-cancelled{color:var(--amber)}
table { width:100%; border-collapse:collapse; }th,td{text-align:left;padding:14px 20px;border-bottom:1px solid var(--line);font-size:13px}th{color:var(--muted);font-size:11px;text-transform:uppercase;letter-spacing:.08em}tbody tr{cursor:pointer}tbody tr:hover{background:rgba(255,255,255,.025)}tbody tr:last-child td{border-bottom:0}.run-name{font-weight:700}.muted{color:var(--muted)}
.filter-bar{display:grid;grid-template-columns:minmax(240px,2fr) repeat(3,minmax(140px,1fr));gap:12px;padding:16px 20px;border-bottom:1px solid var(--line)}.filter-bar label{display:flex;flex-direction:column;gap:6px;color:var(--muted);font-size:11px;font-weight:700}.filter-bar input,.filter-bar select{padding:9px 10px}.selection-bar{display:flex;align-items:center;justify-content:space-between;gap:12px;padding:12px 20px;border-bottom:1px solid var(--line);font-size:12px}.run-select{width:18px;height:18px;accent-color:var(--green)}.select-cell{width:46px;padding-right:0}.runs-table tr.is-selected{background:var(--panel-2)}
.form-grid { padding:22px; }.field-group{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:18px;grid-column:1/-1;margin-top:20px}.form-grid>label,.field-group label{display:flex;flex-direction:column;gap:8px;color:var(--muted);font-size:12px;font-weight:700}.wide{grid-column:1/-1}input,select{width:100%;color:var(--text);background:#0c120e;border:1px solid var(--line);border-radius:8px;padding:11px 12px;outline:none}input:focus,select:focus{border-color:var(--green);outline:2px solid var(--green);outline-offset:2px}small{font-weight:400;color:var(--muted)}.advanced{grid-column:1/-1;margin-top:22px;border-top:1px solid var(--line);padding-top:18px}.advanced summary{cursor:pointer;color:var(--muted)}.form-actions{display:flex;justify-content:flex-end;gap:8px;margin-top:24px}.error{margin-top:18px;color:var(--red);background:rgba(255,129,120,.08);border:1px solid rgba(255,129,120,.25);padding:12px;border-radius:8px}
.template-section{margin-bottom:24px}.template-grid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:10px}.template-card{display:flex;flex-direction:column;align-items:flex-start;min-height:104px;border:1px solid var(--line);border-radius:10px;padding:14px;background:var(--panel);color:var(--text);text-align:left}.template-card:hover,.template-card.is-selected{border-color:var(--green);background:var(--panel-2)}.template-card strong{font-size:13px;margin-bottom:6px}.template-card span{color:var(--muted);font-size:11px;line-height:1.5}
.detail-header{display:flex;justify-content:space-between;gap:20px;align-items:flex-start;margin-bottom:24px}.detail-header h1{margin:8px 0;font-size:30px}.detail-actions{display:flex;gap:8px;flex-wrap:wrap}.detail-grid{display:grid;grid-template-columns:minmax(0,1.5fr) minmax(260px,.7fr);gap:18px}.detail-grid .panel{padding:20px}.detail-grid h2{font-size:15px;margin:0 0 16px}.metadata{display:grid;grid-template-columns:140px 1fr;gap:10px;font-size:13px}.metadata dt{color:var(--muted)}.metadata dd{margin:0;word-break:break-word}.result{max-height:540px;overflow:auto;background:#09100c;border-radius:9px;padding:14px;color:#bdd3c5;font:12px/1.55 ui-monospace,SFMono-Regular,Menlo,monospace;white-space:pre-wrap}.result-summary{margin:-4px -20px 18px;overflow:auto}.result-summary table{min-width:720px}.result-summary td,.result-summary th{padding:11px 14px}.raw-result{border-top:1px solid var(--line);padding-top:14px}.raw-result summary{cursor:pointer;color:var(--muted);font-size:12px;margin-bottom:12px}.artifact-list{list-style:none;margin:0;padding:0}.artifact-list li{display:flex;justify-content:space-between;gap:12px;padding:9px 0;border-bottom:1px solid var(--line);font-size:12px}.artifact-list a{color:var(--blue);text-decoration:none;word-break:break-all}.artifact-list li:last-child{border-bottom:0}.empty{padding:34px;text-align:center;color:var(--muted)}
.compare-panel{padding:0}.compare-heading{display:flex;align-items:flex-start;justify-content:space-between;gap:16px;padding:18px 20px;border-bottom:1px solid var(--line)}.compare-heading h2{margin:0 0 5px;font-size:16px}.compare-heading p{margin:0;color:var(--muted);font-size:12px}.compare-scroll{overflow:auto}.compare-table{min-width:760px}.compare-table th,.compare-table td{vertical-align:top}.compare-table thead th:not(:first-child){min-width:180px}.compare-table .category-row th{background:#0c120e;color:var(--green);padding-top:10px;padding-bottom:10px}.compare-column{display:flex;flex-direction:column;gap:4px}.compare-column button{border:0;background:transparent;color:var(--text);padding:0;text-align:left;font-weight:700;cursor:pointer}.compare-column small{color:var(--muted);font-weight:400;text-transform:none;letter-spacing:0}.compare-note{padding:14px 20px;border-top:1px solid var(--line);color:var(--muted);font-size:12px}
@media(max-width:900px){.filter-bar{grid-template-columns:repeat(2,minmax(0,1fr))}.filter-search{grid-column:1/-1}.template-grid{grid-template-columns:repeat(2,minmax(0,1fr))}}
@media(max-width:760px){.local{display:none}.topbar{gap:8px 12px;flex-wrap:wrap}.brand{white-space:nowrap}.topbar-tools{margin-left:auto}nav{order:3;width:100%;overflow:auto}nav button{white-space:nowrap}.detail-grid{grid-template-columns:1fr}.field-group,.filter-bar,.template-grid{grid-template-columns:1fr}.filter-search{grid-column:auto}.wide{grid-column:auto}.page-heading,.detail-header,.section-heading{align-items:flex-start;flex-direction:column}.runs-table th:nth-child(4),.runs-table td:nth-child(4),.runs-table th:nth-child(5),.runs-table td:nth-child(5){display:none}.selection-bar{align-items:flex-start;flex-direction:column}.selection-bar .primary{width:100%}.snapshot-grid{grid-template-columns:1fr}main{margin-top:26px}}
`;

export const webDashboardJs = `(function(){
  const messages={
    en:{
      "language.label":"Language","nav.runs":"Runs","nav.compare":"Compare","nav.newRun":"New run","header.local":"Local control plane",
      "dashboard.eyebrow":"Experiments","dashboard.title":"Runs","dashboard.description":"Launch, monitor, inspect, and replay benchmark work from one place.","dashboard.history":"Run history","dashboard.snapshotTitle":"Recent benchmark snapshots","dashboard.snapshotDescription":"Canonical headline metrics from the latest completed run of each type.","dashboard.noSnapshots":"Complete a run to populate research snapshots.",
      "new.eyebrow":"Configure","new.title":"New run","new.description":"The canonical CLI and artifact formats remain unchanged.",
      "form.runType":"Run type","form.seats":"Seats","form.seatsHelp":"Exactly four comma-separated agent or model IDs.","form.games":"Games","form.pairedRuns":"Paired runs (optional)","form.mode":"Mode","form.rule":"Rule","form.seatPolicy":"Seat policy","form.rotate":"Rotate","form.fixed":"Fixed","form.seed":"Seed","form.timeout":"Timeout (ms)","form.agents":"Agents","form.agentsHelp":"Comma-separated agent or model IDs.","form.dataset":"Dataset","form.concurrency":"Concurrency","form.thresholds":"Thresholds","form.existingCache":"Existing cache (optional)","form.advanced":"Provider and Hybrid options","form.modelsFile":"Models file","form.pricingFile":"Pricing file","form.hybridThreshold":"Hybrid threshold","form.hybridFallback":"Hybrid fallback","form.mortalConfig":"Mortal config",
      "type.tournament":"Tournament","type.benchmark":"Decision benchmark","type.hybrid-sweep":"Hybrid sweep",
      "action.cancel":"Cancel","action.startRun":"Start run","action.inspect":"Inspect","action.allRuns":"All runs","action.watchLive":"Watch live","action.openReplay":"Open replay","action.stopRun":"Stop run","action.compareSelected":"Compare selected","action.addCompare":"Add to comparison","action.openRun":"Open run",
      "status.queued":"Queued","status.running":"Running","status.completed":"Completed","status.failed":"Failed","status.cancelled":"Cancelled",
      "run.benchmark":"Benchmark","run.hybrid":"Hybrid threshold sweep","run.started":"started","run.total":"total","run.none":"No runs yet. Start with a local tournament or decision benchmark.","run.stopConfirm":"Stop this run?",
      "table.run":"Run","table.status":"Status","table.created":"Created","table.type":"Type","table.agent":"Agent","table.decisions":"Decisions","table.success":"Success","table.legal":"Legal","table.agreement":"Agreement","table.p50":"p50 ms","table.p95":"p95 ms","table.tokensPerDecision":"Tokens / decision","table.games":"Games","table.avgScore":"Avg score","table.avgRank":"Avg rank","table.first":"1st","table.fourth":"4th","table.win":"Win","table.dealIn":"Deal-in","table.fallback":"Fallback","table.threshold":"Threshold","table.escalation":"Escalation","table.tokens":"Tokens",
      "detail.results":"Results","detail.awaiting":"Results will appear when canonical artifacts are available.","detail.rawJson":"Canonical result JSON","detail.metadata":"Run metadata","detail.runId":"Run ID","detail.configHash":"Config hash","detail.created":"Created","detail.started":"Started","detail.finished":"Finished","detail.configuration":"Configuration","detail.artifacts":"Artifacts","detail.noArtifacts":"No artifacts yet","error.requestFailed":"Request failed",
      "filter.search":"Search","filter.searchPlaceholder":"Agent, model, dataset, or run ID","filter.status":"Status","filter.type":"Run type","filter.since":"Created since","filter.allStatuses":"All statuses","filter.allTypes":"All run types","filter.noMatches":"No runs match these filters.",
      "selection.selected":"selected","selection.compatible":"Only completed runs of the same type can be selected.",
      "compare.eyebrow":"Research","compare.title":"Compare runs","compare.description":"Compare canonical metrics from compatible completed runs.","compare.empty":"Select at least two compatible completed runs from the Runs page.","compare.loading":"Loading comparison…","compare.unavailable":"Unavailable metrics are shown as — and are never treated as zero.","compare.metric":"Metric","compare.runs":"runs","compare.series":"result series",
      "category.gameplay":"Gameplay","category.decision-quality":"Decision quality","category.efficiency":"Efficiency",
      "metric.games":"Games","metric.meanScore":"Mean score","metric.meanRank":"Mean rank","metric.firstRate":"1st-place rate","metric.fourthRate":"4th-place rate","metric.winRate":"Win rate","metric.dealInRate":"Deal-in rate","metric.riichiRate":"Riichi rate","metric.callRate":"Call rate","metric.decisions":"Decisions","metric.successRate":"Success rate","metric.legalActionRate":"Legal-action rate","metric.exactMatchRate":"Reference agreement","metric.referenceEce":"Reference ECE","metric.brierScore":"Brier score","metric.p50LatencyMs":"p50 latency","metric.p95LatencyMs":"p95 latency","metric.totalTokensPerDecision":"Tokens / decision","metric.costPerDecisionUsd":"Cost / decision","metric.escalationRate":"Hybrid escalation rate","metric.fallbackRate":"Fallback rate","metric.errorRate":"Error rate","metric.agreementRate":"Reference agreement","metric.legalRate":"Legal-action rate","metric.estimatedP50LatencyMs":"Estimated p50 latency","metric.estimatedP95LatencyMs":"Estimated p95 latency","metric.estimatedTotalTokens":"Estimated total tokens","metric.estimatedGptCost":"Estimated GPT cost",
      "templates.title":"Experiment templates","templates.description":"Prefill the existing form, then adjust any field before running.","template.decision-benchmark.name":"Decision benchmark","template.decision-benchmark.description":"Compare Jev and GPT on the same decision dataset.","template.jev-vs-gpt.name":"Jev vs GPT","template.jev-vs-gpt.description":"Four-seat East-game comparison with rotating seats.","template.hybrid-calibration.name":"Hybrid calibration","template.hybrid-calibration.description":"Evaluate the standard confidence-threshold candidates.","template.provider-arena.name":"Provider arena","template.provider-arena.description":"Jev, GPT Luna, DeepSeek, and Hybrid in one tournament.","template.paired-full-game.name":"Paired full-game comparison","template.paired-full-game.description":"Run seat-rotated paired Hanchan games.","template.local-model-benchmark.name":"Local model benchmark","template.local-model-benchmark.description":"Start from a local-model registry entry and edit as needed."
    },
    ja:{
      "language.label":"言語","nav.runs":"実行一覧","nav.compare":"比較","nav.newRun":"新しい実行","header.local":"ローカル管理",
      "dashboard.eyebrow":"実験","dashboard.title":"実行一覧","dashboard.description":"ベンチマークの開始、監視、結果確認、リプレイをここから行えます。","dashboard.history":"実行履歴","dashboard.snapshotTitle":"最近のベンチマーク概要","dashboard.snapshotDescription":"実行種別ごとの最新完了Runから正式な主要指標を表示します。","dashboard.noSnapshots":"Runが完了するとリサーチ概要が表示されます。",
      "new.eyebrow":"設定","new.title":"新しい実行","new.description":"CLIと成果物の形式は変わりません。",
      "form.runType":"実行種別","form.seats":"席","form.seatsHelp":"カンマ区切りのエージェントまたはモデルIDを4つ指定します。","form.games":"対局数","form.pairedRuns":"ペア実行数（任意）","form.mode":"モード","form.rule":"ルール","form.seatPolicy":"席順","form.rotate":"ローテーション","form.fixed":"固定","form.seed":"シード","form.timeout":"タイムアウト（ms）","form.agents":"エージェント","form.agentsHelp":"エージェントまたはモデルIDをカンマ区切りで指定します。","form.dataset":"データセット","form.concurrency":"並列数","form.thresholds":"しきい値","form.existingCache":"既存キャッシュ（任意）","form.advanced":"プロバイダー / Hybrid 詳細設定","form.modelsFile":"モデル設定ファイル","form.pricingFile":"料金設定ファイル","form.hybridThreshold":"Hybridしきい値","form.hybridFallback":"Hybridフォールバック","form.mortalConfig":"Mortal設定",
      "type.tournament":"対局","type.benchmark":"打牌判断ベンチマーク","type.hybrid-sweep":"Hybridスイープ",
      "action.cancel":"キャンセル","action.startRun":"実行開始","action.inspect":"詳細を見る","action.allRuns":"実行一覧","action.watchLive":"ライブを見る","action.openReplay":"リプレイを開く","action.stopRun":"実行を停止","action.compareSelected":"選択した実行を比較","action.addCompare":"比較対象に追加","action.openRun":"Runを開く",
      "status.queued":"待機中","status.running":"実行中","status.completed":"完了","status.failed":"失敗","status.cancelled":"中止",
      "run.benchmark":"ベンチマーク","run.hybrid":"Hybridしきい値スイープ","run.started":"開始","run.total":"件","run.none":"実行履歴はまだありません。対局または打牌判断ベンチマークを開始してください。","run.stopConfirm":"この実行を停止しますか？",
      "table.run":"実行","table.status":"状態","table.created":"作成日時","table.type":"種別","table.agent":"エージェント","table.decisions":"判断数","table.success":"成功率","table.legal":"合法手率","table.agreement":"一致率","table.p50":"p50（ms）","table.p95":"p95（ms）","table.tokensPerDecision":"判断あたりトークン","table.games":"対局数","table.avgScore":"平均得点","table.avgRank":"平均順位","table.first":"1位率","table.fourth":"4位率","table.win":"和了率","table.dealIn":"放銃率","table.fallback":"フォールバック率","table.threshold":"しきい値","table.escalation":"エスカレーション率","table.tokens":"トークン数",
      "detail.results":"結果","detail.awaiting":"正式な成果物が生成されると結果が表示されます。","detail.rawJson":"正式な結果JSON","detail.metadata":"実行情報","detail.runId":"実行ID","detail.configHash":"設定ハッシュ","detail.created":"作成日時","detail.started":"開始日時","detail.finished":"終了日時","detail.configuration":"設定","detail.artifacts":"成果物","detail.noArtifacts":"成果物はまだありません","error.requestFailed":"リクエストに失敗しました",
      "filter.search":"検索","filter.searchPlaceholder":"エージェント、モデル、データセット、実行ID","filter.status":"状態","filter.type":"実行種別","filter.since":"この日以降","filter.allStatuses":"すべての状態","filter.allTypes":"すべての実行種別","filter.noMatches":"条件に一致する実行はありません。",
      "selection.selected":"件選択","selection.compatible":"同じ種別の完了済み実行のみ選択できます。",
      "compare.eyebrow":"リサーチ","compare.title":"実行を比較","compare.description":"互換性のある完了済み実行の正式な指標を比較します。","compare.empty":"実行一覧から互換性のある完了済み実行を2件以上選択してください。","compare.loading":"比較結果を読み込み中…","compare.unavailable":"取得できない指標は0ではなく「—」で表示します。","compare.metric":"指標","compare.runs":"実行","compare.series":"系列",
      "category.gameplay":"対局成績","category.decision-quality":"判断品質","category.efficiency":"効率",
      "metric.games":"対局数","metric.meanScore":"平均得点","metric.meanRank":"平均順位","metric.firstRate":"1位率","metric.fourthRate":"4位率","metric.winRate":"和了率","metric.dealInRate":"放銃率","metric.riichiRate":"立直率","metric.callRate":"副露率","metric.decisions":"判断数","metric.successRate":"成功率","metric.legalActionRate":"合法手率","metric.exactMatchRate":"参照方策一致率","metric.referenceEce":"参照ECE","metric.brierScore":"Brierスコア","metric.p50LatencyMs":"p50レイテンシ","metric.p95LatencyMs":"p95レイテンシ","metric.totalTokensPerDecision":"判断あたりトークン","metric.costPerDecisionUsd":"判断あたりコスト","metric.escalationRate":"Hybridエスカレーション率","metric.fallbackRate":"フォールバック率","metric.errorRate":"エラー率","metric.agreementRate":"参照方策一致率","metric.legalRate":"合法手率","metric.estimatedP50LatencyMs":"推定p50レイテンシ","metric.estimatedP95LatencyMs":"推定p95レイテンシ","metric.estimatedTotalTokens":"推定総トークン数","metric.estimatedGptCost":"推定GPTコスト",
      "templates.title":"実験テンプレート","templates.description":"既存フォームへ初期値を入れます。実行前にすべて編集できます。","template.decision-benchmark.name":"打牌判断ベンチマーク","template.decision-benchmark.description":"同じ判断データセットでJevとGPTを比較します。","template.jev-vs-gpt.name":"Jev vs GPT","template.jev-vs-gpt.description":"席順を回しながら東風戦で比較します。","template.hybrid-calibration.name":"Hybrid校正","template.hybrid-calibration.description":"標準の確信度しきい値候補を評価します。","template.provider-arena.name":"プロバイダーアリーナ","template.provider-arena.description":"Jev、GPT Luna、DeepSeek、Hybridを同じ対局で比較します。","template.paired-full-game.name":"ペア完全対局比較","template.paired-full-game.description":"席順を回したペア半荘を実行します。","template.local-model-benchmark.name":"ローカルモデル評価","template.local-model-benchmark.description":"ローカルモデル設定を初期値にして編集できます。"
    }
  };
  function initialLocale(){try{const saved=localStorage.getItem("jev-web-locale");if(saved==="en"||saved==="ja")return saved;}catch{}return navigator.language&&navigator.language.toLowerCase().startsWith("ja")?"ja":"en";}
  const state={runs:[],snapshots:[],templates:[],selectedTemplate:null,selected:null,timer:null,locale:initialLocale(),compareIds:new Set()};
  const $=(id)=>document.getElementById(id);
  const t=(key)=>messages[state.locale][key]||messages.en[key]||key;
  function applyLocale(){document.documentElement.lang=state.locale;document.querySelectorAll("[data-i18n]").forEach((node)=>{node.textContent=t(node.dataset.i18n);});document.querySelectorAll("[data-i18n-placeholder]").forEach((node)=>{node.setAttribute("placeholder",t(node.dataset.i18nPlaceholder));});document.querySelectorAll("[data-i18n-aria-label]").forEach((node)=>{node.setAttribute("aria-label",t(node.dataset.i18nAriaLabel));});document.querySelectorAll("[data-locale]").forEach((node)=>{node.setAttribute("aria-pressed",String(node.dataset.locale===state.locale));});try{localStorage.setItem("jev-web-locale",state.locale);}catch{}}
  const esc=(value)=>String(value==null?"":value).replace(/[&<>"']/g,(char)=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"})[char]);
  const pretty=(value)=>JSON.stringify(value,null,2);
  const status=(value)=>'<span class="status status-'+esc(value)+'">'+esc(t("status."+value)||value)+'</span>';
  const time=(value)=>value?new Date(value).toLocaleString(state.locale==="ja"?"ja-JP":"en-US"):"—";
  const bytes=(value)=>value<1024?value+" B":value<1048576?(value/1024).toFixed(1)+" KiB":(value/1048576).toFixed(1)+" MiB";
  async function api(path,options){const response=await fetch(path,Object.assign({cache:"no-store"},options||{}));const body=await response.json().catch(()=>({}));if(!response.ok)throw new Error(body.error||(t("error.requestFailed")+": "+response.status));return body;}
  function view(name){
    $("dashboard-view").hidden=name!=="dashboard";$("new-view").hidden=name!=="new";$("compare-view").hidden=name!=="compare";$("detail-view").hidden=name!=="detail";
    document.querySelectorAll("nav button").forEach((node)=>node.classList.toggle("active",node.dataset.view===name));
    if(name!=="detail")history.replaceState({},"",name==="new"?"/new":name==="compare"?"/compare":"/");
  }
  function typeLabel(value){return t("type."+value);}
  function runTitle(run){const config=run.config||{};if(run.type==="tournament")return (config.seats||[]).join(" vs ");if(run.type==="benchmark")return t("run.benchmark")+" · "+(config.agents||[]).join(", ");return t("run.hybrid");}
  const fixed=(value,digits)=>typeof value==="number"&&Number.isFinite(value)?value.toFixed(digits):"—";
  const percent=(value)=>typeof value==="number"&&Number.isFinite(value)?(value*100).toFixed(1)+"%":"—";
  function resultTable(headers,rows){return '<div class="result-summary"><table><thead><tr>'+headers.map((value)=>'<th>'+esc(value)+'</th>').join("")+'</tr></thead><tbody>'+rows.map((row)=>'<tr>'+row.map((value)=>'<td>'+esc(value)+'</td>').join("")+'</tr>').join("")+'</tbody></table></div>';}
  function renderResult(run,result){
    if(!result)return '<div class="empty">'+esc(t("detail.awaiting"))+'</div>';
    let summary="";
    if(run.type==="benchmark"&&Array.isArray(result.summaries))summary=resultTable(["table.agent","table.decisions","table.success","table.legal","table.agreement","table.p50","table.p95","table.tokensPerDecision"].map(t),result.summaries.map((item)=>[item.agentId,item.decisions,percent(item.successRate),percent(item.legalActionRate),percent(item.exactMatchRate),fixed(item.p50LatencyMs,1),fixed(item.p95LatencyMs,1),fixed(item.totalTokensPerDecision??((item.inputTokens+item.outputTokens)/Math.max(1,item.decisions)),1)]));
    else if(run.type==="tournament"&&Array.isArray(result.metrics?.agents))summary=resultTable(["table.agent","table.games","table.avgScore","table.avgRank","table.first","table.fourth","table.win","table.dealIn","table.p95","table.fallback"].map(t),result.metrics.agents.map((item)=>[item.agentId,item.games,fixed(item.meanScore,0),fixed(item.meanRank,2),percent(item.firstRate),percent(item.fourthRate),percent(item.winRate),percent(item.dealInRate),fixed(item.p95LatencyMs,1),percent(item.fallbackRate)]));
    else if(run.type==="hybrid-sweep"&&Array.isArray(result.thresholdResults))summary=resultTable(["table.threshold","table.agreement","table.escalation","table.legal","table.p50","table.p95","table.tokens","table.fallback"].map(t),result.thresholdResults.map((item)=>[fixed(item.threshold,2),percent(item.agreementRate),percent(item.escalationRate),percent(item.legalRate),fixed(item.estimatedP50LatencyMs,1),fixed(item.estimatedP95LatencyMs,1),item.estimatedUsage?.totalTokens??item.totalTokens,percent(item.fallbackRate)]));
    return summary+'<details class="raw-result"><summary>'+esc(t("detail.rawJson"))+'</summary><pre class="result">'+esc(pretty(result))+'</pre></details>';
  }
  function renderRuns(){
    const active=state.runs.filter((run)=>run.status==="queued"||run.status==="running");
    $("running-section").innerHTML=active.length?'<p class="eyebrow">'+esc(t("status.running"))+'</p><div class="run-grid">'+active.map((run)=>'<article class="run-card" data-run="'+esc(run.id)+'">'+status(run.status)+'<h3>'+esc(runTitle(run))+'</h3><p>'+esc(typeLabel(run.type))+' · '+esc(t("run.started"))+' '+esc(time(run.startedAt||run.createdAt))+'</p><div class="actions"><button class="primary" data-open="'+esc(run.id)+'">'+esc(t("action.inspect"))+'</button></div></article>').join("")+'</div>':"";
    const query=$("run-search").value.trim().toLowerCase();const statusFilter=$("run-status-filter").value;const typeFilter=$("run-type-filter").value;const since=$("run-date-filter").value;
    const filtered=state.runs.filter((run)=>{const haystack=(run.id+" "+run.type+" "+JSON.stringify(run.config||{})).toLowerCase();return(!query||haystack.includes(query))&&(!statusFilter||run.status===statusFilter)&&(!typeFilter||run.type===typeFilter)&&(!since||run.createdAt.slice(0,10)>=since);});
    const countText=filtered.length===state.runs.length?String(state.runs.length):filtered.length+" / "+state.runs.length;
    $("run-count").textContent=state.locale==="ja"?countText+t("run.total"):countText+" "+t("run.total");
    const selectedRuns=state.runs.filter((run)=>state.compareIds.has(run.id));const selectedType=selectedRuns[0]?.type;const selectedCount=state.compareIds.size;
    $("selection-summary").textContent=(state.locale==="ja"?selectedCount+t("selection.selected"):selectedCount+" "+t("selection.selected"))+" · "+t("selection.compatible");
    $("compare-selected").disabled=selectedCount<2;
    $("runs").innerHTML=filtered.length?'<table class="runs-table"><thead><tr><th class="select-cell"></th>'+["table.run","table.status","table.created","table.type"].map((key)=>'<th>'+esc(t(key))+'</th>').join("")+'</tr></thead><tbody>'+filtered.map((run)=>{const checked=state.compareIds.has(run.id);const disabled=run.status!=="completed"||(!checked&&selectedType&&run.type!==selectedType);return '<tr data-open="'+esc(run.id)+'" class="'+(checked?'is-selected':'')+'"><td class="select-cell"><input class="run-select" type="checkbox" data-select="'+esc(run.id)+'" '+(checked?'checked ':'')+(disabled?'disabled ':'')+'aria-label="'+esc(t("action.addCompare"))+'"></td><td><span class="run-name">'+esc(runTitle(run))+'</span><br><span class="muted">'+esc(run.id)+'</span></td><td>'+status(run.status)+'</td><td>'+esc(time(run.createdAt))+'</td><td>'+esc(typeLabel(run.type))+'</td></tr>';}).join("")+'</tbody></table>':'<div class="empty">'+esc(state.runs.length?t("filter.noMatches"):t("run.none"))+'</div>';
  }
  function comparisonValue(value,format){if(typeof value!=="number"||!Number.isFinite(value))return "—";if(format==="percent")return (value*100).toFixed(1)+"%";if(format==="milliseconds")return value.toFixed(1)+" ms";if(format==="usd")return "$"+value.toFixed(6);return new Intl.NumberFormat(state.locale==="ja"?"ja-JP":"en-US",{maximumFractionDigits:3}).format(value);}
  function renderSnapshots(){
    if(!state.snapshots.length){$("research-snapshots").innerHTML='<section class="snapshot-section"><div class="section-heading"><div><h2>'+esc(t("dashboard.snapshotTitle"))+'</h2><p>'+esc(t("dashboard.snapshotDescription"))+'</p></div></div><div class="panel empty">'+esc(t("dashboard.noSnapshots"))+'</div></section>';return;}
    const cards=state.snapshots.map((snapshot)=>{const metrics=snapshot.metrics.map((metric)=>'<div class="kpi"><span>'+esc(t("metric."+metric.key))+'</span><dl>'+snapshot.columns.map((column)=>'<dt title="'+esc(column.entityId)+'">'+esc(column.entityId)+'</dt><dd>'+esc(comparisonValue(column.values[metric.key],metric.format))+'</dd>').join("")+'</dl></div>').join("");return '<article class="snapshot"><div class="snapshot-header"><div><h3>'+esc(typeLabel(snapshot.runType))+'</h3><p>'+esc(time(snapshot.createdAt))+'</p></div><button type="button" data-open="'+esc(snapshot.runId)+'">'+esc(t("action.openRun"))+' →</button></div><div class="kpi-grid">'+metrics+'</div></article>';}).join("");
    $("research-snapshots").innerHTML='<section class="snapshot-section"><div class="section-heading"><div><h2>'+esc(t("dashboard.snapshotTitle"))+'</h2><p>'+esc(t("dashboard.snapshotDescription"))+'</p></div></div><div class="snapshot-grid">'+cards+'</div></section>';
  }
  function renderTemplates(){$("templates").innerHTML=state.templates.map((template)=>'<button type="button" class="template-card '+(state.selectedTemplate===template.id?'is-selected':'')+'" data-template="'+esc(template.id)+'"><strong>'+esc(t("template."+template.id+".name"))+'</strong><span>'+esc(t("template."+template.id+".description"))+'</span></button>').join("");}
  function setFormValue(form,name,value){const field=form.elements[name];if(!field||value===undefined||value===null)return;field.value=Array.isArray(value)?value.join(","):String(value);}
  function applyTemplate(template){
    const form=$("run-form");form.reset();setFormValue(form,"type",template.type);setFields();const config=template.config||{};
    const names=template.type==="tournament"?{seats:"seats",games:"games",pairedRuns:"pairedRuns",mode:"mode",rule:"rule",seatPolicy:"seatPolicy",seed:"tournamentSeed",timeoutMs:"timeoutMs"}:template.type==="benchmark"?{agents:"agents",dataset:"benchmarkDataset",concurrency:"concurrency",seed:"benchmarkSeed"}:{dataset:"sweepDataset",thresholds:"thresholds",cacheIn:"cacheIn"};
    for(const [key,name] of Object.entries(names))setFormValue(form,name,config[key]);for(const name of ["models","pricing","hybridThreshold","hybridFallback","mortalConfig"])setFormValue(form,name,config[name]);state.selectedTemplate=template.id;renderTemplates();
  }
  async function renderComparison(){
    view("compare");const ids=[...state.compareIds];
    if(ids.length<2){$("compare").innerHTML='<section class="panel"><div class="empty">'+esc(t("compare.empty"))+'</div></section>';return;}
    $("compare").innerHTML='<section class="panel"><div class="empty">'+esc(t("compare.loading"))+'</div></section>';
    try{
      const data=await api("/api/runs/compare?ids="+encodeURIComponent(ids.join(",")));history.replaceState({},"","/compare?ids="+encodeURIComponent(ids.join(",")));
      const categories=["gameplay","decision-quality","efficiency"];
      const rows=categories.map((category)=>{const definitions=data.metrics.filter((metric)=>metric.category===category);if(!definitions.length)return "";return '<tr class="category-row"><th colspan="'+(data.columns.length+1)+'">'+esc(t("category."+category))+'</th></tr>'+definitions.map((metric)=>'<tr><th>'+esc(t("metric."+metric.key))+'</th>'+data.columns.map((column)=>'<td>'+esc(comparisonValue(column.values[metric.key],metric.format))+'</td>').join("")+'</tr>').join("");}).join("");
      const headers=data.columns.map((column)=>'<th><div class="compare-column"><button data-open="'+esc(column.runId)+'">'+esc(column.entityId)+'</button><small>'+esc(column.runId)+' · '+esc(column.configHash.slice(0,8))+'</small></div></th>').join("");
      const scope=state.locale==="ja"?ids.length+t("compare.runs")+" · "+data.columns.length+t("compare.series"):ids.length+" "+t("compare.runs")+" · "+data.columns.length+" "+t("compare.series");
      $("compare").innerHTML='<section class="panel compare-panel"><div class="compare-heading"><div><h2>'+esc(typeLabel(data.runType))+'</h2><p>'+esc(scope)+'</p></div><button class="ghost" data-view="dashboard">← '+esc(t("action.allRuns"))+'</button></div><div class="compare-scroll"><table class="compare-table"><thead><tr><th>'+esc(t("compare.metric"))+'</th>'+headers+'</tr></thead><tbody>'+rows+'</tbody></table></div><div class="compare-note">'+esc(t("compare.unavailable"))+'</div></section>';
    }catch(error){$("compare").innerHTML='<div class="error">'+esc(error.message)+'</div>';}
  }
  async function refresh(){const [runs,dashboard]=await Promise.all([api("/api/runs"),api("/api/research/dashboard")]);state.runs=runs;state.snapshots=dashboard.snapshots||[];renderRuns();renderSnapshots();if(state.selected)await detail(state.selected,true);}
  async function detail(id,quiet){
    try{
      const data=await api("/api/runs/"+encodeURIComponent(id));state.selected=id;const run=data.run;const terminal=["completed","failed","cancelled"].includes(run.status);
      const actions=[];
      if(run.liveUrl&&run.status==="running")actions.push('<a class="primary" href="'+esc(run.liveUrl)+'" target="_blank">'+esc(t("action.watchLive"))+'</a>');
      if(run.type==="tournament"&&terminal)actions.push('<button class="primary" data-replay="'+esc(run.id)+'">'+esc(t("action.openReplay"))+'</button>');
      if(run.status==="completed")actions.push('<button class="ghost" data-add-compare="'+esc(run.id)+'">'+esc(t("action.addCompare"))+'</button>');
      if(!terminal)actions.push('<button class="ghost" data-cancel="'+esc(run.id)+'">'+esc(t("action.stopRun"))+'</button>');
      const artifacts=(data.artifacts||[]).map((item)=>'<li><a href="/api/runs/'+encodeURIComponent(run.id)+'/artifact?path='+encodeURIComponent(item.path)+'" target="_blank">'+esc(item.path)+'</a><span class="muted">'+bytes(item.bytes)+'</span></li>').join("");
      $("detail").innerHTML='<button class="ghost" data-view="dashboard">← '+esc(t("action.allRuns"))+'</button><div class="detail-header"><div><p class="eyebrow">'+esc(typeLabel(run.type))+'</p><h1>'+esc(runTitle(run))+'</h1>'+status(run.status)+'</div><div class="detail-actions">'+actions.join("")+'</div></div>'+(run.error?'<div class="error">'+esc(run.error)+'</div>':'')+'<div class="detail-grid"><section class="panel"><h2>'+esc(t("detail.results"))+'</h2>'+renderResult(run,data.result)+'</section><aside><section class="panel"><h2>'+esc(t("detail.metadata"))+'</h2><dl class="metadata"><dt>'+esc(t("detail.runId"))+'</dt><dd>'+esc(run.id)+'</dd><dt>'+esc(t("detail.configHash"))+'</dt><dd>'+esc(run.configHash)+'</dd><dt>'+esc(t("detail.created"))+'</dt><dd>'+esc(time(run.createdAt))+'</dd><dt>'+esc(t("detail.started"))+'</dt><dd>'+esc(time(run.startedAt))+'</dd><dt>'+esc(t("detail.finished"))+'</dt><dd>'+esc(time(run.finishedAt))+'</dd></dl><h2 style="margin-top:24px">'+esc(t("detail.configuration"))+'</h2><pre class="result">'+esc(pretty(run.config))+'</pre></section><section class="panel" style="margin-top:18px"><h2>'+esc(t("detail.artifacts"))+'</h2><ul class="artifact-list">'+(artifacts||'<li class="muted">'+esc(t("detail.noArtifacts"))+'</li>')+'</ul></section></aside></div>';
      if(!quiet){view("detail");history.replaceState({},"","/runs/"+encodeURIComponent(id));}
    }catch(error){if(!quiet)alert(error.message);}
  }
  function setFields(){const type=$("run-type").value;document.querySelectorAll("[data-fields]").forEach((node)=>node.hidden=node.dataset.fields!==type);}
  function optional(form,name){const value=form.elements[name]?.value?.trim();return value||undefined;}
  $("run-form").addEventListener("submit",async(event)=>{
    event.preventDefault();const form=event.currentTarget;const type=form.elements.type.value;let config;
    if(type==="tournament"){config={seats:form.elements.seats.value,games:Number(form.elements.games.value),mode:form.elements.mode.value,rule:form.elements.rule.value,seatPolicy:form.elements.seatPolicy.value,seed:Number(form.elements.tournamentSeed.value),timeoutMs:Number(form.elements.timeoutMs.value)};const pairedRuns=optional(form,"pairedRuns");if(pairedRuns!==undefined)config.pairedRuns=Number(pairedRuns);}
    else if(type==="benchmark")config={agents:form.elements.agents.value,dataset:form.elements.benchmarkDataset.value,concurrency:Number(form.elements.concurrency.value),seed:Number(form.elements.benchmarkSeed.value)};
    else config={dataset:form.elements.sweepDataset.value,thresholds:form.elements.thresholds.value,cacheIn:optional(form,"cacheIn")};
    for(const name of ["models","pricing","hybridFallback","mortalConfig"]){const value=optional(form,name);if(value)config[name]=value;}
    const threshold=optional(form,"hybridThreshold");if(threshold!==undefined)config.hybridThreshold=Number(threshold);
    const errorNode=$("form-error");errorNode.hidden=true;
    try{const run=await api("/api/runs",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({type,config})});await refresh();await detail(run.id);}catch(error){errorNode.textContent=error.message;errorNode.hidden=false;}
  });
  document.addEventListener("click",async(event)=>{
    const target=event.target.closest("[data-locale],[data-view],[data-open],[data-select],[data-template],[data-add-compare],[data-cancel],[data-replay]");if(!target)return;
    if(target.dataset.locale){state.locale=target.dataset.locale;applyLocale();renderRuns();renderSnapshots();renderTemplates();if(state.selected)await detail(state.selected,true);if(!$("compare-view").hidden)await renderComparison();return;}
    if(target.dataset.view){if(target.dataset.view==="compare")await renderComparison();else view(target.dataset.view);return;}
    if(target.dataset.template){const template=state.templates.find((item)=>item.id===target.dataset.template);if(template)applyTemplate(template);return;}
    if(target.dataset.select){if(target.checked)state.compareIds.add(target.dataset.select);else state.compareIds.delete(target.dataset.select);renderRuns();return;}
    if(target.dataset.addCompare){const run=state.runs.find((item)=>item.id===target.dataset.addCompare);const selected=state.runs.find((item)=>state.compareIds.has(item.id));if(selected&&run&&selected.type!==run.type)state.compareIds.clear();state.compareIds.add(target.dataset.addCompare);view("dashboard");renderRuns();return;}
    if(target.dataset.open){await detail(target.dataset.open);return;}
    if(target.dataset.cancel){if(confirm(t("run.stopConfirm"))){await api("/api/runs/"+encodeURIComponent(target.dataset.cancel)+"/cancel",{method:"POST"});await refresh();}return;}
    if(target.dataset.replay){target.disabled=true;try{const value=await api("/api/runs/"+encodeURIComponent(target.dataset.replay)+"/replay",{method:"POST"});window.open(value.url,"_blank");}catch(error){alert(error.message);}finally{target.disabled=false;}}
  });
  $("run-type").addEventListener("change",setFields);setFields();
  for(const id of ["run-search","run-status-filter","run-type-filter","run-date-filter"]){$(id).addEventListener("input",renderRuns);$(id).addEventListener("change",renderRuns);}
  $("compare-selected").addEventListener("click",()=>{void renderComparison();});
  applyLocale();
  const pathParts=location.pathname.split("/").filter(Boolean);if(pathParts.length===2&&pathParts[0]==="runs"){detail(decodeURIComponent(pathParts[1]));}else if(location.pathname==="/new")view("new");else if(location.pathname==="/compare"){for(const id of new URLSearchParams(location.search).get("ids")?.split(",")||[])if(id)state.compareIds.add(id);view("compare");}else view("dashboard");
  Promise.all([refresh(),api("/api/templates")]).then(([,data])=>{state.templates=data.templates||[];renderTemplates();if(location.pathname==="/compare")return renderComparison();}).catch((error)=>{$("runs").innerHTML='<div class="error">'+esc(error.message)+'</div>';});
  state.timer=setInterval(()=>refresh().catch(()=>undefined),2000);
})();`;
