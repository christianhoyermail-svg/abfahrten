# Meine Abfahrten – BVG Favoriten-WebApp

Favorisierte Tram-, Bus-, U- und S-Bahn-Haltestellen mit fester Fahrtrichtung.
Ein Klick auf eine Station zeigt die nächsten 3 Abfahrten in dieser Richtung inkl. Verspätung.

## Als App aufs Smartphone (PWA)
Die App ist eine installierbare Progressive Web App. Nach der Installation liegt sie mit eigenem
Icon auf dem Home-Bildschirm, startet ohne Browserleiste und lädt die App-Dateien aus dem Speicher
des Handys. Nur die Abfahrtsdaten kommen live aus dem Internet.

Smartphones installieren PWAs nur von einer **HTTPS-Adresse**. Deshalb muss der Ordner einmalig
auf einen kostenlosen Hoster:

**GitHub Pages (empfohlen, dauerhaft kostenlos)**
1. Auf github.com ein Konto anlegen → **New repository** (z. B. `abfahrten`, *Public*).
2. **Add file → Upload files** → alle Dateien und den Ordner `icons` hineinziehen → *Commit*.
3. **Settings → Pages** → Source: *Deploy from a branch*, Branch `main`, Ordner `/ (root)` → *Save*.
4. Nach ca. 1 Minute ist die App unter `https://<benutzername>.github.io/abfahrten/` erreichbar.

**Installieren**
- **Android (Chrome):** Adresse öffnen → Button „App installieren“ oben oder Menü ⋮ → *App installieren*.
- **iPhone (Safari):** Adresse öffnen → Teilen-Symbol → *Zum Home-Bildschirm*.

Die Favoriten werden auf dem Handy gespeichert, nicht am PC. Du legst sie also direkt in der App
auf dem Handy an.

**Updates:** Nach Änderungen an den Dateien in `sw.js` die Zeile `const CACHE = 'abfahrten-v1'`
hochzählen (`v2`, `v3` …) und neu hochladen. Die App holt sich die neue Version beim nächsten Start.

## Schnelltest im Heimnetz (ohne Hosting)
`start-server.bat` doppelklicken (benötigt Python) und die angezeigte Adresse
`http://192.168.x.x:8080` am Handy im selben WLAN öffnen. Das eignet sich nur zum Ausprobieren:
Über `http://` ist keine echte Installation und kein Offline-Start möglich, und der PC muss laufen.

Am PC selbst reicht ein Doppelklick auf `index.html`.

## Bedienung
1. **+ Station** → Haltestelle suchen.
2. **Fahrtrichtung** wählen: entweder ein aktuelles Fahrtziel antippen oder eine beliebige
   Haltestelle suchen, die in deiner Richtung liegt (z. B. die nächste Station). Es werden alle
   Fahrten angezeigt, die über diese Haltestelle fahren – dadurch zählen auch verkürzte Fahrten mit.
3. Optional einzelne **Linien** auswählen (nichts gewählt = alle Linien).
4. Optional einen eigenen Namen vergeben → Speichern.

### Export / Import
Unter der Liste:
- **⤓ Exportieren** speichert alle Favoriten als JSON-Datei. Auf dem Handy öffnet sich stattdessen
  das Teilen-Menü (Dateien, Mail, Messenger …).
- **⤒ Importieren** lädt eine solche Datei. Vor dem Import zeigt eine Vorschau den Inhalt. Mit
  **Hinzufügen** werden nur neue Favoriten ergänzt (bereits vorhandene werden übersprungen), mit
  **Alle ersetzen** wird die bestehende Liste überschrieben.

So lassen sich Favoriten z. B. vom PC aufs Handy übertragen oder sichern.

Geöffnete Stationen aktualisieren sich alle 30 Sekunden. Über die Symbole lassen sich Favoriten
neu laden, sortieren, bearbeiten und löschen.

## Technik
- Daten: [v6.bvg.transport.rest](https://v6.bvg.transport.rest/) (Fallback: v6.vbb.transport.rest)
  - `/locations` – Haltestellensuche
  - `/stops/:id/departures?direction=:id` – Abfahrten gefiltert nach Fahrtrichtung
- Favoriten liegen im `localStorage` des Browsers (pro Gerät/Browser).
- Die API erlaubt max. ~100 Anfragen/Minute.
