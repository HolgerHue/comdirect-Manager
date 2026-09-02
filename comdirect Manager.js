// Variables used by Scriptable.
// These must be at the very top of the file. Do not edit.
// icon-color: deep-green; icon-glyph: coins;

/* ============================================================================
 * comdirect.js — Postbox, Finanz-, Wertpapier- und Steuerauswertung in einer App
 *
 * Zusammenführung von:
 *   • Comdirect_Postbox.js               (Download der Postbox-PDFs über die API)
 *   • Comdirect_Finanz_Report.js         (Auswertung der Finanzreports)
 *   • Comdirect_Jahressteuer_Manager.js  (Anlage KAP aus Jahressteuerbescheinigungen)
 *   • Wertpapier_Manager.js              (Trades, Positionen, Gebühren und Verlauf)
 *
 * Vollständig native Oberfläche auf Basis von UITable. Kein HTML, kein
 * sichtbarer WebView, keine Brücken-Nachrichten. Diagramme werden mit
 * DrawContext gezeichnet und als Bild in Zeilen gesetzt.
 *
 * Einzige Ausnahme: die Textextraktion aus PDF läuft über pdf.js in einem
 * unsichtbaren WebView, da Scriptable keine native PDF-Text-API besitzt.
 * Dieser WebView wird nie präsentiert.
 *
 * Ein einziger Ordner dient allen Teilen: dorthin lädt die Postbox ihre PDFs,
 * von dort liest die Auswertung die Finanzreports und die Jahressteuer-
 * bescheinigungen.
 *
 * Sämtliche App-Dateien liegen unterhalb desselben Ordners wie com_fm.ini.
 * Der PDF-Bestand kann alternativ über einen Scriptable-Dateibookmark liegen:
 *   Scriptable/comdirect/com_fm.ini      Konfiguration
 *   Scriptable/comdirect/Comdirect-postbox-settings.json  Postbox-Einstellungen
 *   Scriptable/comdirect/reports/*.pdf   PDFs aus der Postbox
 *   Scriptable/comdirect/export/*.csv    Ergebnisdateien und Backups
 *   Scriptable/comdirect/lib/            pdf.js-Cache (offline nach 1. Lauf)
 *   Scriptable/comdirect/*-cache.json     Analyse-Caches aller Bereiche
 *
 * Lizenz: Der Postbox-Teil steht unter GPL-3.0-or-later, der Finanzteil ist eine
 * Portierung von t4ri/Python-Finanzmanager (CC BY-NC-SA 4.0), der Steuerteil
 * stammt aus dem Jahressteuer Manager.
 * ========================================================================= */

const APP = "comdirect";
const VERSION = "4.0.0";

/* ------------------------------------------------------------ Comdirect-API */

const BASE_URL = "https://api.comdirect.de";
const SECRET_KEYS = {
  user: `${APP}.user`,
  pin: `${APP}.pin`,
  clientId: `${APP}.clientId`,
  clientSecret: `${APP}.clientSecret`,
};
// Ältere Schlüssel des Postbox-Scripts; werden beim ersten Start übernommen.
const LEGACY_SECRET_KEYS = {
  user: "ComdirectPostbox.user",
  pin: "ComdirectPostbox.pin",
  clientId: "ComdirectPostbox.clientId",
  clientSecret: "ComdirectPostbox.clientSecret",
};

/* --------------------------------------------------------------- PDF-Engine */

const PDFJS_VERSION = "3.11.174";
const PDFJS_LIB = `https://cdnjs.cloudflare.com/ajax/libs/pdf.js/${PDFJS_VERSION}/pdf.min.js`;
const PDFJS_WORKER = `https://cdnjs.cloudflare.com/ajax/libs/pdf.js/${PDFJS_VERSION}/pdf.worker.min.js`;

// Abstand in PDF-Punkten, ab dem zwischen zwei Textfragmenten ein Leerzeichen
// eingefügt wird. Bei falsch zusammengesetzten Zeilen hier justieren.
const SPACE_GAP = 1.0;

/* ------------------------------------------------------------- Grundwerte */

const DEFAULTS = {
  // Download
  useSubfolders: true,
  skipExisting: true,
  includeAdvertisements: false,
  archiveFilter: "all", // all | archivedOnly | notArchivedOnly
  filenameFilterEnabled: false,
  filenamePrefixes: [
    "Finanzreport", "Jahressteuerbescheinigung", "Wertpapierabrechnung",
    "Steuermitteilung", "Gutschrift", "Dividendengutschrift", "Ertragsgutschrift",
  ],
  startDate: "",
  endDate: "",
  pageSize: 500,
  // Auswertung
  reportPattern: "Finanzreport",
  gap: SPACE_GAP,
  appearance: "system", // system | light | dark
  // Jahressteuerbescheinigungen
  taxPattern: "Jahressteuer",
  allowanceLimit: 1000,
  // Wertpapierabrechnungen
  tradePattern: "Wertpapierabrechnung",
};

/**
 * Felder der Jahressteuerbescheinigung mit ihrer Zeile in der Anlage KAP.
 * Reihenfolge und Beschriftung entsprechen dem amtlichen Vordruck.
 */
const FIELD_META = [
  ["capital", "Kapitalerträge", "Zeile 7", "Kapitalerträge nach Teilfreistellung"],
  ["stockGain", "Aktiengewinne", "Zeile 8", "Gewinn aus Aktienveräußerungen"],
  ["options", "Stillhalterprämien / Termingeschäfte", "Zeile 9", "Stillhalterprämien und Termingeschäfte"],
  ["oldShares", "Alt-Anteile Gewinne", "Zeile 10", "Bestandsgeschützte Alt-Anteile"],
  ["substitute", "Ersatzbemessungsgrundlage", "Zeile 11", "Ersatzbemessungsgrundlage"],
  ["lossOther", "Nicht ausgeglichene Verluste", "Zeile 12", "Ohne Aktienverluste"],
  ["lossStock", "Aktienverluste", "Zeile 13", "Nicht ausgeglichene Aktienverluste"],
  ["loss20_6_5", "Verluste §20 Abs.6 S.5", "Zeile 14", "Verlust nach §20 Abs.6 Satz 5"],
  ["loss20_6_6", "Verluste §20 Abs.6 S.6", "Zeile 15", "Verlust nach §20 Abs.6 Satz 6"],
  ["allowance", "Sparer-Pauschbetrag", "Zeile 16/17", "In Anspruch genommener Sparer-Pauschbetrag"],
  ["tax", "Kapitalertragsteuer", "Zeile 37", "Einbehaltene Kapitalertragsteuer"],
  ["soli", "Solidaritätszuschlag", "Zeile 38", "Solidaritätszuschlag"],
  ["church", "Kirchensteuer", "Zeile 39", "Kirchensteuer zur Kapitalertragsteuer"],
  ["foreignCredited", "Ausländische Steuer angerechnet", "Zeile 40", "Angerechnete ausländische Steuer"],
  ["foreignOpen", "Ausländische Steuer anrechenbar", "Zeile 41", "Noch nicht angerechnete ausländische Steuer"],
  ["foreignFictive", "Fiktive ausländische Quellensteuer", "Zeile 42", "Fiktive ausländische Quellensteuer"],
  ["taxableNoWithholding", "Erträge ohne KapESt-Abzug", "Hinweis", "Einkommensteuerpflichtige Erträge ohne Kapitalertragsteuer"],
];

// Dokumentarten für den Filter in der Dokumentliste.
const DOCUMENT_TYPES = DEFAULTS.filenamePrefixes.slice();

const ARCHIVE_LABELS = {
  all: "Alle",
  archivedOnly: "Nur archivierte",
  notArchivedOnly: "Nur nicht archivierte",
};

const DEFAULT_INI = `# comdirect – Konfiguration
# Format:  Gruppenname : schluesselwort1,schluesselwort2,...
# Reihenfolge zaehlt: die erste passende Gruppe gewinnt.
# Kurze Schluesselwoerter koennen laengere spaetere unterdruecken
# ("markt" verhindert das Finden von "kaufmarkt").

# Startjahr der Auswertung (kann in der App umgeschaltet werden)
jahr : ${new Date().getFullYear()}

# Nur PDFs mit diesem Text im Dateinamen werden als Finanzreport ausgewertet.
# Leer lassen, um jede PDF im Ordner zu lesen.
muster : ${DEFAULTS.reportPattern}

# PDFs mit diesem Text im Namen werden als Jahressteuerbescheinigung gelesen.
steuermuster : ${DEFAULTS.taxPattern}

# PDFs mit diesem Text im Namen werden als Wertpapierabrechnung ausgewertet.
wertpapiermuster : ${DEFAULTS.tradePattern}

# Referenzwert fuer die Auslastung des Sparer-Pauschbetrags
pauschbetrag : ${DEFAULTS.allowanceLimit}

Investment : wertpapier,kupon,bank,ertraegnis,secupay,treuhand,funding,projekt,tagesgeld,holding,dabbnp,consors,invest,broker,zinszahung,investment
Online Ausgaben : paypal,amazon,internet,online,greatnet
Spende : spende
Friseur : friseur
Kleidung/Schuhe : schuh,p+c,galeria,s.oliver,jeans,esprit,streetone,modehaus,fashion,gabor,h&h,citystyle
Energie/Wasser : stadtwerke,wasser,strom,heizung,heizöl,heizoel
Gebühren : stadt,landkreis,staedtisch,städtisch,rathaus,komune,comune,landratsamt,post,polizei,polic
Steuern : finanzamt,steuer
Lotterie : lotto,aktionmensch
Arzt/Medikamente : apotheke,optik,aerzte,fielmann,apo,therapie,dr.,praxis,agricola,health,labor,klinik,medal,krankenhaus,brille
Drogerie : parfuem,douglas,rossmann,drogerie
Versicherung : universa,versicherung,huk,cosmos,krankenkasse
Entertainment : audible,netflix,spotify,video,music,musik,ard,zdf,rundfunk
Zeitung/Bücher : intanservice,thalia
Telefon : e-plus,telekom,1&1,vodafon
Urlaub/Reisen : hotel,dbvertrieb,bahn,wohnen
Möbel : ikea,xxxlutz,möbel,hoeffner,kibek,moemax,moebel,butlers
Wein : wein,vino
Restaurant : gasthaus,gasthof,steakhaus,raststaette,rasthaus,gastronom,mcdonald,braeu,bräu,ristorant,rist.,restaurant,pizzeria,burger,sangamer,kafe,cafe,kaffee,pizza,dean&david,hansimglueck,dinzler,genuss
Kreditkarte : visa,american
Kinder : bundesagentur
Geschenke : muttertag
Haus/Baumarkt/Garten : baumarkt,obi,hornbach,dehner,garten,baumschule,bauhaus,gaertnerei,tupper,viessmann
Auto/Tanken : kfz,station,werkstatt,tankstelle,omv,aral,esso,agip,oil,jet,shell,parken,stahlgruber,trost,autoh.,autohaus
Lebensmittel : rewe,aldi,edeka,norma,combi,e-center,ecenter,globus,lidl,coop,penny,kaufland,nahkauf,bäcker,baecker,brot,superm,markt,skonto,sconto,spar,metzger,fleischer,getraenke,getränke,fressnapf,beeren,grill,migross,speck,blumen,fisch
Vereine/Sport : verein,sport,tennis,fussball,stadler,mitglied,fahrrad
Öffentl. Verkehr : vag,öpnv
Barabhebung : geldautomat,sparkasse,hvb,bargeld,auszahlung
Bankgebühren : kartenverf,abschluss,entgelt,einzug
`;

/* ---------------------------------------------------------------- Dateisystem */

// Bewusst lokal als Basis: keine iCloud-Abhängigkeit beim Start.
const fm = FileManager.local();
// Nur für die einmalige Übernahme älterer Installationen. Die aktuelle
// Konfiguration hat genau eine Quelle: com_fm.ini im Arbeitsordner.
const LEGACY_CONFIG_KEY = `${APP}.settings.v1`;
let cloudFm = null;
try { cloudFm = FileManager.iCloud(); } catch (e) { cloudFm = null; }

function managerForPath(path) {
  if (cloudFm) {
    try {
      const root = cloudFm.documentsDirectory();
      if (path === root || path.startsWith(root + "/")) return cloudFm;
      if (/Mobile Documents|iCloud/i.test(path)) return cloudFm;
      if (cloudFm.fileExists(path) && !fm.fileExists(path)) return cloudFm;
    } catch (e) { /* lokal weiterarbeiten */ }
  }
  return fm;
}

async function setupDirs() {
  const root = fm.joinPath(fm.documentsDirectory(), APP);
  const d = {
    root,
    reports: fm.joinPath(root, "reports"),
    exportDir: fm.joinPath(root, "export"),
    lib: fm.joinPath(root, "lib"),
    ini: fm.joinPath(root, "com_fm.ini"),
    postboxSettings: fm.joinPath(root, "Comdirect-postbox-settings.json"),
    cache: fm.joinPath(root, "bookings-cache.json"),
    taxCache: fm.joinPath(root, "steuer-cache.json"),
    tradeCache: fm.joinPath(root, "wertpapier-cache.json"),
  };
  for (const p of [d.root, d.reports, d.exportDir, d.lib]) {
    if (!fm.fileExists(p)) fm.createDirectory(p, true);
  }
  migrateLegacyTradeData(d);
  let saved = fm.fileExists(d.ini) ? fm.readString(d.ini) : null;
  // Alte Keychain-Kopie nur verwenden, wenn noch keine INI existiert.
  try {
    if (!saved && Keychain.contains(LEGACY_CONFIG_KEY)) saved = Keychain.get(LEGACY_CONFIG_KEY);
  } catch (e) { saved = null; }
  if (!saved) saved = migrateLegacyConfig(d);
  saved = normalizeWorkspaceConfig(saved);
  fm.writeString(d.ini, saved);
  writePostboxSettings(d, saved);
  return d;
}

/** Übernimmt vorhandene PDFs des bisherigen eigenständigen Wertpapier-Managers. */
function migrateLegacyTradeData(d) {
  try {
    const legacyRoot = fm.joinPath(fm.documentsDirectory(), "wertpapier-manager");
    const legacyReports = fm.joinPath(legacyRoot, "abrechnungen");
    if (!fm.fileExists(legacyReports) || !fm.isDirectory(legacyReports)) return;
    for (const relative of listPdfs(legacyReports)) {
      const name = relative.split("/").pop();
      if (!/wertpapierabrechnung.*\.pdf$/i.test(name)) continue;
      const sourcePath = fm.joinPath(legacyReports, relative);
      const targetPath = fm.joinPath(d.reports, name);
      if (!fm.fileExists(targetPath)) fm.copy(sourcePath, targetPath);
    }
  } catch (e) { /* Alte Installation bleibt unverändert erhalten. */ }
}

// Hält die INI als Textquelle stabil. PDF-Ordner dürfen über einen dauerhaft
// freigegebenen Scriptable-Dateibookmark außerhalb des Arbeitsordners liegen.
function normalizeWorkspaceConfig(text) {
  return String(text || DEFAULT_INI);
}

/**
 * Übernimmt beim ersten Start die Konfiguration der beiden Vorgängerscripte:
 * die com_fm.ini des Finanzmanagers und die JSON-Einstellungen der Postbox.
 */
function migrateLegacyConfig(d) {
  let text = DEFAULT_INI;
  try {
    const old = fm.joinPath(fm.joinPath(fm.documentsDirectory(), "finanzmanager"), "com_fm.ini");
    if (fm.fileExists(old)) {
      const content = fm.readString(old);
      if (content && content.trim()) text = content;
    }
  } catch (e) { /* Standard verwenden */ }
  try {
    const oldTax = fm.joinPath(fm.joinPath(fm.documentsDirectory(), "jahressteuer-manager"), "settings.json");
    if (fm.fileExists(oldTax)) {
      const s = JSON.parse(fm.readString(oldTax)) || {};
      const lines = [];
      if (Number(s.allowanceLimit) > 0) lines.push(`pauschbetrag : ${Number(s.allowanceLimit)}`);
      if (s.appearance) lines.push(`darstellung : ${s.appearance}`);
      if (lines.length) text = lines.join("\n") + "\n" + text;
    }
  } catch (e) { /* Standard verwenden */ }
  try {
    const legacyJson = fm.joinPath(fm.documentsDirectory(), "comdirect-postbox-settings.json");
    const jsonPath = [d.postboxSettings, legacyJson].find((p) => p && fm.fileExists(p));
    if (jsonPath) {
      const s = JSON.parse(fm.readString(jsonPath)) || {};
      const lines = [];
      if (s.startDate) lines.push(`startdatum : ${s.startDate}`);
      if (s.endDate) lines.push(`enddatum : ${s.endDate}`);
      if (s.archiveFilter) lines.push(`archiv : ${s.archiveFilter}`);
      if (Array.isArray(s.filenamePrefixes) && s.filenamePrefixes.length) {
        lines.push(`praefixe : ${s.filenamePrefixes.join(",")}`);
      }
      lines.push(`dateifilter : ${s.filenameFilterEnabled ? "ein" : "aus"}`);
      lines.push(`werbung : ${s.includeAdvertisements ? "ein" : "aus"}`);
      lines.push(`unterordner : ${s.useSubfolders === false ? "aus" : "ein"}`);
      lines.push(`ueberspringen : ${s.skipExisting === false ? "aus" : "ein"}`);
      if (s.pageSize) lines.push(`seitengroesse : ${s.pageSize}`);
      if (s.theme) lines.push(`darstellung : ${s.theme}`);
      if (s.storageMode === "bookmark" && s.bookmarkName) lines.push(`pfad : bookmark:${s.bookmarkName}`);
      text = lines.join("\n") + "\n" + text;
    }
  } catch (e) { /* Standard verwenden */ }
  return text;
}

function readConfig(d) {
  return fm.fileExists(d.ini) ? fm.readString(d.ini) : DEFAULT_INI;
}

function writeConfig(d, text) {
  const value = normalizeWorkspaceConfig(text);
  fm.writeString(d.ini, value);
  writePostboxSettings(d, value);
}

/**
 * Schreibt eine lesbare Postbox-Konfiguration neben com_fm.ini. Geheimnisse
 * bleiben bewusst außen vor und werden weiterhin ausschließlich im Keychain gespeichert.
 */
function writePostboxSettings(d, textOrSettings) {
  try {
    const s = typeof textOrSettings === "string" ? readIni(textOrSettings) : textOrSettings;
    if (!s || !d.postboxSettings) return;
    let storageMode = "local", bookmarkName = "";
    if (s.path === "icloud") storageMode = "icloud";
    else if (String(s.path || "").startsWith("bookmark:")) {
      storageMode = "bookmark";
      bookmarkName = String(s.path).slice(9);
    } else if (String(s.path || "").startsWith("/")) storageMode = "folder";
    const data = {
      version: 1,
      startDate: s.startDate || "",
      endDate: s.endDate || "",
      archiveFilter: s.archiveFilter || "all",
      filenameFilterEnabled: !!s.filenameFilterEnabled,
      filenamePrefixes: Array.isArray(s.filenamePrefixes) ? s.filenamePrefixes : [],
      includeAdvertisements: !!s.includeAdvertisements,
      useSubfolders: s.useSubfolders !== false,
      skipExisting: s.skipExisting !== false,
      pageSize: Number(s.pageSize) || DEFAULTS.pageSize,
      storageMode,
      bookmarkName,
      storageRef: s.path || "",
    };
    const json = JSON.stringify(data, null, 2);
    fm.writeString(d.postboxSettings, json);
  } catch (e) { /* com_fm.ini bleibt die führende Konfiguration */ }
}

function readBookingsCache(d, sourceRef) {
  try {
    if (!fm.fileExists(d.cache)) return null;
    const data = JSON.parse(fm.readString(d.cache));
    if (data.sourceRef !== sourceRef || !Array.isArray(data.bookings)) return null;
    return data;
  } catch (e) { return null; }
}

function writeBookingsCache(d, sourceRef, list, files) {
  if (!list || !list.length) return;
  fm.writeString(d.cache, JSON.stringify({
    version: 1,
    savedAt: new Date().toISOString(),
    sourceRef,
    bookings: list,
    files: files || [],
  }));
}

async function ensureDownloaded(path) {
  const owner = managerForPath(path);
  if (owner === cloudFm && !owner.isFileDownloaded(path)) {
    await owner.downloadFileFromiCloud(path);
  }
  return path;
}

// Durchsucht auch Unterordner (z. B. Jahreszahlen) bis Tiefe 2 und liefert
// relative Pfade wie "2024/pdf/report_01.pdf" zurück.
function listPdfs(dir, depth) {
  const m = managerForPath(dir);
  let names;
  try {
    names = m.listContents(dir);
  } catch (e) {
    return [];
  }
  let out = [];
  for (const n of names) {
    if (n.startsWith(".")) continue;
    const p = m.joinPath(dir, n);
    let isDir = false;
    try { isDir = m.isDirectory(p); } catch (e) { isDir = false; }
    if (isDir) {
      if ((depth || 0) < 2) {
        out = out.concat(listPdfs(p, (depth || 0) + 1).map((s) => n + "/" + s));
      }
    } else if (n.toLowerCase().endsWith(".pdf")) {
      out.push(n);
    }
  }
  return out.sort();
}

function shortPath(p) {
  const parts = p.split("/").filter(Boolean);
  return parts.slice(-2).join("/") || p;
}

function fileBookmarkOptions() {
  try {
    const seen = {};
    return (fm.allFileBookmarks() || [])
      .filter((b) => b && b.name && !seen[b.name] && (seen[b.name] = true))
      .map((b) => {
        try { return { name: b.name, path: fm.bookmarkedPath(b.name) }; }
        catch (e) { return null; }
      })
      .filter((b) => b && b.path && fm.fileExists(b.path) && fm.isDirectory(b.path));
  } catch (e) {
    return [];
  }
}

