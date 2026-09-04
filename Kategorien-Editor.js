// Variables used by Scriptable.
// These must be at the very top of the file. Do not edit.
// icon-color: deep-green; icon-glyph: edit;

/**
 * Editor.js 3.2 — nativer Kategorien-Editor für comdirect Manager
 *
 * Bearbeitet:
 *   Scriptable/comdirect/categories.json
 *
 * Funktionen:
 * - Native UITable-Vollbildoberfläche für iPhone und iPad
 * - Kategorien hinzufügen / umbenennen / löschen
 * - Live-Suche ab dem ersten Zeichen (Kategorie + Schlüsselwörter)
 * - Einstellungen und Anleitung als Icons
 * - Reihenfolge direkt per ↑/↓ in der Detailansicht ändern
 * - Schlüsselwörter hinzufügen / bearbeiten / löschen
 * - Doppelte Schlüsselwörter erkennen
 * - Automatische Sicherung vor der ersten Änderung
 * - JSON validieren und formatiert speichern
 * - Hell / Dunkel / System direkt über Theme-Icon umschalten
 * - Manuelle Buchungszuordnungen anzeigen und einzeln zurücksetzen
 * - Alle manuellen Zuordnungen einer Kategorie auf automatisch zurücksetzen
 * - Sämtliche manuellen Zuordnungen auf automatisch zurücksetzen
 */

const APP_DIR = "comdirect";
const FILE_NAME = "categories.json";
const BACKUP_PREFIX = "categories-backup-";
const BOOKINGS_CACHE_NAME = "bookings-cache.json";
const THEME_KEY = `${APP_DIR}.categories-editor.theme`;
const THEMES = ["system", "light", "dark"];
let THEME = loadTheme();

function loadTheme() {
  try {
    if (Keychain.contains(THEME_KEY)) {
      const value = Keychain.get(THEME_KEY);
      if (THEMES.includes(value)) return value;
    }
  } catch (_) {}
  return "system";
}

function saveTheme() {
  try { Keychain.set(THEME_KEY, THEME); } catch (_) {}
}

function systemDark() {
  try { return Device.isUsingDarkAppearance(); }
  catch (_) { return false; }
}

function isDark() {
  return THEME === "dark" || (THEME === "system" && systemDark());
}

function uiColor(light, dark) {
  if (THEME === "light") return new Color(light);
  if (THEME === "dark") return new Color(dark);
  return Color.dynamic(new Color(light), new Color(dark));
}

const C = {
  get bg()      { return uiColor("#F6F7F8", "#0D0E10"); },
  get card()    { return uiColor("#FFFFFF", "#17191D"); },
  get stripe()  { return uiColor("#EEF2F5", "#20242A"); },
  get head()    { return uiColor("#E4E9EE", "#272C33"); },
  get text()    { return uiColor("#111317", "#F5F7FA"); },
  get dim()     { return uiColor("#68707A", "#A8AFB8"); },
  get faint()   { return uiColor("#A1A8B0", "#6F7680"); },
  get accent()  { return uiColor("#007AFF", "#0A84FF"); },
  get success() { return uiColor("#2E7D32", "#64D26F"); },
  get danger()  { return uiColor("#C62828", "#FF6961"); }
};

function themeIcon() {
  if (THEME === "light") return "☀︎";
  if (THEME === "dark") return "☾";
  return "◐";
}

function themeLabel() {
  if (THEME === "light") return "Hell";
  if (THEME === "dark") return "Dunkel";
  return "System";
}

async function cycleTheme() {
  const i = THEMES.indexOf(THEME);
  THEME = THEMES[(i + 1) % THEMES.length];
  saveTheme();
  if (mainTable || mainWebView) await renderMainTable(`Darstellung: ${themeLabel()}`);
}

const localFM = FileManager.local();
let cloudFM = null;
try { cloudFM = FileManager.iCloud(); } catch (_) {}

let fm = null;
let root = null;
let filePath = null;
let data = null;
let backupCreated = false;
let bookingLookup = new Map();
let mainTable = null;
let mainWebView = null;
let mainWebClosed = false;
let mainWebEvents = [];

// ------------------------------------------------------------ Start

await main();

async function main() {
  const location = await locateCategoriesFile();
  if (!location) {
    await showMissingFileMessage();
    Script.complete();
    return;
  }

  fm = location.fm;
  root = location.root;
  filePath = location.path;

  try {
    await ensureDownloaded(fm, filePath);
    data = readAndValidate();
    await loadBookingLookup();
  } catch (e) {
    await errorAlert("categories.json konnte nicht geöffnet werden", String(e));
    Script.complete();
    return;
  }

  await showMainTable();
  Script.complete();
}

// ------------------------------------------------------------ Datei finden

async function locateCategoriesFile() {
  const candidates = [];

  const localRoot = localFM.joinPath(localFM.documentsDirectory(), APP_DIR);
  const localPath = localFM.joinPath(localRoot, FILE_NAME);
  if (localFM.fileExists(localPath)) {
    candidates.push({ label: "Lokal", fm: localFM, root: localRoot, path: localPath });
  }

  if (cloudFM) {
    const cloudRoot = cloudFM.joinPath(cloudFM.documentsDirectory(), APP_DIR);
    const cloudPath = cloudFM.joinPath(cloudRoot, FILE_NAME);
    if (cloudFM.fileExists(cloudPath)) {
      candidates.push({ label: "iCloud", fm: cloudFM, root: cloudRoot, path: cloudPath });
    }
  }

  if (candidates.length === 0) return null;
  if (candidates.length === 1) return candidates[0];

  const a = new Alert();
  a.title = "categories.json auswählen";
  a.message = "Die Datei wurde lokal und in iCloud gefunden.";
  for (const c of candidates) a.addAction(c.label);
  a.addCancelAction("Abbrechen");
  const idx = await a.presentSheet();
  if (idx < 0 || idx >= candidates.length) return null;
  return candidates[idx];
}

