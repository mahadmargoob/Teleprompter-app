'use strict';
/* PromptCam. Sections, in order: helpers, storage, settings, UI primitives,
   navigation, library, editor, backup, prompter engine, pacing and voice,
   camera, recording, takes and review, input, startup. */

const VERSION = (typeof APP_VERSION !== 'undefined') ? APP_VERSION : 'dev';
const $ = id => document.getElementById(id);
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
const now = () => performance.now();
const pad2 = n => String(n).padStart(2, '0');

function uid(){
  if(window.crypto && crypto.randomUUID) return crypto.randomUUID();
  return 'id-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 10);
}
function esc(str){
  return String(str == null ? '' : str).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
}
function fmtTime(sec){
  sec = Math.max(0, Math.round(sec));
  return Math.floor(sec / 60) + ':' + pad2(sec % 60);
}
function fmtBytes(b){
  if(b < 1048576) return Math.max(0, Math.round(b / 1024)) + ' KB';
  if(b < 1073741824) return (b / 1048576).toFixed(1) + ' MB';
  return (b / 1073741824).toFixed(2) + ' GB';
}
function fmtDate(ts){
  try{ return new Date(ts).toLocaleString(undefined, {month:'short', day:'numeric', hour:'numeric', minute:'2-digit'}); }
  catch(e){ return new Date(ts).toISOString().slice(0, 16).replace('T', ' '); }
}
// "2:30" is minutes:seconds; a bare number is minutes.
function parseDuration(str){
  str = String(str || '').trim();
  if(!str) return null;
  let sec;
  if(str.includes(':')){ const p = str.split(':'); sec = Number(p[0]) * 60 + Number(p[1] || 0); }
  else sec = Number(str) * 60;
  return (isFinite(sec) && sec >= 5 && sec <= 3 * 3600) ? Math.round(sec) : null;
}
function slug(str){
  return String(str || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40) || 'take';
}

const ICONS = {
  back:'<path d="M15 5l-7 7 7 7"/>',
  close:'<path d="M6 6l12 12M18 6L6 18"/>',
  plus:'<path d="M12 5v14M5 12h14"/>',
  sliders:'<path d="M4 7h9M19 7h1M4 17h1M11 17h9"/><circle cx="16" cy="7" r="2.5"/><circle cx="8" cy="17" r="2.5"/>',
  import:'<path d="M12 4v10M8 10l4 4 4-4M5 19h14"/>',
  flip:'<path d="M20 11a8 8 0 00-14.5-4M4 13a8 8 0 0014.5 4"/><path d="M5 3v4h4M19 21v-4h-4"/>',
  bolt:'<path d="M13 3L5 14h6l-1 7 8-11h-6l1-7z"/>',
  play:'<path d="M8 5l11 7-11 7V5z" fill="currentColor"/>',
  pause:'<path d="M8 5v14M16 5v14" stroke-width="3"/>',
  restart:'<path d="M5 12a7 7 0 107-7H8"/><path d="M11 2L8 5l3 3"/>'
};
function icon(name){
  return '<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + ICONS[name] + '</svg>';
}

/* ===================== STORAGE ===================== */
const K = {
  scripts:'promptcam_scripts', settings:'promptcam_settings',
  warn:'promptcam_browser_warning_dismissed', primed:'promptcam_cam_primed'
};
function lsGet(key, fallback){
  try{ const v = localStorage.getItem(key); return v == null ? fallback : JSON.parse(v); }
  catch(e){ return fallback; }
}
let storageWarned = false;
function lsSet(key, val){
  try{ localStorage.setItem(key, JSON.stringify(val)); return true; }
  catch(e){
    if(!storageWarned){ storageWarned = true; toast('Could not save: this browser\'s storage is full or blocked.', 'error', 6000); }
    return false;
  }
}
function getScripts(){
  const list = lsGet(K.scripts, []);
  return Array.isArray(list) ? list.filter(s => s && typeof s.id === 'string') : [];
}
function saveScripts(list){ return lsSet(K.scripts, list); }
function patchScript(id, patch){
  const list = getScripts();
  const s = list.find(x => x.id === id);
  if(!s) return null;
  for(const k in patch){ if(patch[k] === undefined) delete s[k]; else s[k] = patch[k]; }
  saveScripts(list);
  return s;
}
let persistAsked = false;
function requestPersist(){
  if(persistAsked) return;
  persistAsked = true;
  try{ if(navigator.storage && navigator.storage.persist) navigator.storage.persist().catch(() => {}); }catch(e){}
}

/* ===================== SETTINGS ===================== */
const DEFS = [
  {key:'theme', type:'seg', label:'Theme', def:'auto',
   options:[['auto','Auto'],['midnight','Midnight'],['light','Light'],['crimson','Crimson'],['ocean','Ocean']]},
  {key:'mode', type:'seg', label:'Pacing', def:'wpm',
   options:[['wpm','Speed'],['timed','Timed'],['voice','Voice-paced'],['follow','Voice-follow']],
   help:'Speed scrolls at a fixed words-per-minute. Timed finishes in the duration you set. Voice-paced scrolls while you speak and waits when you stop. Voice-follow tracks your actual words where the browser supports it, and switches to Voice-paced if it can\'t.'},
  {key:'speed', type:'range', label:'Default reading speed', def:140, min:60, max:300, step:5, unit:' wpm'},
  {key:'fontSize', type:'range', label:'Text size', def:30, min:18, max:72, step:1, unit:'px'},
  {key:'textHeight', type:'range', label:'Text area height', def:45, min:25, max:100, step:5, unit:'%'},
  {key:'guideLinePos', type:'range', label:'Reading line position', def:35, min:15, max:85, step:5, unit:'%'},
  {key:'bgOpacity', type:'range', label:'Text background', def:55, min:0, max:90, step:5, unit:'%'},
  {key:'margin', type:'range', label:'Side margin', def:20, min:0, max:80, step:4, unit:'px'},
  {key:'align', type:'seg', label:'Alignment', def:'left', options:[['left','Left'],['center','Centre']]},
  {key:'dimRead', type:'toggle', label:'Dim words already read', def:true},
  {key:'mirror', type:'toggle', label:'Mirror text (for glass rigs)', def:false},
  {key:'quality', type:'seg', label:'Video quality', def:'1080', options:[['720','720p, smaller files'],['1080','1080p']]},
  {key:'countdown', type:'seg', label:'Countdown before recording', def:3, options:[[0,'Off'],[3,'3s'],[5,'5s'],[10,'10s']]},
  {key:'frontCamera', type:'toggle', label:'Start with the front camera', def:true},
  {key:'mirrorPreview', type:'toggle', label:'Mirror the selfie preview', def:true},
  {key:'autoStop', type:'toggle', label:'Stop recording when the script ends', def:false},
  {key:'lang', type:'select', label:'Voice-follow language', def:'auto',
   options:[['auto','Device language'],['en-US','English (US)'],['en-GB','English (UK)'],['ur-PK','Urdu'],['hi-IN','Hindi'],['ar-SA','Arabic'],['es-ES','Spanish'],['fr-FR','French'],['de-DE','German']]}
];
const DEF = {};
const DEFAULTS = {};
DEFS.forEach(d => { DEF[d.key] = d; DEFAULTS[d.key] = d.def; });
const SETTINGS_GROUPS = [
  ['Appearance', ['theme']],
  ['Prompter', ['mode','speed','fontSize','textHeight','guideLinePos','bgOpacity','margin','align','dimRead','mirror']],
  ['Recording', ['quality','countdown','frontCamera','mirrorPreview','autoStop']],
  ['Voice', ['lang']]
];
const SHEET_KEYS = ['mode','fontSize','textHeight','guideLinePos','bgOpacity','margin','align','dimRead','mirror','mirrorPreview','countdown','autoStop'];
const MODE_LABEL = {wpm:'Speed', timed:'Timed', voice:'Voice-paced', follow:'Voice-follow'};

// Accepts whatever an older build saved and returns something valid. Earlier
// builds used other names and scales (speed 1-10, a boolean countdown), so
// anything out of range falls back to the default instead of being trusted.
function sanitizeSettings(raw){
  const out = Object.assign({}, DEFAULTS);
  raw = (raw && typeof raw === 'object') ? Object.assign({}, raw) : {};
  if(raw.mode === 'standard') raw.mode = 'wpm';
  if(typeof raw.countdown === 'boolean') raw.countdown = raw.countdown ? 3 : 0;
  for(const d of DEFS){
    const v = raw[d.key];
    if(d.type === 'range'){ if(typeof v === 'number' && v >= d.min && v <= d.max) out[d.key] = v; }
    else if(d.type === 'toggle'){ if(typeof v === 'boolean') out[d.key] = v; }
    else if(d.options.some(o => o[0] === v)) out[d.key] = v;
  }
  return out;
}
let settings = sanitizeSettings(lsGet(K.settings, null));

const THEME_BG = {midnight:'#0A0B0D', light:'#F4F5F7', crimson:'#0D0708', ocean:'#061219'};
const darkQuery = window.matchMedia ? window.matchMedia('(prefers-color-scheme: dark)') : null;
function applyTheme(){
  const t = settings.theme === 'auto' ? ((darkQuery && !darkQuery.matches) ? 'light' : 'midnight') : settings.theme;
  document.documentElement.setAttribute('data-theme', t);
  const meta = document.querySelector('meta[name="theme-color"]');
  if(meta) meta.setAttribute('content', THEME_BG[t]);
}
if(darkQuery && darkQuery.addEventListener) darkQuery.addEventListener('change', applyTheme);
applyTheme();

