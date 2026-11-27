# Ablauf: comdirect-Abruf (as-built, unverified)

1. Nutzer tippt 🔄 → Aktion `sync`.
2. Zugang aus der Keychain (`Depotbestand.comdirect-credentials`); fehlt er → Einstellungen „Zugang“.
3. OAuth2-Passwort-Grant → Session anlegen → Session-TAN anfordern → Nutzer bestätigt in der photoTAN-App → Session aktivieren.
4. Depots, Positionen, Kontostände, Dividendeneingänge abrufen.
5. Frisch lesen, zusammenführen, Revision erhöhen, Depotdatei speichern; Seite neu aufbauen.
Fehler: Meldung in der Seite, Eintrag in `Fehlerlog.txt`.
