'use strict';

/* ============================== 常量与状态 ============================== */

const NATIVE = typeof NL_TOKEN !== 'undefined' && String(NL_TOKEN).length > 0 && !/[?&]browser\b/.test(location.search);
const ANDROID = typeof TimeringAndroid !== 'undefined';
const PALETTE = [
  '#F3B6C6', '#EAB7A0', '#E8CF92', '#B9D1AE',
  '#A7D1CD', '#AEC8E5', '#C5B7DF', '#DBB5D4'
];
const SNAP = 5;                 // 分钟吸附
const CX = 200, CY = 200, TRACK_R = 150, ARC_W = 26;
const WEEK = ['日', '一', '二', '三', '四', '五', '六'];

let dataDir = '';
let currentDate = todayStr();
let segments = [];              // {id, start, end, label} 分钟数，end<=start 表示跨午夜
let uid = 1;

/* ============================== 工具函数 ============================== */

const $ = s => document.querySelector(s);
function pad2(n) { return String(n).padStart(2, '0'); }

function todayStr() {
  const d = new Date();
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}
function shiftDate(str, delta) {
  const [y, m, d] = str.split('-').map(Number);
  const dt = new Date(y, m - 1, d + delta);
  return `${dt.getFullYear()}-${pad2(dt.getMonth() + 1)}-${pad2(dt.getDate())}`;
}
function dateLabel(str) {
  const [y, m, d] = str.split('-').map(Number);
  return `${m}月${d}日 周${WEEK[new Date(y, m - 1, d).getDay()]}`;
}
const minToHM = m => `${pad2(Math.floor(((m % 1440) + 1440) % 1440 / 60))}:${pad2(m % 60)}`;
const hmToMin = s => { const [h, m] = s.split(':').map(Number); return ((h || 0) * 60 + (m || 0)) % 1440; };
function fmtDur(min) {
  if (min < 60) return `${min}分钟`;
  const h = Math.floor(min / 60), m = min % 60;
  return m ? `${h}小时${m}分` : `${h}小时`;
}
const spanOf = s => ((s.end - s.start + 1440) % 1440) || 1440;
function hashColor(label) {
  let h = 0;
  for (const c of label) h = (h * 31 + c.codePointAt(0)) >>> 0;
  return PALETTE[h % PALETTE.length];
}
function totalMinutes() {
  return segments.reduce((t, s) => t + Math.min(spanOf(s), 1440), 0);
}

/* ============================== 存储 ============================== */

const Store = {
  async readDay(date) {
    if (ANDROID) {
      const result = JSON.parse(TimeringAndroid.readDay(date));
      if (result.error) throw new Error(result.error);
      return result.segments;
    }
    if (NATIVE) {
      try {
        const raw = await Neutralino.filesystem.readFile(`${dataDir}/days/${date}.json`);
        return JSON.parse(raw).segments || [];
      } catch { return null; }
    }
    const raw = localStorage.getItem('day-' + date);
    return raw ? JSON.parse(raw) : null;
  },
  async writeDay(date) {
    const payload = { date, segments: segments.map(({ start, end, label }) => ({ start: minToHM(start), end: minToHM(end), label })) };
    if (ANDROID) {
      const result = JSON.parse(TimeringAndroid.writeDay(date, JSON.stringify(payload.segments)));
      if (result.error) throw new Error(result.error);
      return;
    }
    if (NATIVE) {
      await Neutralino.filesystem.writeFile(`${dataDir}/days/${date}.json`, JSON.stringify(payload, null, 2));
    } else {
      localStorage.setItem('day-' + date, JSON.stringify(payload.segments));
    }
  },
  async listDays() {
    if (ANDROID) {
      const result = JSON.parse(TimeringAndroid.listDays());
      if (result.error) throw new Error(result.error);
      return result.days.sort().reverse();
    }
    let names = [];
    if (NATIVE) {
      try {
        names = (await Neutralino.filesystem.readDirectory(`${dataDir}/days`)).filter(n => n.endsWith('.json'));
      } catch { names = []; }
    } else {
      for (let i = 0; i < localStorage.length; i++) {
        const k = localStorage.key(i);
        if (k && k.startsWith('day-')) names.push(k.slice(4) + '.json');
      }
    }
    return names.map(n => n.slice(0, -5)).sort().reverse();
  }
};

/* ============================== 环形几何 ============================== */

const ringSvg = $('#ring');
let gTicks, gArcs, gPreview, gCenter;