function controlHtml(d, prefix){
  const v = settings[d.key];
  const id = prefix + '_' + d.key;
  if(d.type === 'range'){
    return '<div class="field"><label for="' + id + '"><span>' + d.label + '</span><output>' + v + d.unit + '</output></label>' +
      '<input type="range" id="' + id + '" data-key="' + d.key + '" min="' + d.min + '" max="' + d.max + '" step="' + d.step + '" value="' + v + '"></div>';
  }
  if(d.type === 'seg'){
    return '<div class="field"><div class="fieldLabel">' + d.label + '</div><div class="segment" role="radiogroup" aria-label="' + d.label + '">' +
      d.options.map(o => '<button type="button" role="radio" aria-checked="' + (o[0] === v) + '" class="' + (o[0] === v ? 'on' : '') +
        '" data-key="' + d.key + '" data-val="' + o[0] + '">' + o[1] + '</button>').join('') +
      '</div>' + (d.help ? '<p class="hint">' + d.help + '</p>' : '') + '</div>';
  }
  if(d.type === 'toggle'){
    return '<div class="field toggleRow"><span id="' + id + '_l">' + d.label + '</span>' +
      '<button type="button" class="switch' + (v ? ' on' : '') + '" role="switch" aria-checked="' + !!v + '" aria-labelledby="' + id + '_l" data-key="' + d.key + '"><span class="knob"></span></button></div>';
  }
  return '<div class="field"><label for="' + id + '"><span>' + d.label + '</span></label><select id="' + id + '" data-key="' + d.key + '">' +
    d.options.map(o => '<option value="' + o[0] + '"' + (o[0] === v ? ' selected' : '') + '>' + o[1] + '</option>').join('') + '</select></div>';
}
function setSetting(key, val){
  settings[key] = val;
  lsSet(K.settings, settings);
  if(key === 'theme') applyTheme();
  if(!isView('prompter')) return;
  if(key === 'mode') onModeChosen();
  else applyPrompterStyle();
}
document.addEventListener('input', e => {
  const el = e.target;
  const d = el.dataset && DEF[el.dataset.key];
  if(!d) return;
  if(d.type === 'range'){
    const v = Number(el.value);
    const out = el.closest('.field').querySelector('output');
    if(out) out.textContent = v + d.unit;
    setSetting(d.key, v);
  } else if(d.type === 'select'){
    const opt = d.options.find(o => String(o[0]) === el.value);
    if(opt) setSetting(d.key, opt[0]);
  }
});
document.addEventListener('click', e => {
  const el = e.target.closest ? e.target.closest('button[data-key]') : null;
  const d = el && DEF[el.dataset.key];
  if(!d) return;
  if(d.type === 'seg'){
    const opt = d.options.find(o => String(o[0]) === el.dataset.val);
    if(!opt) return;
    el.parentNode.querySelectorAll('button').forEach(b => { b.classList.toggle('on', b === el); b.setAttribute('aria-checked', b === el); });
    setSetting(d.key, opt[0]);
  } else if(d.type === 'toggle'){
    const v = !settings[d.key];
    el.classList.toggle('on', v);
    el.setAttribute('aria-checked', v);
    setSetting(d.key, v);
  }
});

function openSettings(){
  $('settingsBody').innerHTML = SETTINGS_GROUPS.map(g =>
    '<h2 class="groupTitle">' + g[0] + '</h2>' + g[1].map(k => controlHtml(DEF[k], 'st')).join('')).join('');
  $('aboutLine').textContent = 'PromptCam ' + VERSION + '. Works offline after the first visit. Nothing you write or record leaves this device.';
  show('view-settings');
}
function closeSettings(){ showLibrary(); }

/* ===================== UI PRIMITIVES ===================== */
function toast(msg, kind, ms, action){
  const box = $('toasts');
  if(!box) return null;
  const el = document.createElement('div');
  el.className = 'toast' + (kind ? ' ' + kind : '');
  const span = document.createElement('span');
  span.textContent = msg;
  el.appendChild(span);
  if(action){
    const b = document.createElement('button');
    b.type = 'button';
    b.textContent = action.label;
    b.addEventListener('click', () => { el.remove(); action.fn(); });
    el.appendChild(b);
  }
  box.appendChild(el);
  while(box.children.length > 3) box.firstChild.remove();
  if(ms !== 0) setTimeout(() => el.remove(), ms || 3600);
  return el;
}

let dlg = null;
// Resolves true/false, or for an input dialog the typed string (null if cancelled).
function dialog(o){
  if(dlg) closeDialog(false);
  return new Promise(resolve => {
    dlg = {resolve, input: !!o.input, prevFocus: document.activeElement};
    $('modalTitle').textContent = o.title || '';
    $('modalBody').textContent = o.body || '';
    $('modalBody').hidden = !o.body;
    const inp = $('modalInput');
    inp.hidden = !o.input;
    if(o.input){
      inp.value = o.input.value || '';
      inp.placeholder = o.input.placeholder || '';
      inp.setAttribute('aria-label', o.title || 'Value');
    }
    $('modalOk').textContent = o.confirm || 'OK';
    $('modalOk').classList.toggle('dangerSolid', !!o.danger);
    $('modalCancel').textContent = o.cancel || 'Cancel';
    $('modalCancel').hidden = o.cancel === null;
    $('modal').hidden = false;
    (o.input ? inp : $('modalOk')).focus();
  });
}
function closeDialog(ok){
  if(!dlg) return;
  const d = dlg;
  dlg = null;
  $('modal').hidden = true;
  try{ if(d.prevFocus && d.prevFocus.focus) d.prevFocus.focus(); }catch(e){}
  d.resolve(d.input ? (ok ? $('modalInput').value : null) : !!ok);
}
$('modalOk').addEventListener('click', () => closeDialog(true));
$('modalCancel').addEventListener('click', () => closeDialog(false));
$('modal').addEventListener('click', e => { if(e.target === $('modal')) closeDialog(false); });
$('modalInput').addEventListener('keydown', e => { if(e.key === 'Enter'){ e.preventDefault(); closeDialog(true); } });

/* ===================== NAVIGATION ===================== */
function show(id){
  document.querySelectorAll('.view').forEach(v => v.classList.toggle('active', v.id === id));
  document.body.dataset.view = id.replace('view-', '');
}
function isView(name){ return document.body.dataset.view === name; }

// The app is one page, so the browser's Back would leave it entirely. One
// spare history entry turns Back into "go up one screen" instead.
function handleBack(){
  if(dlg){ closeDialog(false); return true; }
  if(!$('quickSheet').hidden){ closeSheet(); return true; }
  if(isView('prompter')){ exitPrompter(); return true; }
  if(isView('review')){ closeReview(); return true; }
  if(isView('editor')){ closeEditor(); return true; }
  if(isView('settings')){ closeSettings(); return true; }
  return false;
}
window.addEventListener('popstate', () => {
  if(handleBack()){ try{ history.pushState({pc:1}, ''); }catch(e){} }
  else history.back();
});

function setAppHeight(){
  const vv = window.visualViewport;
  document.documentElement.style.setProperty('--app-h', (vv ? vv.height : window.innerHeight) + 'px');
}
let resizeQueued = false;
function onResize(){
  setAppHeight();
  if(resizeQueued) return;
  resizeQueued = true;
  requestAnimationFrame(() => {
    resizeQueued = false;
    if(isView('prompter')) applyPrompterStyle();
    else if(isView('editor')) window.scrollTo(0, 0);
  });
}
window.addEventListener('resize', onResize);
window.addEventListener('orientationchange', onResize);
if(window.visualViewport) window.visualViewport.addEventListener('resize', onResize);
setAppHeight();

/* ===================== SCRIPT TEXT ===================== */
const PAUSE_SPLIT = /(\[pause(?:\s+\d+(?:\.\d+)?\s*s?)?\])/i;
const PAUSE_ONE = /^\[pause(?:\s+(\d+(?:\.\d+)?)\s*s?)?\]$/i;
// A script is words, [PAUSE] / [PAUSE 3] markers, and line breaks.
function tokenize(body){
  const out = [];
  String(body || '').replace(/\r\n?/g, '\n').split('\n').forEach((line, li) => {
    if(li > 0) out.push({t:'nl'});
    line.split(PAUSE_SPLIT).forEach(seg => {
      if(!seg) return;
      const m = PAUSE_ONE.exec(seg);
      if(m){ out.push({t:'p', sec: clamp(m[1] ? Number(m[1]) : 2, 0.5, 30)}); return; }
      seg.split(/\s+/).forEach(w => { if(w) out.push({t:'w', text:w}); });
    });
  });
  return out;
}
function scriptStats(body){
  let words = 0, pause = 0;
  for(const k of tokenize(body)){ if(k.t === 'w') words++; else if(k.t === 'p') pause += k.sec; }
  return {words, pause};
}
function estSeconds(s){
  if(s.targetSec) return s.targetSec;
  const st = scriptStats(s.body);
  const wpm = clamp(Number(s.wpm) || settings.speed, 60, 300);
  return st.words / wpm * 60 + st.pause;
}
function normWord(w){
  return String(w).toLowerCase().normalize('NFKD').replace(/[^\p{L}\p{N}]+/gu, '');
}

