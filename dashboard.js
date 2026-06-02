// ========== GLOBAL STATE ==========
let currentStories = [];
let selectedSources = [];
let currentFilter = 'all';
let currentPlan = null;
let currentSettings = { aiProvider: 'anthropic', rss2jsonKey: '', proxyUrl: '', aiKeywords: true };
let hzOriginalText = '';

// Source definitions (RSS feeds)
const SOURCES = {
  world: { label: 'World News', url: 'https://feeds.bbci.co.uk/news/world/rss.xml', free: true },
  us: { label: 'US News', url: 'https://feeds.bbci.co.uk/news/world/us_and_canada/rss.xml', free: false },
  tech: { label: 'Technology', url: 'https://feeds.bbci.co.uk/news/technology/rss.xml', free: true },
  science: { label: 'Science', url: 'https://feeds.bbci.co.uk/news/science_and_environment/rss.xml', free: false },
  business: { label: 'Business', url: 'https://feeds.bbci.co.uk/news/business/rss.xml', free: false },
  reddit: { label: 'Reddit (r/all)', url: 'https://www.reddit.com/.rss', free: false },
  hackernews: { label: 'Hacker News', url: 'https://news.ycombinator.com/rss', free: true },
  climate: { label: 'Climate', url: 'https://feeds.bbci.co.uk/news/science_and_environment/climate/rss.xml', free: false }
};

// Helper: fetch RSS via proxy
async function fetchRSSFeed(sourceKey) {
  const url = SOURCES[sourceKey].url;
  let proxyUrl = currentSettings.proxyUrl || 'https://api.rss2json.com/v1/api.json?rss_url=';
  let finalUrl;
  if (proxyUrl.includes('rss2json')) {
    finalUrl = `${proxyUrl}${encodeURIComponent(url)}&api_key=${currentSettings.rss2jsonKey || ''}`;
  } else {
    finalUrl = `${proxyUrl}?url=${encodeURIComponent(url)}`;
  }
  const res = await fetch(finalUrl);
  const data = await res.json();
  if (data.items) return data.items.map(item => ({ title: item.title, link: item.link, content: item.description, pubDate: item.pubDate }));
  else if (data.articles) return data.articles;
  else throw new Error('Invalid RSS response');
}

// Call AI for sentiment analysis
async function analyzeStory(title, content, provider) {
  const prompt = `Analyze the sentiment of this news story. Return JSON: { "sentiment": "positive/negative/neutral", "emotion": "joy/anger/fear/surprise/sadness/neutral", "explanation": "short reason", "keywords": ["keyword1","keyword2"] }. Story: ${title}. ${content.substring(0, 800)}`;
  const response = await callAIWithRetry({ prompt, maxTokens: 300, provider });
  try {
    const jsonMatch = response.match(/\{.*\}/s);
    if (jsonMatch) return JSON.parse(jsonMatch[0]);
    else throw new Error('No JSON');
  } catch(e) {
    return { sentiment: 'neutral', emotion: 'neutral', explanation: 'Analysis failed', keywords: [] };
  }
}

// Crawl selected sources
async function crawlAndAnalyze() {
  const { ok, used, limit } = await canCrawl();
  if (!ok) {
    alert(`Monthly crawl limit reached (${used}/${limit}). Upgrade to Pro for unlimited.`);
    return;
  }
  const provider = currentSettings.aiProvider;
  const progressDiv = document.getElementById('progressMsg');
  const progFill = document.getElementById('progFill');
  progressDiv.innerText = 'Fetching RSS feeds...';
  progFill.style.width = '10%';
  let allItems = [];
  for (let i = 0; i < selectedSources.length; i++) {
    const src = selectedSources[i];
    progressDiv.innerText = `Fetching ${SOURCES[src].label}...`;
    progFill.style.width = `${10 + (i / selectedSources.length) * 40}%`;
    try {
      const items = await fetchRSSFeed(src);
      allItems.push(...items.map(item => ({ ...item, source: src })));
    } catch(e) { console.error(e); }
  }
  progressDiv.innerText = `Analyzing ${allItems.length} stories with AI...`;
  progFill.style.width = '60%';
  const analyzed = [];
  for (let i = 0; i < allItems.length; i++) {
    const story = allItems[i];
    progressDiv.innerText = `Analyzing ${i+1}/${allItems.length}: ${story.title.substring(0,50)}...`;
    progFill.style.width = `${60 + (i / allItems.length) * 35}%`;
    try {
      const analysis = await analyzeStory(story.title, story.content, provider);
      analyzed.push({ ...story, ...analysis, id: Date.now() + i });
    } catch(e) { analyzed.push({ ...story, sentiment: 'neutral', emotion: 'neutral', explanation: 'Error', keywords: [], id: Date.now() + i }); }
  }
  currentStories = analyzed;
  localStorage.setItem('sentiment_stories', JSON.stringify(currentStories));
  await incrementCrawlCount();
  await updateUsageBar();
  progressDiv.innerText = 'Done!';
  progFill.style.width = '100%';
  setTimeout(() => { progFill.style.width = '0%'; progressDiv.innerText = ''; }, 1500);
  renderNews();
  renderKeywords();
}