function polar(deg, r) {
  const rad = deg * Math.PI / 180;
  return { x: CX + r * Math.cos(rad), y: CY + r * Math.sin(rad) };
}
function arcPath(startMin, endMin, r = TRACK_R) {
  const span = ((endMin - startMin + 1440) % 1440) || 1440;
  const a0 = startMin / 1440 * 360 - 90;
  const degrees = span / 1440 * 360;
  const p0 = polar(a0, r), p1 = polar(a0 + degrees, r);
  const start = `M ${p0.x.toFixed(2)} ${p0.y.toFixed(2)}`;
  if (span === 1440) {
    const mid = polar(a0 + 180, r);
    return `${start} A ${r} ${r} 0 0 1 ${mid.x.toFixed(2)} ${mid.y.toFixed(2)} A ${r} ${r} 0 0 1 ${p0.x.toFixed(2)} ${p0.y.toFixed(2)}`;
  }
  return `${start} A ${r} ${r} 0 ${degrees > 180 ? 1 : 0} 1 ${p1.x.toFixed(2)} ${p1.y.toFixed(2)}`;
}

function segmentsOverlap(a, b) {
  const ranges = s => {
    const end = s.start + spanOf(s);
    return end <= 1440 ? [[s.start, end]] : [[s.start, 1440], [0, end - 1440]];
  };
  return ranges(a).some(([a0, a1]) => ranges(b).some(([b0, b1]) => a0 < b1 && b0 < a1));
}

function layoutSegments(entries) {
  const lanes = [], items = [];
  const sorted = [...entries].sort((a, b) => a.start - b.start || spanOf(b) - spanOf(a));
  for (const seg of sorted) {
    let lane = lanes.findIndex(group => group.every(other => !segmentsOverlap(seg, other)));
    if (lane < 0) { lane = lanes.length; lanes.push([]); }
    lanes[lane].push(seg);
    items.push({ seg, lane });
  }
  return { items, count: Math.max(1, lanes.length) };
}

// Share one assignment between ring arcs, text outlines and legend dots.
function assignEventColors(entries) {
  const sorted = layoutSegments(entries).items.map(item => item.seg);
  const colors = new Map();
  const rgb = hex => [1, 3, 5].map(offset => parseInt(hex.slice(offset, offset + 2), 16));
  const distance = (a, b) => rgb(a).reduce((sum, value, i) => sum + (value - rgb(b)[i]) ** 2, 0);
  for (let i = 0; i < sorted.length; i++) {
    const seg = sorted[i];
    const neighbors = sorted.slice(0, i).filter((other, j) =>
      j === i - 1 || (i === sorted.length - 1 && j === 0) || segmentsOverlap(seg, other));
    const adjacent = new Set([colors.get(sorted[i - 1]?.id),
      i === sorted.length - 1 ? colors.get(sorted[0]?.id) : undefined]);
    const preferred = hashColor(seg.label);
    const candidates = PALETTE.filter(color => !adjacent.has(color));
    const score = color => {
      const nearby = neighbors.map(other => colors.get(other.id));
      const collisions = nearby.filter(other => other === color).length;
      const contrast = nearby.length ? Math.min(...nearby.map(other => distance(color, other))) : 0;
      return -collisions * 1000000 + contrast;
    };
    candidates.sort((a, b) => score(b) - score(a) || Number(b === preferred) - Number(a === preferred));
    colors.set(seg.id, candidates[0]);
  }
  return colors;
}

function buildRing() {
  const NS = 'http://www.w3.org/2000/svg';
  gTicks = document.createElementNS(NS, 'g');
  gArcs = document.createElementNS(NS, 'g');
  gPreview = document.createElementNS(NS, 'g');
  gCenter = document.createElementNS(NS, 'g');
  ringSvg.append(gArcs, gCenter, gPreview);

  for (let h = 0; h < 24; h += 3) {
    const a = h * 15 - 90;
    const pt = polar(a, TRACK_R - ARC_W / 2 - 8);
    const num = document.createElementNS(NS, 'text');
    num.textContent = h;
    num.setAttribute('x', pt.x); num.setAttribute('y', pt.y + 3);
    num.setAttribute('text-anchor', 'middle');
    num.setAttribute('font-size', 9.5);
    num.setAttribute('font-weight', h % 6 === 0 ? 700 : 400);
    num.setAttribute('fill', h % 6 === 0 ? 'var(--ink)' : 'var(--muted)');
    gTicks.append(num);
  }
  ringSvg.append(gTicks);
}

/* ============================== 渲染 ============================== */

