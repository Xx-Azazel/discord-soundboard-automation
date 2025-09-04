# Discord Soundboard Automation

Script per automatizzare la riproduzione della soundboard di Discord a intervalli regolari tramite uno userscript (Tampermonkey / Greasemonkey).

## Caratteristiche
- Interfaccia di controllo sovrapposta su Discord
- Scansione automatica dei suoni disponibili nella soundboard aperta
- Selezione multipla dei suoni da riprodurre
- Intervallo personalizzabile (ms)
- Riproduzione casuale (random) tra i suoni scelti
- Start / Stop con stato aggiornato

## Requisiti
- Browser desktop (Chrome / Edge / Firefox / Brave ecc.)
- Estensione: [Tampermonkey](https://www.tampermonkey.net/) (o compatibile)
- Discord Web (https://discord.com)

## Installazione (Metodo Userscript)
1. Installa Tampermonkey nel tuo browser
2. Clicca sull'icona di Tampermonkey > Create a new script
3. Copia il contenuto del file `discord-soundboard-automation.user.js`
4. Salva (Ctrl+S)
5. Vai su https://discord.com e ricarica la pagina se necessario

## Utilizzo
1. Entra in un canale vocale
2. Apri la soundboard (icona corrispondente)
3. Apparirà in alto a destra il pannello "Soundboard Automation"
4. Clicca "Scansiona Suoni" (assicurati che la soundboard sia visibile)
5. Seleziona uno o più suoni da includere
6. Imposta l'intervallo (millisecondi) – es. 5000 = 5 secondi
7. Premi "Avvia" per cominciare
8. Premi "Stop" per fermare l'automazione

## File del progetto
- `README.md`: Questo file
- `discord-soundboard-automation.user.js`: Userscript principale
- `manifest.json`: Esempio opzionale per estensione (bozza MV2)

## Avvertenze / Nota Etica
Usa questo script responsabilmente. L'abuso della soundboard può risultare fastidioso per gli altri utenti o violare le linee guida di alcuni server. Verifica sempre le regole del server prima di usarlo.

## Esempio di Codice Principale
```javascript
// Esempio di estratto dal file principale
(function() { /* ... codice completo nello userscript ... */ })();
```

## Roadmap (idee future)
- Modalità sequenziale oltre alla random
- Salvataggio selezioni suoni (localStorage)
- Supporto filtri / ricerca suoni
- Timer di stop automatico

## Contributi
Pull Request e suggerimenti benvenuti.

## Licenza
MIT

---
Made with 🎵 by Xx-Azazel