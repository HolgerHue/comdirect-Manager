# Schnittstellen-Index (Ist-Stand)

> Vollständig für alle von außen erreichbaren Stellen (27.11.2026). Ausführliche Doku je Eintrag entsteht, wenn eine Scheibe
> ihn anfasst (progressive backfill). Eine Scriptable-App hat keine Programmierschnittstelle; „öffentlich“ sind hier die
> Aktionen der WebView, die Dateien in iCloud (von zwei Skripten und zwei Geräten geteilt) und die Keychain-Einträge.

## Einstiegspunkte
| Name | Ort | Zweck |
|---|---|---|
| `Finance.js` | `run()` (Z. 16682) | Start der App |
| `Kategorien-Editor.js` | Dateiende | Start des Editors |

## Dateien (Format = Schnittstelle, rückwärtskompatibel halten, D-006)
| Datei | Schreibt | Liest |
|---|---|---|
| `Depotbestand/Depots.json` | Finance.js | Finance.js |
| `Depotbestand/<depot>.json` | Finance.js | Finance.js |
| `Depotbestand/Konten.json`, `Watchlist.json`, `Historie.json`, `Dividendeneingaenge.json`, `Wertpapierbelege.json` | Finance.js | Finance.js |
| `Depotbestand/categories.json` | Finance.js | Finance.js |
| `comdirect/categories.json` | Kategorien-Editor.js | Kategorien-Editor.js; Finance.js nur bei der Übernahme (G-02) |
| `Depotbestand/Finanzreport*.json`, `Steuer.json`, `steuer-cache.json` | Finance.js | Finance.js |
| `comdirect/bookings-cache.json` | altes Finance.js | Kategorien-Editor.js |

## Keychain
| Schlüssel | Inhalt |
|---|---|
| `Depotbestand.comdirect-credentials` | comdirect-Zugang (JSON) |
| `Depotbestand.anthropic-key` | Anthropic-API-Schlüssel |
| `Depotbestand.divvydiary-key` | DivvyDiary-Schlüssel |
| `Depotbestand.tileview`, `Depotbestand.privacy` | Darstellungsschalter |
| `comdirect.categories-editor.theme` | Theme des Editors |

## Aktionen (`scriptable:<aktion>?…`, Verteiler in `run()`)
| Aktion |
|---|
| `acct-edit` |
| `acct-refresh` |
| `analysis` |
| `back` |
| `chart` |
| `copy` |
| `cpos` |
| `depot` |
| `depot-add` |
| `depot-open` |
| `depots` |
| `divin-refresh` |
| `extended-analysis` |
| `fin-bulk` |
| `fin-cat` |
| `fin-ed` |
| `fin-import-finance` |
| `fin-load` |
| `fin-rescan` |
| `fin-source` |
| `finance` |
| `help` |
| `hist-item` |
| `hist-load` |
| `hist-pdf` |
| `history` |
| `icloud-sync` |
| `ideas-refresh` |
| `log-clear` |
| `lump` |
| `mpos` |
| `mpos-add` |
| `name` |
| `news-open` |
| `order` |
| `order-cost` |
| `order-form` |
| `order-review` |
| `order-send` |
| `overview` |
| `plan-commit` |
| `plan-recalc` |
| `price` |
| `priorities` |
| `privacy` |
| `settings` |
| `settings-ai` |
| `settings-ai-key` |
| `settings-ai-run` |
| `settings-buyideas` |
| `settings-creds` |
| `settings-divvy` |
| `settings-divvy-key` |
| `settings-feature` |
| `settings-fold` |
| `settings-fund-reset` |
| `settings-history-reset` |
| `settings-icloud` |
| `settings-import` |
| `settings-log` |
| `settings-pool` |
| `settings-portal` |
| `settings-profile` |
| `settings-retire` |
| `settings-retire-date` |
| `settings-retire-save` |
| `settings-tiles` |
| `settings-txall` |
| `sim` |
| `sim-add` |
| `sim-save` |
| `sync` |
| `tax-set` |
| `ter-edit` |
| `tf-edit` |
| `theme` |
| `tier-set` |
| `tiles` |
| `watch-add` |
| `watch-del` |