function render() {
  $('#dateLabel').textContent = dateLabel(currentDate);
  const layout = layoutSegments(segments);
  const sorted = layout.items.map(item => item.seg);
  const eventColors = assignEventColors(segments);
  const laneSize = ARC_W / layout.count;
  const width = layout.count === 1 ? ARC_W - 4 : laneSize * .84;

  gArcs.innerHTML = '';
  const track = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
  track.setAttribute('cx', CX); track.setAttribute('cy', CY);
  track.setAttribute('r', TRACK_R); track.setAttribute('fill', 'none');
  track.setAttribute('stroke', 'var(--track)'); track.setAttribute('stroke-width', ARC_W);
  gArcs.append(track);
  for (const { seg: s, lane } of layout.items) {
    const radius = TRACK_R + ARC_W / 2 - (lane + .5) * laneSize;
    const NS = 'http://www.w3.org/2000/svg';
    const path = document.createElementNS(NS, 'path');
    path.setAttribute('d', arcPath(s.start, s.end, radius));
    path.setAttribute('fill', 'none');
    path.setAttribute('stroke', eventColors.get(s.id));
    path.setAttribute('stroke-width', width);
    path.setAttribute('stroke-linecap', 'butt');
    path.classList.add('seg');
    path.dataset.id = s.id;
    const title = document.createElementNS(NS, 'title');
    title.textContent = `${s.label || '未命名'} · ${minToHM(s.start)} – ${minToHM(s.end)}`;
    path.append(title);
    gArcs.append(path);

    const span = spanOf(s);
    if (span >= 40 && s.label && width >= 10) {
      const mid = s.start + Math.min(span, 1440) / 2;
      const pt = polar(mid / 1440 * 360 - 90, radius);
      const txt = document.createElementNS(NS, 'text');
      const maxChars = Math.max(2, Math.floor(span / 9));
      txt.textContent = s.label.length > maxChars ? s.label.slice(0, maxChars - 1) + '…' : s.label;
      txt.setAttribute('x', pt.x); txt.setAttribute('y', pt.y + 3.5);
      txt.setAttribute('text-anchor', 'middle');
      txt.setAttribute('font-size', 10);
      txt.setAttribute('font-weight', 600);
      txt.setAttribute('fill', '#fff');
      txt.setAttribute('paint-order', 'stroke');
      txt.setAttribute('stroke', eventColors.get(s.id));
      txt.setAttribute('stroke-width', 2.6);
      txt.setAttribute('stroke-linejoin', 'round');
      txt.style.pointerEvents = 'none';
      gArcs.append(txt);
    }
  }

  const d = new Date();
  const isToday = currentDate === todayStr();
  const nowMin = isToday ? d.getHours() * 60 + d.getMinutes() : null;
  if (nowMin != null) {
    const NS = 'http://www.w3.org/2000/svg';
    const pNow = polar(nowMin / 1440 * 360 - 90, TRACK_R);
    const pIn = polar(nowMin / 1440 * 360 - 90, TRACK_R - ARC_W / 2 + 2);
    const hand = document.createElementNS(NS, 'line');
    hand.setAttribute('x1', pIn.x); hand.setAttribute('y1', pIn.y);
    hand.setAttribute('x2', pNow.x + 0); hand.setAttribute('y2', pNow.y);
    hand.setAttribute('stroke', 'var(--ink)'); hand.setAttribute('stroke-width', 1.6);
    hand.style.pointerEvents = 'none';
    gArcs.append(hand);
    const cap = document.createElementNS(NS, 'circle');
    cap.setAttribute('cx', pNow.x); cap.setAttribute('cy', pNow.y);
    cap.setAttribute('r', 3); cap.setAttribute('fill', 'var(--ink)');
    cap.style.pointerEvents = 'none';
    gArcs.append(cap);
  }

  gCenter.innerHTML = '';
  const NS = 'http://www.w3.org/2000/svg';
  const dayNum = document.createElementNS(NS, 'text');
  dayNum.textContent = Number(currentDate.slice(8, 10));
  dayNum.setAttribute('x', CX); dayNum.setAttribute('y', CY - 14);
  dayNum.setAttribute('text-anchor', 'middle');
  dayNum.setAttribute('font-size', 34); dayNum.setAttribute('font-weight', 700);
  dayNum.setAttribute('fill', 'var(--ink)');
  const wk = document.createElementNS(NS, 'text');
  const [cy, cm, cd] = currentDate.split('-').map(Number);
  wk.textContent = `周${WEEK[new Date(cy, cm - 1, cd).getDay()]}`;
  wk.setAttribute('x', CX); wk.setAttribute('y', CY + 8);
  wk.setAttribute('text-anchor', 'middle');
  wk.setAttribute('font-size', 11); wk.setAttribute('fill', 'var(--muted)');
  const tot = document.createElementNS(NS, 'text');
  const t = totalMinutes();
  tot.textContent = t ? `${fmtDur(t)} · ${segments.length}段` : '—';
  tot.setAttribute('x', CX); tot.setAttribute('y', CY + 30);
  tot.setAttribute('text-anchor', 'middle');
  tot.setAttribute('font-size', 10.5); tot.setAttribute('fill', 'var(--muted)');
  gCenter.append(dayNum, wk, tot);

  const legend = $('#legend');
  legend.innerHTML = '';
  for (const s of sorted) {
    const li = document.createElement('li');
    li.className = 'legend-row';
    li.innerHTML = `<span class="legend-dot" style="background:${eventColors.get(s.id)}"></span>` +
      `<span class="legend-time">${minToHM(s.start)} – ${minToHM(s.end)}</span>` +
      `<span class="legend-label">${escapeHtml(s.label || '未命名')}</span>` +
      `<span class="legend-dur">${fmtDur(Math.min(spanOf(s), 1440))}</span>`;
    li.addEventListener('click', () => openPopover({ mode: 'edit', seg: s }, li));
    li.addEventListener('mouseenter', () => highlightSeg(s.id, true));
    li.addEventListener('mouseleave', () => highlightSeg(s.id, false));
    legend.append(li);
  }
  $('#emptyHint').style.display = segments.length ? 'none' : 'block';
}