async function ensureDownloaded(manager, path) {
  try {
    if (manager === cloudFM && !manager.isFileDownloaded(path)) {
      await manager.downloadFileFromiCloud(path);
    }
  } catch (_) {
    // Bei lokalen Dateien oder älteren Scriptable-Versionen nicht relevant.
  }
}

// ------------------------------------------------------------ Datenmodell

function readAndValidate() {
  const raw = fm.readString(filePath);
  let obj;

  try {
    obj = JSON.parse(raw);
  } catch (e) {
    throw new Error("Ungültiges JSON.\n\n" + e.message);
  }

  if (!obj || typeof obj !== "object" || Array.isArray(obj)) {
    throw new Error("Die Hauptstruktur muss ein JSON-Objekt sein.");
  }

  if (!Array.isArray(obj.categories)) {
    throw new Error('Das Feld "categories" fehlt oder ist keine Liste.');
  }

  if (!obj.assignments || typeof obj.assignments !== "object" || Array.isArray(obj.assignments)) {
    obj.assignments = {};
  }

  if (!Number.isFinite(Number(obj.version))) obj.version = 1;

  obj.categories = obj.categories.map((cat, index) => {
    if (!cat || typeof cat !== "object") {
      throw new Error(`Kategorie ${index + 1} ist ungültig.`);
    }

    const name = String(cat.name ?? "").trim();
    if (!name) throw new Error(`Kategorie ${index + 1} hat keinen Namen.`);

    let keywords = cat.keywords;
    if (!Array.isArray(keywords)) {
      // Abwärtskompatibel zu möglichen älteren Bezeichnungen.
      if (Array.isArray(cat.words)) keywords = cat.words;
      else keywords = [];
    }

    return {
      ...cat,
      name,
      keywords: normalizeKeywords(keywords)
    };
  });

  return obj;
}

function normalizeKeywords(list) {
  const result = [];
  const seen = new Set();

  for (const item of list || []) {
    const value = String(item ?? "").trim();
    if (!value) continue;
    const key = value.toLocaleLowerCase("de-DE");
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(value);
  }

  return result;
}

function categoryNamesLower(exceptIndex = -1) {
  return new Set(
    data.categories
      .filter((_, i) => i !== exceptIndex)
      .map(c => c.name.toLocaleLowerCase("de-DE"))
  );
}

function duplicateKeywordOwners(keyword, ownCategoryIndex) {
  const needle = keyword.toLocaleLowerCase("de-DE");
  const owners = [];

  data.categories.forEach((cat, index) => {
    if (index === ownCategoryIndex) return;
    if (cat.keywords.some(k => k.toLocaleLowerCase("de-DE") === needle)) {
      owners.push(cat.name);
    }
  });

  return owners;
}

// ------------------------------------------------------------ Speichern / Backup

async function saveData(statusText = "Gespeichert") {
  validateBeforeSave();

  if (!backupCreated) {
    createBackup();
    backupCreated = true;
  }

  const pretty = JSON.stringify(data, null, 2) + "\n";
  fm.writeString(filePath, pretty);

  if (mainTable || mainWebView) {
    await renderMainTable(statusText);
  }
}

function validateBeforeSave() {
  if (!Array.isArray(data.categories)) throw new Error("categories ist keine Liste.");

  const names = new Set();

  for (const cat of data.categories) {
    cat.name = String(cat.name ?? "").trim();
    if (!cat.name) throw new Error("Eine Kategorie hat keinen Namen.");

    const lower = cat.name.toLocaleLowerCase("de-DE");
    if (names.has(lower)) throw new Error(`Doppelter Kategoriename: ${cat.name}`);
    names.add(lower);

    cat.keywords = normalizeKeywords(cat.keywords);
  }

  if (!data.assignments || typeof data.assignments !== "object" || Array.isArray(data.assignments)) {
    data.assignments = {};
  }
}

function createBackup() {
  const stamp = timestamp();
  const backupPath = fm.joinPath(root, `${BACKUP_PREFIX}${stamp}.json`);
  const original = fm.readString(filePath);
  fm.writeString(backupPath, original);
}

function timestamp() {
  const d = new Date();
  const p = n => String(n).padStart(2, "0");
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
}

// ------------------------------------------------------------ Hauptansicht

async function showMainTable() {
  mainTable = null;
  mainWebClosed = false;
  mainWebEvents = [];

  const web = new WebView();
  mainWebView = web;

  web.shouldAllowRequest = req => {
    try {
      const url = String(req.url || "");
      if (url.startsWith("editor-action://")) {
        mainWebEvents.push(url);
        return false;
      }
    } catch (_) {}
    return true;
  };

  await web.loadHTML(buildMainHTML());

  const presented = web.present(true).then(() => {
    mainWebClosed = true;
  });

  while (!mainWebClosed) {
    while (mainWebEvents.length) {
      const url = mainWebEvents.shift();
      try {
        await handleMainWebAction(url);
      } catch (e) {
        await errorAlert("Aktion fehlgeschlagen", String(e));
      }
    }
    await sleepMs(80);
  }

  await presented;
  mainWebView = null;
}

async function renderMainTable(statusText = "") {
  if (!mainWebView || mainWebClosed) return;
  await syncMainWebView(statusText);
}