/* ===================== LIBRARY ===================== */
let libTab = 'scripts';
let pendingUpdate = null;
function showLibrary(tab){
  if(tab) libTab = tab;
  show('view-library');
  renderLibrary();
  if(pendingUpdate){ const fn = pendingUpdate; pendingUpdate = null; fn(); }
}
function renderLibrary(){
  const scripts = libTab === 'scripts';
  $('tabScripts').classList.toggle('on', scripts);
  $('tabScripts').setAttribute('aria-selected', scripts);
  $('tabTakes').classList.toggle('on', !scripts);
  $('tabTakes').setAttribute('aria-selected', !scripts);
  $('panelScripts').hidden = !scripts;
  $('panelTakes').hidden = scripts;
  $('btnNew').hidden = !scripts;
  if(scripts) renderScripts(); else renderTakes();
}
function renderScripts(){
  const all = getScripts().sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
  const box = $('searchBox');
  box.hidden = all.length < 6;
  const q = box.hidden ? '' : box.value.trim().toLowerCase();
  const list = q ? all.filter(s => ((s.title || '') + ' ' + (s.body || '')).toLowerCase().includes(q)) : all;
  const el = $('scriptList');
  if(!all.length){
    el.innerHTML = '<div class="emptyState">No scripts yet.<br>Tap + to write one, or use the import button to bring in a text file.</div>';
    return;
  }
  if(!list.length){ el.innerHTML = '<div class="emptyState">No scripts match that search.</div>'; return; }
  el.innerHTML = list.map(s => {
    const st = scriptStats(s.body);
    return '<div class="card" data-id="' + esc(s.id) + '">' +
      '<button class="cardMain" data-act="open"><h3>' + esc(s.title || 'Untitled script') + '</h3>' +
      '<p>' + st.words + ' word' + (st.words === 1 ? '' : 's') + ' · about ' + fmtTime(estSeconds(s)) + '</p></button>' +
      '<button class="btn small" data-act="start" aria-label="Start prompter for ' + esc(s.title || 'Untitled script') + '">Start</button></div>';
  }).join('');
}
$('scriptList').addEventListener('click', e => {
  const card = e.target.closest('.card');
  const act = e.target.closest('[data-act]');
  if(!card || !act) return;
  if(act.dataset.act === 'start') startPrompter(card.dataset.id, 'library');
  else openScript(card.dataset.id);
});
$('searchBox').addEventListener('input', renderScripts);
$('tabScripts').addEventListener('click', () => { libTab = 'scripts'; renderLibrary(); });
$('tabTakes').addEventListener('click', () => { libTab = 'takes'; renderLibrary(); });
$('btnNew').addEventListener('click', newScript);
$('btnSettings').addEventListener('click', openSettings);
$('btnSettingsBack').addEventListener('click', closeSettings);
$('btnImport').addEventListener('click', () => $('importFile').click());
$('btnImportBackup').addEventListener('click', () => $('importFile').click());
$('btnExport').addEventListener('click', exportScripts);
$('btnResetSettings').addEventListener('click', async () => {
  if(!await dialog({title:'Reset all settings?', body:'Your scripts and takes are not affected.', confirm:'Reset'})) return;
  settings = Object.assign({}, DEFAULTS);
  lsSet(K.settings, settings);
  applyTheme();
  openSettings();
  toast('Settings reset.');
});

/* ===================== EDITOR ===================== */
let ed = null;
let saveTimer = 0;
function newScript(){
  // Not written to storage until something is typed, so backing straight out
  // leaves nothing behind.
  ed = {id: uid()};
  $('scriptTitle').value = '';
  $('scriptBody').value = '';
  updateEditorMeta();
  show('view-editor');
}
function openScript(id){
  const s = getScripts().find(x => x.id === id);
  if(!s){ showLibrary('scripts'); return; }
  ed = {id};
  $('scriptTitle').value = s.title || '';
  $('scriptBody').value = s.body || '';
  updateEditorMeta();
  show('view-editor');
}
function flushSave(){
  clearTimeout(saveTimer);
  saveTimer = 0;
  if(!ed || !isView('editor')) return;
  const title = $('scriptTitle').value, body = $('scriptBody').value;
  const list = getScripts();
  const s = list.find(x => x.id === ed.id);
  if(s){
    if(s.title === title && s.body === body) return;
    s.title = title; s.body = body; s.updatedAt = Date.now();
  } else {
    if(!title.trim() && !body.trim()) return;
    list.push({id: ed.id, title, body, updatedAt: Date.now()});
    requestPersist();
  }
  saveScripts(list);
}
function scheduleSave(){
  updateEditorMeta();
  clearTimeout(saveTimer);
  saveTimer = setTimeout(flushSave, 350);
}
function currentEditorScript(){ return ed ? getScripts().find(x => x.id === ed.id) : null; }
function updateEditorMeta(){
  const body = $('scriptBody').value;
  const st = scriptStats(body);
  const saved = currentEditorScript();
  const target = saved && saved.targetSec;
  const wpm = clamp((saved && Number(saved.wpm)) || settings.speed, 60, 300);
  const secs = target || (st.words / wpm * 60 + st.pause);
  $('wordCount').textContent = st.words + ' word' + (st.words === 1 ? '' : 's') + ' · about ' + fmtTime(secs);
  $('btnTarget').textContent = 'Target time: ' + (target ? fmtTime(target) : 'off');
}
function closeEditor(){
  flushSave();
  if(ed){
    const list = getScripts();
    const s = list.find(x => x.id === ed.id);
    if(s && !String(s.title || '').trim() && !String(s.body || '').trim()) saveScripts(list.filter(x => x.id !== ed.id));
  }
  ed = null;
  showLibrary('scripts');
}
async function askTarget(scriptId){
  const s = getScripts().find(x => x.id === scriptId);
  if(!s) return false;
  const suggestion = fmtTime(s.targetSec || estSeconds(s));
  const val = await dialog({
    title:'Target time',
    body:'How long should this script take? Enter minutes:seconds, for example 2:30. Leave it empty to turn the target off.',
    input:{value: suggestion, placeholder:'2:30'}, confirm:'Set'
  });
  if(val === null) return false;
  if(!val.trim()){ patchScript(scriptId, {targetSec: undefined}); return false; }
  const sec = parseDuration(val);
  if(!sec){ toast('That isn\'t a time I can use. Try something like 2:30.', 'error'); return false; }
  patchScript(scriptId, {targetSec: sec});
  return true;
}
$('scriptTitle').addEventListener('input', scheduleSave);
$('scriptBody').addEventListener('input', scheduleSave);
$('btnEditorBack').addEventListener('click', closeEditor);
$('btnUseScript').addEventListener('click', () => { flushSave(); if(ed) startPrompter(ed.id, 'editor'); });
$('btnInsertPause').addEventListener('click', () => {
  const ta = $('scriptBody');
  const at = ta.selectionStart == null ? ta.value.length : ta.selectionStart;
  const before = ta.value.slice(0, at), after = ta.value.slice(ta.selectionEnd == null ? at : ta.selectionEnd);
  const ins = (before && !/\s$/.test(before) ? ' ' : '') + '[PAUSE]' + (after && !/^\s/.test(after) ? ' ' : '');
  ta.value = before + ins + after;
  const caret = before.length + ins.length;
  ta.focus();
  try{ ta.setSelectionRange(caret, caret); }catch(e){}
  scheduleSave();
});
$('btnTarget').addEventListener('click', async () => {
  flushSave();
  if(!currentEditorScript()){ toast('Write something first, then set a target time.'); return; }
  await askTarget(ed.id);
  if(ed) updateEditorMeta();
});
$('btnDuplicate').addEventListener('click', () => {
  flushSave();
  const s = currentEditorScript();
  if(!s){ toast('Nothing to duplicate yet.'); return; }
  const copy = Object.assign({}, s, {id: uid(), title: (s.title || 'Untitled script') + ' (copy)', updatedAt: Date.now()});
  const list = getScripts();
  list.push(copy);
  saveScripts(list);
  openScript(copy.id);
  toast('Duplicated. You are now editing the copy.');
});
$('btnDeleteScript').addEventListener('click', async () => {
  if(!ed) return;
  if(currentEditorScript() || $('scriptBody').value.trim()){
    if(!await dialog({title:'Delete this script?', body:'This can\'t be undone.', confirm:'Delete', danger:true})) return;
  }
  clearTimeout(saveTimer);
  const id = ed.id;
  ed = null;
  saveScripts(getScripts().filter(x => x.id !== id));
  showLibrary('scripts');
});

/* ===================== BACKUP / IMPORT ===================== */
function canShareFiles(file){
  try{ return !!(navigator.canShare && navigator.canShare({files:[file]})); }
  catch(e){ return false; }
}
function downloadBlob(blob, name){
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 15000);
}
// Opens the share sheet where it exists. Returns false only when sharing was
// not possible; closing the sheet counts as handled, so it never triggers a
// surprise download.
async function shareFile(blob, name, type){
  let file = null;
  try{ file = new File([blob], name, {type}); }catch(e){}
  if(file && canShareFiles(file)){
    try{ await navigator.share({files:[file]}); return true; }
    catch(e){ if(e && e.name === 'AbortError') return true; }
  }
  return false;
}
async function exportScripts(){
  const list = getScripts();
  if(!list.length){ toast('No scripts to export yet.'); return; }
  const data = JSON.stringify({app:'promptcam', version: VERSION, exportedAt: new Date().toISOString(), scripts: list}, null, 2);
  const name = 'promptcam-scripts-' + new Date().toISOString().slice(0, 10) + '.json';
  const blob = new Blob([data], {type:'application/json'});
  if(!await shareFile(blob, name, 'application/json')) downloadBlob(blob, name);
}
function cleanScript(raw, taken){
  if(!raw || typeof raw.body !== 'string') return null;
  let id = (typeof raw.id === 'string' && /^[\w-]{1,64}$/.test(raw.id)) ? raw.id : uid();
  if(taken.has(id)) id = uid();
  taken.add(id);
  const s = {id, title: typeof raw.title === 'string' ? raw.title.slice(0, 200) : '', body: raw.body,
             updatedAt: (typeof raw.updatedAt === 'number' && isFinite(raw.updatedAt)) ? raw.updatedAt : Date.now()};
  if(typeof raw.wpm === 'number' && raw.wpm >= 60 && raw.wpm <= 300) s.wpm = raw.wpm;
  if(typeof raw.targetSec === 'number' && raw.targetSec >= 5 && raw.targetSec <= 10800) s.targetSec = Math.round(raw.targetSec);
  return s;
}
function importBackup(text){
  let data;
  try{ data = JSON.parse(text); }catch(e){ toast('That file is not a PromptCam backup.', 'error'); return; }
  const incoming = Array.isArray(data) ? data : (data && Array.isArray(data.scripts) ? data.scripts : null);
  if(!incoming){ toast('That file is not a PromptCam backup.', 'error'); return; }
  const list = getScripts();
  const taken = new Set(list.map(s => s.id));
  let added = 0;
  incoming.forEach(raw => { const s = cleanScript(raw, taken); if(s){ list.push(s); added++; } });
  if(added && !saveScripts(list)) return;
  showLibrary('scripts');
  toast(added ? 'Imported ' + added + ' script' + (added === 1 ? '' : 's') + '.' : 'No scripts found in that file.');
}
function importText(fileName, text){
  if(/\u0000/.test(text)){ toast('That doesn\'t look like a text file.', 'error'); return; }
  if(!text.trim()){ toast('That file is empty.', 'error'); return; }
  const list = getScripts();
  const s = {id: uid(), title: String(fileName || '').replace(/\.[^.]+$/, '').slice(0, 200), body: text.slice(0, 500000), updatedAt: Date.now()};
  list.push(s);
  if(!saveScripts(list)) return;
  requestPersist();
  openScript(s.id);
  toast('Imported. Check it over, then start the prompter.');
}
$('importFile').addEventListener('change', async e => {
  const f = e.target.files && e.target.files[0];
  e.target.value = '';
  if(!f) return;
  let text;
  try{ text = await f.text(); }catch(err){ toast('Could not read that file.', 'error'); return; }
  if(/\.json$/i.test(f.name) || f.type === 'application/json') importBackup(text);
  else importText(f.name, text);
});

