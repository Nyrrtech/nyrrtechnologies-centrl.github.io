// ============================================================
//  AccessKit Widget — Core Engine (Part 1)
//  Self-contained accessibility features
// ============================================================
(function (W) {
  'use strict';
  if (W.__ak && W.__ak._v === 3) return;

  // ─── State ────────────────────────────────────────────────
  const S = {
    speaking: false,
    utterance: null,
    rate: 1, pitch: 1, volume: 1,
    voice: '',
    rulerOn: false,
    contrastMode: 'none',   // none | high | invert | sepia | bw
    dyslexicOn: false,
    readingOn: false,
    sectionOn: false,
    zoomLevel: 1,
    fontSize: 100,          // percent applied to <html>
    lineSpacing: 'normal',  // normal | relaxed | loose
    letterSpacing: 'normal',// normal | wide | wider
    wordSpacing: 'normal',
    highlightLinks: false,
    highlightHeadings: false,
    hideImages: false,
    mutedVideoAuto: false,
    readProgress: null,     // { paras, idx, bar, fill, label }
    mistralKey: '',
    chatHistory: [],
    focusRingOn: false,
    cursorSize: 'normal',   // normal | large | xl
    animationsOff: false,
  };

  // ─── Persist / restore ────────────────────────────────────
  function save() {
    try {
      localStorage.setItem('__ak_state', JSON.stringify({
        rate: S.rate, pitch: S.pitch, volume: S.volume, voice: S.voice,
        contrastMode: S.contrastMode, dyslexicOn: S.dyslexicOn,
        zoomLevel: S.zoomLevel, fontSize: S.fontSize,
        lineSpacing: S.lineSpacing, letterSpacing: S.letterSpacing,
        wordSpacing: S.wordSpacing, highlightLinks: S.highlightLinks,
        highlightHeadings: S.highlightHeadings, hideImages: S.hideImages,
        focusRingOn: S.focusRingOn, cursorSize: S.cursorSize,
        animationsOff: S.animationsOff, mistralKey: S.mistralKey,
      }));
    } catch(e) {}
  }

  function load() {
    try {
      const d = JSON.parse(localStorage.getItem('__ak_state') || '{}');
      Object.assign(S, d);
    } catch(e) {}
  }

  // ─── Toast ────────────────────────────────────────────────
  function toast(msg, dur = 2800) {
    let el = document.getElementById('ak-toast');
    if (!el) return;
    el.textContent = msg;
    el.classList.add('ak-show');
    clearTimeout(el._t);
    el._t = setTimeout(() => el.classList.remove('ak-show'), dur);
  }

  // ─── Speech Synthesis ─────────────────────────────────────
  function getVoice() {
    if (!S.voice) return null;
    return speechSynthesis.getVoices().find(v => v.name === S.voice) || null;
  }

  function speak(text, onEnd) {
    stopSpeaking();
    if (!text || !text.trim()) return;
    S.speaking = true;
    const u = new SpeechSynthesisUtterance(text.trim());
    u.rate = S.rate; u.pitch = S.pitch; u.volume = S.volume;
    const v = getVoice();
    if (v) u.voice = v;
    u.onend = u.onerror = () => { S.speaking = false; S.utterance = null; if (onEnd) onEnd(); };
    S.utterance = u;
    speechSynthesis.speak(u);
  }

  function stopSpeaking() {
    if (speechSynthesis.speaking || speechSynthesis.pending) speechSynthesis.cancel();
    S.speaking = false; S.utterance = null;
    stopReadWithProgress();
  }

  function readPage() {
    const t = document.body.innerText || '';
    speak(t || 'No text found on this page.');
    toast('Reading page aloud…');
  }

  // ─── Read with Progress ───────────────────────────────────
  function readWithProgress() {
    const paras = Array.from(
      document.querySelectorAll('p,h1,h2,h3,h4,li,td,blockquote')
    ).filter(el => (el.innerText || '').trim().length > 20);

    if (!paras.length) { readPage(); return; }

    stopSpeaking();
    S.readingOn = true;

    const bar = document.getElementById('ak-read-progress');
    const fill = document.getElementById('ak-read-progress-fill');
    const label = document.getElementById('ak-read-progress-label');
    bar.style.display = 'block';
    label.style.display = 'block';

    let i = 0;
    let prevBg = '';
    let prevEl = null;

    function next() {
      if (!S.readingOn) return cleanup();
      if (i >= paras.length) {
        fill.style.width = '100%';
        label.textContent = '✓ Done';
        setTimeout(cleanup, 3000);
        return;
      }
      if (prevEl) prevEl.style.backgroundColor = prevBg;
      const el = paras[i];
      prevBg = el.style.backgroundColor;
      prevEl = el;
      el.style.backgroundColor = 'rgba(240,90,0,0.13)';
      el.scrollIntoView({ behavior: 'smooth', block: 'center' });
      const pct = Math.round((i / paras.length) * 100);
      fill.style.width = pct + '%';
      label.textContent = `${pct}% · ${i + 1}/${paras.length}`;
      i++;
      speak((el.innerText || el.textContent || '').trim(), next);
    }

    function cleanup() {
      S.readingOn = false;
      if (prevEl) prevEl.style.backgroundColor = prevBg;
      bar.style.display = 'none';
      label.style.display = 'none';
      fill.style.width = '0%';
    }

    next();
  }

  function stopReadWithProgress() {
    S.readingOn = false;
    const bar = document.getElementById('ak-read-progress');
    const label = document.getElementById('ak-read-progress-label');
    if (bar) bar.style.display = 'none';
    if (label) label.style.display = 'none';
  }

  // ─── Section Selection ────────────────────────────────────
  let _sectionCleanup = null;
  function toggleSectionRead() {
    if (S.sectionOn) { _sectionCleanup && _sectionCleanup(); return; }
    S.sectionOn = true;
    document.body.style.cursor = 'crosshair';
    const tip = document.getElementById('ak-section-tip');
    if (tip) { tip.style.display = 'block'; tip.textContent = 'Click any element to read it — ESC to cancel'; }

    let hovered = null;
    const onMove = (e) => {
      if (hovered) hovered.style.outline = hovered._prevOutline || '';
      const el = document.elementFromPoint(e.clientX, e.clientY);
      if (el && el !== document.body && !el.closest('#ak-panel') && !el.closest('#ak-fab')) {
        hovered = el;
        el._prevOutline = el.style.outline;
        el.style.outline = '2px solid #F05A00';
      } else { hovered = null; }
    };
    const onClick = (e) => {
      if (e.target.closest('#ak-panel') || e.target.closest('#ak-fab')) return;
      e.preventDefault(); e.stopPropagation();
      const txt = (e.target.innerText || e.target.textContent || '').trim();
      speak(txt || 'No readable text in this element.');
      cleanup();
    };
    const onKey = (e) => { if (e.key === 'Escape') cleanup(); };

    const cleanup = () => {
      S.sectionOn = false;
      document.body.style.cursor = '';
      if (hovered) hovered.style.outline = hovered._prevOutline || '';
      if (tip) tip.style.display = 'none';
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('click', onClick, true);
      document.removeEventListener('keydown', onKey);
      _sectionCleanup = null;
    };
    _sectionCleanup = cleanup;
    document.addEventListener('mousemove', onMove);
    document.addEventListener('click', onClick, true);
    document.addEventListener('keydown', onKey);
    toast('Click any element to read it');
  }

  // ─── Reading Ruler ────────────────────────────────────────
  const _ruler = { el: null };
  function toggleRuler() {
    S.rulerOn = !S.rulerOn;
    const el = document.getElementById('ak-ruler');
    if (!el) return;
    el.style.display = S.rulerOn ? 'block' : 'none';
    if (S.rulerOn) {
      document.addEventListener('mousemove', moveRuler);
      toast('Reading ruler on');
    } else {
      document.removeEventListener('mousemove', moveRuler);
    }
    save();
  }
  function moveRuler(e) {
    const el = document.getElementById('ak-ruler');
    if (el) el.style.top = (e.clientY - 18) + 'px';
  }

  // ─── Contrast Modes ───────────────────────────────────────
  const CONTRAST_MODES = {
    none:    '',
    high:    'html,body,*{background-color:#000!important;color:#FFFF00!important;border-color:#FFFF00!important;}a,a*{color:#00FFFF!important;}img,video{filter:invert(1) hue-rotate(180deg)!important;}input,select,textarea{background:#111!important;color:#FFFF00!important;border:1px solid #FFFF00!important;}',
    invert:  'html{filter:invert(1) hue-rotate(180deg)!important;}html img,html video{filter:invert(1) hue-rotate(180deg)!important;}',
    sepia:   'html{filter:sepia(0.7) brightness(1.05)!important;}',
    bw:      'html{filter:grayscale(1)!important;}',
    dark:    'html{filter:invert(0.9) hue-rotate(180deg) brightness(0.92)!important;}html img,html video{filter:invert(1) hue-rotate(180deg)!important;}',
  };
  let _contrastStyle = null;
  function setContrast(mode) {
    S.contrastMode = mode;
    if (_contrastStyle) { _contrastStyle.remove(); _contrastStyle = null; }
    if (mode !== 'none' && CONTRAST_MODES[mode]) {
      _contrastStyle = document.createElement('style');
      _contrastStyle.id = '__ak_contrast';
      _contrastStyle.textContent = CONTRAST_MODES[mode];
      document.head.appendChild(_contrastStyle);
    }
    save(); toast('Contrast: ' + mode);
  }

  // ─── Zoom ─────────────────────────────────────────────────
  function setZoom(level) {
    S.zoomLevel = Math.min(3, Math.max(0.5, level));
    document.body.style.zoom = S.zoomLevel;
    toast(`Zoom: ${Math.round(S.zoomLevel * 100)}%`);
    save();
  }
  function zoomIn()    { setZoom(S.zoomLevel + 0.1); }
  function zoomOut()   { setZoom(S.zoomLevel - 0.1); }
  function zoomReset() { setZoom(1); }

  // ─── Font Size ────────────────────────────────────────────
  function setFontSize(pct) {
    S.fontSize = Math.min(200, Math.max(60, pct));
    document.documentElement.style.fontSize = S.fontSize + '%';
    toast(`Font size: ${S.fontSize}%`);
    save();
  }
  function fontUp()    { setFontSize(S.fontSize + 10); }
  function fontDown()  { setFontSize(S.fontSize - 10); }
  function fontReset() { setFontSize(100); }

  // ─── Line / Letter / Word Spacing ─────────────────────────
  let _spacingStyle = null;
  function applySpacing() {
    if (_spacingStyle) { _spacingStyle.remove(); _spacingStyle = null; }
    const ls = { normal:'1.5', relaxed:'1.8', loose:'2.2' }[S.lineSpacing] || '1.5';
    const lts = { normal:'normal', wide:'0.05em', wider:'0.12em' }[S.letterSpacing] || 'normal';
    const ws = { normal:'normal', wide:'0.1em', wider:'0.2em' }[S.wordSpacing] || 'normal';
    const css = `body,p,li,td,h1,h2,h3,h4,h5,h6,span,div{line-height:${ls}!important;letter-spacing:${lts}!important;word-spacing:${ws}!important;}`;
    _spacingStyle = document.createElement('style');
    _spacingStyle.id = '__ak_spacing';
    _spacingStyle.textContent = css;
    document.head.appendChild(_spacingStyle);
    save();
  }

  // ─── Dyslexia Font ────────────────────────────────────────
  let _dyslexicStyle = null;
  function toggleDyslexic() {
    S.dyslexicOn = !S.dyslexicOn;
    const panel = document.getElementById('ak-panel');
    if (S.dyslexicOn) {
      if (!_dyslexicStyle) {
        _dyslexicStyle = document.createElement('style');
        _dyslexicStyle.id = '__ak_dyslexic';
        _dyslexicStyle.textContent = `body,p,li,td,h1,h2,h3,h4,h5,h6,span,a{font-family:'OpenDyslexic',Arial,sans-serif!important;letter-spacing:0.05em!important;word-spacing:0.15em!important;}`;
        document.head.appendChild(_dyslexicStyle);
      }
      panel && panel.classList.add('ak-dyslexic');
    } else {
      _dyslexicStyle && _dyslexicStyle.remove(); _dyslexicStyle = null;
      panel && panel.classList.remove('ak-dyslexic');
    }
    toast(S.dyslexicOn ? 'Dyslexia font on' : 'Dyslexia font off');
    save();
  }

  // ─── Highlight Links ──────────────────────────────────────
  let _linkStyle = null;
  function toggleHighlightLinks() {
    S.highlightLinks = !S.highlightLinks;
    if (S.highlightLinks) {
      if (!_linkStyle) {
        _linkStyle = document.createElement('style');
        _linkStyle.id = '__ak_links';
        _linkStyle.textContent = `a:not(#ak-panel a){outline:2px solid #60a5fa!important;background:rgba(96,165,250,0.1)!important;border-radius:2px!important;}`;
        document.head.appendChild(_linkStyle);
      }
    } else { _linkStyle && _linkStyle.remove(); _linkStyle = null; }
    toast(S.highlightLinks ? 'Links highlighted' : 'Link highlight off');
    save();
  }

  // ─── Highlight Headings ───────────────────────────────────
  let _headingStyle = null;
  function toggleHighlightHeadings() {
    S.highlightHeadings = !S.highlightHeadings;
    if (S.highlightHeadings) {
      if (!_headingStyle) {
        _headingStyle = document.createElement('style');
        _headingStyle.id = '__ak_headings';
        _headingStyle.textContent = `h1,h2,h3,h4,h5,h6{border-left:4px solid #F05A00!important;padding-left:10px!important;background:rgba(240,90,0,0.06)!important;}`;
        document.head.appendChild(_headingStyle);
      }
    } else { _headingStyle && _headingStyle.remove(); _headingStyle = null; }
    toast(S.highlightHeadings ? 'Headings highlighted' : 'Heading highlight off');
    save();
  }

  // ─── Hide Images ──────────────────────────────────────────
  let _imgStyle = null;
  function toggleHideImages() {
    S.hideImages = !S.hideImages;
    if (S.hideImages) {
      if (!_imgStyle) {
        _imgStyle = document.createElement('style');
        _imgStyle.id = '__ak_imgs';
        _imgStyle.textContent = `img,picture,figure,video,svg:not(#ak-panel svg):not(#ak-fab svg){visibility:hidden!important;}`;
        document.head.appendChild(_imgStyle);
      }
    } else { _imgStyle && _imgStyle.remove(); _imgStyle = null; }
    toast(S.hideImages ? 'Images hidden' : 'Images visible');
    save();
  }

  // ─── Stop Animations ──────────────────────────────────────
  let _animStyle = null;
  function toggleAnimations() {
    S.animationsOff = !S.animationsOff;
    if (S.animationsOff) {
      if (!_animStyle) {
        _animStyle = document.createElement('style');
        _animStyle.id = '__ak_anim';
        _animStyle.textContent = `*,*::before,*::after{animation-duration:0.001ms!important;animation-iteration-count:1!important;transition-duration:0.001ms!important;}`;
        document.head.appendChild(_animStyle);
      }
    } else { _animStyle && _animStyle.remove(); _animStyle = null; }
    toast(S.animationsOff ? 'Animations paused' : 'Animations restored');
    save();
  }

  // ─── Focus Ring ───────────────────────────────────────────
  let _focusStyle = null;
  function toggleFocusRing() {
    S.focusRingOn = !S.focusRingOn;
    if (S.focusRingOn) {
      if (!_focusStyle) {
        _focusStyle = document.createElement('style');
        _focusStyle.id = '__ak_focus';
        _focusStyle.textContent = `*:focus{outline:3px solid #F05A00!important;outline-offset:2px!important;}`;
        document.head.appendChild(_focusStyle);
      }
    } else { _focusStyle && _focusStyle.remove(); _focusStyle = null; }
    toast(S.focusRingOn ? 'Focus rings enhanced' : 'Focus rings normal');
    save();
  }

  // ─── Cursor Size ──────────────────────────────────────────
  let _cursorStyle = null;
  function setCursor(size) {
    S.cursorSize = size;
    if (_cursorStyle) { _cursorStyle.remove(); _cursorStyle = null; }
    const urls = { large: '32', xl: '48' };
    if (size !== 'normal') {
      _cursorStyle = document.createElement('style');
      _cursorStyle.id = '__ak_cursor';
      // Use CSS cursor scale via zoom trick — widely supported fallback
      const px = urls[size] || '32';
      _cursorStyle.textContent = `*{cursor:url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='${px}' height='${px}' viewBox='0 0 24 24'%3E%3Cpath fill='%23fff' stroke='%23000' stroke-width='1.5' d='M5.5 3.5l13 8.5-7 1.5-4 7z'/%3E%3C/svg%3E") 0 0, auto!important;}`;
      document.head.appendChild(_cursorStyle);
    }
    toast('Cursor: ' + size);
    save();
  }

  // ─── Simplify Page ────────────────────────────────────────
  function simplifyPage() {
    ['aside','.sidebar','.ads','.ad','.advertisement','.banner-ad',
     '.social-share','.comments','.related','nav:not([role="navigation"])',
     '.popup','.modal-backdrop','.newsletter-popup'].forEach(sel => {
      try { document.querySelectorAll(sel).forEach(el => el.style.display = 'none'); } catch(e) {}
    });
    const main = document.querySelector('main,article,[role="main"]') || document.body;
    Object.assign(main.style, { maxWidth:'800px', margin:'0 auto', padding:'20px', fontSize:'18px', lineHeight:'1.7' });
    toast('Page simplified — reload to restore');
  }

  // ─── Page Text / Sections ─────────────────────────────────
  function getPageText() {
    const clone = document.body.cloneNode(true);
    clone.querySelectorAll('script,style,noscript,svg,#ak-panel,#ak-fab').forEach(el => el.remove());
    return (clone.innerText || clone.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 6000);
  }

  function getPageSections() {
    const parts = [];
    const h = Array.from(document.querySelectorAll('h1,h2,h3')).slice(0, 10)
      .map(el => el.innerText.trim()).filter(Boolean);
    if (h.length) parts.push('Headings: ' + h.join('; '));
    const nav = document.querySelector('nav,[role="navigation"]');
    if (nav) parts.push('Nav links: ' + Array.from(nav.querySelectorAll('a')).map(a => a.innerText.trim()).filter(Boolean).join(', '));
    const main = document.querySelector('main,article,[role="main"]');
    if (main) parts.push('Main content (first 800 chars): ' + (main.innerText || '').trim().slice(0, 800));
    if (!parts.length) parts.push('Page text: ' + (document.body.innerText || '').trim().slice(0, 1000));
    return parts.join('\n\n');
  }

  // ─── Mistral AI ───────────────────────────────────────────
  async function callMistral(messages) {
    if (!S.mistralKey) return { error: 'No Mistral API key set. Add it in the Settings tab.' };
    try {
      const r = await fetch('https://api.mistral.ai/v1/chat/completions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + S.mistralKey },
        body: JSON.stringify({ model: 'mistral-small-latest', messages, max_tokens: 600 }),
      });
      const j = await r.json();
      if (!r.ok) return { error: j.message || r.statusText };
      return { text: j.choices?.[0]?.message?.content || '' };
    } catch(e) { return { error: e.message }; }
  }

  async function aiSummarize() {
    toast('Summarizing with AI…');
    const sections = getPageSections();
    const res = await callMistral([
      { role: 'system', content: 'You are an accessibility assistant. Summarize this web page in 3–5 clear sentences so a screen reader user quickly understands its purpose and key content. Be concise.' },
      { role: 'user', content: sections },
    ]);
    if (res.error) { toast('AI error: ' + res.error); return null; }
    speak(res.text);
    return res.text;
  }

  async function aiAnswer(question, history) {
    const pageText = getPageText();
    const msgs = [
      { role: 'system', content: `You are an accessibility assistant answering questions about a web page. Page content:\n\n${pageText}\n\nAnswer clearly and concisely.` },
      ...history,
      { role: 'user', content: question },
    ];
    const res = await callMistral(msgs);
    if (res.error) return { error: res.error };
    speak(res.text);
    return { text: res.text };
  }

  async function aiSimplifyText(text) {
    toast('Simplifying text…');
    const res = await callMistral([
      { role: 'system', content: 'Rewrite the following text in simple, plain language (reading level: 8th grade). Keep it short.' },
      { role: 'user', content: text },
    ]);
    if (res.error) { toast('AI error: ' + res.error); return null; }
    return res.text;
  }

  // ─── Apply saved state on load ────────────────────────────
  function applyAll() {
    if (S.contrastMode && S.contrastMode !== 'none') setContrast(S.contrastMode);
    if (S.dyslexicOn) toggleDyslexic();
    if (S.zoomLevel !== 1) document.body.style.zoom = S.zoomLevel;
    if (S.fontSize !== 100) document.documentElement.style.fontSize = S.fontSize + '%';
    if (S.highlightLinks) toggleHighlightLinks();
    if (S.highlightHeadings) toggleHighlightHeadings();
    if (S.hideImages) toggleHideImages();
    if (S.focusRingOn) toggleFocusRing();
    if (S.animationsOff) toggleAnimations();
    if (S.lineSpacing !== 'normal' || S.letterSpacing !== 'normal' || S.wordSpacing !== 'normal') applySpacing();
    if (S.rulerOn) {
      const el = document.getElementById('ak-ruler');
      if (el) { el.style.display = 'block'; document.addEventListener('mousemove', moveRuler); }
    }
  }

  // ─── Public API ───────────────────────────────────────────
  W.__ak = {
    _v: 3, S,
    speak, stopSpeaking, readPage, readWithProgress, toggleSectionRead,
    toggleRuler, setContrast, zoomIn, zoomOut, zoomReset, setZoom,
    fontUp, fontDown, fontReset, setFontSize,
    applySpacing, toggleDyslexic, toggleHighlightLinks, toggleHighlightHeadings,
    toggleHideImages, toggleAnimations, toggleFocusRing, setCursor,
    simplifyPage, getPageText, getPageSections,
    aiSummarize, aiAnswer, aiSimplifyText, callMistral,
    save, load, applyAll, toast,
  };

  load();
}(window));