function buildMainHTML() {
  const initialData = JSON.stringify({
    categories: data.categories,
    totalKeywords: totalKeywordCount(),
    assignments: assignmentCount(),
    assignmentEntries: assignmentEntries(),
    fileName: FILE_NAME,
    location: fm === cloudFM ? "iCloud" : "Lokal",
    theme: THEME,
    themeLabel: themeLabel()
  }).replace(/</g, "\\u003c");

  return `<!doctype html>
<html lang="de">
<head>
<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
<style>
:root{color-scheme:light dark;--bg:#f2f2f7;--card:#fff;--text:#111;--muted:#6b7280;--line:#d9d9de;--accent:#007aff;--danger:#ff3b30;--head:#e9edf2}
html[data-theme="dark"]{--bg:#0b0c0f;--card:#17191d;--text:#f5f7fa;--muted:#a8afb8;--line:#30343a;--accent:#0a84ff;--danger:#ff6961;--head:#262b32;color-scheme:dark}
html[data-theme="light"]{color-scheme:light}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--text);font-family:-apple-system,BlinkMacSystemFont,"SF Pro Text",sans-serif;padding:calc(env(safe-area-inset-top) + 10px) 12px calc(env(safe-area-inset-bottom) + 18px)}
.header{display:flex;gap:8px;align-items:center;padding:14px 14px 12px;background:var(--head);border-radius:18px;margin-bottom:10px}.title{min-width:0;flex:1}.title h1{font-size:24px;line-height:1.05;margin:0 0 5px}.sub{font-size:12px;color:var(--muted)}
.icon{width:44px;height:44px;border:0;border-radius:13px;background:var(--card);color:var(--accent);font-size:21px;font-weight:600}.toolbar{display:flex;gap:8px;margin-bottom:10px}.primary,.secondary{min-height:46px;border:0;border-radius:13px;padding:0 14px;font-size:15px;font-weight:600}.primary{background:var(--accent);color:white;flex:1}.secondary{background:var(--card);color:var(--muted)}
.searchWrap{position:relative;margin-bottom:12px}.search{width:100%;height:48px;border:1px solid var(--line);border-radius:14px;background:var(--card);color:var(--text);font-size:17px;padding:0 44px 0 42px;outline:none}.search:focus{border-color:var(--accent)}.mag{position:absolute;left:14px;top:13px;color:var(--muted);font-size:18px}.clear{display:none;position:absolute;right:8px;top:6px;width:36px;height:36px;border:0;border-radius:10px;background:transparent;color:var(--muted);font-size:22px}.searchWrap.hasText .clear{display:block}
.section{font-size:11px;font-weight:700;letter-spacing:.06em;color:var(--muted);padding:3px 5px 7px}.list{overflow:hidden;border-radius:16px;background:var(--card);border:1px solid var(--line);margin-bottom:12px}.row{display:flex;align-items:center;min-height:62px;padding:8px 8px 8px 14px;border-bottom:1px solid var(--line)}.row:last-child{border-bottom:0}.rowMain{min-width:0;flex:1;border:0;background:transparent;text-align:left;color:var(--text);padding:5px 4px}.name{font-size:17px;font-weight:650;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.meta{font-size:12px;color:var(--muted);margin-top:4px}.del{width:42px;height:42px;border:0;border-radius:12px;background:transparent;color:var(--danger);font-size:24px}.chev{width:24px;color:var(--muted);font-size:25px;text-align:center}.empty{padding:22px 15px;text-align:center;color:var(--muted)}
.status{display:none;margin:0 0 10px;padding:10px 12px;border-radius:12px;background:var(--card);color:#27843a;font-size:13px}.status.show{display:block}.footer{padding:13px 14px;border-radius:15px;background:var(--card);border:1px solid var(--line)}.footer b{font-size:14px}.footer div{font-size:11px;color:var(--muted);margin-top:4px}.assignmentLink{display:block;width:100%;border:0;background:transparent;color:var(--accent);padding:0;text-align:left;font:inherit;font-weight:650}.assignmentGroup{margin:12px 0 6px;padding:9px 10px;border-radius:11px;background:var(--bg);font-size:13px;font-weight:700}.assignmentItem{display:flex;align-items:center;gap:8px;padding:10px 2px;border-bottom:1px solid var(--line)}.assignmentItem:last-child{border-bottom:0}.assignmentText{min-width:0;flex:1}.assignmentId{font-size:13px;font-weight:600;overflow-wrap:anywhere}.assignmentCat{font-size:11px;color:var(--muted);margin-top:3px}.assignmentReset{width:auto!important;min-height:34px!important;margin:0!important;padding:0 10px!important;background:var(--bg)!important;color:var(--danger)!important;font-size:12px!important}.bulkButton{background:var(--danger)!important}.categoryBulk{background:var(--bg)!important;color:var(--danger)!important;margin-top:6px!important}.assignEmpty{padding:14px 0;color:var(--muted);font-size:13px}
.modalBack{display:none;position:fixed;inset:0;background:rgba(0,0,0,.36);padding:22px;align-items:center;justify-content:center}.modalBack.show{display:flex}.modal{width:min(520px,100%);max-height:80vh;overflow:auto;background:var(--card);border-radius:20px;padding:18px;color:var(--text)}.modal h2{margin:0 0 12px}.modal p{font-size:14px;line-height:1.45;color:var(--muted)}.modal button{width:100%;min-height:44px;border:0;border-radius:12px;background:var(--accent);color:white;font-size:15px;font-weight:600;margin-top:10px}.modal button.alt{background:var(--bg);color:var(--text)}
@media(min-width:700px){body{padding-left:24px;padding-right:24px}.row{min-height:68px}.header{padding:18px}.list{border-radius:18px}}
</style>
</head>
<body>
<div class="header"><div class="title"><h1>Kategorien</h1><div class="sub" id="summary"></div></div><button class="icon" id="settings" aria-label="Einstellungen">⚙︎</button><button class="icon" id="help" aria-label="Anleitung">?</button></div>
<div class="toolbar"><button class="primary" id="add">＋ Kategorie</button><button class="secondary" id="reload">↻ Neu laden</button></div>
<div class="searchWrap" id="searchWrap"><span class="mag">⌕</span><input class="search" id="search" type="search" autocomplete="off" autocorrect="off" placeholder="Kategorie oder Schlüsselwort suchen"><button class="clear" id="clear" aria-label="Suche löschen">×</button></div>
<div class="status" id="status"></div>
<div class="section" id="sectionLabel">KATEGORIEN</div><div class="list" id="list"></div>
<div class="section">DATEI</div><div class="footer"><b id="fileTitle"></b><div><button class="assignmentLink" id="assignmentsLink" type="button"></button></div><div id="fileMeta"></div></div>
<div class="modalBack" id="modalBack"><div class="modal"><h2 id="modalTitle"></h2><div id="modalBody"></div><button id="modalPrimary">OK</button><button class="alt" id="modalSecondary" style="display:none">Schließen</button></div></div>
<script>
let state=${initialData};
const $=id=>document.getElementById(id);
const esc=s=>String(s??'').replace(/[&<>\"']/g,m=>({'&':'&amp;','<':'&lt;','>':'&gt;','\"':'&quot;',"'":'&#39;'}[m]));
function action(name,params={}){const q=new URLSearchParams(params);location.href='editor-action://'+name+(q.toString()?'?'+q.toString():'')}
function appliedTheme(){if(state.theme==='system')return matchMedia('(prefers-color-scheme:dark)').matches?'dark':'light';return state.theme}
function applyTheme(){document.documentElement.dataset.theme=appliedTheme()}
function visible(){const q=$('search').value.trim().toLocaleLowerCase('de-DE');return state.categories.map((cat,index)=>({cat,index})).filter(x=>!q||x.cat.name.toLocaleLowerCase('de-DE').includes(q)||(x.cat.keywords||[]).some(k=>String(k).toLocaleLowerCase('de-DE').includes(q)))}
function render(){applyTheme();$('summary').textContent=state.categories.length+' Kategorien · '+state.totalKeywords+' Schlüsselwörter';$('fileTitle').textContent=state.fileName;$('assignmentsLink').textContent=state.assignments+' manuelle Zuordnungen ›';$('assignmentsLink').disabled=!state.assignments;$('assignmentsLink').style.opacity=state.assignments?'1':'.55';$('fileMeta').textContent=state.location+' · Darstellung: '+state.themeLabel;const items=visible();const q=$('search').value.trim();$('searchWrap').classList.toggle('hasText',!!q);$('sectionLabel').textContent=q?'KATEGORIEN · '+items.length+' TREFFER':'KATEGORIEN';if(!items.length){$('list').innerHTML='<div class="empty">'+(q?'Keine passenden Kategorien oder Schlüsselwörter.':'Keine Kategorien vorhanden.')+'</div>';return}$('list').innerHTML=items.map(({cat,index})=>'<div class="row"><button class="rowMain" data-edit="'+index+'"><div class="name">'+esc(cat.name)+'</div><div class="meta">'+(cat.keywords?.length||0)+' Schlüsselwörter</div></button><button class="del" data-del="'+index+'" aria-label="Kategorie löschen">−</button><span class="chev">›</span></div>').join('');document.querySelectorAll('[data-edit]').forEach(b=>b.addEventListener('click',()=>action('edit',{index:b.dataset.edit})));document.querySelectorAll('[data-del]').forEach(b=>b.addEventListener('click',()=>{const i=Number(b.dataset.del),c=state.categories[i];if(confirm('Kategorie „'+c.name+'“ wirklich löschen?'))action('delete',{index:i})}))}
function showAssignments(){
  const entries=Array.isArray(state.assignmentEntries)?state.assignmentEntries:[];
  if(!entries.length){showModal('Manuelle Zuordnungen','<div class="assignEmpty">Keine manuellen Zuordnungen vorhanden.</div>');return}
  const groups={};
  entries.forEach(x=>{const cat=String(x.category||'Unbekannt');(groups[cat]??=[]).push(x)});
  const cats=Object.keys(groups).sort((a,b)=>a.localeCompare(b,'de'));
  let html='<p>Tippe bei einer einzelnen Zuordnung auf <b>Automatisch</b>, um nur diese manuelle Zuordnung aufzuheben.</p>';
  html+=cats.map(cat=>'<div class="assignmentGroup">'+esc(cat)+' · '+groups[cat].length+'</div>'+groups[cat].map(x=>'<div class="assignmentItem"><div class="assignmentText"><div class="assignmentId">'+esc(x.label||x.id)+'</div>'+(x.detail?'<div class="assignmentCat">'+esc(x.detail)+'</div>':'')+(x.hasBooking?'<div class="assignmentCat">ID: '+esc(x.id)+'</div>':'')+'<div class="assignmentCat">Manuell → '+esc(cat)+'</div></div><button class="assignmentReset" data-reset-id="'+escAttr(x.id)+'">Automatisch</button></div>').join('')+'<button class="categoryBulk" data-reset-category="'+escAttr(cat)+'">Alle '+groups[cat].length+' in „'+esc(cat)+'“ auf automatisch</button>').join('');
  html+='<button class="bulkButton" id="resetAllAssignments">Alle '+entries.length+' Zuordnungen auf automatisch</button>';
  showModal('Manuelle Zuordnungen · '+entries.length,html,'Schließen',hideModal);
  document.querySelectorAll('[data-reset-id]').forEach(b=>b.addEventListener('click',()=>{const id=b.dataset.resetId;hideModal();action('assignment-one',{id})}));
  document.querySelectorAll('[data-reset-category]').forEach(b=>b.addEventListener('click',()=>{const category=b.dataset.resetCategory;hideModal();action('assignment-category',{category})}));
  const all=$('resetAllAssignments');if(all)all.addEventListener('click',()=>{hideModal();action('assignment-all')});
}
function escAttr(s){return esc(s).split(String.fromCharCode(96)).join('&#96;')}
function showModal(title,html,primaryText='OK',primary=()=>hideModal(),secondaryText=''){ $('modalTitle').textContent=title;$('modalBody').innerHTML=html;$('modalPrimary').textContent=primaryText;$('modalPrimary').onclick=primary;$('modalSecondary').style.display=secondaryText?'block':'none';$('modalSecondary').textContent=secondaryText;$('modalSecondary').onclick=hideModal;$('modalBack').classList.add('show')}
function hideModal(){$('modalBack').classList.remove('show')}
$('search').addEventListener('input',render);$('clear').addEventListener('click',()=>{$('search').value='';$('search').focus();render()});
$('add').addEventListener('click',()=>{const name=prompt('Name der neuen Kategorie:','');if(name&&name.trim())action('add',{name:name.trim()})});
$('reload').addEventListener('click',()=>action('reload'));
$('assignmentsLink').addEventListener('click',showAssignments);
$('settings').addEventListener('click',()=>showModal('Einstellungen','<p>Darstellung: <b>'+esc(state.themeLabel)+'</b></p><p>Speicherort: <b>'+esc(state.location)+'</b></p>','Darstellung ändern',()=>{hideModal();action('theme')},'Schließen'));
$('help').addEventListener('click',()=>showModal('Anleitung','<p><b>Suche:</b> Bereits beim ersten eingegebenen Zeichen werden Kategorien und Schlüsselwörter sofort gefiltert.</p><p><b>＋ Kategorie:</b> legt eine neue Kategorie an.</p><p><b>−:</b> löscht die Kategorie nach Rückfrage.</p><p><b>Kategorie antippen:</b> öffnet den vorhandenen Editor für Name, Reihenfolge und Schlüsselwörter.</p><p><b>Manuelle Zuordnungen:</b> unten antippen, um einzelne, alle einer Kategorie oder sämtliche manuellen Zuordnungen wieder auf automatisch zu stellen.</p><p><b>⚙︎:</b> Einstellungen. <b>?</b>: Anleitung.</p>'));
window.__editorSync=(next,status='')=>{state=next;if(status){$('status').textContent='✓ '+status;$('status').classList.add('show');setTimeout(()=>$('status').classList.remove('show'),2200)}render();};
render();
</script></body></html>`;
}