// Render news with filters
function renderNews() {
  const container = document.getElementById('storyList');
  let filtered = currentStories;
  if (currentFilter !== 'all') filtered = filtered.filter(s => s.sentiment === currentFilter);
  if (filtered.length === 0) {
    container.innerHTML = '<div class="empty"><div class="empty-icon">📭</div><strong>No stories match your filter</strong><br>Try a different sentiment or crawl new stories.</div>';
    return;
  }
  const stats = {
    total: currentStories.length,
    pos: currentStories.filter(s => s.sentiment === 'positive').length,
    neg: currentStories.filter(s => s.sentiment === 'negative').length,
    neu: currentStories.filter(s => s.sentiment === 'neutral').length
  };
  document.getElementById('statsStrip').style.display = 'grid';
  document.getElementById('statsStrip').innerHTML = `
    <div class="stat-box"><div class="stat-value">${stats.total}</div><div class="stat-label">Total stories</div></div>
    <div class="stat-box"><div class="stat-value" style="color:#8BC97F">${stats.pos}</div><div class="stat-label">Positive</div></div>
    <div class="stat-box"><div class="stat-value" style="color:#E07A5F">${stats.neg}</div><div class="stat-label">Negative</div></div>
    <div class="stat-box"><div class="stat-value">${stats.neu}</div><div class="stat-label">Neutral</div></div>
  `;
  container.innerHTML = filtered.map(story => `
    <div class="story-card">
      <div class="card-top">
        <div class="emotion-dot">${getEmoji(story.emotion)}</div>
        <div class="card-body">
          <div class="card-meta">
            <span class="badge ${story.sentiment === 'positive' ? 'badge-pos' : story.sentiment === 'negative' ? 'badge-neg' : 'badge-neutral'}">${story.sentiment}</span>
            <span class="badge">${SOURCES[story.source]?.label || story.source}</span>
            <span class="ts">${new Date(story.pubDate).toLocaleDateString()}</span>
          </div>
          <div class="card-title"><a href="${story.link}" target="_blank">${escapeHtml(story.title)}</a></div>
          <div class="card-explain">${escapeHtml(story.explanation)}</div>
          <div class="card-kw">${(story.keywords || []).slice(0,3).map(kw => `<span class="kw">${escapeHtml(kw)}</span>`).join('')}</div>
          <div class="conf-row"><span>Confidence</span><div class="conf-track"><div class="conf-fill" style="width:70%"></div></div></div>
          <div class="card-actions">
            <button class="act-btn" onclick="generateBriefFromStory('${escapeHtml(story.title)}', '${escapeHtml(story.content)}')">📝 Brief</button>
            <button class="act-btn ${currentPlan?.label === 'Free' ? 'locked-btn' : ''}" onclick="generateDraftFromStory('${escapeHtml(story.title)}', '${escapeHtml(story.content)}')" ${currentPlan?.label === 'Free' ? 'disabled' : ''}>✍️ Draft</button>
          </div>
        </div>
      </div>
    </div>
  `).join('');
  document.getElementById('filterRow').style.display = 'flex';
}

function getEmoji(emotion) {
  const map = { joy:'😊', anger:'😠', fear:'😨', surprise:'😲', sadness:'😢', neutral:'😐' };
  return map[emotion] || '📰';
}

// Render keyword cloud
function renderKeywords() {
  const container = document.getElementById('kwContent');
  if (!currentStories.length) {
    container.innerHTML = '<div class="empty"><div class="empty-icon">🔑</div><strong>Run a crawl first</strong><br>to see trending keywords and topics.</div>';
    return;
  }
  const freq = {};
  currentStories.forEach(s => {
    (s.keywords || []).forEach(kw => { freq[kw] = (freq[kw] || 0) + 1; });
  });
  const sorted = Object.entries(freq).sort((a,b) => b[1] - a[1]).slice(0, 30);
  container.innerHTML = `<div class="settings-card"><div class="settings-section-title">🔥 Trending keywords</div><div class="kw-grid">${sorted.map(([kw, count]) => `<button class="kw-tag" onclick="searchKeyword('${escapeHtml(kw)}')">${escapeHtml(kw)} (${count})</button>`).join('')}</div></div>`;
}