function escapeHtml(s) {
  return s.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
function highlightSeg(id, on) {
  const el = gArcs.querySelector(`.seg[data-id="${id}"]`);
  if (el) el.style.opacity = on ? .6 : '';
}

/* ============================== 拖拽创建 ============================== */

let dragging = null;
let suppressRingClick = false;
const dragTip = $('#dragTip');

function pointerToMin(e) {
  const point = ringSvg.createSVGPoint();
  point.x = e.clientX;
  point.y = e.clientY;
  const local = point.matrixTransform(ringSvg.getScreenCTM().inverse());
  const x = local.x - CX, y = local.y - CY;
  const r = Math.hypot(x, y);
  const deg = Math.atan2(y, x) * 180 / Math.PI;
  const clock = (deg + 90 + 360) % 360;
  return { r, min: clock / 360 * 1440 };
}
const gran = e => e.shiftKey ? 5 : ANDROID ? Number($('#touchPrecision').value) : 15;
const snapTo = (min, g) => Math.round(min / g) * g % 1440;

ringSvg.addEventListener('pointerdown', e => {
  if (e.button !== 0 || dragging) return;
  suppressRingClick = false;
  const segEl = e.target.closest?.('.seg');
  if (segEl) {
    suppressRingClick = true;
    const seg = segments.find(s => String(s.id) === segEl.dataset.id);
    if (seg) openPopover({ mode: 'edit', seg }, null, e);
    return;
  }
  const { r, min } = pointerToMin(e);
  if (r < 70 || r > 196) return;
  const g = gran(e);
  dragging = { pointerId: e.pointerId, g, start: snapTo(min, g), lastRaw: min, unwrapped: min,
    downX: e.clientX, downY: e.clientY, moved: false };
  e.preventDefault();
  ringSvg.setPointerCapture(e.pointerId);
  updateDrag(min, e);
});

function updateDrag(curRaw, e) {
  const { g, start } = dragging;
  // Unwrap successive angles so small backwards movements cannot become a full day.
  dragging.unwrapped += (curRaw - dragging.lastRaw + 2160) % 1440 - 720;
  dragging.lastRaw = curRaw;
  // Keep the original start on the same continuous timeline as pointerdown.
  if (dragging.origin === undefined) dragging.origin = Math.round(dragging.unwrapped / g) * g;
  const span = Math.max(0, Math.min(1440, Math.round(dragging.unwrapped / g) * g - dragging.origin));
  dragging.end = start + span;
  dragging.span = span;
  gPreview.innerHTML = '';
  if (span) {
    const NS = 'http://www.w3.org/2000/svg';
    const p = document.createElementNS(NS, 'path');
    p.setAttribute('d', arcPath(dragging.start, dragging.end));
    p.setAttribute('fill', 'none');
    p.setAttribute('stroke', 'var(--accent)');
    p.setAttribute('stroke-width', ARC_W - 4);
    p.setAttribute('stroke-linecap', 'butt');
    p.setAttribute('opacity', .65);
    gPreview.append(p);
  }
}

ringSvg.addEventListener('pointermove', e => {
  if (!dragging || e.pointerId !== dragging.pointerId) return;
  if (Math.hypot(e.clientX - dragging.downX, e.clientY - dragging.downY) > 4) dragging.moved = true;
  const point = pointerToMin(e);
  if (point.r < 70) return;
  updateDrag(point.min, e);
  dragTip.hidden = false;
  dragTip.style.left = e.clientX + 'px';
  dragTip.style.top = e.clientY + 'px';
  dragTip.textContent = dragging.span
    ? `${minToHM(dragging.start)} → ${minToHM(dragging.start + dragging.span)} · ${fmtDur(dragging.span)}`
    : `${minToHM(dragging.start)}（继续拖动）`;
});

ringSvg.addEventListener('pointerup', e => {
  if (!dragging || e.pointerId !== dragging.pointerId) return;
  const point = pointerToMin(e);
  if (point.r >= 70) updateDrag(point.min, e);
  const d = dragging;
  suppressRingClick = !!d.span || d.moved || Math.hypot(e.clientX - d.downX, e.clientY - d.downY) > 4;
  cancelDrag(e);
  if (d.span) {
    openPopover({ mode: 'create', start: d.start % 1440, end: (d.start + d.span) % 1440 }, null, e);
  }
});

function cancelDrag(e) {
  if (!dragging || e.pointerId !== dragging.pointerId) return;
  dragging = null;
  gPreview.innerHTML = '';
  dragTip.hidden = true;
  if (ringSvg.hasPointerCapture(e.pointerId)) ringSvg.releasePointerCapture(e.pointerId);
}
ringSvg.addEventListener('pointercancel', cancelDrag);
ringSvg.addEventListener('lostpointercapture', cancelDrag);

ringSvg.addEventListener('click', e => {
  if (suppressRingClick) { suppressRingClick = false; return; }
  if (e.target.closest?.('.seg')) return;
  openPopover({ mode: 'create' }, null, e);
});
$('#dayView').addEventListener('click', e => {
  if (e.target.closest?.('#ring, button, input, select, label, #mobileTools, .legend-row')) return;
  openPopover({ mode: 'create' }, null, e);
});
$('#newEventBtn').addEventListener('click', e => openPopover({ mode: 'create' }, null, e));

/* ============================== 弹窗（创建 / 编辑） ============================== */

const pop = $('#popover'), popOverlay = $('#popOverlay');
let popCtx = null;

function openPopover(ctx, anchorEl, anchorEvent) {
  popCtx = ctx;
  const editing = ctx.mode === 'edit';
  $('#popTitle').textContent = editing ? '编辑时间段' : '记录这段时间';
  $('#popDelete').hidden = !editing;
  const seg = editing ? ctx.seg : ctx;
  $('#popStart').value = seg.start == null ? '' : minToHM(seg.start);
  $('#popEnd').value = seg.end == null ? '' : minToHM(seg.end);
  $('#popLabel').value = editing ? (ctx.seg.label || '') : '';
  pop.hidden = false; popOverlay.hidden = false;

  let x, y;
  if (anchorEvent) { x = anchorEvent.clientX; y = anchorEvent.clientY; }
  else if (anchorEl) {
    const r = anchorEl.getBoundingClientRect();
    x = r.left + 40; y = r.top + r.height / 2;
  } else { x = window.innerWidth / 2; y = 90; }
  const pw = pop.offsetWidth, ph = pop.offsetHeight;
  x = Math.min(Math.max(8, x - pw / 2), window.innerWidth - pw - 8);
  y = Math.min(Math.max(8, y - ph - 16), window.innerHeight - ph - 8);
  pop.style.left = x + 'px'; pop.style.top = y + 'px';

  setTimeout(() => { $('#popLabel').focus(); $('#popLabel').select(); }, 30);
}

function closePopover() {
  pop.hidden = true; popOverlay.hidden = true;
  popCtx = null;
}

$('#popSave').addEventListener('click', savePopover);
$('#popDelete').addEventListener('click', () => {
  if (popCtx?.mode === 'edit') {
    segments = segments.filter(s => s.id !== popCtx.seg.id);
    persist();
  }
  closePopover();
});
$('#popCancel').addEventListener('click', closePopover);
popOverlay.addEventListener('click', closePopover);

pop.addEventListener('keydown', e => {
  if (e.key === 'Enter') { e.preventDefault(); savePopover(); }
  if (e.key === 'Escape') closePopover();
});
$('#popLabel').addEventListener('input', e => e.stopPropagation());

function savePopover() {
  if (!popCtx) return;
  for (const selector of ['#popStart', '#popEnd']) {
    const input = $(selector);
    if (!input.value || !input.checkValidity()) {
      toast('请填写有效的起止时间');
      input.focus();
      return;
    }
  }
  const label = $('#popLabel').value.trim() || '未命名';
  const start = hmToMin($('#popStart').value);
  const end = hmToMin($('#popEnd').value);
  if (start === end && spanOf({ start, end }) === 0) { closePopover(); return; }
  if (popCtx.mode === 'edit') {
    popCtx.seg.start = start; popCtx.seg.end = end; popCtx.seg.label = label;
  } else {
    segments.push({ id: uid++, start, end, label });
  }
  persist();
  toast(popCtx.mode === 'edit' ? '已更新' : `已记录 · ${label}`);
  closePopover();
}

function persist() {
  Store.writeDay(currentDate, segments).catch(error => {
    console.error(error);
    toast('保存失败，请重试：' + error.message);
  });
  render();
}

/* ============================== 记到现在 ============================== */

$('#untilNowBtn').addEventListener('click', () => {
  const d = new Date();
  const nowMin = d.getHours() * 60 + d.getMinutes();
  let lastEnd = 0;
  for (const s of segments) {
    const e = s.start + Math.min(spanOf(s), 1440);
    if (e % 1440 > lastEnd && e % 1440 <= nowMin) lastEnd = e % 1440;
  }
  openPopover({ mode: 'create', start: lastEnd, end: nowMin });
});

/* ============================== 日期导航 ============================== */

async function loadDay(date) {
  currentDate = date;
  const raw = await Store.readDay(date);
  segments = (raw || []).map(s => ({ id: uid++, start: hmToMin(s.start), end: hmToMin(s.end), label: s.label || '' }));
  render();
}
$('#prevDay').addEventListener('click', () => loadDay(shiftDate(currentDate, -1)));
$('#nextDay').addEventListener('click', () => loadDay(shiftDate(currentDate, 1)));
$('#todayBtn').addEventListener('click', () => loadDay(todayStr()));

/* ============================== 历史视图 ============================== */

$('#historyBtn').addEventListener('click', showHistory);
$('#historyBack').addEventListener('click', () => {
  $('#historyView').hidden = true;
  $('#dayView').hidden = false;
});

async function showHistory() {
  $('#dayView').hidden = true;
  $('#historyView').hidden = false;
  const list = $('#historyList');
  list.innerHTML = '<div class="hist-empty">加载中…</div>';
  const days = await Store.listDays();
  if (!days.length) {
    list.innerHTML = '<div class="hist-empty">还没有任何记录</div>';
    return;
  }
  list.innerHTML = '';
  let lastMonth = '';
  for (const day of days) {
    const month = day.slice(0, 7);
    if (month !== lastMonth) {
      lastMonth = month;
      const [y, m] = month.split('-').map(Number);
      const h = document.createElement('div');
      h.className = 'hist-month';
      h.textContent = `${y}年${m}月`;
      list.append(h);
    }
    const [y, m, d] = day.split('-').map(Number);
    const info = (await Store.readDay(day)) || [];
    const total = info.reduce((t, s) => t + Math.min(spanOf({ start: hmToMin(s.start), end: hmToMin(s.end) }), 1440), 0);
    const row = document.createElement('div');
    row.className = 'hist-day';
    row.innerHTML = `<span class="hist-date">${d}日</span>` +
      `<span class="hist-week">周${WEEK[new Date(y, m - 1, d).getDay()]}</span>` +
      `<span class="hist-stats">${info.length}段 · ${total ? fmtDur(total) : '—'}</span>`;
    row.addEventListener('click', async () => {
      $('#historyView').hidden = true;
      $('#dayView').hidden = false;
      await loadDay(day);
    });
    list.append(row);
  }
}

/* ============================== 设置 ============================== */

$('#settingsBtn').addEventListener('click', openSettings);
$('#settingsClose').addEventListener('click', closeSettings);
$('#settingsOverlay').addEventListener('click', closeSettings);

async function openSettings() {
  $('#settingsOverlay').hidden = false;
  $('#settingsPop').hidden = false;
  if (ANDROID) return;
  $('#dataDirLabel').textContent = NATIVE ? `${dataDir}\\days` : '浏览器预览：localStorage';
  if (!NATIVE) {
    $('#nativeOnly').hidden = false;
    $('#setAutostart').disabled = true;
    $('#setHotkey').disabled = true;
    return;
  }
  $('#setAutostart').checked = await isAutostartOn();
  $('#setHotkey').checked = await isHotkeyOn();
}
function closeSettings() {
  $('#settingsOverlay').hidden = true;
  $('#settingsPop').hidden = true;
}

$('#setAutostart').addEventListener('change', e => setAutostart(e.target.checked).catch(console.error));
$('#setHotkey').addEventListener('change', e => setHotkey(e.target.checked).catch(console.error));

window.openDataDir = async function () {
  if (!NATIVE) { toast('浏览器预览模式下不可用'); return; }
  await Neutralino.os.execCommand(`explorer "${dataDir.replace(/\//g, '\\')}\\days"`);
};

/* ============================== Toast ============================== */

let toastTimer = null;
function toast(msg) {
  const t = $('#toast');
  t.textContent = msg;
  t.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { t.hidden = true; }, 1800);
}

