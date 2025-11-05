
// Robust D3-only app.js for 37000_reviews_of_thread_app.csv
// Guards added for empty data, invalid dates, and incorrect column assumptions.

const els = {
  dateStart: document.getElementById('dateStart'),
  dateEnd: document.getElementById('dateEnd'),
  categorySelect: document.getElementById('categorySelect'),
  applyFilters: document.getElementById('applyFilters'),
  resetFilters: document.getElementById('resetFilters'),
  binCount: document.getElementById('binCount'),
  binCountVal: document.getElementById('binCountVal'),
  clearDrill: document.getElementById('clearDrill'),
  pie: document.getElementById('pie'),
  pieLegend: document.getElementById('pieLegend'),
  hist: document.getElementById('hist'),
  scatter: document.getElementById('scatter'),
  brush: document.getElementById('brush'),
};

let rawData = [];
let filteredData = [];
let drillCategory = null;
let scatterSelection = null;

function toYMD(d){ const yyyy = d.getFullYear(); const mm = String(d.getMonth()+1).padStart(2,'0'); const dd = String(d.getDate()).padStart(2,'0'); return yyyy + '-' + mm + '-' + dd; }
function deriveCategory(r){ if (r >= 4) return 'Positive'; if (r === 3) return 'Neutral'; return 'Negative'; }
function setBinLabel(v){ els.binCountVal.textContent = String(v); }

async function loadCSV(){
  try{ const resp = await fetch('37000_reviews_of_thread_app.csv'); if(!resp.ok) throw new Error('fetch fail'); const text = await resp.text(); return d3.csvParse(text); }catch(e){ return []; }
}

function mapRows(parsed){
  return parsed.map((row)=>{
    const d = new Date(row.review_date);
    const rating = Number(row.rating);
    const text = row.review_description || '';
    const validDate = !isNaN(d.getTime());
    const validRating = !isNaN(rating);
    if (!validDate || !validRating) return null;
    return { date: d, ymd: toYMD(d), rating: rating, text: text, len: text.length, category: deriveCategory(rating) };
  }).filter(Boolean);
}

function initDateRange(data){
  if (!data.length) return;
  const minD = d3.min(data, d=>d.date);
  const maxD = d3.max(data, d=>d.date);
  if (!minD || !maxD) return;
  els.dateStart.value = toYMD(minD);
  els.dateEnd.value = toYMD(maxD);
}

function populateCategory(data){
  const cats = Array.from(new Set(data.map(d=>d.category)));
  els.categorySelect.innerHTML = '';
  cats.forEach(c => { const opt = document.createElement('option'); opt.value = c; opt.textContent = c; opt.selected = true; els.categorySelect.appendChild(opt); });
}

function getActiveCategories(){ return Array.from(els.categorySelect.selectedOptions).map(o=>o.value); }

function applyFilters(){
  const start = els.dateStart.value ? new Date(els.dateStart.value) : null;
  const end = els.dateEnd.value ? new Date(els.dateEnd.value) : null;
  const cats = new Set(getActiveCategories());
  filteredData = rawData.filter(d => {
    const inDate = (!start || d.date >= start) && (!end || d.date <= end);
    const inCat = cats.size === 0 || cats.has(d.category);
    const inDrill = !drillCategory || d.category === drillCategory;
    if (scatterSelection){
      const sx = d.date.getTime(); const sy = d.len;
      const inSel = sx >= scatterSelection.domain.x0 && sx <= scatterSelection.domain.x1 && sy >= scatterSelection.domain.y0 && sy <= scatterSelection.domain.y1;
      return inDate && inCat && inDrill && inSel;
    }
    return inDate && inCat && inDrill;
  });
  updateAll();
}

function resetFilters(){ drillCategory = null; scatterSelection = null; hideBrush(); initDateRange(rawData); populateCategory(rawData); filteredData = rawData.slice(); updateAll(); }

function renderEmpty(container, msg){ container.innerHTML = '<div style="position:absolute;inset:0;display:flex;align-items:center;justify-content:center;color:#94a3b8;font-size:12px">' + msg + '</div>'; }

