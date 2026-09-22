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
      <nav><button data-view="dashboard" class="active">Runs</button><button data-view="new">New run</button></nav>
      <span class="local">Local control plane</span>
    </header>
    <main>
      <section id="dashboard-view">
        <div class="page-heading"><div><p class="eyebrow">Experiments</p><h1>Runs</h1><p>Launch, monitor, inspect, and replay benchmark work from one place.</p></div><button class="primary" data-view="new">New run</button></div>
        <div id="running-section"></div>
        <section class="panel"><div class="panel-heading"><h2>Run history</h2><span id="run-count" class="muted"></span></div><div id="runs"></div></section>
      </section>
      <section id="new-view" hidden>
        <div class="page-heading"><div><p class="eyebrow">Configure</p><h1>New run</h1><p>The canonical CLI and artifact formats remain unchanged.</p></div></div>
        <form id="run-form" class="panel form-grid">
          <label>Run type<select name="type" id="run-type"><option value="tournament">Tournament</option><option value="benchmark">Decision benchmark</option><option value="hybrid-sweep">Hybrid sweep</option></select></label>
          <div data-fields="tournament" class="field-group">
            <label class="wide">Seats<input name="seats" value="random,random,random,random" required><small>Exactly four comma-separated agent or model IDs.</small></label>
            <label>Games<input name="games" type="number" min="1" value="1"></label>
            <label>Mode<input name="mode" value="4p-red-half"></label>
            <label>Rule<input name="rule" value="tenhou"></label>
            <label>Seat policy<select name="seatPolicy"><option value="rotate">Rotate</option><option value="fixed">Fixed</option></select></label>
            <label>Seed<input name="tournamentSeed" type="number" min="0" value="42"></label>
            <label>Timeout (ms)<input name="timeoutMs" type="number" min="1" value="60000"></label>
          </div>
          <div data-fields="benchmark" class="field-group" hidden>
            <label class="wide">Agents<input name="agents" value="random"><small>Comma-separated agent or model IDs.</small></label>
            <label class="wide">Dataset<input name="benchmarkDataset" value="datasets/sample.jsonl"></label>
            <label>Concurrency<input name="concurrency" type="number" min="1" value="1"></label>
            <label>Seed<input name="benchmarkSeed" type="number" min="0" value="42"></label>
          </div>
          <div data-fields="hybrid-sweep" class="field-group" hidden>
            <label class="wide">Dataset<input name="sweepDataset" value="datasets/sample.jsonl"></label>
            <label class="wide">Thresholds<input name="thresholds" value="0,0.1,0.2,0.3,0.5,0.7,1"></label>
            <label class="wide">Existing cache (optional)<input name="cacheIn" placeholder="results/calibration/provider-calls.jsonl"></label>
          </div>
          <details class="advanced"><summary>Provider and Hybrid options</summary><div class="field-group">
            <label>Models file<input name="models" placeholder="models.yaml"></label>
            <label>Pricing file<input name="pricing" placeholder="pricing.yaml"></label>
            <label>Hybrid threshold<input name="hybridThreshold" type="number" min="0" max="1" step="0.01" placeholder="0.30"></label>
            <label>Hybrid fallback<input name="hybridFallback" placeholder="gpt"></label>
            <label>Mortal config<input name="mortalConfig" placeholder="mortal.json"></label>
          </div></details>
          <div id="form-error" class="error" hidden></div>
          <div class="form-actions"><button type="button" class="ghost" data-view="dashboard">Cancel</button><button type="submit" class="primary">Start run</button></div>
        </form>
      </section>
      <section id="detail-view" hidden><div id="detail"></div></section>
    </main>
    <script src="/assets/web.js" defer></script>
  </body>