async function handleMainWebAction(rawUrl) {
  const parts = rawUrl.split("?");
  const action = parts[0].replace("editor-action://", "");
  const params = {};
  if (parts[1]) {
    for (const pair of parts[1].split("&")) {
      const eq = pair.indexOf("=");
      const k = eq >= 0 ? pair.slice(0, eq) : pair;
      const v = eq >= 0 ? pair.slice(eq + 1) : "";
      params[decodeURIComponent(k.replace(/\+/g, " "))] = decodeURIComponent(v.replace(/\+/g, " "));
    }
  }

  if (action === "add") {
    const clean = String(params.name || "").trim();
    if (!clean) return;
    if (categoryNamesLower().has(clean.toLocaleLowerCase("de-DE"))) {
      await errorAlert("Kategorie existiert bereits", clean);
      return;
    }
    data.categories.push({ name: clean, keywords: [] });
    await saveData(`Kategorie „${clean}“ angelegt`);
    return;
  }

  if (action === "delete") {
    const index = Number(params.index);
    if (!Number.isInteger(index) || index < 0 || index >= data.categories.length) return;
    await deleteCategory(index);
    return;
  }

  if (action === "edit") {
    const index = Number(params.index);
    if (!Number.isInteger(index) || index < 0 || index >= data.categories.length) return;
    await showCategoryEditor(index);
    await syncMainWebView();
    return;
  }

  if (action === "assignment-one") {
    const id = String(params.id ?? "");
    if (!id || !Object.prototype.hasOwnProperty.call(data.assignments || {}, id)) return;
    const category = String(data.assignments[id] ?? "");
    delete data.assignments[id];
    await saveData(`1 manuelle Zuordnung${category ? ` aus „${category}“` : ""} auf automatisch gestellt`);
    return;
  }

  if (action === "assignment-category") {
    const category = String(params.category ?? "");
    if (!category) return;
    const ids = Object.keys(data.assignments || {}).filter(id => String(data.assignments[id]) === category);
    if (!ids.length) {
      await syncMainWebView(`Keine manuellen Zuordnungen in „${category}“ gefunden`);
      return;
    }
    const ok = await confirmAssignmentReset(
      "Kategorie auf automatisch stellen?",
      `Alle ${ids.length} manuellen Zuordnungen in „${category}“ werden entfernt und anschließend wieder automatisch kategorisiert.`
    );
    if (!ok) {
      await syncMainWebView();
      return;
    }
    for (const id of ids) delete data.assignments[id];
    await saveData(`${ids.length} manuelle Zuordnung${ids.length === 1 ? "" : "en"} in „${category}“ auf automatisch gestellt`);
    return;
  }

  if (action === "assignment-all") {
    const removed = assignmentCount();
    if (!removed) {
      await syncMainWebView("Keine manuellen Zuordnungen vorhanden");
      return;
    }
    const ok = await confirmAssignmentReset(
      "Alle auf automatisch stellen?",
      `Alle ${removed} manuellen Zuordnungen werden entfernt und anschließend wieder automatisch kategorisiert.`
    );
    if (!ok) {
      await syncMainWebView();
      return;
    }
    data.assignments = {};
    await saveData(`Alle ${removed} manuellen Zuordnungen auf automatisch gestellt`);
    return;
  }

  if (action === "reload") {
    data = readAndValidate();
    await loadBookingLookup();
    await syncMainWebView("Datei und Buchungsnamen neu geladen");
    return;
  }

  if (action === "theme") {
    const i = THEMES.indexOf(THEME);
    THEME = THEMES[(i + 1) % THEMES.length];
    saveTheme();
    await syncMainWebView(`Darstellung: ${themeLabel()}`);
  }
}