/* ============================== 原生层（Neutralino） ============================== */

async function bootNative() {
  Neutralino.init();

  await Neutralino.events.on('windowClose', async () => {
    await Neutralino.window.hide();
  });

  await Neutralino.events.on('trayMenuItemClicked', async e => {
    const id = e.data?.id || e.detail?.id;
    if (id === 'show' || id === 'today') {
      if (id === 'today') await loadDay(todayStr());
      await showWindow();
    }
    if (id === 'quit') await Neutralino.app.exit();
  });

  const env = await Neutralino.os.getEnv('APPDATA');
  const appData = (env && (env.APPDATA || env.value)) || env;
  dataDir = String(appData).replace(/\\/g, '/') + '/timering';
  await mkdirp(dataDir);
  await mkdirp(dataDir + '/days');

  await singleInstance();

  if (NL_OS === 'Windows') {
    await startWindowsTray();
  } else await Neutralino.os.setTray({
    icon: '/resources/icons/trayIcon.png',
    menuItems: [
      { id: 'show', text: '显示时环' },
      { id: 'today', text: '记录今天' },
      { id: 'quit', text: '退出' }
    ]
  });
}

async function startWindowsTray() {
  // The bundled Windows runtime opens its menu on both buttons. Use a native
  // tray companion to support left-click activation and a right-click menu.
  const helperPath = `${dataDir}/tray-helper-${NL_PID}.exe`;
  const iconPath = `${dataDir}/tray-icon.png`;
  await Neutralino.resources.extractFile('/resources/native/tray-helper.exe', helperPath);
  await Neutralino.resources.extractFile('/resources/icons/trayIcon.png', iconPath);
  const command = `"${helperPath}" ${NL_PID} "${dataDir}/tray-${NL_PID}.signal" "${iconPath}"`;
  await Neutralino.os.spawnProcess(command);
}

