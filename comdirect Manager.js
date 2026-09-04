// Variables used by Scriptable.
// These must be at the very top of the file. Do not edit.
// icon-color: deep-green; icon-glyph: university;

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
 *   Scriptable/comdirect/com_fm.ini      Einstellungen
 *   Scriptable/comdirect/categories.json Kategorien, Regeln und manuelle Zuordnungen
 *   Scriptable/comdirect/Comdirect-postbox-settings.json  Postbox-Einstellungen
 *   Scriptable/comdirect/reports/*.pdf   PDFs aus der Postbox
 *   Scriptable/comdirect/export/*.csv    CSV-Ergebnisdateien
 *   Scriptable/comdirect/backup/*.json   Sicherungen mit Datum und Uhrzeit
 *   Scriptable/comdirect/logs/*.log      Protokoll je Geraet
 *   Scriptable/comdirect/lib/            pdf.js-Cache (offline nach 1. Lauf)
 *   Scriptable/comdirect/*-cache.json     Analyse-Caches aller Bereiche
 *
 * Lizenz: Der Postbox-Teil steht unter GPL-3.0-or-later, der Finanzteil ist eine
 * Portierung von t4ri/Python-Finanzmanager (CC BY-NC-SA 4.0), der Steuerteil
 * stammt aus dem Jahressteuer Manager.
 * ========================================================================= */

const APP = "comdirect";
const VERSION = "4.3.0";

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
// Wird hochgezaehlt, sobald sich eine Auswertungsregel aendert. Der Wert geht
// in jede Dateisignatur ein, damit zwischengespeicherte Ergebnisse nach einem
// Update automatisch verworfen und die PDFs neu gelesen werden.
const PARSER_VERSION = {
  report: 1,
  tax: 1,
  // 2: Mischkurs, Belegtyp ueber Dateinamen, Ertragsgutschriften,
  //    Plausibilitaetspruefungen
  trade: 2,
};
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
  // Wertpapierabrechnungen
  tradePattern: "Wertpapierabrechnung",
  // Ertragsgutschriften (Dividenden und Ausschuettungen)
  incomePattern: "Ertragsgutschrift",
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

const DEFAULT_INI = `# comdirect – Einstellungen
# Kategorien und Schlüsselwörter liegen separat in categories.json.

# Startjahr der Auswertung (kann in der App umgeschaltet werden)
jahr : ${new Date().getFullYear()}

# Nur PDFs mit diesem Text im Dateinamen werden als Finanzreport ausgewertet.
# Leer lassen, um jede PDF im Ordner zu lesen.
muster : ${DEFAULTS.reportPattern}

# PDFs mit diesem Text im Namen werden als Jahressteuerbescheinigung gelesen.
steuermuster : ${DEFAULTS.taxPattern}

# PDFs mit diesem Text im Namen werden als Wertpapierabrechnung ausgewertet.
wertpapiermuster : ${DEFAULTS.tradePattern}

# PDFs mit diesem Text im Namen werden als Ertragsgutschrift ausgewertet.
ertragsmuster : ${DEFAULTS.incomePattern}


`;

const DEFAULT_CATEGORY_GROUPS = [{"name":"Investment","words":["wertpapier","kupon","bank","ertraegnis","secupay","treuhand","funding","projekt","tagesgeld","holding","dabbnp","consors","invest","broker","zinszahung","investment"]},{"name":"Online Ausgaben","words":["paypal","amazon","internet","online","greatnet"]},{"name":"Spende","words":["spende"]},{"name":"Friseur","words":["friseur"]},{"name":"Kleidung/Schuhe","words":["schuh","p+c","galeria","s.oliver","jeans","esprit","streetone","modehaus","fashion","gabor","h&h","citystyle"]},{"name":"Energie/Wasser","words":["stadtwerke","wasser","strom","heizung","heizöl","heizoel"]},{"name":"Gebühren","words":["stadt","landkreis","staedtisch","städtisch","rathaus","komune","comune","landratsamt","post","polizei","polic"]},{"name":"Steuern","words":["finanzamt","steuer"]},{"name":"Lotterie","words":["lotto","aktionmensch"]},{"name":"Arzt/Medikamente","words":["apotheke","optik","aerzte","fielmann","apo","therapie","dr.","praxis","agricola","health","labor","klinik","medal","krankenhaus","brille"]},{"name":"Drogerie","words":["parfuem","douglas","rossmann","drogerie"]},{"name":"Versicherung","words":["universa","versicherung","huk","cosmos","krankenkasse"]},{"name":"Entertainment","words":["audible","netflix","spotify","video","music","musik","ard","zdf","rundfunk"]},{"name":"Zeitung/Bücher","words":["intanservice","thalia"]},{"name":"Telefon","words":["e-plus","telekom","1&1","vodafon"]},{"name":"Urlaub/Reisen","words":["hotel","dbvertrieb","bahn","wohnen"]},{"name":"Möbel","words":["ikea","xxxlutz","möbel","hoeffner","kibek","moemax","moebel","butlers"]},{"name":"Wein","words":["wein","vino"]},{"name":"Restaurant","words":["gasthaus","gasthof","steakhaus","raststaette","rasthaus","gastronom","mcdonald","braeu","bräu","ristorant","rist.","restaurant","pizzeria","burger","sangamer","kafe","cafe","kaffee","pizza","dean&david","hansimglueck","dinzler","genuss"]},{"name":"Kreditkarte","words":["visa","american"]},{"name":"Kinder","words":["bundesagentur"]},{"name":"Geschenke","words":["muttertag"]},{"name":"Haus/Baumarkt/Garten","words":["baumarkt","obi","hornbach","dehner","garten","baumschule","bauhaus","gaertnerei","tupper","viessmann"]},{"name":"Auto/Tanken","words":["kfz","station","werkstatt","tankstelle","omv","aral","esso","agip","oil","jet","shell","parken","stahlgruber","trost","autoh.","autohaus"]},{"name":"Lebensmittel","words":["rewe","aldi","edeka","norma","combi","e-center","ecenter","globus","lidl","coop","penny","kaufland","nahkauf","bäcker","baecker","brot","superm","markt","skonto","sconto","spar","metzger","fleischer","getraenke","getränke","fressnapf","beeren","grill","migross","speck","blumen","fisch"]},{"name":"Vereine/Sport","words":["verein","sport","tennis","fussball","stadler","mitglied","fahrrad"]},{"name":"Öffentl. Verkehr","words":["vag","öpnv"]},{"name":"Barabhebung","words":["geldautomat","sparkasse","hvb","bargeld","auszahlung"]},{"name":"Bankgebühren","words":["kartenverf","abschluss","entgelt","einzug"]}];

/* ---------------------------------------------------------------- Dateisystem */

// Der Arbeitsordner liegt in iCloud, damit iPhone und iPad denselben Stand
// sehen. FileManager.local() wird nur noch für die einmalige Übernahme des
// bisherigen gerätelokalen Bestands benötigt.
const localFm = FileManager.local();
let cloudFm = null;
try { cloudFm = FileManager.iCloud(); } catch (e) { cloudFm = null; }
// Ohne aktives iCloud Drive verhält sich alles wie bisher rein lokal.
const fm = cloudFm || localFm;
const ICLOUD_ACTIVE = fm === cloudFm;
// Nur für die einmalige Übernahme älterer Installationen. Die aktuelle
// Konfiguration hat genau eine Quelle: com_fm.ini im Arbeitsordner.
const LEGACY_CONFIG_KEY = `${APP}.settings.v1`;

function managerForPath(path) {
  if (cloudFm) {
    try {
      const root = cloudFm.documentsDirectory();
      if (path === root || path.startsWith(root + "/")) return cloudFm;
      if (/Mobile Documents|iCloud/i.test(path)) return cloudFm;
    } catch (e) { /* lokal weiterarbeiten */ }
  }
  return localFm;
}

/* ---------------------------------------------------------------- Protokoll */

// Zeilen ueber diesem Wert werden beim naechsten Schreiben abgeschnitten.
const LOG_MAX_LINES = 400;
let LOG_BUFFER = [];

function deviceSlug() {
  let name = "";
  try { name = String(Device.name() || ""); } catch (e) { name = ""; }
  if (!name) {
    try { name = String(Device.model() || "geraet"); } catch (e) { name = "geraet"; }
  }
  return name.replace(/[^A-Za-z0-9_-]+/g, "-").replace(/^-+|-+$/g, "").toLowerCase() || "geraet";
}

function logStamp() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
}

/**
 * Schreibt eine Protokollzeile. Faellt das Schreiben aus (z. B. weil der
 * Arbeitsordner noch nicht existiert), wird die Zeile gepuffert und beim
 * naechsten erfolgreichen Aufruf nachgetragen. Das Protokoll darf den
 * Programmablauf nie unterbrechen.
 */
function logLine(text, scope) {
  const entry = `${logStamp()} [${scope || "app"}] ${String(text)}`;
  console.log(entry);
  LOG_BUFFER.push(entry);
  try {
    if (!dirs || !dirs.log) return;
    if (!fm.fileExists(dirs.logDir)) fm.createDirectory(dirs.logDir, true);
    let existing = "";
    if (fm.fileExists(dirs.log)) {
      if (ICLOUD_ACTIVE && !fm.isFileDownloaded(dirs.log)) {
        try { fm.downloadFileFromiCloud(dirs.log).catch(() => {}); } catch (e) { /* egal */ }
        return;
      }
      existing = fm.readString(dirs.log) || "";
    }
    let lines = existing ? existing.split("\n").filter((x) => x !== "") : [];
    lines = lines.concat(LOG_BUFFER);
    if (lines.length > LOG_MAX_LINES) lines = lines.slice(lines.length - LOG_MAX_LINES);
    fm.writeString(dirs.log, lines.join("\n") + "\n");
    LOG_BUFFER = [];
  } catch (e) { /* Protokoll ist optional und darf nie den Ablauf stoppen */ }
}

/** Liefert die letzten Zeilen des Protokolls, neueste zuerst. */
function readLogLines(count) {
  try {
    if (!dirs || !dirs.log || !fm.fileExists(dirs.log)) return [];
    if (ICLOUD_ACTIVE && !fm.isFileDownloaded(dirs.log)) {
      try { fm.downloadFileFromiCloud(dirs.log).catch(() => {}); } catch (e) { /* egal */ }
      return [];
    }
    const lines = (fm.readString(dirs.log) || "").split("\n").filter((x) => x !== "");
    return lines.slice(Math.max(0, lines.length - (count || 40))).reverse();
  } catch (e) { return []; }
}

/** Alle Logdateien im Arbeitsordner, also auch die des anderen Geraets. */
function listLogFiles() {
  try {
    if (!dirs || !dirs.logDir || !fm.fileExists(dirs.logDir)) return [];
    return fm.listContents(dirs.logDir)
      .filter((n) => n.endsWith(".log"))
      .map((n) => fm.joinPath(dirs.logDir, n));
  } catch (e) { return []; }
}

/**
 * Einmalige Übernahme des gerätelokalen Arbeitsordners nach iCloud.
 * Kopiert wird nur, was in iCloud fehlt oder dort älter ist als lokal —
 * damit gewinnt der zuletzt bearbeitete Stand und veraltete iCloud-Reste
 * werden ersetzt. Ein Marker sorgt dafür, dass das genau einmal läuft.
 */
async function migrateWorkspaceToICloud(d) {
  if (!ICLOUD_ACTIVE) return 0;
  const marker = localFm.joinPath(localFm.documentsDirectory(), `${APP}.icloud-migriert`);
  if (localFm.fileExists(marker)) return 0;
  const localRoot = localFm.joinPath(localFm.documentsDirectory(), APP);
  if (!localFm.fileExists(localRoot) || !localFm.isDirectory(localRoot)) {
    localFm.writeString(marker, new Date().toISOString());
    return 0;
  }
  // Zweitgeraet: liegt in iCloud bereits ein neuerer Bestand als lokal, ist
  // nichts zu uebernehmen. Ohne diese Abkuerzung wuerde das zweite Geraet den
  // kompletten Ordner durchlaufen, bevor die Oberflaeche erscheint.
  try {
    const localIni = localFm.joinPath(localRoot, "com_fm.ini");
    if (fm.fileExists(d.ini) && localFm.fileExists(localIni)) {
      const cloudDate = fm.modificationDate(d.ini);
      const localDate = localFm.modificationDate(localIni);
      if (cloudDate && localDate && cloudDate.getTime() >= localDate.getTime()) {
        localFm.writeString(marker, new Date().toISOString());
        logLine("uebersprungen, iCloud-Bestand ist aktuell", "migration");
        return 0;
      }
    }
  } catch (e) { /* im Zweifel regulaer migrieren */ }
  let copied = 0;
  const walk = async (relative) => {
    const from = relative ? localFm.joinPath(localRoot, relative) : localRoot;
    let names;
    try { names = localFm.listContents(from); } catch (e) { return; }
    for (const name of names) {
      if (name.startsWith(".")) continue;
      const rel = relative ? `${relative}/${name}` : name;
      const src = localFm.joinPath(localRoot, rel);
      const dest = fm.joinPath(d.root, rel);
      if (localFm.isDirectory(src)) {
        if (!fm.fileExists(dest)) fm.createDirectory(dest, true);
        await walk(rel);
        continue;
      }
      if (fm.fileExists(dest)) {
        // PDF-Bestand und Exporte nur ergaenzen, nie vergleichen: ein
        // Datumsvergleich wuerde jede Datei aus iCloud herunterladen.
        if (rel.startsWith("reports/") || rel.startsWith("export/")) continue;
        let keep = false;
        try {
          const a = localFm.modificationDate(src);
          const b = fm.modificationDate(dest);
          keep = !!(a && b && b.getTime() >= a.getTime());
        } catch (e) { keep = false; }
        if (keep) continue;
        try { fm.remove(dest); } catch (e) { continue; }
      }
      try {
        fm.copy(src, dest);
        copied++;
      } catch (e) { /* einzelne Datei überspringen, Rest weiterkopieren */ }
    }
  };
  await walk("");
  localFm.writeString(marker, new Date().toISOString());
  logLine(`${copied} Datei(en) aus dem lokalen Ordner uebernommen`, "migration");
  return copied;
}

/**
 * iCloud lagert selten genutzte Dateien aus. Die Konfigurations- und
 * Cache-Dateien werden synchron gelesen, deshalb müssen sie vor dem ersten
 * Zugriff lokal vorliegen — sonst greift der Fallback auf Standardwerte und
 * der nächste Speichervorgang würde den iCloud-Stand überschreiben.
 */
async function ensureCoreFilesDownloaded(d) {
  if (!ICLOUD_ACTIVE) return;
  for (const p of [d.ini, d.categories, d.postboxSettings, d.cache, d.taxCache, d.tradeCache]) {
    try {
      if (fm.fileExists(p) && !fm.isFileDownloaded(p)) {
        logLine(`lade ${p.split("/").pop()} aus iCloud`, "sync");
        await fm.downloadFileFromiCloud(p);
      }
    } catch (e) {
      logLine(`Download fehlgeschlagen: ${p.split("/").pop()} · ${e.message || e}`, "sync");
    }
  }
}

async function setupDirs() {
  const root = fm.joinPath(fm.documentsDirectory(), APP);
  const d = {
    root,
    reports: fm.joinPath(root, "reports"),
    exportDir: fm.joinPath(root, "export"),
    lib: fm.joinPath(root, "lib"),
    ini: fm.joinPath(root, "com_fm.ini"),
    categories: fm.joinPath(root, "categories.json"),
    postboxSettings: fm.joinPath(root, "Comdirect-postbox-settings.json"),
    cache: fm.joinPath(root, "bookings-cache.json"),
    taxCache: fm.joinPath(root, "steuer-cache.json"),
    tradeCache: fm.joinPath(root, "wertpapier-cache.json"),
      backupDir: fm.joinPath(root, "backup"),
    logDir: fm.joinPath(root, "logs"),
    // Pro Geraet eine eigene Logdatei: sonst wuerden iPhone und iPad
    // dieselbe Datei ueberschreiben.
    log: fm.joinPath(fm.joinPath(root, "logs"), `${deviceSlug()}.log`),
  };
  for (const p of [d.root, d.reports, d.exportDir, d.lib, d.backupDir, d.logDir]) {
    if (!fm.fileExists(p)) fm.createDirectory(p, true);
  }
  // Muss vor jedem Lesezugriff laufen: erst den Altbestand übernehmen,
  // dann sicherstellen, dass die iCloud-Dateien auch heruntergeladen sind.
  await migrateWorkspaceToICloud(d);
  await ensureCoreFilesDownloaded(d);
  migrateLegacyTradeData(d);
  let saved = fm.fileExists(d.ini) ? fm.readString(d.ini) : null;
  // Alte Keychain-Kopie nur verwenden, wenn noch keine INI existiert.
  try {
    if (!saved && Keychain.contains(LEGACY_CONFIG_KEY)) saved = Keychain.get(LEGACY_CONFIG_KEY);
  } catch (e) { saved = null; }
  if (!saved) saved = migrateLegacyConfig(d);
  saved = normalizeWorkspaceConfig(saved);
  saved = migrateCategoryConfig(d, saved);
  fm.writeString(d.ini, saved);
  writePostboxSettings(d, saved);
  return d;
}