async function syncMainWebView(statusText = "") {
  if (!mainWebView || mainWebClosed) return;
  const next = JSON.stringify({
    categories: data.categories,
    totalKeywords: totalKeywordCount(),
    assignments: assignmentCount(),
    assignmentEntries: assignmentEntries(),
    fileName: FILE_NAME,
    location: fm === cloudFM ? "iCloud" : "Lokal",
    theme: THEME,
    themeLabel: themeLabel()
  }).replace(/</g, "\\u003c");
  const status = JSON.stringify(statusText || "");
  try {
    await mainWebView.evaluateJavaScript(`window.__editorSync(${next}, ${status});`, false);
  } catch (_) {}
}

async function confirmAssignmentReset(title, message) {
  const a = new Alert();
  a.title = title;
  a.message = message;
  a.addDestructiveAction("Auf automatisch stellen");
  a.addCancelAction("Abbrechen");
  return (await a.presentAlert()) === 0;
}

function sleepMs(ms) {
  return new Promise(resolve => Timer.schedule(ms / 1000, false, resolve));
}

function totalKeywordCount() {
  return data.categories.reduce((sum, c) => sum + c.keywords.length, 0);
}

async function loadBookingLookup() {
  bookingLookup = new Map();
  try {
    const cachePath = fm.joinPath(root, BOOKINGS_CACHE_NAME);
    if (!fm.fileExists(cachePath)) return;
    await ensureDownloaded(fm, cachePath);
    const cache = JSON.parse(fm.readString(cachePath));
    const bookings = Array.isArray(cache && cache.bookings) ? cache.bookings : [];
    for (const b of bookings) {
      if (!b || !b.id) continue;
      bookingLookup.set(String(b.id), {
        name: String(b.name || "").trim(),
        date: String(b.date || "").trim(),
        typ: String(b.typ || "").trim(),
        value: b.value
      });
    }
  } catch (_) {
    bookingLookup = new Map();
  }
}