async function mkdirp(p) {
  try { await Neutralino.filesystem.createDirectory(p); } catch { }
}

async function singleInstance() {
  const lockPath = `${dataDir}/lock.json`;
  try {
    const prev = JSON.parse(await Neutralino.filesystem.readFile(lockPath));
    if (prev?.pid) {
      const r = await Neutralino.os.execCommand(`tasklist /FI "PID eq ${prev.pid}"`);
      if ((r.stdout || '').includes(String(prev.pid))) {
        await Neutralino.filesystem.writeFile(`${dataDir}/show.signal`, '1').catch(() => { });
        Neutralino.app.exit();
        await new Promise(r2 => setTimeout(r2, 5000));
        return;
      }
    }
  } catch { }
  await Neutralino.filesystem.writeFile(lockPath, JSON.stringify({ pid: NL_PID }));
  setInterval(pollSignal, 400);
}

async function pollSignal() {
  try {
    const path = `${dataDir}/tray-${NL_PID}.signal`;
    const action = (await Neutralino.filesystem.readFile(path)).trim();
    await Neutralino.filesystem.remove(path);
    if (action === 'quit') {
      await Neutralino.app.exit();
      return;
    }
    if (action === 'today') await loadDay(todayStr());
    if (action === 'show' || action === 'today') await showWindow();
  } catch { }
  try {
    await Neutralino.filesystem.readFile(`${dataDir}/show.signal`);
    await Neutralino.filesystem.remove(`${dataDir}/show.signal`).catch(() => { });
    await showWindow();
  } catch { }
  try {
    const lsSig = localStorage.getItem('timering.show.signal');
    if (lsSig) {
      localStorage.removeItem('timering.show.signal');
      await showWindow();
    }
  } catch { }
}

