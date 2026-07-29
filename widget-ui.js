// AccessKit Widget UI
(function(){
'use strict';
const ak = window.__ak;
if(!ak) return;
const S = ak.S;

const HTML = `
<button id="ak-fab" aria-label="Open Accessibility Widget" title="Accessibility">
<svg viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="2" stroke-linecap="round">
<circle cx="12" cy="5" r="1.5" fill="white" stroke="none"/>
<path d="M5 9l7 1 7-1M12 10v5M9 20l3-5 3 5"/>
</svg></button>
<div id="ak-fab-tooltip">Accessibility Widget</div>
<div id="ak-panel" role="dialog" aria-label="Accessibility Widget" aria-modal="true">
<div class="ak-header">
<div class="ak-header-left">
<div class="ak-logo"><svg viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="2.5" stroke-linecap="round"><circle cx="12" cy="5" r="1.5" fill="white" stroke="none"/><path d="M5 9l7 1 7-1M12 10v5M9 20l3-5 3 5"/></svg></div>
<div><div class="ak-title">AccessKit</div><div class="ak-subtitle">Accessibility Widget</div></div>
</div>
<div class="ak-header-actions">
<button class="ak-icon-btn" id="ak-reset-btn" title="Reset all settings">↺</button>
<button class="ak-icon-btn" id="ak-close-btn" title="Close" aria-label="Close">✕</button>
</div>
</div>
<div class="ak-tabs" role="tablist">
<button class="ak-tab ak-active" data-tab="read" role="tab"><span class="ak-tab-icon">📖</span>Read</button>
<button class="ak-tab" data-tab="visual" role="tab"><span class="ak-tab-icon">🎨</span>Visual</button>
<button class="ak-tab" data-tab="text" role="tab"><span class="ak-tab-icon">🔤</span>Text</button>
<button class="ak-tab" data-tab="ai" role="tab"><span class="ak-tab-icon">🤖</span>AI</button>
<button class="ak-tab" data-tab="settings" role="tab"><span class="ak-tab-icon">⚙️</span>Settings</button>
</div>
<div class="ak-body">

<div class="ak-section ak-visible" id="ak-tab-read">
<div class="ak-section-label">🔊 Screen Reader</div>
<div class="ak-btn-grid">
<button class="ak-feat-btn" id="ak-read-page"><span class="ak-feat-icon">▶</span>Read Page</button>
<button class="ak-feat-btn" id="ak-read-progress-btn"><span class="ak-feat-icon">📊</span>With Progress</button>
<button class="ak-feat-btn" id="ak-read-section"><span class="ak-feat-icon">🖱️</span>Pick Section</button>
<button class="ak-feat-btn ak-feat-stop" id="ak-stop-btn"><span class="ak-feat-icon">⏹</span>Stop</button>
</div>
<div class="ak-section-label">🔧 Page Tools</div>
<div class="ak-btn-grid">
<button class="ak-feat-btn" id="ak-simplify"><span class="ak-feat-icon">✨</span>Simplify</button>
<button class="ak-feat-btn" id="ak-ruler-btn"><span class="ak-feat-icon">📏</span>Ruler</button>
<button class="ak-feat-btn" id="ak-links-btn"><span class="ak-feat-icon">🔗</span>Highlight Links</button>
<button class="ak-feat-btn" id="ak-heads-btn"><span class="ak-feat-icon">📌</span>Headings</button>
<button class="ak-feat-btn" id="ak-imgs-btn"><span class="ak-feat-icon">🖼️</span>Hide Images</button>
<button class="ak-feat-btn" id="ak-anim-btn"><span class="ak-feat-icon">⏸️</span>Stop Anims</button>
</div>
<div class="ak-section-label">🔍 Zoom</div>
<div class="ak-btn-grid-3">
<button class="ak-feat-btn" id="ak-zoom-out">A−</button>
<button class="ak-feat-btn" id="ak-zoom-reset">100%</button>
<button class="ak-feat-btn" id="ak-zoom-in">A+</button>
</div>
<div class="ak-slider-row" style="margin-top:4px">
<label>Zoom</label>
<input type="range" id="ak-zoom-slider" min="0.5" max="3" step="0.1" value="1">
<span class="ak-val" id="ak-zoom-val">100%</span>
</div>
</div>

<div class="ak-section" id="ak-tab-visual">
<div class="ak-section-label">🎨 Colour Mode</div>
<div class="ak-btn-grid">
<button class="ak-feat-btn" id="ak-contrast-none">Normal</button>
<button class="ak-feat-btn" id="ak-contrast-high">⚡ High</button>
<button class="ak-feat-btn" id="ak-contrast-dark">🌑 Dark</button>
<button class="ak-feat-btn" id="ak-contrast-invert">🔄 Invert</button>
<button class="ak-feat-btn" id="ak-contrast-sepia">☕ Sepia</button>
<button class="ak-feat-btn" id="ak-contrast-bw">⬛ B&amp;W</button>
</div>
<div class="ak-section-label">👁️ Focus &amp; Cursor</div>
<div class="ak-btn-grid">
<button class="ak-feat-btn" id="ak-focus-btn"><span class="ak-feat-icon">🎯</span>Focus Ring</button>
<button class="ak-feat-btn" id="ak-cursor-btn"><span class="ak-feat-icon">🖱️</span>Large Cursor</button>
</div>
</div>

<div class="ak-section" id="ak-tab-text">
<div class="ak-section-label">🔤 Font Size</div>
<div class="ak-font-control">
<button class="ak-font-btn" id="ak-font-down">A−</button>
<div class="ak-font-display" id="ak-font-display">100%</div>
<button class="ak-font-btn" id="ak-font-up">A+</button>
<button class="ak-font-btn" id="ak-font-reset" title="Reset">↺</button>
</div>
<div class="ak-section-label">📝 Font Style</div>
<button class="ak-wide-btn" id="ak-dyslexic-btn">🔤 Dyslexia-Friendly Font</button>
<select class="ak-select" id="ak-voice-select"><option value="">Default Voice</option></select>
<div class="ak-section-label">↕️ Line Spacing</div>
<div class="ak-spacing-control">
<button class="ak-spacing-btn ak-active" data-spacing="line-normal">Normal</button>
<button class="ak-spacing-btn" data-spacing="line-relaxed">Relaxed</button>
<button class="ak-spacing-btn" data-spacing="line-loose">Loose</button>
</div>
<div class="ak-section-label">↔️ Letter Spacing</div>
<div class="ak-spacing-control">
<button class="ak-spacing-btn ak-active" data-spacing="letter-normal">Normal</button>
<button class="ak-spacing-btn" data-spacing="letter-wide">Wide</button>
<button class="ak-spacing-btn" data-spacing="letter-wider">Wider</button>
</div>
<div class="ak-section-label">🔊 Speech Speed</div>
<div class="ak-slider-row">
<label>Speed</label>
<input type="range" id="ak-rate" min="0.5" max="2" step="0.1" value="1">
<span class="ak-val" id="ak-rate-val">1.0×</span>
</div>
<div class="ak-slider-row">
<label>Pitch</label>
<input type="range" id="ak-pitch" min="0.5" max="2" step="0.1" value="1">
<span class="ak-val" id="ak-pitch-val">1.0</span>
</div>
<div class="ak-slider-row">
<label>Volume</label>
<input type="range" id="ak-vol" min="0" max="1" step="0.05" value="1">
<span class="ak-val" id="ak-vol-val">100%</span>
</div>
<button class="ak-wide-btn" id="ak-test-voice" style="margin-top:4px">▶ Test Voice</button>
</div>

<div class="ak-section" id="ak-tab-ai">
<div class="ak-section-label">✨ AI Tools</div>
<button class="ak-wide-btn ak-primary" id="ak-summarize-btn">📋 Summarize This Page</button>
<div class="ak-summary-box" id="ak-summary-box"></div>
<button class="ak-wide-btn" id="ak-simplify-text-btn">🔄 Simplify Selected Text</button>
<div class="ak-summary-box" id="ak-simplified-box"></div>
<div class="ak-section-label">💬 Page Q&amp;A</div>
<div class="ak-chat-msgs" id="ak-chat-msgs">
<div class="ak-chat-bubble ak-bot">Ask me anything about this page!</div>
</div>
<div class="ak-chat-input-row">
<input class="ak-chat-input" id="ak-chat-input" placeholder="Ask a question…" autocomplete="off">
<button class="ak-chat-send" id="ak-chat-send">Ask</button>
</div>
</div>

<div class="ak-section" id="ak-tab-settings">
<div class="ak-section-label">🔑 Mistral API Key</div>
<div class="ak-api-row">
<input type="password" class="ak-api-input" id="ak-api-key" placeholder="Enter Mistral API key…">
<button class="ak-save-btn" id="ak-api-save">Save</button>
</div>
<div class="ak-status" id="ak-api-status">
<div class="ak-dot" id="ak-api-dot"></div>
<span class="ak-status-text" id="ak-api-text">No key set</span>
</div>
<div class="ak-section-label">⌨️ Keyboard Shortcuts</div>
<div class="ak-shortcut-row">
<span class="ak-kbd">Alt + A</span><span style="font-size:11px;color:var(--ak-muted)">Open/Close</span>
</div>
<div class="ak-shortcut-row">
<span class="ak-kbd">Alt + R</span><span style="font-size:11px;color:var(--ak-muted)">Read Page</span>
</div>
<div class="ak-shortcut-row">
<span class="ak-kbd">Alt + S</span><span style="font-size:11px;color:var(--ak-muted)">Stop Reading</span>
</div>
<div class="ak-shortcut-row">
<span class="ak-kbd">Esc</span><span style="font-size:11px;color:var(--ak-muted)">Close Panel</span>
</div>
<div class="ak-section-label">ℹ️ About</div>
<p style="font-size:11px;color:var(--ak-muted);line-height:1.6">AccessKit — Free embeddable accessibility widget. Powered by Mistral AI. Drop one script tag on any website.</p>
</div>

</div>
</div>
<div id="ak-read-progress"><div id="ak-read-progress-fill"></div></div>
<div id="ak-read-progress-label"></div>
<div id="ak-ruler"></div>
<div id="ak-section-tip"></div>
<div id="ak-toast" role="status" aria-live="polite"></div>
`;

// Mount
const host = document.createElement('div');
host.id = 'ak-host';
document.body.appendChild(host);
host.innerHTML = HTML;

// Load voices
function loadVoices(){
  const sel = document.getElementById('ak-voice-select');
  const voices = speechSynthesis.getVoices().filter(v=>v.lang.startsWith('en'));
  voices.forEach(v=>{
    const o = document.createElement('option');
    o.value = v.name; o.textContent = v.name.replace(/\s*\(.*\)/,'');
    if(v.name === S.voice) o.selected = true;
    sel.appendChild(o);
  });
}
speechSynthesis.onvoiceschanged = loadVoices;
setTimeout(loadVoices, 500);

// Panel toggle
const fab = document.getElementById('ak-fab');
const panel = document.getElementById('ak-panel');
let panelOpen = false;
function openPanel(){ panelOpen=true; panel.classList.add('ak-open'); fab.setAttribute('aria-expanded','true'); }
function closePanel(){ panelOpen=false; panel.classList.remove('ak-open'); fab.setAttribute('aria-expanded','false'); }
fab.addEventListener('click', ()=>{ panelOpen ? closePanel() : openPanel(); });
document.getElementById('ak-close-btn').addEventListener('click', closePanel);
document.addEventListener('keydown', e=>{
  if(e.altKey && e.key==='a'){ e.preventDefault(); panelOpen?closePanel():openPanel(); }
  if(e.altKey && e.key==='r'){ e.preventDefault(); ak.readPage(); }
  if(e.altKey && e.key==='s'){ e.preventDefault(); ak.stopSpeaking(); }
  if(e.key==='Escape' && panelOpen) closePanel();
});

// Tabs
document.querySelectorAll('.ak-tab').forEach(tab=>{
  tab.addEventListener('click',()=>{
    document.querySelectorAll('.ak-tab').forEach(t=>t.classList.remove('ak-active'));
    document.querySelectorAll('.ak-section').forEach(s=>s.classList.remove('ak-visible'));
    tab.classList.add('ak-active');
    const sec = document.getElementById('ak-tab-'+tab.dataset.tab);
    if(sec) sec.classList.add('ak-visible');
  });
});

// Read tab
document.getElementById('ak-read-page').addEventListener('click', ()=>ak.readPage());
document.getElementById('ak-read-progress-btn').addEventListener('click', ()=>ak.readWithProgress());
document.getElementById('ak-read-section').addEventListener('click', ()=>{
  closePanel(); ak.toggleSectionRead();
  document.getElementById('ak-read-section').classList.toggle('ak-on');
});
document.getElementById('ak-stop-btn').addEventListener('click', ()=>ak.stopSpeaking());
document.getElementById('ak-simplify').addEventListener('click', ()=>ak.simplifyPage());

// Ruler
document.getElementById('ak-ruler-btn').addEventListener('click', ()=>{
  ak.toggleRuler();
  document.getElementById('ak-ruler-btn').classList.toggle('ak-on', S.rulerOn);
});

// Links / Headings / Images / Anims
document.getElementById('ak-links-btn').addEventListener('click', ()=>{
  ak.toggleHighlightLinks();
  document.getElementById('ak-links-btn').classList.toggle('ak-on', S.highlightLinks);
});
document.getElementById('ak-heads-btn').addEventListener('click', ()=>{
  ak.toggleHighlightHeadings();
  document.getElementById('ak-heads-btn').classList.toggle('ak-on', S.highlightHeadings);
});
document.getElementById('ak-imgs-btn').addEventListener('click', ()=>{
  ak.toggleHideImages();
  document.getElementById('ak-imgs-btn').classList.toggle('ak-on', S.hideImages);
});
document.getElementById('ak-anim-btn').addEventListener('click', ()=>{
  ak.toggleAnimations();
  document.getElementById('ak-anim-btn').classList.toggle('ak-on', S.animationsOff);
});

// Zoom
document.getElementById('ak-zoom-in').addEventListener('click', ()=>{ ak.zoomIn(); syncZoom(); });
document.getElementById('ak-zoom-out').addEventListener('click', ()=>{ ak.zoomOut(); syncZoom(); });
document.getElementById('ak-zoom-reset').addEventListener('click', ()=>{ ak.zoomReset(); syncZoom(); });
document.getElementById('ak-zoom-slider').addEventListener('input', e=>{
  ak.setZoom(parseFloat(e.target.value)); syncZoom();
});
function syncZoom(){
  document.getElementById('ak-zoom-slider').value = S.zoomLevel;
  document.getElementById('ak-zoom-val').textContent = Math.round(S.zoomLevel*100)+'%';
  document.getElementById('ak-zoom-reset').textContent = Math.round(S.zoomLevel*100)+'%';
}

// Contrast buttons
['none','high','dark','invert','sepia','bw'].forEach(mode=>{
  const btn = document.getElementById('ak-contrast-'+mode);
  if(!btn) return;
  btn.addEventListener('click', ()=>{
    ak.setContrast(mode);
    document.querySelectorAll('[id^="ak-contrast-"]').forEach(b=>b.classList.remove('ak-on'));
    btn.classList.add('ak-on');
  });
});
if(S.contrastMode && S.contrastMode!=='none'){
  const b = document.getElementById('ak-contrast-'+S.contrastMode);
  if(b) b.classList.add('ak-on');
}

// Focus ring / Cursor
document.getElementById('ak-focus-btn').addEventListener('click', ()=>{
  ak.toggleFocusRing();
  document.getElementById('ak-focus-btn').classList.toggle('ak-on', S.focusRingOn);
});
const cursorSizes = ['normal','large','xl'];
let cursorIdx = 0;
document.getElementById('ak-cursor-btn').addEventListener('click', ()=>{
  cursorIdx = (cursorIdx+1) % cursorSizes.length;
  ak.setCursor(cursorSizes[cursorIdx]);
  document.getElementById('ak-cursor-btn').classList.toggle('ak-on', cursorIdx!==0);
  document.getElementById('ak-cursor-btn').querySelector('span').textContent =
    cursorIdx===0?'🖱️':cursorIdx===1?'🔍':'🔎';
});

// Text tab
document.getElementById('ak-font-up').addEventListener('click', ()=>{ ak.fontUp(); syncFont(); });
document.getElementById('ak-font-down').addEventListener('click', ()=>{ ak.fontDown(); syncFont(); });
document.getElementById('ak-font-reset').addEventListener('click', ()=>{ ak.fontReset(); syncFont(); });
function syncFont(){ document.getElementById('ak-font-display').textContent = S.fontSize+'%'; }

document.getElementById('ak-dyslexic-btn').addEventListener('click', ()=>{
  ak.toggleDyslexic();
  document.getElementById('ak-dyslexic-btn').textContent = S.dyslexicOn ? '✓ Dyslexia Font ON' : '🔤 Dyslexia-Friendly Font';
  document.getElementById('ak-dyslexic-btn').classList.toggle('ak-on', S.dyslexicOn);
});

document.getElementById('ak-voice-select').addEventListener('change', e=>{
  S.voice = e.target.value; ak.save();
});

// Spacing buttons
document.querySelectorAll('[data-spacing]').forEach(btn=>{
  btn.addEventListener('click', ()=>{
    const [type, val] = btn.dataset.spacing.split('-');
    const map = { line: 'lineSpacing', letter: 'letterSpacing' };
    if(map[type]){
      S[map[type]] = val;
      document.querySelectorAll(`[data-spacing^="${type}-"]`).forEach(b=>b.classList.remove('ak-active'));
      btn.classList.add('ak-active');
      ak.applySpacing();
    }
  });
});

// Speech sliders
document.getElementById('ak-rate').addEventListener('input', e=>{
  S.rate = parseFloat(e.target.value);
  document.getElementById('ak-rate-val').textContent = S.rate.toFixed(1)+'×';
  ak.save();
});
document.getElementById('ak-pitch').addEventListener('input', e=>{
  S.pitch = parseFloat(e.target.value);
  document.getElementById('ak-pitch-val').textContent = S.pitch.toFixed(1);
  ak.save();
});
document.getElementById('ak-vol').addEventListener('input', e=>{
  S.volume = parseFloat(e.target.value);
  document.getElementById('ak-vol-val').textContent = Math.round(S.volume*100)+'%';
  ak.save();
});
document.getElementById('ak-test-voice').addEventListener('click', ()=>{
  ak.speak('Hello! This is how I sound. Accessibility made easy with AccessKit.');
});

// AI tab
document.getElementById('ak-summarize-btn').addEventListener('click', async ()=>{
  const box = document.getElementById('ak-summary-box');
  box.textContent = 'Summarizing…'; box.classList.add('ak-visible');
  const text = await ak.aiSummarize();
  box.textContent = text || 'Could not summarize. Check your API key.';
});
document.getElementById('ak-simplify-text-btn').addEventListener('click', async ()=>{
  const sel = window.getSelection()?.toString()?.trim();
  if(!sel){ ak.toast('Select some text first'); return; }
  const box = document.getElementById('ak-simplified-box');
  box.textContent = 'Simplifying…'; box.classList.add('ak-visible');
  const text = await ak.aiSimplifyText(sel);
  box.textContent = text || 'Error simplifying text.';
  if(text) ak.speak(text);
});

// Chat
const chatMsgs = document.getElementById('ak-chat-msgs');
const chatInput = document.getElementById('ak-chat-input');
function addBubble(text, role){
  const b = document.createElement('div');
  b.className = 'ak-chat-bubble ak-'+role;
  b.textContent = text;
  chatMsgs.appendChild(b);
  chatMsgs.scrollTop = chatMsgs.scrollHeight;
  return b;
}
async function sendChat(){
  const q = chatInput.value.trim(); if(!q) return;
  chatInput.value = '';
  addBubble(q, 'user');
  const thinking = addBubble('Thinking…', 'thinking');
  const res = await ak.aiAnswer(q, S.chatHistory);
  thinking.remove();
  if(res.error){ addBubble('Error: '+res.error, 'bot'); return; }
  addBubble(res.text, 'bot');
  S.chatHistory.push({role:'user',content:q},{role:'assistant',content:res.text});
  if(S.chatHistory.length > 12) S.chatHistory.splice(0,2);
}
document.getElementById('ak-chat-send').addEventListener('click', sendChat);
chatInput.addEventListener('keydown', e=>{ if(e.key==='Enter') sendChat(); });

// API key
document.getElementById('ak-api-save').addEventListener('click', ()=>{
  const key = document.getElementById('ak-api-key').value.trim();
  S.mistralKey = key; ak.save();
  const dot = document.getElementById('ak-api-dot');
  const txt = document.getElementById('ak-api-text');
  if(key){ dot.className='ak-dot ak-ok'; txt.textContent='API key saved ✓'; }
  else { dot.className='ak-dot ak-err'; txt.textContent='No key set'; }
  ak.toast('API key saved');
});
if(S.mistralKey){
  document.getElementById('ak-api-key').value = S.mistralKey;
  document.getElementById('ak-api-dot').className = 'ak-dot ak-ok';
  document.getElementById('ak-api-text').textContent = 'API key set ✓';
}

// Reset all
document.getElementById('ak-reset-btn').addEventListener('click', ()=>{
  if(!confirm('Reset all accessibility settings?')) return;
  localStorage.removeItem('__ak_state');
  location.reload();
});

// Restore slider values from saved state
document.getElementById('ak-rate').value = S.rate||1;
document.getElementById('ak-rate-val').textContent = (S.rate||1).toFixed(1)+'×';
document.getElementById('ak-pitch').value = S.pitch||1;
document.getElementById('ak-pitch-val').textContent = (S.pitch||1).toFixed(1);
document.getElementById('ak-vol').value = S.volume||1;
document.getElementById('ak-vol-val').textContent = Math.round((S.volume||1)*100)+'%';
syncZoom(); syncFont();

// Apply persisted state
ak.applyAll();
})();