function renderPie(data){
  els.pie.innerHTML = '';
  if (!data.length){ renderEmpty(els.pie, 'No data'); els.pieLegend.innerHTML = ''; return; }
  const w = els.pie.clientWidth, h = els.pie.clientHeight, r = Math.min(w,h)/2 - 10;
  const svg = d3.select(els.pie).append('svg').attr('width', w).attr('height', h);
  const g = svg.append('g').attr('transform', 'translate(' + w/2 + ',' + h/2 + ')');
  const color = d3.scaleOrdinal().domain(['Positive','Neutral','Negative']).range(['#34d399','#fbbf24','#f87171']);
  const counts = d3.rollup(data, v=>v.length, d=>d.category);
  const entries = Array.from(counts, ([k,v])=>({key:k, value:v})).sort((a,b)=> (a.key > b.key? 1:-1));
  const pie = d3.pie().value(d=>d.value)(entries);
  const arc = d3.arc().innerRadius(r*0.55).outerRadius(r);
  g.selectAll('path').data(pie).enter().append('path')
    .attr('d', arc).attr('fill', d=>color(d.data.key)).attr('stroke', 'rgba(0,0,0,.2)').style('cursor','pointer')
    .on('mousemove', function(event, d){ showTooltip(els.pie, event.clientX, event.clientY, d.data.key + ': ' + d.data.value.toLocaleString()); })
    .on('mouseleave', hideTooltip)
    .on('click', function(event, d){ drillCategory = d.data.key; applyFilters(); });
  els.pieLegend.innerHTML = '';
  entries.forEach(e => { const tag = document.createElement('span'); tag.className = 'tag'; tag.innerHTML = '<i style="background:' + color(e.key) + '"></i>' + e.key + ' (' + e.value.toLocaleString() + ')'; tag.addEventListener('click', ()=>{ drillCategory = e.key; applyFilters(); }); els.pieLegend.appendChild(tag); });
}

function renderHist(data, binsCount){
  els.hist.innerHTML = '';
  if (!data.length){ renderEmpty(els.hist, 'No data'); return; }
  const w = els.hist.clientWidth, h = els.hist.clientHeight, m = {t:16,r:16,b:28,l:36};
  const svg = d3.select(els.hist).append('svg').attr('width', w).attr('height', h);
  const cw = w - m.l - m.r, ch = h - m.t - m.b;
  const g = svg.append('g').attr('transform', 'translate(' + m.l + ',' + m.t + ')');
  const x = d3.scaleLinear().domain([0.5,5.5]).range([0,cw]);
  const bins = d3.bin().domain(x.domain()).thresholds(binsCount)(data.map(d=>d.rating));
  const y = d3.scaleLinear().domain([0, d3.max(bins, b=>b.length) || 1]).nice().range([ch,0]);
  g.append('g').attr('transform', 'translate(0,' + ch + ')').call(d3.axisBottom(x).ticks(5).tickFormat(d3.format('d')));
  g.append('g').call(d3.axisLeft(y).ticks(6));
  g.selectAll('rect').data(bins).enter().append('rect')
    .attr('x', d=>x(d.x0) + 1).attr('y', d=>y(d.length))
    .attr('width', d=> Math.max(0, x(d.x1) - x(d.x0) - 2))
    .attr('height', d=>ch - y(d.length))
    .attr('fill', '#60a5fa')
    .on('mousemove', function(event,d){ showTooltip(els.hist, event.clientX, event.clientY, 'Rating ' + (d.x0.toFixed(1)) + ' - ' + (d.x1.toFixed(1)) + '<br>Count: ' + d.length.toLocaleString()); })
    .on('mouseleave', hideTooltip);
}

function renderScatter(data){
  els.scatter.innerHTML = '';
  if (!data.length){ renderEmpty(els.scatter, 'No data'); return; }
  const w = els.scatter.clientWidth, h = els.scatter.clientHeight, m = {t:16,r:16,b:28,l:44};
  const svg = d3.select(els.scatter).append('svg').attr('width', w).attr('height', h);
  const cw = w - m.l - m.r, ch = h - m.t - m.b;
  const g = svg.append('g').attr('transform', 'translate(' + m.l + ',' + m.t + ')');
  const x = d3.scaleTime().domain(d3.extent(data, d=>d.date)).range([0,cw]).nice();
  const y = d3.scaleLinear().domain([0, d3.max(data, d=>d.len) || 1]).nice().range([ch,0]);
  g.append('g').attr('transform', 'translate(0,' + ch + ')').call(d3.axisBottom(x));
  g.append('g').call(d3.axisLeft(y));
  g.selectAll('circle').data(data).enter().append('circle')
    .attr('cx', d=>x(d.date)).attr('cy', d=>y(d.len)).attr('r', 2.2).attr('fill', 'rgba(96,165,250,.9)')
    .on('mousemove', function(event,d){ showTooltip(els.scatter, event.clientX, event.clientY, d.date.toLocaleDateString() + '<br>Length: ' + d.len + '<br>Rating: ' + d.rating); })
    .on('mouseleave', hideTooltip);
  attachBrush(els.scatter, x, y);
}