function searchKeyword(kw) {
  document.getElementById('briefTopicInput').value = kw;
  document.querySelector('.tab[data-tab="briefs"]').click();
}

// Brief generation
async function generateBrief(topic, tone = '') {
  const provider = currentSettings.aiProvider;
  const prompt = `Write a structured editorial brief for a news article about: "${topic}". ${tone ? `Tone: ${tone}.` : ''} Include: 1) Working headline, 2) Central angle, 3) Key points to cover (3-5 bullet points), 4) Suggested sources or data to quote.`;
  const text = await callAIWithRetry({ prompt, maxTokens: 800, provider });
  document.getElementById('briefsContent').innerHTML = `<div class="brief-card"><div class="brief-headline">📌 Brief for "${escapeHtml(topic)}"</div><div class="brief-angle">${escapeHtml(text)}</div><div class="draft-actions"><button class="act-btn" onclick="generateDraftFromBrief('${escapeHtml(topic)}', \`${escapeHtml(text)}\`)">✍️ Generate Draft from this Brief</button></div></div>`;
}

async function generateBriefFromStory(title, content) {
  await generateBrief(`${title} – ${content.substring(0,200)}`);
}

// Draft generation
async function generateDraft(promptText, wordCount = 1000, style = 'AP style') {
  const provider = currentSettings.aiProvider;
  const fullPrompt = `Write a complete news article of approximately ${wordCount} words in ${style}. Use the following details: ${promptText}. Include a headline, byline, and subheadings where appropriate.`;
  const draft = await callAIWithRetry({ prompt: fullPrompt, maxTokens: 2000, provider });
  document.getElementById('draftContent').innerHTML = `<div class="draft-output">${escapeHtml(draft)}</div><div class="draft-actions"><button class="act-btn" onclick="copyToClipboard('${escapeHtml(draft)}')">📋 Copy</button><button class="act-btn" onclick="exportMD('${escapeHtml(draft)}')">⬇ Export MD</button></div>`;
}

async function generateDraftFromBrief(topic, briefText) {
  await generateDraft(`Topic: ${topic}\nBrief: ${briefText}`);
}

async function generateDraftFromStory(title, content) {
  await generateDraft(`Story: ${title}\nDetails: ${content.substring(0,500)}`);
}

// Humanizer
async function humanizeText() {
  const text = document.getElementById('hzInput').value;
  if (!text) return;
  hzOriginalText = text;
  const persona = document.getElementById('hzPersona').value;
  const tone = document.getElementById('hzTone').value;
  const level = document.getElementById('hzBypassLevel').value;
  const keyword = document.getElementById('hzKeyword').value;
  const seo = document.getElementById('hzSeoMode').value;
  const progressMsg = document.getElementById('hzProgressMsg');
  const progFill = document.getElementById('hzProgFill');
  progressMsg.innerText = 'Humanizing...';
  progFill.style.width = '30%';
  let rewritten = text;
  if (level === 'aggressive') {
    for (let i = 0; i < 2; i++) {
      const prompt = `Rewrite this text to sound completely human, as if written by a ${persona} with a ${tone} tone. Avoid AI patterns. ${keyword ? `Naturally include the keyword "${keyword}" once.` : ''} ${seo !== 'none' ? 'Optimize for readability and include a subheading.' : ''}\n\nText: ${rewritten}`;
      rewritten = await callAIWithRetry({ prompt, maxTokens: 2000, provider: currentSettings.aiProvider });
      progFill.style.width = `${60 + i*20}%`;
    }
  } else {
    const prompt = `Rewrite the following text to be more human-like, using a ${persona} persona and ${tone} tone. ${level === 'light' ? 'Make minimal changes.' : 'Make moderate changes.'} ${keyword ? `Include the keyword "${keyword}" naturally.` : ''}\n\n${text}`;
    rewritten = await callAIWithRetry({ prompt, maxTokens: 2000, provider: currentSettings.aiProvider });
    progFill.style.width = '90%';
  }
  document.getElementById('hzOutputText').innerHTML = escapeHtml(rewritten);
  document.getElementById('hzOutput').style.display = 'block';
  progressMsg.innerText = 'Done!';
  progFill.style.width = '100%';
  setTimeout(() => { progFill.style.width = '0%'; progressMsg.innerText = ''; }, 1500);
}