function assignmentCount() {
  return Object.keys(data.assignments || {}).length;
}

function assignmentEntries() {
  return Object.entries(data.assignments || {})
    .map(([id, category]) => {
      const booking = bookingLookup.get(String(id));
      return {
        id: String(id),
        category: String(category ?? ""),
        label: booking && booking.name ? booking.name : readableAssignmentId(id),
        detail: booking ? [booking.date, booking.typ].filter(Boolean).join(" · ") : "",
        hasBooking: !!booking
      };
    })
    .sort((a, b) => {
      const byCategory = a.category.localeCompare(b.category, "de-DE");
      return byCategory || a.label.localeCompare(b.label, "de-DE");
    });
}

function readableAssignmentId(id) {
  const raw = String(id ?? "");
  // IDs unverändert speichern; für die Anzeige lediglich typische Trenner lesbarer machen.
  const readable = raw
    .replace(/\|/g, " · ")
    .replace(/__+/g, " · ")
    .trim();
  return readable || raw || "(ohne ID)";
}

// ------------------------------------------------------------ Kategorie bearbeiten

async function showCategoryEditor(index) {
  if (index < 0 || index >= data.categories.length) return;

  const table = new UITable();
  table.showSeparators = false;

  const render = async () => {
    table.removeAllRows();

    if (index < 0 || index >= data.categories.length) {
      table.dismiss();
      return;
    }

    const cat = data.categories[index];

    const header = new UITableRow();
    header.height = 78;
    header.backgroundColor = C.head;
    header.dismissOnSelect = false;

    const title = header.addText(
      cat.name,
      cat.keywords.length === 1
        ? "1 Schlüsselwort"
        : `${cat.keywords.length} Schlüsselwörter`
    );
    title.widthWeight = 78;
    title.titleFont = Font.boldSystemFont(22);
    title.titleColor = C.text;
    title.subtitleFont = Font.systemFont(12);
    title.subtitleColor = C.dim;

    const theme = header.addButton(themeIcon());
    theme.widthWeight = 22;
    theme.centerAligned();
    theme.titleFont = Font.systemFont(24);
    theme.titleColor = C.accent;
    theme.onTap = async () => {
      const i = THEMES.indexOf(THEME);
      THEME = THEMES[(i + 1) % THEMES.length];
      saveTheme();
      await render();
      await renderMainTable(`Darstellung: ${themeLabel()}`);
    };

    table.addRow(header);

    addSectionRow(table, "KATEGORIE", `Position ${index + 1} von ${data.categories.length}`);

    const editRow = new UITableRow();
    editRow.height = 54;
    editRow.backgroundColor = C.stripe;
    editRow.dismissOnSelect = false;

    const rename = editRow.addButton("✎ Name");
    rename.widthWeight = 45;
    rename.titleFont = Font.semiboldSystemFont(15);
    rename.titleColor = C.accent;
    rename.onTap = async () => {
      await renameCategory(index);
      await render();
    };

    const up = editRow.addButton("↑");
    up.widthWeight = 18;
    up.centerAligned();
    up.titleFont = Font.systemFont(22);
    up.titleColor = index > 0 ? C.accent : C.faint;
    up.onTap = async () => {
      if (index <= 0) return;
      const [item] = data.categories.splice(index, 1);
      data.categories.splice(index - 1, 0, item);
      index -= 1;
      try {
        await saveData(`„${item.name}“ nach oben verschoben`);
        await render();
      } catch (e) {
        await errorAlert("Speichern fehlgeschlagen", String(e));
      }
    };

    const down = editRow.addButton("↓");
    down.widthWeight = 18;
    down.centerAligned();
    down.titleFont = Font.systemFont(22);
    down.titleColor = index < data.categories.length - 1 ? C.accent : C.faint;
    down.onTap = async () => {
      if (index >= data.categories.length - 1) return;
      const [item] = data.categories.splice(index, 1);
      data.categories.splice(index + 1, 0, item);
      index += 1;
      try {
        await saveData(`„${item.name}“ nach unten verschoben`);
        await render();
      } catch (e) {
        await errorAlert("Speichern fehlgeschlagen", String(e));
      }
    };

    const remove = editRow.addButton("−");
    remove.widthWeight = 19;
    remove.centerAligned();
    remove.titleFont = Font.systemFont(22);
    remove.titleColor = C.danger;
    remove.onTap = async () => {
      const deleted = await deleteCategory(index);
      if (deleted) table.dismiss();
      else await render();
    };

    table.addRow(editRow);

    addSectionRow(table, "SCHLÜSSELWÖRTER", "Tippen = bearbeiten");

    const addRow = new UITableRow();
    addRow.height = 50;
    addRow.backgroundColor = C.stripe;
    addRow.dismissOnSelect = false;

    const plus = addRow.addButton("＋ Schlüsselwort");
    plus.widthWeight = 100;
    plus.titleFont = Font.semiboldSystemFont(15);
    plus.titleColor = C.accent;
    plus.onTap = async () => {
      await addKeyword(index);
      await render();
    };
    table.addRow(addRow);

    if (cat.keywords.length === 0) {
      const empty = new UITableRow();
      empty.height = 64;
      empty.backgroundColor = C.card;
      empty.dismissOnSelect = false;
      const t = empty.addText(
        "Keine Schlüsselwörter",
        "Diese Kategorie kann nur manuell zugeordnet werden"
      );
      t.titleFont = Font.systemFont(15);
      t.titleColor = C.text;
      t.subtitleFont = Font.systemFont(11);
      t.subtitleColor = C.dim;
      table.addRow(empty);
    }

    cat.keywords.forEach((keyword, keywordIndex) => {
      const row = new UITableRow();
      row.height = 48;
      row.backgroundColor = keywordIndex % 2 === 0 ? C.card : C.stripe;
      row.dismissOnSelect = false;

      const text = row.addText(keyword);
      text.widthWeight = 88;
      text.titleFont = Font.systemFont(16);
      text.titleColor = C.text;

      const del = row.addButton("−");
      del.widthWeight = 12;
      del.centerAligned();
      del.titleFont = Font.systemFont(20);
      del.titleColor = C.danger;
      del.onTap = async () => {
        await deleteKeyword(index, keywordIndex);
        await render();
      };

      row.onSelect = async () => {
        await editKeyword(index, keywordIndex);
        await render();
      };

      table.addRow(row);
    });

    addSectionRow(table, "HINWEIS", "");
    const hint = new UITableRow();
    hint.height = 56;
    hint.backgroundColor = C.bg;
    hint.dismissOnSelect = false;
    const h = hint.addText(
      "Reihenfolge = Priorität",
      "Bei gleichen Treffern gewinnt die weiter oben stehende Kategorie."
    );
    h.titleFont = Font.systemFont(13);
    h.titleColor = C.dim;
    h.subtitleFont = Font.systemFont(11);
    h.subtitleColor = C.faint;
    table.addRow(hint);

    table.reload();
  };

  await render();
  await table.present(true);
  await renderMainTable();
}