/* ===================== PROMPTER ENGINE ===================== */
// Position is measured in words (S.pos, fractional), never pixels. Speed is
// therefore exactly words-per-minute whatever the font, screen or script
// length, and the word being read is the one drawn on the reading line.
const S = {
  sid:0, script:null, origin:'library',
  wordEls:[], wordText:[], pauses:[], mNorm:[], mMap:[], N:0, lines:[], guideY:0,
  pos:0, playing:false, scrubbing:false, holdUntil:0, holdEl:null,
  wpm:140, modeOverride:null, front:true, noCamera:false,
  ty:null, readIdx:0, raf:0, last:0, uiAt:0,
  fm:0, sr:null, srStarts:[], speakNoResult:0,
  countdown:0, capIdx:0, endTimer:0, fadeTimer:0
};

function buildPromptText(body){
  const el = $('promptText');
  el.textContent = '';
  const frag = document.createDocumentFragment();
  S.wordEls = []; S.wordText = []; S.pauses = [];
  let needSpace = false;
  for(const k of tokenize(body)){
    if(k.t === 'nl'){ frag.appendChild(document.createTextNode('\n')); needSpace = false; continue; }
    if(needSpace) frag.appendChild(document.createTextNode(' '));
    const sp = document.createElement('span');
    if(k.t === 'p'){
      sp.className = 'pauseMark';
      sp.textContent = 'pause ' + k.sec + 's';
      S.pauses.push({at: S.wordEls.length, sec: k.sec, el: sp, done: false});
    } else {
      sp.className = 'w';
      sp.textContent = k.text;
      S.wordEls.push(sp);
      S.wordText.push(k.text);
    }
    frag.appendChild(sp);
    needSpace = true;
  }
  el.appendChild(frag);
  S.N = S.wordEls.length;
  // Voice-follow matches against words with punctuation stripped; tokens that
  // are only punctuation are left out so they can't throw the alignment off.
  S.mNorm = []; S.mMap = [];
  S.wordText.forEach((w, i) => { const n = normWord(w); if(n){ S.mNorm.push(n); S.mMap.push(i); } });
}

function measure(){
  const lines = [];
  let cur = null;
  const els = S.wordEls;
  for(let i = 0; i < els.length; i++){
    const t = els[i].offsetTop;
    if(!cur || Math.abs(t - cur.top) > 2){ cur = {top: t, h: els[i].offsetHeight, start: i, count: 1}; lines.push(cur); }
    else cur.count++;
  }
  S.lines = lines;
}
function lineAt(pos){
  const L = S.lines;
  let lo = 0, hi = L.length - 1;
  while(lo < hi){ const mid = (lo + hi + 1) >> 1; if(L[mid].start <= pos) lo = mid; else hi = mid - 1; }
  return lo;
}
function lineCenter(i){ const l = S.lines[i]; return l.top + l.h / 2; }
function nextCenter(i){ return i + 1 < S.lines.length ? lineCenter(i + 1) : lineCenter(i) + S.lines[i].h * 1.36; }
// Vertical offset inside the text block that belongs on the reading line.
function yAt(pos){
  if(!S.lines.length) return 0;
  const i = lineAt(pos), l = S.lines[i];
  const c = lineCenter(i);
  return c + clamp((pos - l.start) / l.count, 0, 1) * (nextCenter(i) - c);
}
function posAtY(y){
  const L = S.lines;
  if(!L.length || y <= lineCenter(0)) return 0;
  for(let i = 0; i < L.length; i++){
    const c = lineCenter(i), cn = nextCenter(i);
    if(y < cn) return L[i].start + (y - c) / (cn - c) * L[i].count;
  }
  return S.N;
}

function applyPrompterStyle(){
  const view = $('view-prompter'), win = $('promptWindow'), text = $('promptText');
  const top = $('topBar').offsetHeight;
  const avail = Math.max(140, view.clientHeight - top);
  const h = Math.round(avail * settings.textHeight / 100);
  win.style.top = top + 'px';
  win.style.height = h + 'px';
  win.style.background = 'rgba(0,0,0,' + (settings.bgOpacity / 100) + ')';
  win.classList.toggle('dimOn', settings.dimRead);
  text.style.fontSize = settings.fontSize + 'px';
  text.style.padding = '0 ' + settings.margin + 'px';
  text.style.textAlign = settings.align === 'center' ? 'center' : 'start';
  $('promptInner').classList.toggle('mirror', settings.mirror);
  S.guideY = h * settings.guideLinePos / 100;
  $('guideLine').style.top = S.guideY + 'px';
  $('guideLine').style.height = Math.round(settings.fontSize * 1.36) + 'px';
  updateCameraMirror();
  measure();
  render(true);
}

function render(force){
  const ty = S.guideY - yAt(S.pos);
  if(force || S.ty === null || Math.abs(ty - S.ty) > 0.05){
    S.ty = ty;
    $('promptText').style.transform = 'translate3d(0,' + ty.toFixed(2) + 'px,0)';
  }
  const idx = Math.min(S.N, Math.floor(S.pos + 1e-6));
  if(force || idx !== S.readIdx){
    const a = force ? 0 : Math.min(idx, S.readIdx), b = force ? S.N : Math.max(idx, S.readIdx);
    for(let i = a; i < b; i++) S.wordEls[i].classList.toggle('read', i < idx);
    S.readIdx = idx;
  }
  const frac = S.N ? S.pos / S.N : 0;
  $('progFill').style.transform = 'scaleX(' + frac.toFixed(4) + ')';
}

function setPos(p){
  S.pos = clamp(p, 0, S.N);
  endHold();
  for(const q of S.pauses) q.done = q.at < S.pos;
  const w = Math.floor(S.pos);
  let lo = 0, hi = S.mMap.length;
  while(lo < hi){ const mid = (lo + hi) >> 1; if(S.mMap[mid] < w) lo = mid + 1; else hi = mid; }
  S.fm = lo;
  S.capIdx = w;
  clearTimeout(S.endTimer);
  render(false);
  updateTimeUI();
}
function startHold(p, t){
  S.holdUntil = t + p.sec * 1000;
  S.holdEl = p.el;
  p.el.classList.add('holding');
}
function endHold(){
  S.holdUntil = 0;
  if(S.holdEl){ S.holdEl.classList.remove('holding'); S.holdEl = null; }
}

function effMode(){
  let m = S.modeOverride || settings.mode;
  if(m === 'timed' && !(S.script && S.script.targetSec)) m = 'wpm';
  return m;
}
function pauseTotal(){ let t = 0; for(const p of S.pauses) t += p.sec; return t; }
function effWpm(){
  if(effMode() === 'timed'){
    const scrollSec = Math.max(5, S.script.targetSec - pauseTotal());
    return clamp(S.N / scrollSec * 60, 20, 600);
  }
  return S.wpm;
}
function followWord(){ return S.fm < S.mMap.length ? S.mMap[S.fm] : S.N; }
function remainingSec(){
  const mode = effMode();
  let t = (S.N - S.pos) / (effWpm() / 60);
  if(mode === 'wpm' || mode === 'timed'){
    for(const p of S.pauses) if(!p.done) t += p.sec;
    if(S.holdUntil) t += Math.max(0, (S.holdUntil - now()) / 1000);
  }
  return t;
}

function advance(dt, t){
  if(S.scrubbing) return;
  if(S.holdUntil){ if(t < S.holdUntil) return; endHold(); }
  const mode = effMode();
  let rate;
  if(mode === 'follow'){
    // Ease toward the last word heard, slightly ahead so the next words are in view.
    const diff = Math.min(S.N, followWord() + 0.5) - S.pos;
    rate = diff > 0 ? Math.min(diff * 3, effWpm() / 60 * 3 + 2) : 0;
  } else if(mode === 'voice'){
    rate = effWpm() / 60 * A.gain;
  } else {
    rate = effWpm() / 60;
  }
  let next = S.pos + rate * dt;
  if(mode === 'wpm' || mode === 'timed'){
    for(const p of S.pauses){
      if(!p.done && p.at <= next){ next = p.at; p.done = true; startHold(p, t); break; }
    }
  }
  S.pos = Math.min(next, S.N);
  if(R && !R.paused){
    const idx = Math.floor(S.pos), ms = recElapsed();
    while(S.capIdx <= idx && S.capIdx < S.N){ R.wordTimes[S.capIdx] = ms; S.capIdx++; }
  }
  if(S.pos >= S.N && !S.holdUntil) onReachedEnd();
}
function onReachedEnd(){
  setPlaying(false);
  if(R && settings.autoStop){
    clearTimeout(S.endTimer);
    S.endTimer = setTimeout(() => { if(R) stopRecording(false); }, 1500);
  }
}