function copyToClipboard(text) { navigator.clipboard.writeText(text); alert('Copied!'); }
function exportMD(text) {
  const blob = new Blob([text], {type: 'text/markdown'});
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = 'article.md';
  a.click();
  URL.revokeObjectURL(a.href);
}

// Settings & UI initialization
async function initDashboard() {
  const loader = document.getElementById('initialLoader');
  if (loader) loader.remove();

  const user = await getCurrentUser();
  if (!user) {
    document.getElementById('authGate').style.display = 'flex';
    document.getElementById('dashboardContent').style.display = 'none';
    return;
  }

  document.getElementById('authGate').style.display = 'none';
  document.getElementById('dashboardContent').style.display = 'block';

  currentPlan = await getCurrentPlan();
  currentSettings = await loadSettings();

  await initAccountDropdown();
  await updateUsageBar();
  setupTabs();
  setupEventListeners();
  loadStoriesFromLocal();
  renderSourceChips();
  renderSettingsForm();
  renderAccountPane();
  checkPlanLocks();
}

function loadStoriesFromLocal() {
  const stored = localStorage.getItem('sentiment_stories');
  if (stored) {
    currentStories = JSON.parse(stored);
    renderNews();
    renderKeywords();
  }
}

function renderSourceChips() {
  const container = document.getElementById('sourceChipsRow');
  const allowedSources = currentPlan.allSources ? Object.keys(SOURCES) : currentPlan.sources;
  selectedSources = allowedSources.filter(s => SOURCES[s].free || currentPlan.label !== 'Free');
  container.innerHTML = Object.keys(SOURCES).map(key => {
    const isAllowed = allowedSources.includes(key);
    const isActive = selectedSources.includes(key);
    return `<button class="source-chip ${isActive ? 'active' : ''} ${!isAllowed ? 'locked' : ''}" data-source="${key}" ${!isAllowed ? 'disabled' : ''}>${SOURCES[key].label}</button>`;
  }).join('');
  document.querySelectorAll('.source-chip').forEach(btn => {
    btn.addEventListener('click', () => {
      const src = btn.dataset.source;
      if (btn.classList.contains('locked')) return;
      if (selectedSources.includes(src)) selectedSources = selectedSources.filter(s => s !== src);
      else selectedSources.push(src);
      renderSourceChips();
    });
  });
}

function setupTabs() {
  document.querySelectorAll('.tab').forEach(tab => {
    tab.addEventListener('click', () => {
      const tabName = tab.dataset.tab;
      document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
      document.querySelectorAll('.pane').forEach(p => p.classList.remove('active'));
      tab.classList.add('active');
      document.getElementById(`pane-${tabName}`).classList.add('active');
    });
  });
}

function setupEventListeners() {
  document.getElementById('crawlBtn').addEventListener('click', crawlAndAnalyze);
  document.getElementById('refreshBtn').addEventListener('click', () => { if (currentStories.length) renderNews(); });
  document.getElementById('settingsBtn').addEventListener('click', () => document.querySelector('.tab[data-tab="settings"]').click());
  document.getElementById('briefManualBtn').addEventListener('click', () => {
    const topic = document.getElementById('briefTopicInput').value;
    const tone = document.getElementById('briefToneInput').value;
    if (topic) generateBrief(topic, tone);
    else alert('Enter a topic');
  });
  document.getElementById('draftManualBtn').addEventListener('click', () => {
    const prompt = document.getElementById('draftPromptInput').value;
    const words = document.getElementById('draftWordCount').value;
    const style = document.getElementById('draftStyleInput').value;
    if (prompt) generateDraft(prompt, words, style);
    else alert('Enter a description');
  });
  document.getElementById('hzRunBtn').addEventListener('click', humanizeText);
  document.getElementById('hzCopyBtn').addEventListener('click', () => copyToClipboard(document.getElementById('hzOutputText').innerText));
  document.getElementById('hzRehumanizeBtn').addEventListener('click', () => { document.getElementById('hzInput').value = hzOriginalText; humanizeText(); });
  document.getElementById('hzExportBtn').addEventListener('click', () => exportMD(document.getElementById('hzOutputText').innerText));
  document.getElementById('saveSettingsBtn').addEventListener('click', saveSettingsUI);
  document.getElementById('providerAnthropic').addEventListener('click', () => setProvider('anthropic'));
  document.getElementById('providerMistral').addEventListener('click', () => setProvider('mistral'));
  document.getElementById('aiEnrichToggle').addEventListener('click', () => toggleAIEnrich());
  
  // Filter chips
  document.querySelectorAll('.filter-chip').forEach(chip => {
    chip.addEventListener('click', () => {
      currentFilter = chip.dataset.filter;
      renderNews();
      document.querySelectorAll('.filter-chip').forEach(c => c.classList.remove('active'));
      chip.classList.add('active');
    });
  });
}