function updateAll(){ renderPie(filteredData); renderHist(filteredData, Number(els.binCount.value)); renderScatter(filteredData); }

let tooltipDiv = null;
function ensureTooltip(){ if (!tooltipDiv){ tooltipDiv = document.createElement('div'); tooltipDiv.className = 'tooltip'; document.body.appendChild(tooltipDiv); } }
function showTooltip(container, clientX, clientY, html){ ensureTooltip(); tooltipDiv.innerHTML = html; tooltipDiv.style.left = (clientX + 12) + 'px'; tooltipDiv.style.top = (clientY - 12) + 'px'; tooltipDiv.style.opacity = 1; }
function hideTooltip(){ if (tooltipDiv){ tooltipDiv.style.opacity = 0; } }

function attachBrush(container, xScale, yScale){
  const rect = container.getBoundingClientRect();
  const offsetLeft = rect.left; const offsetTop = rect.top;
  let start = null;
  container.onmousedown = (e)=>{ start = { x: e.clientX, y: e.clientY }; els.brush.hidden = false; els.brush.style.left = start.x + 'px'; els.brush.style.top = start.y + 'px'; els.brush.style.width = '0px'; els.brush.style.height = '0px'; };
  container.onmousemove = (e)=>{ if(!start) return; const x0 = Math.min(start.x, e.clientX); const y0 = Math.min(start.y, e.clientY); const w = Math.abs(e.clientX - start.x); const h = Math.abs(e.clientY - start.y); els.brush.style.left = x0 + 'px'; els.brush.style.top = y0 + 'px'; els.brush.style.width = w + 'px'; els.brush.style.height = h + 'px'; };
  function finish(e){ if(!start){ return; } const x0 = Math.min(start.x, e.clientX) - offsetLeft; const x1 = Math.max(start.x, e.clientX) - offsetLeft; const y0 = Math.min(start.y, e.clientY) - offsetTop; const y1 = Math.max(start.y, e.clientY) - offsetTop; const svgPadding = {l:44,t:16,b:28,r:16}; const cx0 = Math.max(0, x0 - svgPadding.l); const cx1 = Math.max(0, x1 - svgPadding.l); const cy0 = Math.max(0, y0 - svgPadding.t); const cy1 = Math.max(0, y1 - svgPadding.t); const domain = { x0: xScale.invert(cx0).getTime(), x1: xScale.invert(cx1).getTime(), y0: yScale.invert(cy1), y1: yScale.invert(cy0) }; scatterSelection = { domain: domain }; applyFilters(); hideBrush(); start = null; }
  container.onmouseup = finish;
  container.onmouseleave = ()=>{ start = null; hideBrush(); };
}

function hideBrush(){ els.brush.hidden = true; els.brush.style.left = '0px'; els.brush.style.top = '0px'; els.brush.style.width = '0px'; els.brush.style.height = '0px'; }

els.applyFilters.addEventListener('click', applyFilters);
els.resetFilters.addEventListener('click', resetFilters);
els.clearDrill.addEventListener('click', ()=>{ drillCategory = null; scatterSelection = null; hideBrush(); applyFilters(); });
els.binCount.addEventListener('input', (e)=>{ setBinLabel(e.target.value); renderHist(filteredData, Number(e.target.value)); });

(async function init(){
  setBinLabel(els.binCount.value);
  const parsed = await loadCSV();
  if (parsed && parsed.length){ rawData = mapRows(parsed); } else { rawData = []; }
  if (!rawData.length){ const today = new Date(); rawData = d3.range(300).map(i=>{ const d = new Date(today); d.setDate(d.getDate() - (300 - i)); const rating = Math.max(1, Math.min(5, Math.round(3 + d3.randomNormal(0,1)()))); const text = 'Sample review ' + i; return { date: d, ymd: toYMD(d), rating: rating, text: text, len: text.length, category: deriveCategory(rating) }; }); }
  initDateRange(rawData); populateCategory(rawData); filteredData = rawData.slice(); updateAll();
})();