function tick(ts){
  S.raf = requestAnimationFrame(tick);
  const dt = S.last ? Math.min(0.1, (ts - S.last) / 1000) : 0;
  S.last = ts;
  updateVad(dt, ts);
  if(S.playing){
    if(effMode() === 'follow' && S.sr && A.an){
      // Speech is clearly happening but recognition has gone silent: it isn't
      // working here, so stop pretending and pace by voice instead.
      if(A.speaking) S.speakNoResult += dt;
      if(S.speakNoResult > 6) followFallback();
    }
    advance(dt, ts);
  }
  render(false);
  if(ts - S.uiAt > 200){ S.uiAt = ts; updateTimeUI(); updateStatus(); }
}
function startLoop(){ if(!S.raf){ S.last = 0; S.raf = requestAnimationFrame(tick); } }
function stopLoop(){ if(S.raf){ cancelAnimationFrame(S.raf); S.raf = 0; } }

function setPlaying(on){
  on = !!on;
  if(on){
    ensureAudio();
    if(S.pos >= S.N) setPos(0);
    if(effMode() === 'voice' && !A.an){
      S.modeOverride = 'wpm';
      toast('Voice pacing needs the microphone. Using fixed speed for now.');
      updateModeUI();
    }
  }
  if(S.playing === on) return;
  S.playing = on;
  if(on){
    if(effMode() === 'follow') startFollow();
    requestWakeLock();
    armFade();
  } else {
    stopFollow();
    if(!R) releaseWakeLock();
    clearTimeout(S.fadeTimer);
    $('view-prompter').classList.remove('dimmed');
  }
  updatePlayUI();
}
function togglePlay(){
  if(S.countdown) return;
  setPlaying(!S.playing);
}

/* ---- prompter UI ---- */
function updatePlayUI(){
  const b = $('btnPlay');
  b.innerHTML = icon(S.playing ? 'pause' : 'play');
  b.setAttribute('aria-label', S.playing ? 'Pause scrolling' : (R ? 'Resume scrolling' : 'Start scrolling without recording'));
  $('capPlay').textContent = S.playing ? 'Pause' : (R ? 'Scroll' : 'Rehearse');
}
function updateModeUI(){
  const m = effMode();
  $('modePill').textContent = MODE_LABEL[m];
  $('liveSpeed').value = S.wpm;
  $('speedRow').classList.toggle('noSlider', !(m === 'wpm' || m === 'voice'));
  $('speedLabel').textContent =
    m === 'timed' ? fmtTime(S.script.targetSec) + ' · ' + Math.round(effWpm()) + ' wpm' :
    m === 'follow' ? 'Follows your voice' :
    m === 'voice' ? 'up to ' + S.wpm + ' wpm' : S.wpm + ' wpm';
  $('btnSheetTarget').textContent = 'Target time: ' + (S.script && S.script.targetSec ? fmtTime(S.script.targetSec) : 'off');
  updateTimeUI();
}
function updateTimeUI(){
  if(!S.script) return;
  $('timeLeft').textContent = S.pos >= S.N ? 'End of script' : fmtTime(remainingSec()) + ' left';
  $('progBar').setAttribute('aria-valuenow', S.N ? Math.round(S.pos / S.N * 100) : 0);
}
function updateStatus(){
  const pill = $('statusPill');
  if(R){
    pill.hidden = false;
    $('recDot').hidden = false;
    pill.classList.toggle('paused', R.paused);
    $('statusText').textContent = (R.paused ? 'Paused ' : '') + fmtTime(recElapsed() / 1000) + ' · ' + fmtBytes(R.bytes);
  } else if(cam.busy){
    pill.hidden = false;
    pill.classList.remove('paused');
    $('recDot').hidden = true;
    $('statusText').textContent = 'Starting camera…';
  } else {
    pill.hidden = true;
  }
  $('micMeter').hidden = !A.an;
  if(A.an) $('micFill').style.transform = 'scaleX(' + clamp(A.level * 7, 0, 1).toFixed(3) + ')';
}
// Controls only dim while the script is actually moving. Before that they
// stay fully visible, since that is when you are looking for them.
function armFade(){
  clearTimeout(S.fadeTimer);
  const view = $('view-prompter');
  view.classList.remove('dimmed');
  if(!S.playing) return;
  S.fadeTimer = setTimeout(() => {
    if(S.playing && $('quickSheet').hidden && !S.countdown) view.classList.add('dimmed');
  }, 4000);
}
function setSpeed(v, persist){
  S.wpm = clamp(Math.round(v / 5) * 5, 60, 300);
  updateModeUI();
  if(persist && S.script) patchScript(S.script.id, {wpm: S.wpm});
}
function jumpLines(n){
  if(!S.lines.length) return;
  setPos(S.lines[clamp(lineAt(S.pos) + n, 0, S.lines.length - 1)].start);
}

function openSheet(){
  $('sheetBody').innerHTML = SHEET_KEYS.map(k => controlHtml(DEF[k], 'sh')).join('');
  $('quickSheet').hidden = false;
  $('view-prompter').classList.remove('dimmed');
}
function closeSheet(){ $('quickSheet').hidden = true; armFade(); }
async function onModeChosen(){
  S.modeOverride = null;
  if(settings.mode === 'timed' && !S.script.targetSec){
    const sid = S.sid;
    const ok = await askTarget(S.script.id);
    if(sid !== S.sid) return;
    if(ok) S.script = getScripts().find(x => x.id === S.script.id) || S.script;
    else {
      settings.mode = 'wpm';
      lsSet(K.settings, settings);
      if(!$('quickSheet').hidden) openSheet();
    }
  }
  stopFollow();
  if(S.playing){
    if(effMode() === 'follow') startFollow();
    if(effMode() === 'voice' && !A.an){ S.modeOverride = 'wpm'; toast('Voice pacing needs the microphone. Using fixed speed for now.'); }
  }
  updateModeUI();
}

async function startPrompter(id, origin){
  const s = getScripts().find(x => x.id === id);
  if(!s || !scriptStats(s.body).words){ toast('This script is empty. Add some text first.'); return; }
  const sid = ++S.sid;
  S.script = s;
  S.origin = origin || 'library';
  S.wpm = clamp(Math.round((Number(s.wpm) || settings.speed) / 5) * 5, 60, 300);
  S.modeOverride = null;
  S.front = settings.frontCamera;
  S.noCamera = false;
  S.pos = 0; S.playing = false; S.scrubbing = false; S.ty = null; S.readIdx = 0; S.speakNoResult = 0;
  cancelCountdown();
  hideCamError();
  $('quickSheet').hidden = true;
  $('view-prompter').classList.remove('dimmed');
  buildPromptText(s.body);
  show('view-prompter');
  applyPrompterStyle();
  setPos(0);
  render(true);
  updateModeUI();
  updatePlayUI();
  updateRecordUI();
  updateStatus();
  startLoop();
  if(!lsGet(K.primed, false)){
    const ok = await dialog({
      title:'Camera and microphone',
      body:'PromptCam records you while you read, so it needs the camera and microphone. Your browser will ask next. Video stays on this device.',
      confirm:'Continue', cancel:'Not now'
    });
    if(sid !== S.sid) return;
    if(!ok){ showCamError({name:'Declined'}); return; }
    lsSet(K.primed, true);
  }
  initCamera();
}

// Everything that must stop when the prompter screen is left, by any route.
function teardownPrompter(){
  S.sid++;
  cancelCountdown();
  clearTimeout(S.endTimer);
  clearTimeout(S.fadeTimer);
  S.playing = false;
  stopFollow();
  stopLoop();
  $('quickSheet').hidden = true;
  $('view-prompter').classList.remove('dimmed');
  hideCamError();
  cam.token++;
  cam.busy = false;
  stopCamera();
  closeAudio();
  releaseWakeLock();
}
async function exitPrompter(){
  if(R){
    const ok = await dialog({
      title:'Discard this recording?',
      body:'You are still recording. Leaving now throws this take away.',
      confirm:'Discard', cancel:'Keep recording', danger:true
    });
    if(!ok || !isView('prompter')) return;
    stopRecording(true);
  }
  const origin = S.origin, id = S.script && S.script.id;
  teardownPrompter();
  if(origin === 'editor' && id && getScripts().some(x => x.id === id)) openScript(id);
  else showLibrary('scripts');
}

/* ===================== PACING BY VOICE ===================== */
// Voice-paced: a simple voice-activity detector on the microphone. It adapts
// to the room's background level, so it needs no calibration step.
const A = {ctx:null, an:null, src:null, srcStream:null, buf:null, floor:0.01, level:0, lastSpeech:0, speaking:false, gain:0};
function ensureAudio(){
  const AC = window.AudioContext || window.webkitAudioContext;
  if(!AC) return;
  try{
    if(!A.ctx) A.ctx = new AC();
    if(A.ctx.state === 'suspended') A.ctx.resume().catch(() => {});
  }catch(e){ return; }
  attachAnalyser();
}
function attachAnalyser(){
  if(!A.ctx || !cam.stream || A.srcStream === cam.stream) return;
  detachAnalyser();
  if(!cam.stream.getAudioTracks().length) return;
  try{
    A.src = A.ctx.createMediaStreamSource(cam.stream);
    A.an = A.ctx.createAnalyser();
    A.an.fftSize = 1024;
    A.buf = new Uint8Array(A.an.fftSize);
    A.src.connect(A.an);
    A.srcStream = cam.stream;
  }catch(e){ A.an = null; A.src = null; A.srcStream = null; }
}
function detachAnalyser(){
  try{ if(A.src) A.src.disconnect(); }catch(e){}
  A.src = null; A.an = null; A.srcStream = null; A.level = 0; A.speaking = false; A.gain = 0;
}
function closeAudio(){
  detachAnalyser();
  if(A.ctx){ try{ A.ctx.close().catch(() => {}); }catch(e){} A.ctx = null; }
}
function updateVad(dt, t){
  if(!A.an){ A.speaking = false; A.gain = 0; return; }
  A.an.getByteTimeDomainData(A.buf);
  let sum = 0;
  for(let i = 0; i < A.buf.length; i++){ const v = (A.buf[i] - 128) / 128; sum += v * v; }
  const rms = Math.sqrt(sum / A.buf.length);
  A.level = Math.max(rms, A.level * 0.86);
  // The floor drops quickly to quiet and creeps up slowly, so speech itself
  // doesn't get mistaken for background noise.
  A.floor += (rms - A.floor) * (rms < A.floor ? 0.25 : 0.003);
  A.floor = clamp(A.floor, 0.002, 0.08);
  if(rms > Math.max(0.014, A.floor * 3)) A.lastSpeech = t;
  A.speaking = (t - A.lastSpeech) < 450;
  A.gain += ((A.speaking ? 1 : 0) - A.gain) * Math.min(1, dt * (A.speaking ? 8 : 5));
}

