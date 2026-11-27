# Bedrohungsmodell (Ist-Stand, 27.11.2026)

> Profil `references/security/web-app.md`, angewandt auf eine Scriptable-App. Zustände: `IN PLACE` (mit Beleg), `TO BUILD`,
> `VERIFY` (nur ein Echtlauf oder eine Prüfung kann es bestätigen), `MANUAL`. Aus dem Code gelesen = `as-built, unverified`.

## Annahmen
- Ein Nutzer, eigene Geräte mit Gerätesperre; iCloud-Konto des Nutzers ist vertrauenswürdig.
- Scriptable und iOS-Keychain arbeiten wie dokumentiert.
- Fremde Antworten (Yahoo, News, DivvyDiary, Anthropic, PDF-Text, comdirect) sind **nicht** vertrauenswürdig für die HTML-Ausgabe.

## Werte
comdirect-Zugang und Session (Kontozugriff, **Order mit echtem Geld**), Anthropic-/DivvyDiary-Schlüssel, Depot- und Kontodaten, Finanzreports, Steuerdaten.

## Kontrollen
| Kontrolle | Zustand | Beleg / offen |
|---|---|---|
| Zugangsdaten und Schlüssel nur in der Keychain | IN PLACE (as-built, unverified) | `Keychain.set(COMDIRECT_KEYCHAIN_KEY …)` Z. 1329; keine Token-Speicherung in Dateien gefunden (grep `access_token`) |
| Kein Geheimnis im Repository | IN PLACE | `.githooks/pre-commit` (Negativprobe gestoppt) |
| HTML-Ausgabe fremder Daten maskiert (`esc()`) | VERIFY | 311 `esc(`-Aufrufe, 64 `innerHTML`-Stellen; keine vollständige Prüfung (G-07) |
| Order nur nach Bestätigung, nie doppelt | IN PLACE (as-built, unverified) | `orderSend` Z. 11683: Dialog, `ORDER_PENDING = null` vor dem Senden; TAN durch comdirect |
| Aktionen nur aus der eigenen Seite | VERIFY | `shouldAllowRequest` fängt `scriptable:` ab; ob Links aus fremdem HTML (News) Aktionen auslösen können, ungeprüft (G-07) |
| pdf.js-Herkunft geprüft | TO BUILD | von cdnjs ohne Prüfsumme geladen und gespeichert (G-09) |
| Nur HTTPS | IN PLACE (as-built, unverified) | alle Hosts `https://` (grep), `http://` nur SVG-Namensraum |
| Datenschutz KI | VERIFY | Depotzusammensetzung (Namen, ISIN, Anteile, Gesamtwert, Sparrate) geht an Anthropic, wenn KI an ist (G-08) |
| Fehlerlog ohne Geheimnisse | VERIFY | kein `logEvent` mit Token/Passwort gefunden; Inhalte von Fehlermeldungen ungeprüft |

## Nicht abgewehrt (bewusst)
| Was | Folge | Entscheidung |
|---|---|---|
| Entsperrtes Gerät in fremder Hand | Zugriff auf alle Daten und gespeicherten Zugang | iOS-Gerätesperre ist die Grenze |
| Kompromittiertes iCloud-Konto | Depot- und Finanzdaten lesbar | außerhalb der App |
| Daten bei Fremddiensten (Yahoo, DivvyDiary, Anthropic) | Anfragen verraten gehaltene Wertpapiere | Funktion verlangt es; KI nur mit eigenem Schlüssel und Schalter |