async function showWindow() {
  await Neutralino.window.show();
  if (await Neutralino.window.isMinimized()) await Neutralino.window.unminimize();
  await Neutralino.window.focus();
}

/* ---------- 注册表 / 快捷键 ---------- */

const LAUNCH_VBS = `Set fso = CreateObject("Scripting.FileSystemObject")
Set sh = CreateObject("WScript.Shell")
baseDir = fso.GetParentFolderName(WScript.ScriptFullName)
exe = baseDir & "\\timering-win_x64.exe"
sig = sh.ExpandEnvironmentStrings("%APPDATA%") & "\\timering\\show.signal"
Set wmi = GetObject("winmgmts:\\\\.\\root\\cimv2")
Set procs = wmi.ExecQuery("SELECT ProcessId FROM Win32_Process WHERE Name = 'timering-win_x64.exe'")
If procs.Count > 0 Then
  On Error Resume Next
  fso.CreateTextFile(sig, True).Write "1"
Else
  sh.Run """" & exe & """", 1, False
End If
`;

async function ensureLaunchVbs(exePath) {
  const vbs = exePath.replace(/timering-win_x64\.exe$/, 'launch.vbs');
  try { await Neutralino.filesystem.writeFile(vbs, LAUNCH_VBS); } catch { }
  return vbs;
}