// Voice-follow: speech recognition, where the browser offers it.
function speechLang(){ return settings.lang === 'auto' ? (navigator.language || 'en-US') : settings.lang; }
function startFollow(){
  stopFollow();
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  if(!SR){ followFallback(); return; }
  S.speakNoResult = 0;
  try{
    const rec = new SR();
    rec.continuous = true;
    rec.interimResults = true;
    rec.lang = speechLang();
    rec.onresult = e => { if(S.sr === rec) onSpeech(e); };
    rec.onerror = e => {
      if(S.sr !== rec) return;
      if(e && (e.error === 'no-speech' || e.error === 'aborted')) return;
      followFallback();
    };
    rec.onend = () => {
      if(S.sr !== rec) return;
      // Recognition ends on its own every so often; restart it, but give up
      // if it keeps dying immediately.
      const t = now();
      S.srStarts = S.srStarts.filter(x => t - x < 5000);
      S.srStarts.push(t);
      if(S.srStarts.length > 5){ followFallback(); return; }
      try{ rec.start(); }catch(err){ followFallback(); }
    };
    S.sr = rec;
    rec.start();
  }catch(e){ followFallback(); }
}
function stopFollow(){
  const rec = S.sr;
  S.sr = null;
  if(rec){ try{ rec.onresult = rec.onerror = rec.onend = null; rec.stop(); }catch(e){} }
}
function followFallback(){
  stopFollow();
  if(effMode() !== 'follow') return;
  if(A.an){
    S.modeOverride = 'voice';
    toast('Word-by-word follow isn\'t working in this browser right now. Switched to Voice-paced.', null, 6000);
  } else {
    S.modeOverride = 'wpm';
    toast('Voice-follow isn\'t available here. Using fixed speed.', null, 6000);
  }
  updateModeUI();
}
function onSpeech(e){
  S.speakNoResult = 0;
  let text = '';
  for(let i = e.resultIndex; i < e.results.length; i++) text += ' ' + e.results[i][0].transcript;
  const tail = text.split(/\s+/).map(normWord).filter(Boolean).slice(-6);
  if(!tail.length) return;
  const M = S.mNorm, cur = S.fm, last = tail[tail.length - 1];
  const to = Math.min(M.length, cur + 45);
  let best = -1, bestScore = -Infinity;
  // Find where the last few spoken words line up with the script, looking a
  // little behind and some way ahead. One matching word is only trusted for
  // the next word or two; anything further needs at least two in sequence.
  for(let i = Math.max(0, cur - 3); i < to; i++){
    if(M[i] !== last) continue;
    let run = 1;
    for(let k = 1; k < tail.length && i - k >= 0; k++){ if(M[i - k] === tail[tail.length - 1 - k]) run++; }
    const ahead = i + 1 - cur;
    if(run < ((ahead >= 1 && ahead <= 2) ? 1 : 2)) continue;
    const score = run - Math.abs(ahead) * 0.05;
    if(score > bestScore){ bestScore = score; best = i; }
  }
  if(best >= 0 && best + 1 > cur) S.fm = best + 1;
}

/* ===================== CAMERA ===================== */
const cam = {stream:null, token:0, busy:false};
function camErrorText(e){
  switch(e && e.name){
    case 'Declined': return 'Camera is off. You can still rehearse the script, or turn the camera on to record.';
    case 'NotAllowedError': case 'SecurityError':
      return 'Camera or microphone access is blocked. Allow both for this site in your browser settings (on iPhone: Settings, then Safari, then Camera and Microphone), then try again.';
    case 'NotFoundError': case 'OverconstrainedError': return 'No camera or microphone was found on this device.';
    case 'NotReadableError': case 'AbortError': return 'The camera is busy, probably in another app or tab. Close that and try again.';
    case 'Insecure': return 'The camera only works on a secure (https) address. Open the site from its https link.';
    case 'Interrupted': return 'The camera was interrupted.';
    default: return 'The camera could not be started.';
  }
}
function showCamError(e){
  if(S.noCamera && (!e || e.name !== 'Interrupted')) return;
  $('camErrorMsg').textContent = camErrorText(e);
  $('camError').hidden = false;
  updateRecordUI();
}
function hideCamError(){ $('camError').hidden = true; }
function updateCameraMirror(){
  let front = S.front;
  const track = cam.stream && cam.stream.getVideoTracks()[0];
  try{
    const fm = track && track.getSettings && track.getSettings().facingMode;
    if(fm) front = fm === 'user';
  }catch(e){}
  $('camera').classList.toggle('mirrored', front && settings.mirrorPreview);
}
async function initCamera(){
  const my = ++cam.token;
  stopCamera();
  hideCamError();
  cam.busy = true;
  updateStatus();
  try{
    if(!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) throw {name:'Insecure'};
    const q = settings.quality === '720' ? {w:1280, h:720} : {w:1920, h:1080};
    const stream = await navigator.mediaDevices.getUserMedia({
      video:{facingMode: S.front ? 'user' : 'environment', width:{ideal:q.w}, height:{ideal:q.h}, frameRate:{ideal:30}},
      audio:{echoCancellation:false, noiseSuppression:true, autoGainControl:true}
    });
    // If the user left, flipped again or retried while this was pending, this
    // stream belongs to nobody: stop it rather than leave the camera on.
    if(my !== cam.token || !isView('prompter')){ stream.getTracks().forEach(t => t.stop()); return false; }
    cam.stream = stream;
    cam.busy = false;
    stream.getTracks().forEach(t => t.addEventListener('ended', () => onTrackEnded(stream)));
    const video = $('camera');
    video.srcObject = stream;
    try{ await video.play(); }catch(e){}
    attachAnalyser();
    updateTorch();
    updateCameraMirror();
    updateRecordUI();
    updateStatus();
    return true;
  }catch(e){
    if(my !== cam.token) return false;
    cam.busy = false;
    updateStatus();
    showCamError(e);
    return false;
  }
}
function stopCamera(){
  if(cam.stream){ cam.stream.getTracks().forEach(t => t.stop()); cam.stream = null; }
  detachAnalyser();
  const video = $('camera');
  if(video.srcObject) video.srcObject = null;
  torchOn = false;
  $('btnTorch').hidden = true;
}
function onTrackEnded(stream){
  if(stream !== cam.stream) return;
  if(R) stopRecording(false);   // keep whatever was captured
  else if(isView('prompter')){ stopCamera(); showCamError({name:'Interrupted'}); }
}
function flipCamera(){
  if(R){ toast('The camera can\'t be switched while recording.'); return; }
  if(cam.busy) return;
  const prev = S.front;
  S.front = !S.front;
  S.noCamera = false;
  initCamera().then(ok => { if(!ok && S.front !== prev && !cam.busy) S.front = prev; });
}
let torchOn = false;
function updateTorch(){
  torchOn = false;
  let supported = false;
  try{
    const track = cam.stream && cam.stream.getVideoTracks()[0];
    const caps = track && track.getCapabilities ? track.getCapabilities() : null;
    supported = !!(caps && caps.torch);
  }catch(e){}
  const b = $('btnTorch');
  b.hidden = !supported;
  b.classList.remove('active');
  b.setAttribute('aria-pressed', 'false');
}
function toggleTorch(){
  const track = cam.stream && cam.stream.getVideoTracks()[0];
  if(!track) return;
  const want = !torchOn;
  track.applyConstraints({advanced:[{torch: want}]}).then(() => {
    torchOn = want;
    $('btnTorch').classList.toggle('active', want);
    $('btnTorch').setAttribute('aria-pressed', want);
  }).catch(() => toast('The torch isn\'t available on this camera.'));
}

let wakeLock = null;
async function requestWakeLock(){
  if(wakeLock || !('wakeLock' in navigator)) return;
  try{
    const wl = await navigator.wakeLock.request('screen');
    wakeLock = wl;
    wl.addEventListener('release', () => { if(wakeLock === wl) wakeLock = null; });
  }catch(e){}
}
function releaseWakeLock(){
  const wl = wakeLock;
  wakeLock = null;
  if(wl){ try{ wl.release().catch(() => {}); }catch(e){} }
}

