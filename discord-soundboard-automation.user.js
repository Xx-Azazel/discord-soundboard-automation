// ==UserScript==
// @name         Discord Soundboard Automation (v2.3 Safe + React Handler Cache)
// @namespace    http://tampermonkey.net/
// @version      2.3
// @description  Automatizza la soundboard con ALT+Click, strategie multiple di riproduzione e fix safeLower() per className non stringa.
// @author       Xx-Azazel
// @match        https://discord.com/*
// @grant        none
// ==/UserScript==

(function() {
  'use strict';

  /**************** CONFIG ****************/
  const MIN_INTERVAL_MS = 1000;
  const SAVE_SELECTIONS = true;
  const STORAGE_KEY = 'dsb_auto_selected_xpath_v23';
  const HIGHLIGHT_MS = 900;
  const AUTO_RESOLVE_OPEN_BUTTON = true;
  const OPEN_BUTTON_TEXT_CUES = ['soundboard','sound board','suoni','sound'];
  const PLAY_STRATEGY_TIMEOUT_MS = 1200;
  const MAX_FALLBACK_SCAN = 4000; // limite nodi fallback ricerca testo

  /**************** STATE ****************/
  let panel;
  let automationTimer = null;
  let automationActive = false;
  let altRecordMode = false;

  // Ogni selezione: { xpath, labelGuess, reactHandlers?: [fn], pathIndices?: number[] }
  let selections = [];
  let lastPlayInfo = null;
  let lastResolvedPlayElement = null;

  /**************** UTILS ****************/
  const log  = (...a)=>console.log('[SoundboardAuto]',...a);
  const warn = (...a)=>console.warn('[SoundboardAuto]',...a);
  const err  = (...a)=>console.error('[SoundboardAuto]',...a);

  function safeLower(val){
    if (typeof val === 'string') return val.toLowerCase();
    if (val && typeof val === 'object') {
      if (typeof val.baseVal === 'string') return val.baseVal.toLowerCase();
    }
    return '';
  }

  function xpathFor(el) {
    if (!el || el.nodeType !== 1) return null;
    const parts = [];
    while (el && el.nodeType === 1 && el !== document.body && el !== document.documentElement) {
      let i = 0, p = el.previousElementSibling;
      while (p) { if (p.nodeName === el.nodeName) i++; p = p.previousElementSibling; }
      parts.unshift(el.nodeName.toLowerCase() + (i ? `[${i+1}]` : ''));
      el = el.parentElement;
    }
    return '/' + parts.join('/');
  }

  function elementFromXPath(xp){
    if(!xp) return null;
    try { return document.evaluate(xp,document,null,XPathResult.FIRST_ORDERED_NODE_TYPE,null).singleNodeValue; }
    catch { return null; }
  }

  function highlight(el,color='rgba(88,101,242,0.45)') {
    if(!el||!el.getBoundingClientRect) return;
    const r=el.getBoundingClientRect();
    const o=document.createElement('div');
    o.style.position='fixed';
    o.style.left=r.left+'px';
    o.style.top=r.top+'px';
    o.style.width=r.width+'px';
    o.style.height=r.height+'px';
    o.style.background=color;
    o.style.border='2px solid #5865f2';
    o.style.borderRadius='6px';
    o.style.pointerEvents='none';
    o.style.zIndex=999999;
    document.body.appendChild(o);
    setTimeout(()=>o.remove(),HIGHLIGHT_MS);
  }

  function humanClick(el){
    if(!el) return false;
    const rect=el.getBoundingClientRect();
    const cx=rect.left+rect.width/2;
    const cy=rect.top+rect.height/2;
    const opts={bubbles:true,cancelable:true,clientX:cx,clientY:cy};
    try{
      el.dispatchEvent(new PointerEvent('pointerover',opts));
      el.dispatchEvent(new PointerEvent('pointerenter',opts));
      el.dispatchEvent(new PointerEvent('pointerdown',opts));
      el.dispatchEvent(new MouseEvent('mousedown',opts));
      el.dispatchEvent(new PointerEvent('pointerup',opts));
      el.dispatchEvent(new MouseEvent('mouseup',opts));
      el.dispatchEvent(new MouseEvent('click',opts));
      return true;
    }catch(e){
      warn('humanClick error',e);
      return false;
    }
  }

  function escapeHtml(s){
    return (s||'').replace(/[<>&"]/g,c=>({'<':'&lt;','>':'&gt;','&':'&amp;','"':'&quot;'}[c]));
  }

  /**************** HEURISTICS ****************/
  function isInSoundboardViewport(el){
    if(!el) return false;
    let p=el, depth=0;
    while(p && depth<10){
      const role = p.getAttribute?.('role');
      if(role==='dialog'||role==='menu'||role==='group') return true;
      const clsRaw = p.className;
      const cls = safeLower(clsRaw);
      if(cls.includes('sound')||cls.includes('board')||cls.includes('popout')) return true;
      p=p.parentElement; depth++;
    }
    return false;
  }

  function isPotentialSoundElement(el){
    if(!(el instanceof HTMLElement)) return false;
    const cls = safeLower(el.className);
    const aria = safeLower(el.getAttribute?.('aria-label'));
    if(!isInSoundboardViewport(el)) return false;
    if(aria.includes('close')||aria.includes('chiudi')) return false;
    if(cls.includes('sound')||cls.includes('tile')||cls.includes('board')) return true;
    if(el.tagName==='BUTTON') return true;
    if(el.getAttribute('role')==='button') return true;
    if(el.tabIndex>=0) return true;
    return false;
  }

  function candidateFromEventTarget(t){
    if(!t) return null;
    let el=t;
    for(let i=0;i<6 && el;i++){
      if(isPotentialSoundElement(el)) return el;
      el=el.parentElement;
    }
    return null;
  }

  function guessLabel(el){
    if(!el) return 'Suono';
    const trials=[
      ()=>el.getAttribute('aria-label'),
      ()=>el.title,
      ()=> (el.innerText||'').trim(),
      ()=> el.querySelector('[class*="label"]')?.textContent,
      ()=> el.querySelector('[class*="name"]')?.textContent
    ];
    for(const f of trials){
      try{
        const v=f();
        if(v && typeof v === 'string' && v.trim().length && v.trim().length<80) return v.trim();
      }catch{}
    }
    return 'Suono';
  }

  /**************** STORAGE ****************/
  function saveSelections(){
    if(!SAVE_SELECTIONS) return;
    const plain = selections.map(s => ({
      xpath: s.xpath,
      labelGuess: s.labelGuess,
      pathIndices: s.pathIndices || []
    }));
    localStorage.setItem(STORAGE_KEY,JSON.stringify(plain));
  }

  function loadSelections(){
    if(!SAVE_SELECTIONS) return;
    try{
      const raw=localStorage.getItem(STORAGE_KEY);
      if(!raw) return;
      const arr=JSON.parse(raw);
      if(Array.isArray(arr)){
        selections = arr.map(s=>({...s, reactHandlers: []}));
        renderSelectionList();
        status(`Ripristinate ${selections.length} selezioni`);
      }
    }catch{}
  }

  /**************** PANEL ****************/
  function createPanel(){
    if(panel) return;
    panel=document.createElement('div');
    panel.style.cssText=`
      position:fixed;top:12px;right:12px;width:400px;
      background:#2f3136;border:1px solid #444;border-radius:10px;
      padding:14px;z-index:99999;color:#fff;font-family:Whitney,sans-serif;
      font-size:14px;box-shadow:0 10px 28px rgba(0,0,0,0.55);
    `;
    panel.innerHTML=`
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px;">
        <strong>🎵 Soundboard Automation v2.3</strong>
        <div style="display:flex;gap:4px;flex-wrap:wrap;">
          <button id="sb_altrec" style="background:#faa61a;color:#222;border:none;padding:4px 8px;border-radius:4px;cursor:pointer;font-size:11px;">Registra (ALT)</button>
          <button id="sb_test" style="background:#5865f2;color:#fff;border:none;padding:4px 8px;border-radius:4px;cursor:pointer;font-size:11px;">Test</button>
          <button id="sb_dbgplay" style="background:#4f545c;color:#fff;border:none;padding:4px 8px;border-radius:4px;cursor:pointer;font-size:11px;">Debug Chain</button>
        </div>
      </div>
      <div style="display:flex;gap:6px;margin-bottom:8px;">
        <button id="sb_start" style="flex:1;background:#3ba55c;color:#fff;border:none;padding:8px;border-radius:4px;cursor:pointer;">Avvia</button>
        <button id="sb_stop"  style="flex:1;background:#ed4245;color:#fff;border:none;padding:8px;border-radius:4px;cursor:pointer;">Stop</button>
      </div>
      <div style="margin-bottom:10px;">
        <label>Intervallo (ms):</label>
        <input id="sb_interval" type="number" min="${MIN_INTERVAL_MS}" value="5000"
          style="width:100%;margin-top:4px;background:#202225;color:#fff;border:1px solid #555;border-radius:4px;padding:6px;">
      </div>
      <div style="display:flex;gap:6px;margin-bottom:10px;flex-wrap:wrap;">
        <button id="sb_clear" style="flex:1;background:#4f545c;color:#fff;border:none;padding:6px;border-radius:4px;font-size:12px;cursor:pointer;">Pulisci</button>
        <button id="sb_last" style="flex:1;background:#4f545c;color:#fff;border:none;padding:6px;border-radius:4px;font-size:12px;cursor:pointer;">Ispeziona Ultimo</button>
        <button id="sb_loglast" style="flex:1;background:#4f545c;color:#fff;border:none;padding:6px;border-radius:4px;font-size:12px;cursor:pointer;">Log Ultimo</button>
      </div>
      <div id="sb_list" style="max-height:210px;overflow:auto;border:1px solid #444;border-radius:6px;padding:6px;background:#36393f;font-size:13px;margin-bottom:10px;">
        Nessuna selezione. Apri la soundboard e ALT+Click sui suoni.
      </div>
      <div id="sb_status" style="text-align:center;font-size:12px;color:#b9bbbe;">Pronto</div>
    `;
    document.body.appendChild(panel);
    bindPanelEvents();
    loadSelections();
  }

  function bindPanelEvents(){
    panel.querySelector('#sb_altrec').addEventListener('click',toggleAltRecord);
    panel.querySelector('#sb_test').addEventListener('click',()=>playOne(false));
    panel.querySelector('#sb_dbgplay').addEventListener('click',()=>playOne(true));
    panel.querySelector('#sb_start').addEventListener('click',startAutomation);
    panel.querySelector('#sb_stop').addEventListener('click',stopAutomation);
    panel.querySelector('#sb_clear').addEventListener('click',clearSelections);
    panel.querySelector('#sb_last').addEventListener('click',inspectLast);
    panel.querySelector('#sb_loglast').addEventListener('click',logLastPlayInfo);
    window.addEventListener('click',globalAltClickListener,true);
  }

  function status(msg){
    const el=panel?.querySelector('#sb_status');
    if(el) el.textContent=msg;
    log(msg);
  }

  function renderSelectionList(){
    const list=panel.querySelector('#sb_list');
    if(!selections.length){
      list.innerHTML='Nessuna selezione. Usa ALT+Click.';
      return;
    }
    list.innerHTML=selections.map((s,i)=>`
      <div style="display:flex;align-items:center;gap:6px;margin:3px 0;">
        <span style="background:#5865f2;padding:2px 6px;border-radius:3px;font-size:11px;">${i+1}</span>
        <span style="flex:1;">${escapeHtml(s.labelGuess||'Suono')}</span>
        <button data-rm="${i}" style="background:#ed4245;border:none;color:#fff;padding:2px 6px;border-radius:3px;cursor:pointer;font-size:11px;">X</button>
      </div>
    `).join('');
    list.querySelectorAll('[data-rm]').forEach(btn=>{
      btn.addEventListener('click',e=>{
        const idx=parseInt(e.currentTarget.getAttribute('data-rm'));
        selections.splice(idx,1);
        saveSelections();
        renderSelectionList();
        status('Rimosso');
      });
    });
  }

  /**************** RECORDING (ALT+CLICK) ****************/
  function toggleAltRecord(){
    altRecordMode=!altRecordMode;
    const b=panel.querySelector('#sb_altrec');
    if(altRecordMode){
      b.textContent='Fine Reg (ALT)';
      b.style.background='#f04747';
      status('Registrazione attiva (ALT+Click sui suoni)');
    }else{
      b.textContent='Registra (ALT)';
      b.style.background='#faa61a';
      status('Registrazione disattivata');
    }
  }

  function globalAltClickListener(e){
    if(!altRecordMode || !e.altKey) return;
    const cand=candidateFromEventTarget(e.target);
    if(cand){
      addSelection(cand, e);
      highlight(cand,'rgba(250,166,26,0.45)');
    }
  }

  function captureReactHandlers(el){
    const handlers=[];
    const fiber=getReactFiber(el);
    if(!fiber) return handlers;
    const visited=new Set();
    (function walk(f,depth){
      if(!f||depth>25||visited.has(f)) return;
      visited.add(f);
      try{
        const props=f.memoizedProps||f.pendingProps;
        if(props && typeof props==='object'){
          for(const k of Object.keys(props)){
            if(/^onClick/i.test(k) && typeof props[k]==='function'){
              handlers.push(props[k]);
            }
          }
        }
      }catch{}
      walk(f.child, depth+1);
      walk(f.sibling, depth+1);
    })(fiber,0);
    return handlers;
  }

  function buildPathIndices(el){
    const chain=[];
    let cur=el;
    for(let depth=0;depth<12 && cur && cur.parentElement; depth++){
      const parent=cur.parentElement;
      const children=Array.from(parent.children);
      const idx=children.indexOf(cur);
      chain.unshift(idx);
      const cls = safeLower(parent.className);
      if(cls.includes('soundboard')||cls.includes('popout')||cls.includes('layer')) break;
      cur=parent;
    }
    return chain;
  }

  function addSelection(el, originalEvent){
    const xp=xpathFor(el);
    const label=guessLabel(el);
    if(selections.some(s=>s.xpath===xp)){
      status('Già presente');
      return;
    }
    const reactHandlers = captureReactHandlers(el);
    const pathIndices = buildPathIndices(el);
    selections.push({ xpath: xp, labelGuess: label, reactHandlers, pathIndices });
    saveSelections();
    renderSelectionList();
    status(`Aggiunto: ${label}${reactHandlers.length? ' (+handler React)' : ''}`);
  }

  function clearSelections(){
    selections=[];
    saveSelections();
    renderSelectionList();
    status('Selezioni svuotate');
  }

  /**************** OPEN SOUNDBOARD SUPPORT ****************/
  function ensureSoundboardOpen(){
    const visible=selections.some(s=>{
      const el=elementFromXPath(s.xpath);
      return el && el.offsetParent!==null;
    });
    if(visible) return true;
    if(!AUTO_RESOLVE_OPEN_BUTTON) return false;
    const btns=[...document.querySelectorAll('button,[role="button"]')];
    const open=btns.find(b=>{
      const t = safeLower(b.textContent||'');
      const a = safeLower(b.getAttribute?.('aria-label'));
      return OPEN_BUTTON_TEXT_CUES.some(k=>t.includes(k)||a.includes(k));
    });
    if(open){
      humanClick(open);
      log('Tentativo apertura soundboard');
      return true;
    }
    return false;
  }

  /**************** ELEMENT RESOLUTION ****************/
  function resolveViaPathIndices(sel){
    if(!sel.pathIndices || !sel.pathIndices.length) return null;
    const candidates = Array.from(document.querySelectorAll('[role="dialog"],[class*="Popout"],[class*="popout"]'));
    for(const root of candidates){
      let node=root;
      let ok=true;
      for(const idx of sel.pathIndices){
        if(!node.children || !node.children[idx]){ ok=false; break; }
        node=node.children[idx];
      }
      if(ok && node) return node;
    }
    return null;
  }

  function resolveElementForSelection(sel){
    let el=elementFromXPath(sel.xpath);
    if(el && document.contains(el)) return el;
    el = resolveViaPathIndices(sel);
    if(el) return el;
    const part=(sel.labelGuess||'').toLowerCase().slice(0,25);
    if(part){
      const scopeSelectors=['button','[role="button"]','div','span'];
      const scopedNodes=[];
      for(const ss of scopeSelectors){
        const found=document.querySelectorAll(ss);
        for(const n of found){
          if(scopedNodes.length >= MAX_FALLBACK_SCAN) break;
          scopedNodes.push(n);
        }
        if(scopedNodes.length >= MAX_FALLBACK_SCAN) break;
      }
      const match=scopedNodes.find(n=>{
        if(!(n instanceof HTMLElement)) return false;
        if(!isPotentialSoundElement(n)) return false;
        const txt=safeLower(n.textContent||'');
        const aria=safeLower(n.getAttribute?.('aria-label'));
        return txt.includes(part)||aria.includes(part);
      });
      if(match){
        sel.xpath=xpathFor(match);
        saveSelections();
        return match;
      }
    }
    return null;
  }

  function findClickableLeaf(el){
    if(!el) return null;
    const b=el.querySelector('button,[role="button"]');
    if(b && b.offsetParent!==null) return b;
    return el;
  }

  /**************** REACT FIBER HELPERS ****************/
  function getReactFiber(el){
    for(const k in el){
      if(k.startsWith('__reactFiber$')) return el[k];
    }
    return null;
  }

  function attemptReactHandlersCached(sel, baseEl){
    if(!sel.reactHandlers || !sel.reactHandlers.length) return {ok:false, reason:'no_cached_handlers'};
    for(const fn of sel.reactHandlers){
      try{
        fn({ type:'click', target: baseEl, currentTarget: baseEl, bubbles:true, cancelable:true });
        return { ok:true, reason:'cached_handler_invoked' };
      }catch(e){ warn('Errore handler cached', e); }
    }
    return { ok:false, reason:'cached_handlers_failed' };
  }

  function attemptReactFiberSearch(el){
    const fiber=getReactFiber(el);
    if(!fiber) return { ok:false, reason:'no_fiber' };
    const handlers=[];
    const visited=new Set();
    (function walk(f,depth){
      if(!f||depth>20||visited.has(f)) return;
      visited.add(f);
      try{
        const props=f.memoizedProps||f.pendingProps;
        if(props && typeof props==='object'){
          for(const k of Object.keys(props)){
            if(/^onClick/i.test(k) && typeof props[k]==='function'){
              handlers.push(props[k]);
            }
          }
        }
      }catch{}
      walk(f.child, depth+1);
      walk(f.sibling, depth+1);
    })(fiber,0);
    if(!handlers.length) return { ok:false, reason:'no_onClick_found' };
    for(const h of handlers){
      try{
        h({ type:'click', target: el, currentTarget: el, bubbles:true, cancelable:true });
        return { ok:true, reason:'fiber_handler_invoked' };
      }catch(e){ warn('Errore fiber handler', e); }
    }
    return { ok:false, reason:'fiber_handlers_failed' };
  }

  /**************** WEBPACK SCAN (best-effort) ****************/
  function getAllWebpackModuleExports(){
    try{
      const id=Date.now();
      const chunk=[[id],{}, e=>e];
      if(!window.webpackChunkdiscord_app) return [];
      window.webpackChunkdiscord_app.push(chunk);
      window.webpackChunkdiscord_app.pop();
      const cache=chunk[2].c;
      return Object.values(cache).map(m=>m?.exports).filter(Boolean);
    }catch(e){
      return [];
    }
  }

  function attemptSoundboardAPI(baseEl,label){
    const exportsList=getAllWebpackModuleExports();
    let playFn=null;
    for(const ex of exportsList){
      if(!ex) continue;
      try{
        for(const k of Object.keys(ex)){
          const val=ex[k];
          if(typeof val==='function'){
            const src=String(val);
            if(/sound/i.test(src) && /play/i.test(src)){
              playFn=val; break;
            }
          } else if(val && typeof val==='object'){
            for(const kk of Object.keys(val)){
              const sub=val[kk];
              if(typeof sub==='function'){
                const s=String(sub);
                if(/sound/i.test(s) && /play/i.test(s)){
                  playFn=sub; break;
                }
              }
            }
          }
          if(playFn) break;
        }
      }catch{}
      if(playFn) break;
    }
    if(!playFn) return { ok:false, reason:'no_api_function' };
    try{
      playFn(label||'');
      return { ok:true, reason:'api_invoked_placeholder' };
    }catch(e){
      return { ok:false, reason:'api_error:'+e.message };
    }
  }

  /**************** PLAY STRATEGIES ****************/
  async function playElementStrategies(sel, baseEl, label){
    const start=performance.now();
    const chain=[];
    function step(name, data){ chain.push({ step:name, ...data, t:Math.round(performance.now()-start) }); }

    let res = attemptReactHandlersCached(sel, baseEl);
    step('cached_react', res);
    if(res.ok) return { ok:true, chain };

    let ok = humanClick(baseEl);
    step('humanClick_base',{ok});
    if(ok) return {ok:true, chain};

    const child=findClickableLeaf(baseEl);
    if(child && child!==baseEl){
      ok=humanClick(child);
      step('humanClick_child',{ok});
      if(ok) return {ok:true, chain};
      try{
        child.click();
        step('native_click_child',{ok:true});
        return {ok:true, chain};
      }catch(e){
        step('native_click_child',{ok:false,error:e.message});
      }
    }

    const rect=baseEl.getBoundingClientRect();
    const cx=rect.left+rect.width/2;
    const cy=rect.top+rect.height/2;
    let target=document.elementFromPoint(cx,cy);
    if(target && target !== baseEl){
      ok=humanClick(target);
      step('elementFromPoint_click',{ok});
      if(ok) return {ok:true, chain};
    }

    res=attemptReactFiberSearch(baseEl);
    step('react_fiber_base',res);
    if(res.ok) return {ok:true, chain};

    if(child && child!==baseEl){
      res=attemptReactFiberSearch(child);
      step('react_fiber_child',res);
      if(res.ok) return {ok:true, chain};
    }

    res=attemptSoundboardAPI(baseEl,label);
    step('webpack_api',res);
    if(res.ok) return {ok:true, chain};

    try{
      baseEl.click();
      step('native_click_base',{ok:true});
      return { ok:true, chain };
    }catch(e){
      step('native_click_base',{ok:false,error:e.message});
    }

    return { ok:false, chain };
  }

  function ensureSoundboardOpenIfNeeded(){
    ensureSoundboardOpen();
  }

  function playOne(debugMode){
    if(!selections.length){
      stopAutomation();
      status('Nessuna selezione');
      return;
    }
    ensureSoundboardOpenIfNeeded();

    const resolved = selections
      .map(s=>({ sel:s, el: resolveElementForSelection(s) }))
      .filter(r=>r.el && r.el.offsetParent!==null);
    if(!resolved.length){
      status('Nessun elemento visibile');
      return;
    }
    const pick = resolved[Math.floor(Math.random()*resolved.length)];
    const baseEl = pick.el;
    const label = pick.sel.labelGuess || guessLabel(baseEl);

    highlight(baseEl);

    (async ()=>{
      const result = await playElementStrategies(pick.sel, baseEl, label);
      lastPlayInfo={
        timestamp: Date.now(),
        label,
        ok: result.ok,
        chain: result.chain,
        xpath: pick.sel.xpath,
        node: baseEl
      };
      lastResolvedPlayElement = baseEl;
      if(debugMode){
        log('DEBUG CHAIN RESULT', lastPlayInfo);
      }
      status(result.ok ? `Riprodotto (o trigger inviato): ${label}` : `Fallito: ${label}`);
    })();
  }

  function logLastPlayInfo(){
    if(!lastPlayInfo){
      status('Nessun play ancora');
      return;
    }
    log('Ultimo play chain:', lastPlayInfo);
    status('Chain log in console');
  }

  function inspectLast(){
    if(!lastResolvedPlayElement){
      status('Nessun elemento da evidenziare');
      return;
    }
    highlight(lastResolvedPlayElement,'rgba(0,255,140,0.45)');
    status('Ultimo evidenziato');
  }

  /**************** AUTOMATION ****************/
  function startAutomation(){
    if(automationActive) return;
    if(!selections.length){
      status('Seleziona almeno un suono');
      return;
    }
    const interval=parseInt(panel.querySelector('#sb_interval').value);
    if(isNaN(interval)||interval<MIN_INTERVAL_MS){
      status(`Intervallo minimo ${MIN_INTERVAL_MS}`);
      return;
    }
    automationActive=true;
    status(`Automazione avviata (${interval}ms)`);
    automationTimer=setInterval(()=>playOne(false),interval);
  }

  function stopAutomation(){
    if(!automationActive) return;
    automationActive=false;
    clearInterval(automationTimer);
    automationTimer=null;
    status('Automazione fermata');
  }

  /**************** INIT & SPA ****************/
  function init(){
    if(window.location.hostname!=='discord.com') return;
    createPanel();
    status('Pronto - Apri soundboard e ALT+Click');
    log('Script v2.3 caricato');
  }

  init();

  let lastHref=location.href;
  new MutationObserver(()=>{
    if(location.href!==lastHref){
      lastHref=location.href;
      setTimeout(init,600);
    }
  }).observe(document,{childList:true,subtree:true});

})();