// ------------------------------------------------------------ Kategorie Aktionen

async function addCategory() {
  const name = await promptText(
    "Neue Kategorie",
    "Name der neuen Kategorie:",
    ""
  );
  if (name === null) return;

  const clean = name.trim();
  if (!clean) return;

  if (categoryNamesLower().has(clean.toLocaleLowerCase("de-DE"))) {
    await errorAlert("Kategorie existiert bereits", clean);
    return;
  }

  data.categories.push({ name: clean, keywords: [] });

  try {
    await saveData(`Kategorie „${clean}“ angelegt`);
  } catch (e) {
    await errorAlert("Speichern fehlgeschlagen", String(e));
  }
}

async function renameCategory(index) {
  const cat = data.categories[index];
  const oldName = cat.name;

  const name = await promptText(
    "Kategorie umbenennen",
    "Neuer Name:",
    oldName
  );
  if (name === null) return;

  const clean = name.trim();
  if (!clean || clean === oldName) return;

  if (categoryNamesLower(index).has(clean.toLocaleLowerCase("de-DE"))) {
    await errorAlert("Kategorie existiert bereits", clean);
    return;
  }

  // Manuelle Zuordnungen auf den neuen Kategorienamen umstellen.
  for (const id of Object.keys(data.assignments || {})) {
    if (data.assignments[id] === oldName) {
      data.assignments[id] = clean;
    }
  }

  cat.name = clean;

  try {
    await saveData(`„${oldName}“ in „${clean}“ umbenannt`);
  } catch (e) {
    await errorAlert("Speichern fehlgeschlagen", String(e));
  }
}

async function moveCategory(index, direction = 0) {
  if (index < 0 || index >= data.categories.length) return index;
  if (!direction) return index;

  const target = Math.max(0, Math.min(data.categories.length - 1, index + direction));
  if (target === index) return index;

  const [item] = data.categories.splice(index, 1);
  data.categories.splice(target, 0, item);

  try {
    await saveData(`„${item.name}“ verschoben`);
  } catch (e) {
    await errorAlert("Speichern fehlgeschlagen", String(e));
  }

  return target;
}

async function deleteCategory(index) {
  const cat = data.categories[index];
  const linked = Object.values(data.assignments || {}).filter(v => v === cat.name).length;

  const a = new Alert();
  a.title = `Kategorie „${cat.name}“ löschen?`;
  a.message =
    `${cat.keywords.length} Schlüsselwörter` +
    (linked ? `\n${linked} manuelle Buchungszuordnungen werden ebenfalls entfernt.` : "");
  a.addDestructiveAction("Löschen");
  a.addCancelAction("Abbrechen");

  const answer = await a.presentAlert();
  if (answer !== 0) return false;

  data.categories.splice(index, 1);

  if (linked) {
    for (const id of Object.keys(data.assignments || {})) {
      if (data.assignments[id] === cat.name) delete data.assignments[id];
    }
  }

  try {
    await saveData(`Kategorie „${cat.name}“ gelöscht`);
    return true;
  } catch (e) {
    await errorAlert("Speichern fehlgeschlagen", String(e));
    return false;
  }
}

// ------------------------------------------------------------ Schlüsselwörter

async function addKeyword(categoryIndex) {
  const cat = data.categories[categoryIndex];
  const value = await promptText(
    "Schlüsselwort hinzufügen",
    `Kategorie: ${cat.name}\n\nEin einzelnes Schlüsselwort eingeben:`,
    ""
  );
  if (value === null) return;

  const clean = value.trim();
  if (!clean) return;

  if (cat.keywords.some(k => k.toLocaleLowerCase("de-DE") === clean.toLocaleLowerCase("de-DE"))) {
    await errorAlert("Schlüsselwort existiert bereits", `„${clean}“ ist bereits in „${cat.name}“ enthalten.`);
    return;
  }

  const owners = duplicateKeywordOwners(clean, categoryIndex);
  if (owners.length) {
    const proceed = await confirmDuplicateKeyword(clean, owners);
    if (!proceed) return;
  }

  cat.keywords.push(clean);

  try {
    await saveData(`Schlüsselwort „${clean}“ hinzugefügt`);
  } catch (e) {
    await errorAlert("Speichern fehlgeschlagen", String(e));
  }
}