/* ===================== RECORDING ===================== */
let R = null;   // the recording in progress, or null
function recElapsed(){
  if(!R) return 0;
  const t = now();
  return t - R.startTs - R.pausedMs - (R.paused ? t - R.pauseStart : 0);
}
function pickMime(){
  if(!window.MediaRecorder || !MediaRecorder.isTypeSupported) return '';
  for(const c of ['video/mp4', 'video/webm;codecs=vp9,opus', 'video/webm;codecs=vp8,opus', 'video/webm']){
    try{ if(MediaRecorder.isTypeSupported(c)) return c; }catch(e){}
  }
  return '';
}
function runCountdown(sec, done){
  cancelCountdown();
  const sid = S.sid;
  let n = sec;
  $('countNum').textContent = n;
  $('countdownOverlay').hidden = false;
  $('btnRecord').classList.add('arming');
  S.countdown = setInterval(() => {
    n--;
    if(n > 0){ $('countNum').textContent = n; return; }
    cancelCountdown();
    if(sid === S.sid && isView('prompter')) done();
  }, 1000);
}
function cancelCountdown(){
  if(S.countdown){ clearInterval(S.countdown); S.countdown = 0; }
  $('countdownOverlay').hidden = true;
  $('btnRecord').classList.remove('arming');
}
function toggleRecording(){
  if(R){ stopRecording(false); return; }
  if(S.countdown){ cancelCountdown(); return; }
  if(!cam.stream){
    // Starting now would scroll the script and look like a recording while
    // capturing nothing.
    toast(cam.busy ? 'The camera is still starting. Give it a moment.' : 'The camera isn\'t on, so there is nothing to record. Tap "Try again" to turn it on.');
    if(!cam.busy && $('camError').hidden){ S.noCamera = false; showCamError({name:'Declined'}); }
    return;
  }
  ensureAudio();
  const go = () => {
    if(!cam.stream){ toast('The camera stopped before recording could start.', 'error'); return; }
    if(!startRecording()) return;
    if(S.pos >= S.N) setPos(0);
    setPlaying(true);
  };
  if(settings.countdown > 0) runCountdown(settings.countdown, go); else go();
}
function startRecording(){
  if(!window.MediaRecorder){ toast('This browser can\'t record video.', 'error'); return false; }
  const mime = pickMime();
  const bits = settings.quality === '720' ? 2500000 : 5000000;
  let rec;
  try{
    const opts = {videoBitsPerSecond: bits, audioBitsPerSecond: 128000};
    if(mime) opts.mimeType = mime;
    rec = new MediaRecorder(cam.stream, opts);
  }catch(e){
    try{ rec = new MediaRecorder(cam.stream); }
    catch(e2){ toast('Recording could not start in this browser.', 'error'); return false; }
  }
  const r = {
    rec, mime, chunks:[], bytes:0, startTs: now(), pausedMs:0, pauseStart:0, paused:false,
    discard:false, done:false, stopping:false, warned:false, durationMs:null,
    scriptId: S.script.id, title: S.script.title || 'Untitled script', words: S.wordText.slice(), wordTimes:[]
  };
  rec.ondataavailable = ev => {
    if(!ev.data || !ev.data.size) return;
    r.chunks.push(ev.data);
    r.bytes += ev.data.size;
    if(!r.warned && r.bytes > 700 * 1048576){
      r.warned = true;
      toast('This take is getting very large. Stop soon so it can be saved safely.', 'error', 8000);
    }
  };
  rec.onstop = () => onRecorderStop(r);
  rec.onerror = () => { toast('The recorder hit a problem. Saving what was captured.', 'error'); stopRecording(false); };
  try{ rec.start(1000); }
  catch(e){ toast('Recording could not start.', 'error'); return false; }
  R = r;
  S.capIdx = Math.floor(S.pos);
  requestWakeLock();
  updateRecordUI();
  updateStatus();
  return true;
}
function stopRecording(discard){
  const r = R;
  if(!r) return;
  if(discard) r.discard = true;
  if(r.durationMs === null) r.durationMs = recElapsed();
  clearTimeout(S.endTimer);
  // A discarded take is detached at once so nothing can pick it back up.
  if(discard){ R = null; updateRecordUI(); updateStatus(); }
  if(r.stopping) return;
  r.stopping = true;
  let asked = false;
  try{ if(r.rec.state !== 'inactive'){ r.rec.stop(); asked = true; } }catch(e){}
  // The recorder delivers its last chunk and then its stop event. Wait for
  // that rather than finishing early and losing the final second; the timer
  // only matters if the browser never sends the event.
  setTimeout(() => onRecorderStop(r), asked ? 4000 : 800);
}
// Runs exactly once per recording, however it ended: the stop button, the
// camera being interrupted, the app going to the background, or an error.
function onRecorderStop(r){
  if(r.done) return;
  r.done = true;
  if(r.durationMs === null) r.durationMs = (R === r) ? recElapsed() : 0;
  if(R === r) R = null;
  updateRecordUI();
  updateStatus();
  if(r.discard){ r.chunks = []; return; }
  finishTake(r);
}
function toggleRecPause(){
  const r = R;
  if(!r || typeof r.rec.pause !== 'function') return;
  try{
    if(r.paused){ r.rec.resume(); r.pausedMs += now() - r.pauseStart; r.paused = false; }
    else { r.rec.pause(); r.pauseStart = now(); r.paused = true; setPlaying(false); }
  }catch(e){ toast('Pausing isn\'t supported in this browser.'); }
  updateRecordUI();
  updateStatus();
}
function updateRecordUI(){
  const b = $('btnRecord');
  b.classList.toggle('recording', !!R);
  b.setAttribute('aria-label', R ? 'Stop recording' : 'Start recording');
  b.style.opacity = (!R && !cam.stream && !cam.busy) ? '.45' : '';
  const p = $('btnRecPause');
  p.disabled = !R;
  p.innerHTML = icon(R && R.paused ? 'play' : 'pause');
  p.setAttribute('aria-label', R && R.paused ? 'Resume recording' : 'Pause recording');
  $('capRecPause').textContent = R && R.paused ? 'Resume rec' : 'Hold rec';
  $('capRecord').textContent = R ? 'Stop' : 'Record';
  $('btnFlip').disabled = !!R;
  updatePlayUI();
}