/** Übernimmt vorhandene PDFs des bisherigen eigenständigen Wertpapier-Managers. */
function migrateLegacyTradeData(d) {
  try {
    // Altbestand lag immer gerätelokal.
    const legacyRoot = localFm.joinPath(localFm.documentsDirectory(), "wertpapier-manager");
    const legacyReports = localFm.joinPath(legacyRoot, "abrechnungen");
    if (!localFm.fileExists(legacyReports) || !localFm.isDirectory(legacyReports)) return;
    for (const relative of listPdfs(legacyReports)) {
      const name = relative.split("/").pop();
      if (!/wertpapierabrechnung.*\.pdf$/i.test(name)) continue;
      const sourcePath = localFm.joinPath(legacyReports, relative);
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
    const old = localFm.joinPath(localFm.joinPath(localFm.documentsDirectory(), "finanzmanager"), "com_fm.ini");
    if (localFm.fileExists(old)) {
      const content = localFm.readString(old);
      if (content && content.trim()) text = content;
    }
  } catch (e) { /* Standard verwenden */ }
  try {
    const oldTax = localFm.joinPath(localFm.joinPath(localFm.documentsDirectory(), "jahressteuer-manager"), "settings.json");
    if (localFm.fileExists(oldTax)) {
      const s = JSON.parse(localFm.readString(oldTax)) || {};
      const lines = [];
      if (s.appearance) lines.push(`darstellung : ${s.appearance}`);
      if (lines.length) text = lines.join("\n") + "\n" + text;
    }
  } catch (e) { /* Standard verwenden */ }
  try {
    const legacyJson = localFm.joinPath(localFm.documentsDirectory(), "comdirect-postbox-settings.json");
    const jsonPath = [d.postboxSettings, legacyJson].find((p) => p && managerForPath(p).fileExists(p));
    if (jsonPath) {
      const s = JSON.parse(managerForPath(jsonPath).readString(jsonPath)) || {};
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
  } catch (e) {
    logLine(`Postbox-Einstellungen nicht schreibbar: ${e.message || e}`, "config");
  }
}

function readBookingsCache(d, sourceRef) {
  try {
    if (!fm.fileExists(d.cache)) return null;
    const data = JSON.parse(fm.readString(d.cache));
    if (data.sourceRef !== sourceRef || !Array.isArray(data.bookings)) return null;
    // Nach einer Aenderung der Buchungsauswertung ist der Bestand ungueltig.
    if (Number(data.parserVersion || 0) !== PARSER_VERSION.report) {
      logLine("Buchungscache verworfen: Auswertung wurde geändert", "cache");
      return null;
    }
    return data;
  } catch (e) {
    logLine(`Buchungscache nicht lesbar: ${e.message || e}`, "cache");
    return null;
  }
}

function writeBookingsCache(d, sourceRef, list, files) {
  if (!list || !list.length) return;
  fm.writeString(d.cache, JSON.stringify({
    version: 2,
    parserVersion: PARSER_VERSION.report,
    savedAt: new Date().toISOString(),
    sourceRef,
    bookings: ensureBookingIds(list),
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
  "steuermuster", "steuerjahr", "steueransicht",
  // Wertpapierabrechnungen
  "wertpapiermuster", "ertragsmuster", "wertpapierjahr", "wertpapieransicht",
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
    taxYear: null,
    taxTab: "overview",
    tradePattern: DEFAULTS.tradePattern,
    incomePattern: DEFAULTS.incomePattern,
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
    if (key === "ertragsmuster") { settings.incomePattern = val; continue; }
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
    // Frueherer Referenzwert. Wird jetzt aus der Bescheinigung hergeleitet
    // und beim Schreiben der INI nicht mehr erzeugt.
    if (key === "pauschbetrag") continue;
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


function normalizeCategoryList(list) {
  const out = [];
  const seen = new Set();
  for (const raw of Array.isArray(list) ? list : []) {
    const name = String(raw && raw.name || "").trim();
    if (!name || seen.has(name.toLowerCase())) continue;
    // Der fruehere Einzel-Editor nannte die Liste "keywords", der Manager
    // verwendet "words". Beide Varianten werden verlustfrei eingelesen.
    // Falls beide Felder vorkommen, ist "keywords" die zuletzt vom
    // Einzel-Editor bearbeitete Fassung und hat deshalb Vorrang.
    const sourceWords = Array.isArray(raw.keywords)
      ? raw.keywords
      : (Array.isArray(raw.words) ? raw.words : []);
    const words = sourceWords
      .map((x) => String(x || "").trim().toLowerCase())
      .filter(Boolean);
    seen.add(name.toLowerCase());
    out.push({ name, words: Array.from(new Set(words)) });
  }
  return out.sort((a, b) => a.name.localeCompare(b.name, "de-DE", { sensitivity: "base" }));
}

function extractLegacyCategories(text) {
  const out = [];
  for (const raw of String(text || "").split("\n")) {
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
  return normalizeCategoryList(out);
}

function stripLegacyCategories(text) {
  const kept = [];
  for (const raw of String(text || "").split("\n")) {
    const line = raw.replace(/\r$/, "");
    const trimmed = line.trim();
    const idx = line.indexOf(" : ");
    const key = idx >= 0 ? line.slice(0, idx).trim() : "";
    const isLegacyCategory = idx >= 0 && trimmed && !trimmed.startsWith("#")
      && SETTING_KEYS.indexOf(key.toLowerCase()) < 0;
    if (!isLegacyCategory) kept.push(line);
  }
  return kept.join("\n").replace(/\n{3,}/g, "\n\n").trimEnd() + "\n";
}

function defaultCategoryData() {
  return {
    version: 1,
    categories: normalizeCategoryList(DEFAULT_CATEGORY_GROUPS),
    assignments: {},
  };
}

function normalizeCategoryData(value) {
  const raw = value && typeof value === "object" ? value : {};
  const hasCategoryArray = Array.isArray(raw.categories);
  const categories = normalizeCategoryList(raw.categories);
  const effectiveCategories = hasCategoryArray ? categories : normalizeCategoryList(DEFAULT_CATEGORY_GROUPS);
  const valid = new Set(effectiveCategories.map((g) => g.name));
  const assignments = {};
  const sourceAssignments = raw.assignments && typeof raw.assignments === "object" ? raw.assignments : {};
  for (const id of Object.keys(sourceAssignments)) {
    const name = String(sourceAssignments[id] || "");
    if (valid.has(name)) assignments[id] = name;
  }
  return {
    version: 1,
    categories: effectiveCategories,
    assignments,
  };
}

// Aenderungsdatum der categories.json beim letzten erfolgreichen Lesen.
// Damit laesst sich erkennen, ob das andere Geraet zwischenzeitlich
// gespeichert hat.
let categoryFileStamp = 0;
// true, wenn die Datei zwar existiert, aber nicht gelesen werden konnte
// (typisch: iCloud-Platzhalter). Dann darf nicht geschrieben werden.
let CATEGORY_FILE_UNREADABLE = false;

function categoryFileDate(d) {
  try {
    if (!d || !d.categories || !fm.fileExists(d.categories)) return 0;
    const dt = fm.modificationDate(d.categories);
    return dt ? dt.getTime() : 0;
  } catch (e) { return 0; }
}

function readCategoryData(d) {
  try {
    if (!d || !d.categories || !fm.fileExists(d.categories)) {
      CATEGORY_FILE_UNREADABLE = false;
      categoryFileStamp = 0;
      return defaultCategoryData();
    }
    if (ICLOUD_ACTIVE && !fm.isFileDownloaded(d.categories)) {
      // Noch nicht materialisiert. Bewusst NICHT auf die Standardkategorien
      // zurueckfallen, sonst wuerde der naechste Speichervorgang den Stand
      // des anderen Geraets loeschen. Download anstossen und alten
      // Speicherstand behalten.
      CATEGORY_FILE_UNREADABLE = true;
      logLine("categories.json noch nicht geladen, Speichern gesperrt", "sync");
      try { fm.downloadFileFromiCloud(d.categories).catch(() => {}); } catch (e) { /* egal */ }
      return categoryData || defaultCategoryData();
    }
    const value = normalizeCategoryData(JSON.parse(fm.readString(d.categories)));
    CATEGORY_FILE_UNREADABLE = false;
    categoryFileStamp = categoryFileDate(d);
    return value;
  } catch (e) {
    CATEGORY_FILE_UNREADABLE = true;
    logLine(`categories.json nicht lesbar: ${e.message || e}`, "kategorien");
    return categoryData || defaultCategoryData();
  }
}

/**
 * Fuehrt den Stand des anderen Geraets mit dem eigenen zusammen.
 * Kategorien werden ueber den Namen vereinigt, bei Gleichstand gewinnen die
 * eigenen Schluesselwoerter. Manuelle Zuordnungen werden vereinigt, eigene
 * Zuordnungen ueberschreiben die entfernten.
 */
function mergeCategoryData(remote, mine) {
  const byName = new Map();
  normalizeCategoryList(remote && remote.categories).forEach((g) => byName.set(g.name, g.words.slice()));
  normalizeCategoryList(mine && mine.categories).forEach((g) => byName.set(g.name, g.words.slice()));
  const categories = Array.from(byName, (entry) => ({ name: entry[0], words: entry[1] }));
  const assignments = Object.assign(
    {},
    (remote && remote.assignments) || {},
    (mine && mine.assignments) || {},
  );
  return normalizeCategoryData({ version: 1, categories, assignments });
}

/** Uebernimmt einen zwischenzeitlich eingetroffenen Stand des anderen Geraets. */
function syncCategoryDataIfChanged(d) {
  const diskStamp = categoryFileDate(d);
  if (!diskStamp || diskStamp === categoryFileStamp) return false;
  logLine("neuerer Stand vom anderen Geraet uebernommen", "kategorien");
  categoryData = readCategoryData(d);
  if (cfg) cfg.groups = categoryMap(categoryData);
  return true;
}

function writeCategoryData(d, data) {
  let value = normalizeCategoryData(data);
  if (CATEGORY_FILE_UNREADABLE) {
    throw new Error(
      "categories.json ist noch nicht aus iCloud geladen. Speichern abgebrochen, "
      + "damit der Stand des anderen Geraets nicht ueberschrieben wird.",
    );
  }
  const diskStamp = categoryFileDate(d);
  if (diskStamp && categoryFileStamp && diskStamp > categoryFileStamp) {
    // Das andere Geraet hat seit dem Laden gespeichert: zusammenfuehren
    // statt ueberschreiben.
    let remote = null;
    try {
      remote = normalizeCategoryData(JSON.parse(fm.readString(d.categories)));
    } catch (e) {
      logLine(`Fremdstand nicht lesbar, Merge übersprungen: ${e.message || e}`, "kategorien");
      remote = null;
    }
    if (remote) {
      value = mergeCategoryData(remote, value);
      logLine(`Fremdaenderung erkannt, zusammengefuehrt auf ${value.categories.length} Kategorien und ${Object.keys(value.assignments).length} Zuordnungen`, "kategorien");
    }
  }
  fm.writeString(d.categories, JSON.stringify(value, null, 2) + "\n");
  categoryFileStamp = categoryFileDate(d);
  logLine(`gespeichert: ${value.categories.length} Kategorien, ${Object.keys(value.assignments).length} manuelle Zuordnungen`, "kategorien");
  categoryData = value;
  if (cfg) cfg.groups = categoryMap(value);
  return value;
}

function migrateCategoryConfig(d, iniText) {
  const legacy = extractLegacyCategories(iniText);
  if (legacy.length) {
    let assignments = {};
    try {
      if (fm.fileExists(d.categories)) assignments = readCategoryData(d).assignments || {};
    } catch (e) { assignments = {}; }
    fm.writeString(d.categories, JSON.stringify(normalizeCategoryData({
      version: 1,
      categories: legacy,
      assignments,
    }), null, 2));
  } else if (!fm.fileExists(d.categories)) {
    fm.writeString(d.categories, JSON.stringify(defaultCategoryData(), null, 2));
  }
  return stripLegacyCategories(iniText);
}

function categoryMap(data) {
  const groups = new Map();
  const normalized = normalizeCategoryData(data);
  normalized.categories.forEach((g) => groups.set(g.name, g.words));
  groups.set("Einnahmen div.", "+");
  groups.set("Ausgaben div.", "-");
  return groups;
}

function loadRuntimeConfig(d) {
  const settings = readIni(readConfig(d));
  categoryData = readCategoryData(d);
  settings.groups = categoryMap(categoryData);
  return settings;
}

// Kompatibilitätsnamen für den bisherigen Kategorien-Editor.
function iniGroups(d) {
  // Der Editor rendert haeufig neu: dabei einen neueren Stand des anderen
  // Geraets automatisch uebernehmen.
  syncCategoryDataIfChanged(d);
  return readCategoryData(d).categories.map((g) => ({ name: g.name, words: g.words.slice() }));
}

function writeIniGroups(d, list) {
  const current = categoryData || readCategoryData(d);
  current.categories = normalizeCategoryList(list);
  writeCategoryData(d, current);
}

function bookingFingerprint(fileName, date, typ, name, value) {
  const raw = [fileName, date, typ, name, value].map((x) => String(x || "")).join("|");
  let h = 2166136261;
  for (let i = 0; i < raw.length; i++) {
    h ^= raw.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0).toString(36);
}

function ensureBookingIds(list) {
  const counts = {};
  for (const b of Array.isArray(list) ? list : []) {
    const base = bookingFingerprint(b.file, b.date, b.typ, b.name, b.value);
    counts[base] = (counts[base] || 0) + 1;
    if (!b.id) b.id = `${base}-${counts[base]}`;
  }
  return list;
}

function automaticCategoryForBooking(b) {
  return findClass(cfg.groups, `${b.typ || ""} / ${b.name || ""}`, b.value) || "unbekannt";
}

function refreshBookingCategories() {
  ensureBookingIds(bookings);
  const valid = new Set(Array.from(cfg.groups.keys()));
  const assignments = categoryData && categoryData.assignments ? categoryData.assignments : {};
  for (const b of bookings) {
    const manual = assignments[b.id];
    b.group = manual && valid.has(manual) ? manual : automaticCategoryForBooking(b);
  }
}

function persistCategoryAssignments(message) {
  writeCategoryData(dirs, categoryData);
  refreshBookingCategories();
  if (bookings.length) writeBookingsCache(dirs, cfg.path, bookings, fileInfos);
  BOOKING_SELECTED.clear();
  BOOKING_SELECT_MODE = false;
  VIEW = { name: "main" };
  flash(message);
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
function parseReport(fileName, pages, groups, out, assignments) {
  let saldo = 0;
  let stop = false;
  let item = null;
  let delta = null;
  const occurrences = {};

  const commit = () => {
    if (!item) return;
    const base = bookingFingerprint(fileName, item.date, item.typ, item.name, item.value);
    occurrences[base] = (occurrences[base] || 0) + 1;
    const id = `${base}-${occurrences[base]}`;
    const haystack = item.typ + " / " + item.name;
    const automatic = findClass(groups, haystack, item.value) || "unbekannt";
    const manual = assignments && assignments[id];
    const group = manual && groups.has(manual) ? manual : automatic;
    const [dd, mm, yyyy] = item.date.split(".");
    out.push({
      id,
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
          commit();
          delta = Math.abs(saldo - str2float(m.groups.value));
          stop = true;
          break;
        }
      }
    }
    if (stop) break;
  }
  commit();
  return { file: fileName, delta };
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
  for (const b of calculationRows(rows)) {
    if (!byGroup.has(b.group)) byGroup.set(b.group, []);
    byGroup.get(b.group).push(b);
  }

  const period = month ? `${year}-${String(month).padStart(2, "0")}` : String(year);
  let overview = "\uFEFFZeitraum;Gruppenname;Anzahl Buchungen in der Gruppe;Saldo\n";
  let detail = "\uFEFFBuchungsdatum;Gruppenname;Vorgang;Buchungstext;Betrag\n";
  let saldo = 0;
  for (const b of rows) {
    detail += `${b.date};${csvEscape(b.group)};${csvEscape(b.typ)};${csvEscape(b.name)};${b.value}\n`;
  }
  for (const [group, items] of byGroup) {
    let sum = 0;
    for (const b of items) {
      sum += b.amount;
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
let categoryData = null;     // categories.json: Regeln + manuelle Buchungszuordnungen
let CATEGORY_EDITOR_SELECTED = -1;
let CATEGORY_EDITOR_BACKUP_CREATED = false;
let BOOKING_QUERY = "";
let BOOKING_COLLAPSED_MONTHS = new Set(); // eingeklappte Monatsgruppen in der Buchungsliste
let CATEGORY_ASSIGN_QUERY = ""; // Suche in „Kategorie ändern“ / Schlüsselwort-Zuordnung
let BOOKING_SELECT_MODE = false;
let BOOKING_SELECTED = new Set();

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
  // Volle Breite, nicht die linke Spalte einer Datenzeile: entsprechend mehr
  // Zeichen je Zeile. Ohne diese Skalierung entstehen auf iPad und Mac
  // grosse Leerflaechen unter kurzen Hinweisen.
  const perLine = Math.max(34, Math.round(screenWidth() / 7));
  const lines = String(text).split("\n")
    .reduce((sum, line) => sum + Math.max(1, Math.ceil(line.length / perLine)), 0);
  const r = newRow(Math.max(34, 20 + lines * 17));
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
/**
 * Zeichen, die in der linken Spalte einer Datenzeile auf eine Zeile passen.
 * Die Spalte belegt rund 63 % der Breite, die Meta-Schrift ist etwa 7 Punkt
 * breit je Zeichen. Aus iPhone (390 pt) werden so 34 Zeichen, aus einem
 * iPad Pro im Querformat (1366 pt) rund 120 — ohne diese Skalierung waeren
 * Zeilen auf grossen Geraeten unnoetig hoch.
 */
function metaCharsPerLine() {
  return Math.max(28, Math.round(screenWidth() * 0.63 / 7));
}

/**
 * Zeilenhoehe aus der Laenge des Untertitels. UITable bricht lange Untertitel
 * um, waechst dabei aber nicht mit — ohne Anpassung ueberlappen die Zeilen.
 */
function metaRowHeight(subtitle, base = 52) {
  const perLine = metaCharsPerLine();
  const lines = String(subtitle || "").split("\n")
    .reduce((sum, line) => sum + Math.max(1, Math.ceil(line.length / perLine)), 0);
  return Math.max(base, 30 + lines * 18);
}

/**
 * Kuerzt lange Bezeichnungen. Ohne Angabe richtet sich die Grenze nach der
 * Geraetebreite, damit auf iPad und Mac nicht unnoetig abgeschnitten wird.
 */
function shortLabel(text, max) {
  const value = clean(text);
  const limit = max || Math.max(28, Math.round(metaCharsPerLine() * 0.9));
  return value.length > limit ? value.slice(0, limit - 1).trim() + "…" : value;
}

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

// Umbuchungen verschieben Geld nur zwischen eigenen Konten und würden
// Einnahmen/Ausgaben sowie Salden sonst doppelt beeinflussen. Sie bleiben
// in der Buchungsliste sichtbar, werden aber aus allen Finanzberechnungen
// herausgenommen.
function isCalculationBooking(b) {
  return String(b && b.group || "").trim().toLocaleLowerCase("de-DE") !== "umbuchung";
}

function calculationRows(list) {
  return (Array.isArray(list) ? list : []).filter(isCalculationBooking);
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
  for (const b of calculationRows(list)) {
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
    if (b.year !== year || !isCalculationBooking(b)) continue;
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

  const rows = bookings.filter((b) => b.year === year && isCalculationBooking(b));
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
    if (b.year !== year || !isCalculationBooking(b) || b.amount >= 0 || !map[b.group]) continue;
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

/**
 * Groesse, Aenderungsdatum und Parserversion. Die Version sorgt dafuer, dass
 * eine geaenderte Auswertungsregel den Zwischenspeicher selbst entwertet —
 * ohne sie bliebe ein falsch gelesener Wert bis zum manuellen Neuaufbau stehen.
 */
function fileSignature(path, scope) {
  const m = managerForPath(path);
  const version = PARSER_VERSION[scope] || 0;
  try {
    const mod = m.modificationDate(path);
    return `v${version}:${m.fileSize(path)}:${mod ? mod.getTime() : 0}`;
  } catch (e) {
    logLine(`Signatur nicht lesbar: ${String(path).split("/").pop()} · ${e.message || e}`, "cache");
    return "";
  }
}

/** Wird die Datei als Jahressteuerbescheinigung gelesen? */
function isTaxFile(relative) {
  if (isSimulationFile(relative)) return false;
  const pattern = String(cfg && cfg.taxPattern || "").trim().toLocaleLowerCase("de");
  if (!pattern) return false;
  return String(relative).split("/").pop().toLocaleLowerCase("de").includes(pattern);
}

/**
 * MiFID-II-Kosteninformationen sind reine Kostensimulationen zu einem noch
 * nicht ausgefuehrten Auftrag. Sie enthalten Begriffe wie "Wertpapierkauf"
 * und Eurobetraege, gehoeren aber in keine Auswertung — sonst werden
 * Schaetzwerte als echte Umsaetze gezaehlt.
 */
function isSimulationFile(relative) {
  const name = String(relative).split("/").pop().toLocaleLowerCase("de");
  return name.includes("kosteninformation") || name.includes("kostensimulation");
}

/** Ertragsgutschriften: Dividenden und Ausschuettungen, keine Order. */
function isIncomeFile(relative) {
  if (isSimulationFile(relative)) return false;
  const pattern = String(cfg && cfg.incomePattern || "").trim().toLocaleLowerCase("de");
  if (!pattern) return false;
  return String(relative).split("/").pop().toLocaleLowerCase("de").includes(pattern);
}

function isTradeFile(relative) {
  if (isSimulationFile(relative)) return false;
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
  // Noch nicht ausgeschoepfter Freistellungsauftrag. Genutzt plus verfuegbar
  // ergibt den fuer dieses Depot geltenden Pauschbetrag.
  r.allowanceAvailable = amountOnLine(lines, ["nicht ausgeschöpfter freistellungsauftrag"])
    ?? amountOnLine(lines, ["verfügbarer freistellungsauftrag"])
    ?? amountOnLine(lines, ["freistellungsauftrag"]);
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

/** Gesetzlicher Sparer-Pauschbetrag je Person nach Veranlagungsjahr. */
function statutoryAllowance(y) {
  return Number(y) >= 2023 ? 1000 : 801;
}

/**
 * Pauschbetrag des Jahres, ohne Einstellung. Bevorzugt wird die Summe aus
 * genutztem und noch verfuegbarem Freistellungsauftrag der Bescheinigung.
 * Fehlt das Feld, gilt der gesetzliche Betrag — liegt die Nutzung darueber,
 * wird von Zusammenveranlagung ausgegangen und verdoppelt.
 */
function allowanceLimit(y) {
  let derived = 0;
  for (const it of taxYearItems(y)) {
    const used = Number(it.allowance);
    const open = Number(it.allowanceAvailable);
    if (Number.isFinite(used) && Number.isFinite(open) && used + open > 0) {
      derived = Math.max(derived, used + open);
    }
  }
  if (derived > 0) return derived;
  const base = statutoryAllowance(y);
  const used = taxSum(y, "allowance");
  return used > base ? base * 2 : base;
}

function allowanceRate(y) {
  const lim = Math.max(1, allowanceLimit(y));
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
    `von ${taxEuro(allowanceLimit(y))} · ${percent(allowanceRate(y), 0)} genutzt`, D.warn);

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
      height: metaRowHeight(`${it.date || "ohne Datum"} · ${it.provider} · ${it.warning ? "⚠︎ prüfen" : "✓ ausgewertet"}`, 62),
      title: shortLabel(String(it.file).split("/").pop()),
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

/**
 * Ertragsgutschrift: Dividende oder Ausschuettung. Kein Kauf und kein
 * Verkauf, deshalb ein eigener Belegtyp "Ertrag". Betraege stehen haeufig in
 * Fremdwaehrung, der EUR-Gegenwert folgt hinter dem Devisenkurs.
 */
function parseIncomeDocument(pages, filename) {
  const lines = (Array.isArray(pages) ? pages : []).flat().map(clean).filter(Boolean);
  const all = lines.join("\n");
  const dateM = all.match(/zahlbar ab\s*(\d{2}\.\d{2}\.\d{4})/i)
    || all.match(/Zahltag\s*:?\s*(\d{2}\.\d{2}\.\d{4})/i)
    || all.match(/(\d{2}\.\d{2}\.\d{4})/);
  const valutaM = all.match(/Valuta\s*(\d{2}\.\d{2}\.\d{4})/i)
    || all.match(/Valuta\s+Zu Ihren[\s\S]{0,80}?(\d{2}\.\d{2}\.\d{4})/i);
  const isinM = all.match(/\b([A-Z]{2}[A-Z0-9]{9}\d)\b/);
  const wknM = all.match(/W(?:PKNR|KN)\s*\/\s*ISIN[\s\S]{0,200}?\b([A-Z0-9]{6})\b/i);
  const qtyM = all.match(/\bSTK\.?\s*([\d.]+,\d+)/i)
    || all.match(/(\d[\d.]*,\d+)\s*St(?:\u00fc|ue)ck/i);
  const businessM = all.match(/Rechnungsnummer\s*:?\s*([A-Z0-9]+)/i);
  const grossFxM = all.match(/Bruttobetrag\s*:?\s*([A-Z]{3})\s*([\d.]+,\d{2})/i);
  const whM = all.match(/([\d.]+,\d+)\s*%\s*Quellensteuer\s*([A-Z]{3})\s*([\d.]+,\d{2})/i);
  const payoutM = all.match(/([A-Z]{3})\s*([\d.]+,\d{4,})\s*Aussch(?:\u00fc|ue)ttung pro St(?:\u00fc|ue)ck/i);
  const fxM = all.match(/Devisenkurs\s*:?\s*([A-Z]{3}\/[A-Z]{3})\s*([\d.]+,\d+)/i);
  const eurM = all.match(/Devisenkurs[\s\S]{0,80}?EUR\s+([\d.]+,\d{2})/i);
  // Reine EUR-Gutschriften haben keine Devisenzeile.
  let gross = tradeEuroNear(all, "Zu Ihren Gunsten vor Steuern");
  if (gross == null && eurM) gross = tradeParseNumber(eurM[1]);
  if (gross == null) gross = tradeEuroNear(all, "Ausmachender Betrag");
  if (gross != null) gross = Math.abs(gross);
  const net = tradeEuroNear(all, "Zu Ihren Gunsten nach Steuern");
  const wkn = wknM ? wknM[1] : "";
  const isin = isinM ? isinM[1] : "";
  const namePart = (code) => {
    if (!code) return "";
    const m = all.match(new RegExp(code.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + "\\s+([^\\n]+)"));
    return m ? clean(m[1]) : "";
  };
  const securityName = clean([namePart(wkn), namePart(isin)].filter(Boolean).join(" "))
    .replace(/\s*Emissionsland.*$/i, "")
    .trim();
  const withholding = whM ? tradeParseNumber(whM[3]) : null;
  const fileYear = (String(filename).match(/(20\d{2})/) || [])[1];
  const warnings = [];
  if (!dateM) warnings.push("Zahltag nicht erkannt");
  if (!isinM && !wknM) warnings.push("WKN/ISIN nicht erkannt");
  if (!qtyM) warnings.push("Stückzahl nicht erkannt");
  if (gross == null) warnings.push("Gutschriftsbetrag nicht erkannt");
  return {
    id: filename, file: filename,
    provider: /comdirect/i.test(all) ? "comdirect" : (/commerzbank/i.test(all) ? "Commerzbank" : "Unbekannt"),
    tradeType: "Ertrag",
    year: dateM ? Number(dateM[1].slice(-4)) : (fileYear ? Number(fileYear) : null),
    month: dateM ? Number(dateM[1].slice(3, 5)) : null,
    tradeDate: dateM ? dateM[1] : "", tradeDateISO: dateM ? tradeDateIso(dateM[1]) : "",
    settlementDate: valutaM ? valutaM[1] : "",
    venue: "",
    businessNo: businessM ? clean(businessM[1]) : "",
    securityName, wkn, isin,
    quantity: qtyM ? tradeParseNumber(qtyM[1]) : null,
    // Ausschuettung pro Stueck in Belegwaehrung, nicht in EUR.
    price: payoutM ? tradeParseNumber(payoutM[2]) : null,
    marketValue: null,
    provision: null, totalFees: 0,
    grossAmount: gross, netAmount: net != null ? Math.abs(net) : null,
    // Fremdwaehrung dokumentieren, damit die EUR-Summe nachvollziehbar bleibt.
    currency: grossFxM ? grossFxM[1] : "EUR",
    grossForeign: grossFxM ? tradeParseNumber(grossFxM[2]) : null,
    fxPair: fxM ? fxM[1] : "", fxRate: fxM ? tradeParseNumber(fxM[2]) : null,
    withholdingRate: whM ? tradeParseNumber(whM[1]) : null,
    withholdingForeign: withholding,
    taxBase: null, capitalTax: null, soli: null, church: null, taxes: 0,
    parsedAt: new Date().toISOString(), warning: warnings.join(" · "),
  };
}

function parseTradeDocument(pages, filename) {
  const probe = (Array.isArray(pages) ? pages : []).flat().map(clean).filter(Boolean).join("\n");
  if (/Ertragsgutschrift|Gutschrift f(?:\u00e4|ae)lliger Wertpapier-Ertr(?:\u00e4|ae)ge|Dividendengutschrift/i.test(probe)
    || isIncomeFile(filename)) {
    return parseIncomeDocument(pages, filename);
  }
  const lines = (Array.isArray(pages) ? pages : []).flat().map(clean).filter(Boolean);
  const all = lines.join("\n"), flat = clean(all);
  // Achtung: "verkauf" enthaelt "kauf". Jede Pruefung muss deshalb zuerst auf
  // "verkauf" testen bzw. auf der vollstaendigen Gruppe verankert sein, sonst
  // wird jeder Verkauf als Kauf gewertet.
  const typeM = all.match(/Wertpapier(kauf|verkauf)/i)
    || all.match(/\b(Verkauf|Kauf|R(?:\u00fc|ue)cknahme)\s+(?:von\s+)?(?:Investmentanteil|Wertpapier|Fondsanteil)/i);
  let textType = "";
  if (typeM) {
    textType = /^(?:verkauf|r(?:\u00fc|ue)cknahme)$/i.test(typeM[1]) ? "Verkauf" : "Kauf";
  } else if (/Zu Ihren Gunsten/i.test(all)) {
    textType = "Verkauf";
  } else if (/Zu Ihren Lasten/i.test(all)) {
    textType = "Kauf";
  }
  // comdirect benennt die PDFs als "Wertpapierabrechnung Verkauf ..." bzw.
  // "... Kauf ...". Das ist eindeutiger als der Fliesstext.
  const nameOnly = String(filename).split("/").pop();
  const fileType = /verkauf/i.test(nameOnly) ? "Verkauf" : (/kauf/i.test(nameOnly) ? "Kauf" : "");
  const tradeType = fileType || textType || "Unbekannt";
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
    || all.match(/Stk\.\s*([\d.]+,\d+)/i)
    // Rueckfall ohne Nachkommastellen. Greift nur, wenn die beiden Muster
    // oben nichts finden, und niemals auf einen Betrag mit Komma.
    || all.match(/\bSt(?:k|\u00fck)?\.?\s+(\d{1,3}(?:\.\d{3})*)(?![\d,])/i);
  // comdirect schreibt bei Sammel- und Sparplanausfuehrungen "Zum Mischkurs
  // von", bei Einzelorders "Zum Kurs von". Als Rueckfall die Zeile
  // "St. <Menge> EUR <Kurs>" direkt unter dem Nennwert.
  const priceM = all.match(/Zum\s+(?:Misch|Durchschnitts)?kurs\s+von[\s\S]{0,40}?EUR\s*([\d.]+,\d+)/i)
    || all.match(/St\.?\s*[\d.]+,\d+\s+EUR\s*([\d.]+,\d+)/i);
  const valueM = all.match(/Kurswert\s*:?\s*EUR\s*([\d.]+,\d{2})/i);
  let securityName = "";
  // Die Bezeichnung steht in zwei Zeilen, rechts daneben WKN und ISIN.
  // Beides wird abgeschnitten, die zweite Zeile angehaengt.
  const nameM = all.match(/Wertpapier-Bezeichnung(?:\s+WPKNR\/ISIN)?\s*\n([^\n]+)(?:\n([^\n]+))?/i);
  if (nameM) {
    const stripCode = (x) => clean(String(x || ""))
      .replace(/\s+[A-Z]{2}[A-Z0-9]{9}\d\s*$/, "")
      .replace(/\s+[A-Z0-9]{6}\s*$/, "")
      .trim();
    const first = stripCode(nameM[1]);
    const second = stripCode(nameM[2]);
    securityName = clean([first, second].filter(Boolean).join(" "));
  }
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
  if (!priceM) warnings.push("Kurs nicht erkannt");
  if (fileType && textType && fileType !== textType) {
    warnings.push(`Dateiname sagt ${fileType}, Belegtext sagt ${textType}`);
  }
  if (tradeType === "Unbekannt") warnings.push("Kauf oder Verkauf nicht erkannt");
  // Plausibilitaet: Menge x Kurs muss den Kurswert ergeben. Rundung der
  // Bank auf zwei Stellen zulassen.
  const qtyVal = qtyM ? tradeParseNumber(qtyM[1]) : null;
  const priceVal = priceM ? tradeParseNumber(priceM[1]) : null;
  const valueVal = valueM ? tradeParseNumber(valueM[1]) : null;
  if (qtyVal && priceVal && valueVal && Math.abs(qtyVal * priceVal - valueVal) > 0.05) {
    warnings.push("Menge x Kurs weicht vom Kurswert ab");
  }
  // Kurswert plus eigene Entgelte muss der Belastung entsprechen.
  if (valueVal && gross != null && Math.abs(Math.abs(gross) - (valueVal + totalFees)) > 0.05) {
    warnings.push("Kurswert plus Entgelte weicht vom Rechnungsbetrag ab");
  }
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
function tradeIncomes(y) { return tradeYearItems(y).filter((x) => x.tradeType === "Ertrag"); }
/** Alle echten Orders, also ohne Ertragsgutschriften. */
function tradeOrders() { return tradeItems.filter((x) => x.tradeType !== "Ertrag"); }
function tradeIncomeSum(y) {
  return tradeIncomes(y).reduce((s, x) => s + Math.abs(tradeAmount(x)), 0);
}
function tradeAmount(x) {
  if (Number.isFinite(Number(x.netAmount))) return Number(x.netAmount);
  if (Number.isFinite(Number(x.grossAmount))) return Number(x.grossAmount);
  return x.tradeType === "Kauf" ? -Math.abs(Number(x.marketValue) || 0) : Math.abs(Number(x.marketValue) || 0);
}
function tradeInvested(y) { return tradeBuys(y).reduce((s, x) => s + Math.abs(tradeAmount(x)), 0); }
function tradeProceeds(y) { return tradeSells(y).reduce((s, x) => s + Math.abs(tradeAmount(x)), 0); }
function tradeCashflow(y) { return tradeYearItems(y).reduce((s, x) => s + tradeAmount(x), 0); }
/**
 * Gesamtkosten eines Belegs: bevorzugt der Rechnungsbetrag, sonst Kurswert
 * plus eigene Entgelte. Bei Kaeufen sind das die Anschaffungskosten, bei
 * Verkaeufen der Erloes vor Steuern.
 */
function tradeTotalCost(x) {
  const gross = Number(x.grossAmount);
  if (Number.isFinite(gross) && gross !== 0) return Math.abs(gross);
  return Math.abs(Number(x.marketValue) || 0) + (Number(x.totalFees) || 0);
}

/**
 * Realisierte Gewinne nach dem Fifo-Verfahren, wie es das Steuerrecht fuer
 * Wertpapiere im Girosammeldepot vorsieht: der aelteste Kauf wird zuerst
 * verrechnet. Gerechnet wird ueber alle Jahre hinweg, weil ein Verkauf sich
 * fast immer auf Kaeufe frueherer Jahre bezieht; das Ergebnis wird dem Jahr
 * des Verkaufs zugeordnet.
 *
 * Fehlt zu einem Verkauf der passende Kauf — etwa nach einem Depotuebertrag
 * oder weil die Abrechnung nicht vorliegt — wird der Rest als unvollstaendig
 * markiert statt mit Anschaffungskosten von null gerechnet.
 */
function realizedGains() {
  const byKey = new Map();
  for (const x of tradeItems) {
    if (x.tradeType !== "Kauf" && x.tradeType !== "Verkauf") continue;
    const key = x.isin || x.wkn || x.securityName || "Unbekannt";
    if (!byKey.has(key)) byKey.set(key, []);
    byKey.get(key).push(x);
  }
  const result = new Map();
  for (const entry of byKey) {
    const key = entry[0];
    const list = entry[1].slice().sort((a, b) =>
      String(a.tradeDateISO || "").localeCompare(String(b.tradeDateISO || "")));
    const lots = [];
    const years = {};
    // Frueher lief beides unter einem Flag "incomplete": eine Abrechnung ohne
    // erkannte Stueckzahl und ein Verkauf ohne passenden Kauf. Das erste ist
    // ein Parserproblem und betrifft auch reine Kaufpositionen, nur das zweite
    // ist eine Luecke im Fifo. Deshalb getrennt fuehren.
    let skippedQty = false;
    const unmatchedYears = new Set();
    for (const x of list) {
      const qty = Number(x.quantity);
      if (!Number.isFinite(qty) || qty <= 0) { skippedQty = true; continue; }
      const total = tradeTotalCost(x);
      if (x.tradeType === "Kauf") {
        lots.push({ qty, unit: total / qty });
        continue;
      }
      let rest = qty;
      let cost = 0;
      while (rest > 1e-9 && lots.length) {
        const lot = lots[0];
        const take = Math.min(rest, lot.qty);
        cost += take * lot.unit;
        lot.qty -= take;
        rest -= take;
        if (lot.qty <= 1e-9) lots.shift();
      }
      const matched = qty - rest;
      const year = Number(x.year);
      // Die Luecke gehoert in das Jahr des betroffenen Verkaufs, sonst warnt
      // jedes andere Jahr desselben Wertpapiers mit.
      if (rest > 1e-9 && Number.isFinite(year)) unmatchedYears.add(year);
      if (matched <= 1e-9) continue;
      const proceeds = total * (matched / qty);
      if (Number.isFinite(year)) years[year] = (years[year] || 0) + (proceeds - cost);
    }
    result.set(key, {
      years,
      openQty: lots.reduce((sum, l) => sum + l.qty, 0),
      openCost: lots.reduce((sum, l) => sum + l.qty * l.unit, 0),
      skippedQty,
      unmatchedYears,
    });
  }
  return result;
}

/** Realisierter Gewinn eines Jahres ueber alle Wertpapiere. */
function realizedGainYear(y, gains) {
  const map = gains || realizedGains();
  let sum = 0;
  for (const entry of map) sum += Number(entry[1].years[Number(y)] || 0);
  return sum;
}

function groupedTrades(y) {
  const map = new Map();
  for (const x of tradeYearItems(y)) {
    const key = x.isin || x.wkn || x.securityName || "Unbekannt";
    if (!map.has(key)) map.set(key, {
      key, name: x.securityName || "Unbekannt", wkn: x.wkn || "", isin: x.isin || "",
      buyQty: 0, sellQty: 0, buyValue: 0, sellValue: 0, fees: 0, trades: 0,
      income: 0, incomeCount: 0, noQty: 0,
    });
    const g = map.get(key), q = Number(x.quantity) || 0, v = Math.abs(Number(x.marketValue) || 0);
    // Ertragsgutschriften veraendern den Bestand nicht: die Stueckzahl steht
    // dort nur als Berechnungsgrundlage der Ausschuettung.
    if (x.tradeType === "Ertrag") {
      g.income += Math.abs(tradeAmount(x));
      g.incomeCount++;
      continue;
    }
    g.trades++; g.fees += Number(x.totalFees) || 0;
    // Am Beleg selbst pruefen. Ein Nettobestand von null ist kein Beweis fuer
    // eine fehlende Stueckzahl: Kauf und Verkauf koennen sich im selben Jahr
    // exakt aufheben.
    if (!(Number.isFinite(Number(x.quantity)) && Number(x.quantity) > 0)) g.noQty++;
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
    title: `Wertpapierjahr ${y}`,
    // Der Wert ist der Saldo der Rechnungsbetraege, die Positionsliste zeigt
    // Kurswerte ohne Entgelte. Beides muss sich nicht decken, also benennen.
    subtitle: `${list.length} ${list.length === 1 ? "Beleg" : "Belege"} · Saldo der Rechnungsbeträge`,
    height: 62,
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
  const realizedYear = realizedGainYear(y);
  if (Math.abs(realizedYear) > 0.005) {
    addValueRow({ title: "Realisierter Gewinn", subtitle: "Fifo über alle Jahre, dem Verkaufsjahr zugeordnet",
      value: taxEuro(realizedYear), valueColor: realizedYear >= 0 ? C.plus : C.minus });
  }
  const incomes = tradeIncomes(y);
  if (incomes.length) {
    addValueRow({ title: "Erträge", subtitle: `${incomes.length} Ertragsgutschrift${incomes.length === 1 ? "" : "en"} · Dividenden und Ausschüttungen`,
      value: taxEuro(tradeIncomeSum(y)), valueColor: C.plus });
  }
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
    title: String(y),
    subtitle: `${tradeBuys(y).length} Käufe · ${tradeSells(y).length} Verkäufe`
      + (tradeIncomes(y).length ? ` · ${tradeIncomes(y).length} Erträge` : ""),
    height: 64,
    value: taxEuro(tradeInvested(y)), valueSub: `${taxEuro(tradeSum(y, "totalFees"))} Gebühren`,
    valueColor: C.accent, onSelect: () => { setTradeYear(y); setTradeTab("overview"); },
  }));
}

function buildTradePositions() {
  const y = tradeCurrentYear(), groups = groupedTrades(y);
  if (!groups.length) { addInfo("Für dieses Jahr liegen keine erkannten Wertpapiere vor."); return; }
  const gains = realizedGains();
  const realized = realizedGainYear(y, gains);
  if (Math.abs(realized) > 0.005) {
    addValueRow({
      title: "Realisierter Gewinn", subtitle: `${y} · nach Fifo aus Kauf- und Verkaufsbelegen`,
      value: taxEuro(realized), valueColor: realized >= 0 ? C.plus : C.minus, height: 58,
    });
  }
  addStamp(`Positionen ${y} · aus Abrechnungen berechnet`);
  // Ein negativer rechnerischer Bestand ist immer ein Datenproblem: es wurde
  // mehr verkauft als gekauft, also fehlt mindestens eine Kaufabrechnung.
  let negative = 0;
  let incomplete = 0;
  let missingQty = 0;
  groups.forEach((g) => {
    const netQty = g.buyQty - g.sellQty, avg = g.buyQty > 0 ? g.buyValue / g.buyQty : null;
    const gain = gains.get(g.key);
    const gainYear = gain ? Number(gain.years[Number(y)] || 0) : 0;
    // Ein Beleg ohne erkannte Stueckzahl macht den Bestand unbrauchbar. Dann
    // darf daraus kein zweiter Vorwurf "Kaufbeleg fehlt" abgeleitet werden.
    const noQty = g.noQty > 0;
    if (noQty) missingQty++;
    const flawed = !noQty && netQty < -1e-6;
    if (flawed) negative++;
    if (gain && gain.unmatchedYears && gain.unmatchedYears.has(Number(y))) incomplete++;
    const qtyText = noQty
      ? `⚠︎ ${g.noQty} Beleg${g.noQty === 1 ? "" : "e"} ohne erkannte Stückzahl`
      : `rechnerisch ${numberDE(netQty, 3)} St.`;
    const line2 = `${g.trades} Trades · ${qtyText}`
      + (avg != null ? ` · Ø Kauf ${taxEuro(avg)}` : "")
      + (g.incomeCount ? ` · ${taxEuro(g.income)} Ertrag` : "")
      + (Math.abs(gainYear) > 0.005 ? ` · ${taxEuro(gainYear)} realisiert` : "")
      + (flawed ? " · ⚠︎ Kaufbeleg fehlt" : "");
    const line1 = `${g.wkn ? "WKN " + g.wkn : ""}${g.isin ? " · " + g.isin : ""}`;
    addValueRow({
      height: metaRowHeight(line1, 82) + metaRowHeight(line2, 0) - 52,
      title: shortLabel(g.name),
      subtitle: `${line1}\n${line2}`,
      titleColor: flawed ? C.warn : undefined,
      // Der grosse Betrag zeigt die Kurswerte der Kaeufe, sobald es welche
      // gibt. Ohne Beschriftung liest sich das wie ein Saldo und passt dann
      // scheinbar nicht zur Kopfzeile. Verkaeufe stehen deshalb daneben.
      value: taxEuro(g.buyValue || g.sellValue),
      valueSub: g.buyValue > 0
        ? (g.sellValue > 0 ? `Kurswert Käufe · ${taxEuro(g.sellValue)} Verkäufe` : "Kurswert Käufe")
        : "Kurswert Verkäufe",
      valueColor: C.accent,
    });
  });
  if (negative) {
    addInfo(`⚠︎ ${negative} Position${negative === 1 ? "" : "en"} mit negativem rechnerischem Bestand: `
      + "es wurde mehr verkauft als gekauft. Ursache ist meist ein Depotübertrag oder eine fehlende "
      + "Kaufabrechnung.", C.warn);
  }
  if (missingQty) {
    addInfo(`⚠︎ ${missingQty} Position${missingQty === 1 ? "" : "en"} mit Betrag, aber ohne erkannte `
      + "Stückzahl. Beleg im Reiter Dokumente öffnen und den Prüfhinweis lesen.", C.warn);
  }
  if (incomplete) {
    addInfo(`Bei ${incomplete} Wertpapier${incomplete === 1 ? "" : "en"} fehlt zu mindestens einem Verkauf `
      + "der passende Kauf. Der nicht zuordenbare Anteil bleibt im realisierten Gewinn unberücksichtigt, "
      + "statt mit Anschaffungskosten von null zu rechnen.", C.warn);
  }
  addInfo("Der rechnerische Bestand berücksichtigt nur vorhandene Abrechnungen, keine Depotüberträge "
    + "oder Splits. Der realisierte Gewinn folgt dem Fifo-Verfahren und ersetzt keine Steuerbescheinigung.");
}

async function showTradeDocument(it) {
  const a = new Alert();
  a.title = `${it.tradeType || "Trade"} · ${it.securityName || it.wkn || "Wertpapier"}`;
  const head = `${String(it.file).split("/").pop()}\n${it.warning ? "⚠︎ " + it.warning + "\n\n" : ""}`;
  if (it.tradeType === "Ertrag") {
    // Ertragsgutschriften haben weder Kurs noch Kurswert, dafuer haeufig
    // Fremdwaehrung und Quellensteuer.
    const cur = it.currency || "EUR";
    const foreign = Number.isFinite(Number(it.grossForeign))
      ? `${numberDE(it.grossForeign, 2)} ${cur}` : "–";
    const wh = Number.isFinite(Number(it.withholdingForeign))
      ? `${numberDE(it.withholdingForeign, 2)} ${cur}`
        + (Number.isFinite(Number(it.withholdingRate)) ? ` (${numberDE(it.withholdingRate, 2)} %)` : "")
      : "–";
    a.message = head
      + `Zahltag: ${it.tradeDate || "–"}\nValuta: ${it.settlementDate || "–"}\n`
      + `WKN / ISIN: ${it.wkn || "–"} / ${it.isin || "–"}\nStück: ${numberDE(it.quantity, 3)}\n`
      + `Pro Stück: ${Number.isFinite(Number(it.price)) ? numberDE(it.price, 6) + " " + cur : "–"}\n`
      + `Bruttobetrag: ${foreign}\nQuellensteuer: ${wh}\n`
      + `Devisenkurs: ${it.fxPair ? `${it.fxPair} ${numberDE(it.fxRate, 6)}` : "–"}\n`
      + `Gutschrift: ${taxEuro(it.netAmount != null ? it.netAmount : it.grossAmount)}`;
  } else {
    a.message = head
      + `Geschäftstag: ${it.tradeDate || "–"}\nValuta: ${it.settlementDate || "–"}\n`
      + `WKN / ISIN: ${it.wkn || "–"} / ${it.isin || "–"}\nStück: ${numberDE(it.quantity, 3)}\n`
      + `Kurs: ${taxEuro(it.price)}\nKurswert: ${taxEuro(it.marketValue)}\nGebühren: ${taxEuro(it.totalFees)}\n`
      + `Steuern: ${taxEuro(it.taxes)}\nEndbetrag: ${taxEuro(it.netAmount)}`;
  }
  a.addAction("Original-PDF öffnen"); a.addCancelAction("Schließen");
  if (await a.presentSheet() === 0) {
    await openDocument(managerForPath(source.path).joinPath(source.path, it.file));
  }
}

function buildTradeDocuments() {
  const sorted = tradeItems.slice().sort((a, b) => String(b.tradeDateISO || "").localeCompare(String(a.tradeDateISO || "")));
  const incomeCount = sorted.filter((x) => x.tradeType === "Ertrag").length;
  addStamp(`${sorted.length - incomeCount} Abrechnung${sorted.length - incomeCount === 1 ? "" : "en"}`
    + (incomeCount ? ` · ${incomeCount} Ertragsgutschrift${incomeCount === 1 ? "" : "en"}` : ""));
  if (!sorted.length) { addInfo("Keine passenden PDFs eingelesen."); return; }
  sorted.forEach((it) => addValueRow({
    height: metaRowHeight(`${it.tradeDate || "ohne Datum"} · ${it.tradeType || "Unbekannt"} · `
      + (it.warning ? shortLabel(it.warning, 34) : "ausgewertet"), 64),
    title: shortLabel(it.securityName || String(it.file).split("/").pop()),
    subtitle: `${it.tradeDate || "ohne Datum"} · ${it.tradeType || "Unbekannt"} · `
      + (it.warning ? shortLabel(it.warning, 34) : "ausgewertet"),
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

/** Alle Sicherungen im Backup-Ordner, neueste zuerst. */
function listBackups() {
  try {
    if (!fm.fileExists(dirs.backupDir)) return [];
    return fm.listContents(dirs.backupDir)
      .filter((n) => /\.json$/i.test(n))
      .sort()
      .reverse()
      .map((n) => fm.joinPath(dirs.backupDir, n));
  } catch (e) {
    logLine(`Backups nicht auflistbar: ${e.message || e}`, "backup");
    return [];
  }
}

/** Zeitstempel fuer den Dateinamen: comdirect_Backup_20260904-1815.json */
function backupStamp() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}`;
}

/** "comdirect_Backup_20260904-1815.json" -> "04.09.2026 18:15" */
function backupLabel(path) {
  const name = String(path).split("/").pop();
  const m = name.match(/(\d{4})(\d{2})(\d{2})-(\d{2})(\d{2})/);
  if (!m) {
    const iso = name.match(/(\d{4})-(\d{2})-(\d{2})/);
    return iso ? `${iso[3]}.${iso[2]}.${iso[1]}` : name;
  }
  return `${m[3]}.${m[2]}.${m[1]} ${m[4]}:${m[5]}`;
}

async function createBackup() {
  const payload = {
    app: APP,
    version: VERSION,
    createdAt: new Date().toISOString(),
    ini: readConfig(dirs),
    categories: readCategoryData(dirs),
    tax: { items: taxItems, signatures: taxSignatures },
    securities: { items: tradeItems, signatures: tradeSignatures },
    bookings: { sourceRef: cfg.path, bookings, files: fileInfos },
  };
  // Ohne Nachfrage in den festen Backup-Ordner. Der Zeitstempel enthaelt die
  // Uhrzeit, damit mehrere Sicherungen am selben Tag nebeneinander bestehen.
  if (!fm.fileExists(dirs.backupDir)) fm.createDirectory(dirs.backupDir, true);
  const path = fm.joinPath(dirs.backupDir, `comdirect_Backup_${backupStamp()}.json`);
  fm.writeString(path, JSON.stringify(payload, null, 2));
  logLine(`erstellt: ${path.split("/").pop()}`, "backup");
  flash("Backup: backup/" + path.split("/").pop());
}

async function restoreBackup() {
  const files = listBackups();
  const options = files.slice(0, 20).map((path) => {
    let size = "";
    try { size = `${Math.max(1, Math.round(fm.fileSize(path)))} kB`; } catch (e) { size = ""; }
    return { label: `${backupLabel(path)}${size ? " · " + size : ""}`, value: path };
  });
  // Ein Backup von ausserhalb bleibt moeglich, etwa vom anderen Geraet.
  options.push({ label: "Datei auswählen …", value: "__pick__" });
  let picked = await pickOption("Backup wiederherstellen", options, null);
  if (picked === null) return;
  if (picked === "__pick__") {
    try { picked = await DocumentPicker.open(["public.json", "public.data", "public.item"]); }
    catch (e) { return; }
    if (Array.isArray(picked)) picked = picked[0];
    if (!picked) return;
  }
  const confirmed = await choose("Wirklich einspielen?",
    `${String(picked).split("/").pop()}\n\nEinstellungen, Kategorien und alle Auswertungswerte werden `
    + "durch den Stand der Sicherung ersetzt.", ["Wiederherstellen"]);
  if (confirmed !== 0) return;
  try {
    await ensureDownloaded(picked);
    const data = safeObject(JSON.parse(managerForPath(picked).readString(picked)), {});
    // Auch eine reine categories-backup-*.json annehmen: dort steht das
    // Kategorienobjekt auf oberster Ebene, nicht unter "categories".
    if (Array.isArray(data.categories)) {
      writeCategoryData(dirs, data);
    } else if (data.categories && typeof data.categories === "object") {
      writeCategoryData(dirs, data.categories);
    } else if (typeof data.ini === "string" && data.ini.trim()) {
      const legacyGroups = extractLegacyCategories(data.ini);
      if (legacyGroups.length) writeCategoryData(dirs, { version: 1, categories: legacyGroups, assignments: {} });
    }
    if (typeof data.ini === "string" && data.ini.trim()) {
      writeConfig(dirs, stripLegacyCategories(data.ini));
      cfg = loadRuntimeConfig(dirs);
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
      bookings = ensureBookingIds(book.bookings);
      fileInfos = Array.isArray(book.files) ? book.files : [];
      refreshBookingCategories();
      writeBookingsCache(dirs, cfg.path, bookings, fileInfos);
    }
    initPeriod();
    VIEW = { name: "main" };
    logLine(`eingespielt: ${String(picked).split("/").pop()}`, "backup");
    flash("Backup wiederhergestellt.");
  } catch (e) {
    await showError(e);
  }
}

// Welcher Zwischenspeicher zu welchem Bereich gehoert.
const REBUILD_SCOPES = {
  report: { label: "Finanzen", detail: "Buchungen des Finanzreports" },
  securities: { label: "Depot", detail: "Wertpapierabrechnungen" },
  tax: { label: "Steuer", detail: "Jahressteuerbescheinigungen" },
};

function clearReportCache() {
  try { if (fm.fileExists(dirs.cache)) fm.remove(dirs.cache); }
  catch (e) { logLine(`Buchungscache nicht löschbar: ${e.message || e}`, "cache"); }
  bookings = [];
  fileInfos = [];
  pageCache = [];
}

function clearTaxCache() {
  try { if (fm.fileExists(dirs.taxCache)) fm.remove(dirs.taxCache); }
  catch (e) { logLine(`Steuercache nicht löschbar: ${e.message || e}`, "cache"); }
  taxItems = [];
  taxSignatures = {};
}

function clearTradeCache() {
  try { if (fm.fileExists(dirs.tradeCache)) fm.remove(dirs.tradeCache); }
  catch (e) { logLine(`Wertpapiercache nicht löschbar: ${e.message || e}`, "cache"); }
  tradeItems = [];
  tradeSignatures = {};
}

/**
 * Neu einlesen richtet sich nach dem aktiven Bereich: in Finanzen werden nur
 * die Buchungen verworfen, in Depot nur die Wertpapierabrechnungen, in Steuer
 * nur die Steuerbelege. Alles andere bleibt im Zwischenspeicher und muss nicht
 * erneut aus den PDFs gelesen werden. Ueber die zweite Schaltflaeche laesst
 * sich weiterhin alles auf einmal neu aufbauen.
 */
async function rebuildCaches() {
  const scope = REBUILD_SCOPES[SECTION];
  const actions = scope ? [`Nur ${scope.label}`, "Alle Bereiche"] : ["Alle Bereiche"];
  const message = scope
    ? `Aktiver Bereich: ${scope.label}. „Nur ${scope.label}“ verwirft die gespeicherten `
      + `Analysewerte für ${scope.detail} und liest die zugehörigen PDFs neu. `
      + "„Alle Bereiche“ baut Buchungen, Wertpapier- und Steuerbelege komplett neu auf."
    : "Alle gespeicherten Analysewerte für Buchungen, Steuer- und Wertpapierbelege werden "
      + "verworfen und die vorhandenen PDFs neu gelesen.";
  const confirmed = await choose("Auswertung neu aufbauen?", message, actions);
  if (confirmed < 0) return;
  const all = !scope || confirmed === 1;
  const target = all ? "alle Bereiche" : scope.label;
  if (all || SECTION === "report") clearReportCache();
  if (all || SECTION === "tax") clearTaxCache();
  if (all || SECTION === "securities") clearTradeCache();
  logLine(`Zwischenspeicher verworfen: ${target}`, "cache");
  VIEW = { name: "main" };
  flash(`Cache geleert (${target}) – PDFs werden neu gelesen.`);
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
  const calc = calculationRows(list);
  let inc = 0, exp = 0;
  for (const b of calc) { if (b.amount >= 0) inc += b.amount; else exp += b.amount; }
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
  const managed = iniGroups(dirs);
  addValueRow({
    title: "Kategorien verwalten",
    subtitle: `${managed.length} Kategorien · Regeln in categories.json`,
    value: "›",
    valueColor: C.accent,
    onSelect: () => {
      CATEGORY_EDITOR_SELECTED = -1;
      showSettings("categories");
    },
  });

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

function bookingSearchText(b) {
  return [
    b.date, b.iso, b.typ, b.name, b.group, b.value,
    Number(b.amount || 0).toFixed(2).replace(".", ","),
  ].join(" ").toLowerCase();
}

async function editBookingSearch() {
  const value = await promptText(
    "Buchungen durchsuchen",
    "Suche in Buchungstext, Vorgang, Kategorie, Datum und Betrag. Leer = alle Buchungen.",
    BOOKING_QUERY,
    { clearable: true, placeholder: "z. B. rewe oder Lebensmittel" }
  );
  if (value === null) return;
  BOOKING_QUERY = String(value || "").trim().toLowerCase();
  BOOKING_SELECTED.clear();
  render();
}

function buildBookingSelectionTools(filtered) {
  const searchLabel = BOOKING_QUERY ? `Suche: ${BOOKING_QUERY}` : "Buchungen durchsuchen";
  addValueRow({
    title: searchLabel,
    subtitle: BOOKING_QUERY ? `${filtered.length} Treffer · antippen zum Ändern` : "Text, Vorgang, Kategorie, Datum oder Betrag",
    value: BOOKING_QUERY ? "✕ / 🔎" : "🔎",
    valueColor: C.accent,
    height: 54,
    onSelect: async () => { await editBookingSearch(); },
  });

  const r = newRow(46);
  if (!BOOKING_SELECT_MODE) {
    const select = r.addButton("Mehrfachauswahl");
    select.widthWeight = 100;
    select.titleFont = F.rowStrong;
    select.titleColor = C.accent;
    select.onTap = () => {
      BOOKING_SELECT_MODE = true;
      BOOKING_SELECTED.clear();
      render();
    };
  } else {
    const all = r.addButton(BOOKING_SELECTED.size === filtered.length && filtered.length ? "Auswahl leeren" : "Alle Treffer");
    all.widthWeight = 34;
    all.titleFont = F.meta;
    all.titleColor = C.accent;
    all.onTap = () => {
      if (BOOKING_SELECTED.size === filtered.length && filtered.length) BOOKING_SELECTED.clear();
      else filtered.forEach((b) => BOOKING_SELECTED.add(b.id));
      render();
    };

    const assign = r.addButton(`${BOOKING_SELECTED.size} gewählt · Kategorie`);
    assign.widthWeight = 42;
    assign.titleFont = F.rowStrong;
    assign.titleColor = BOOKING_SELECTED.size ? C.accent : C.faint;
    assign.onTap = () => {
      if (!BOOKING_SELECTED.size) return;
      VIEW = { name: "bulkAssign", ids: Array.from(BOOKING_SELECTED) };
      render();
    };

    const cancel = r.addButton("Fertig");
    cancel.widthWeight = 24;
    cancel.rightAligned();
    cancel.titleFont = F.meta;
    cancel.titleColor = C.accent;
    cancel.onTap = () => {
      BOOKING_SELECT_MODE = false;
      BOOKING_SELECTED.clear();
      render();
    };
  }
  table.addRow(r);
}

function buildBookings() {
  ensureBookingIds(bookings);
  const all = periodRows().slice().sort((a, b) => (a.iso < b.iso ? 1 : -1));
  const q = BOOKING_QUERY.trim().toLowerCase();
  const list = q ? all.filter((b) => bookingSearchText(b).indexOf(q) >= 0) : all;
  buildBookingSelectionTools(list);
  if (!list.length) {
    addStamp(q ? "Keine Treffer" : `Für ${periodLabel()} liegen keine Buchungen vor.`);
    if (q) addInfo("Suche ändern oder leeren, um wieder alle Buchungen zu sehen.");
    return;
  }

  // Buchungen monatsweise gruppieren. Ein Tipp auf die Monatszeile klappt die
  // komplette Gruppe ein bzw. wieder aus und erspart langes Scrollen.
  const groups = [];
  let current = null;
  for (const b of list) {
    const key = `${b.year}-${String(b.month).padStart(2, "0")}`;
    if (!current || current.key !== key) {
      current = { key, year: b.year, month: b.month, rows: [] };
      groups.push(current);
    }
    current.rows.push(b);
  }

  for (const group of groups) {
    const collapsed = BOOKING_COLLAPSED_MONTHS.has(group.key);
    const countText = `${group.rows.length} ${group.rows.length === 1 ? "Buchung" : "Buchungen"}`;
    const row = addStamp(`${collapsed ? "▸" : "▾"} ${MONTHS_LONG[group.month - 1]} ${group.year} · ${countText}`);
    row.onSelect = () => {
      if (BOOKING_COLLAPSED_MONTHS.has(group.key)) BOOKING_COLLAPSED_MONTHS.delete(group.key);
      else BOOKING_COLLAPSED_MONTHS.add(group.key);
      render();
    };
    if (collapsed) continue;
    for (const b of group.rows) addBookingRow(b);
  }
}

function addBookingRow(b) {
  const selected = BOOKING_SELECTED.has(b.id);
  addValueRow({
    title: `${BOOKING_SELECT_MODE ? (selected ? "☑︎ " : "○ ") : ""}${b.name.slice(0, 90)}`,
    subtitle: `${b.date} · ${b.group}${categoryData && categoryData.assignments && categoryData.assignments[b.id] ? " · manuell" : ""}`,
    value: eur(b.amount),
    valueColor: b.amount >= 0 ? C.plus : C.minus,
    onSelect: async () => {
      if (BOOKING_SELECT_MODE) {
        if (selected) BOOKING_SELECTED.delete(b.id); else BOOKING_SELECTED.add(b.id);
        render();
      } else {
        await showBooking(b);
      }
    },
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
  // Auch bei leerem Muster ("jede PDF lesen") duerfen Kostensimulationen
  // und Ertragsgutschriften nicht als Finanzreport durchlaufen.
  if (isSimulationFile(relative) || isIncomeFile(relative)) return false;
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
      note = `${tradeItem.tradeType || "Wertpapier"} · `
        + shortLabel(tradeItem.securityName || tradeItem.wkn || "Abrechnung")
        + (tradeItem.warning ? " · prüfen" : " · ausgewertet");
    } else if (taxItem) {
      mark = taxItem.warning ? "!" : "✓";
      markColor = taxItem.warning ? C.warn : C.plus;
      note = `Steuerbescheinigung ${taxItem.year || "?"} · `
        + (taxItem.warning ? shortLabel(taxItem.warning, 32) : "ausgewertet");
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
    // Bei erkannten Belegen ist das Belegdatum aussagekraeftiger als das
    // Dateidatum — letzteres ist nach einer Ordnerkopie bei allen Dateien
    // gleich und kostet nur Platz.
    const stamp = tradeItem ? (tradeItem.tradeDate || file.year)
      : (taxItem ? String(taxItem.year || file.year) : file.modified);
    const meta = [file.year, stamp === String(file.year) ? "" : stamp, note]
      .filter(Boolean).join(" · ");
    addValueRow({
      title: shortLabel(file.name),
      subtitle: meta,
      height: metaRowHeight(meta),
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
  const excluded = String(name || "").trim().toLocaleLowerCase("de-DE") === "umbuchung";
  const sum = excluded ? 0 : r2(list.reduce((a, b) => a + b.amount, 0));
  addBackRow(name, `${list.length} ${list.length === 1 ? "Buchung" : "Buchungen"} · ${periodLabel()}${excluded ? " · nicht berechnet" : ""}`);

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
  yearRows().forEach((b) => { if (!excluded && b.group === name) per[b.month - 1] += b.amount; });
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
  a.addAction("Kategorie ändern …");
  a.addAction("Schlüsselwort anlegen …");
  a.addAction("PDF öffnen");
  a.addCancelAction("Schließen");
  const idx = await a.presentSheet();
  if (idx === 0) {
    VIEW = { name: "bulkAssign", ids: [b.id] };
    render();
  } else if (idx === 1) {
    VIEW = { name: "assign", booking: b };
    render();
  } else if (idx === 2) {
    const owner = managerForPath(source.path);
    await openDocument(owner.joinPath(source.path, b.file));
  }
}

// Kategorien können auf schmalen iPhones mehrzeilige Untertitel benötigen. Eine
// feste Zeilenhöhe führt dann dazu, dass Titel und Schlüsselwörter in die nächste
// UITableRow hineinragen. Die Höhe wird deshalb aus dem sichtbaren Text geschätzt.
function categoryChoicePreview(group, maxWords) {
  const words = Array.isArray(group && group.words) ? group.words : [];
  if (!words.length) return "Keine Schlüsselwörter";
  const limit = Math.max(1, Number(maxWords) || 6);
  return words.slice(0, limit).join(", ") + (words.length > limit ? " …" : "");
}

function categoryChoiceRowHeight(title, subtitle) {
  const titleLines = Math.max(1, Math.ceil(String(title || "").length / 27));
  const subtitleLines = Math.max(1, Math.ceil(String(subtitle || "").length / 31));
  // 18 pt je Textzeile + großzügiger Innenabstand; nach oben begrenzen, damit
  // sehr lange Schlüsselwortlisten die Auswahl nicht unnötig aufblähen.
  return Math.min(104, Math.max(64, 18 + titleLines * 21 + subtitleLines * 18));
}

function categoryChoiceSearchText(group) {
  return [group && group.name || ""]
    .concat(Array.isArray(group && group.words) ? group.words : [])
    .join(" ")
    .toLocaleLowerCase("de-DE");
}

function categoryChoiceMatches(group, query) {
  const q = String(query || "").trim().toLocaleLowerCase("de-DE");
  if (!q) return true;
  const name = String(group && group.name || "").toLocaleLowerCase("de-DE");
  const words = Array.isArray(group && group.words) ? group.words : [];
  // Bereits die ersten Buchstaben reichen: Kategoriename und jedes Schlüsselwort
  // werden auf Präfix-Treffer geprüft. Teiltreffer bleiben als Fallback erhalten.
  if (name.startsWith(q)) return true;
  if (words.some((word) => String(word).toLocaleLowerCase("de-DE").startsWith(q))) return true;
  return categoryChoiceSearchText(group).includes(q);
}

function categoryChoiceRank(group, query) {
  const q = String(query || "").trim().toLocaleLowerCase("de-DE");
  if (!q) return 9;
  const name = String(group && group.name || "").toLocaleLowerCase("de-DE");
  const words = Array.isArray(group && group.words) ? group.words : []
    .map((word) => String(word).toLocaleLowerCase("de-DE"));
  if (name === q) return 0;
  if (name.startsWith(q)) return 1;
  if (words.some((word) => word === q)) return 2;
  if (words.some((word) => word.startsWith(q))) return 3;
  if (name.includes(q)) return 4;
  return 5;
}

async function editCategoryAssignSearch() {
  const value = await promptText(
    "Kategorie suchen",
    "Einige Anfangsbuchstaben genügen. Gesucht wird in Kategorienamen und Schlüsselwörtern.",
    CATEGORY_ASSIGN_QUERY,
    { clearable: true, placeholder: "z. B. leb, auto, rewe" }
  );
  if (value === null) return;
  CATEGORY_ASSIGN_QUERY = String(value || "").trim();
  render();
}

function addCategoryAssignSearchRow(total, shown) {
  const q = CATEGORY_ASSIGN_QUERY.trim();
  const r = newRow(54);
  const search = r.addButton(q ? `🔎 ${q}` : "🔎 Kategorie suchen");
  search.widthWeight = q ? 72 : 100;
  search.titleFont = F.rowStrong;
  search.titleColor = C.accent;
  search.onTap = editCategoryAssignSearch;
  if (q) {
    const clear = r.addButton("✕ Leeren");
    clear.widthWeight = 28;
    clear.rightAligned();
    clear.titleFont = F.meta;
    clear.titleColor = C.dim;
    clear.onTap = () => {
      CATEGORY_ASSIGN_QUERY = "";
      render();
    };
  }
  table.addRow(r);
  if (q) addInfo(`${shown} von ${total} Kategorien passend zu „${q}“.`);
}

function buildBulkAssign(ids) {
  const unique = Array.from(new Set(Array.isArray(ids) ? ids : [])).filter(Boolean);
  addBackRow("Kategorie ändern", `${unique.length} ${unique.length === 1 ? "Buchung" : "Buchungen"}`);
  addInfo("Die manuelle Kategorie hat Vorrang vor der automatischen Schlüsselwort-Regel. "
    + "Mit „Automatisch zuordnen“ wird die manuelle Zuordnung wieder entfernt.");

  const allGroups = iniGroups(dirs);
  const q = CATEGORY_ASSIGN_QUERY.trim();
  const groups = allGroups
    .filter((g) => categoryChoiceMatches(g, q))
    .sort((a, b) => q
      ? categoryChoiceRank(a, q) - categoryChoiceRank(b, q)
        || a.name.localeCompare(b.name, "de-DE", { sensitivity: "base" })
      : a.name.localeCompare(b.name, "de-DE", { sensitivity: "base" }));

  addCategoryAssignSearchRow(allGroups.length, groups.length);

  addValueRow({
    title: "Automatisch zuordnen",
    subtitle: "Manuelle Zuordnung entfernen und Schlüsselwort-Regeln verwenden",
    value: "↺",
    valueColor: C.accent,
    height: 76,
    onSelect: () => {
      CATEGORY_ASSIGN_QUERY = "";
      unique.forEach((id) => { delete categoryData.assignments[id]; });
      persistCategoryAssignments("Automatische Zuordnung wieder aktiviert.");
    },
  });

  if (!groups.length) {
    addInfo("Keine passende Kategorie gefunden. Suche ändern oder leeren.", C.warn);
  }

  for (const g of groups) {
    const preview = categoryChoicePreview(g, 6);
    addValueRow({
      title: g.name,
      subtitle: preview,
      value: "✓",
      valueColor: C.accent,
      height: categoryChoiceRowHeight(g.name, preview),
      onSelect: () => {
        CATEGORY_ASSIGN_QUERY = "";
        unique.forEach((id) => { categoryData.assignments[id] = g.name; });
        persistCategoryAssignments(`${unique.length} ${unique.length === 1 ? "Buchung" : "Buchungen"} → ${g.name}.`);
      },
    });
  }
  addSpacer(24);
}

// Ergänzt weiterhin eine automatische Schlüsselwort-Regel für zukünftige Buchungen.
function buildAssign(b) {
  addBackRow("Schlüsselwort anlegen", b.name.slice(0, 60));
  addInfo("Wähle die Kategorie, deren automatische Schlüsselwort-Regel ergänzt werden soll. "
    + "Die manuelle Kategorie-Zuordnung ist davon unabhängig.");
  const suggestion = (b.name.match(/[a-zäöüß0-9.&+-]{4,}/i) || [""])[0].toLowerCase();
  const allGroups = iniGroups(dirs);
  const q = CATEGORY_ASSIGN_QUERY.trim();
  const groups = allGroups
    .filter((g) => categoryChoiceMatches(g, q))
    .sort((a, b) => q
      ? categoryChoiceRank(a, q) - categoryChoiceRank(b, q)
        || a.name.localeCompare(b.name, "de-DE", { sensitivity: "base" })
      : a.name.localeCompare(b.name, "de-DE", { sensitivity: "base" }));
  addCategoryAssignSearchRow(allGroups.length, groups.length);
  if (!groups.length) addInfo("Keine passende Kategorie gefunden. Suche ändern oder leeren.", C.warn);
  for (const g of groups) {
    const preview = categoryChoicePreview(g, 6);
    addValueRow({
      title: g.name,
      subtitle: preview,
      value: "＋",
      valueColor: C.accent,
      height: categoryChoiceRowHeight(g.name, preview),
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
        cfg = loadRuntimeConfig(dirs);
        CATEGORY_ASSIGN_QUERY = "";
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

function rebuildScopeSubtitle() {
  const scope = REBUILD_SCOPES[SECTION];
  return scope
    ? `Nur ${scope.label} oder alle Bereiche · richtet sich nach dem aktiven Bereich`
    : "Zwischenspeicher leeren und alle PDFs erneut lesen";
}

function logSectionSummary() {
  const files = listLogFiles();
  const own = readLogLines(1);
  const last = own.length ? own[0].slice(0, 16) : "keine Einträge";
  return `${files.length} Gerät(e) · zuletzt ${last}`;
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
    if (id === "categories" && open) CATEGORY_EDITOR_SELECTED = -1;
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
  const appearanceLabel = cfg.appearance === "light" ? "Hell"
    : (cfg.appearance === "dark" ? "Dunkel" : "System");
  addChipRow([{
    label: `${appearanceIcon()}  Darstellung: ${appearanceLabel}`,
    on: true,
    onTap: () => { cycleAppearance(); },
  }], 42, C.head);

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
  if (addSettingsSection("report", "Finanzreport", "Dateimuster und Texterkennung")) {
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
      cfg = loadRuntimeConfig(dirs);
      VIEW = { name: "main" };
      flash("Abstand gesichert – Reports werden neu gelesen.");
      await scan();
    },
  });
  }

  /* --- Vollstaendiger Kategorien-Editor -------------------------------- */
  if (addSettingsSection("categories", "Kategorien-Editor", categoryEditorSummary())) {
    buildSettingsCategoryEditor();
  }

  /* --- Jahressteuerbescheinigungen -------------------------------------- */
  if (addSettingsSection("tax", "Jahressteuer", "Dateimuster der Bescheinigungen")) {
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
  addInfo("Der Sparer-Pauschbetrag wird aus der Bescheinigung hergeleitet: genutzter plus noch "
    + "verfügbarer Freistellungsauftrag. Fehlt die Angabe, gilt der gesetzliche Betrag "
    + "(ab 2023 1.000 € je Person, davor 801 €), bei höherer Nutzung verdoppelt.");
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
  addValueRow({
    title: "Zu lesende Ertragsgutschriften",
    subtitle: "PDFs mit diesem Text im Namen werden als Dividende oder Ausschüttung ausgewertet.",
    value: cfg.incomePattern || "aus",
    height: 62,
    onSelect: async () => {
      const value = await promptText("Dateimuster Erträge",
        "Zum Beispiel Ertragsgutschrift. Leer lassen, um die Auswertung abzuschalten.",
        cfg.incomePattern, { clearable: true, placeholder: DEFAULTS.incomePattern });
      if (value === null) return;
      cfg.incomePattern = value;
      setIniValue(dirs, "ertragsmuster", value);
      flash("Muster gesichert – Ertragsgutschriften werden neu gelesen.");
      await scan();
    },
  });
  addInfo(`${tradeOrders().length} Abrechnung${tradeOrders().length === 1 ? "" : "en"} und `
    + `${tradeItems.filter((x) => x.tradeType === "Ertrag").length} Ertragsgutschrift`
    + `${tradeItems.filter((x) => x.tradeType === "Ertrag").length === 1 ? "" : "en"} erkannt. `
    + "Positionen werden ausschließlich aus den vorhandenen Kauf- und Verkaufsabrechnungen berechnet, "
    + "Erträge fließen nur in den Zahlungsstrom ein.");
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
    subtitle: `Einstellungen, Kategorien und Auswertungswerte nach backup/ · ${listBackups().length} vorhanden`,
    value: "⇪",
    valueColor: C.accent,
    onSelect: async () => { await createBackup(); },
  });
  addValueRow({
    title: "Backup wiederherstellen",
    subtitle: "Aus dem Ordner backup/ auswählen oder eine Datei einlesen",
    value: "⇩",
    valueColor: C.accent,
    onSelect: async () => { await restoreBackup(); },
  });
  addValueRow({
    title: "Auswertung neu aufbauen",
    subtitle: rebuildScopeSubtitle(),
    value: "⟲",
    valueColor: C.warn,
    onSelect: async () => { await rebuildCaches(); },
  });
  addValueRow({
    title: "Einstellungen teilen",
    subtitle: "com_fm.ini exportieren",
    value: "⇪",
    valueColor: C.accent,
    onSelect: async () => {
      try { await ShareSheet.present([dirs.ini]); } catch (e) { flash("Teilen nicht möglich."); }
    },
  });
  addValueRow({
    title: "Auf Standard zurücksetzen",
    subtitle: "Nur Einstellungen zurücksetzen · Kategorien bleiben erhalten",
    value: "⟲",
    valueColor: C.minus,
    onSelect: async () => {
      const confirmed = await choose("Zurücksetzen?",
        "Die aktuelle com_fm.ini wird durch die Standardeinstellungen ersetzt. categories.json und Zugangsdaten bleiben erhalten.",
        ["Zurücksetzen"]);
      if (confirmed !== 0) return;
      writeConfig(dirs, DEFAULT_INI);
      cfg = loadRuntimeConfig(dirs);
      APPEARANCE = cfg.appearance || "system";
      source = resolveStorage(dirs, cfg.path);
      VIEW = { name: "main" };
      await reassign("Standardkonfiguration wiederhergestellt.");
    },
  });
  }

  if (addSettingsSection("log", "Protokoll", logSectionSummary())) {
  const entries = readLogLines(30);
  addInfo(`Datei: ${dirs.log}`);
  if (!entries.length) addInfo("Noch keine Einträge.");
  entries.forEach((line) => addInfo(line, C.dim));
  addChipRow([
    { label: "↻ Aktualisieren", on: true, onTap: () => { render(); } },
    { label: "⇪ Teilen", onTap: async () => {
      const files = listLogFiles();
      if (!files.length) { flash("Kein Protokoll vorhanden."); return; }
      try { await ShareSheet.present(files); } catch (e) { flash("Teilen nicht möglich."); }
    } },
    { label: "Leeren", onTap: async () => {
      const confirmed = await choose("Protokoll leeren?",
        "Die Protokolldatei dieses Geräts wird gelöscht. Daten und Kategorien bleiben unberührt.",
        ["Leeren"]);
      if (confirmed !== 0) return;
      try { if (fm.fileExists(dirs.log)) fm.remove(dirs.log); } catch (e) { /* egal */ }
      LOG_BUFFER = [];
      flash("Protokoll geleert.");
    } },
  ], 44, C.bg);
  }

  if (addSettingsSection("info", "Ablage und Version", "Speicherorte und Versionsstand")) {
  addInfo(`Einstellungen: ${dirs.ini}`);
  addInfo(`Kategorien: ${dirs.categories}`);
  addInfo(`Postbox: ${dirs.postboxSettings}`);
  addInfo(`Arbeitsordner: ${dirs.root}`);
  addInfo(`PDF-Ordner: ${dirs.reports}`);
  addInfo(`Wertpapier-Cache: ${dirs.tradeCache}`);
  addInfo(`CSV-Export: ${dirs.exportDir}`);
  addInfo(`Protokoll: ${dirs.log}`);
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

/* -------------------------------- Kategorien-Editor in den Einstellungen */

function categoryEditorSummary() {
  const list = iniGroups(dirs);
  const words = list.reduce((sum, item) => sum + item.words.length, 0);
  return `${list.length} Kategorien · ${words} Schlüsselwörter`;
}

function categoryEditorAssignmentCount(name) {
  const values = Object.values(categoryData && categoryData.assignments || {});
  return name ? values.filter((value) => value === name).length : values.length;
}

function categoryEditorDuplicateMap() {
  const map = new Map();
  iniGroups(dirs).forEach((group) => {
    group.words.forEach((word) => {
      const key = word.toLocaleLowerCase("de-DE");
      if (!map.has(key)) map.set(key, []);
      map.get(key).push(group.name);
    });
  });
  return new Map(Array.from(map.entries()).filter(([, owners]) => new Set(owners).size > 1));
}

function categoryEditorTimestamp() {
  const now = new Date();
  const pad = (value) => String(value).padStart(2, "0");
  return `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}`
    + `-${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
}

function createCategoryEditorBackup() {
  if (CATEGORY_EDITOR_BACKUP_CREATED) return;
  const path = fm.joinPath(dirs.root, `categories-backup-${categoryEditorTimestamp()}.json`);
  const original = fm.fileExists(dirs.categories)
    ? fm.readString(dirs.categories)
    : JSON.stringify(defaultCategoryData(), null, 2) + "\n";
  fm.writeString(path, original);
  CATEGORY_EDITOR_BACKUP_CREATED = true;
}

/** Alle automatisch angelegten Kategorie-Sicherungen, neueste zuerst. */
function listCategoryBackups() {
  try {
    return fm.listContents(dirs.root)
      .filter((n) => /^categories-backup-.*\.json$/i.test(n))
      .sort()
      .reverse()
      .map((n) => fm.joinPath(dirs.root, n));
  } catch (e) {
    logLine(`Sicherungen nicht auflistbar: ${e.message || e}`, "kategorien");
    return [];
  }
}

/** "categories-backup-20260904-181500.json" -> "04.09.2026 18:15" */
function categoryBackupLabel(path) {
  const name = String(path).split("/").pop();
  const m = name.match(/(\d{4})(\d{2})(\d{2})-(\d{2})(\d{2})(\d{2})/);
  return m ? `${m[3]}.${m[2]}.${m[1]} ${m[4]}:${m[5]}` : name;
}

/**
 * Stellt einen fruehren Kategorienstand wieder her. Vor dem Ueberschreiben
 * wird der aktuelle Stand selbst gesichert, damit der Schritt umkehrbar
 * bleibt. Ein leerer oder unlesbarer Sicherungsstand wird abgelehnt, statt
 * die vorhandenen Kategorien durch Standardwerte zu ersetzen.
 */
async function restoreCategoryBackup() {
  const backups = listCategoryBackups();
  if (!backups.length) {
    await alert("Keine Sicherung gefunden",
      `Im Arbeitsordner liegt keine Datei categories-backup-*.json.\n\n${dirs.root}`);
    return;
  }
  const options = backups.slice(0, 12).map((path) => {
    let count = 0;
    let assigned = 0;
    try {
      const data = normalizeCategoryData(JSON.parse(fm.readString(path)));
      count = data.categories.length;
      assigned = Object.keys(data.assignments).length;
    } catch (e) { /* Anzahl bleibt 0 */ }
    return { label: `${categoryBackupLabel(path)} · ${count} Kategorien · ${assigned} Zuordnungen`, value: path };
  });
  const picked = await pickOption("Kategorien wiederherstellen", options, null);
  if (picked === null) return;
  let restored = null;
  try {
    restored = normalizeCategoryData(JSON.parse(fm.readString(picked)));
  } catch (e) {
    await showError(e);
    return;
  }
  if (!restored.categories.length) {
    await alert("Sicherung ist leer", "Diese Datei enthält keine Kategorien und wird nicht eingespielt.");
    return;
  }
  const confirmed = await choose("Wirklich einspielen?",
    `${restored.categories.length} Kategorien und ${Object.keys(restored.assignments).length} manuelle `
    + "Zuordnungen ersetzen den aktuellen Stand. Der jetzige Stand wird vorher gesichert.",
    ["Wiederherstellen"]);
  if (confirmed !== 0) return;
  // Aktuellen Stand sichern, damit die Wiederherstellung umkehrbar bleibt.
  CATEGORY_EDITOR_BACKUP_CREATED = false;
  createCategoryEditorBackup();
  writeCategoryData(dirs, restored);
  cfg = loadRuntimeConfig(dirs);
  CATEGORY_EDITOR_SELECTED = -1;
  logLine(`Sicherung ${categoryBackupLabel(picked)} eingespielt`, "kategorien");
  await reassign(`Kategorien vom ${categoryBackupLabel(picked)} wiederhergestellt.`);
}

async function saveCategoryEditor(list, message) {
  try {
    writeIniGroups(dirs, list);
    cfg = loadRuntimeConfig(dirs);
    SETTINGS_OPEN = "categories";
    await reassign(message);
  } catch (error) {
    await alert("Speichern fehlgeschlagen", String(error.message || error));
  }
}

function buildSettingsCategoryEditor() {
  const list = iniGroups(dirs);
  if (CATEGORY_EDITOR_SELECTED >= list.length) CATEGORY_EDITOR_SELECTED = -1;

  if (CATEGORY_EDITOR_SELECTED >= 0) {
    buildSettingsCategoryDetail(list, CATEGORY_EDITOR_SELECTED);
    return;
  }

  addChipRow([
    { label: "＋ Kategorie", on: true, onTap: async () => { await categoryEditorAddCategory(); } },
    { label: "↻ Neu laden", onTap: () => {
      categoryData = readCategoryData(dirs);
      cfg.groups = categoryMap(categoryData);
      CATEGORY_EDITOR_SELECTED = -1;
      flash("categories.json neu geladen.");
    } },
    { label: "⟲ Sicherung", onTap: async () => { await restoreCategoryBackup(); } },
    { label: "Info", onTap: async () => { await showCategoryEditorInfo(); } },
  ], 48, C.bg);

  if (notice) addInfo("✓ " + notice, C.plus);
  addInfo("Die erste passende Kategorie gewinnt. Kategorie antippen oder „Bearbeiten“ wählen. "
    + "Die Reihenfolge wird anschließend direkt in der Detailansicht geändert.");
  addStamp("KATEGORIEN · TIPPEN ZUM BEARBEITEN");

  if (!list.length) {
    addInfo("Keine Kategorien vorhanden. Über „＋ Kategorie“ lässt sich eine neue Kategorie anlegen.");
  }

  list.forEach((group, index) => {
    const row = newRow(66);
    const preview = group.words.length
      ? group.words.slice(0, 4).join(", ") + (group.words.length > 4 ? " …" : "")
      : "Nur manuell zuordenbar";
    const label = group.words.length === 1 ? "1 Schlüsselwort" : `${group.words.length} Schlüsselwörter`;
    const text = row.addText(group.name, `${label} · ${preview}`);
    text.widthWeight = 70;
    text.titleFont = F.rowStrong;
    text.titleColor = C.text;
    text.subtitleFont = F.meta;
    text.subtitleColor = C.dim;

    // Scriptable kann row.onSelect unterdrücken, sobald mehrere Buttons in
    // derselben UITableRow liegen. Deshalb besitzt die Liste nur noch einen
    // großen, eindeutigen Bearbeiten-Button; die Pfeile stehen im Detail.
    const open = row.addButton("✎ Bearbeiten");
    open.widthWeight = 30;
    open.rightAligned();
    open.titleFont = F.rowStrong;
    open.titleColor = C.accent;
    open.onTap = async () => { openSettingsCategoryDetail(index); };
    row.onSelect = async () => { openSettingsCategoryDetail(index); };
    applyTableStripe(row);
    table.addRow(row);
  });

  addStamp("DATEI");
  addInfo(`categories.json · ${categoryEditorAssignmentCount()} manuelle Buchungszuordnungen`);
}

function openSettingsCategoryDetail(index) {
  const list = iniGroups(dirs);
  if (index < 0 || index >= list.length) {
    CATEGORY_EDITOR_SELECTED = -1;
    flash("Kategorie konnte nicht geöffnet werden.");
    return;
  }
  CATEGORY_EDITOR_SELECTED = index;
  SETTINGS_OPEN = "categories";
  VIEW = { name: "settings" };
  render();
}

function buildSettingsCategoryDetail(list, index) {
  const group = list[index];
  addChipRow([
    { label: "‹ Kategorienliste", on: true, weight: 2, onTap: () => {
      CATEGORY_EDITOR_SELECTED = -1;
      render();
    } },
    { label: "Info", onTap: async () => { await showCategoryEditorInfo(); } },
  ], 46, C.bg);

  addStamp(`${group.name.toLocaleUpperCase("de-DE")} · POSITION ${index + 1} VON ${list.length}`);
  addValueRow({
    title: "Name ändern",
    subtitle: group.name,
    value: "›",
    valueColor: C.accent,
    onSelect: async () => { await categoryEditorRename(index); },
  });
  addChipRow([
    { label: "↑ Hoch", off: index === 0, onTap: async () => { await categoryEditorMove(index, -1, true); } },
    { label: "↓ Runter", off: index === list.length - 1, onTap: async () => { await categoryEditorMove(index, 1, true); } },
    { label: "⇤ Anfang", off: index === 0, onTap: async () => { await categoryEditorMoveTo(index, 0); } },
    { label: "Ende ⇥", off: index === list.length - 1, onTap: async () => { await categoryEditorMoveTo(index, list.length - 1); } },
  ], 46, C.bg);

  addStamp("SCHLÜSSELWÖRTER · TIPPEN ZUM BEARBEITEN");
  addButtonRow("＋ Schlüsselwort hinzufügen", async () => { await categoryEditorAddKeyword(index); });

  if (!group.words.length) {
    addInfo("Keine Schlüsselwörter. Diese Kategorie kann nur manuell zugeordnet werden.");
  }

  group.words.forEach((word, wordIndex) => {
    const row = newRow(50);
    const text = row.addText(word);
    text.widthWeight = 88;
    text.titleFont = F.row;
    text.titleColor = C.text;
    const del = row.addButton("−");
    del.widthWeight = 12;
    del.centerAligned();
    del.titleColor = C.minus;
    del.onTap = async () => { await categoryEditorDeleteKeyword(index, wordIndex); };
    row.onSelect = async () => { await categoryEditorEditKeyword(index, wordIndex); };
    applyTableStripe(row);
    table.addRow(row);
  });

  addStamp("WEITERE AKTIONEN");
  addInfo(`${categoryEditorAssignmentCount(group.name)} manuelle Buchungszuordnungen verwenden diese Kategorie.`);
  addButtonRow("Kategorie löschen", async () => { await categoryEditorDeleteCategory(index); }, true);
}

async function categoryEditorAddCategory() {
  const list = iniGroups(dirs);
  const name = await promptText("Neue Kategorie", "Name der neuen Kategorie:", "", {
    placeholder: "Kategorie",
  });
  if (name === null || !name.trim()) return;
  const clean = name.trim();
  if (list.some((item) => item.name.toLocaleLowerCase("de-DE") === clean.toLocaleLowerCase("de-DE"))) {
    await alert("Kategorie existiert bereits", `„${clean}“ ist schon vorhanden.`);
    return;
  }
  createCategoryEditorBackup();
  list.push({ name: clean, words: [] });
  CATEGORY_EDITOR_SELECTED = list.length - 1;
  await saveCategoryEditor(list, `Kategorie „${clean}“ angelegt.`);
}

async function categoryEditorRename(index) {
  const list = iniGroups(dirs);
  const group = list[index];
  if (!group) return;
  const value = await promptText("Kategorie umbenennen", "Neuer Name:", group.name);
  if (value === null || !value.trim() || value.trim() === group.name) return;
  const clean = value.trim();
  if (list.some((item, i) => i !== index
    && item.name.toLocaleLowerCase("de-DE") === clean.toLocaleLowerCase("de-DE"))) {
    await alert("Kategorie existiert bereits", `„${clean}“ ist schon vorhanden.`);
    return;
  }
  createCategoryEditorBackup();
  const oldName = group.name;
  group.name = clean;
  Object.keys(categoryData.assignments || {}).forEach((id) => {
    if (categoryData.assignments[id] === oldName) categoryData.assignments[id] = clean;
  });
  await saveCategoryEditor(list, `„${oldName}“ in „${clean}“ umbenannt.`);
}

async function categoryEditorMove(index, delta, keepDetail = false) {
  const list = iniGroups(dirs);
  const target = index + delta;
  if (index < 0 || target < 0 || target >= list.length) return;
  await categoryEditorMoveTo(index, target, keepDetail);
}

async function categoryEditorMoveTo(index, target, keepDetail = true) {
  const list = iniGroups(dirs);
  if (index < 0 || index >= list.length || target < 0 || target >= list.length || index === target) return;
  createCategoryEditorBackup();
  const [item] = list.splice(index, 1);
  list.splice(target, 0, item);
  CATEGORY_EDITOR_SELECTED = keepDetail ? target : -1;
  await saveCategoryEditor(list, `„${item.name}“ verschoben.`);
}

async function categoryEditorDeleteCategory(index) {
  const list = iniGroups(dirs);
  const group = list[index];
  if (!group) return;
  const linked = categoryEditorAssignmentCount(group.name);
  const message = `${group.words.length} Schlüsselwörter` + (linked
    ? `\n${linked} manuelle Buchungszuordnungen werden ebenfalls entfernt.`
    : "") + "\n\nDie Buchungen werden anschließend neu zugeordnet.";
  if (await choose(`Kategorie „${group.name}“ löschen?`, message, ["Löschen"]) !== 0) return;
  createCategoryEditorBackup();
  list.splice(index, 1);
  Object.keys(categoryData.assignments || {}).forEach((id) => {
    if (categoryData.assignments[id] === group.name) delete categoryData.assignments[id];
  });
  CATEGORY_EDITOR_SELECTED = -1;
  await saveCategoryEditor(list, `Kategorie „${group.name}“ gelöscht.`);
}

function categoryEditorKeywordOwners(word, ownIndex) {
  const needle = word.toLocaleLowerCase("de-DE");
  return iniGroups(dirs)
    .filter((group, index) => index !== ownIndex
      && group.words.some((item) => item.toLocaleLowerCase("de-DE") === needle))
    .map((group) => group.name);
}

async function confirmCategoryEditorDuplicate(word, owners) {
  return await choose("Schlüsselwort mehrfach vorhanden",
    `„${word}“ wird bereits verwendet in:\n\n${owners.map((name) => "• " + name).join("\n")}`
      + "\n\nDa die Reihenfolge entscheidet, kann das zu unerwarteten Zuordnungen führen.",
    ["Trotzdem speichern"]) === 0;
}

async function categoryEditorAddKeyword(index) {
  const list = iniGroups(dirs);
  const group = list[index];
  if (!group) return;
  const value = await promptText("Schlüsselwort hinzufügen", `Kategorie: ${group.name}`, "", {
    placeholder: "Schlüsselwort",
  });
  if (value === null || !value.trim()) return;
  const clean = value.trim().toLocaleLowerCase("de-DE");
  if (group.words.some((word) => word.toLocaleLowerCase("de-DE") === clean)) {
    await alert("Schlüsselwort existiert bereits", `„${clean}“ ist bereits in „${group.name}“ enthalten.`);
    return;
  }
  const owners = categoryEditorKeywordOwners(clean, index);
  if (owners.length && !await confirmCategoryEditorDuplicate(clean, owners)) return;
  createCategoryEditorBackup();
  group.words.push(clean);
  await saveCategoryEditor(list, `Schlüsselwort „${clean}“ hinzugefügt.`);
}

async function categoryEditorEditKeyword(index, wordIndex) {
  const list = iniGroups(dirs);
  const group = list[index];
  if (!group || wordIndex < 0 || wordIndex >= group.words.length) return;
  const old = group.words[wordIndex];
  const value = await promptText("Schlüsselwort bearbeiten", `Kategorie: ${group.name}`, old);
  if (value === null || !value.trim()) return;
  const clean = value.trim().toLocaleLowerCase("de-DE");
  if (clean === old) return;
  if (group.words.some((word, i) => i !== wordIndex && word.toLocaleLowerCase("de-DE") === clean)) {
    await alert("Schlüsselwort existiert bereits", `„${clean}“ ist bereits in „${group.name}“ enthalten.`);
    return;
  }
  const owners = categoryEditorKeywordOwners(clean, index);
  if (owners.length && !await confirmCategoryEditorDuplicate(clean, owners)) return;
  createCategoryEditorBackup();
  group.words[wordIndex] = clean;
  await saveCategoryEditor(list, `„${old}“ in „${clean}“ geändert.`);
}

async function categoryEditorDeleteKeyword(index, wordIndex) {
  const list = iniGroups(dirs);
  const group = list[index];
  if (!group || wordIndex < 0 || wordIndex >= group.words.length) return;
  const word = group.words[wordIndex];
  if (await choose("Schlüsselwort löschen?", `„${word}“ aus „${group.name}“ entfernen?`, ["Löschen"]) !== 0) return;
  createCategoryEditorBackup();
  group.words.splice(wordIndex, 1);
  await saveCategoryEditor(list, `Schlüsselwort „${word}“ gelöscht.`);
}

async function showCategoryEditorInfo() {
  const list = iniGroups(dirs);
  const wordCount = list.reduce((sum, group) => sum + group.words.length, 0);
  const duplicates = categoryEditorDuplicateMap();
  const actions = duplicates.size ? ["OK", "Duplikate anzeigen"] : ["OK"];
  const selected = await choose("categories.json",
    `Speicherort:\n${dirs.categories}\n\nKategorien: ${list.length}\nSchlüsselwörter: ${wordCount}`
      + `\nManuelle Zuordnungen: ${categoryEditorAssignmentCount()}\nDoppelte Schlüsselwörter: ${duplicates.size}`
      + "\n\nManuelle Zuordnungen bleiben unverändert, außer eine Kategorie wird umbenannt oder gelöscht.",
    actions, "");
  if (duplicates.size && selected === 1) {
    await alert("Doppelte Schlüsselwörter", Array.from(duplicates.entries())
      .map(([word, owners]) => `• ${word}: ${Array.from(new Set(owners)).join(", ")}`)
      .join("\n"));
  }
}

/* ------------------------------------------------------ Gruppen-Editor */

function buildEditor() {
  const groups = iniGroups(dirs);
  const r = newRow(50);
  const back = r.addButton("‹ Kategorien");
  back.widthWeight = 55;
  back.titleFont = F.rowStrong;
  back.titleColor = C.accent;
  back.onTap = () => { SECTION = "report"; TAB = "groups"; VIEW = { name: "main" }; render(); };
  const add = r.addButton("＋ Gruppe");
  add.widthWeight = 45;
  add.rightAligned();
  add.titleFont = F.rowStrong;
  add.titleColor = C.accent;
  add.onTap = async () => { await editGroup(null); };
  table.addRow(r);

  addInfo("Regeln werden in categories.json gespeichert. Die erste passende Kategorie gewinnt. "
    + "Mit ▲ und ▼ Reihenfolge ändern, Zeile antippen zum Bearbeiten.");

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
  cfg = loadRuntimeConfig(dirs);
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
    const oldName = existing.name;
    existing.name = newName;
    existing.words = words;
    if (oldName !== newName) {
      for (const id of Object.keys(categoryData.assignments || {})) {
        if (categoryData.assignments[id] === oldName) categoryData.assignments[id] = newName;
      }
    }
  } else {
    list.push({ name: newName, words });
  }
  writeIniGroups(dirs, list);
  cfg = loadRuntimeConfig(dirs);
  await reassign(existing ? "Kategorie gesichert." : "Kategorie angelegt.");
}

async function deleteGroup(name) {
  const confirmed = await choose("„" + name + "“ löschen?",
    "Die Buchungen werden danach neu zugeordnet.", ["Löschen"]);
  if (confirmed !== 0) return;
  const list = iniGroups(dirs).filter((g) => g.name !== name);
  for (const id of Object.keys(categoryData.assignments || {})) {
    if (categoryData.assignments[id] === name) delete categoryData.assignments[id];
  }
  writeIniGroups(dirs, list);
  cfg = loadRuntimeConfig(dirs);
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
      + "3. Der Fortschritt läuft im Kopf der App und zusätzlich in der Konsole. "
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
      + "• Kategorien und Schlüsselwörter liegen separat in categories.json. Die erste passende "
      + "Kategorie gewinnt, deshalb entscheidet die Reihenfolge im Kategorien-Editor.\n\n"
      + "• Eine Buchung antippen → „Kategorie ändern“ setzt eine manuelle Zuordnung mit Vorrang vor Regeln. "
      + "„Schlüsselwort anlegen“ ergänzt stattdessen die automatische Regel dauerhaft.\n\n"
      + "• Unter „Buchungen“ gibt es Suche und Mehrfachauswahl. Mehrere Treffer können gemeinsam einer "
      + "Kategorie zugeordnet oder wieder auf automatische Zuordnung gestellt werden.\n\n"
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
      + "Der Sparer-Pauschbetrag wird aus der Bescheinigung hergeleitet: genutzter plus noch "
      + "verfügbarer Freistellungsauftrag. Fehlt die Angabe, gilt der gesetzliche Betrag (ab 2023 "
      + "1.000 € je Person), bei höherer Nutzung verdoppelt. Unveränderte PDFs werden über ihre "
      + "Signatur erkannt und nicht erneut gelesen.\n\n"
      + "Die Werte sind eine Lesehilfe. Vor Abgabe der Steuererklärung immer mit der "
      + "Originalbescheinigung abgleichen.",
  },
  {
    title: "7 · Wertpapiere und Erträge",
    summary: "Käufe, Verkäufe, Dividenden und Bestand",
    text: "Im Bereich „Wertpapiere“ werden zwei Belegarten gelesen, jede über ein eigenes Dateimuster "
      + "in den Einstellungen:\n\n"
      + "• Abrechnungen (Standard: „Wertpapierabrechnung“) mit Stückzahl, Kurs, Kurswert, Provision "
      + "und Steuern. Ob Kauf oder Verkauf, entscheidet zuerst der Dateiname, danach der Belegtext, "
      + "zuletzt die Richtung des Betrags.\n\n"
      + "• Ertragsgutschriften (Standard: „Ertragsgutschrift“) für Dividenden und Ausschüttungen, "
      + "mit Fremdwährung, Quellensteuer und Devisenkurs. Sie verändern den Bestand nicht und "
      + "erscheinen als eigene Zeile „Erträge“ sowie im Netto-Cashflow.\n\n"
      + "MiFID-II-Kosteninformationen werden übersprungen. Es sind Kostensimulationen zu einem noch "
      + "nicht ausgeführten Auftrag, keine Umsätze.\n\n"
      + "Jeder Beleg wird gegengerechnet: Menge mal Kurs muss den Kurswert ergeben, Kurswert plus "
      + "Entgelte den Rechnungsbetrag. Abweichungen erscheinen als Prüfhinweis am Beleg.\n\n"
      + "Der rechnerische Bestand berücksichtigt nur vorhandene Abrechnungen, keine Depotüberträge "
      + "oder Splits.",
  },
  {
    title: "8 · Ansichten",
    summary: "Finanzreport, Wertpapiere, Jahressteuer und Postbox",
    text: "Die App ist in vier Hauptbereiche gegliedert:\n\n"
      + "• Finanzreport: Kategorien, Verlauf und Buchungen für den gewählten Zeitraum.\n\n"
      + "• Wertpapiere: Übersicht, Jahresverlauf, rechnerische Positionen sowie erkannte Abrechnungen "
      + "und Ertragsgutschriften.\n\n"
      + "• Jahressteuer: Übersicht, Verlauf und Anlage KAP mit eigener Jahresnavigation.\n\n"
      + "• Postbox: Dokumente laden, Bestand aktualisieren, suchen und filtern.\n\n"
      + "Im Finanzreport zeigt „Kategorien“ Ringdiagramm und Summen je Gruppe.\n\n"
      + "• Verlauf: Jahreskennzahlen, Geldfluss, Netto-Saldo und Statistik.\n\n"
      + "• Buchungen: Einzelbuchungen nach Monaten gruppiert, mit Suche und Mehrfachauswahl.\n\n"
      + "Die Postbox zeigt sämtliche PDFs des Ordners mit Suche, Jahr und Dokumentart. Finanzreports zeigen "
      + "ihre Prüfsumme, Steuer- und Wertpapierbelege ihren Auswertungsstand. Ein Tipp öffnet die PDF "
      + "beziehungsweise zuerst die erkannten Steuerwerte.\n\n"
      + "Mit ‹ und › wird der Monat gewechselt, über ▦ und ◫ lassen sich Jahr und Monat direkt wählen. "
      + "In der Jahressteuer schalten dieselben Pfeile das Steuerjahr um.",
  },
  {
    title: "9 · Darstellung und Symbole",
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
    title: "10 · Export und Sicherung",
    summary: "CSV, Backup, Konfiguration",
    text: "• CSV-Export Buchungen schreibt zwei Dateien in den Ordner export: eine Übersicht je "
      + "Gruppe und alle Einzelbuchungen des gewählten Zeitraums.\n\n"
      + "• CSV-Export Steuerwerte schreibt alle Felder der Anlage KAP über sämtliche Jahre.\n\n"
      + "• Backup erstellen sichert Einstellungen, Kategorien samt manuellen Zuordnungen, Buchungen, "
      + "Steuer- und Wertpapierwerte ohne Nachfrage nach comdirect/backup, der Dateiname enthält "
      + "Datum und Uhrzeit. „Backup wiederherstellen“ listet alle dort vorhandenen Sicherungen zur "
      + "Auswahl auf; über „Datei auswählen“ lässt sich auch eine Sicherung von außerhalb einlesen.\n\n"
      + "• Die Einstellungen com_fm.ini lassen sich einzeln teilen. Kategorien und manuelle Zuordnungen liegen in categories.json. App-Dateien und Unterordner bleiben "
      + "gemeinsam in ihrem Arbeitsordner; nur die PDF-Ablage darf auf einen Bookmark zeigen.\n\n"
      + "• Comdirect-postbox-settings.json liegt direkt neben com_fm.ini und spiegelt die "
      + "Postbox-Einstellungen in lesbarer JSON-Form.\n\n"
      + "• Vor der ersten Änderung im Kategorien-Editor legt die App eine Sicherung "
      + "categories-backup-<Zeitstempel>.json im Arbeitsordner an. Über „⟲ Sicherung“ im Editor "
      + "lässt sich ein früherer Stand zurückholen; der aktuelle Stand wird dabei zuerst gesichert.\n\n"
      + "• „Auswertung neu aufbauen“ richtet sich nach dem aktiven Bereich: in Finanzen werden nur "
      + "die Buchungen verworfen, in Depot nur die Wertpapierbelege, in Steuer nur die "
      + "Bescheinigungen. Über die zweite Schaltfläche lässt sich alles auf einmal neu aufbauen.\n\n"
      + "• Zugangsdaten liegen ausschließlich im iOS-Keychain und werden nie exportiert.",
  },
  {
    title: "11 · Empfohlener Ablauf",
    summary: "Vom Download bis zur Kontrolle",
    text: "1. In der Postbox neue Dokumente laden oder vorhandene PDFs über die Einstellungen importieren.\n\n"
      + "2. Mit ⟳ den PDF-Bestand erneut einlesen. Neue Finanzreports, Wertpapierabrechnungen und Steuerbescheinigungen "
      + "werden dabei automatisch erkannt.\n\n"
      + "3. Im Finanzreport zuerst den Jahressaldo und anschließend Kategorien und Buchungen prüfen.\n\n"
      + "4. Unpassende Zuordnungen direkt oder per Mehrfachauswahl korrigieren. Manuelle Zuordnungen gelten nur für die gewählten Buchungen; neue Schlüsselwörter wirken auch auf weitere Buchungen.\n\n"
      + "5. In der Jahressteuer alle Prüfhinweise beachten und erkannte Werte mit dem Original-PDF vergleichen.\n\n"
      + "6. Nach größeren Änderungen ein Backup erstellen oder die CSV-Dateien exportieren.",
  },
  {
    title: "12 · Einstellungen",
    summary: "Eingeklappte Bereiche und automatische Speicherung",
    text: "Die Einstellungen sind nach Aufgaben gruppiert und zunächst eingeklappt. Eine Überschrift "
      + "antippen, um ihren Inhalt direkt in der UI zu öffnen. Beim Öffnen eines anderen Abschnitts "
      + "wird der bisherige wieder geschlossen.\n\n"
      + "• PDF-Ablage: lokal bei com_fm.ini oder über einen dauerhaften Scriptable-Dateibookmark.\n\n"
      + "• Comdirect-Zugang: Zugangsdaten und API-Schlüssel im iOS-Keychain.\n\n"
      + "• Postbox-Download: Zeitraum, Dokumentfilter, Unterordner und API-Seitengröße.\n\n"
      + "• Finanzreport: Dateimuster und Zeilenabstand. Der vollständige Kategorien-Editor ist hier als eigener Bereich aufklappbar.\n\n"
      + "• Jahressteuer: Dateimuster der Bescheinigungen.\n\n"
      + "• Wertpapiere: getrennte Dateimuster für Abrechnungen und Ertragsgutschriften.\n\n"
      + "• Startverhalten: Hauptbereich sowie letzter oder neuester Finanzreport-Zeitraum.\n\n"
      + "• Export und Wartung: CSV, Backup, Cache-Neuaufbau und Zurücksetzen.\n\n"
      + "• Protokoll: die letzten Einträge dieses Geräts, mit Schaltflächen zum Aktualisieren, "
      + "Teilen und Leeren.\n\n"
      + "• Ablage und Version: alle Speicherorte im Klartext, hilfreich bei Fragen zur "
      + "Synchronisierung.\n\n"
      + "Alle Änderungen werden sofort gespeichert. Die Darstellung wird ausschließlich über das "
      + "Symbol ◐, ☀︎ oder ☾ in der Hauptansicht umgeschaltet.",
  },
  {
    title: "13 · Tabellen und iPad",
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
    title: "14 · Zwei Geräte und iCloud",
    summary: "Gemeinsamer Stand auf iPhone und iPad",
    text: "Der Arbeitsordner liegt in iCloud Drive unter Scriptable/comdirect. iPhone und iPad "
      + "greifen damit auf dieselben Einstellungen, Kategorien und PDFs zu. Ist iCloud Drive nicht "
      + "aktiv, arbeitet die App im gerätelokalen Ordner weiter, dann ohne Abgleich.\n\n"
      + "Beim ersten Start nach dem Umstieg wird ein vorhandener lokaler Bestand einmalig "
      + "übernommen. Kopiert wird nur, was in iCloud fehlt oder dort älter ist.\n\n"
      + "Werden die Kategorien auf beiden Geräten bearbeitet, führt die App die Stände beim "
      + "Speichern zusammen: Kategorien über den Namen, manuelle Zuordnungen ebenfalls, bei "
      + "Konflikt gewinnt das gerade speichernde Gerät. Gelöschte Kategorien kommen in diesem Fall "
      + "zurück. Wer nacheinander arbeitet, ist davon nicht betroffen.\n\n"
      + "Sicherste Reihenfolge: Änderungen abschließen, die App auf dem Gerät schließen, kurz "
      + "warten, bis iCloud hochgeladen hat, dann erst das andere Gerät starten.\n\n"
      + "Das Protokoll wird je Gerät geführt. Über „Teilen“ im Abschnitt Protokoll lassen sich die "
      + "Dateien beider Geräte gemeinsam ausgeben.",
  },
  {
    title: "15 · Wenn etwas klemmt",
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
      + "wird kurz eine Internetverbindung benötigt.\n\n"
      + "• Änderungen erscheinen nicht auf dem anderen Gerät: unter „Ablage und Version“ prüfen, ob "
      + "der Pfad „Mobile Documents“ enthält. Steht dort „Containers“, ist iCloud Drive für "
      + "Scriptable nicht aktiv.\n\n"
      + "• Speichern der Kategorien abgelehnt: categories.json ist noch nicht aus iCloud geladen. "
      + "Der Abbruch ist Absicht, sonst würde der Stand des anderen Geräts überschrieben. Kurz "
      + "warten und erneut versuchen.\n\n"
      + "• Korrigierte Auswertung wirkt nicht: die alten Werte stecken im Zwischenspeicher. Den "
      + "betroffenen Bereich öffnen und „Auswertung neu aufbauen“ ausführen; ⟳ allein überspringt "
      + "unveränderte PDFs.\n\n"
      + "• Belege fehlen im Depot: prüfen, ob der Dateiname zum jeweiligen Muster passt. "
      + "Abrechnungen und Ertragsgutschriften haben getrennte Muster.\n\n"
      + "• Unklar, was zuletzt passiert ist: das Protokoll in den Einstellungen führt Start, "
      + "Migration, iCloud-Downloads, Kategorienänderungen und verworfene Zwischenspeicher.",
  },
];

function addHelpParagraph(text) {
  const value = String(text || "").trim();
  if (!value) return;
  const perLine = Math.max(44, Math.round(screenWidth() / 7));
  const wrappedLines = value.split("\n")
    .reduce((sum, line) => sum + Math.max(1, Math.ceil(line.length / perLine)), 0);
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
  else if (VIEW.name === "bulkAssign") buildBulkAssign(VIEW.ids);
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
    infos.push(parseReport(entry.file, entry.pages, cfg.groups, bookings, categoryData.assignments));
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
  const tradeFiles = docFiles.map((f) => f.relative)
    .filter((r) => isTradeFile(r) || isIncomeFile(r));
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
        bookings = ensureBookingIds(cached.bookings);
        fileInfos = cached.files || [];
        refreshBookingCategories();
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
      const sig = fileSignature(certPath, "tax");
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
      const tradePath = sourceFm.joinPath(source.path, name), sig = fileSignature(tradePath, "trade");
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
      bookings = ensureBookingIds(old.bookings);
      fileInfos = old.files || [];
      refreshBookingCategories();
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
  logLine(`Start ${VERSION} · Ablage ${ICLOUD_ACTIVE ? "iCloud" : "lokal"} · ${dirs.root}`, "start");
  cfg = loadRuntimeConfig(dirs);
  APPEARANCE = cfg.appearance || "system";
  source = resolveStorage(dirs, cfg.path);

  // Zuletzt erfolgreich gelesene Daten sofort darstellen. Damit ist die
  // Tabelle beim Start gefüllt, auch wenn iCloud noch synchronisiert.
  const cached = readBookingsCache(dirs, cfg.path);
  if (cached && cached.bookings.length) {
    bookings = ensureBookingIds(cached.bookings);
    fileInfos = cached.files || [];
    refreshBookingCategories();
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
