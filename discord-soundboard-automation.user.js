// ==UserScript==
// @name         Discord Soundboard Automation
// @namespace    http://tampermonkey.net/
// @version      1.0
// @description  Automatizza la riproduzione della soundboard di Discord
// @author       Xx-Azazel
// @match        https://discord.com/*
// @grant        none
// ==/UserScript==

(function() {
    'use strict';

    let automationActive = false;
    let selectedSounds = [];
    let automationInterval = null;
    let controlPanel = null;

    // Funzione per creare il pannello di controllo
    function createControlPanel() {
        if (controlPanel) return;

        controlPanel = document.createElement('div');
        controlPanel.style.cssText = `
            position: fixed;
            top: 10px;
            right: 10px;
            width: 300px;
            background: #2f3136;
            border: 1px solid #4f545c;
            border-radius: 8px;
            padding: 15px;
            z-index: 10000;
            color: white;
            font-family: Whitney, Helvetica Neue, Helvetica, Arial, sans-serif;
            font-size: 14px;
            box-shadow: 0 8px 16px rgba(0,0,0,0.24);
        `;

        controlPanel.innerHTML = `
            <div style="font-weight: bold; margin-bottom: 10px; color: #ffffff;">
                🎵 Soundboard Automation
            </div>
            <button id="scanSounds" style="width: 100%; margin-bottom: 10px; padding: 8px; background: #5865f2; color: white; border: none; border-radius: 4px; cursor: pointer;">
                Scansiona Suoni
            </button>
            <div id="soundsList" style="max-height: 150px; overflow-y: auto; margin-bottom: 10px; border: 1px solid #4f545c; border-radius: 4px; padding: 5px;">
                Clicca "Scansiona Suoni" per iniziare
            </div>
            <div style="margin-bottom: 10px;">
                <label>Intervallo (ms):</label>
                <input type="number" id="intervalInput" value="5000" min="1000" style="width: 100%; padding: 5px; margin-top: 5px; background: #40444b; color: white; border: 1px solid #4f545c; border-radius: 4px;">
            </div>
            <div style="display: flex; gap: 10px;">
                <button id="startAutomation" style="flex: 1; padding: 8px; background: #3ba55c; color: white; border: none; border-radius: 4px; cursor: pointer;">
                    Avvia
                </button>
                <button id="stopAutomation" style="flex: 1; padding: 8px; background: #ed4245; color: white; border: none; border-radius: 4px; cursor: pointer;">
                    Stop
                </button>
            </div>
            <div id="status" style="margin-top: 10px; text-align: center; font-size: 12px; color: #b9bbbe;">
                Pronto
            </div>
        `;

        document.body.appendChild(controlPanel);
        setupEventListeners();
    }

    // Funzione per scansionare i suoni disponibili
    function scanSounds() {
        const soundButtons = document.querySelectorAll('[data-type="soundboard-sound"]');
        const soundsList = document.getElementById('soundsList');
        
        if (soundButtons.length === 0) {
            soundsList.innerHTML = '<div style="color: #ed4245;">Nessun suono trovato. Assicurati che la soundboard sia aperta.</div>';
            return;
        }

        soundsList.innerHTML = '';
        soundButtons.forEach((button, index) => {
            const soundName = button.querySelector('div[class*="soundName"]')?.textContent || `Suono ${index + 1}`;
            
            const checkbox = document.createElement('div');
            checkbox.style.cssText = `
                display: flex;
                align-items: center;
                margin: 5px 0;
                padding: 5px;
                border-radius: 4px;
                cursor: pointer;
                background: #36393f;
            `;
            
            checkbox.innerHTML = `
                <input type="checkbox" id="sound_${index}" style="margin-right: 8px;">
                <label for="sound_${index}" style="cursor: pointer; flex: 1;">${soundName}</label>
            `;
            
            checkbox.addEventListener('click', (e) => {
                if (e.target.type !== 'checkbox') {
                    const cb = checkbox.querySelector('input[type="checkbox"]');
                    cb.checked = !cb.checked;
                }
                updateSelectedSounds();
            });
            
            soundsList.appendChild(checkbox);
        });
        
        updateStatus(`Trovati ${soundButtons.length} suoni`);
    }

    // Funzione per aggiornare la lista dei suoni selezionati
    function updateSelectedSounds() {
        selectedSounds = [];
        const checkboxes = document.querySelectorAll('#soundsList input[type="checkbox"]:checked');
        
        checkboxes.forEach(checkbox => {
            const index = parseInt(checkbox.id.split('_')[1]);
            const soundButton = document.querySelectorAll('[data-type="soundboard-sound"]')[index];
            if (soundButton) {
                selectedSounds.push(soundButton);
            }
        });
        
        updateStatus(`${selectedSounds.length} suoni selezionati`);
    }

    // Funzione per riprodurre un suono casuale
    function playRandomSound() {
        if (selectedSounds.length === 0) {
            stopAutomation();
            updateStatus('Nessun suono selezionato');
            return;
        }

        const randomIndex = Math.floor(Math.random() * selectedSounds.length);
        const soundButton = selectedSounds[randomIndex];
        
        if (soundButton && soundButton.isConnected) {
            soundButton.click();
            updateStatus(`Riprodotto: ${soundButton.querySelector('div[class*="soundName"]')?.textContent || 'Suono sconosciuto'}`);
        } else {
            // Rimuovi suoni non più disponibili
            selectedSounds.splice(randomIndex, 1);
            if (selectedSounds.length === 0) {
                stopAutomation();
                updateStatus('Tutti i suoni sono diventati non disponibili');
            }
        }
    }

    // Funzione per avviare l'automazione
    function startAutomation() {
        if (selectedSounds.length === 0) {
            updateStatus('Seleziona almeno un suono');
            return;
        }

        const interval = parseInt(document.getElementById('intervalInput').value);
        if (interval < 1000) {
            updateStatus('Intervallo minimo: 1000ms');
            return;
        }

        automationActive = true;
        automationInterval = setInterval(playRandomSound, interval);
        updateStatus(`Automazione avviata (${interval}ms)`);
        
        document.getElementById('startAutomation').style.background = '#4f545c';
        document.getElementById('stopAutomation').style.background = '#ed4245';
    }

    // Funzione per fermare l'automazione
    function stopAutomation() {
        automationActive = false;
        if (automationInterval) {
            clearInterval(automationInterval);
            automationInterval = null;
        }
        
        updateStatus('Automazione fermata');
        document.getElementById('startAutomation').style.background = '#3ba55c';
        document.getElementById('stopAutomation').style.background = '#4f545c';
    }

    // Funzione per aggiornare lo status
    function updateStatus(message) {
        const statusElement = document.getElementById('status');
        if (statusElement) {
            statusElement.textContent = message;
        }
    }

    // Setup event listeners
    function setupEventListeners() {
        document.getElementById('scanSounds').addEventListener('click', scanSounds);
        document.getElementById('startAutomation').addEventListener('click', startAutomation);
        document.getElementById('stopAutomation').addEventListener('click', stopAutomation);
    }

    // Inizializzazione quando Discord è caricato
    function init() {
        if (window.location.hostname === 'discord.com') {
            // Aspetta che Discord sia completamente caricato
            setTimeout(() => {
                createControlPanel();
            }, 3000);
        }
    }

    // Avvia l'inizializzazione
    init();

    // Gestione navigazione SPA di Discord
    let lastUrl = location.href;
    new MutationObserver(() => {
        const url = location.href;
        if (url !== lastUrl) {
            lastUrl = url;
            setTimeout(init, 1000);
        }
    }).observe(document, { subtree: true, childList: true });

})();