async function runPs(script) {
  const b64 = psEncode(script);
  return Neutralino.os.execCommand(`powershell -NoProfile -ExecutionPolicy Bypass -EncodedCommand ${b64}`);
}
function psEncode(s) {
  const bytes = new Uint8Array(s.length * 2);
  for (let i = 0; i < s.length; i++) {
    bytes[2 * i] = s.charCodeAt(i) & 0xff;
    bytes[2 * i + 1] = s.charCodeAt(i) >> 8;
  }
  let bin = '';
  for (let i = 0; i < bytes.length; i += 8192) {
    bin += String.fromCharCode(...bytes.subarray(i, i + 8192));
  }
  return btoa(bin);
}

async function getExePath() {
  const r = await runPs(`(Get-Process -Id ${NL_PID}).Path`);
  return (r.stdout || '').trim();
}

async function isAutostartOn() {
  const r = await runPs(`[bool](Get-ItemProperty -Path 'HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\Run' -Name Timering -ErrorAction SilentlyContinue)`);
  return (r.stdout || '').trim() === 'True';
}
async function setAutostart(on) {
  if (on) {
    const vbs = await ensureLaunchVbs(await getExePath());
    await runPs(`Set-ItemProperty -Path 'HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\Run' -Name Timering -Value 'wscript.exe "${vbs}"'`);
    toast('已开启开机自启');
  } else {
    await runPs(`Remove-ItemProperty -Path 'HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\Run' -Name Timering -ErrorAction SilentlyContinue`);
    toast('已关闭开机自启');
  }
}

async function isHotkeyOn() {
  const r = await runPs(`Test-Path "$env:APPDATA\\Microsoft\\Windows\\Start Menu\\Programs\\TimeRing.lnk"`);
  return (r.stdout || '').trim() === 'True';
}
async function setHotkey(on) {
  if (on) {
    const vbs = await ensureLaunchVbs(await getExePath());
    await runPs(`$l=(New-Object -ComObject WScript.Shell).CreateShortcut("$env:APPDATA\\Microsoft\\Windows\\Start Menu\\Programs\\TimeRing.lnk"); $l.TargetPath='wscript.exe'; $l.Arguments='"${vbs}"'; $l.Hotkey='Ctrl+Alt+T'; $l.Save()`);
    toast('已创建快捷键 Ctrl+Alt+T');
  } else {
    await runPs(`Remove-Item "$env:APPDATA\\Microsoft\\Windows\\Start Menu\\Programs\\TimeRing.lnk" -ErrorAction SilentlyContinue`);
    toast('已移除快捷键');
  }
}

/* ============================== 启动 ============================== */

document.addEventListener('DOMContentLoaded', async () => {
  if (ANDROID) {
    document.body.classList.add('android');
    $('#mobileTools').hidden = false;
    $('#androidInfo').hidden = false;
    document.querySelectorAll('.desktop-setting').forEach(element => { element.hidden = true; });
  }
  if (!NATIVE && location.hostname === '127.0.0.1') {
    localStorage.setItem('timering.show.signal', String(Date.now()));
    document.body.innerHTML = '<div style="display:flex;height:100vh;align-items:center;justify-content:center;font:14px sans-serif;color:#666">时环已在运行，此窗口可以关闭</div>';
    setInterval(() => { try { window.close(); } catch { } }, 2000);
    return;
  }
  buildRing();
  if (NATIVE) {
    try { await bootNative(); } catch (e) {
      console.error(e);
      toast('初始化失败：' + e);
    }
  }
  await loadDay(currentDate);
});

window.timeringBack = () => {
  if (!pop.hidden) { closePopover(); return true; }
  if (!$('#settingsPop').hidden) { closeSettings(); return true; }
  if (!$('#historyView').hidden) {
    $('#historyView').hidden = true;
    $('#dayView').hidden = false;
    return true;
  }
  return false;
};