function setProvider(prov) {
  currentSettings.aiProvider = prov;
  document.querySelectorAll('.provider-btn').forEach(btn => btn.classList.remove('active'));
  document.getElementById(`provider${prov.charAt(0).toUpperCase() + prov.slice(1)}`).classList.add('active');
}

function toggleAIEnrich() {
  currentSettings.aiKeywords = !currentSettings.aiKeywords;
  const toggle = document.getElementById('aiEnrichToggle');
  toggle.classList.toggle('on', currentSettings.aiKeywords);
}

function renderSettingsForm() {
  document.getElementById('rss2jsonKey').value = currentSettings.rss2jsonKey || '';
  document.getElementById('proxyUrl').value = currentSettings.proxyUrl || '';
  document.getElementById('userApiKey').value = '';
  setProvider(currentSettings.aiProvider);
  const toggle = document.getElementById('aiEnrichToggle');
  toggle.classList.toggle('on', currentSettings.aiKeywords);
  document.getElementById('enrichPlanNote').innerText = currentPlan.aiKeywords ? '' : '(Pro feature)';
  if (!currentPlan.aiKeywords) toggle.style.opacity = '0.5';
}

async function saveSettingsUI() {
  currentSettings.rss2jsonKey = document.getElementById('rss2jsonKey').value;
  currentSettings.proxyUrl = document.getElementById('proxyUrl').value;
  const userKey = document.getElementById('userApiKey').value;
  if (userKey) {
    // Optionally save user key – for demo we ignore
  }
  await saveSettings(currentSettings);
  document.getElementById('settingsMsg').innerText = 'Settings saved!';
  setTimeout(() => document.getElementById('settingsMsg').innerText = '', 2000);
}

async function renderAccountPane() {
  const user = await getCurrentUser();
  if (!user) return;
  const plan = await getCurrentPlan();
  const initials = (user.name || user.email).split(' ').map(n => n[0]).join('').toUpperCase().slice(0,2);
  document.getElementById('accountAvatar').innerText = initials;
  document.getElementById('accountName').innerText = user.name || user.email;
  document.getElementById('accountEmail').innerText = user.email;
  document.getElementById('accountPlanInfo').innerHTML = `Plan: ${plan.label} – ${plan.crawlLimit === Infinity ? 'Unlimited crawls' : `${plan.crawlLimit} crawls/month`}`;
  document.getElementById('subscriptionPlan').innerHTML = plan.label;
}

async function updateUsageBar() {
  const plan = await getCurrentPlan();
  const usageBar = document.getElementById('usageBar');
  if (plan.crawlLimit === Infinity) {
    usageBar.style.display = 'none';
    return;
  }
  usageBar.style.display = 'flex';
  const used = await getCrawlCount();
  const percent = Math.min((used / plan.crawlLimit) * 100, 100);
  document.getElementById('usageFill').style.width = percent + '%';
  document.getElementById('usageCount').textContent = `${used} / ${plan.crawlLimit}`;
}

function checkPlanLocks() {
  const isPro = currentPlan.label !== 'Free';
  document.getElementById('briefsTabLock').innerText = isPro ? '' : '🔒';
  document.getElementById('draftTabLock').innerText = isPro ? '' : '🔒';
  document.getElementById('humanizerTabLock').innerText = isPro ? '' : '🔒';
  if (!isPro) {
    document.getElementById('briefManualBtn').disabled = true;
    document.getElementById('draftManualBtn').disabled = true;
    document.getElementById('hzRunBtn').disabled = true;
  }
}

// ========== FIXED AUTH STATE CHANGE – NO INFINITE RELOOP ==========
if (window.supabaseClient) {
  window.supabaseClient.auth.onAuthStateChange((event, session) => {
    if (event === 'SIGNED_OUT' || event === 'SIGNED_IN') {
      window.location.reload();
    }
  });
}

document.addEventListener('DOMContentLoaded', initDashboard);