</html>`;

export const webDashboardCss = `
:root { color-scheme: dark; --bg:#0a0e0c; --panel:#111814; --panel-2:#172019; --line:#29352d; --text:#edf5ef; --muted:#8fa297; --green:#63dc91; --amber:#ffc66d; --red:#ff8178; --blue:#77bdfb; font-family:Inter,ui-sans-serif,system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif; }
* { box-sizing:border-box; }
body { margin:0; min-height:100vh; background:radial-gradient(circle at 20% -20%,#20392b 0,transparent 38%),var(--bg); color:var(--text); }
button,input,select { font:inherit; }
button { cursor:pointer; }
.topbar { height:68px; padding:0 clamp(18px,4vw,56px); display:flex; align-items:center; gap:36px; border-bottom:1px solid var(--line); background:rgba(10,14,12,.88); backdrop-filter:blur(18px); position:sticky; top:0; z-index:5; }
.brand { color:var(--text); text-decoration:none; font-weight:760; letter-spacing:-.02em; font-size:18px; }.brand span{color:var(--green)}
nav { display:flex; gap:8px; } nav button,.ghost { border:0; color:var(--muted); background:transparent; border-radius:8px; padding:9px 12px; } nav button:hover,nav button.active,.ghost:hover { color:var(--text); background:var(--panel-2); }
.local { margin-left:auto; color:var(--muted); font-size:13px; border:1px solid var(--line); border-radius:99px; padding:6px 10px; }
main { width:min(1180px,calc(100% - 32px)); margin:42px auto 80px; }
.page-heading { display:flex; justify-content:space-between; align-items:flex-end; gap:20px; margin-bottom:28px; }.page-heading h1{font-size:clamp(34px,6vw,58px);letter-spacing:-.055em;line-height:.95;margin:4px 0 14px}.page-heading p{color:var(--muted);margin:0;max-width:620px}.eyebrow{color:var(--green)!important;text-transform:uppercase;font-size:12px;font-weight:800;letter-spacing:.16em}
.primary { border:0; color:#07120b; background:var(--green); font-weight:750; border-radius:9px; padding:11px 16px; box-shadow:0 8px 24px rgba(99,220,145,.13); }.primary:hover{filter:brightness(1.08)}.primary:disabled{opacity:.45;cursor:not-allowed}
.panel { background:linear-gradient(180deg,rgba(23,32,25,.95),rgba(15,22,18,.95)); border:1px solid var(--line); border-radius:14px; overflow:hidden; box-shadow:0 18px 60px rgba(0,0,0,.18); }.panel-heading{display:flex;align-items:center;justify-content:space-between;padding:18px 20px;border-bottom:1px solid var(--line)}.panel-heading h2{font-size:16px;margin:0}
.run-grid { display:grid; grid-template-columns:repeat(auto-fit,minmax(280px,1fr)); gap:12px; margin-bottom:28px; }.run-card{background:var(--panel);border:1px solid var(--line);border-radius:12px;padding:18px}.run-card h3{margin:12px 0 6px;font-size:16px}.run-card p{color:var(--muted);margin:0;font-size:13px}.run-card .actions{margin-top:16px}
.status { display:inline-flex;align-items:center;gap:7px;padding:5px 9px;border-radius:99px;background:#243029;color:var(--muted);font-size:11px;font-weight:800;text-transform:uppercase;letter-spacing:.08em}.status:before{content:"";width:7px;height:7px;border-radius:50%;background:currentColor}.status-running,.status-completed{color:var(--green)}.status-failed{color:var(--red)}.status-cancelled{color:var(--amber)}.status-running:before{box-shadow:0 0 0 5px rgba(99,220,145,.08)}
table { width:100%; border-collapse:collapse; }th,td{text-align:left;padding:14px 20px;border-bottom:1px solid var(--line);font-size:13px}th{color:var(--muted);font-size:11px;text-transform:uppercase;letter-spacing:.08em}tbody tr{cursor:pointer}tbody tr:hover{background:rgba(255,255,255,.025)}tbody tr:last-child td{border-bottom:0}.run-name{font-weight:700}.muted{color:var(--muted)}
.form-grid { padding:22px; }.field-group{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:18px;grid-column:1/-1;margin-top:20px}.form-grid>label,.field-group label{display:flex;flex-direction:column;gap:8px;color:var(--muted);font-size:12px;font-weight:700}.wide{grid-column:1/-1}input,select{width:100%;color:var(--text);background:#0c120e;border:1px solid var(--line);border-radius:8px;padding:11px 12px;outline:none}input:focus,select:focus{border-color:var(--green);box-shadow:0 0 0 3px rgba(99,220,145,.1)}small{font-weight:400;color:var(--muted)}.advanced{grid-column:1/-1;margin-top:22px;border-top:1px solid var(--line);padding-top:18px}.advanced summary{cursor:pointer;color:var(--muted)}.form-actions{display:flex;justify-content:flex-end;gap:8px;margin-top:24px}.error{margin-top:18px;color:var(--red);background:rgba(255,129,120,.08);border:1px solid rgba(255,129,120,.25);padding:12px;border-radius:8px}
.detail-header{display:flex;justify-content:space-between;gap:20px;align-items:flex-start;margin-bottom:24px}.detail-header h1{margin:8px 0;font-size:30px}.detail-actions{display:flex;gap:8px;flex-wrap:wrap}.detail-grid{display:grid;grid-template-columns:minmax(0,1.5fr) minmax(260px,.7fr);gap:18px}.detail-grid .panel{padding:20px}.detail-grid h2{font-size:15px;margin:0 0 16px}.metadata{display:grid;grid-template-columns:140px 1fr;gap:10px;font-size:13px}.metadata dt{color:var(--muted)}.metadata dd{margin:0;word-break:break-word}.result{max-height:540px;overflow:auto;background:#09100c;border-radius:9px;padding:14px;color:#bdd3c5;font:12px/1.55 ui-monospace,SFMono-Regular,Menlo,monospace;white-space:pre-wrap}.result-summary{margin:-4px -20px 18px;overflow:auto}.result-summary table{min-width:720px}.result-summary td,.result-summary th{padding:11px 14px}.raw-result{border-top:1px solid var(--line);padding-top:14px}.raw-result summary{cursor:pointer;color:var(--muted);font-size:12px;margin-bottom:12px}.artifact-list{list-style:none;margin:0;padding:0}.artifact-list li{display:flex;justify-content:space-between;gap:12px;padding:9px 0;border-bottom:1px solid var(--line);font-size:12px}.artifact-list a{color:var(--blue);text-decoration:none;word-break:break-all}.artifact-list li:last-child{border-bottom:0}.empty{padding:34px;text-align:center;color:var(--muted)}
@media(max-width:760px){.local{display:none}.topbar{gap:12px}.detail-grid{grid-template-columns:1fr}.field-group{grid-template-columns:1fr}.wide{grid-column:auto}.page-heading,.detail-header{align-items:flex-start;flex-direction:column}th:nth-child(3),td:nth-child(3){display:none}main{margin-top:26px}}
`;

export const webDashboardJs = `(function(){
  const state={runs:[],selected:null,timer:null};
  const $=(id)=>document.getElementById(id);
  const esc=(value)=>String(value==null?"":value).replace(/[&<>"']/g,(char)=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"})[char]);
  const pretty=(value)=>JSON.stringify(value,null,2);
  const status=(value)=>'<span class="status status-'+esc(value)+'">'+esc(value)+'</span>';
  const time=(value)=>value?new Date(value).toLocaleString():"—";
  const bytes=(value)=>value<1024?value+" B":value<1048576?(value/1024).toFixed(1)+" KiB":(value/1048576).toFixed(1)+" MiB";
  async function api(path,options){const response=await fetch(path,Object.assign({cache:"no-store"},options||{}));const body=await response.json().catch(()=>({}));if(!response.ok)throw new Error(body.error||("Request failed: "+response.status));return body;}
  function view(name){
    $("dashboard-view").hidden=name!=="dashboard";$("new-view").hidden=name!=="new";$("detail-view").hidden=name!=="detail";
    document.querySelectorAll("nav button").forEach((node)=>node.classList.toggle("active",node.dataset.view===name));
    if(name!=="detail")history.replaceState({},"",name==="new"?"/new":"/");
  }
  function runTitle(run){const config=run.config||{};if(run.type==="tournament")return (config.seats||[]).join(" vs ");if(run.type==="benchmark")return "Benchmark · "+(config.agents||[]).join(", ");return "Hybrid threshold sweep";}
  const fixed=(value,digits)=>typeof value==="number"&&Number.isFinite(value)?value.toFixed(digits):"—";
  const percent=(value)=>typeof value==="number"&&Number.isFinite(value)?(value*100).toFixed(1)+"%":"—";
  function resultTable(headers,rows){return '<div class="result-summary"><table><thead><tr>'+headers.map((value)=>'<th>'+esc(value)+'</th>').join("")+'</tr></thead><tbody>'+rows.map((row)=>'<tr>'+row.map((value)=>'<td>'+esc(value)+'</td>').join("")+'</tr>').join("")+'</tbody></table></div>';}
  function renderResult(run,result){
    if(!result)return '<div class="empty">Results will appear when canonical artifacts are available.</div>';
    let summary="";
    if(run.type==="benchmark"&&Array.isArray(result.summaries))summary=resultTable(["Agent","Decisions","Success","Legal","Agreement","p50 ms","p95 ms","Tokens / decision"],result.summaries.map((item)=>[item.agentId,item.decisions,percent(item.successRate),percent(item.legalActionRate),percent(item.exactMatchRate),fixed(item.p50LatencyMs,1),fixed(item.p95LatencyMs,1),fixed(item.totalTokensPerDecision??((item.inputTokens+item.outputTokens)/Math.max(1,item.decisions)),1)]));
    else if(run.type==="tournament"&&Array.isArray(result.metrics?.agents))summary=resultTable(["Agent","Games","Avg score","Avg rank","1st","4th","Win","Deal-in","p95 ms","Fallback"],result.metrics.agents.map((item)=>[item.agentId,item.games,fixed(item.meanScore,0),fixed(item.meanRank,2),percent(item.firstRate),percent(item.fourthRate),percent(item.winRate),percent(item.dealInRate),fixed(item.p95LatencyMs,1),percent(item.fallbackRate)]));
    else if(run.type==="hybrid-sweep"&&Array.isArray(result.thresholdResults))summary=resultTable(["Threshold","Agreement","Escalation","Legal","p50 ms","p95 ms","Tokens","Fallback"],result.thresholdResults.map((item)=>[fixed(item.threshold,2),percent(item.agreementRate),percent(item.escalationRate),percent(item.legalRate),fixed(item.estimatedP50LatencyMs,1),fixed(item.estimatedP95LatencyMs,1),item.estimatedUsage?.totalTokens??item.totalTokens,percent(item.fallbackRate)]));
    return summary+'<details class="raw-result"><summary>Canonical result JSON</summary><pre class="result">'+esc(pretty(result))+'</pre></details>';
  }
  function renderRuns(){
    const active=state.runs.filter((run)=>run.status==="queued"||run.status==="running");
    $("running-section").innerHTML=active.length?'<p class="eyebrow">Running</p><div class="run-grid">'+active.map((run)=>'<article class="run-card" data-run="'+esc(run.id)+'">'+status(run.status)+'<h3>'+esc(runTitle(run))+'</h3><p>'+esc(run.type)+' · started '+esc(time(run.startedAt||run.createdAt))+'</p><div class="actions"><button class="primary" data-open="'+esc(run.id)+'">Inspect</button></div></article>').join("")+'</div>':"";
    $("run-count").textContent=state.runs.length+" total";
    $("runs").innerHTML=state.runs.length?'<table><thead><tr><th>Run</th><th>Status</th><th>Created</th><th>Type</th></tr></thead><tbody>'+state.runs.map((run)=>'<tr data-open="'+esc(run.id)+'"><td><span class="run-name">'+esc(runTitle(run))+'</span><br><span class="muted">'+esc(run.id)+'</span></td><td>'+status(run.status)+'</td><td>'+esc(time(run.createdAt))+'</td><td>'+esc(run.type)+'</td></tr>').join("")+'</tbody></table>':'<div class="empty">No runs yet. Start with a local tournament or decision benchmark.</div>';
  }
  async function refresh(){state.runs=await api("/api/runs");renderRuns();if(state.selected)await detail(state.selected,true);}
  async function detail(id,quiet){
    try{
      const data=await api("/api/runs/"+encodeURIComponent(id));state.selected=id;const run=data.run;const terminal=["completed","failed","cancelled"].includes(run.status);
      const actions=[];
      if(run.liveUrl&&run.status==="running")actions.push('<a class="primary" href="'+esc(run.liveUrl)+'" target="_blank">Watch live</a>');
      if(run.type==="tournament"&&terminal)actions.push('<button class="primary" data-replay="'+esc(run.id)+'">Open replay</button>');
      if(!terminal)actions.push('<button class="ghost" data-cancel="'+esc(run.id)+'">Stop run</button>');
      const artifacts=(data.artifacts||[]).map((item)=>'<li><a href="/api/runs/'+encodeURIComponent(run.id)+'/artifact?path='+encodeURIComponent(item.path)+'" target="_blank">'+esc(item.path)+'</a><span class="muted">'+bytes(item.bytes)+'</span></li>').join("");
      $("detail").innerHTML='<button class="ghost" data-view="dashboard">← All runs</button><div class="detail-header"><div><p class="eyebrow">'+esc(run.type)+'</p><h1>'+esc(runTitle(run))+'</h1>'+status(run.status)+'</div><div class="detail-actions">'+actions.join("")+'</div></div>'+(run.error?'<div class="error">'+esc(run.error)+'</div>':'')+'<div class="detail-grid"><section class="panel"><h2>Results</h2>'+renderResult(run,data.result)+'</section><aside><section class="panel"><h2>Run metadata</h2><dl class="metadata"><dt>Run ID</dt><dd>'+esc(run.id)+'</dd><dt>Config hash</dt><dd>'+esc(run.configHash)+'</dd><dt>Created</dt><dd>'+esc(time(run.createdAt))+'</dd><dt>Started</dt><dd>'+esc(time(run.startedAt))+'</dd><dt>Finished</dt><dd>'+esc(time(run.finishedAt))+'</dd></dl><h2 style="margin-top:24px">Configuration</h2><pre class="result">'+esc(pretty(run.config))+'</pre></section><section class="panel" style="margin-top:18px"><h2>Artifacts</h2><ul class="artifact-list">'+(artifacts||'<li class="muted">No artifacts yet</li>')+'</ul></section></aside></div>';
      if(!quiet){view("detail");history.replaceState({},"","/runs/"+encodeURIComponent(id));}
    }catch(error){if(!quiet)alert(error.message);}
  }
  function setFields(){const type=$("run-type").value;document.querySelectorAll("[data-fields]").forEach((node)=>node.hidden=node.dataset.fields!==type);}
  function optional(form,name){const value=form.elements[name]?.value?.trim();return value||undefined;}
  $("run-form").addEventListener("submit",async(event)=>{
    event.preventDefault();const form=event.currentTarget;const type=form.elements.type.value;let config;
    if(type==="tournament")config={seats:form.elements.seats.value,games:Number(form.elements.games.value),mode:form.elements.mode.value,rule:form.elements.rule.value,seatPolicy:form.elements.seatPolicy.value,seed:Number(form.elements.tournamentSeed.value),timeoutMs:Number(form.elements.timeoutMs.value)};
    else if(type==="benchmark")config={agents:form.elements.agents.value,dataset:form.elements.benchmarkDataset.value,concurrency:Number(form.elements.concurrency.value),seed:Number(form.elements.benchmarkSeed.value)};
    else config={dataset:form.elements.sweepDataset.value,thresholds:form.elements.thresholds.value,cacheIn:optional(form,"cacheIn")};
    for(const name of ["models","pricing","hybridFallback","mortalConfig"]){const value=optional(form,name);if(value)config[name]=value;}
    const threshold=optional(form,"hybridThreshold");if(threshold!==undefined)config.hybridThreshold=Number(threshold);
    const errorNode=$("form-error");errorNode.hidden=true;
    try{const run=await api("/api/runs",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({type,config})});await refresh();await detail(run.id);}catch(error){errorNode.textContent=error.message;errorNode.hidden=false;}
  });
  document.addEventListener("click",async(event)=>{
    const target=event.target.closest("[data-view],[data-open],[data-cancel],[data-replay]");if(!target)return;
    if(target.dataset.view){view(target.dataset.view);return;}
    if(target.dataset.open){await detail(target.dataset.open);return;}
    if(target.dataset.cancel){if(confirm("Stop this run?")){await api("/api/runs/"+encodeURIComponent(target.dataset.cancel)+"/cancel",{method:"POST"});await refresh();}return;}
    if(target.dataset.replay){target.disabled=true;try{const value=await api("/api/runs/"+encodeURIComponent(target.dataset.replay)+"/replay",{method:"POST"});window.open(value.url,"_blank");}catch(error){alert(error.message);}finally{target.disabled=false;}}
  });
  $("run-type").addEventListener("change",setFields);setFields();
  const pathParts=location.pathname.split("/").filter(Boolean);if(pathParts.length===2&&pathParts[0]==="runs"){detail(decodeURIComponent(pathParts[1]));}else if(location.pathname==="/new")view("new");else view("dashboard");
  refresh().catch((error)=>{$("runs").innerHTML='<div class="error">'+esc(error.message)+'</div>';});
  state.timer=setInterval(()=>refresh().catch(()=>undefined),2000);
})();`;