async function editKeyword(categoryIndex, keywordIndex) {
  const cat = data.categories[categoryIndex];
  const old = cat.keywords[keywordIndex];

  const value = await promptText(
    "Schlüsselwort bearbeiten",
    `Kategorie: ${cat.name}`,
    old
  );
  if (value === null) return;

  const clean = value.trim();
  if (!clean || clean === old) return;

  if (cat.keywords.some((k, i) =>
    i !== keywordIndex &&
    k.toLocaleLowerCase("de-DE") === clean.toLocaleLowerCase("de-DE")
  )) {
    await errorAlert("Schlüsselwort existiert bereits", `„${clean}“ ist bereits in „${cat.name}“ enthalten.`);
    return;
  }

  const owners = duplicateKeywordOwners(clean, categoryIndex);
  if (owners.length) {
    const proceed = await confirmDuplicateKeyword(clean, owners);
    if (!proceed) return;
  }

  cat.keywords[keywordIndex] = clean;

  try {
    await saveData(`„${old}“ geändert`);
  } catch (e) {
    await errorAlert("Speichern fehlgeschlagen", String(e));
  }
}

async function deleteKeyword(categoryIndex, keywordIndex) {
  const cat = data.categories[categoryIndex];
  const keyword = cat.keywords[keywordIndex];

  const a = new Alert();
  a.title = "Schlüsselwort löschen?";
  a.message = `„${keyword}“ aus „${cat.name}“ entfernen?`;
  a.addDestructiveAction("Löschen");
  a.addCancelAction("Abbrechen");

  const answer = await a.presentAlert();
  if (answer !== 0) return;

  cat.keywords.splice(keywordIndex, 1);

  try {
    await saveData(`Schlüsselwort „${keyword}“ gelöscht`);
  } catch (e) {
    await errorAlert("Speichern fehlgeschlagen", String(e));
  }
}

async function confirmDuplicateKeyword(keyword, owners) {
  const a = new Alert();
  a.title = "Schlüsselwort mehrfach vorhanden";
  a.message =
    `„${keyword}“ wird bereits verwendet in:\n\n` +
    owners.map(x => `• ${x}`).join("\n") +
    "\n\nDa die Reihenfolge der Kategorien entscheidet, kann das zu unerwarteten Zuordnungen führen.";
  a.addAction("Trotzdem speichern");
  a.addCancelAction("Abbrechen");
  return (await a.presentAlert()) === 0;
}

// ------------------------------------------------------------ Info / Hilfen

async function showInfo() {
  const duplicateMap = new Map();

  data.categories.forEach(cat => {
    cat.keywords.forEach(keyword => {
      const key = keyword.toLocaleLowerCase("de-DE");
      if (!duplicateMap.has(key)) duplicateMap.set(key, []);
      duplicateMap.get(key).push(cat.name);
    });
  });

  const duplicates = [...duplicateMap.entries()]
    .filter(([, owners]) => new Set(owners).size > 1);

  const a = new Alert();
  a.title = "categories.json";
  a.message =
    `Speicherort:\n${filePath}\n\n` +
    `Kategorien: ${data.categories.length}\n` +
    `Schlüsselwörter: ${data.categories.reduce((n, c) => n + c.keywords.length, 0)}\n` +
    `Manuelle Zuordnungen: ${assignmentCount()}\n` +
    `Doppelte Schlüsselwörter: ${duplicates.length}\n` +
    `Darstellung: ${themeLabel()}\n\n` +
    "Manuelle Buchungszuordnungen werden von diesem Editor nicht verändert, außer wenn eine Kategorie umbenannt oder gelöscht wird.";
  a.addAction("OK");

  if (duplicates.length) {
    a.addAction("Duplikate anzeigen");
  }

  const answer = await a.presentAlert();

  if (duplicates.length && answer === 1) {
    const b = new Alert();
    b.title = "Doppelte Schlüsselwörter";
    b.message = duplicates
      .map(([keyword, owners]) => `• ${keyword}: ${[...new Set(owners)].join(", ")}`)
      .join("\n");
    b.addAction("OK");
    await b.presentAlert();
  }
}

async function showMissingFileMessage() {
  const a = new Alert();
  a.title = "categories.json nicht gefunden";
  a.message =
    `Gesucht wurde unter:\n\n` +
    `Lokal: Scriptable/${APP_DIR}/${FILE_NAME}\n` +
    `iCloud: Scriptable/${APP_DIR}/${FILE_NAME}\n\n` +
    "Starte zuerst den comdirect Manager 4.1.0, damit die Kategorien-Datei angelegt bzw. migriert wird.";
  a.addAction("OK");
  await a.presentAlert();
}

// ------------------------------------------------------------ UI-Helfer

function addTitleRow(table, title, subtitle = "") {
  const row = new UITableRow();
  row.isHeader = true;
  row.height = 74;
  row.backgroundColor = C.head;
  row.dismissOnSelect = false;

  const text = row.addText(title, subtitle);
  text.titleFont = Font.boldSystemFont(22);
  text.titleColor = C.text;
  text.subtitleFont = Font.systemFont(12);
  text.subtitleColor = C.dim;

  table.addRow(row);
}

function addSectionRow(table, title, subtitle = "") {
  const row = new UITableRow();
  row.height = 34;
  row.backgroundColor = C.bg;
  row.dismissOnSelect = false;

  const label = subtitle ? `${title}   ·   ${subtitle}` : title;
  const text = row.addText(label);
  text.titleFont = Font.semiboldSystemFont(11);
  text.titleColor = C.dim;

  table.addRow(row);
}

async function promptText(title, message, value) {
  const a = new Alert();
  a.title = title;
  a.message = message;
  a.addTextField("", value ?? "");
  a.addAction("Speichern");
  a.addCancelAction("Abbrechen");

  const answer = await a.presentAlert();
  if (answer !== 0) return null;
  return a.textFieldValue(0);
}

async function errorAlert(title, message) {
  const a = new Alert();
  a.title = title;
  a.message = message;
  a.addAction("OK");
  await a.presentAlert();
}