function srtTime(ms){
  ms = Math.max(0, Math.round(ms));
  return pad2(Math.floor(ms / 3600000)) + ':' + pad2(Math.floor(ms % 3600000 / 60000)) + ':' + pad2(Math.floor(ms % 60000 / 1000)) + ',' + String(ms % 1000).padStart(3, '0');
}
// Captions timed from when each word crossed the reading line during the take.
function buildSrt(r){
  const times = r.wordTimes, words = r.words, cues = [];
  let i = 0;
  while(i < words.length && times[i] !== undefined){
    let j = i, n = 0;
    while(j < words.length && times[j] !== undefined){
      n++;
      const w = words[j];
      j++;
      if(n >= 7 || /[.!?…]["')\]]?$/.test(w) || (n >= 4 && /[,;:]$/.test(w))) break;
    }
    cues.push({start: times[i], text: words.slice(i, j).join(' '), n: j - i});
    i = j;
  }
  if(!cues.length) return '';
  const total = r.durationMs || Infinity;
  return cues.map((c, k) => {
    const next = cues[k + 1] ? cues[k + 1].start : c.start + c.n * 450 + 400;
    const end = Math.max(c.start + 300, Math.min(next, c.start + 7000, total));
    return (k + 1) + '\n' + srtTime(c.start) + ' --> ' + srtTime(end) + '\n' + c.text + '\n';
  }).join('\n');
}

/* ===================== TAKES ===================== */
// Finished videos are kept in the browser's database so leaving the review
// screen never throws one away.
let dbPromise = null;
const memTakes = [];   // takes that could not be written to the database
function db(){
  if(dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    let rq;
    try{ rq = indexedDB.open('promptcam', 1); }catch(e){ reject(e); return; }
    rq.onupgradeneeded = () => { if(!rq.result.objectStoreNames.contains('takes')) rq.result.createObjectStore('takes', {keyPath:'id'}); };
    rq.onsuccess = () => resolve(rq.result);
    rq.onerror = () => reject(rq.error);
    rq.onblocked = () => reject(new Error('blocked'));
  });
  dbPromise.catch(() => { dbPromise = null; });
  return dbPromise;
}
function takesTx(mode, fn){
  return db().then(d => new Promise((resolve, reject) => {
    const t = d.transaction('takes', mode);
    const rq = fn(t.objectStore('takes'));
    let out;
    if(rq) rq.onsuccess = () => { out = rq.result; };
    t.oncomplete = () => resolve(out);
    t.onerror = () => reject(t.error);
    t.onabort = () => reject(t.error || new Error('aborted'));
  }));
}
function takesPut(take){ return takesTx('readwrite', st => st.put(take)); }
function takesDelete(id){
  const i = memTakes.findIndex(t => t.id === id);
  if(i >= 0){ memTakes.splice(i, 1); return Promise.resolve(); }
  return takesTx('readwrite', st => st.delete(id));
}
async function takesAll(){
  let stored = [];
  try{ stored = await takesTx('readonly', st => st.getAll()) || []; }catch(e){}
  return memTakes.concat(stored).sort((a, b) => b.createdAt - a.createdAt);
}
function baseMime(m){ return String(m || '').split(';')[0].trim() || 'video/webm'; }
function takeName(t, ext){
  const d = new Date(t.createdAt);
  const stamp = d.getFullYear() + pad2(d.getMonth() + 1) + pad2(d.getDate()) + '-' + pad2(d.getHours()) + pad2(d.getMinutes());
  return 'promptcam-' + slug(t.title) + '-' + stamp + '.' + (ext || (t.type.includes('mp4') ? 'mp4' : 'webm'));
}

async function finishTake(r){
  const type = baseMime(r.rec.mimeType || r.mime);
  const blob = new Blob(r.chunks, {type});
  r.chunks = [];
  if(!blob.size){
    toast('Nothing was recorded. Try again.', 'error');
    if(isView('prompter')) setPlaying(false);
    return;
  }
  const take = {id: uid(), scriptId: r.scriptId, title: r.title, createdAt: Date.now(),
                durationMs: Math.round(r.durationMs || 0), size: blob.size, type, blob, srt: buildSrt(r)};
  if(isView('prompter')) teardownPrompter();
  openReview(take);
  try{
    await takesPut(take);
    requestPersist();
    setReviewNote('Kept in Takes on this device. Save it to Photos or Files for a permanent copy.');
  }catch(e){
    memTakes.unshift(take);
    setReviewNote('This device is out of space for Takes. Save this video now, or it will be gone when the app closes.');
    toast('Couldn\'t keep this take in Takes. Save it now.', 'error', 8000);
  }
}

async function renderTakes(){
  const el = $('takeList');
  const list = await takesAll();
  if(libTab !== 'takes') return;
  if(!list.length){
    $('takesInfo').textContent = '';
    el.innerHTML = '<div class="emptyState">No takes yet.<br>Every recording you make is kept here until you delete it.</div>';
    return;
  }
  const total = list.reduce((n, t) => n + (t.size || 0), 0);
  $('takesInfo').textContent = list.length + ' take' + (list.length === 1 ? '' : 's') + ' using ' + fmtBytes(total) +
    ' on this device. Delete ones you have already saved elsewhere to free space.';
  el.innerHTML = list.map(t =>
    '<div class="card" data-id="' + esc(t.id) + '"><button class="cardMain" data-act="open"><h3>' + esc(t.title || 'Untitled script') + '</h3>' +
    '<p>' + esc(fmtDate(t.createdAt)) + ' · ' + fmtTime((t.durationMs || 0) / 1000) + ' · ' + fmtBytes(t.size || 0) + '</p></button></div>').join('');
}
$('takeList').addEventListener('click', async e => {
  const card = e.target.closest('.card');
  if(!card) return;
  const take = (await takesAll()).find(t => t.id === card.dataset.id);
  if(take && take.blob) openReview(take);
  else { toast('That take could not be opened.', 'error'); renderTakes(); }
});

/* ===================== REVIEW ===================== */
const RV = {take:null, url:null};
function setReviewNote(text){ if(isView('review')) $('reviewNote').textContent = text; }
function openReview(take){
  releaseReview();
  RV.take = take;
  RV.url = URL.createObjectURL(take.blob);
  $('reviewVideo').src = RV.url;
  $('reviewTitle').textContent = take.title || 'Untitled script';
  $('btnCaptions').hidden = !take.srt;
  $('btnRetake').hidden = !getScripts().some(s => s.id === take.scriptId);
  show('view-review');
  $('reviewNote').textContent = fmtDate(take.createdAt) + ' · ' + fmtTime((take.durationMs || 0) / 1000) + ' · ' + fmtBytes(take.size || 0);
}
function releaseReview(){
  const v = $('reviewVideo');
  try{ v.pause(); }catch(e){}
  v.removeAttribute('src');
  try{ v.load(); }catch(e){}
  if(RV.url) URL.revokeObjectURL(RV.url);
  RV.take = null; RV.url = null;
}
// Back keeps the take; only the Delete button removes it.
function closeReview(){ releaseReview(); showLibrary('takes'); }
$('btnReviewBack').addEventListener('click', closeReview);
$('btnSavePhotos').addEventListener('click', async () => {
  const t = RV.take;
  if(!t) return;
  if(await shareFile(t.blob, takeName(t), t.type)) return;
  downloadBlob(t.blob, takeName(t));
  toast('Downloaded. On iPhone, open it in the Files app and choose Save Video to put it in Photos.', null, 7000);
});
$('btnSaveFiles').addEventListener('click', () => {
  const t = RV.take;
  if(!t) return;
  downloadBlob(t.blob, takeName(t));
  toast('Downloading. Look in your Downloads or the Files app.');
});
$('btnCaptions').addEventListener('click', async () => {
  const t = RV.take;
  if(!t || !t.srt) return;
  const blob = new Blob([t.srt], {type:'text/plain'});
  const name = takeName(t, 'srt');
  if(!await shareFile(blob, name, 'text/plain')) downloadBlob(blob, name);
});
$('btnRetake').addEventListener('click', () => {
  const t = RV.take;
  if(!t) return;
  releaseReview();
  startPrompter(t.scriptId, 'library');
});
$('btnDeleteTake').addEventListener('click', async () => {
  const t = RV.take;
  if(!t) return;
  if(!await dialog({title:'Delete this take?', body:'The video is removed from this device. Copies you already saved to Photos or Files are not affected.', confirm:'Delete', danger:true})) return;
  try{ await takesDelete(t.id); }catch(e){ toast('Could not delete that take.', 'error'); return; }
  closeReview();
});

/* ===================== INPUT ===================== */
$('btnExit').addEventListener('click', exitPrompter);
$('btnFlip').addEventListener('click', flipCamera);
$('btnTorch').addEventListener('click', toggleTorch);
$('btnPlay').addEventListener('click', togglePlay);
$('btnRecord').addEventListener('click', toggleRecording);
$('btnRecPause').addEventListener('click', toggleRecPause);
$('btnRestart').addEventListener('click', () => setPos(0));
$('btnSheet').addEventListener('click', openSheet);
$('modePill').addEventListener('click', openSheet);
$('btnSheetClose').addEventListener('click', closeSheet);
$('btnSheetTarget').addEventListener('click', async () => {
  const sid = S.sid;
  await askTarget(S.script.id);
  if(sid !== S.sid) return;
  S.script = getScripts().find(x => x.id === S.script.id) || S.script;
  updateModeUI();
});
$('countdownOverlay').addEventListener('click', () => { cancelCountdown(); toast('Countdown cancelled.'); });
$('btnCamRetry').addEventListener('click', () => { S.noCamera = false; initCamera(); });
$('btnCamSkip').addEventListener('click', () => { S.noCamera = true; hideCamError(); });
$('liveSpeed').addEventListener('input', e => setSpeed(Number(e.target.value), false));
$('liveSpeed').addEventListener('change', e => setSpeed(Number(e.target.value), true));
$('btnSlower').addEventListener('click', () => setSpeed(S.wpm - 5, true));
$('btnFaster').addEventListener('click', () => setSpeed(S.wpm + 5, true));
$('btnDismissWarn').addEventListener('click', () => { lsSet(K.warn, 1); $('browserWarning').hidden = true; });

// Any touch on the camera screen brings the controls back and, on iOS, is the
// user gesture the microphone analyser needs before it will run.
$('view-prompter').addEventListener('pointerdown', () => { armFade(); ensureAudio(); });
// A mouse click leaves focus on the button; drop it so Space keeps meaning
// "play/pause" rather than re-pressing whatever was clicked last.
$('view-prompter').addEventListener('click', e => {
  const b = e.target.closest('button');
  if(b && e.detail > 0) b.blur();
});

// Drag the text to move through the script by hand.
(function(){
  const win = $('promptWindow');
  let st = null;
  win.addEventListener('pointerdown', e => {
    if(!S.N) return;
    st = {id: e.pointerId, y: e.clientY, y0: yAt(S.pos), moved: false};
    try{ win.setPointerCapture(e.pointerId); }catch(err){}
  });
  win.addEventListener('pointermove', e => {
    if(!st || e.pointerId !== st.id) return;
    const dy = e.clientY - st.y;
    if(!st.moved && Math.abs(dy) < 6) return;
    st.moved = true;
    S.scrubbing = true;
    setPos(posAtY(st.y0 - dy));
  });
  const end = e => {
    if(!st || e.pointerId !== st.id) return;
    st = null;
    S.scrubbing = false;
  };
  win.addEventListener('pointerup', end);
  win.addEventListener('pointercancel', end);
})();

// Keyboard, which also covers Bluetooth keyboards, clickers and foot pedals.
document.addEventListener('keydown', e => {
  if(e.key === 'Escape'){
    if(dlg || !$('quickSheet').hidden || isView('prompter') || isView('review')){ e.preventDefault(); handleBack(); }
    return;
  }
  if(!isView('prompter') || dlg || e.ctrlKey || e.metaKey || e.altKey) return;
  const tag = e.target && e.target.tagName;
  if(tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
  if(tag === 'BUTTON' && (e.key === ' ' || e.key === 'Enter')) return;
  let used = true;
  switch(e.key){
    case ' ': case 'Enter': case 'PageDown': togglePlay(); break;
    case 'r': case 'R': toggleRecording(); break;
    case 'ArrowUp': setSpeed(S.wpm + 5, true); break;
    case 'ArrowDown': setSpeed(S.wpm - 5, true); break;
    case 'ArrowLeft': case 'PageUp': jumpLines(-1); break;
    case 'ArrowRight': jumpLines(1); break;
    case 'Home': setPos(0); break;
    default: used = false;
  }
  if(used){ e.preventDefault(); armFade(); }
});

document.addEventListener('visibilitychange', () => {
  if(document.hidden){
    flushSave();
    if(isView('prompter')){
      cancelCountdown();
      if(R) stopRecording(false); else setPlaying(false);
    }
  } else if(isView('prompter') && (S.playing || R)) requestWakeLock();
});
window.addEventListener('pagehide', flushSave);

/* ===================== STARTUP ===================== */
function isStandalone(){
  return window.navigator.standalone === true || (window.matchMedia && window.matchMedia('(display-mode: standalone)').matches);
}
function isIOS(){
  return /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
}
function checkBrowserWarning(){
  if(!isIOS() || isStandalone() || lsGet(K.warn, 0)) return;
  const box = $('browserWarning');
  box.querySelector('p').textContent = /CriOS|FxiOS|EdgiOS/.test(navigator.userAgent)
    ? 'On iPhone only Safari can run this full screen. In this browser the address bar and toolbar stay on screen and can cover the controls. Open this link in Safari, then use Share and Add to Home Screen.'
    : 'For a full-screen view with no browser bars, tap Share, then Add to Home Screen, and open PromptCam from that icon.';
  box.hidden = false;
}
function initServiceWorker(){
  if(!('serviceWorker' in navigator) || !/^https?:$/.test(location.protocol)) return;
  let reloading = false, offered = false;
  navigator.serviceWorker.addEventListener('controllerchange', () => { if(reloading) location.reload(); });
  const offer = reg => {
    if(offered) return;
    if(!isView('library')){ pendingUpdate = () => offer(reg); return; }
    offered = true;
    toast('A new version is ready.', null, 0, {label:'Reload', fn: () => {
      reloading = true;
      if(reg.waiting) reg.waiting.postMessage({type:'SKIP_WAITING'}); else location.reload();
    }});
  };
  navigator.serviceWorker.register('sw.js', {updateViaCache:'none'}).then(reg => {
    if(reg.waiting && navigator.serviceWorker.controller) offer(reg);
    reg.addEventListener('updatefound', () => {
      const w = reg.installing;
      if(!w) return;
      w.addEventListener('statechange', () => { if(w.state === 'installed' && navigator.serviceWorker.controller) offer(reg); });
    });
  }).catch(() => {});
}

document.querySelectorAll('[data-icon]').forEach(el => { el.innerHTML = icon(el.dataset.icon); });
try{ history.replaceState({pc:0}, ''); history.pushState({pc:1}, ''); }catch(e){}
renderLibrary();
checkBrowserWarning();
initServiceWorker();