function sanitizeName(value) {
  return String(value).replace(/[\\/:*?"<>|\u0000-\u001F]/g, "_").replace(/[. ]+$/g, "").slice(0, 180) || "Dokument";
}

function validateDateInput(value) {
  const v = String(value || "").trim();
  if (v && !/^\d{4}-\d{2}-\d{2}$/.test(v)) throw new Error(`Ungültiges Datum: ${v}`);
  return v;
}

/* --------------------------------------------- Gemeinsamer PDF-Ordner */

/**
 * Standardmäßig liegt der PDF-Bestand in "reports" neben com_fm.ini. Optional
 * darf ausschließlich der PDF-Bestand über einen Scriptable-Dateibookmark in
 * einem externen Ordner liegen. Alle App-Dateien verbleiben beim INI-Ordner.
 */
function resolveStorage(d, raw) {
  const fallback = { path: d.reports, label: `${APP}/reports`, ref: "" };
  const ref = String(raw || "").trim();
  if (!ref) return fallback;
  if (ref.startsWith("bookmark:")) {
    const name = ref.slice(9).trim();
    try {
      const path = fm.bookmarkedPath(name);
      if (path && fm.fileExists(path) && fm.isDirectory(path)) {
        return { path, label: `Bookmark „${name}“`, ref };
      }
    } catch (e) { /* Bookmark fehlt oder wurde entzogen. */ }
    return { path: d.reports, label: `Bookmark „${name}“ nicht verfügbar`, ref, unavailable: true };
  }
  // Alte absolute Pfade werden nicht stillschweigend weiterverwendet, weil
  // ihr Zugriff nach einem Neustart nicht zuverlässig ist.
  return fallback;
}

function saveSourceRef(d, ref) {
  setIniValue(d, "pfad", ref || "");
}

async function importPdfs(d, target) {
  let picked = [];
  try {
    picked = await DocumentPicker.open(["com.adobe.pdf", "public.item"]);
  } catch (e) {
    return 0;
  }
  const dir = target || d.reports;
  const owner = managerForPath(dir);
  let n = 0;
  for (const src of picked) {
    if (!src.toLowerCase().endsWith(".pdf")) continue;
    await ensureDownloaded(src);
    const dest = owner.joinPath(dir, src.split("/").pop());
    if (owner.fileExists(dest)) owner.remove(dest);
    owner.write(dest, managerForPath(src).read(src));
    n++;
  }
  return n;
}

// Direkte Auswahl aus den Einstellungen; kein zusätzliches Aktions-Popup.
async function chooseSource(d, mode) {
  if (mode === "local") {
    saveSourceRef(d, "");
    return resolveStorage(d, "");
  }
  if (mode === "bookmark") {
    const options = fileBookmarkOptions();
    if (!options.length) {
      await alert("Kein Datei-Bookmark",
        "Lege in den Scriptable-Einstellungen unter Datei-Bookmarks zuerst einen Ordner an.");
      return null;
    }
    const current = cfg && String(cfg.path || "").startsWith("bookmark:") ? String(cfg.path).slice(9) : "";
    const name = await pickOption("PDF-Bookmark auswählen",
      options.map((x) => ({ label: x.name, value: x.name })), current);
    if (name === null) return null;
    const ref = "bookmark:" + name;
    saveSourceRef(d, ref);
    return resolveStorage(d, ref);
  }
  if (mode === "import") {
    const current = resolveStorage(d, cfg ? cfg.path : "");
    const target = current.unavailable ? d.reports : current.path;
    const n = await importPdfs(d, target);
    if (!n) return null;
    if (current.unavailable) {
      saveSourceRef(d, "");
      return resolveStorage(d, "");
    }
    return current;
  }
  return null;
}

/* ------------------------------------------------------------------- Konfig */

const SETTING_KEYS = [
  // Auswertung und Darstellung
  "jahr", "monat", "pfad", "start", "bereich", "ansicht", "abstand", "darstellung", "muster",
  // Jahressteuerbescheinigungen
  "steuermuster", "pauschbetrag", "steuerjahr", "steueransicht",
  // Wertpapierabrechnungen
  "wertpapiermuster", "wertpapierjahr", "wertpapieransicht",
  // Download
  "startdatum", "enddatum", "archiv", "dateifilter", "praefixe", "werbung",
  "unterordner", "ueberspringen", "seitengroesse",
];

function iniBool(value, fallback) {
  const v = String(value || "").trim().toLowerCase();
  if (["ein", "ja", "an", "true", "1"].indexOf(v) >= 0) return true;
  if (["aus", "nein", "false", "0"].indexOf(v) >= 0) return false;
  return fallback;
}

// Entspricht readini() im Original, erweitert um die Download-Einstellungen.
function readIni(text) {
  const groups = new Map();
  const settings = {
    year: null,
    month: 0,
    path: "",
    startMode: "last",
    section: "report",
    tab: "groups",
    gap: DEFAULTS.gap,
    appearance: DEFAULTS.appearance,
    reportPattern: DEFAULTS.reportPattern,
    taxPattern: DEFAULTS.taxPattern,
    allowanceLimit: DEFAULTS.allowanceLimit,
    taxYear: null,
    taxTab: "overview",
    tradePattern: DEFAULTS.tradePattern,
    tradeYear: null,
    tradeTab: "overview",
    startDate: DEFAULTS.startDate,
    endDate: DEFAULTS.endDate,
    archiveFilter: DEFAULTS.archiveFilter,
    filenameFilterEnabled: DEFAULTS.filenameFilterEnabled,
    filenamePrefixes: DEFAULTS.filenamePrefixes.slice(),
    includeAdvertisements: DEFAULTS.includeAdvertisements,
    useSubfolders: DEFAULTS.useSubfolders,
    skipExisting: DEFAULTS.skipExisting,
    pageSize: DEFAULTS.pageSize,
  };
  for (const raw of text.split("\n")) {
    const line = raw.replace(/\r$/, "");
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const idx = line.indexOf(" : ");
    if (idx < 0) continue;
    const key = line.slice(0, idx).trim();
    const val = line.slice(idx + 3).trim();
    if (key === "pfad") { settings.path = val; continue; }
    if (key === "jahr") { settings.year = parseInt(val, 10) || null; continue; }
    if (key === "monat") { settings.month = parseInt(val, 10) || 0; continue; }
    if (key === "start") { settings.startMode = val === "latest" ? "latest" : "last"; continue; }
    if (key === "bereich") {
      settings.section = ["report", "securities", "tax", "postbox"].indexOf(val) >= 0 ? val : "report";
      continue;
    }
    if (key === "muster") { settings.reportPattern = val; continue; }
    if (key === "steuermuster") { settings.taxPattern = val; continue; }
    if (key === "wertpapiermuster") { settings.tradePattern = val; continue; }
    if (key === "wertpapierjahr") { settings.tradeYear = parseInt(val, 10) || null; continue; }
    if (key === "wertpapieransicht") {
      settings.tradeTab = ["overview", "history", "positions", "documents"].indexOf(val) >= 0 ? val : "overview";
      continue;
    }
    if (key === "steuerjahr") { settings.taxYear = parseInt(val, 10) || null; continue; }
    if (key === "steueransicht") {
      settings.taxTab = ["overview", "history", "kap"].indexOf(val) >= 0 ? val : "overview";
      continue;
    }
    if (key === "pauschbetrag") {
      const v = parseFloat(val.replace(/\./g, "").replace(",", "."));
      if (!isNaN(v) && v > 0) settings.allowanceLimit = v;
      continue;
    }
    if (key === "startdatum") { settings.startDate = /^\d{4}-\d{2}-\d{2}$/.test(val) ? val : ""; continue; }
    if (key === "enddatum") { settings.endDate = /^\d{4}-\d{2}-\d{2}$/.test(val) ? val : ""; continue; }
    if (key === "archiv") {
      settings.archiveFilter = Object.keys(ARCHIVE_LABELS).indexOf(val) >= 0 ? val : "all";
      continue;
    }
    if (key === "dateifilter") { settings.filenameFilterEnabled = iniBool(val, false); continue; }
    if (key === "werbung") { settings.includeAdvertisements = iniBool(val, false); continue; }
    if (key === "unterordner") { settings.useSubfolders = iniBool(val, true); continue; }
    if (key === "ueberspringen") { settings.skipExisting = iniBool(val, true); continue; }
    if (key === "seitengroesse") {
      const n = parseInt(val, 10);
      if (n > 0) settings.pageSize = Math.max(1, Math.min(1000, n));
      continue;
    }
    if (key === "praefixe") {
      const list = val.split(",").map((s) => s.trim()).filter(Boolean);
      settings.filenamePrefixes = list;
      continue;
    }
    if (key === "darstellung") {
      settings.appearance = ["light", "system", "dark"].indexOf(val) >= 0 ? val : "system";
      continue;
    }
    if (key === "ansicht") {
      settings.tab = ["groups", "bookings", "months", "files"].indexOf(val) >= 0 ? val : "groups";
      continue;
    }
    if (key === "abstand") {
      const g = parseFloat(val.replace(",", "."));
      if (!isNaN(g) && g > 0) settings.gap = g;
      continue;
    }
    const words = val
      .toLowerCase()
      .replace(/,,/g, ",")
      .replace(/,+$/, "")
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
    if (words.length) groups.set(key, words);
  }
  // Sammler zum Schluss, damit sie erst nach allen Gruppen greifen
  groups.set("Einnahmen div.", "+");
  groups.set("Ausgaben div.", "-");
  settings.groups = groups;
  return settings;
}

// Setzt bzw. entfernt einen einzelnen Schlüssel in com_fm.ini,
// ohne die Gruppenzeilen anzurühren.
function setIniValue(d, key, value) {
  const lines = readConfig(d).split("\n");
  const idx = lines.findIndex((l) => l.startsWith(key + " : ") || l.trim() === key + " :");
  if (value === null || value === "") {
    if (idx >= 0) lines.splice(idx, 1);
  } else if (idx >= 0) {
    lines[idx] = `${key} : ${value}`;
  } else {
    lines.unshift(`${key} : ${value}`);
  }
  writeConfig(d, lines.join("\n"));
}

// Gruppenzeilen der ini in ihrer Reihenfolge – Grundlage des Gruppen-Editors.
function iniGroups(d) {
  const out = [];
  for (const raw of readConfig(d).split("\n")) {
    const line = raw.replace(/\r$/, "");
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const idx = line.indexOf(" : ");
    if (idx < 0) continue;
    const key = line.slice(0, idx).trim();
    if (SETTING_KEYS.indexOf(key.toLowerCase()) >= 0) continue;
    const words = line.slice(idx + 3).trim().toLowerCase()
      .split(",").map((s) => s.trim()).filter(Boolean);
    if (words.length) out.push({ name: key, words });
  }
  return out;
}

// Schreibt den Gruppenblock zurück und lässt Kommentare und Einstellungen stehen.
function writeIniGroups(d, list) {
  const lines = readConfig(d).split("\n");
  const block = list.map((g) => `${g.name} : ${g.words.join(",")}`);
  const kept = [];
  let inserted = false;
  for (const raw of lines) {
    const line = raw.replace(/\r$/, "");
    const trimmed = line.trim();
    const idx = line.indexOf(" : ");
    const key = idx >= 0 ? line.slice(0, idx).trim() : "";
    const isGroup = idx >= 0 && trimmed && !trimmed.startsWith("#") &&
      SETTING_KEYS.indexOf(key.toLowerCase()) < 0;
    if (isGroup) {
      if (!inserted) { kept.push(...block); inserted = true; }
      continue;
    }
    kept.push(line);
  }
  if (!inserted) { kept.push(""); kept.push(...block); }
  writeConfig(d, kept.join("\n"));
}

/* ================================================== Comdirect-API-Zugang === */

class HttpError extends Error {
  constructor(message, status, body) {
    super(message);
    this.name = "HttpError";
    this.status = status;
    this.body = body;
  }
}

/**
 * FIX 1: requestId muss pro Request eindeutig sein.
 * comdirect erwartet genau 9 Ziffern; die letzten 9 Stellen des
 * Millisekunden-Timestamps sind der übliche und eindeutige Wert.
 */
function requestInfoHeader(sessionId) {
  return JSON.stringify({
    clientRequestId: {
      sessionId: String(sessionId),
      requestId: String(Date.now()).slice(-9),
    },
  });
}

function randomHex(bytes) {
  let out = "";
  for (let i = 0; i < bytes; i++) {
    out += (Math.floor(Math.random() * 256) + 256).toString(16).slice(-2);
  }
  return out;
}

function formEncode(obj) {
  return Object.keys(obj)
    .map((k) => `${encodeURIComponent(k)}=${encodeURIComponent(String(obj[k]))}`)
    .join("&");
}

function headerValue(headers, name) {
  if (!headers) return "";
  const wanted = String(name).toLowerCase();
  const key = Object.keys(headers).find((k) => String(k).toLowerCase() === wanted);
  return key ? headers[key] : "";
}

/** Liest den Freigabestatus aus dem Header oder Body der Status-Abfrage. */
function extractAuthStatus(raw) {
  if (!raw) return "";
  try {
    const parsed = typeof raw === "string" ? JSON.parse(raw) : raw;
    const status = parsed.status
      || (parsed.authenticationInfo && parsed.authenticationInfo.status)
      || (parsed.clientRequestId && parsed.clientRequestId.status)
      || "";
    return String(status).toUpperCase();
  } catch (_) {
    const m = String(raw).match(/"status"\s*:\s*"([A-Z_]+)"/i);
    return m ? m[1].toUpperCase() : "";
  }
}

function apiErrorMessage(status, body, headers) {
  let detail = headerValue(headers, "x-http-response-info") || body || "";
  try {
    const parsed = JSON.parse(detail);
    if (parsed.error_description) detail = parsed.error_description;
    else if (parsed.error) detail = parsed.error;
    else if (parsed.message) detail = parsed.message;
    else if (Array.isArray(parsed.messages)) {
      detail = parsed.messages.map((m) => m.message || m.key).join(" · ");
    }
  } catch (_) { /* Klartext beibehalten */ }
  const hint =
    status === 401 ? " Sitzung abgelaufen oder Client-ID/Secret falsch." :
    status === 400 ? " Zugangsdaten bzw. Anfrage prüfen." :
    status === 422 ? " Die TAN-Challenge ist möglicherweise abgelaufen." :
    status === 429 ? " Zu viele Anfragen – bitte später erneut versuchen." : "";
  return `Comdirect-API: HTTP ${status}${detail ? ` – ${String(detail).slice(0, 400)}` : ""}.${hint}`;
}

/**
 * Einheitlicher HTTP-Aufruf. Kein Content-Type ohne Body (FIX 4).
 * binary=true liefert Data statt String zurück.
 */
async function httpRequest(method, path, options = {}) {
  const url = /^https?:/.test(path) ? path : BASE_URL + path;
  const req = new Request(url);
  req.method = method;
  req.timeoutInterval = options.timeout || 60;

  const headers = Object.assign({ Accept: options.accept || "application/json" }, options.headers || {});
  if (options.form) {
    headers["Content-Type"] = "application/x-www-form-urlencoded";
    req.body = formEncode(options.form);
  } else if (options.json !== undefined) {
    headers["Content-Type"] = "application/json";
    req.body = JSON.stringify(options.json);
  }
  // Scriptable reicht dieses Objekt an die native URLSession weiter:
  // vollständig aufbauen und genau einmal zuweisen.
  req.headers = headers;

  let payload;
  try {
    payload = options.binary ? await req.load() : await req.loadString();
  } catch (error) {
    throw new HttpError(
      `Netzwerkfehler: ${String(error && error.message || error)}`,
      Number(req.response && req.response.statusCode) || 0,
      ""
    );
  }

  const response = req.response || {};
  const status = Number(response.statusCode) || 0;
  if (status < 200 || status >= 300) {
    const body = options.binary ? "" : payload;
    throw new HttpError(apiErrorMessage(status, body, response.headers), status, body);
  }
  return { payload, status, headers: response.headers || {} };
}

class ComdirectApi {
  constructor(credentials) {
    this.user = credentials.user;
    this.pin = credentials.pin;
    this.clientId = credentials.clientId;
    this.clientSecret = credentials.clientSecret;

    this.sessionId = randomHex(16); // 32 Zeichen, comdirect-Limit
    this.accessToken = null;
    this.refreshToken = null;
    this.tokenExpiresAt = 0;
    this.sessionIdentifier = null;
    this.refreshing = null;
  }

  authHeaders(extra) {
    return Object.assign({
      Authorization: `Bearer ${this.accessToken}`,
      "x-http-request-info": requestInfoHeader(this.sessionId),
    }, extra || {});
  }

  setTokens(data) {
    this.accessToken = data.access_token;
    if (data.refresh_token) this.refreshToken = data.refresh_token;
    const lifetime = Number(data.expires_in) || 599;
    this.tokenExpiresAt = Date.now() + lifetime * 1000;
  }

  tokenIsStale() {
    // 45 s Sicherheitspuffer, damit ein laufender Download nicht mitten
    // im Request in ein 401 läuft.
    return !this.accessToken || Date.now() > this.tokenExpiresAt - 45000;
  }

  /**
   * FIX 2: Refresh-Token-Flow. Der Access-Token gilt nur 10 Minuten,
   * der Refresh-Token 20. Ohne diesen Schritt bricht jeder Download mit
   * mehr als ~10 Minuten Laufzeit mit HTTP 401 ab.
   */
  async refreshAccessToken() {
    if (!this.refreshToken) throw new HttpError("Kein Refresh-Token vorhanden – erneute Anmeldung nötig.", 401, "");
    if (this.refreshing) return this.refreshing;
    this.refreshing = (async () => {
      const { payload } = await httpRequest("POST", "/oauth/token", {
        form: {
          client_id: this.clientId,
          client_secret: this.clientSecret,
          grant_type: "refresh_token",
          refresh_token: this.refreshToken,
        },
      });
      const data = JSON.parse(payload);
      if (!data.access_token) throw new HttpError("Refresh lieferte keinen Access-Token.", 401, payload);
      this.setTokens(data);
      console.log("Access-Token erneuert.");
    })();
    try { await this.refreshing; } finally { this.refreshing = null; }
  }

  /** Authentifizierter Aufruf mit automatischem Refresh und einmaligem Retry. */
  async authorized(method, path, options = {}) {
    if (this.tokenIsStale() && this.refreshToken) {
      try { await this.refreshAccessToken(); } catch (e) { console.warn(String(e.message || e)); }
    }
    const send = () => httpRequest(method, path, Object.assign({}, options, {
      headers: this.authHeaders(options.headers),
    }));
    try {
      return await send();
    } catch (error) {
      // FIX 7: 401 -> Token erneuern und genau einmal wiederholen.
      if (error instanceof HttpError && error.status === 401 && this.refreshToken) {
        await this.refreshAccessToken();
        return await send();
      }
      // 429/5xx: ein einziger verzögerter Versuch.
      if (error instanceof HttpError && (error.status === 429 || error.status >= 500)) {
        await sleep(2500);
        return await send();
      }
      throw error;
    }
  }

  async login(onProgress) {
    const progress = typeof onProgress === "function" ? onProgress : async () => {};

    await progress(3, "Anmeldung wird vorbereitet");
    const first = await httpRequest("POST", "/oauth/token", {
      form: {
        client_id: this.clientId,
        client_secret: this.clientSecret,
        grant_type: "password",
        username: this.user,
        password: this.pin,
      },
    });
    const firstData = JSON.parse(first.payload || "{}");
    if (!firstData.access_token) throw new HttpError("comdirect lieferte keinen ersten Access-Token.", 0, first.payload);
    this.setTokens(firstData);
    await progress(12, "OAuth-Zugang bestätigt");

    const sessions = await httpRequest("GET", "/api/session/clients/user/v1/sessions", {
      headers: this.authHeaders(),
    });
    const list = JSON.parse(sessions.payload || "[]");
    const session = Array.isArray(list) ? list[0] : null;
    if (!session || !session.identifier) throw new HttpError("comdirect lieferte keine verwendbare Session.", 0, sessions.payload);
    this.sessionIdentifier = session.identifier;
    await progress(20, "Session geladen");

    // FIX 6: nur die drei erwarteten Felder senden statt des kompletten Objekts.
    const sessionBody = {
      identifier: session.identifier,
      sessionTanActive: true,
      activated2FA: true,
    };

    const validation = await httpRequest(
      "POST",
      `/api/session/clients/user/v1/sessions/${encodeURIComponent(session.identifier)}/validate`,
      { headers: this.authHeaders(), json: sessionBody }
    );
    const onceRaw = headerValue(validation.headers, "x-once-authentication-info");
    let once = null;
    try { once = JSON.parse(onceRaw); } catch (_) { once = null; }
    if (!once || !once.id) throw new HttpError("Die comdirect-TAN-Challenge fehlt in der Antwort.", 0, onceRaw);
    await progress(28, "TAN-Freigabe erwartet");

    const tan = await handleTan(once);
    await progress(34, "TAN wird geprüft");

    await this.activateSession(session.identifier, once, tan, sessionBody, progress);
    await progress(42, "Session wurde aktiviert");

    const secondary = await httpRequest("POST", "/oauth/token", {
      form: {
        client_id: this.clientId,
        client_secret: this.clientSecret,
        grant_type: "cd_secondary",
        token: this.accessToken,
      },
    });
    const secondaryData = JSON.parse(secondary.payload || "{}");
    if (!secondaryData.access_token) throw new HttpError("Der CD-Secondary-Flow lieferte keinen Access-Token.", 0, secondary.payload);
    this.setTokens(secondaryData);
    await progress(48, "Anmeldung abgeschlossen");
  }

  /**
   * FIX 8 (Schritt 2.4): Der PATCH darf erst raus, wenn die Freigabe beim
   * comdirect-Server angekommen ist. Vorher liefert die API HTTP 400
   * "Die TAN-Freigabe über die App wurde noch nicht erteilt".
   *
   * Zwei Absicherungen:
   *  a) Status-Polling über den "link" aus x-once-authentication-info
   *  b) gestaffelte Wiederholung des PATCH
   *
   * Beides ausschließlich für P_TAN_PUSH. Dort wird keine TAN übertragen
   * (das Feld x-once-authentication entfällt), ein Wiederholversuch zählt
   * also nicht als Fehleingabe. Bei P_TAN und M_TAN wird genau einmal
   * gesendet – ein Retry mit einer echten TAN könnte den Zugang sperren.
   */
  async activateSession(identifier, once, tan, sessionBody, progress) {
    const isPush = once.typ === "P_TAN_PUSH";
    const path = `/api/session/clients/user/v1/sessions/${encodeURIComponent(identifier)}`;

    const send = () => {
      const headers = { "x-once-authentication-info": JSON.stringify({ id: once.id }) };
      if (tan) headers["x-once-authentication"] = tan; // bei P_TAN_PUSH bewusst leer
      return httpRequest("PATCH", path, { headers: this.authHeaders(headers), json: sessionBody });
    };

    if (!isPush) {
      await send();
      return;
    }

    const approved = await this.waitForPushApproval(once, progress);
    if (approved === false) {
      // Kein Status-Endpunkt verfügbar oder Zeit abgelaufen – trotzdem versuchen.
      await progress(36, "Freigabe wird geprüft");
    }

    const delays = [0, 3000, 5000, 8000, 12000, 15000];
    let lastError = null;
    for (let i = 0; i < delays.length; i++) {
      if (delays[i]) await sleep(delays[i]);
      try {
        await send();
        return;
      } catch (error) {
        lastError = error;
        const pending = error instanceof HttpError && error.status === 400;
        if (!pending) throw error;
        await progress(36, `Warte auf App-Freigabe (${i + 1}/${delays.length})`);
        console.log(`Freigabe noch nicht erteilt – Versuch ${i + 1}/${delays.length}`);
      }
    }
    throw new HttpError(
      "Die Freigabe in der photoTAN-App wurde nicht erkannt.\n\nBitte den Vorgang neu starten und die Freigabe in der App erteilen, bevor du im Dialog auf „Freigabe erteilt“ tippst. Es wurde keine TAN übertragen, der Zugang ist also nicht gefährdet.",
      400,
      lastError ? lastError.body : ""
    );
  }

  /**
   * Fragt den Status der TAN-Challenge ab. Der Link steht laut comdirect im
   * Header x-once-authentication-info aus Schritt 2.3. Ist er nicht vorhanden,
   * liefert die Methode false und der Aufrufer fällt auf die Wiederholstrategie
   * zurück.
   */
  async waitForPushApproval(once, progress) {
    const link = once.link || {};
    let href = String(link.href || link.url || "");
    if (!href) return false;
    if (!/^https?:/.test(href)) {
      if (!href.startsWith("/")) href = "/" + href;
      if (!href.startsWith("/api/")) href = "/api" + href;
    }
    const method = String(link.method || "GET").toUpperCase();

    const deadline = Date.now() + 90000;
    let polls = 0;
    while (Date.now() < deadline) {
      polls++;
      let status = "";
      try {
        const res = await httpRequest(method, href, { headers: this.authHeaders(), timeout: 20 });
        const info = headerValue(res.headers, "x-once-authentication-info");
        status = extractAuthStatus(info) || extractAuthStatus(res.payload);
      } catch (error) {
        // Status-Endpunkt kann 4xx liefern, solange nichts freigegeben wurde.
        if (!(error instanceof HttpError)) throw error;
        status = "";
      }
      if (status === "AUTHENTICATED") {
        console.log(`Freigabe nach ${polls} Abfragen erkannt.`);
        return true;
      }
      if (status === "REJECTED" || status === "DENIED" || status === "CANCELED") {
        throw new Error("Die Freigabe wurde in der photoTAN-App abgelehnt.");
      }
      await progress(35, `Warte auf Freigabe in der App (${polls})`);
      await sleep(2500);
    }
    return false;
  }

  /** FIX 5: sauberes Beenden der Session. */
  async logout() {
    if (!this.accessToken) return;
    try {
      await httpRequest("DELETE", "/oauth/revoke", { headers: this.authHeaders() });
      console.log("Session abgemeldet.");
    } catch (error) {
      console.warn(`Abmelden fehlgeschlagen: ${String(error.message || error)}`);
    } finally {
      this.accessToken = null;
      this.refreshToken = null;
    }
  }

  async documents(first, count) {
    const { payload } = await this.authorized(
      "GET",
      `/api/messages/clients/user/v2/documents?paging-first=${first}&paging-count=${count}`
    );
    return JSON.parse(payload || "{}");
  }

  async documentData(doc) {
    const { payload } = await this.authorized(
      "GET",
      `/api/messages/v2/documents/${encodeURIComponent(doc.documentId)}`,
      { binary: true, accept: doc.mimeType || "application/pdf", timeout: 90 }
    );
    return payload;
  }
}

/**
 * FIX 3: robustes Paging.
 * Es wird gelesen, bis eine Seite leer ist oder weniger als pageSize liefert.
 */
async function loadAllDocuments(api, pageSize, onProgress) {
  const size = Math.max(1, Math.min(1000, Math.round(Number(pageSize) || DEFAULTS.pageSize)));
  const all = [];
  let start = 0;
  let total = null;
  const maxPages = 200; // harte Obergrenze gegen Endlosschleifen

  for (let page = 0; page < maxPages; page++) {
    const data = await api.documents(start, size);
    const values = Array.isArray(data.values) ? data.values : [];
    if (total === null) {
      const matches = Number(data.paging && data.paging.matches);
      total = Number.isFinite(matches) && matches > 0 ? matches : null;
    }
    all.push(...values);

    const percent = total ? Math.min(100, Math.round(all.length / total * 100)) : 0;
    console.log(`Dokumentliste ${all.length}${total ? "/" + total : ""}`);
    if (typeof onProgress === "function") {
      await onProgress(percent, `Dokumentliste ${all.length}${total ? " von " + total : ""}`);
    }

    if (values.length < size) break;
    if (total !== null && all.length >= total) break;
    start += size;
  }
  return all;
}

/* --------------------------------------------------------- TAN-Behandlung */

async function handleTan(challenge) {
  const type = challenge.typ;
  if (type === "P_TAN_PUSH") {
    // Reihenfolge ist entscheidend: erst in der App freigeben, dann hier tippen.
    // Danach prüft das Script den Status zusätzlich selbst.
    await choose(
      "PushTAN freigeben",
      "1. Wechsle jetzt in die comdirect photoTAN-App\n2. Bestätige dort „Login persönlicher Bereich“\n3. Komm zurück und tippe unten auf „Freigabe erteilt“\n\nErst danach darf die Session aktiviert werden – sonst antwortet comdirect mit HTTP 400.",
      ["Freigabe erteilt"],
      null
    );
    return "";
  }
  if (type === "P_TAN") {
    if (challenge.challenge) {
      try {
        const image = Image.fromData(Data.fromBase64String(challenge.challenge));
        await QuickLook.present(image, true);
      } catch (_) { /* Bild optional */ }
    }
    return await securePrompt("PhotoTAN", "Challenge mit der photoTAN-App bzw. dem Lesegerät scannen und TAN eingeben.", "TAN");
  }
  if (type === "M_TAN") {
    return await securePrompt("MobileTAN", `SMS-TAN eingeben.${challenge.challenge ? `\nHinweis: ${challenge.challenge}` : ""}`, "TAN");
  }
  throw new Error(`Das TAN-Verfahren „${type || "unbekannt"}“ wird nicht unterstützt. Verfügbar: ${(challenge.availableTypes || []).join(", ")}`);
}

/* ------------------------------------------------------------ Zugangsdaten */

function getCredentials(allowIncomplete = false) {
  const value = {};
  for (const [name, key] of Object.entries(SECRET_KEYS)) {
    let stored = "";
    try {
      if (Keychain.contains(key)) stored = Keychain.get(key);
      else if (Keychain.contains(LEGACY_SECRET_KEYS[name])) {
        // Einmalige Übernahme aus dem früheren Postbox-Script.
        stored = Keychain.get(LEGACY_SECRET_KEYS[name]);
        Keychain.set(key, stored);
      }
    } catch (e) { stored = ""; }
    value[name] = stored;
  }
  return allowIncomplete || Object.values(value).every(Boolean) ? value : null;
}

/* ==================================================== Auswertung der PDFs === */

function str2float(val) {
  const s = String(val)
    .replace(/\s/g, "")
    .replace(/\./g, "")
    .replace(/\+/g, "")
    .replace(",", ".");
  const n = parseFloat(s);
  return isNaN(n) ? 0 : n;
}

// Zeile 1 einer Buchung:
// 02.06.2022 Lastschrift/ STADTWERKE KD.-NR.345,00-ABSCHLAG0 -91,00
const RE_BOOKING = /^(?<date>\d{2}\.\d{2}\.\d{4})\s+(?<type>[A-Za-zÄÖÜäöüß.]*)\s*\/?\s+(?<text>.*?)\s+(?<value>[+-]\s?\d{1,3}(?:\.\d{3})*,\d{2})$/;
// Folgezeile einer Buchung
const RE_BOOKING2 = /^(?<date>\d{2}\.\d{2}\.\d{4})\s+(?<type>[A-Za-zÄÖÜäöüß.]*)\s+(?<text>.*)$/;
// AlterSaldo 01.06.2022 +1.704,05   (Leerzeichen im Wort werden toleriert)
const RE_SALDO = /^(?<saldo>[A-Za-z]+\s?Saldo)\s+(?<date>\d{2}\.\d{2}\.\d{4})\s+(?<value>[+-]\s?\d{1,3}(?:\.\d{3})*,\d{2})$/;

// Entspricht findclass() im Original.
function findClass(groups, name, value) {
  for (const [key, cl] of groups) {
    if (typeof cl === "string") {
      const v = str2float(value);
      if (cl === "+" && v >= 0) return key;
      if (cl === "-" && v < 0) return key;
    } else {
      for (const word of cl) {
        if (name.indexOf(word) >= 0) return key;
      }
    }
  }
  return null;
}

// Entspricht readPDF() im Original – arbeitet auf bereits extrahierten Seiten.
function parseReport(fileName, pages, groups, out) {
  let saldo = 0;
  let stop = false;
  let item = null;
  let delta = null;

  const commit = () => {
    if (!item) return;
    const haystack = item.typ + " / " + item.name;
    const group = findClass(groups, haystack, item.value) || "unbekannt";
    const [dd, mm, yyyy] = item.date.split(".");
    out.push({
      date: item.date,
      iso: `${yyyy}-${mm}-${dd}`,
      year: parseInt(yyyy, 10),
      month: parseInt(mm, 10),
      group,
      typ: item.typ,
      name: item.name,
      value: item.value,
      amount: str2float(item.value),
      file: fileName,
    });
    item = null;
  };

  for (let p = 1; p < pages.length; p++) {
    // Start ab Seite 2 wie im Original
    for (const line of pages[p]) {
      let m = RE_BOOKING.exec(line);
      if (m) {
        commit();
        saldo += str2float(m.groups.value);
        item = {
          date: m.groups.date,
          name: m.groups.text.toLowerCase(),
          typ: m.groups.type.toLowerCase(),
          value: m.groups.value.replace(/\s/g, ""),
        };
        continue;
      }
      m = RE_BOOKING2.exec(line);
      if (m) {
        if (item) {
          item.name += " " + m.groups.text.toLowerCase();
          item.typ += " " + m.groups.type.toLowerCase();
        }
        continue;
      }
      m = RE_SALDO.exec(line);
      if (m) {
        const kind = m.groups.saldo.replace(/\s/g, "");
        if (kind === "AlterSaldo") saldo = str2float(m.groups.value);
        if (kind === "NeuerSaldo") {
          const neuer = str2float(m.groups.value);
          delta = Math.round((neuer - Math.round(saldo * 100) / 100) * 100) / 100;
          stop = true;
        }
        continue;
      }
      if (item) item.name += " " + line.toLowerCase();
    }
    commit();
    if (stop) break;
  }
  commit();
  return { file: fileName, delta, matched: stop };
}

/* ---------------------------------------------------- PDF-Text via pdf.js */

async function cachedSource(d, url, name) {
  const path = fm.joinPath(d.lib, name);
  if (fm.fileExists(path)) {
    await ensureDownloaded(path);
    const src = fm.readString(path);
    if (src && src.length > 1000) return src;
  }
  // Im Offline-Paket liegen die Module bereits in comdirect/lib.
  // Nur wenn sie dort fehlen, werden sie einmalig geladen und lokal gespeichert.
  const req = new Request(url);
  req.timeoutInterval = 30;
  const src = await req.loadString();
  if (!src || src.length < 1000) throw new Error("PDF-Modul fehlt: " + name);
  fm.writeString(path, src);
  return src;
}

// Unsichtbarer WebView – reine Rechenmaschine, wird nie präsentiert.
async function buildExtractor(d, gap) {
  const lib = await cachedSource(d, PDFJS_LIB, "pdf.min.js");
  const worker = await cachedSource(d, PDFJS_WORKER, "pdf.worker.min.js");

  const html = `<!DOCTYPE html><html><head><meta charset="utf-8"></head><body>
<script>${lib}<\/script>
<script id="w" type="text/plain">${worker.replace(/<\/script>/gi, "<\\/script>")}<\/script>
<script>
const src = document.getElementById('w').textContent;
pdfjsLib.GlobalWorkerOptions.workerSrc =
  URL.createObjectURL(new Blob([src], {type: 'text/javascript'}));

function toLines(items) {
  const rows = [];
  for (const it of items) {
    if (!it.str || !it.str.trim()) continue;
    const y = it.transform[5], x = it.transform[4];
    let row = null;
    for (const r of rows) { if (Math.abs(r.y - y) < 2.2) { row = r; break; } }
    if (!row) { row = { y: y, parts: [] }; rows.push(row); }
    row.parts.push({ x: x, s: it.str, w: it.width || 0 });
  }
  rows.sort((a, b) => b.y - a.y);
  return rows.map(function (r) {
    r.parts.sort((a, b) => a.x - b.x);
    let out = '', end = null;
    for (const p of r.parts) {
      if (end !== null && p.x - end > ${gap || SPACE_GAP} && !/\\s$/.test(out) && !/^\\s/.test(p.s)) out += ' ';
      out += p.s;
      end = p.x + p.w;
    }
    return out.replace(/\\s+/g, ' ').trim();
  }).filter(s => s.length > 0);
}

window.extract = async function (b64) {
  const bin = atob(b64);
  const arr = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
  const doc = await pdfjsLib.getDocument({ data: arr, disableFontFace: true }).promise;
  const pages = [];
  for (let p = 1; p <= doc.numPages; p++) {
    const page = await doc.getPage(p);
    const tc = await page.getTextContent();
    pages.push(toLines(tc.items));
    page.cleanup();
  }
  await doc.destroy();
  return pages;
};
<\/script></body></html>`;

  const wv = new WebView();
  await wv.loadHTML(html);
  return wv;
}

async function extractPdf(wv, path) {
  await ensureDownloaded(path);
  const b64 = managerForPath(path).read(path).toBase64String();
  // Wichtig: Der Ausdruck muss einen serialisierbaren Wert liefern,
  // sonst meldet Scriptable "Nicht unterstützter Typ".
  const js = `
    (function () {
      window.extract(${JSON.stringify(b64)})
        .then(function (p) { completion({ ok: true, pages: p }); })
        .catch(function (e) { completion({ ok: false, error: String((e && e.message) || e) }); });
      return "started";
    })();
  `;
  return await wv.evaluateJavaScript(js, true);
}

/* --------------------------------------------------------------- CSV-Export */

function csvEscape(s) {
  return String(s).replace(/[\r\n;]+/g, " ").trim();
}

function writeCsv(d, list, year, month) {
  const rows = list.filter((b) => b.year === year && (!month || b.month === month));
  const byGroup = new Map();
  for (const b of rows) {
    if (!byGroup.has(b.group)) byGroup.set(b.group, []);
    byGroup.get(b.group).push(b);
  }

  const period = month ? `${year}-${String(month).padStart(2, "0")}` : String(year);
  let overview = "\uFEFFZeitraum;Gruppenname;Anzahl Buchungen in der Gruppe;Saldo\n";
  let detail = "\uFEFFBuchungsdatum;Gruppenname;Vorgang;Buchungstext;Betrag\n";
  let saldo = 0;
  for (const [group, items] of byGroup) {
    let sum = 0;
    for (const b of items) {
      sum += b.amount;
      detail += `${b.date};${csvEscape(group)};${csvEscape(b.typ)};${csvEscape(b.name)};${b.value}\n`;
    }
    sum = Math.round(sum * 100) / 100;
    saldo += sum;
    overview += `${period};${csvEscape(group)};${items.length};${sum.toFixed(2).replace(".", ",")}\n`;
  }
  saldo = Math.round(saldo * 100) / 100;
  overview += `${period};Saldo;1;${saldo.toFixed(2).replace(".", ",")}\n`;

  const p1 = fm.joinPath(d.exportDir, `${period}_comdirect.csv`);
  const p2 = fm.joinPath(d.exportDir, `${period}_comdirect_bookings.csv`);
  fm.writeString(p1, overview);
  fm.writeString(p2, detail);
  return [p1, p2];
}

/* ------------------------------------------------- Ablage der Downloads */

/** Filter für die Dokumentliste der Postbox. */
function matchesDownloadFilter(doc, s) {
  const meta = doc.documentMetaData || {};
  if (!s.includeAdvertisements && doc.advertisement) return false;
  if (s.archiveFilter === "archivedOnly" && !meta.archived) return false;
  if (s.archiveFilter === "notArchivedOnly" && meta.archived) return false;
  if (s.startDate && String(doc.dateCreation || "") < s.startDate) return false;
  if (s.endDate && String(doc.dateCreation || "") > s.endDate) return false;
  if (s.filenameFilterEnabled && !s.filenamePrefixes.some((p) => String(doc.name || "").startsWith(p))) return false;
  return doc.mimeType === "application/pdf";
}

function targetPath(owner, root, doc, settings) {
  const ext = ".pdf";
  const year = /^\d{4}/.test(String(doc.dateCreation || "")) ? String(doc.dateCreation).slice(0, 4) : "Ohne Jahr";
  let dir = owner.joinPath(root, year);
  if (!owner.fileExists(dir)) owner.createDirectory(dir, true);
  if (settings.useSubfolders) {
    dir = owner.joinPath(dir, "pdf");
    if (!owner.fileExists(dir)) owner.createDirectory(dir, true);
  }
  let name = sanitizeName(String(doc.name || doc.documentId));
  if (!name.toLowerCase().endsWith(ext)) name += ext;
  return owner.joinPath(dir, name);
}

function uniquePath(owner, path, date) {
  if (!owner.fileExists(path)) return path;
  const dot = path.lastIndexOf(".");
  const base = dot > 0 ? path.slice(0, dot) : path;
  const ext = dot > 0 ? path.slice(dot) : "";
  const suffix = date ? `_${date}` : "";
  let candidate = `${base}${suffix}${ext}`;
  let i = 1;
  while (owner.fileExists(candidate)) candidate = `${base}${suffix}_${i++}${ext}`;
  return candidate;
}

function filterSummary(s, storage) {
  return `Zeitraum: ${s.startDate || "offen"} bis ${s.endDate || "offen"}\n`
    + `Archiv: ${ARCHIVE_LABELS[s.archiveFilter] || "Alle"}\n`
    + `Dateifilter: ${s.filenameFilterEnabled ? s.filenamePrefixes.join(", ") : "aus"}\n`
    + `Werbung: ${s.includeAdvertisements ? "ja" : "nein"}\n`
    + `Ziel: ${storage.label}`;
}

/* ================================================== Oberfläche (nativ) === */

const MONTHS = ["Jan", "Feb", "Mär", "Apr", "Mai", "Jun", "Jul", "Aug", "Sep", "Okt", "Nov", "Dez"];
const MONTHS_LONG = ["Januar", "Februar", "März", "April", "Mai", "Juni",
  "Juli", "August", "September", "Oktober", "November", "Dezember"];
const MAIN_SECTIONS = [
  { id: "report", label: "Finanzreport", compact: "Finanzen" },
  { id: "securities", label: "Wertpapiere", compact: "Depot" },
  { id: "tax", label: "Jahressteuer", compact: "Steuer" },
  { id: "postbox", label: "Postbox" },
];

const REPORT_TABS = [
  { id: "groups", label: "Kategorien" },
  { id: "months", label: "Verlauf" },
  { id: "bookings", label: "Buchungen" },
];

// Unteransichten der Jahressteuerbescheinigungen
const TAX_TABS = [
  { id: "overview", label: "Übersicht" },
  { id: "history", label: "Verlauf" },
  { id: "kap", label: "Anlage KAP" },
];

const TRADE_TABS = [
  { id: "overview", label: "Übersicht" },
  { id: "history", label: "Verlauf" },
  { id: "positions", label: "Positionen" },
  { id: "documents", label: "Dokumente" },
];

const APPEARANCES = ["system", "light", "dark"];
let APPEARANCE = "system";

function systemDark() { try { return Device.isUsingDarkAppearance(); } catch (e) { return false; } }
function drawDark() { return APPEARANCE === "dark" || (APPEARANCE === "system" && systemDark()); }
function uiColor(light, dark) {
  // UITable selbst wird von iOS gezeichnet. Im System-Modus folgen die Farben
  // automatisch; Hell/Dunkel beeinflusst zusätzlich alle selbst gezeichneten Elemente.
  if (APPEARANCE === "light") return new Color(light);
  if (APPEARANCE === "dark") return new Color(dark);
  return Color.dynamic(new Color(light), new Color(dark));
}

const C = {
  get bg() { return uiColor("#f7faf9", "#0d1513"); },
  get text() { return uiColor("#14201d", "#f1f7f5"); },
  get dim() { return uiColor("#64736f", "#9caaa6"); },
  get faint() { return uiColor("#a9b5b1", "#56635f"); },
  get plus() { return uiColor("#00875a", "#42d6a0"); },
  get minus() { return uiColor("#c23b4d", "#ff7180"); },
  get accent() { return uiColor("#007a57", "#55d8aa"); },
  get warn() { return uiColor("#a56200", "#f1b64a"); },
  get head() { return uiColor("#e8f3ef", "#16231f"); },
  get stripe() { return uiColor("#edf5f2", "#14201d"); },
};

const D = {
  get text() { return new Color(drawDark() ? "#f1f7f5" : "#14201d"); },
  get dim() { return new Color(drawDark() ? "#9caaa6" : "#64736f"); },
  get line() { return new Color(drawDark() ? "#3b4b46" : "#cbd8d4"); },
  get grid() { return new Color(drawDark() ? "#26342f" : "#e4eeea"); },
  get plus() { return new Color(drawDark() ? "#42d6a0" : "#00875a"); },
  get minus() { return new Color(drawDark() ? "#ff7180" : "#c23b4d"); },
  get accent() { return new Color(drawDark() ? "#55d8aa" : "#007a57"); },
  get warn() { return new Color(drawDark() ? "#f1b64a" : "#a56200"); },
  get card() { return new Color(drawDark() ? "#17231f" : "#ffffff"); },
  get surface() { return new Color(drawDark() ? "#111c19" : "#f2f7f5"); },
  get blue() { return new Color(drawDark() ? "#65b8ff" : "#2879c7"); },
  get orange() { return new Color(drawDark() ? "#ffb15f" : "#d87516"); },
  get violet() { return new Color(drawDark() ? "#b9a2ff" : "#7258c9"); },
};

const F = {
  title: Font.boldSystemFont(21),
  big: Font.boldSystemFont(22),
  row: Font.systemFont(16),
  rowStrong: Font.semiboldSystemFont(16),
  meta: Font.systemFont(13),
  stamp: Font.semiboldSystemFont(13),
  chip: Font.systemFont(14),
  chipOn: Font.boldSystemFont(14),
  icon: Font.systemFont(19),
};

function r2(n) { return Math.round(n * 100) / 100; }

function eur(n, sign) {
  const s = Math.abs(n).toLocaleString("de-DE", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return (n < 0 ? "−" : (sign ? "+" : "")) + s + " €";
}

function eurShort(n) {
  const a = Math.abs(n);
  if (a >= 10000) return (n < 0 ? "−" : "") + Math.round(a / 1000) + "k";
  if (a >= 1000) return (n < 0 ? "−" : "") + (a / 1000).toFixed(1).replace(".", ",") + "k";
  return (n < 0 ? "−" : "") + Math.round(a);
}

function alpha(color, a) {
  if (!color) return new Color(drawDark() ? "#9aa5b1" : "#68737f", a);
  return new Color(color.hex, a);
}

// Farbrampe für Ausgabengruppen – eine Familie, keine Buntheit.
function shade(i, total) {
  const t = total <= 1 ? 0 : i / (total - 1);
  return hsl(348 - t * 26, (74 - t * 30) / 100, (58 + t * 14) / 100);
}

// Farbrampe für Einnahmengruppen – klar von den roten Ausgaben getrennt.
function incomeShade(i, total) {
  const t = total <= 1 ? 0 : i / (total - 1);
  return hsl(158 - t * 18, (72 - t * 28) / 100, (38 + t * 18) / 100);
}

function hsl(h, s, l) {
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const hp = (((h % 360) + 360) % 360) / 60;
  const x = c * (1 - Math.abs((hp % 2) - 1));
  let rgb = [0, 0, 0];
  if (hp < 1) rgb = [c, x, 0];
  else if (hp < 2) rgb = [x, c, 0];
  else if (hp < 3) rgb = [0, c, x];
  else if (hp < 4) rgb = [0, x, c];
  else if (hp < 5) rgb = [x, 0, c];
  else rgb = [c, 0, x];
  const m = l - c / 2;
  const hex = rgb.map((v) => {
    const n = Math.max(0, Math.min(255, Math.round((v + m) * 255)));
    return n.toString(16).padStart(2, "0");
  }).join("");
  return new Color(hex);
}

/* -------------------------------------------------------------- Zustand */

let dirs = null;
let cfg = null;
let source = null;

let bookings = [];
let fileInfos = [];
let pageCache = []; // [{ file, pages }] – erlaubt Neuzuordnung ohne erneutes PDF-Lesen
let extractor = null;
let extractorGap = null;

let YEAR = null;
let MONTH = 0;
let SECTION = "report";
let TAB = "groups";
let VIEW = { name: "main" };
let CATEGORY_LEGEND_EXPANDED = false;
let busy = null;            // { big, sub, pct } während Auswertung oder Download
let notice = "";            // kurze Rückmeldung im Kopfbereich
let noticeTimer = null;
let emptyInfo = null;       // { title, text } wenn keine Buchungen vorliegen
let presented = false;
let SETTINGS_OPEN = "";     // Einstellungsbereiche starten eingeklappt
let HELP_OPEN = "";         // Anleitung als Akkordeon innerhalb der UI
let STRIPE_INDEX = 0;        // laufender Index innerhalb der aktuellen Tabelle

// Jahressteuerbescheinigungen
let taxItems = [];
let taxSignatures = {};
let TAX_YEAR = null;
let TAX_TAB = "overview";

// Wertpapierabrechnungen
let tradeItems = [];
let tradeSignatures = {};
let TRADE_YEAR = null;
let TRADE_TAB = "overview";

// Filter der Dokumentliste
let DOC_QUERY = "";
let DOC_YEAR = "";
let DOC_TYPE = "";
let docFiles = [];
let docWarning = "";

const table = new UITable();
table.showSeparators = false;
// Scriptable stellt UITable nur mit diesem Schalter auf der kompletten
// Gerätefläche dar – auch auf dem iPad und im Querformat.
const FULLSCREEN_UI = true;

/* ------------------------------------------------------- Zeilenbausteine */

function newRow(height) {
  const r = new UITableRow();
  r.dismissOnSelect = false;
  r.backgroundColor = C.bg;
  if (height) r.height = height;
  return r;
}

function applyTableStripe(row) {
  if (STRIPE_INDEX % 2 === 1) row.backgroundColor = C.stripe;
  STRIPE_INDEX++;
  return row;
}

function addSpacer(h) {
  const r = newRow(h || 10);
  r.addText(" ");
  table.addRow(r);
}

function addStamp(text, color) {
  STRIPE_INDEX = 0;
  const r = newRow(36);
  r.backgroundColor = C.head;
  const c = r.addText(text);
  c.titleFont = F.stamp;
  c.titleColor = color || C.accent;
  table.addRow(r);
  return r;
}

function addInfo(text, color) {
  const r = newRow(Math.max(34, 20 + Math.ceil(String(text).length / 42) * 16));
  const c = r.addText(String(text));
  c.titleFont = F.meta;
  c.titleColor = color || C.dim;
  table.addRow(r);
}

// Reihe aus Schaltflächen; items = [{ label, on, off, weight, onTap }]
function addChipRow(items, height, background) {
  const r = newRow(height || 40);
  if (background) r.backgroundColor = background;
  for (const it of items) {
    if (!it) {
      const pad = r.addText(" ");
      pad.widthWeight = 1;
      continue;
    }
    const b = r.addButton(it.label);
    b.widthWeight = it.weight || 1;
    b.centerAligned();
    b.titleFont = it.font || (it.on ? F.chipOn : F.chip);
    b.titleColor = it.color || (it.on ? C.accent : (it.off ? C.faint : C.dim));
    b.onTap = it.onTap;
  }
  table.addRow(r);
  return r;
}

function addImageRow(image, height, onSelect) {
  const r = newRow(height);
  const c = r.addImage(image);
  c.widthWeight = 100;
  if (onSelect) r.onSelect = onSelect;
  table.addRow(r);
}

// Standardzeile: links Text mit Untertitel, rechts Betrag oder Wert.
function addValueRow(opts) {
  const r = newRow(opts.height || 52);
  if (opts.key) {
    const k = r.addText("■");
    k.widthWeight = 6;
    k.titleColor = opts.key;
    k.centerAligned();
  }
  const left = r.addText(opts.title, opts.subtitle);
  left.widthWeight = opts.key ? 58 : 63;
  left.titleFont = opts.titleFont || F.row;
  left.titleColor = opts.titleColor || C.text;
  left.subtitleFont = F.meta;
  left.subtitleColor = C.dim;
  const right = r.addText(opts.value || "", opts.valueSub || "");
  right.widthWeight = opts.key ? 36 : 37;
  right.rightAligned();
  right.titleFont = opts.valueFont || F.rowStrong;
  right.titleColor = opts.valueColor || C.text;
  right.subtitleFont = F.meta;
  right.subtitleColor = C.dim;
  if (opts.onSelect) r.onSelect = opts.onSelect;
  applyTableStripe(r);
  table.addRow(r);
  return r;
}

function addButtonRow(title, onTap, destructive) {
  const r = newRow(48);
  const b = r.addButton(title);
  b.titleFont = F.rowStrong;
  b.titleColor = destructive ? C.minus : C.accent;
  b.onTap = onTap;
  applyTableStripe(r);
  table.addRow(r);
  return r;
}

function addBackRow(title, subtitle, onBack) {
  const r = newRow(50);
  const b = r.addButton("‹ Zurück");
  b.widthWeight = 32;
  b.titleFont = F.rowStrong;
  b.titleColor = C.accent;
  b.onTap = onBack || (() => { VIEW = { name: "main" }; render(); });
  const t = r.addText(title, subtitle);
  t.widthWeight = 68;
  t.rightAligned();
  t.titleFont = F.rowStrong;
  t.subtitleFont = F.meta;
  t.subtitleColor = C.dim;
  table.addRow(r);
}

/* ------------------------------------------------------------- Dialoge */

function sleep(ms) {
  return new Promise((resolve) => {
    const timer = new Timer();
    timer.timeInterval = ms;
    timer.repeats = false;
    timer.schedule(() => resolve());
  });
}

async function alert(title, message) {
  const a = new Alert();
  a.title = title;
  a.message = message;
  a.addAction("OK");
  await a.present();
}

async function choose(title, message, actions, cancelTitle = "Abbrechen") {
  const a = new Alert();
  a.title = title;
  a.message = message;
  actions.forEach((x) => a.addAction(x));
  if (cancelTitle) a.addCancelAction(cancelTitle);
  return await a.present();
}

/** Liefert null bei Abbruch, sonst den getrimmten Wert. */
async function promptText(title, message, value, options = {}) {
  const a = new Alert();
  a.title = title;
  if (message) a.message = message;
  a.addTextField(options.placeholder || "", value == null ? "" : String(value));
  a.addAction("Übernehmen");
  if (options.clearable) a.addAction("Leeren");
  a.addCancelAction("Abbrechen");
  const tapped = await a.present();
  if (tapped < 0) return null;
  if (options.clearable && tapped === 1) return "";
  return a.textFieldValue(0).trim();
}

async function securePrompt(title, message, placeholder) {
  const a = new Alert();
  a.title = title;
  a.message = message;
  a.addSecureTextField(placeholder, "");
  a.addAction("Bestätigen");
  a.addCancelAction("Abbrechen");
  if (await a.present() !== 0) throw new Error("TAN-Eingabe abgebrochen.");
  const value = a.textFieldValue(0).trim();
  if (!value) throw new Error("Keine TAN eingegeben.");
  return value;
}

/** options: [{ label, value }]. Liefert null bei Abbruch. */
async function pickOption(title, options, current) {
  const a = new Alert();
  a.title = title;
  options.forEach((o) => a.addAction(o.value === current ? `${o.label}  ✓` : o.label));
  a.addCancelAction("Abbrechen");
  const index = await a.presentSheet();
  return index < 0 ? null : options[index].value;
}

async function notify(title, body) {
  try {
    const n = new Notification();
    n.title = title;
    n.body = body;
    await n.schedule();
  } catch (_) { /* Benachrichtigungen optional */ }
}

async function showError(error) {
  console.error(error);
  const status = error && error.status;
  const warning = (status === 400 || status === 422)
    ? "\n\nNicht wiederholt raten: Nach mehreren falschen TAN-Versuchen kann der Bankzugang gesperrt werden."
    : "";
  await alert("Fehler", `${String(error && error.message || error)}${warning}`);
}

function flash(text) {
  notice = text;
  if (noticeTimer) { try { noticeTimer.invalidate(); } catch (e) { /* egal */ } }
  noticeTimer = Timer.schedule(4200, false, () => {
    notice = "";
    render();
  });
  render();
}

/* ----------------------------------------------------------- Auswertung */

function periodRows() {
  return bookings.filter((b) => b.year === YEAR && (MONTH === 0 || b.month === MONTH));
}

function yearRows() {
  return bookings.filter((b) => b.year === YEAR);
}

function periodLabel() {
  return MONTH === 0 ? "Jahr " + YEAR : MONTHS_LONG[MONTH - 1] + " " + YEAR;
}

function availableYears() {
  const set = {};
  bookings.forEach((b) => { set[b.year] = 1; });
  const list = Object.keys(set).map(Number).sort((a, b) => b - a);
  return list.length ? list : [new Date().getFullYear()];
}

function groupSums(list) {
  const map = new Map();
  for (const b of list) {
    if (!map.has(b.group)) map.set(b.group, { name: b.group, sum: 0, n: 0 });
    const g = map.get(b.group);
    g.sum += b.amount;
    g.n++;
  }
  const out = Array.from(map.values());
  out.forEach((g) => { g.sum = r2(g.sum); });
  return out.sort((a, b) => Math.abs(b.sum) - Math.abs(a.sum));
}

function monthTotals(year) {
  const inc = new Array(12).fill(0);
  const exp = new Array(12).fill(0);
  for (const b of bookings) {
    if (b.year !== year) continue;
    if (b.amount >= 0) inc[b.month - 1] += b.amount;
    else exp[b.month - 1] += Math.abs(b.amount);
  }
  return { inc, exp };
}

function yearStatistics(year) {
  const t = monthTotals(year);
  const active = [];
  const nets = [];
  let positiveMonths = 0;
  let negativeMonths = 0;

  for (let i = 0; i < 12; i++) {
    if (!t.inc[i] && !t.exp[i]) continue;
    const net = r2(t.inc[i] - t.exp[i]);
    active.push(i);
    nets.push(net);
    if (net >= 0) positiveMonths++;
    else negativeMonths++;
  }

  const sum = (a) => a.reduce((x, n) => x + n, 0);
  const totalIn = r2(sum(t.inc));
  const totalOut = r2(sum(t.exp));
  const net = r2(totalIn - totalOut);
  const avgNet = active.length ? r2(sum(nets) / active.length) : 0;
  const avgIn = active.length ? r2(totalIn / active.length) : 0;
  const avgOut = active.length ? r2(totalOut / active.length) : 0;

  const sorted = nets.slice().sort((a, b) => a - b);
  let medianNet = 0;
  if (sorted.length) {
    const mid = Math.floor(sorted.length / 2);
    medianNet = sorted.length % 2 ? sorted[mid] : r2((sorted[mid - 1] + sorted[mid]) / 2);
  }

  const variance = nets.length
    ? nets.reduce((a, n) => a + Math.pow(n - avgNet, 2), 0) / nets.length
    : 0;
  const volatility = Math.sqrt(variance);

  let bestMonth = -1, worstMonth = -1;
  let bestValue = -Infinity, worstValue = Infinity;
  for (const i of active) {
    const v = r2(t.inc[i] - t.exp[i]);
    if (v > bestValue) { bestValue = v; bestMonth = i; }
    if (v < worstValue) { worstValue = v; worstMonth = i; }
  }

  const rows = bookings.filter((b) => b.year === year);
  let biggestExpense = null;
  let biggestIncome = null;
  for (const b of rows) {
    if (b.amount < 0 && (!biggestExpense || b.amount < biggestExpense.amount)) biggestExpense = b;
    if (b.amount > 0 && (!biggestIncome || b.amount > biggestIncome.amount)) biggestIncome = b;
  }

  const expenseMap = new Map();
  for (const b of rows) {
    if (b.amount >= 0) continue;
    if (!expenseMap.has(b.group)) expenseMap.set(b.group, { name: b.group, amount: 0, count: 0 });
    const g = expenseMap.get(b.group);
    g.amount += Math.abs(b.amount);
    g.count++;
  }
  const expenseCategories = Array.from(expenseMap.values())
    .map((g) => ({ name: g.name, amount: r2(g.amount), count: g.count }))
    .sort((a, b) => b.amount - a.amount);

  return {
    t, active, nets, totalIn, totalOut, net, avgNet, avgIn, avgOut,
    medianNet, volatility, positiveMonths, negativeMonths,
    bestMonth, bestValue, worstMonth, worstValue,
    biggestExpense, biggestIncome, expenseCategories,
  };
}

function categoryMonthlyExpenses(year, names) {
  const map = {};
  names.forEach((n) => { map[n] = new Array(12).fill(0); });
  for (const b of bookings) {
    if (b.year !== year || b.amount >= 0 || !map[b.group]) continue;
    map[b.group][b.month - 1] += Math.abs(b.amount);
  }
  return map;
}

function screenWidth() {
  try { return Device.screenSize().width; } catch (_) { return 390; }
}

function chartWidth() {
  // UITable nutzt nahezu die komplette Gerätebreite; nur ein kleiner
  // Sicherheitsabstand bleibt frei. Der Faktor 2 entspricht der Retina-Auflösung.
  return Math.max(320, Math.round(screenWidth() * 2 - 32));
}

/* --------------------------------------------------------- Diagramme */

function fillRounded(ctx, rect, radius) {
  const p = new Path();
  p.addRoundedRect(rect, radius, radius);
  ctx.addPath(p);
  ctx.fillPath();
}

function newCanvas(w, h) {
  const ctx = new DrawContext();
  ctx.size = new Size(w, h);
  ctx.opaque = false;
  ctx.respectScreenScale = true;
  return ctx;
}

// Einheitliche, ruhige Kartenfläche für alle selbst gezeichneten Grafiken.
function chartSurface(ctx, w, h, inset = 8) {
  ctx.setFillColor(D.surface);
  fillRounded(ctx, new Rect(inset, inset, w - inset * 2, h - inset * 2), 18);
}

function label(ctx, text, x, y, w, font, color, align, height) {
  ctx.setFont(font);
  ctx.setTextColor(color);
  if (align === "center") ctx.setTextAlignedCenter();
  else if (align === "right") ctx.setTextAlignedRight();
  else ctx.setTextAlignedLeft();
  ctx.drawTextInRect(String(text), new Rect(x, y, w, height || 22));
}

function donutCanvasHeight(categoryCount, expanded) {
  const shown = expanded ? categoryCount : Math.min(6, categoryCount);
  const toggleRow = categoryCount > 6 ? 48 : 28;
  return Math.max(420, 84 + shown * 44 + toggleRow);
}

// Ringdiagramm der Ausgabengruppen mit Einnahmen-/Ausgabenübersicht.
function donutImage(exp, income, expanded) {
  const total = exp.reduce((a, g) => a + Math.abs(g.sum), 0);
  const incomeTotal = income.reduce((a, g) => a + g.sum, 0);
  if (!total) return null;
  const W = chartWidth(), H = donutCanvasHeight(exp.length, expanded);
  const ctx = newCanvas(W, H);
  chartSurface(ctx, W, H);
  const compact = W < 1000;
  const cx = Math.round(W * (compact ? 0.23 : 0.25));
  const cy = 210;
  const R = compact ? 142 : 170;
  const r = Math.round(R * 0.62);

  let angle = -Math.PI / 2;
  exp.forEach((g) => {
    const frac = Math.abs(g.sum) / total;
    const sweep = Math.max(frac * Math.PI * 2 - 0.02, 0.012);
    const steps = Math.max(3, Math.ceil(sweep / 0.08));
    const pts = [];
    for (let i = 0; i <= steps; i++) {
      const a = angle + (sweep * i) / steps;
      pts.push(new Point(cx + Math.cos(a) * R, cy + Math.sin(a) * R));
    }
    for (let i = steps; i >= 0; i--) {
      const a = angle + (sweep * i) / steps;
      pts.push(new Point(cx + Math.cos(a) * r, cy + Math.sin(a) * r));
    }
    const p = new Path();
    p.addLines(pts);
    ctx.setFillColor(g.color);
    ctx.addPath(p);
    ctx.fillPath();
    angle += frac * Math.PI * 2;
  });

  // Zweiter innerer Ring: Einnahmekategorien in Grüntönen.
  if (incomeTotal > 0 && income.length) {
    const incomeOuter = r - 8;
    const incomeInner = Math.max(50, incomeOuter - (compact ? 18 : 22));
    let incomeAngle = -Math.PI / 2;
    income.forEach((g) => {
      const frac = g.sum / incomeTotal;
      const sweep = Math.max(frac * Math.PI * 2 - 0.025, 0.012);
      const steps = Math.max(3, Math.ceil(sweep / 0.08));
      const pts = [];
      for (let i = 0; i <= steps; i++) {
        const a = incomeAngle + (sweep * i) / steps;
        pts.push(new Point(cx + Math.cos(a) * incomeOuter, cy + Math.sin(a) * incomeOuter));
      }
      for (let i = steps; i >= 0; i--) {
        const a = incomeAngle + (sweep * i) / steps;
        pts.push(new Point(cx + Math.cos(a) * incomeInner, cy + Math.sin(a) * incomeInner));
      }
      const p = new Path();
      p.addLines(pts);
      ctx.setFillColor(g.color || D.plus);
      ctx.addPath(p);
      ctx.fillPath();
      incomeAngle += frac * Math.PI * 2;
    });
  }

  // Einnahmen und Ausgaben getrennt im Ring darstellen.
  const incomeOuter = r - 8;
  const centerRadius = Math.max(50, incomeOuter - (compact ? 18 : 22));
  const centerW = centerRadius * 2 - 8;
  label(ctx, (incomeTotal > 0 ? "+" : "") + eurShort(incomeTotal), cx - centerW / 2, cy - 48, centerW,
    Font.boldSystemFont(compact ? 22 : 26), D.plus, "center", 30);
  label(ctx, "Einnahmen", cx - centerW / 2, cy - 20, centerW,
    Font.systemFont(compact ? 13 : 16), D.dim, "center", 22);
  label(ctx, eurShort(-total), cx - centerW / 2, cy + 5, centerW,
    Font.boldSystemFont(compact ? 22 : 26), D.minus, "center", 30);
  label(ctx, "Ausgaben", cx - centerW / 2, cy + 33, centerW,
    Font.systemFont(compact ? 13 : 16), D.dim, "center", 22);

  // Responsive Legende in der rechten Bildschirmhälfte. Namen und Prozentwerte
  // nutzen die komplette verbleibende Gerätebreite.
  const outer = 28;
  const pctW = compact ? 90 : 110;
  const lx = Math.max(cx + R + (compact ? 32 : 56), Math.round(W * 0.46));
  const nameX = lx + 36;
  const pctX = W - outer - pctW;
  const nameW = Math.max(120, pctX - nameX - 18);
  const amountW = Math.max(210, Math.min(300, Math.round(W * 0.17)));
  const amountX = W - outer - amountW;

  // Einnahmensumme als eigene grüne Legendenzeile.
  ctx.setFillColor(D.plus);
  fillRounded(ctx, new Rect(lx, 35, 20, 20), 5);
  label(ctx, "Einnahmen", nameX, 32, Math.max(120, amountX - nameX - 18),
    Font.mediumSystemFont(compact ? 19 : 23), D.text, "left", 28);
  label(ctx, eur(incomeTotal, true), amountX, 32, amountW,
    Font.mediumSystemFont(compact ? 18 : 21), D.plus, "right", 28);

  let ly = 84;
  const shown = exp.slice(0, expanded ? exp.length : 6);
  for (const g of shown) {
    ctx.setFillColor(g.color);
    fillRounded(ctx, new Rect(lx, ly + 3, 20, 20), 5);
    const pct = Math.round((Math.abs(g.sum) / total) * 100);
    label(ctx, g.name.slice(0, 32), nameX, ly, nameW,
      Font.systemFont(compact ? 19 : 24), D.text, "left", 28);
    label(ctx, pct + " %", pctX, ly, pctW,
      Font.mediumSystemFont(compact ? 19 : 24), D.dim, "right", 28);
    ly += 44;
  }
  if (exp.length > 6) {
    const remaining = exp.length - shown.length;
    const toggle = expanded
      ? "Weniger anzeigen · antippen"
      : `+ ${remaining} weitere · antippen`;
    label(ctx, toggle, nameX, ly, nameW,
      Font.systemFont(compact ? 17 : 21), D.dim, "left", 28);
    if (!expanded) {
      const rest = exp.slice(shown.length).reduce((a, g) => a + Math.abs(g.sum), 0);
      label(ctx, Math.round((rest / total) * 100) + " %", pctX, ly, pctW,
        Font.systemFont(compact ? 17 : 21), D.dim, "right", 28);
    }
  }
  return ctx.getImage();
}

// Monatlicher Geldfluss: Balken oben/unten plus kumulierter Saldo.
function monthChartImage(year) {
  const t = monthTotals(year);
  const W = chartWidth(), H = 420, padL = 22, padR = 22, top = 22, bottom = 48;
  const ctx = newCanvas(W, H);
  chartSurface(ctx, W, H);
  const max = Math.max(1, ...t.inc, ...t.exp);
  const cw = (W - padL - padR) / 12;
  const mid = top + (H - top - bottom) / 2;
  const half = (H - top - bottom) / 2 - 10;

  const completed = t.inc.filter((v, i) => v || t.exp[i]).length;
  const avgIn = completed ? t.inc.reduce((a, n) => a + n, 0) / completed : 0;
  const avgOut = completed ? t.exp.reduce((a, n) => a + n, 0) / completed : 0;

  // Raster
  ctx.setFillColor(D.grid);
  [0.5, 1].forEach((f) => {
    ctx.fillRect(new Rect(padL, mid - half * f, W - padL - padR, 1));
    ctx.fillRect(new Rect(padL, mid + half * f, W - padL - padR, 1));
  });

  // Durchschnitt als gestrichelte Linien
  const dash = (y, color) => {
    ctx.setFillColor(alpha(color, 0.5));
    for (let x = padL; x < W - padR; x += 12) ctx.fillRect(new Rect(x, y, 6, 1.4));
  };
  dash(mid - (avgIn / max) * half, D.plus);
  dash(mid + (avgOut / max) * half, D.minus);

  // Balken
  for (let i = 0; i < 12; i++) {
    const x = padL + i * cw;
    const on = MONTH === 0 || MONTH === i + 1;
    if (MONTH === i + 1) {
      ctx.setFillColor(D.grid);
      fillRounded(ctx, new Rect(x, top, cw, H - top - bottom), 4);
    }
    const hi = Math.max((t.inc[i] / max) * half, 1.5);
    const ho = Math.max((t.exp[i] / max) * half, 1.5);
    ctx.setFillColor(on ? D.plus : alpha(D.plus, 0.35));
    fillRounded(ctx, new Rect(x + cw * 0.16, mid - hi, cw * 0.3, hi), 3);
    ctx.setFillColor(on ? D.minus : alpha(D.minus, 0.35));
    fillRounded(ctx, new Rect(x + cw * 0.54, mid, cw * 0.3, ho), 3);
    label(ctx, MONTHS[i], x, H - bottom + 10, cw, Font.systemFont(20),
      MONTH === i + 1 ? D.text : D.dim, "center");
  }

  // Kumulierter Saldo
  const pts = [];
  let run = 0;
  for (let i = 0; i < 12; i++) {
    run += t.inc[i] - t.exp[i];
    pts.push({ x: padL + i * cw + cw / 2, v: run });
  }
  const runMax = Math.max(1, ...pts.map((p) => Math.abs(p.v)));
  const line = new Path();
  pts.forEach((p, i) => {
    const y = mid - (p.v / runMax) * half * 0.82;
    if (i === 0) line.move(new Point(p.x, y));
    else line.addLine(new Point(p.x, y));
  });
  ctx.setStrokeColor(alpha(D.text, 0.55));
  ctx.setLineWidth(4);
  ctx.addPath(line);
  ctx.strokePath();
  ctx.setFillColor(alpha(D.text, 0.75));
  pts.forEach((p) => {
    const y = mid - (p.v / runMax) * half * 0.82;
    ctx.fillEllipse(new Rect(p.x - 4.5, y - 4.5, 9, 9));
  });

  // Nulllinie
  ctx.setFillColor(D.line);
  ctx.fillRect(new Rect(padL, mid, W - padL - padR, 1.4));
  return ctx.getImage();
}

// Netto-Saldo je Monat mit Nulllinie und Durchschnitt.
function netTrendImage(year) {
  const s = yearStatistics(year);
  const vals = new Array(12).fill(0).map((_, i) => r2(s.t.inc[i] - s.t.exp[i]));
  const W = chartWidth(), H = 320, left = 22, right = 22, top = 22, bottom = 48;
  const ctx = newCanvas(W, H);
  chartSurface(ctx, W, H);
  const max = Math.max(1, ...vals.map((v) => Math.abs(v)), Math.abs(s.avgNet));
  const cw = (W - left - right) / 12;
  const mid = top + (H - top - bottom) / 2;
  const half = (H - top - bottom) / 2 - 8;

  ctx.setFillColor(D.line);
  ctx.fillRect(new Rect(left, mid, W - left - right, 1.4));

  const avgY = mid - (s.avgNet / max) * half;
  ctx.setFillColor(alpha(D.text, 0.35));
  for (let x = left; x < W - right; x += 12) ctx.fillRect(new Rect(x, avgY, 6, 1.2));

  for (let i = 0; i < 12; i++) {
    const x = left + i * cw;
    const v = vals[i];
    const h = Math.max(Math.abs(v) / max * half, v ? 2 : 0);
    const on = MONTH === 0 || MONTH === i + 1;
    if (MONTH === i + 1) {
      ctx.setFillColor(D.grid);
      fillRounded(ctx, new Rect(x, top, cw, H - top - bottom), 4);
    }
    if (v !== 0) {
      ctx.setFillColor(v >= 0 ? (on ? D.plus : alpha(D.plus, 0.35)) : (on ? D.minus : alpha(D.minus, 0.35)));
      fillRounded(ctx, new Rect(x + cw * 0.20, v >= 0 ? mid - h : mid, cw * 0.60, h), 4);
    }
    label(ctx, MONTHS[i], x, H - bottom + 10, cw, Font.systemFont(20),
      MONTH === i + 1 ? D.text : D.dim, "center");
  }
  return ctx.getImage();
}

// Größte Ausgabenkategorien als horizontale Balken.
function categoryBarsImage(year) {
  const s = yearStatistics(year);
  const cats = s.expenseCategories.slice(0, 7);
  if (!cats.length) return null;
  const W = chartWidth(), rowH = 58, H = 20 + cats.length * rowH;
  const ctx = newCanvas(W, H);
  chartSurface(ctx, W, H);
  const max = Math.max(1, cats[0].amount);
  const outer = 20;
  const nameW = Math.max(200, Math.min(480, Math.round(W * 0.26)));
  // Genügend Platz für vollständige Beträge wie „−12.345,67 €“ reservieren.
  const valueW = Math.max(210, Math.min(300, Math.round(W * 0.17)));
  const gap = 16;
  const barX = outer + nameW + 16;
  const barW = Math.max(160, W - barX - gap - valueW - outer);
  const valueX = barX + barW + gap;

  cats.forEach((g, i) => {
    const y = 12 + i * rowH;
    label(ctx, g.name.slice(0, 30), outer, y, nameW - 12, Font.systemFont(22), D.text, "left");
    ctx.setFillColor(D.grid);
    fillRounded(ctx, new Rect(barX, y + 2, barW, 22), 11);
    ctx.setFillColor(alpha(D.minus, 0.82));
    fillRounded(ctx, new Rect(barX, y + 2, Math.max(5, barW * g.amount / max), 22), 11);
    label(ctx, eur(-g.amount), valueX, y, valueW, Font.mediumSystemFont(21), D.dim, "right");
  });
  return ctx.getImage();
}

// Monatsentwicklung der vier größten Ausgabenkategorien.
function categoryTrendImage(year) {
  const s = yearStatistics(year);
  const names = s.expenseCategories.slice(0, 4).map((g) => g.name);
  if (!names.length) return null;
  const series = categoryMonthlyExpenses(year, names);
  const W = chartWidth(), H = 360, left = 28, right = 22, top = 30, bottom = 78;
  const ctx = newCanvas(W, H);
  chartSurface(ctx, W, H);
  const cw = (W - left - right) / 11;
  let max = 1;
  names.forEach((n) => series[n].forEach((v) => { if (v > max) max = v; }));

  [0.25, 0.5, 0.75, 1].forEach((f) => {
    ctx.setFillColor(D.grid);
    ctx.fillRect(new Rect(left, top + (H - top - bottom) * (1 - f), W - left - right, 1));
  });

  const palette = [D.minus, D.orange, D.violet, D.blue];
  names.forEach((name, si) => {
    const p = new Path();
    for (let m = 0; m < 12; m++) {
      const x = left + m * cw;
      const y = top + (H - top - bottom) * (1 - series[name][m] / max);
      if (m === 0) p.move(new Point(x, y)); else p.addLine(new Point(x, y));
    }
    ctx.setStrokeColor(alpha(palette[si], si === 3 ? 0.55 : 0.78));
    ctx.setLineWidth(si === 0 ? 3.2 : 2.2);
    ctx.addPath(p);
    ctx.strokePath();
  });

  for (let m = 0; m < 12; m++) {
    const x = left + m * cw - 16;
    label(ctx, MONTHS[m], x, H - bottom + 12, 40, Font.systemFont(18),
      MONTH === m + 1 ? D.text : D.dim, "center");
  }

  const legendW = (W - 28) / names.length;
  const ly = H - 32;
  names.forEach((name, i) => {
    const lx = 14 + i * legendW;
    ctx.setFillColor(alpha(palette[i], i === 3 ? 0.55 : 0.78));
    ctx.fillEllipse(new Rect(lx, ly + 4, 12, 12));
    label(ctx, name.slice(0, 18), lx + 18, ly, legendW - 22, Font.systemFont(18), D.dim, "left");
  });
  return ctx.getImage();
}

function sparkImage(perMonth) {
  const W = chartWidth(), H = 220, padL = 12, padR = 12;
  const ctx = newCanvas(W, H);
  chartSurface(ctx, W, H);
  const max = Math.max(1, ...perMonth.map(Math.abs));
  const cw = (W - padL - padR) / 12;
  const mid = 120;
  for (let m = 0; m < 12; m++) {
    const x = padL + m * cw;
    const h = Math.max((Math.abs(perMonth[m]) / max) * 92, 1.5);
    const neg = perMonth[m] < 0;
    const on = MONTH === 0 || MONTH === m + 1;
    ctx.setFillColor(neg ? (on ? D.minus : alpha(D.minus, 0.35)) : (on ? D.plus : alpha(D.plus, 0.35)));
    fillRounded(ctx, new Rect(x + cw * 0.2, neg ? mid : mid - h, cw * 0.6, h), 3);
    label(ctx, MONTHS[m], x, mid + 96, cw, Font.systemFont(14),
      MONTH === m + 1 ? D.text : D.dim, "center");
    label(ctx, perMonth[m] ? eurShort(perMonth[m]) : "", x, mid + 118, cw,
      Font.systemFont(12), D.dim, "center");
  }
  ctx.setFillColor(D.line);
  ctx.fillRect(new Rect(padL, mid, W - padL - padR, 1.4));
  return ctx.getImage();
}

/* ============================ Jahressteuerbescheinigungen (Anlage KAP) === */

function safeObject(v, fallback) {
  return v && typeof v === "object" && !Array.isArray(v) ? v : fallback;
}

function normalizeTaxCache(raw) {
  const c = safeObject(raw, {});
  return {
    items: Array.isArray(c.items) ? c.items : [],
    signatures: safeObject(c.signatures, {}),
    savedAt: typeof c.savedAt === "string" ? c.savedAt : "",
  };
}

function readTaxCache(d) {
  try {
    if (!fm.fileExists(d.taxCache)) return normalizeTaxCache(null);
    return normalizeTaxCache(JSON.parse(fm.readString(d.taxCache)));
  } catch (e) {
    return normalizeTaxCache(null);
  }
}

function writeTaxCache(d, list, signatures) {
  try {
    fm.writeString(d.taxCache, JSON.stringify({
      items: list || [],
      signatures: signatures || {},
      savedAt: new Date().toISOString(),
    }, null, 2));
  } catch (e) { /* Cache ist nur eine Beschleunigung */ }
}

function normalizeTradeCache(raw) {
  const c = safeObject(raw, {});
  return {
    items: Array.isArray(c.items) ? c.items : [],
    signatures: safeObject(c.signatures, {}),
    savedAt: typeof c.savedAt === "string" ? c.savedAt : "",
  };
}

function readTradeCache(d) {
  try {
    if (!fm.fileExists(d.tradeCache)) return normalizeTradeCache(null);
    return normalizeTradeCache(JSON.parse(fm.readString(d.tradeCache)));
  } catch (e) { return normalizeTradeCache(null); }
}

function writeTradeCache(d, list, signatures) {
  try {
    fm.writeString(d.tradeCache, JSON.stringify({
      items: list || [],
      signatures: signatures || {},
      savedAt: new Date().toISOString(),
    }, null, 2));
  } catch (e) { /* Cache ist nur eine Beschleunigung */ }
}

/** Größe und Änderungsdatum – erspart das erneute Lesen unveränderter PDFs. */
function fileSignature(path) {
  const m = managerForPath(path);
  try {
    const mod = m.modificationDate(path);
    return `${m.fileSize(path)}:${mod ? mod.getTime() : 0}`;
  } catch (e) { return ""; }
}

/** Wird die Datei als Jahressteuerbescheinigung gelesen? */
function isTaxFile(relative) {
  const pattern = String(cfg && cfg.taxPattern || "").trim().toLocaleLowerCase("de");
  if (!pattern) return false;
  return String(relative).split("/").pop().toLocaleLowerCase("de").includes(pattern);
}

function isTradeFile(relative) {
  const pattern = String(cfg && cfg.tradePattern || "").trim().toLocaleLowerCase("de");
  if (!pattern) return false;
  return String(relative).split("/").pop().toLocaleLowerCase("de").includes(pattern);
}

/* ------------------------------------------------------------- Auslesen */

function parseEuro(s) {
  if (s == null) return null;
  const m = String(s).match(/(-?\s*\d{1,3}(?:\.\d{3})*,\d{2}|-?\s*\d+,\d{2})/);
  if (!m) return null;
  const n = Number(m[1].replace(/\s/g, "").replace(/\./g, "").replace(",", "."));
  return Number.isFinite(n) ? n : null;
}

function clean(s) { return String(s || "").replace(/\s+/g, " ").trim(); }

function amountOnLine(lines, checks, reject = []) {
  for (const raw of lines || []) {
    const l = clean(raw).toLowerCase();
    if (!checks.every((x) => l.includes(x))) continue;
    if (reject.some((x) => l.includes(x))) continue;
    const v = parseEuro(raw);
    if (v != null) return v;
  }
  return null;
}

function parseCertificate(pages, filename) {
  pages = Array.isArray(pages) ? pages : [];
  const lines = pages.flat().map(clean).filter(Boolean);
  const all = lines.join("\n");
  const first = Array.isArray(pages[0]) ? pages[0].map(clean) : [];
  const firstText = first.join("\n");
  const yearMatch = all.match(/Kalenderjahr\s+(20\d{2})/i) || String(filename).match(/(20\d{2})/);
  const dateMatch = all.match(/Datum:\s*(\d{2}\.\d{2}\.\d{4})/i);
  const provider = /comdirect/i.test(all) ? "comdirect"
    : (/commerzbank/i.test(all) ? "Commerzbank" : (/onvista/i.test(all) ? "onvista" : "Unbekannt"));

  const r = {
    id: filename,
    file: filename,
    year: yearMatch ? Number(yearMatch[1]) : null,
    date: dateMatch ? dateMatch[1] : "",
    provider,
    parsedAt: new Date().toISOString(),
    warning: "",
  };

  r.capital = amountOnLine(first, ["höhe der kapitalerträge"]);
  r.stockGain = amountOnLine(first, ["gewinn aus aktienveräußerungen"]);
  r.options = amountOnLine(first, ["stillhalterprämien"]);
  r.oldShares = amountOnLine(first, ["bestandsgeschützter alt-anteile"]);
  r.substitute = amountOnLine(first, ["ersatzbemessungsgrundlage"]);
  r.lossOther = amountOnLine(first, ["nicht ausgeglichenen verlustes ohne verlust"]);
  r.lossStock = amountOnLine(first, ["nicht ausgeglichenen verlustes aus der veräußerung von aktien"]);
  r.loss20_6_5 = amountOnLine(first, ["verlustes im sinne des § 20 abs. 6 satz 5"]);
  r.loss20_6_6 = amountOnLine(first, ["verlustes im sinne des § 20 abs. 6 satz 6"]);
  r.allowance = amountOnLine(first, ["sparer-pauschbetrages"]);
  r.tax = amountOnLine(first, ["kapitalertragsteuer"], ["kirchensteuer"]);
  r.soli = amountOnLine(first, ["solidaritätszuschlag"]);
  r.church = amountOnLine(first, ["kirchensteuer zur kapitalertragsteuer"]);
  r.foreignCredited = amountOnLine(first, ["angerechneten ausländischen steuer"]);
  r.foreignOpen = amountOnLine(first, ["anrechenbaren noch nicht angerechneten ausländischen steuer"]);
  r.foreignFictive = amountOnLine(lines, ["fiktiven ausländischen quellensteuer"]);
  r.taxableNoWithholding = amountOnLine(lines, ["nicht der kapitalertragsteuer unterliegen"]);

  // Amtliche comdirect-Tabelle: Beträge stehen bei manchen PDFs getrennt von ihren Beschriftungen.
  if (/comdirect/i.test(all) && (r.capital == null || r.allowance == null || r.tax == null)) {
    const idx = firstText.toLowerCase().lastIndexOf("zeile 15 anlage kap");
    const tail = idx >= 0 ? firstText.slice(idx) : firstText;
    const vals = [];
    const re = /-?\s*\d{1,3}(?:\.\d{3})*,\d{2}\s*EUR|-?\s*\d+,\d{2}\s*EUR/gi;
    let m;
    while ((m = re.exec(tail))) vals.push(parseEuro(m[0]));
    const keys = ["capital", "stockGain", "options", "oldShares", "substitute", "lossOther", "lossStock",
      "loss20_6_5", "loss20_6_6", "allowance", "tax", "soli", "churchA", "churchB", "foreignCredited", "foreignOpen"];
    if (vals.length >= 12) {
      keys.forEach((k, i) => {
        if (["churchA", "churchB"].includes(k)) return;
        if (r[k] == null && i < vals.length) r[k] = vals[i];
      });
      if (r.church == null && vals.length > 13) r.church = Number(vals[12] || 0) + Number(vals[13] || 0);
    }
  }

  // Plausibilitätsprüfung
  const found = FIELD_META.filter(([k]) => r[k] != null).length;
  const warnings = [];
  if (!r.year) warnings.push("Jahr nicht erkannt");
  if (found < 8) warnings.push(`nur ${found} Steuerwerte sicher erkannt`);
  if (r.capital != null && r.capital < -100000000) warnings.push("Kapitalerträge unplausibel");
  if (r.tax != null && r.tax < 0) warnings.push("negative Kapitalertragsteuer prüfen");
  r.warning = warnings.join(" · ");
  return r;
}

/* ------------------------------------------------------------ Kennzahlen */

function taxEuro(v) {
  if (v == null || !Number.isFinite(Number(v))) return "–";
  return eur(Number(v));
}

function numberDE(v, digits = 1) {
  if (!Number.isFinite(v)) return "–";
  return v.toLocaleString("de-DE", { minimumFractionDigits: digits, maximumFractionDigits: digits });
}

function percent(v, digits = 1) {
  return Number.isFinite(v) ? numberDE(v * 100, digits) + " %" : "–";
}

function taxYears() {
  return [...new Set(taxItems.map((x) => Number(x.year)).filter((y) => Number.isInteger(y)))]
    .sort((a, b) => b - a);
}

function taxCurrentYear() {
  const ys = taxYears();
  if (!ys.length) return TAX_YEAR || new Date().getFullYear();
  if (!ys.includes(Number(TAX_YEAR))) TAX_YEAR = ys[0];
  return Number(TAX_YEAR);
}

function taxYearItems(y) { return taxItems.filter((x) => Number(x.year) === Number(y)); }

function taxSum(y, key) {
  return taxYearItems(y).reduce((s, x) => s + (Number.isFinite(Number(x[key])) ? Number(x[key]) : 0), 0);
}

function taxTotal(y) { return taxSum(y, "tax") + taxSum(y, "soli") + taxSum(y, "church"); }

function taxQuota(y) { const c = taxSum(y, "capital"); return c > 0 ? taxTotal(y) / c : NaN; }

function allowanceRate(y) {
  const lim = Math.max(1, Number(cfg && cfg.allowanceLimit) || DEFAULTS.allowanceLimit);
  return Math.max(0, Math.min(1, taxSum(y, "allowance") / lim));
}

function taxPrevYear(y) {
  const ys = taxYears().slice().sort((a, b) => b - a);
  const i = ys.indexOf(Number(y));
  return i >= 0 && i < ys.length - 1 ? ys[i + 1] : null;
}

/* ------------------------------------------------------------ Diagramme */

const TAX_DASHBOARD_SIZE = { width: 760, height: 520 };
const TAX_HISTORY_SIZE = { width: 760, height: 360 };

function screenHeight() {
  try { return Device.screenSize().height; } catch (_) { return 844; }
}

function dashboardRowHeight() {
  return Math.round(Math.min(screenWidth() * 0.68, screenHeight() * 0.42));
}

function historyRowHeight() {
  return Math.round(Math.min(screenWidth() * 0.46, screenHeight() * 0.29));
}

/** Proportional in den verfügbaren Bereich einpassen und mittig ausrichten. */
function scaleImageToViewport(image, sourceSize, pointHeight) {
  const w = chartWidth();
  const h = Math.max(120, Math.round(pointHeight * 2));
  const dc = newCanvas(w, h);
  const factor = Math.min(w / sourceSize.width, h / sourceSize.height);
  const drawW = Math.round(sourceSize.width * factor);
  const drawH = Math.round(sourceSize.height * factor);
  const x = Math.round((w - drawW) / 2);
  const y = Math.round((h - drawH) / 2);
  dc.drawImageInRect(image, new Rect(x, y, drawW, drawH));
  return dc.getImage();
}

function taxDashboardImage(y) {
  const w = TAX_DASHBOARD_SIZE.width, h = TAX_DASHBOARD_SIZE.height;
  const pad = 24, gap = 16, cardW = (w - pad * 2 - gap) / 2, cardH = 138;
  const dc = newCanvas(w, h);
  chartSurface(dc, w, h, 4);

  function strokeLine(x1, y1, x2, y2) {
    const p = new Path();
    p.move(new Point(x1, y1));
    p.addLine(new Point(x2, y2));
    dc.addPath(p);
    dc.strokePath();
  }
  function rounded(x, yy, ww, hh, radius, fill) {
    const p = new Path();
    p.addRoundedRect(new Rect(x, yy, ww, hh), radius, radius);
    dc.addPath(p);
    dc.setFillColor(fill);
    dc.fillPath();
  }
  function text(txt, x, yy, ww, hh, font, color, align = 0) {
    dc.setFont(font);
    dc.setTextColor(color);
    if (align === 1) dc.setTextAlignedCenter();
    else if (align === 2) dc.setTextAlignedRight();
    else dc.setTextAlignedLeft();
    dc.drawTextInRect(txt, new Rect(x, yy, ww, hh));
  }
  function card(x, yy, title, value, sub, accent) {
    rounded(x, yy, cardW, cardH, 18, D.card);
    text(title, x + 18, yy + 14, cardW - 36, 26, Font.systemFont(22), D.dim);
    text(value, x + 18, yy + 46, cardW - 36, 38, Font.boldSystemFont(31), D.text);
    text(sub, x + 18, yy + 94, cardW - 36, 28, Font.systemFont(18), accent || D.dim);
  }

  const py = taxPrevYear(y);
  const cap = taxSum(y, "capital"), stock = taxSum(y, "stockGain");
  const taxes = taxTotal(y), allow = taxSum(y, "allowance");
  const prevCap = py ? taxSum(py, "capital") : 0;
  const diff = py ? cap - prevCap : NaN;
  const diffText = py ? `${diff >= 0 ? "+" : ""}${taxEuro(diff)} vs. ${py}` : "kein Vorjahr";
  card(pad, 18, "Kapitalerträge", taxEuro(cap), diffText, diff >= 0 ? D.plus : D.minus);
  card(pad + cardW + gap, 18, "Aktiengewinne", taxEuro(stock), "Zeile 8 Anlage KAP", D.plus);
  card(pad, 18 + cardH + gap, "Steuern gesamt", taxEuro(taxes), `Quote ${percent(taxQuota(y))}`, D.minus);
  card(pad + cardW + gap, 18 + cardH + gap, "Sparer-Pauschbetrag", taxEuro(allow),
    `${percent(allowanceRate(y), 0)} genutzt`, D.warn);

  const yy = 18 + (cardH + gap) * 2;
  rounded(pad, yy, w - pad * 2, 154, 18, D.card);
  text("Steuerquote", pad + 18, yy + 16, 250, 28, Font.systemFont(22), D.dim);
  text(percent(taxQuota(y)), pad + 18, yy + 48, 250, 42, Font.boldSystemFont(34), D.text);
  text("Abgaben bezogen auf Kapitalerträge", pad + 18, yy + 96, 320, 26, Font.systemFont(17), D.dim);
  const cx = w - pad - 95, cy = yy + 76, radius = 48;
  dc.setStrokeColor(D.grid);
  dc.setLineWidth(16);
  dc.strokeEllipse(new Rect(cx - radius, cy - radius, radius * 2, radius * 2));
  const rate = Number.isFinite(taxQuota(y)) ? Math.max(0, Math.min(1, taxQuota(y))) : 0;
  // einfacher Ringindikator als Segmente
  dc.setStrokeColor(D.blue);
  dc.setLineWidth(16);
  const segs = Math.max(1, Math.round(rate * 36));
  for (let i = 0; i < segs; i++) {
    const a = (-90 + i * 10) * Math.PI / 180, b = (-90 + (i + 1) * 10 - 2) * Math.PI / 180;
    strokeLine(cx + Math.cos(a) * radius, cy + Math.sin(a) * radius, cx + Math.cos(b) * radius, cy + Math.sin(b) * radius);
  }
  text(percent(taxQuota(y), 1), cx - 55, cy - 14, 110, 28, Font.boldSystemFont(20), D.text, 1);
  return scaleImageToViewport(dc.getImage(), TAX_DASHBOARD_SIZE, dashboardRowHeight());
}

function taxHistoryImage(ys, key, title, valueFormatter) {
  const w = TAX_HISTORY_SIZE.width, h = TAX_HISTORY_SIZE.height;
  const left = 62, right = 28, top = 56, bottom = 60;
  const dc = newCanvas(w, h);
  chartSurface(dc, w, h, 4);
  function strokeLine(x1, y1, x2, y2) {
    const p = new Path();
    p.move(new Point(x1, y1));
    p.addLine(new Point(x2, y2));
    dc.addPath(p);
    dc.strokePath();
  }
  dc.setTextColor(D.text);
  dc.setFont(Font.boldSystemFont(22));
  dc.setTextAlignedLeft();
  dc.drawTextInRect(title, new Rect(24, 14, w - 48, 30));
  const vals = ys.map((y) => key === "totalTax" ? taxTotal(y)
    : (key === "allowanceRate" ? allowanceRate(y) : taxSum(y, key)));
  const max = Math.max(1, ...vals.map((v) => Math.abs(v)));
  dc.setStrokeColor(D.grid);
  dc.setLineWidth(2);
  for (let g = 0; g <= 4; g++) {
    const yy = top + (h - top - bottom) * g / 4;
    strokeLine(left, yy, w - right, yy);
  }
  const slot = (w - left - right) / Math.max(1, ys.length), bw = Math.min(74, slot * 0.55);
  ys.forEach((y, i) => {
    const v = vals[i], bh = Math.max(3, Math.abs(v) / max * (h - top - bottom));
    const x = left + i * slot + (slot - bw) / 2, yy = h - bottom - bh;
    dc.setFillColor(key === "totalTax" ? D.minus : key === "allowanceRate" ? D.warn : D.blue);
    dc.fillRect(new Rect(x, yy, bw, bh));
    dc.setTextColor(D.text);
    dc.setFont(Font.semiboldSystemFont(16));
    dc.setTextAlignedCenter();
    dc.drawTextInRect(valueFormatter(v), new Rect(x - 22, Math.max(top, yy - 25), bw + 44, 22));
    dc.setTextColor(D.dim);
    dc.setFont(Font.systemFont(16));
    dc.setTextAlignedCenter();
    dc.drawTextInRect(String(y), new Rect(x - 20, h - bottom + 10, bw + 40, 24));
  });
  return scaleImageToViewport(dc.getImage(), TAX_HISTORY_SIZE, historyRowHeight());
}

/* -------------------------------------------------------------- Ansicht */

function addTaxSummaryRow() {
  const y = taxCurrentYear();
  const list = taxYearItems(y);
  const r = newRow(62);
  const left = r.addText(`Steuerjahr ${y}`,
    `${list.length} ${list.length === 1 ? "Bescheinigung" : "Bescheinigungen"}`);
  left.widthWeight = 44;
  left.titleFont = F.rowStrong;
  left.titleColor = C.text;
  left.subtitleFont = F.meta;
  left.subtitleColor = C.dim;

  const right = r.addText(taxEuro(taxSum(y, "capital")),
    `Steuern ${taxEuro(taxTotal(y))} · Quote ${percent(taxQuota(y))}`);
  right.widthWeight = 56;
  right.rightAligned();
  right.titleFont = F.big;
  right.titleColor = C.accent;
  right.subtitleFont = F.meta;
  right.subtitleColor = C.dim;
  table.addRow(r);
}

function setTaxYear(y) {
  TAX_YEAR = Number(y);
  cfg.taxYear = TAX_YEAR;
  setIniValue(dirs, "steuerjahr", String(TAX_YEAR));
  render();
}

function setTaxTab(id) {
  TAX_TAB = id;
  cfg.taxTab = id;
  setIniValue(dirs, "steueransicht", id);
  render();
}

function stepTaxYear(delta) {
  const ys = taxYears();
  if (!ys.length) return;
  const i = ys.indexOf(taxCurrentYear());
  const ni = i + delta;
  if (ni < 0 || ni >= ys.length) return;
  setTaxYear(ys[ni]);
}

async function chooseTaxYear() {
  const ys = taxYears();
  if (!ys.length) return;
  const value = await pickOption("Steuerjahr", ys.map((y) => ({ label: String(y), value: y })), taxCurrentYear());
  if (value === null) return;
  setTaxYear(value);
}

function addTaxYearNavigation() {
  const r = newRow(44);
  r.backgroundColor = C.head;
  const prev = r.addButton("‹");
  prev.widthWeight = 18;
  prev.centerAligned();
  prev.titleFont = Font.boldSystemFont(24);
  prev.titleColor = C.accent;
  prev.onTap = () => stepTaxYear(1);

  const year = r.addButton("▦  " + taxCurrentYear());
  year.widthWeight = 64;
  year.centerAligned();
  year.titleFont = F.rowStrong;
  year.titleColor = C.text;
  year.onTap = async () => { await chooseTaxYear(); };

  const next = r.addButton("›");
  next.widthWeight = 18;
  next.centerAligned();
  next.titleFont = Font.boldSystemFont(24);
  next.titleColor = C.accent;
  next.onTap = () => stepTaxYear(-1);
  table.addRow(r);
}

function addTaxSubTabs() {
  const r = newRow(38);
  r.backgroundColor = C.head;
  for (const t of TAX_TABS) {
    const b = r.addButton(t.label);
    b.widthWeight = 33;
    b.centerAligned();
    b.titleFont = TAX_TAB === t.id ? Font.boldSystemFont(13) : Font.systemFont(13);
    b.titleColor = TAX_TAB === t.id ? C.accent : C.dim;
    b.onTap = () => { setTaxTab(t.id); };
  }
  table.addRow(r);
}

function buildTax() {
  if (!taxItems.length) {
    addStamp("Keine Jahressteuerbescheinigung gefunden", C.text);
    addInfo(`Gesucht wird nach PDFs mit „${cfg.taxPattern}“ im Namen in ${source.label}. `
      + "Über ⤓ lädt die Postbox die Bescheinigungen, über „Import …“ in den Einstellungen "
      + "lassen sich vorhandene PDFs übernehmen.");
    addButtonRow("Postbox laden", async () => { await startDownload(); });
    addButtonRow("Einstellungen öffnen", () => { showSettings("tax"); });
    return;
  }
  if (TAX_TAB === "history") buildTaxHistory();
  else if (TAX_TAB === "kap") buildTaxKap();
  else buildTaxOverview();
}

function buildTaxOverview() {
  const y = taxCurrentYear();
  if (!taxYearItems(y).length) {
    addInfo(`Für ${y} liegt keine ausgelesene Bescheinigung vor.`);
    return;
  }
  addImageRow(taxDashboardImage(y), dashboardRowHeight());

  const py = taxPrevYear(y);
  if (py) {
    const capDiff = taxSum(y, "capital") - taxSum(py, "capital");
    const taxDiff = taxTotal(y) - taxTotal(py);
    const rateDiff = taxQuota(y) - taxQuota(py);
    addStamp(`Vorjahresvergleich · ${y} gegen ${py}`);
    addValueRow({
      title: "Kapitalerträge",
      subtitle: "Differenz zum Vorjahr",
      value: `${capDiff >= 0 ? "+" : ""}${taxEuro(capDiff)}`,
      valueColor: capDiff >= 0 ? C.plus : C.minus,
    });
    addValueRow({
      title: "Steuern gesamt",
      subtitle: "KapESt + Soli + Kirchensteuer",
      value: `${taxDiff >= 0 ? "+" : ""}${taxEuro(taxDiff)}`,
      valueColor: taxDiff <= 0 ? C.plus : C.minus,
    });
    addValueRow({
      title: "Steuerquote",
      subtitle: "Veränderung der effektiven Quote",
      value: Number.isFinite(rateDiff) ? `${rateDiff >= 0 ? "+" : ""}${numberDE(rateDiff * 100, 1)} %-Pkt.` : "–",
      valueColor: rateDiff <= 0 ? C.plus : C.minus,
    });
  }

  addStamp("Bescheinigungen");
  for (const it of taxYearItems(y)) {
    addValueRow({
      height: 62,
      title: String(it.file).split("/").pop(),
      subtitle: `${it.date || "ohne Datum"} · ${it.provider} · ${it.warning ? "⚠︎ prüfen" : "✓ ausgewertet"}`,
      value: taxEuro(it.capital),
      valueSub: taxEuro((Number(it.tax) || 0) + (Number(it.soli) || 0) + (Number(it.church) || 0)) + " Steuern",
      valueColor: C.accent,
      onSelect: async () => { await showTaxDocument(it); },
    });
  }

  const warns = taxYearItems(y).filter((x) => x.warning);
  if (warns.length) {
    addStamp("Prüfhinweis", C.warn);
    addInfo(warns.map((x) => `${String(x.file).split("/").pop()}: ${x.warning}`).join(" · "), C.warn);
  }
}

function buildTaxHistory() {
  const ys = taxYears().slice().sort((a, b) => a - b);
  if (!ys.length) {
    addInfo("Keine Verlaufsdaten. Zuerst Jahressteuerbescheinigungen einlesen.");
    return;
  }
  const short = (v) => taxEuro(v).replace(",00 €", " €");
  addImageRow(taxHistoryImage(ys, "capital", "Kapitalerträge nach Jahr", short), historyRowHeight());
  addImageRow(taxHistoryImage(ys, "totalTax", "Steuern gesamt nach Jahr", short), historyRowHeight());
  addImageRow(taxHistoryImage(ys, "allowanceRate", "Sparer-Pauschbetrag genutzt", (v) => percent(v, 0)), historyRowHeight());

  addStamp("Jahresvergleich · Kapitalerträge, Steuerquote, Pauschbetrag");
  taxYears().forEach((y) => {
    addValueRow({
      height: 64,
      title: String(y),
      subtitle: `Steuerquote ${percent(taxQuota(y))} · Pauschbetrag ${percent(allowanceRate(y), 0)}`,
      titleFont: Font.boldSystemFont(16),
      value: taxEuro(taxSum(y, "capital")),
      valueSub: taxEuro(taxTotal(y)) + " Steuern",
      valueColor: C.accent,
      onSelect: () => {
        TAX_YEAR = Number(y);
        cfg.taxYear = TAX_YEAR;
        setIniValue(dirs, "steuerjahr", String(TAX_YEAR));
        setTaxTab("overview");
      },
    });
  });
}

function buildTaxKap() {
  const y = taxCurrentYear();
  if (!taxYearItems(y).length) {
    addInfo(`Für ${y} liegen keine ausgelesenen Bescheinigungen vor.`);
    return;
  }
  addStamp(`Anlage KAP ${y} · alle erkannten Felder`);
  FIELD_META.forEach(([k, labelText, line, desc]) => {
    const value = taxSum(y, k);
    let icon = "";
    if (k === "capital" || k === "stockGain") icon = "↗";
    else if (k.startsWith("loss")) icon = "↘";
    else if (k === "tax" || k === "soli" || k === "church") icon = "€";
    else if (k === "allowance") icon = "%";
    else if (k.startsWith("foreign")) icon = "◎";
    addValueRow({
      height: 58,
      title: `${line} · ${icon ? icon + " " : ""}${labelText}`,
      subtitle: desc,
      value: taxEuro(value),
      valueColor: value < 0 ? C.minus : C.text,
    });
  });
  addInfo("Die App dient der Übersicht. Vor Abgabe der Steuererklärung die Werte immer mit der "
    + "Originalbescheinigung abgleichen.");
  addSpacer(24);
}

async function showTaxDocument(it) {
  const a = new Alert();
  a.title = `${it.provider} ${it.year || ""}`;
  a.message = `${String(it.file).split("/").pop()}\n${it.warning ? "⚠︎ " + it.warning + "\n\n" : ""}`
    + FIELD_META.map(([k, l, line]) => `${line} · ${l}: ${taxEuro(it[k])}`).join("\n");
  a.addAction("Original-PDF öffnen");
  a.addCancelAction("Schließen");
  const i = await a.presentSheet();
  if (i === 0) {
    const owner = managerForPath(source.path);
    await openDocument(owner.joinPath(source.path, it.file));
  }
}

/* ============================== Wertpapierabrechnungen und Positionen === */

function tradeParseNumber(value) {
  if (value == null) return null;
  const m = String(value).match(/-?\s*\d{1,3}(?:\.\d{3})*(?:,\d+)?|-?\s*\d+(?:,\d+)?/);
  if (!m) return null;
  const n = Number(m[0].replace(/\s/g, "").replace(/\./g, "").replace(",", "."));
  return Number.isFinite(n) ? n : null;
}

function tradeEuroNear(text, labelText) {
  const escaped = labelText.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const re = new RegExp(escaped + "[\\s\\S]{0,60}?EUR\\s*:?\\s*(-?\\s*\\d{1,3}(?:\\.\\d{3})*,\\d{2}|-?\\s*\\d+,\\d{2})", "i");
  const m = String(text).match(re);
  return m ? tradeParseNumber(m[1]) : null;
}

function tradeDateIso(value) {
  const m = String(value || "").match(/(\d{2})\.(\d{2})\.(\d{4})/);
  return m ? `${m[3]}-${m[2]}-${m[1]}` : "";
}

function parseTradeDocument(pages, filename) {
  const lines = (Array.isArray(pages) ? pages : []).flat().map(clean).filter(Boolean);
  const all = lines.join("\n"), flat = clean(all);
  const typeM = all.match(/Wertpapier(kauf|verkauf)/i);
  const tradeType = typeM ? (/kauf/i.test(typeM[1]) ? "Kauf" : "Verkauf")
    : (/Zu Ihren Lasten/i.test(all) ? "Kauf" : (/Zu Ihren Gunsten/i.test(all) ? "Verkauf" : "Unbekannt"));
  const dateM = all.match(/Geschäftstag\s*:?\s*(\d{2}\.\d{2}\.\d{4})/i)
    || all.match(/GESCHÄFTSABRECHNUNG VOM\s*(\d{2}\.\d{2}\.\d{4})/i);
  const valutaM = all.match(/Valuta\s*(\d{2}\.\d{2}\.\d{4})/i)
    || all.match(/Valuta\s+Zu Ihren[\s\S]{0,60}?(\d{2}\.\d{2}\.\d{4})/i);
  const venueM = flat.match(/Ausführungsplatz\s*:?\s*(?:[A-F0-9]{12,}\s*:?\s*)?([A-ZÄÖÜ][A-ZÄÖÜ0-9 ._-]{2,25})(?=\s*\(|\s+Wertpapier|\s+Kommissions)/i);
  const businessM = all.match(/Geschäftsnummer\s*:?\s*([\d ]+)/i)
    || all.match(/Wertpapier(?:kauf|verkauf)\s+Nr\.\s*(\d+)/i);
  const isinM = all.match(/\b([A-Z]{2}[A-Z0-9]{9}\d)\b/);
  const wknM = all.match(/WPKNR\/ISIN[\s\S]{0,160}?\b([A-Z0-9]{6})\b[\s\S]{0,50}?\b[A-Z]{2}[A-Z0-9]{9}\d\b/i)
    || all.match(/WKN\s*\/\s*ISIN\s*:?\s*([A-Z0-9]{6})/i);
  const qtyM = all.match(/(?:Nennwert|Stk\.)[\s\S]{0,35}?St\.?\s*([\d.]+,\d+)/i)
    || all.match(/Stk\.\s*([\d.]+,\d+)/i);
  const priceM = all.match(/Zum Kurs von[\s\S]{0,40}?EUR\s*([\d.]+,\d+)/i);
  const valueM = all.match(/Kurswert\s*:?\s*EUR\s*([\d.]+,\d{2})/i);
  let securityName = "";
  const nameM = all.match(/Wertpapier-Bezeichnung(?:\s+WPKNR\/ISIN)?\s*\n([^\n]+)/i);
  if (nameM) securityName = clean(nameM[1]);
  if (!securityName) {
    const alt = all.match(/Stk\.\s*[\d.,]+\s+([^,\n]+),\s*WKN/i);
    if (alt) securityName = clean(alt[1]);
  }
  const provision = tradeEuroNear(all, "Provision");
  const extraFees = ["Börsengebühr", "Handelsplatzentgelt", "Fremde Spesen", "Transaktionsentgelt"]
    .map((x) => tradeEuroNear(all, x)).filter((x) => x != null);
  const totalFees = (provision || 0) + extraFees.reduce((s, x) => s + x, 0);
  let gross = tradeEuroNear(all, tradeType === "Verkauf" ? "Zu Ihren Gunsten vor Steuern" : "Zu Ihren Lasten vor Steuern");
  let net = tradeEuroNear(all, tradeType === "Verkauf" ? "Zu Ihren Gunsten nach Steuern" : "Zu Ihren Lasten nach Steuern");
  if (gross != null) gross = tradeType === "Kauf" ? -Math.abs(gross) : Math.abs(gross);
  if (net != null) net = tradeType === "Kauf" ? -Math.abs(net) : Math.abs(net);
  const taxBase = tradeEuroNear(all, "Steuerbemessungsgrundlage");
  const capitalTax = tradeEuroNear(all, "Kapitalertragsteuer");
  const soli = tradeEuroNear(all, "Solidaritätszuschlag");
  const church = tradeEuroNear(all, "Kirchensteuer");
  const taxes = [capitalTax, soli, church].reduce((s, x) => s + (Number.isFinite(x) ? x : 0), 0);
  const fileYear = (String(filename).match(/(20\d{2})/) || [])[1];
  const warnings = [];
  if (!dateM) warnings.push("Geschäftstag nicht erkannt");
  if (!isinM && !wknM) warnings.push("WKN/ISIN nicht erkannt");
  if (!qtyM) warnings.push("Stückzahl nicht erkannt");
  if (!valueM) warnings.push("Kurswert nicht erkannt");
  return {
    id: filename, file: filename,
    provider: /comdirect/i.test(all) ? "comdirect" : (/commerzbank/i.test(all) ? "Commerzbank" : "Unbekannt"),
    tradeType,
    year: dateM ? Number(dateM[1].slice(-4)) : (fileYear ? Number(fileYear) : null),
    month: dateM ? Number(dateM[1].slice(3, 5)) : null,
    tradeDate: dateM ? dateM[1] : "", tradeDateISO: dateM ? tradeDateIso(dateM[1]) : "",
    settlementDate: valutaM ? valutaM[1] : "",
    venue: venueM ? clean(venueM[1]).replace(/\s*\(.*/, "") : "",
    businessNo: businessM ? clean(businessM[1]).replace(/\s/g, "") : "",
    securityName, wkn: wknM ? wknM[1] : "", isin: isinM ? isinM[1] : "",
    quantity: qtyM ? tradeParseNumber(qtyM[1]) : null,
    price: priceM ? tradeParseNumber(priceM[1]) : null,
    marketValue: valueM ? tradeParseNumber(valueM[1]) : null,
    provision, totalFees, grossAmount: gross, taxBase, capitalTax, soli, church, taxes, netAmount: net,
    parsedAt: new Date().toISOString(), warning: warnings.join(" · "),
  };
}

function tradeYears() {
  return [...new Set(tradeItems.map((x) => Number(x.year)).filter(Number.isInteger))].sort((a, b) => b - a);
}
function tradeCurrentYear() {
  const ys = tradeYears();
  if (!ys.length) return TRADE_YEAR || new Date().getFullYear();
  if (!ys.includes(Number(TRADE_YEAR))) TRADE_YEAR = ys[0];
  return Number(TRADE_YEAR);
}
function tradeYearItems(y) { return tradeItems.filter((x) => Number(x.year) === Number(y)); }
function tradeSum(y, key) {
  return tradeYearItems(y).reduce((s, x) => s + (Number.isFinite(Number(x[key])) ? Number(x[key]) : 0), 0);
}
function tradeBuys(y) { return tradeYearItems(y).filter((x) => x.tradeType === "Kauf"); }
function tradeSells(y) { return tradeYearItems(y).filter((x) => x.tradeType === "Verkauf"); }
function tradeAmount(x) {
  if (Number.isFinite(Number(x.netAmount))) return Number(x.netAmount);
  if (Number.isFinite(Number(x.grossAmount))) return Number(x.grossAmount);
  return x.tradeType === "Kauf" ? -Math.abs(Number(x.marketValue) || 0) : Math.abs(Number(x.marketValue) || 0);
}
function tradeInvested(y) { return tradeBuys(y).reduce((s, x) => s + Math.abs(tradeAmount(x)), 0); }
function tradeProceeds(y) { return tradeSells(y).reduce((s, x) => s + Math.abs(tradeAmount(x)), 0); }
function tradeCashflow(y) { return tradeYearItems(y).reduce((s, x) => s + tradeAmount(x), 0); }
function groupedTrades(y) {
  const map = new Map();
  for (const x of tradeYearItems(y)) {
    const key = x.isin || x.wkn || x.securityName || "Unbekannt";
    if (!map.has(key)) map.set(key, {
      key, name: x.securityName || "Unbekannt", wkn: x.wkn || "", isin: x.isin || "",
      buyQty: 0, sellQty: 0, buyValue: 0, sellValue: 0, fees: 0, trades: 0,
    });
    const g = map.get(key), q = Number(x.quantity) || 0, v = Math.abs(Number(x.marketValue) || 0);
    g.trades++; g.fees += Number(x.totalFees) || 0;
    if (x.tradeType === "Verkauf") { g.sellQty += q; g.sellValue += v; }
    else { g.buyQty += q; g.buyValue += v; }
  }
  return Array.from(map.values()).sort((a, b) => (b.buyValue + b.sellValue) - (a.buyValue + a.sellValue));
}

const TRADE_DASHBOARD_SIZE = { width: 760, height: 520 };

function tradeDashboardImage(y) {
  const w = 760, h = 520, pad = 24, gap = 16, cardW = (w - pad * 2 - gap) / 2, cardH = 138;
  const dc = newCanvas(w, h); chartSurface(dc, w, h, 4);
  function rounded(x, yy, ww, hh, radius, fill) {
    const p = new Path(); p.addRoundedRect(new Rect(x, yy, ww, hh), radius, radius);
    dc.addPath(p); dc.setFillColor(fill); dc.fillPath();
  }
  function text(txt, x, yy, ww, hh, font, color) {
    dc.setFont(font); dc.setTextColor(color); dc.setTextAlignedLeft();
    dc.drawTextInRect(String(txt), new Rect(x, yy, ww, hh));
  }
  function card(x, yy, title, value, sub, accent) {
    rounded(x, yy, cardW, cardH, 18, D.card);
    text(title, x + 18, yy + 14, cardW - 36, 26, Font.systemFont(22), D.dim);
    text(value, x + 18, yy + 46, cardW - 36, 38, Font.boldSystemFont(31), D.text);
    text(sub, x + 18, yy + 94, cardW - 36, 28, Font.systemFont(18), accent || D.dim);
  }
  card(pad, 18, "Transaktionen", String(tradeYearItems(y).length),
    `${tradeBuys(y).length} Käufe · ${tradeSells(y).length} Verkäufe`, D.accent);
  card(pad + cardW + gap, 18, "Käufe", taxEuro(tradeInvested(y)), "Abfluss laut Abrechnungen", D.blue);
  card(pad, 18 + cardH + gap, "Verkäufe", taxEuro(tradeProceeds(y)), "Zufluss laut Abrechnungen", D.plus);
  card(pad + cardW + gap, 18 + cardH + gap, "Gebühren", taxEuro(tradeSum(y, "totalFees")),
    `Steuern ${taxEuro(tradeSum(y, "taxes"))}`, D.warn);
  const yy = 18 + (cardH + gap) * 2, cash = tradeCashflow(y);
  rounded(pad, yy, w - pad * 2, 154, 18, D.card);
  text("Netto-Cashflow", pad + 18, yy + 18, 360, 30, Font.systemFont(22), D.dim);
  text(taxEuro(cash), pad + 18, yy + 52, 500, 45, Font.boldSystemFont(36), cash >= 0 ? D.plus : D.minus);
  text("Verkäufe minus Käufe, jeweils nach Steuern", pad + 18, yy + 104, 560, 26, Font.systemFont(17), D.dim);
  return scaleImageToViewport(dc.getImage(), TRADE_DASHBOARD_SIZE, dashboardRowHeight());
}

function tradeHistoryImage(ys, valueFn, title, color) {
  const w = 760, h = 360, left = 62, right = 28, top = 56, bottom = 60;
  const dc = newCanvas(w, h); chartSurface(dc, w, h, 4);
  function line(x1, y1, x2, y2) {
    const p = new Path(); p.move(new Point(x1, y1)); p.addLine(new Point(x2, y2));
    dc.addPath(p); dc.strokePath();
  }
  dc.setTextColor(D.text); dc.setFont(Font.boldSystemFont(22)); dc.setTextAlignedLeft();
  dc.drawTextInRect(title, new Rect(24, 14, w - 48, 30));
  const values = ys.map(valueFn), max = Math.max(1, ...values.map((v) => Math.abs(v)));
  dc.setStrokeColor(D.grid); dc.setLineWidth(2);
  for (let g = 0; g <= 4; g++) line(left, top + (h - top - bottom) * g / 4, w - right, top + (h - top - bottom) * g / 4);
  const slot = (w - left - right) / Math.max(1, ys.length), bw = Math.min(74, slot * 0.55);
  ys.forEach((y, i) => {
    const v = values[i], bh = Math.max(3, Math.abs(v) / max * (h - top - bottom));
    const x = left + i * slot + (slot - bw) / 2, yy = h - bottom - bh;
    dc.setFillColor(color || D.blue); dc.fillRect(new Rect(x, yy, bw, bh));
    dc.setTextColor(D.text); dc.setFont(Font.semiboldSystemFont(16)); dc.setTextAlignedCenter();
    dc.drawTextInRect(eurShort(v), new Rect(x - 22, Math.max(top, yy - 25), bw + 44, 22));
    dc.setTextColor(D.dim); dc.setFont(Font.systemFont(16));
    dc.drawTextInRect(String(y), new Rect(x - 20, h - bottom + 10, bw + 40, 24));
  });
  return scaleImageToViewport(dc.getImage(), { width: w, height: h }, historyRowHeight());
}

function setTradeYear(y) {
  TRADE_YEAR = Number(y); cfg.tradeYear = TRADE_YEAR;
  setIniValue(dirs, "wertpapierjahr", String(TRADE_YEAR)); render();
}
function setTradeTab(id) {
  if (!TRADE_TABS.some((x) => x.id === id)) return;
  TRADE_TAB = id; cfg.tradeTab = id; setIniValue(dirs, "wertpapieransicht", id); render();
}
function stepTradeYear(delta) {
  const ys = tradeYears(), i = ys.indexOf(tradeCurrentYear()), next = i + delta;
  if (next >= 0 && next < ys.length) setTradeYear(ys[next]);
}
async function chooseTradeYear() {
  const ys = tradeYears(); if (!ys.length) return;
  const value = await pickOption("Wertpapierjahr", ys.map((y) => ({ label: String(y), value: y })), tradeCurrentYear());
  if (value !== null) setTradeYear(value);
}
function addTradeSummaryRow() {
  const y = tradeCurrentYear(), list = tradeYearItems(y), cash = tradeCashflow(y);
  addValueRow({
    height: 62, title: `Wertpapierjahr ${y}`,
    subtitle: `${list.length} ${list.length === 1 ? "Abrechnung" : "Abrechnungen"}`,
    value: taxEuro(cash), valueSub: `${tradeBuys(y).length} Käufe · ${tradeSells(y).length} Verkäufe`,
    valueColor: cash >= 0 ? C.plus : C.minus,
  });
}
function addTradeYearNavigation() {
  if (!tradeYears().length) return;
  addChipRow([
    { label: "‹", font: Font.boldSystemFont(24), onTap: () => stepTradeYear(1) },
    { label: "▦  " + tradeCurrentYear(), on: true, onTap: async () => { await chooseTradeYear(); } },
    { label: "›", font: Font.boldSystemFont(24), onTap: () => stepTradeYear(-1) },
  ], 44, C.head);
}
function addTradeTabs() {
  addChipRow(TRADE_TABS.map((x) => ({
    label: x.label, on: TRADE_TAB === x.id, onTap: () => setTradeTab(x.id),
  })), 42, C.head);
}

function buildTradeOverview() {
  const y = tradeCurrentYear(), list = tradeYearItems(y);
  if (!list.length) {
    addInfo("Noch keine Wertpapierabrechnung. Über die Postbox laden oder im Arbeitsordner PDFs importieren.");
    return;
  }
  addImageRow(tradeDashboardImage(y), dashboardRowHeight());
  addStamp("Aktivität");
  addValueRow({ title: "Kurswerte Käufe", subtitle: `${tradeBuys(y).length} Kaufabrechnungen`,
    value: taxEuro(tradeBuys(y).reduce((s, x) => s + (Number(x.marketValue) || 0), 0)), valueColor: C.accent });
  addValueRow({ title: "Kurswerte Verkäufe", subtitle: `${tradeSells(y).length} Verkaufsabrechnungen`,
    value: taxEuro(tradeSells(y).reduce((s, x) => s + (Number(x.marketValue) || 0), 0)), valueColor: C.plus });
  addValueRow({ title: "Provision und Entgelte", subtitle: "Aus den Abrechnungen erkannt",
    value: taxEuro(tradeSum(y, "totalFees")), valueColor: C.warn });
  const warnings = list.filter((x) => x.warning);
  if (warnings.length) addInfo(`${warnings.length} Abrechnung${warnings.length === 1 ? "" : "en"} mit Prüfhinweisen.`, C.warn);
}

function buildTradeHistory() {
  const ys = tradeYears().slice().sort((a, b) => a - b);
  if (!ys.length) { addInfo("Keine Verlaufsdaten vorhanden."); return; }
  addImageRow(tradeHistoryImage(ys, tradeInvested, "Käufe nach Jahr", D.blue), historyRowHeight());
  addImageRow(tradeHistoryImage(ys, (y) => tradeSum(y, "totalFees"), "Gebühren nach Jahr", D.warn), historyRowHeight());
  addStamp("Jahresvergleich");
  tradeYears().forEach((y) => addValueRow({
    height: 64, title: String(y),
    subtitle: `${tradeYearItems(y).length} Trades · ${tradeBuys(y).length} Käufe · ${tradeSells(y).length} Verkäufe`,
    value: taxEuro(tradeInvested(y)), valueSub: `${taxEuro(tradeSum(y, "totalFees"))} Gebühren`,
    valueColor: C.accent, onSelect: () => { setTradeYear(y); setTradeTab("overview"); },
  }));
}

function buildTradePositions() {
  const y = tradeCurrentYear(), groups = groupedTrades(y);
  if (!groups.length) { addInfo("Für dieses Jahr liegen keine erkannten Wertpapiere vor."); return; }
  addStamp(`Positionen ${y} · aus Abrechnungen berechnet`);
  groups.forEach((g) => {
    const netQty = g.buyQty - g.sellQty, avg = g.buyQty > 0 ? g.buyValue / g.buyQty : null;
    addValueRow({
      height: 82, title: g.name,
      subtitle: `${g.wkn ? "WKN " + g.wkn : ""}${g.isin ? " · " + g.isin : ""}\n${g.trades} Trades · rechnerisch ${numberDE(netQty, 3)} St.`,
      value: taxEuro(g.buyValue), valueSub: avg != null ? `Ø Kaufkurs ${taxEuro(avg)}` : `Verkäufe ${taxEuro(g.sellValue)}`,
      valueColor: C.accent,
    });
  });
  addInfo("Der rechnerische Bestand berücksichtigt nur vorhandene Abrechnungen, keine Depotüberträge oder Splits.");
}

async function showTradeDocument(it) {
  const a = new Alert();
  a.title = `${it.tradeType || "Trade"} · ${it.securityName || it.wkn || "Wertpapier"}`;
  a.message = `${String(it.file).split("/").pop()}\n${it.warning ? "⚠︎ " + it.warning + "\n\n" : ""}`
    + `Geschäftstag: ${it.tradeDate || "–"}\nValuta: ${it.settlementDate || "–"}\n`
    + `WKN / ISIN: ${it.wkn || "–"} / ${it.isin || "–"}\nStück: ${numberDE(it.quantity, 3)}\n`
    + `Kurs: ${taxEuro(it.price)}\nKurswert: ${taxEuro(it.marketValue)}\nGebühren: ${taxEuro(it.totalFees)}\n`
    + `Steuern: ${taxEuro(it.taxes)}\nEndbetrag: ${taxEuro(it.netAmount)}`;
  a.addAction("Original-PDF öffnen"); a.addCancelAction("Schließen");
  if (await a.presentSheet() === 0) {
    await openDocument(managerForPath(source.path).joinPath(source.path, it.file));
  }
}

function buildTradeDocuments() {
  const sorted = tradeItems.slice().sort((a, b) => String(b.tradeDateISO || "").localeCompare(String(a.tradeDateISO || "")));
  addStamp(`${sorted.length} ausgewertete Wertpapierabrechnung${sorted.length === 1 ? "" : "en"}`);
  if (!sorted.length) { addInfo("Keine passenden PDFs eingelesen."); return; }
  sorted.forEach((it) => addValueRow({
    height: 72, title: it.securityName || String(it.file).split("/").pop(),
    subtitle: `${it.tradeDate || "ohne Datum"} · ${it.tradeType || "Unbekannt"} · ${it.warning ? "prüfen" : "ausgewertet"}`,
    value: `${numberDE(it.quantity, 3)} St.`, valueSub: taxEuro(it.marketValue),
    valueColor: it.warning ? C.warn : C.accent, onSelect: async () => { await showTradeDocument(it); },
  }));
}

function buildTrade() {
  if (TRADE_TAB === "history") buildTradeHistory();
  else if (TRADE_TAB === "positions") buildTradePositions();
  else if (TRADE_TAB === "documents") buildTradeDocuments();
  else buildTradeOverview();
}

async function exportTradeCsv() {
  if (!tradeItems.length) { flash("Keine Wertpapierdaten vorhanden."); return; }
  const esc = (v) => `"${String(v == null ? "" : v).replace(/"/g, '""')}"`;
  const headers = ["Jahr", "Datum", "Typ", "Wertpapier", "WKN", "ISIN", "Stück", "Kurs", "Kurswert",
    "Gebühren", "Steuerbemessungsgrundlage", "KapESt", "Soli", "Kirchensteuer", "Steuern gesamt",
    "Endbetrag", "Handelsplatz", "Datei"];
  const rows = [headers.map(esc).join(";")];
  tradeItems.slice().sort((a, b) => String(a.tradeDateISO || "").localeCompare(String(b.tradeDateISO || ""))).forEach((x) => {
    const vals = [x.year || "", x.tradeDate || "", x.tradeType || "", x.securityName || "", x.wkn || "", x.isin || "",
      x.quantity, x.price, x.marketValue, x.totalFees, x.taxBase, x.capitalTax, x.soli, x.church, x.taxes,
      x.netAmount, x.venue || "", x.file || ""];
    rows.push(vals.map((v) => esc(typeof v === "number" ? v.toFixed(4).replace(".", ",") : v)).join(";"));
  });
  const path = fm.joinPath(dirs.exportDir, `Wertpapier_Export_${new Date().toISOString().slice(0, 10)}.csv`);
  fm.writeString(path, "\uFEFF" + rows.join("\n"));
  flash("Gesichert: export/" + path.split("/").pop());
  try { await ShareSheet.present([path]); } catch (e) { /* Datei bleibt im Arbeitsordner */ }
}

/* ------------------------------------------------- Export und Sicherung */

function taxCsvEscape(s) { return `"${String(s == null ? "" : s).replace(/"/g, '""')}"`; }

async function exportTaxCsv() {
  if (!taxItems.length) { flash("Keine Steuerwerte vorhanden."); return; }
  const headers = ["Jahr", "Datei", "Anbieter", "Datum"].concat(FIELD_META.map((x) => x[2] + " " + x[1]));
  const rows = [headers.map(taxCsvEscape).join(";")];
  taxItems.slice().sort((a, b) => (a.year || 0) - (b.year || 0)).forEach((it) => {
    const vals = [it.year || "", String(it.file || "").split("/").pop(), it.provider || "", it.date || ""]
      .concat(FIELD_META.map(([k]) => Number.isFinite(Number(it[k])) ? Number(it[k]).toFixed(2).replace(".", ",") : ""));
    rows.push(vals.map(taxCsvEscape).join(";"));
  });
  const path = fm.joinPath(dirs.exportDir, `Jahressteuer_${new Date().toISOString().slice(0, 10)}.csv`);
  fm.writeString(path, rows.join("\n"));
  flash("Gesichert: export/" + path.split("/").pop());
  try { await ShareSheet.present([path]); } catch (e) { /* Datei liegt lokal bereit */ }
}

async function createBackup() {
  const payload = {
    app: APP,
    version: VERSION,
    createdAt: new Date().toISOString(),
    ini: readConfig(dirs),
    tax: { items: taxItems, signatures: taxSignatures },
    securities: { items: tradeItems, signatures: tradeSignatures },
    bookings: { sourceRef: cfg.path, bookings, files: fileInfos },
  };
  const path = fm.joinPath(dirs.exportDir, `comdirect_Backup_${new Date().toISOString().slice(0, 10)}.json`);
  fm.writeString(path, JSON.stringify(payload, null, 2));
  flash("Backup: export/" + path.split("/").pop());
  try { await ShareSheet.present([path]); } catch (e) { /* Datei liegt lokal bereit */ }
}

async function restoreBackup() {
  let picked = null;
  try { picked = await DocumentPicker.open(["public.json", "public.data", "public.item"]); }
  catch (e) { return; }
  if (Array.isArray(picked)) picked = picked[0];
  if (!picked) return;
  try {
    await ensureDownloaded(picked);
    const data = safeObject(JSON.parse(managerForPath(picked).readString(picked)), {});
    if (typeof data.ini === "string" && data.ini.trim()) {
      writeConfig(dirs, data.ini);
      cfg = readIni(readConfig(dirs));
      APPEARANCE = cfg.appearance || "system";
      source = resolveStorage(dirs, cfg.path);
    }
    const tax = safeObject(data.tax, {});
    if (Array.isArray(tax.items)) {
      taxItems = tax.items;
      taxSignatures = safeObject(tax.signatures, {});
      writeTaxCache(dirs, taxItems, taxSignatures);
    }
    const securities = safeObject(data.securities, {});
    if (Array.isArray(securities.items)) {
      tradeItems = securities.items;
      tradeSignatures = safeObject(securities.signatures, {});
      writeTradeCache(dirs, tradeItems, tradeSignatures);
    }
    const book = safeObject(data.bookings, {});
    if (Array.isArray(book.bookings) && book.bookings.length) {
      bookings = book.bookings;
      fileInfos = Array.isArray(book.files) ? book.files : [];
      writeBookingsCache(dirs, cfg.path, bookings, fileInfos);
    }
    initPeriod();
    VIEW = { name: "main" };
    flash("Backup wiederhergestellt.");
  } catch (e) {
    await showError(e);
  }
}

async function rebuildCaches() {
  const confirmed = await choose("Auswertung neu aufbauen?",
    "Alle gespeicherten Analysewerte für Buchungen, Steuer- und Wertpapierbelege werden verworfen "
    + "und die vorhandenen PDFs neu gelesen.", ["Neu aufbauen"]);
  if (confirmed !== 0) return;
  try { if (fm.fileExists(dirs.cache)) fm.remove(dirs.cache); } catch (e) { /* egal */ }
  try { if (fm.fileExists(dirs.taxCache)) fm.remove(dirs.taxCache); } catch (e) { /* egal */ }
  try { if (fm.fileExists(dirs.tradeCache)) fm.remove(dirs.tradeCache); } catch (e) { /* egal */ }
  bookings = [];
  fileInfos = [];
  pageCache = [];
  taxItems = [];
  taxSignatures = {};
  tradeItems = [];
  tradeSignatures = {};
  VIEW = { name: "main" };
  flash("Cache geleert – PDFs werden neu gelesen.");
  await scan();
}

/* ---------------------------------------------------------- Kopfbereich */

function cycleAppearance() {
  const current = (cfg && cfg.appearance) || "system";
  const next = APPEARANCES[(APPEARANCES.indexOf(current) + 1) % APPEARANCES.length];
  setAppearance(next);
}

function appearanceIcon() {
  if (cfg && cfg.appearance === "light") return "☀︎";
  if (cfg && cfg.appearance === "dark") return "☾";
  return "◐";
}

function setAppearance(mode) {
  cfg.appearance = APPEARANCES.indexOf(mode) >= 0 ? mode : "system";
  APPEARANCE = cfg.appearance;
  setIniValue(dirs, "darstellung", cfg.appearance);
  render();
}

function addTitleRow() {
  const r = newRow(64);
  const sectionTitle = SECTION === "tax" ? "Jahressteuer"
    : SECTION === "securities" ? "Wertpapiere" : SECTION === "postbox" ? "Postbox" : "Finanzreport";
  const sectionCount = SECTION === "tax"
    ? `${taxItems.length} Steuerbeleg${taxItems.length === 1 ? "" : "e"}`
    : SECTION === "securities"
      ? `${tradeItems.length} Wertpapierbeleg${tradeItems.length === 1 ? "" : "e"}`
      : SECTION === "report" ? `${bookings.length} Buchungen` : `${docFiles.length} PDF`;
  const t = r.addText(`${APP} · ${sectionTitle}`, `${sectionCount} · ${source.label}`);
  t.widthWeight = 100;
  t.titleFont = F.title;
  t.titleColor = C.text;
  t.subtitleFont = F.meta;
  t.subtitleColor = C.dim;
  table.addRow(r);
}

// Sämtliche Werkzeuge als Symbole in einer Zeile:
// Laden, neu einlesen, Hell/Dunkel/System, Anleitung, Einstellungen.
function addIconRow() {
  addChipRow([
    {
      label: "⤓",
      font: Font.systemFont(22),
      color: C.accent,
      onTap: async () => { await startDownload(); },
    },
    {
      label: "⟳",
      font: Font.systemFont(21),
      color: C.accent,
      onTap: async () => { await scan(); },
    },
    {
      label: appearanceIcon(),
      font: Font.systemFont(21),
      color: C.accent,
      onTap: () => { cycleAppearance(); },
    },
    {
      label: "ⓘ",
      font: Font.systemFont(21),
      color: C.accent,
      onTap: () => { HELP_OPEN = ""; VIEW = { name: "help" }; render(); },
    },
    {
      label: "⚙",
      font: Font.systemFont(21),
      color: C.accent,
      onTap: () => { showSettings(); },
    },
  ], 50, C.head);
}

function addPeriodRow() {
  const list = periodRows();
  let inc = 0, exp = 0;
  for (const b of list) { if (b.amount >= 0) inc += b.amount; else exp += b.amount; }
  const saldo = r2(inc + exp);

  const r = newRow(62);
  const left = r.addText(periodLabel(),
    `${list.length} ${list.length === 1 ? "Buchung" : "Buchungen"}`);
  left.widthWeight = 44;
  left.titleFont = F.rowStrong;
  left.titleColor = C.text;
  left.subtitleFont = F.meta;
  left.subtitleColor = C.dim;

  const right = r.addText(eur(saldo, true), `E ${eur(inc, true)}   A ${eur(exp)}`);
  right.widthWeight = 56;
  right.rightAligned();
  right.titleFont = F.big;
  right.titleColor = saldo < 0 ? C.minus : C.plus;
  right.subtitleFont = F.meta;
  right.subtitleColor = C.dim;
  table.addRow(r);
}

function setPeriod(year, month) {
  YEAR = year;
  MONTH = month;
  CATEGORY_LEGEND_EXPANDED = false;
  rememberPeriod();
  render();
}

async function chooseYear() {
  const years = availableYears();
  const value = await pickOption("Jahr auswählen", years.map((y) => ({ label: String(y), value: y })), YEAR);
  if (value === null) return;
  setPeriod(value, MONTH);
}

async function chooseMonth() {
  const options = [{ label: "Gesamtes Jahr", value: 0 }]
    .concat(MONTHS_LONG.map((name, i) => ({ label: name, value: i + 1 })));
  const value = await pickOption(String(YEAR), options, MONTH);
  if (value === null) return;
  setPeriod(YEAR, value);
}

function stepMonth(delta) {
  let y = YEAR;
  let m = MONTH || (delta > 0 ? 12 : 1);
  m += delta;
  if (m < 1) { y--; m = 12; }
  if (m > 12) { y++; m = 1; }
  const years = availableYears();
  if (years.indexOf(y) < 0) return;
  setPeriod(y, m);
}

// Kompakte Periodensteuerung: Pfeile wechseln monatsweise, die beiden
// mittleren Schaltflächen öffnen Jahr- bzw. Monatsauswahl.
function addPeriodNavigation() {
  const r = newRow(44);
  r.backgroundColor = C.head;
  const prev = r.addButton("‹");
  prev.widthWeight = 14;
  prev.centerAligned();
  prev.titleFont = Font.boldSystemFont(24);
  prev.titleColor = C.accent;
  prev.onTap = () => stepMonth(-1);

  const year = r.addButton("▦  " + YEAR);
  year.widthWeight = 34;
  year.centerAligned();
  year.titleFont = F.rowStrong;
  year.titleColor = C.text;
  year.onTap = async () => { await chooseYear(); };

  const month = r.addButton("◫  " + (MONTH ? MONTHS_LONG[MONTH - 1] : "Jahr"));
  month.widthWeight = 38;
  month.centerAligned();
  month.titleFont = F.rowStrong;
  month.titleColor = C.text;
  month.onTap = async () => { await chooseMonth(); };

  const next = r.addButton("›");
  next.widthWeight = 14;
  next.centerAligned();
  next.titleFont = Font.boldSystemFont(24);
  next.titleColor = C.accent;
  next.onTap = () => stepMonth(1);
  table.addRow(r);
}

function setSection(id) {
  if (MAIN_SECTIONS.some((s) => s.id === id)) SECTION = id;
  cfg.section = SECTION;
  setIniValue(dirs, "bereich", SECTION);
  render();
}

// Oberste Gliederung der eigenständigen App-Bereiche.
function addSectionTabs() {
  const r = newRow(48);
  r.backgroundColor = C.head;
  const compact = screenWidth() < 520;
  for (const section of MAIN_SECTIONS) {
    const b = r.addButton(compact && section.compact ? section.compact : section.label);
    b.widthWeight = 25;
    b.centerAligned();
    b.titleFont = SECTION === section.id ? Font.boldSystemFont(compact ? 13 : 14) : Font.systemFont(compact ? 13 : 14);
    b.titleColor = SECTION === section.id ? C.accent : C.dim;
    b.onTap = () => { setSection(section.id); };
  }
  table.addRow(r);
}

function addReportTabs() {
  const r = newRow(42);
  r.backgroundColor = C.head;
  const weight = Math.round(100 / REPORT_TABS.length);
  for (const t of REPORT_TABS) {
    const b = r.addButton(t.label);
    b.widthWeight = weight;
    b.centerAligned();
    b.titleFont = TAB === t.id ? Font.boldSystemFont(13) : Font.systemFont(13);
    b.titleColor = TAB === t.id ? C.accent : C.dim;
    b.onTap = () => {
      TAB = t.id;
      rememberPeriod();
      render();
    };
  }
  table.addRow(r);
}

function addPostboxSummaryRow() {
  const r = newRow(62);
  const left = r.addText("Postbox", `${docFiles.length} PDF · ${source.label}`);
  left.widthWeight = 64;
  left.titleFont = F.rowStrong;
  left.titleColor = C.text;
  left.subtitleFont = F.meta;
  left.subtitleColor = C.dim;
  const right = r.addText("⤓ Laden", "Dokumente abrufen");
  right.widthWeight = 36;
  right.rightAligned();
  right.titleFont = F.rowStrong;
  right.titleColor = C.accent;
  right.subtitleFont = F.meta;
  right.subtitleColor = C.dim;
  r.onSelect = async () => { await startDownload(); };
  table.addRow(r);
}

function addPostboxActions() {
  addChipRow([
    { label: "⤓ Postbox laden", on: true, onTap: async () => { await startDownload(); } },
    { label: "⟳ Bestand aktualisieren", onTap: async () => { await scan(); } },
  ], 44, C.head);
}

function addBusy() {
  const pct = Math.max(0, Math.min(1, busy.pct || 0));
  const filled = Math.round(pct * 22);
  const bar = "▮".repeat(filled) + "▯".repeat(22 - filled);
  const r = newRow(60);
  const c = r.addText(busy.big, busy.sub || "");
  c.widthWeight = 70;
  c.titleFont = F.rowStrong;
  c.titleColor = C.text;
  c.subtitleFont = F.meta;
  c.subtitleColor = C.dim;
  const p = r.addText(Math.round(pct * 100) + " %");
  p.widthWeight = 30;
  p.rightAligned();
  p.titleFont = F.rowStrong;
  p.titleColor = C.accent;
  table.addRow(r);
  const b = newRow(30);
  const bc = b.addText(bar);
  bc.titleColor = C.accent;
  bc.titleFont = Font.systemFont(13);
  table.addRow(b);
}

/* --------------------------------------------------------- Hauptansichten */

function buildGroups() {
  const all = groupSums(periodRows());
  if (!all.length) {
    addStamp(emptyInfo ? emptyInfo.title : "Keine Buchungen", C.text);
    addInfo(emptyInfo ? emptyInfo.text : `Für ${periodLabel()} liegen keine Buchungen vor.`);
    addButtonRow("Einstellungen öffnen", () => { showSettings("report"); });
    addButtonRow("Anleitung öffnen", () => { VIEW = { name: "help" }; render(); });
    return;
  }

  const exp = all.filter((g) => g.sum < 0);
  exp.forEach((g, i) => { g.color = shade(i, exp.length); });
  const expTotal = exp.reduce((a, g) => a + Math.abs(g.sum), 0);
  const income = all.filter((g) => g.sum > 0);
  income.forEach((g, i) => { g.color = incomeShade(i, income.length); });

  const donut = donutImage(exp, income, CATEGORY_LEGEND_EXPANDED);
  if (donut) {
    const canExpand = exp.length > 6;
    const canvasH = donutCanvasHeight(exp.length, CATEGORY_LEGEND_EXPANDED);
    addImageRow(donut, Math.ceil(canvasH / 2) + 5, canExpand ? () => {
      CATEGORY_LEGEND_EXPANDED = !CATEGORY_LEGEND_EXPANDED;
      render();
    } : null);
  }

  addStamp(`Kategorien · ${periodLabel()}`);
  for (const g of all) {
    const pct = g.sum < 0 && expTotal ? ` · ${Math.round((Math.abs(g.sum) / expTotal) * 100)} %` : "";
    addValueRow({
      key: g.color || C.plus,
      title: g.name,
      subtitle: `${g.n} ${g.n === 1 ? "Buchung" : "Buchungen"}${pct}`,
      value: eur(g.sum),
      valueColor: g.sum >= 0 ? C.plus : C.minus,
      onSelect: () => { VIEW = { name: "group", group: g.name }; render(); },
    });
  }
}

function buildBookings() {
  const list = periodRows().slice().sort((a, b) => (a.iso < b.iso ? 1 : -1));
  if (!list.length) {
    addStamp(`Für ${periodLabel()} liegen keine Buchungen vor.`);
    return;
  }
  let month = null;
  for (const b of list) {
    if (b.month !== month) {
      month = b.month;
      addStamp(`${MONTHS_LONG[month - 1]} ${b.year}`);
    }
    addBookingRow(b);
  }
}

function addBookingRow(b) {
  addValueRow({
    title: b.name.slice(0, 90),
    subtitle: `${b.date} · ${b.group}`,
    value: eur(b.amount),
    valueColor: b.amount >= 0 ? C.plus : C.minus,
    onSelect: async () => { await showBooking(b); },
  });
}

function buildMonths() {
  const s = yearStatistics(YEAR);
  const t = s.t;
  const rate = s.totalIn ? Math.round((s.net / s.totalIn) * 100) : 0;
  const txCount = bookings.filter((b) => b.year === YEAR).length;
  const txPerMonth = s.active.length ? Math.round(txCount / s.active.length) : 0;

  const kpi = (r, cap, value, hint, color) => {
    const c = r.addText(value, cap + " · " + hint);
    c.widthWeight = 50;
    c.titleFont = F.rowStrong;
    c.titleColor = color || C.text;
    c.subtitleFont = F.meta;
    c.subtitleColor = C.dim;
  };

  addStamp("Jahreskennzahlen");

  const k1 = newRow(54);
  kpi(k1, "Jahressaldo", eur(s.net, true), `Sparquote ${rate} %`, s.net >= 0 ? C.plus : C.minus);
  kpi(k1, "Ø Monatssaldo", eur(s.avgNet, true), `${s.active.length} aktive Monate`, s.avgNet >= 0 ? C.plus : C.minus);
  applyTableStripe(k1);
  table.addRow(k1);

  const k2 = newRow(54);
  kpi(k2, "Einnahmen", eur(s.totalIn, true), `Ø ${eur(s.avgIn, true)}`, C.plus);
  kpi(k2, "Ausgaben", eur(-s.totalOut), `Ø ${eur(-s.avgOut)}`, C.minus);
  applyTableStripe(k2);
  table.addRow(k2);

  const k3 = newRow(54);
  kpi(k3, "Positive Monate", String(s.positiveMonths), `${s.negativeMonths} negativ`, C.plus);
  kpi(k3, "Buchungen / Monat", String(txPerMonth), `${txCount} im Jahr`, C.text);
  applyTableStripe(k3);
  table.addRow(k3);

  addStamp("Geldfluss · Einnahmen / Ausgaben / kumulierter Saldo");
  addImageRow(monthChartImage(YEAR), 220);

  addStamp("Monatlicher Netto-Saldo");
  addImageRow(netTrendImage(YEAR), 170);

  if (s.expenseCategories.length) {
    addStamp("Größte Ausgabenkategorien");
    const catBars = categoryBarsImage(YEAR);
    if (catBars) {
      const shown = Math.min(7, s.expenseCategories.length);
      addImageRow(catBars, Math.ceil((20 + shown * 58) / 2) + 6);
    }

    if (s.expenseCategories.length > 1) {
      addStamp("Kategorien im Jahresverlauf");
      const catTrend = categoryTrendImage(YEAR);
      if (catTrend) addImageRow(catTrend, 190);
    }
  }

  addStamp("Statistische Auswertung");

  addValueRow({
    title: "Bester Monat",
    subtitle: s.bestMonth < 0 ? "Keine Daten" : `${MONTHS_LONG[s.bestMonth]} ${YEAR}`,
    value: s.bestMonth < 0 ? "–" : eur(s.bestValue, true),
    valueColor: s.bestValue >= 0 ? C.plus : C.minus,
    onSelect: s.bestMonth < 0 ? null : () => {
      MONTH = s.bestMonth + 1; rememberPeriod(); render();
    },
  });

  addValueRow({
    title: "Schwächster Monat",
    subtitle: s.worstMonth < 0 ? "Keine Daten" : `${MONTHS_LONG[s.worstMonth]} ${YEAR}`,
    value: s.worstMonth < 0 ? "–" : eur(s.worstValue, true),
    valueColor: s.worstValue >= 0 ? C.plus : C.minus,
    onSelect: s.worstMonth < 0 ? null : () => {
      MONTH = s.worstMonth + 1; rememberPeriod(); render();
    },
  });

  addValueRow({
    height: 60,
    title: "Median Monatssaldo",
    subtitle: "Robuster Mittelwert der Monatsentwicklung",
    value: eur(s.medianNet, true),
    valueColor: s.medianNet >= 0 ? C.plus : C.minus,
  });

  addValueRow({
    height: 66,
    title: "Schwankung Monatssaldo",
    subtitle: "Standardabweichung · kleinere Werte = gleichmäßiger",
    value: eur(s.volatility, true),
  });

  if (s.biggestExpense) {
    addValueRow({
      height: 72,
      title: "Größte Einzelausgabe",
      subtitle: `${s.biggestExpense.date} · ${s.biggestExpense.group}\n${s.biggestExpense.name.slice(0, 30)}`,
      value: eur(s.biggestExpense.amount),
      valueColor: C.minus,
      onSelect: async () => { await showBooking(s.biggestExpense); },
    });
  }

  if (s.biggestIncome) {
    addValueRow({
      height: 72,
      title: "Größte Einzeleinnahme",
      subtitle: `${s.biggestIncome.date} · ${s.biggestIncome.group}\n${s.biggestIncome.name.slice(0, 30)}`,
      value: eur(s.biggestIncome.amount, true),
      valueColor: C.plus,
      onSelect: async () => { await showBooking(s.biggestIncome); },
    });
  }

  if (s.expenseCategories.length) {
    const top = s.expenseCategories[0];
    const share = s.totalOut ? Math.round(top.amount / s.totalOut * 100) : 0;
    addValueRow({
      height: 64,
      title: "Größte Ausgabenkategorie",
      subtitle: `${top.count} Buchungen · ${share} % aller Ausgaben`,
      value: top.name,
      valueSub: eur(-top.amount),
      valueColor: C.minus,
    });
  }

  addStamp("Monatsübersicht");
  for (let m = 0; m < 12; m++) {
    if (!t.inc[m] && !t.exp[m]) continue;
    const net = r2(t.inc[m] - t.exp[m]);
    const prevActive = m > 0 && (t.inc[m - 1] || t.exp[m - 1]);
    const diff = prevActive ? r2(net - r2(t.inc[m - 1] - t.exp[m - 1])) : null;
    const savings = t.inc[m] ? Math.round((net / t.inc[m]) * 100) : 0;
    const compare = diff === null
      ? `Sparquote ${savings} %`
      : `${diff >= 0 ? "▲" : "▼"} ${eur(Math.abs(diff))} · SQ ${savings} %`;

    addValueRow({
      height: 60,
      title: MONTHS_LONG[m],
      subtitle: `E ${eur(t.inc[m], true)} · A ${eur(-t.exp[m])}`,
      titleColor: MONTH === m + 1 ? C.accent : C.text,
      value: eur(net, true),
      valueSub: compare,
      valueColor: net >= 0 ? C.plus : C.minus,
      onSelect: () => {
        MONTH = MONTH === m + 1 ? 0 : m + 1;
        rememberPeriod();
        render();
      },
    });
  }
}

/* ---------------------------------------------- Dokumente (PDF-Bibliothek) */

/**
 * Trifft nur zu, wenn der Begriff am Wortanfang steht: "Gutschrift" passt
 * dadurch nicht auf "Dividendengutschrift" oder "Ertragsgutschrift".
 */
function hasDocumentType(name, type) {
  const n = String(name).toLocaleLowerCase("de");
  const t = String(type).toLocaleLowerCase("de");
  if (!t) return false;
  for (let i = n.indexOf(t); i >= 0; i = n.indexOf(t, i + 1)) {
    if (i === 0 || !/[a-zäöüß]/.test(n.charAt(i - 1))) return true;
  }
  return false;
}

function matchesDocumentType(name, type) {
  if (!type) return true;
  if (type === "__other__") return !DOCUMENT_TYPES.some((t) => hasDocumentType(name, t));
  return hasDocumentType(name, type);
}

/** Liest den PDF-Bestand des gemeinsamen Ordners ein. */
function scanPdfLibrary() {
  docFiles = [];
  docWarning = "";
  if (!source) return;
  if (source.unavailable) {
    docWarning = `${source.label} – Ordner in den Einstellungen neu auswählen.`;
    return;
  }
  const owner = managerForPath(source.path);
  for (const relative of listPdfs(source.path)) {
    const path = owner.joinPath(source.path, relative);
    const name = relative.split("/").pop().replace(/\.pdf$/i, "");
    const parts = relative.split("/");
    let year = parts.slice(0, -1).reverse().find((x) => /^\d{4}$/.test(x)) || "";
    if (!year) {
      const m = name.match(/(20\d{2}|19\d{2})/);
      year = m ? m[1] : "Ohne Jahr";
    }
    let modified = "";
    try { modified = owner.modificationDate(path).toISOString().slice(0, 10); } catch (_) { modified = ""; }
    docFiles.push({ name, relative, path, year, modified });
  }
  docFiles.sort((a, b) =>
    b.year.localeCompare(a.year) || b.modified.localeCompare(a.modified) || a.name.localeCompare(b.name));
}

function visibleDocuments() {
  const q = DOC_QUERY.toLocaleLowerCase("de");
  return docFiles.filter((file) =>
    (!DOC_YEAR || file.year === DOC_YEAR)
    && matchesDocumentType(file.name, DOC_TYPE)
    && (!q || file.name.toLocaleLowerCase("de").includes(q)));
}

/** Wird die Datei ausgewertet? Nur PDFs mit dem konfigurierten Muster. */
function isReportFile(relative) {
  const pattern = String(cfg && cfg.reportPattern || "").trim().toLocaleLowerCase("de");
  if (!pattern) return true;
  return String(relative).toLocaleLowerCase("de").includes(pattern);
}

async function openDocument(path) {
  try {
    const owner = managerForPath(path);
    if (!owner.fileExists(path)) throw new Error("Die ausgewählte PDF wurde nicht gefunden.");
    await ensureDownloaded(path);
    await QuickLook.present(path, true);
  } catch (error) {
    await showError(error);
  }
}

function buildDocuments() {
  const years = [...new Set(docFiles.map((f) => f.year))];
  const status = new Map();
  for (const info of fileInfos) status.set(info.file, info);
  const taxByFile = new Map();
  for (const it of taxItems) taxByFile.set(it.file, it);
  const tradeByFile = new Map();
  for (const it of tradeItems) tradeByFile.set(it.file, it);

  addChipRow([
    {
      label: DOC_QUERY ? `Suche: ${DOC_QUERY}` : "Suche",
      on: !!DOC_QUERY,
      onTap: async () => {
        const value = await promptText("Suche", "Teil des Dateinamens", DOC_QUERY, {
          clearable: true,
          placeholder: "Suchbegriff",
        });
        if (value === null) return;
        DOC_QUERY = value;
        render();
      },
    },
    {
      label: DOC_YEAR ? `Jahr: ${DOC_YEAR}` : "Jahr",
      on: !!DOC_YEAR,
      onTap: async () => {
        const value = await pickOption(
          "Jahr",
          [{ label: "Alle Jahre", value: "" }].concat(years.map((y) => ({ label: y, value: y }))),
          DOC_YEAR
        );
        if (value === null) return;
        DOC_YEAR = value;
        render();
      },
    },
    {
      label: DOC_TYPE ? `Art: ${DOC_TYPE === "__other__" ? "Sonstige" : DOC_TYPE.slice(0, 12)}` : "Dokumentart",
      on: !!DOC_TYPE,
      onTap: async () => {
        const options = [{ label: "Alle Dokumentarten", value: "" }]
          .concat(DOCUMENT_TYPES.map((t) => ({ label: t, value: t })))
          .concat([{ label: "Sonstige", value: "__other__" }]);
        const value = await pickOption("Dokumentart", options, DOC_TYPE);
        if (value === null) return;
        DOC_TYPE = value;
        render();
      },
    },
  ], 44);

  if (docWarning) addInfo(docWarning, C.warn);

  const found = visibleDocuments();
  const active = [
    DOC_QUERY ? `„${DOC_QUERY}“` : "",
    DOC_YEAR,
    DOC_TYPE === "__other__" ? "Sonstige" : DOC_TYPE,
  ].filter(Boolean);
  addStamp(`${found.length} von ${docFiles.length} PDF${active.length ? " · " + active.join(" · ") : ""} · ${source.label}`);

  if (!found.length) {
    addInfo(docFiles.length
      ? "Keine PDFs passen zu den gewählten Filtern."
      : "Noch keine PDFs vorhanden. Oben auf ⤓ tippen, um die Postbox zu laden.");
    addButtonRow("Postbox laden", async () => { await startDownload(); });
    return;
  }

  addInfo("Prüfsumme je Finanzreport, Auswertungsstand bei Steuer- und Wertpapierbelegen. Ein Tipp auf die "
    + "Zeile öffnet die PDF beziehungsweise zuerst die erkannten Werte.");

  const limit = 300;
  found.slice(0, limit).forEach((file) => {
    const info = status.get(file.relative);
    const taxItem = taxByFile.get(file.relative);
    const tradeItem = tradeByFile.get(file.relative);
    const analysed = isReportFile(file.relative);
    let mark = "›";
    let markColor = C.faint;
    let note = "";
    if (tradeItem) {
      mark = tradeItem.warning ? "!" : "✓";
      markColor = tradeItem.warning ? C.warn : C.plus;
      note = `${tradeItem.tradeType || "Wertpapier"} · ${tradeItem.securityName || tradeItem.wkn || "Abrechnung"}`
        + (tradeItem.warning ? " · prüfen" : " · ausgewertet");
    } else if (taxItem) {
      mark = taxItem.warning ? "!" : "✓";
      markColor = taxItem.warning ? C.warn : C.plus;
      note = `Steuerbescheinigung ${taxItem.year || "?"} · ${taxItem.warning ? taxItem.warning : "ausgewertet"}`;
    } else if (isTaxFile(file.relative)) {
      note = "Steuerbescheinigung · noch nicht gelesen";
    } else if (!analysed) {
      note = "nicht ausgewertet";
    } else if (info && info.error) {
      mark = "!";
      markColor = C.minus;
      note = "Fehler: " + String(info.error).slice(0, 40);
    } else if (info && (info.delta === null || info.delta === undefined)) {
      mark = "!";
      markColor = C.warn;
      note = "kein Neuer Saldo gefunden";
    } else if (info) {
      const ok = Math.abs(info.delta) < 0.005;
      mark = ok ? "✓" : "!";
      markColor = ok ? C.plus : C.minus;
      note = ok ? "geprüft" : "Abweichung " + eur(info.delta);
    } else {
      note = "noch nicht gelesen";
    }
    const meta = [file.year, file.modified, note].filter(Boolean).join(" · ");
    addValueRow({
      title: file.name,
      subtitle: meta,
      value: mark,
      valueColor: markColor,
      valueFont: F.big,
      onSelect: tradeItem
        ? async () => { await showTradeDocument(tradeItem); }
        : (taxItem ? async () => { await showTaxDocument(taxItem); } : () => openDocument(file.path)),
    });
  });
  if (found.length > limit) {
    addInfo(`Weitere ${found.length - limit} PDFs ausgeblendet – bitte Filter enger setzen.`);
  }
}

/* ------------------------------------------------- Detail einer Gruppe */

function buildGroupDetail(name) {
  const list = periodRows().filter((b) => b.group === name)
    .sort((a, b) => (a.iso < b.iso ? 1 : -1));
  const sum = r2(list.reduce((a, b) => a + b.amount, 0));
  addBackRow(name, `${list.length} ${list.length === 1 ? "Buchung" : "Buchungen"} · ${periodLabel()}`);

  const r = newRow(56);
  const t = r.addText("Summe", periodLabel());
  t.widthWeight = 50;
  t.titleFont = F.rowStrong;
  t.titleColor = C.text;
  t.subtitleFont = F.meta;
  t.subtitleColor = C.dim;
  const v = r.addText(eur(sum, true));
  v.widthWeight = 50;
  v.rightAligned();
  v.titleFont = F.big;
  v.titleColor = sum >= 0 ? C.plus : C.minus;
  table.addRow(r);

  const per = new Array(12).fill(0);
  yearRows().forEach((b) => { if (b.group === name) per[b.month - 1] += b.amount; });
  addStamp(`Monatsverlauf ${YEAR}`);
  addImageRow(sparkImage(per), 120);

  if (!list.length) {
    addInfo("In diesem Zeitraum keine Buchungen dieser Gruppe.");
    return;
  }
  addStamp("Buchungen");
  for (const b of list) addBookingRow(b);
  addSpacer(24);
}

/* ------------------------------------------------------ Buchungsdetail */

async function showBooking(b) {
  const a = new Alert();
  a.title = eur(b.amount, true);
  a.message = `${b.date} · ${b.group}\n\nVorgang: ${b.typ || "–"}\n\n${b.name}\n\nDatei: ${b.file}`;
  a.addAction("Schlüsselwort anlegen …");
  a.addAction("PDF öffnen");
  a.addCancelAction("Schließen");
  const idx = await a.presentSheet();
  if (idx === 0) {
    VIEW = { name: "assign", booking: b };
    render();
  } else if (idx === 1) {
    const owner = managerForPath(source.path);
    await openDocument(owner.joinPath(source.path, b.file));
  }
}

// Ordnet eine Buchung dauerhaft zu, indem ein Schlüsselwort ergänzt wird.
function buildAssign(b) {
  addBackRow("Schlüsselwort anlegen", b.name.slice(0, 60));
  addInfo("Wähle die Gruppe, in der das Schlüsselwort ergänzt werden soll. "
    + "Anschließend wird der Vorschlag zum Bearbeiten angeboten.");
  const suggestion = (b.name.match(/[a-zäöüß0-9.&+-]{4,}/i) || [""])[0].toLowerCase();
  const groups = iniGroups(dirs);
  for (const g of groups) {
    addValueRow({
      title: g.name,
      subtitle: g.words.slice(0, 6).join(", "),
      value: "＋",
      valueColor: C.accent,
      height: 50,
      onSelect: async () => {
        const word = await promptText(
          "Schlüsselwort für " + g.name,
          "Kleinschreibung, Teiltreffer genügen.",
          suggestion,
          { placeholder: "z. B. rewe" }
        );
        if (word === null) return;
        const value = word.trim().toLowerCase();
        if (!value) return;
        const list = iniGroups(dirs);
        const target = list.find((x) => x.name === g.name);
        if (!target) return;
        if (target.words.indexOf(value) < 0) target.words.push(value);
        writeIniGroups(dirs, list);
        cfg = readIni(readConfig(dirs));
        VIEW = { name: "main" };
        await reassign(`„${value}“ ergänzt in ${g.name}.`);
      },
    });
  }
  addSpacer(24);
}

/* --------------------------------------------------------- Einstellungen */

function toggleSettingRow(title, subtitle, cfgKey, iniKey) {
  return addValueRow({
    title,
    subtitle,
    value: cfg[cfgKey] ? "Ein" : "Aus",
    valueColor: cfg[cfgKey] ? C.accent : C.faint,
    onSelect: () => {
      cfg[cfgKey] = !cfg[cfgKey];
      setIniValue(dirs, iniKey, cfg[cfgKey] ? "ein" : "aus");
      render();
    },
  });
}

async function editDate(cfgKey, iniKey, title) {
  const value = await promptText(title, "Format JJJJ-MM-TT, leer lassen für offen", cfg[cfgKey], {
    clearable: true,
    placeholder: "2024-01-01",
  });
  if (value === null) return;
  try {
    const checked = validateDateInput(value);
    const start = cfgKey === "startDate" ? checked : cfg.startDate;
    const end = cfgKey === "endDate" ? checked : cfg.endDate;
    if (start && end && start > end) {
      throw new Error("Das Startdatum darf nicht nach dem Enddatum liegen.");
    }
    cfg[cfgKey] = checked;
    setIniValue(dirs, iniKey, checked);
    render();
  } catch (error) {
    await alert("Ungültige Eingabe", String(error.message || error));
  }
}

async function editCredentials() {
  const a = new Alert();
  a.title = "Comdirect-Zugang";
  a.message = "Leere Felder behalten den gespeicherten Wert. PIN und Client-Secret werden ausschließlich im iOS-Keychain abgelegt.";
  a.addTextField("Zugangsnummer", "");
  a.addSecureTextField("PIN/Passwort", "");
  a.addTextField("Client-ID", "");
  a.addSecureTextField("Client-Secret", "");
  a.addAction("Speichern");
  a.addCancelAction("Abbrechen");
  if (await a.present() !== 0) return;

  const entered = {
    user: a.textFieldValue(0).trim(),
    pin: a.textFieldValue(1),
    clientId: a.textFieldValue(2).trim(),
    clientSecret: a.textFieldValue(3),
  };
  if (!Object.values(entered).some((v) => String(v || "").length > 0)) return;

  const existing = getCredentials(true) || { user: "", pin: "", clientId: "", clientSecret: "" };
  const merged = {
    user: entered.user || existing.user,
    pin: entered.pin || existing.pin,
    clientId: entered.clientId || existing.clientId,
    clientSecret: entered.clientSecret || existing.clientSecret,
  };
  if (!Object.values(merged).every(Boolean)) {
    await alert("Unvollständig", "Für die erstmalige Einrichtung werden alle vier Zugangswerte benötigt.");
    return;
  }
  ["user", "pin", "clientId", "clientSecret"].forEach((key) => Keychain.set(SECRET_KEYS[key], merged[key]));
  await alert("Gespeichert", "Die Zugangsdaten liegen im iOS-Keychain.");
  render();
}

async function deleteCredentials() {
  const confirmed = await choose(
    "Zugangsdaten löschen?",
    "Zugangsnummer, PIN, Client-ID und Client-Secret werden aus dem iOS-Keychain entfernt.",
    ["Löschen"]
  );
  if (confirmed !== 0) return;
  Object.values(SECRET_KEYS).forEach((key) => { if (Keychain.contains(key)) Keychain.remove(key); });
  Object.values(LEGACY_SECRET_KEYS).forEach((key) => { if (Keychain.contains(key)) Keychain.remove(key); });
  await alert("Gelöscht", "Die Zugangsdaten wurden entfernt.");
  render();
}

function addSettingsSection(id, title, summary) {
  const open = SETTINGS_OPEN === id;
  const r = newRow(summary ? 56 : 48);
  r.backgroundColor = C.head;
  const t = r.addText(title, summary || "");
  t.widthWeight = 90;
  t.titleFont = F.rowStrong;
  t.titleColor = C.text;
  t.subtitleFont = F.meta;
  t.subtitleColor = C.dim;
  const arrow = r.addText(open ? "⌄" : "›");
  arrow.widthWeight = 10;
  arrow.rightAligned();
  arrow.titleFont = F.big;
  arrow.titleColor = C.accent;
  r.onSelect = () => {
    SETTINGS_OPEN = open ? "" : id;
    render();
  };
  table.addRow(r);
  STRIPE_INDEX = 0;
  return open;
}

function showSettings(openSection) {
  SETTINGS_OPEN = openSection || "";
  VIEW = { name: "settings" };
  render();
}

function buildSettings() {
  addBackRow("Einstellungen", "com_fm.ini");

  /* --- Gemeinsamer PDF-Ordner ------------------------------------------- */
  if (addSettingsSection("storage", "PDF-Ablage", "Lokal oder Scriptable-Dateibookmark")) {
  addInfo(`${source.label} · ${docFiles.length} PDF · wird beim Start automatisch eingelesen`, C.dim);
  addChipRow([
    {
      label: "Lokal bei com_fm.ini",
      on: !cfg.path,
      onTap: async () => { await pickSource("local"); },
    },
    {
      label: "Datei-Bookmark …",
      on: String(cfg.path || "").startsWith("bookmark:"),
      onTap: async () => { await pickSource("bookmark"); },
    },
  ], 44);
  addValueRow({
    title: "PDFs importieren",
    subtitle: "Kopiert ausgewählte Dateien in die aktuell gewählte PDF-Ablage",
    value: "Import …",
    valueColor: C.accent,
    onSelect: async () => { await pickSource("import"); },
  });
  }

  /* --- Zugang ------------------------------------------------------------ */
  if (addSettingsSection("access", "Comdirect-Zugang", "Zugangsdaten und API-Schlüssel")) {
  const credentials = getCredentials();
  addInfo(credentials ? "Zugangsdaten sind gespeichert." : "Noch nicht eingerichtet.",
    credentials ? C.plus : C.minus);
  addButtonRow("Zugangsdaten eingeben", async () => { await editCredentials(); });
  addButtonRow("Zugangsdaten löschen", async () => { await deleteCredentials(); }, true);
  }

  /* --- Download ---------------------------------------------------------- */
  if (addSettingsSection("download", "Postbox-Download", "Zeitraum, Dokumentfilter und API")) {
  addValueRow({
    title: "Startdatum",
    value: cfg.startDate || "offen",
    valueColor: cfg.startDate ? C.text : C.faint,
    onSelect: () => editDate("startDate", "startdatum", "Startdatum"),
  });
  addValueRow({
    title: "Enddatum",
    value: cfg.endDate || "offen",
    valueColor: cfg.endDate ? C.text : C.faint,
    onSelect: () => editDate("endDate", "enddatum", "Enddatum"),
  });
  addValueRow({
    title: "Archivstatus",
    value: ARCHIVE_LABELS[cfg.archiveFilter] || "Alle",
    onSelect: async () => {
      const value = await pickOption("Archivstatus", [
        { label: ARCHIVE_LABELS.all, value: "all" },
        { label: ARCHIVE_LABELS.archivedOnly, value: "archivedOnly" },
        { label: ARCHIVE_LABELS.notArchivedOnly, value: "notArchivedOnly" },
      ], cfg.archiveFilter);
      if (value === null) return;
      cfg.archiveFilter = value;
      setIniValue(dirs, "archiv", value);
      render();
    },
  });
  addValueRow({
    title: "Dateinamenfilter",
    subtitle: "Nur Dokumente laden, deren Name mit einem Präfix beginnt",
    value: cfg.filenameFilterEnabled ? "Ein" : "Aus",
    valueColor: cfg.filenameFilterEnabled ? C.accent : C.faint,
    height: 58,
    onSelect: async () => {
      if (!cfg.filenameFilterEnabled && !cfg.filenamePrefixes.length) {
        await alert("Kein Präfix hinterlegt", "Bitte zuerst mindestens ein Dateinamen-Präfix eintragen.");
        return;
      }
      cfg.filenameFilterEnabled = !cfg.filenameFilterEnabled;
      setIniValue(dirs, "dateifilter", cfg.filenameFilterEnabled ? "ein" : "aus");
      render();
    },
  });
  addValueRow({
    title: "Dateinamen-Präfixe",
    subtitle: cfg.filenamePrefixes.join(", ") || "keine",
    value: String(cfg.filenamePrefixes.length),
    height: 62,
    onSelect: async () => {
      const value = await promptText("Dateinamen-Präfixe", "Mit Komma getrennt.", cfg.filenamePrefixes.join(", "), {
        placeholder: "Finanzreport, Gutschrift",
      });
      if (value === null) return;
      const list = value.split(",").map((x) => x.trim()).filter(Boolean);
      if (!list.length && cfg.filenameFilterEnabled) {
        await alert("Leere Liste", "Der Dateinamenfilter ist aktiv, deshalb wird mindestens ein Präfix benötigt.");
        return;
      }
      cfg.filenamePrefixes = list;
      setIniValue(dirs, "praefixe", list.join(","));
      render();
    },
  });
  toggleSettingRow("Werbedokumente", "Werbung mitladen", "includeAdvertisements", "werbung");

  addStamp("Download · Dateien und API");
  toggleSettingRow("Unterordner pro Jahr", "Jahr/pdf statt nur Jahr", "useSubfolders", "unterordner");
  toggleSettingRow("Vorhandene überspringen", "Bereits geladene PDFs nicht erneut holen", "skipExisting", "ueberspringen");
  addValueRow({
    title: "Dokumente pro Seite",
    subtitle: "Seitengröße der API-Abfrage",
    value: String(cfg.pageSize),
    onSelect: async () => {
      const value = await promptText("Dokumente pro API-Seite", "Zwischen 1 und 1000.", cfg.pageSize, {
        placeholder: String(DEFAULTS.pageSize),
      });
      if (value === null) return;
      cfg.pageSize = Math.max(1, Math.min(1000, Math.round(Number(value) || DEFAULTS.pageSize)));
      setIniValue(dirs, "seitengroesse", String(cfg.pageSize));
      render();
    },
  });
  }

  /* --- Auswertung -------------------------------------------------------- */
  if (addSettingsSection("report", "Finanzreport", "Dateimuster, Texterkennung und Kategorien")) {
  addValueRow({
    title: "Auszuwertende Dateien",
    subtitle: "Nur PDFs mit diesem Text im Namen werden gelesen. Leer = alle.",
    value: cfg.reportPattern || "alle",
    height: 62,
    onSelect: async () => {
      const value = await promptText("Dateimuster", "Zum Beispiel Finanzreport. Leer lassen, um jede PDF zu lesen.",
        cfg.reportPattern, { clearable: true, placeholder: DEFAULTS.reportPattern });
      if (value === null) return;
      cfg.reportPattern = value;
      setIniValue(dirs, "muster", value);
      flash("Muster gesichert – Reports werden neu gelesen.");
      await scan();
    },
  });
  addValueRow({
    title: "Zeilenabstand",
    subtitle: "Größer, wenn Wörter zusammenkleben; kleiner bei zerrissenen Wörtern.",
    value: String(cfg.gap).replace(".", ","),
    height: 62,
    onSelect: async () => {
      const value = await promptText("Zeilenabstand",
        "Abstand in PDF-Punkten, ab dem ein Leerzeichen gesetzt wird. Standard: 1,0",
        String(cfg.gap).replace(".", ","), { placeholder: "1,0" });
      if (value === null) return;
      const g = parseFloat(String(value).replace(",", "."));
      if (isNaN(g) || g <= 0) { flash("Ungültiger Wert."); return; }
      setIniValue(dirs, "abstand", String(g));
      cfg = readIni(readConfig(dirs));
      VIEW = { name: "main" };
      flash("Abstand gesichert – Reports werden neu gelesen.");
      await scan();
    },
  });
  const groups = iniGroups(dirs);
  addValueRow({
    title: "Kategorien bearbeiten",
    subtitle: `${groups.length} Gruppen · Reihenfolge entscheidet`,
    value: "›",
    valueColor: C.accent,
    onSelect: () => { VIEW = { name: "editor" }; render(); },
  });
  }

  /* --- Jahressteuerbescheinigungen -------------------------------------- */
  if (addSettingsSection("tax", "Jahressteuer", "Dateimuster und Sparer-Pauschbetrag")) {
  addValueRow({
    title: "Zu lesende Bescheinigungen",
    subtitle: "PDFs mit diesem Text im Namen werden als Anlage KAP ausgewertet. Leer = aus.",
    value: cfg.taxPattern || "aus",
    height: 62,
    onSelect: async () => {
      const value = await promptText("Dateimuster Steuer",
        "Zum Beispiel Jahressteuer. Leer lassen, um die Steuerauswertung abzuschalten.",
        cfg.taxPattern, { clearable: true, placeholder: DEFAULTS.taxPattern });
      if (value === null) return;
      cfg.taxPattern = value;
      setIniValue(dirs, "steuermuster", value);
      flash("Muster gesichert – Bescheinigungen werden neu gelesen.");
      await scan();
    },
  });
  addValueRow({
    title: "Sparer-Pauschbetrag",
    subtitle: `Referenzwert für die Auslastung · ${taxItems.length} Bescheinigung${taxItems.length === 1 ? "" : "en"} erkannt`,
    value: taxEuro(Number(cfg.allowanceLimit) || DEFAULTS.allowanceLimit),
    height: 62,
    onSelect: async () => {
      const value = await promptText("Sparer-Pauschbetrag",
        "Referenzwert in Euro. Seit 2023 gelten 1.000 € je Person.",
        String(Number(cfg.allowanceLimit) || DEFAULTS.allowanceLimit), { placeholder: "1000" });
      if (value === null) return;
      const v = Number(String(value).replace(/\./g, "").replace(",", "."));
      if (!Number.isFinite(v) || v <= 0) { flash("Ungültiger Wert."); return; }
      cfg.allowanceLimit = v;
      setIniValue(dirs, "pauschbetrag", String(v));
      render();
    },
  });
  }

  /* --- Wertpapierabrechnungen ------------------------------------------- */
  if (addSettingsSection("securities", "Wertpapiere", "Abrechnungen, Positionen und Verlauf")) {
  addValueRow({
    title: "Zu lesende Abrechnungen",
    subtitle: "PDFs mit diesem Text im Namen werden als Wertpapiergeschäft ausgewertet.",
    value: cfg.tradePattern || "aus",
    height: 62,
    onSelect: async () => {
      const value = await promptText("Dateimuster Wertpapiere",
        "Zum Beispiel Wertpapierabrechnung. Leer lassen, um die Auswertung abzuschalten.",
        cfg.tradePattern, { clearable: true, placeholder: DEFAULTS.tradePattern });
      if (value === null) return;
      cfg.tradePattern = value;
      setIniValue(dirs, "wertpapiermuster", value);
      flash("Muster gesichert – Wertpapierabrechnungen werden neu gelesen.");
      await scan();
    },
  });
  addInfo(`${tradeItems.length} Wertpapierabrechnung${tradeItems.length === 1 ? "" : "en"} erkannt. `
    + "Positionen werden ausschließlich aus den vorhandenen Kauf- und Verkaufsabrechnungen berechnet.");
  }

  /* --- Start ------------------------------------------------------------- */
  if (addSettingsSection("start", "Startverhalten", "Hauptbereich und Zeitraum des Finanzreports")) {
  addStamp("Hauptbereich beim Start");
  addChipRow(MAIN_SECTIONS.map((section) => ({
    label: screenWidth() < 520 && section.compact ? section.compact : section.label,
    on: SECTION === section.id,
    onTap: () => { setSection(section.id); },
  })), 44);
  addInfo("Der gewählte Hauptbereich wird beim nächsten Start wieder geöffnet.");

  addStamp("Zeitraum des Finanzreports");
  addChipRow([
    { label: "Zuletzt gewählt", on: cfg.startMode === "last", onTap: () => { setStartMode("last"); } },
    { label: "Neuestes Jahr", on: cfg.startMode === "latest", onTap: () => { setStartMode("latest"); } },
  ], 44);
  addInfo(cfg.startMode === "last"
    ? "Gemerkt ist " + (cfg.year
      ? (cfg.month ? MONTHS_LONG[cfg.month - 1] + " " : "Jahr ") + cfg.year
      : "noch nichts") + "."
    : "Es wird immer das neueste Jahr in voller Länge geöffnet.");
  }

  /* --- Export und Wartung ------------------------------------------------ */
  if (addSettingsSection("maintenance", "Export und Wartung", "CSV, Backup, Cache und Zurücksetzen")) {
  addValueRow({
    title: "CSV-Export Buchungen",
    subtitle: `Übersicht und Buchungen für ${periodLabel()}`,
    value: "⇪",
    valueColor: C.accent,
    onSelect: async () => { await exportCsv(); },
  });
  addValueRow({
    title: "CSV-Export Steuerwerte",
    subtitle: "Alle Felder der Anlage KAP über alle Jahre",
    value: "⇪",
    valueColor: C.accent,
    onSelect: async () => { await exportTaxCsv(); },
  });
  addValueRow({
    title: "CSV-Export Wertpapiere",
    subtitle: "Trades, Gebühren, Steuern und Kennungen",
    value: "⇪",
    valueColor: C.accent,
    onSelect: async () => { await exportTradeCsv(); },
  });
  addValueRow({
    title: "Backup erstellen",
    subtitle: "Konfiguration, Buchungen, Steuer- und Wertpapierwerte",
    value: "⇪",
    valueColor: C.accent,
    onSelect: async () => { await createBackup(); },
  });
  addValueRow({
    title: "Backup wiederherstellen",
    subtitle: "Zuvor gesicherte JSON-Datei einlesen",
    value: "⇩",
    valueColor: C.accent,
    onSelect: async () => { await restoreBackup(); },
  });
  addValueRow({
    title: "Auswertung neu aufbauen",
    subtitle: "Zwischenspeicher leeren und alle PDFs erneut lesen",
    value: "⟲",
    valueColor: C.warn,
    onSelect: async () => { await rebuildCaches(); },
  });
  addValueRow({
    title: "Konfiguration teilen",
    subtitle: "com_fm.ini exportieren",
    value: "⇪",
    valueColor: C.accent,
    onSelect: async () => {
      try { await ShareSheet.present([dirs.ini]); } catch (e) { flash("Teilen nicht möglich."); }
    },
  });
  addValueRow({
    title: "Auf Standard zurücksetzen",
    subtitle: "Alle Kategorien und Einstellungen verwerfen",
    value: "⟲",
    valueColor: C.minus,
    onSelect: async () => {
      const confirmed = await choose("Zurücksetzen?",
        "Die aktuelle com_fm.ini wird durch die Standardkonfiguration ersetzt. Zugangsdaten bleiben erhalten.",
        ["Zurücksetzen"]);
      if (confirmed !== 0) return;
      writeConfig(dirs, DEFAULT_INI);
      cfg = readIni(readConfig(dirs));
      APPEARANCE = cfg.appearance || "system";
      source = resolveStorage(dirs, cfg.path);
      VIEW = { name: "main" };
      await reassign("Standardkonfiguration wiederhergestellt.");
    },
  });
  }

  if (addSettingsSection("info", "Ablage und Version", "Speicherorte und Versionsstand")) {
  addInfo(`Konfiguration: ${dirs.ini}`);
  addInfo(`Postbox: ${dirs.postboxSettings}`);
  addInfo(`Arbeitsordner: ${dirs.root}`);
  addInfo(`PDF-Ordner: ${dirs.reports}`);
  addInfo(`Wertpapier-Cache: ${dirs.tradeCache}`);
  addInfo(`CSV-Export: ${dirs.exportDir}`);
  addInfo(`Version ${VERSION}`);
  }
  addSpacer(24);
}

function setStartMode(mode) {
  cfg.startMode = mode === "latest" ? "latest" : "last";
  setIniValue(dirs, "start", cfg.startMode);
  if (cfg.startMode === "last") {
    cfg.year = YEAR || null;
    cfg.month = MONTH || 0;
    setIniValue(dirs, "jahr", cfg.year ? String(cfg.year) : "");
    setIniValue(dirs, "monat", cfg.month ? String(cfg.month) : "");
  }
  render();
}

async function pickSource(mode) {
  let picked = null;
  try {
    picked = await chooseSource(dirs, mode);
  } catch (e) {
    flash("Auswahl fehlgeschlagen: " + (e.message || e));
    return;
  }
  if (!picked) return;
  source = picked;
  cfg.path = picked.ref;
  VIEW = { name: "main" };
  flash("Ordner gespeichert.");
  await scan();
}

/* ------------------------------------------------------ Gruppen-Editor */

function buildEditor() {
  const groups = iniGroups(dirs);
  const r = newRow(50);
  const back = r.addButton("‹ Einstellungen");
  back.widthWeight = 55;
  back.titleFont = F.rowStrong;
  back.titleColor = C.accent;
  back.onTap = () => { showSettings("report"); };
  const add = r.addButton("＋ Gruppe");
  add.widthWeight = 45;
  add.rightAligned();
  add.titleFont = F.rowStrong;
  add.titleColor = C.accent;
  add.onTap = async () => { await editGroup(null); };
  table.addRow(r);

  addInfo("Die erste passende Gruppe gewinnt. Mit ▲ und ▼ Reihenfolge ändern, "
    + "Zeile antippen zum Bearbeiten.");

  groups.forEach((g, i) => {
    const row = newRow(56);
    const t = row.addText(g.name, g.words.join(", "));
    t.widthWeight = 64;
    t.titleFont = F.rowStrong;
    t.titleColor = C.text;
    t.subtitleFont = F.meta;
    t.subtitleColor = C.dim;

    const up = row.addButton("▲");
    up.widthWeight = 12;
    up.centerAligned();
    up.titleColor = i === 0 ? C.faint : C.accent;
    up.onTap = async () => { await moveGroup(i, -1); };

    const down = row.addButton("▼");
    down.widthWeight = 12;
    down.centerAligned();
    down.titleColor = i === groups.length - 1 ? C.faint : C.accent;
    down.onTap = async () => { await moveGroup(i, 1); };

    const del = row.addButton("✕");
    del.widthWeight = 12;
    del.centerAligned();
    del.titleColor = C.minus;
    del.onTap = async () => { await deleteGroup(g.name); };

    row.onSelect = async () => { await editGroup(g.name); };
    applyTableStripe(row);
    table.addRow(row);
  });
  addSpacer(24);
}

async function moveGroup(index, delta) {
  const list = iniGroups(dirs);
  const target = index + delta;
  if (target < 0 || target >= list.length) return;
  const [item] = list.splice(index, 1);
  list.splice(target, 0, item);
  writeIniGroups(dirs, list);
  cfg = readIni(readConfig(dirs));
  render();
  // Die Reihenfolge entscheidet über die Zuordnung – deshalb neu bewerten.
  await reassign("Reihenfolge geändert.");
}

async function editGroup(name) {
  const list = iniGroups(dirs);
  const existing = name ? list.find((g) => g.name === name) : null;
  const a = new Alert();
  a.title = existing ? "Gruppe bearbeiten" : "Neue Kategorie";
  a.message = "Schlüsselwörter mit Komma trennen. Teiltreffer genügen, Kleinschreibung.";
  a.addTextField("Name", existing ? existing.name : "");
  a.addTextField("wort1,wort2", existing ? existing.words.join(",") : "");
  a.addAction("Sichern");
  a.addCancelAction("Abbrechen");
  if (await a.presentAlert() !== 0) return;

  const newName = a.textFieldValue(0).trim();
  const words = a.textFieldValue(1).toLowerCase().split(",")
    .map((s) => s.trim()).filter(Boolean);
  if (!newName || !words.length) { flash("Name und mindestens ein Schlüsselwort nötig."); return; }
  if (newName.indexOf(":") >= 0) { flash("Doppelpunkte sind im Namen nicht erlaubt."); return; }

  if (existing) {
    existing.name = newName;
    existing.words = words;
  } else {
    list.push({ name: newName, words });
  }
  writeIniGroups(dirs, list);
  cfg = readIni(readConfig(dirs));
  await reassign(existing ? "Kategorie gesichert." : "Kategorie angelegt.");
}

async function deleteGroup(name) {
  const confirmed = await choose("„" + name + "“ löschen?",
    "Die Buchungen werden danach neu zugeordnet.", ["Löschen"]);
  if (confirmed !== 0) return;
  const list = iniGroups(dirs).filter((g) => g.name !== name);
  writeIniGroups(dirs, list);
  cfg = readIni(readConfig(dirs));
  await reassign("Kategorie gelöscht.");
}

/* ------------------------------------------------------------- Anleitung */

const GUIDE = [
  {
    title: "1 · Was du brauchst",
    summary: "Zugangsdaten und API-Schlüssel",
    text: "• Zugangsnummer und PIN deines comdirect-Kontos.\n\n"
      + "• Client-ID und Client-Secret aus dem API-Zugang: comdirect → Persönlicher Bereich → "
      + "Einstellungen → API-Zugang freischalten und Schlüssel erzeugen.\n\n"
      + "• Eine App zur TAN-Freigabe, also photoTAN oder die comdirect-App.\n\n"
      + "Ohne Zugangsdaten lässt sich der Auswertungsteil trotzdem nutzen: PDFs einfach "
      + "über „Import …“ in den Ordner legen.",
  },
  {
    title: "2 · Einrichten",
    summary: "Zugang, Arbeitsordner und PDF-Bookmark",
    text: "1. In den Einstellungen unter „Comdirect-Zugang“ alle vier Werte eintragen. Sie landen "
      + "ausschließlich im iOS-Keychain, PIN und Secret werden nie wieder angezeigt.\n\n"
      + "2. Konfiguration, Cache, Bibliotheken und Exporte liegen im Ordner der com_fm.ini. PDFs werden "
      + "standardmäßig in „reports“ gespeichert. Alternativ kann unter „PDF-Ablage“ ein in den "
      + "Scriptable-Einstellungen angelegter Datei-Bookmark ausgewählt werden.\n\n"
      + "Änderungen werden sofort gespeichert, einen Speichern-Knopf gibt es nicht.",
  },
  {
    title: "3 · Filter für den Download",
    summary: "Zeitraum, Archiv, Dateinamen",
    text: "• Zeitraum: Start- und Enddatum grenzen ein, was geladen wird. Leer heißt offen.\n\n"
      + "• Archivstatus: alle, nur archivierte oder nur nicht archivierte Dokumente.\n\n"
      + "• Dateinamenfilter: lädt nur Dokumente, deren Name mit einem der Präfixe beginnt. Diese "
      + "Liste steuert zugleich die Auswahl „Dokumentart“ in der Dokumentliste.\n\n"
      + "• Werbedokumente sind standardmäßig ausgeschlossen.\n\n"
      + "• Unterordner pro Jahr legt die PDFs unter Jahr/pdf ab.",
  },
  {
    title: "4 · Dokumente laden",
    summary: "Anmeldung und TAN-Freigabe",
    text: "1. Oben auf ⤓ tippen und die Zusammenfassung bestätigen.\n\n"
      + "2. Die Freigabe in der TAN-App bestätigen, danach gegebenenfalls die TAN eingeben.\n\n"
      + "3. Der Fortschritt läuft im Kopf der App, zusätzlich als Mitteilung und in der Konsole. "
      + "PDFs werden nach Jahr abgelegt.\n\n"
      + "Nach mehreren falschen TAN-Eingaben kann comdirect den Zugang sperren. Im Zweifel "
      + "abbrechen statt raten.\n\n"
      + "Direkt nach dem Download werden die neuen Finanzreports automatisch ausgewertet.",
  },
  {
    title: "5 · Auswertung der Finanzreports",
    summary: "Kategorien und Schlüsselwörter",
    text: "Als Finanzreport gelesen werden PDFs, deren Name das Muster aus den Einstellungen enthält "
      + "(Standard: „Finanzreport“). Alle übrigen PDFs bleiben in der Dokumentliste erhalten.\n\n"
      + "• Jede Buchung wird über Schlüsselwörter einer Gruppe zugeordnet. Die erste passende "
      + "Gruppe gewinnt, deshalb entscheidet die Reihenfolge im Kategorien-Editor.\n\n"
      + "• Eine Buchung antippen → „Schlüsselwort anlegen“ ergänzt die Zuordnung dauerhaft.\n\n"
      + "• „Zeilenabstand“ korrigiert zusammenklebende oder zerrissene Wörter aus dem PDF.",
  },
  {
    title: "6 · Jahressteuerbescheinigungen",
    summary: "Anlage KAP, Steuerquote, Pauschbetrag",
    text: "Im Bereich „Jahressteuer“ werden alle PDFs ausgewertet, deren Name das Steuer-Muster enthält "
      + "(Standard: „Jahressteuer“). Die comdirect-Postbox liefert sie unter genau diesem Namen.\n\n"
      + "• Übersicht: Kapitalerträge, Aktiengewinne, Steuern und Pauschbetrag als Karten, dazu der "
      + "Vergleich mit dem Vorjahr.\n\n"
      + "• Verlauf: Kapitalerträge, Steuern und Auslastung des Sparer-Pauschbetrags über alle Jahre.\n\n"
      + "• Anlage KAP: jedes erkannte Feld mit seiner amtlichen Zeilennummer, bereit zum Übertragen "
      + "in die Steuererklärung.\n\n"
      + "Der Referenzwert des Sparer-Pauschbetrags lässt sich in den Einstellungen ändern (seit 2023 "
      + "1.000 € je Person). Unveränderte PDFs werden über ihre Signatur erkannt und nicht erneut gelesen.\n\n"
      + "Die Werte sind eine Lesehilfe. Vor Abgabe der Steuererklärung immer mit der "
      + "Originalbescheinigung abgleichen.",
  },
  {
    title: "7 · Ansichten",
    summary: "Finanzreport, Wertpapiere, Jahressteuer und Postbox",
    text: "Die App ist in vier Hauptbereiche gegliedert:\n\n"
      + "• Finanzreport: Kategorien, Verlauf und Buchungen für den gewählten Zeitraum.\n\n"
      + "• Wertpapiere: Übersicht, Jahresverlauf, rechnerische Positionen und erkannte Abrechnungen.\n\n"
      + "• Jahressteuer: Übersicht, Verlauf und Anlage KAP mit eigener Jahresnavigation.\n\n"
      + "• Postbox: Dokumente laden, Bestand aktualisieren, suchen und filtern.\n\n"
      + "Im Finanzreport zeigt „Kategorien“ Ringdiagramm und Summen je Gruppe.\n\n"
      + "• Verlauf: Jahreskennzahlen, Geldfluss, Netto-Saldo und Statistik.\n\n"
      + "• Buchungen: alle Einzelbuchungen nach Monaten gruppiert.\n\n"
      + "Die Postbox zeigt sämtliche PDFs des Ordners mit Suche, Jahr und Dokumentart. Finanzreports zeigen "
      + "ihre Prüfsumme, Steuer- und Wertpapierbelege ihren Auswertungsstand. Ein Tipp öffnet die PDF "
      + "beziehungsweise zuerst die erkannten Steuerwerte.\n\n"
      + "Mit ‹ und › wird der Monat gewechselt, über ▦ und ◫ lassen sich Jahr und Monat direkt wählen. "
      + "In der Jahressteuer schalten dieselben Pfeile das Steuerjahr um.",
  },
  {
    title: "8 · Darstellung und Symbole",
    summary: "Hell, Dunkel, System",
    text: "Die Symbolzeile oben enthält alles Wichtige:\n\n"
      + "⤓  Postbox laden\n"
      + "⟳  PDFs erneut auswerten\n"
      + "◐ / ☀︎ / ☾  Darstellung wechseln: System, Hell, Dunkel\n"
      + "ⓘ  diese Anleitung\n"
      + "⚙  Einstellungen\n\n"
      + "Im Modus „System“ folgen alle Farben automatisch der iOS-Einstellung. Die Oberfläche "
      + "nutzt immer die volle Breite und Höhe des Geräts, auch auf dem iPad und im Querformat.",
  },
  {
    title: "9 · Export und Sicherung",
    summary: "CSV, Backup, Konfiguration",
    text: "• CSV-Export Buchungen schreibt zwei Dateien in den Ordner export: eine Übersicht je "
      + "Gruppe und alle Einzelbuchungen des gewählten Zeitraums.\n\n"
      + "• CSV-Export Steuerwerte schreibt alle Felder der Anlage KAP über sämtliche Jahre.\n\n"
      + "• Backup erstellen sichert Konfiguration, Buchungen, Steuer- und Wertpapierwerte in einer JSON-Datei; "
      + "„Backup wiederherstellen“ liest sie auf demselben oder einem anderen Gerät wieder ein.\n\n"
      + "• Die Konfiguration com_fm.ini lässt sich einzeln teilen. App-Dateien und Unterordner bleiben "
      + "gemeinsam in ihrem Arbeitsordner; nur die PDF-Ablage darf auf einen Bookmark zeigen.\n\n"
      + "• Comdirect-postbox-settings.json liegt direkt neben com_fm.ini und spiegelt die "
      + "Postbox-Einstellungen in lesbarer JSON-Form.\n\n"
      + "• Zugangsdaten liegen ausschließlich im iOS-Keychain und werden nie exportiert.",
  },
  {
    title: "10 · Empfohlener Ablauf",
    summary: "Vom Download bis zur Kontrolle",
    text: "1. In der Postbox neue Dokumente laden oder vorhandene PDFs über die Einstellungen importieren.\n\n"
      + "2. Mit ⟳ den PDF-Bestand erneut einlesen. Neue Finanzreports, Wertpapierabrechnungen und Steuerbescheinigungen "
      + "werden dabei automatisch erkannt.\n\n"
      + "3. Im Finanzreport zuerst den Jahressaldo und anschließend Kategorien und Buchungen prüfen.\n\n"
      + "4. Unpassende Zuordnungen über die Buchungsdetails korrigieren. Neue Schlüsselwörter gelten "
      + "danach auch für weitere Buchungen.\n\n"
      + "5. In der Jahressteuer alle Prüfhinweise beachten und erkannte Werte mit dem Original-PDF vergleichen.\n\n"
      + "6. Nach größeren Änderungen ein Backup erstellen oder die CSV-Dateien exportieren.",
  },
  {
    title: "11 · Einstellungen",
    summary: "Eingeklappte Bereiche und automatische Speicherung",
    text: "Die Einstellungen sind nach Aufgaben gruppiert und zunächst eingeklappt. Eine Überschrift "
      + "antippen, um ihren Inhalt direkt in der UI zu öffnen. Beim Öffnen eines anderen Abschnitts "
      + "wird der bisherige wieder geschlossen.\n\n"
      + "• PDF-Ablage: lokal bei com_fm.ini oder über einen dauerhaften Scriptable-Dateibookmark.\n\n"
      + "• Comdirect-Zugang: Zugangsdaten und API-Schlüssel im iOS-Keychain.\n\n"
      + "• Postbox-Download: Zeitraum, Dokumentfilter, Unterordner und API-Seitengröße.\n\n"
      + "• Finanzreport: Dateimuster, Zeilenabstand und Kategorien.\n\n"
      + "• Jahressteuer: Dateimuster und Referenzwert des Sparer-Pauschbetrags.\n\n"
      + "• Startverhalten: Hauptbereich sowie letzter oder neuester Finanzreport-Zeitraum.\n\n"
      + "• Export und Wartung: CSV, Backup, Cache-Neuaufbau und Zurücksetzen.\n\n"
      + "Alle Änderungen werden sofort gespeichert. Die Darstellung wird ausschließlich über das "
      + "Symbol ◐, ☀︎ oder ☾ in der Hauptansicht umgeschaltet.",
  },
  {
    title: "12 · Tabellen und iPad",
    summary: "Streifen, Grafiken und große Bildschirme",
    text: "Sämtliche Daten- und Listenbereiche verwenden abwechselnde Zeilenfarben. Dadurch lassen "
      + "sich Dateinamen, Beträge und Statusangaben auch auf breiten iPad-Ansichten leichter verfolgen.\n\n"
      + "Überschriften, Navigation, Statusflächen und Diagramme bleiben einfarbig, damit sich Bedienung "
      + "und Daten klar unterscheiden.\n\n"
      + "Die Steuer-Kacheln und Verlaufsdiagramme behalten auf iPhone, iPad, im Querformat und in "
      + "Split View ihr Seitenverhältnis. Freier Rand auf sehr breiten Ansichten verhindert eine "
      + "Verzerrung der Kacheln.\n\n"
      + "Im Kategorien-Ring lassen sich zusätzliche Kategorien durch Antippen der Grafik ein- und "
      + "wieder ausblenden.",
  },
  {
    title: "13 · Wenn etwas klemmt",
    summary: "Häufige Fehlerbilder",
    text: "• HTTP 401: Client-ID oder Secret falsch, oder die Sitzung ist abgelaufen. Neu starten.\n\n"
      + "• HTTP 429: zu viele Anfragen, einige Minuten warten.\n\n"
      + "• Keine Dokumente: Filter prüfen, besonders Zeitraum und Dateinamenfilter.\n\n"
      + "• Ordner nicht erreichbar: prüfen, ob Scriptable auf seinen lokalen Dokumentordner "
      + "zugreifen kann, und die App anschließend neu starten.\n\n"
      + "• Keine Buchungen erkannt: Zeilenabstand anpassen und prüfen, ob das Dateimuster zu den "
      + "PDF-Namen passt.\n\n"
      + "• Steuerwerte unvollständig: Der Prüfhinweis nennt die Zahl der sicher erkannten Felder. "
      + "Hilft ein anderer Zeilenabstand nicht, „Auswertung neu aufbauen“ in den Einstellungen "
      + "erzwingt ein vollständiges Neulesen.\n\n"
      + "• PDF-Auswertung nicht verfügbar: beim ersten Lauf wird pdf.js einmalig geladen, dafür "
      + "wird kurz eine Internetverbindung benötigt.",
  },
];

function addHelpParagraph(text) {
  const value = String(text || "").trim();
  if (!value) return;
  const wrappedLines = value.split("\n")
    .reduce((sum, line) => sum + Math.max(1, Math.ceil(line.length / 44)), 0);
  const r = newRow(Math.max(44, 20 + wrappedLines * 19));
  const t = r.addText(value);
  t.titleFont = Font.systemFont(14);
  t.titleColor = C.text;
  applyTableStripe(r);
  table.addRow(r);
}

function addHelpSection(section, index) {
  const id = String(index);
  const open = HELP_OPEN === id;
  const r = newRow(60);
  r.backgroundColor = C.head;
  const title = r.addText(section.title, section.summary);
  title.widthWeight = 90;
  title.titleFont = F.rowStrong;
  title.titleColor = C.text;
  title.subtitleFont = F.meta;
  title.subtitleColor = C.dim;
  const arrow = r.addText(open ? "⌄" : "›");
  arrow.widthWeight = 10;
  arrow.rightAligned();
  arrow.titleFont = F.big;
  arrow.titleColor = C.accent;
  r.onSelect = () => {
    HELP_OPEN = open ? "" : id;
    render();
  };
  table.addRow(r);
  STRIPE_INDEX = 0;
  if (open) section.text.split(/\n\s*\n/).forEach(addHelpParagraph);
}

function buildHelp() {
  addBackRow("Anleitung", `${APP} ${VERSION}`);
  addInfo("Kapitel antippen, um den Inhalt direkt hier auf- oder zuzuklappen.");
  GUIDE.forEach(addHelpSection);
  addSpacer(24);
}

/* --------------------------------------------------------------- Download */

async function startDownload() {
  try {
    await runDownload();
  } catch (error) {
    busy = null;
    render();
    await showError(error);
  }
}

async function runDownload() {
  const credentials = getCredentials();
  if (!credentials) {
    await alert("Zugangsdaten fehlen",
      "Bitte zuerst Zugangsnummer, PIN, Client-ID und Client-Secret in den Einstellungen hinterlegen.");
    showSettings("access");
    return;
  }

  const storage = resolveStorage(dirs, cfg.path);
  if (storage.unavailable) {
    await alert("Ordner nicht verfügbar",
      `${storage.label}\n\nBitte den PDF-Ordner in den Einstellungen neu auswählen.`);
    showSettings("storage");
    return;
  }
  const owner = managerForPath(storage.path);
  if (!owner.fileExists(storage.path)) {
    try { owner.createDirectory(storage.path, true); }
    catch (e) { throw new Error(`Der Zielordner konnte nicht angelegt werden: ${String(e.message || e)}`); }
  }

  const confirm = await choose("Download starten?", filterSummary(cfg, storage), ["Anmelden und laden"], "Abbrechen");
  if (confirm !== 0) return;

  const step = async (percent, message) => {
    busy = { big: "Postbox wird geladen", sub: message, pct: Math.max(0, Math.min(100, percent)) / 100 };
    render();
  };

  const api = new ComdirectApi(credentials);
  try {
    await step(2, "Anmeldung wird vorbereitet …");
    await api.login(async (percent, message) => {
      console.log(`${percent}% · ${message}`);
      await step(percent * 0.5, message);
    });
    await step(26, "Anmeldung erfolgreich · Dokumentliste wird geladen");

    let documents;
    try {
      documents = await loadAllDocuments(api, cfg.pageSize, async (percent, message) => {
        await step(26 + percent * 0.1, message);
      });
    } catch (error) {
      throw new Error(`Postbox-Dokumentliste konnte nicht geladen werden: ${String(error.message || error)}`);
    }

    const selected = documents.filter((doc) => matchesDownloadFilter(doc, cfg));
    if (!selected.length) {
      busy = null;
      render();
      await alert("Keine Dokumente",
        `Gefunden: ${documents.length}\nNach den gewählten Filtern bleibt kein PDF übrig.`);
      return;
    }

    let downloaded = 0, skipped = 0, failed = 0;
    const failures = [];

    for (let i = 0; i < selected.length; i++) {
      const doc = selected[i];
      const percent = 36 + Math.round((i / selected.length) * 62);
      if (i === 0 || (i + 1) % 5 === 0 || i === selected.length - 1) {
        await step(percent, `${i + 1} von ${selected.length} · ${doc.name}`);
      }
      if (i === 0 || (i + 1) % 25 === 0) {
        await notify("comdirect Download", `${i + 1}/${selected.length}`);
      }
      try {
        const target = targetPath(owner, storage.path, doc, cfg);
        if (cfg.skipExisting && owner.fileExists(target)) { skipped++; continue; }
        const finalTarget = cfg.skipExisting ? target : uniquePath(owner, target, doc.dateCreation);
        const data = await api.documentData(doc);
        owner.write(finalTarget, data);
        downloaded++;
      } catch (error) {
        failed++;
        failures.push(`${doc.name}: ${String(error.message || error)}`);
        if (failed > 25 && downloaded === 0) {
          throw new Error("Zu viele aufeinanderfolgende Fehler – Abbruch.");
        }
      }
    }

    busy = null;
    render();
    const result = `Gefunden: ${documents.length}\nAusgewählt: ${selected.length}\n`
      + `Heruntergeladen: ${downloaded}\nÜbersprungen: ${skipped}\nFehler: ${failed}\n\nZiel: ${storage.label}`;
    await notify("comdirect Download abgeschlossen",
      `${downloaded} geladen · ${skipped} übersprungen · ${failed} Fehler`);
    await alert("Download abgeschlossen",
      result + (failures.length ? `\n\nErste Fehler:\n${failures.slice(0, 5).join("\n")}` : ""));

    if (downloaded > 0) {
      flash(`${downloaded} neue PDF · Auswertung wird aktualisiert.`);
      await scan();
    } else {
      scanPdfLibrary();
      render();
    }
  } finally {
    busy = null;
    await api.logout();
  }
}

/* ------------------------------------------------------------- Steuerung */

function render() {
  STRIPE_INDEX = 0;
  table.removeAllRows();
  if (VIEW.name === "settings") buildSettings();
  else if (VIEW.name === "editor") buildEditor();
  else if (VIEW.name === "help") buildHelp();
  else if (VIEW.name === "group") buildGroupDetail(VIEW.group);
  else if (VIEW.name === "assign") buildAssign(VIEW.booking);
  else buildMain();
  if (presented) {
    try { table.reload(); } catch (e) { /* Tabelle bereits geschlossen */ }
  }
}

function buildMain() {
  addTitleRow();
  addIconRow();
  addSectionTabs();

  // Wertpapiere, Jahressteuer und Postbox sind eigenständige Bereiche; nur der
  // Finanzreport verwendet die Monatsnavigation.
  if (SECTION === "securities") {
    addTradeSummaryRow();
    if (notice) addStamp(notice, C.accent);
    addTradeYearNavigation();
    addTradeTabs();
    if (busy) addBusy();
    buildTrade();
    addSpacer(24);
    return;
  }

  if (SECTION === "tax") {
    addTaxSummaryRow();
    if (notice) addStamp(notice, C.accent);
    addTaxYearNavigation();
    addTaxSubTabs();
    if (busy) addBusy();
    buildTax();
    addSpacer(24);
    return;
  }

  if (SECTION === "postbox") {
    addPostboxSummaryRow();
    if (notice) addStamp(notice, C.accent);
    addPostboxActions();
    if (busy) addBusy();
    buildDocuments();
    addSpacer(24);
    return;
  }

  addPeriodRow();
  if (notice) addStamp(notice, C.accent);
  addPeriodNavigation();
  addReportTabs();
  // Die Hauptansicht bleibt auch während des Einlesens vollständig sichtbar.
  // So startet die App nicht mit einer scheinbar leeren Tabelle.
  if (busy) addBusy();
  if (TAB === "groups") buildGroups();
  else if (TAB === "bookings") buildBookings();
  else buildMonths();
  addSpacer(24);
}

function rememberPeriod() {
  cfg.year = YEAR || null;
  cfg.month = MONTH || 0;
  cfg.tab = TAB;
  cfg.section = SECTION;
  setIniValue(dirs, "jahr", cfg.year ? String(cfg.year) : "");
  setIniValue(dirs, "monat", cfg.month ? String(cfg.month) : "");
  setIniValue(dirs, "ansicht", cfg.tab || "groups");
  setIniValue(dirs, "bereich", cfg.section || "report");
}

function initPeriod() {
  TAX_YEAR = cfg.taxYear || null;
  TAX_TAB = cfg.taxTab || "overview";
  TRADE_YEAR = cfg.tradeYear || null;
  TRADE_TAB = cfg.tradeTab || "overview";
  const years = availableYears();
  const wanted = cfg.startMode === "last" ? cfg.year : null;
  YEAR = years.indexOf(wanted) >= 0 ? wanted : years[0];
  MONTH = cfg.startMode === "last" && YEAR === wanted ? (cfg.month || 0) : 0;
  SECTION = cfg.section || "report";
  // Migration der bisherigen gemischten Navigation.
  if (cfg.tab === "files") SECTION = "postbox";
  if (cfg.tab === "tax") SECTION = "tax";
  TAB = ["groups", "months", "bookings"].indexOf(cfg.tab) >= 0 ? cfg.tab : "groups";
}

// Ordnet die zwischengespeicherten Seiten mit den aktuellen Gruppen neu zu.
function regroup() {
  bookings = [];
  const infos = [];
  for (const entry of pageCache) {
    if (entry.error) {
      infos.push({ file: entry.file, delta: null, error: entry.error });
      continue;
    }
    infos.push(parseReport(entry.file, entry.pages, cfg.groups, bookings));
  }
  return infos;
}

// Nach Änderungen an den Gruppen: ohne erneutes PDF-Lesen neu zuordnen.
async function reassign(message) {
  if (pageCache.length) {
    fileInfos = regroup();
    if (bookings.length) writeBookingsCache(dirs, cfg.path, bookings, fileInfos);
    if (availableYears().indexOf(YEAR) < 0) initPeriod();
    flash(message + " Buchungen neu zugeordnet.");
  } else {
    flash(message);
    await scan();
  }
}

async function exportCsv() {
  if (!bookings.length) { flash("Noch nichts auszuwerten."); return; }
  const [p1, p2] = writeCsv(dirs, bookings, YEAR, MONTH);
  flash("Gesichert: export/" + p1.split("/").pop());
  try {
    await ShareSheet.present([p1, p2]);
  } catch (e) {
    /* Teilen über der Tabelle nicht möglich – die Dateien liegen lokal bereit */
  }
}

async function scan(mode) {
  const startup = mode === "startup";
  // Vor jedem Lauf den lokalen oder per Bookmark gewählten PDF-Ordner auflösen.
  source = resolveStorage(dirs, cfg.path);
  emptyInfo = null;
  busy = null;
  scanPdfLibrary();

  const files = docFiles.map((f) => f.relative).filter(isReportFile);
  const taxFiles = docFiles.map((f) => f.relative).filter(isTaxFile);
  const tradeFiles = docFiles.map((f) => f.relative).filter(isTradeFile);
  if (!files.length && !taxFiles.length && !tradeFiles.length) {
    if (bookings.length) {
      flash("Keine auswertbaren PDFs – gespeicherte Daten werden angezeigt.");
    } else {
      emptyInfo = {
        title: docFiles.length ? "Keine auswertbaren PDFs gefunden" : "Noch keine PDFs vorhanden",
        text: docFiles.length
          ? `${docFiles.length} PDF in ${source.label}, aber keine mit dem Muster „${cfg.reportPattern}“ `
            + `, „${cfg.taxPattern}“ oder „${cfg.tradePattern}“. Die Muster lassen sich in den Einstellungen ändern.`
          : `Durchsucht wurde: ${source.label}. Über ⤓ lässt sich die Postbox laden; über das `
            + "Zahnrad können PDFs in die gewählte Ablage importiert werden.",
      };
      render();
    }
    return false;
  }

  const scanTitle = startup
    ? "Finanzreports werden beim Start gelesen"
    : "Finanzreports werden gelesen";
  const totalFiles = files.length + taxFiles.length + tradeFiles.length;
  busy = {
    big: scanTitle,
    sub: `${source.label} · ${totalFiles} PDF · PDF-Engine wird vorbereitet`,
    pct: 0.02,
  };
  if (!bookings.length) {
    emptyInfo = {
      title: "Auswertung wird aufgebaut",
      text: `${files.length} ${files.length === 1 ? "Report wird" : "Reports werden"} automatisch aus ${source.label} eingelesen.`,
    };
  }
  render();

  if (!extractor || extractorGap !== cfg.gap) {
    try {
      extractor = await buildExtractor(dirs, cfg.gap);
      extractorGap = cfg.gap;
    } catch (e) {
      busy = null;
      const cached = readBookingsCache(dirs, cfg.path);
      if (cached && cached.bookings.length) {
        bookings = cached.bookings;
        fileInfos = cached.files || [];
        flash("PDF-Engine nicht verfügbar – gespeicherte Daten werden angezeigt.");
      } else {
        emptyInfo = { title: "PDF-Auswertung nicht verfügbar", text: String(e.message || e) };
        render();
      }
      return false;
    }
  }

  const nextCache = [];
  for (let i = 0; i < files.length; i++) {
    const name = files[i];
    busy = {
      big: scanTitle,
      sub: `${source.label} · ${i + 1} von ${totalFiles}: ${name.split("/").pop()}`,
      pct: i / totalFiles,
    };
    render();
    let res;
    try {
      const sourceFm = managerForPath(source.path);
      const reportPath = sourceFm.joinPath(source.path, name);
      // Konfigurierte iCloud-Dateien bei Bedarf automatisch laden. Der Nutzer
      // bleibt währenddessen in der Oberfläche und sieht den Fortschritt.
      await ensureDownloaded(reportPath);
      res = await extractPdf(extractor, reportPath);
    } catch (e) {
      res = { ok: false, error: String(e.message || e) };
    }
    if (!res || !res.ok) {
      nextCache.push({ file: name, error: res ? res.error : "unbekannt" });
      continue;
    }
    nextCache.push({ file: name, pages: res.pages });
  }

  pageCache = nextCache;
  const infos = regroup();

  // Jahressteuerbescheinigungen: unveränderte PDFs werden über ihre Signatur
  // erkannt und nicht erneut gelesen.
  if (taxFiles.length) {
    const cachedTax = readTaxCache(dirs);
    const byFile = {};
    cachedTax.items.forEach((x) => { if (x && x.file) byFile[x.file] = x; });
    const nextTax = [];
    const nextSignatures = {};
    for (let i = 0; i < taxFiles.length; i++) {
      const name = taxFiles[i];
      const sourceFm = managerForPath(source.path);
      const certPath = sourceFm.joinPath(source.path, name);
      const sig = fileSignature(certPath);
      nextSignatures[name] = sig;
      if (sig && cachedTax.signatures[name] === sig && byFile[name]) {
        nextTax.push(byFile[name]);
        continue;
      }
      busy = {
        big: "Steuerbescheinigungen werden gelesen",
        sub: `${source.label} · ${files.length + i + 1} von ${totalFiles}: ${name.split("/").pop()}`,
        pct: (files.length + i) / totalFiles,
      };
      render();
      try {
        await ensureDownloaded(certPath);
        const res = await extractPdf(extractor, certPath);
        if (res && res.ok && Array.isArray(res.pages)) nextTax.push(parseCertificate(res.pages, name));
        else {
          nextTax.push({
            id: name, file: name, year: null, provider: "Unbekannt",
            warning: (res && res.error) || "PDF konnte nicht gelesen werden",
          });
        }
      } catch (e) {
        nextTax.push({ id: name, file: name, year: null, provider: "Unbekannt", warning: String(e.message || e) });
      }
    }
    taxItems = nextTax;
    taxSignatures = nextSignatures;
    writeTaxCache(dirs, taxItems, taxSignatures);
    if (taxYears().length && !taxYears().includes(Number(TAX_YEAR))) {
      TAX_YEAR = taxYears()[0];
      cfg.taxYear = TAX_YEAR;
      setIniValue(dirs, "steuerjahr", String(TAX_YEAR));
    }
  } else {
    taxItems = [];
    taxSignatures = {};
  }

  // Wertpapierabrechnungen verwenden dieselbe PDF-Engine und denselben
  // Dokumentbestand, aber einen eigenen Cache für ihre strukturierten Werte.
  if (tradeFiles.length) {
    const cachedTrades = readTradeCache(dirs);
    const byFile = {};
    cachedTrades.items.forEach((x) => { if (x && x.file) byFile[x.file] = x; });
    const nextTrades = [], nextTradeSignatures = {};
    for (let i = 0; i < tradeFiles.length; i++) {
      const name = tradeFiles[i], sourceFm = managerForPath(source.path);
      const tradePath = sourceFm.joinPath(source.path, name), sig = fileSignature(tradePath);
      nextTradeSignatures[name] = sig;
      if (sig && cachedTrades.signatures[name] === sig && byFile[name]) {
        nextTrades.push(byFile[name]);
        continue;
      }
      busy = {
        big: "Wertpapierabrechnungen werden gelesen",
        sub: `${source.label} · ${files.length + taxFiles.length + i + 1} von ${totalFiles}: ${name.split("/").pop()}`,
        pct: (files.length + taxFiles.length + i) / totalFiles,
      };
      render();
      try {
        await ensureDownloaded(tradePath);
        const res = await extractPdf(extractor, tradePath);
        if (res && res.ok && Array.isArray(res.pages)) nextTrades.push(parseTradeDocument(res.pages, name));
        else nextTrades.push({ id: name, file: name, year: null, tradeType: "Unbekannt",
          warning: (res && res.error) || "PDF konnte nicht gelesen werden" });
      } catch (e) {
        nextTrades.push({ id: name, file: name, year: null, tradeType: "Unbekannt", warning: String(e.message || e) });
      }
    }
    tradeItems = nextTrades;
    tradeSignatures = nextTradeSignatures;
    writeTradeCache(dirs, tradeItems, tradeSignatures);
    if (tradeYears().length && !tradeYears().includes(Number(TRADE_YEAR))) {
      TRADE_YEAR = tradeYears()[0];
      cfg.tradeYear = TRADE_YEAR;
      setIniValue(dirs, "wertpapierjahr", String(TRADE_YEAR));
    }
  } else {
    tradeItems = [];
    tradeSignatures = {};
  }

  busy = null;

  if (!files.length) {
    // Nur Steuer- und/oder Wertpapierbelege vorhanden – das ist kein Fehler.
    fileInfos = infos;
    if (!bookings.length) {
      emptyInfo = {
        title: "Keine Finanzreports vorhanden",
        text: `${taxFiles.length} Jahressteuerbescheinigung${taxFiles.length === 1 ? "" : "en"} und `
          + `${tradeFiles.length} Wertpapierabrechnung${tradeFiles.length === 1 ? "" : "en"} ausgewertet. `
          + "Die Buchungsauswertung benötigt zusätzlich Finanzreports im PDF-Ordner.",
      };
    }
    if (startup) flash(`${taxFiles.length} Steuer- und ${tradeFiles.length} Wertpapierbeleg${tradeFiles.length === 1 ? "" : "e"} eingelesen.`);
    else render();
    return true;
  }

  if (!bookings.length) {
    const old = readBookingsCache(dirs, cfg.path);
    if (old && old.bookings.length) {
      bookings = old.bookings;
      fileInfos = old.files || [];
      flash("Neue Auswertung ohne Ergebnis – gespeicherte Daten bleiben erhalten.");
    } else {
      fileInfos = infos;
      emptyInfo = {
        title: "Keine Buchungen erkannt",
        text: `${files.length} PDF gelesen, aber keine auswertbaren Buchungszeilen gefunden. `
          + "Prüfe den Zeilenabstand in den Einstellungen.",
      };
      render();
    }
    return false;
  }

  fileInfos = infos;
  writeBookingsCache(dirs, cfg.path, bookings, fileInfos);
  if (availableYears().indexOf(YEAR) < 0) initPeriod();
  if (startup) {
    const taxExtra = taxFiles.length ? ` · ${taxFiles.length} Steuerbescheinigung${taxFiles.length === 1 ? "" : "en"}` : "";
    const tradeExtra = tradeFiles.length ? ` · ${tradeFiles.length} Wertpapierbeleg${tradeFiles.length === 1 ? "" : "e"}` : "";
    flash(`${files.length} ${files.length === 1 ? "Report" : "Reports"} automatisch eingelesen${taxExtra}${tradeExtra}.`);
  } else {
    render();
  }
  return true;
}

/* ------------------------------------------------------------------- Ablauf */

function giveUiTime(milliseconds) {
  return new Promise((resolve) => {
    const timer = Timer.schedule(milliseconds, false, () => {
      try { timer.invalidate(); } catch (e) { /* bereits beendet */ }
      resolve();
    });
  });
}

async function main() {
  dirs = await setupDirs();
  cfg = readIni(readConfig(dirs));
  APPEARANCE = cfg.appearance || "system";
  source = resolveStorage(dirs, cfg.path);

  // Zuletzt erfolgreich gelesene Daten sofort darstellen. Damit ist die
  // Tabelle beim Start gefüllt, auch wenn iCloud noch synchronisiert.
  const cached = readBookingsCache(dirs, cfg.path);
  if (cached && cached.bookings.length) {
    bookings = cached.bookings;
    fileInfos = cached.files || [];
  }
  const cachedTax = readTaxCache(dirs);
  taxItems = cachedTax.items;
  taxSignatures = cachedTax.signatures;
  const cachedTrades = readTradeCache(dirs);
  tradeItems = cachedTrades.items;
  tradeSignatures = cachedTrades.signatures;
  initPeriod();

  // Der Download lässt sich weiterhin direkt aus einem Kurzbefehl anstoßen:
  // scriptable:///run/comdirect?action=download
  const action = (args.queryParameters && args.queryParameters.action) || "";

  busy = {
    big: "Konfigurierter Ordner wird geöffnet",
    sub: source.label,
    pct: 0,
  };
  if (!bookings.length) {
    emptyInfo = {
      title: `${APP} wird aufgebaut`,
      text: `Anschließend wird ${source.label} automatisch eingelesen.`,
    };
  }
  render();

  // present() läuft parallel weiter; die Tabelle wird währenddessen
  // über reload() aktualisiert. Der Schalter sorgt für die volle
  // Bildschirmfläche auf iPhone und iPad.
  const closed = table.present(FULLSCREEN_UI);
  presented = true;

  // Der nativen Tabelle Zeit zum ersten Zeichnen geben, bevor Dateisystem und
  // PDF-Auswertung starten. Ohne diese Pause kann iOS zunächst eine leere
  // Vollbildfläche zeigen.
  await giveUiTime(250);

  if (action === "download") {
    await startDownload();
  } else {
    await scan("startup");
  }

  await closed;
  presented = false;
  if (noticeTimer) { try { noticeTimer.invalidate(); } catch (e) { /* egal */ } }
}

await main();
Script.complete();
