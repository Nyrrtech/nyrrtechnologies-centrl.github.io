// ========== SUPABASE CLIENT INITIALIZATION ==========
const SUPABASE_URL = 'https://mpwbiaquisxwgugejfra.supabase.co';
const SUPABASE_ANON_KEY = 'sb_publishable__6fx1vLV-dnLmTNd0uYV9g_CQKy2Cju';

const supabaseClient = supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

// ========== CACHED USER (synchronous) ==========
let cachedUser = null;
let cachedPlan = null;

// Try to restore session from localStorage on page load (synchronous)
try {
  const storedSession = localStorage.getItem('supabase.auth.token');
  if (storedSession) {
    const session = JSON.parse(storedSession);
    if (session.currentSession?.user) {
      cachedUser = session.currentSession.user;
    }
  }
} catch(e) { /* ignore */ }

// ========== PLANS DEFINITION ==========
const PLANS = {
  free: {
    label: 'Free',
    badgeClass: 'plan-free',
    crawlLimit: 50,
    sources: ['world', 'tech', 'hackernews'],
    briefs: false,
    drafts: false,
    allSources: false,
    aiKeywords: false
  },
  pro: {
    label: 'Pro',
    badgeClass: 'plan-pro',
    crawlLimit: Infinity,
    sources: ['world', 'us', 'tech', 'science', 'business', 'reddit', 'hackernews', 'climate'],
    briefs: true,
    drafts: true,
    allSources: true,
    aiKeywords: true
  },
  enterprise: {
    label: 'Enterprise',
    badgeClass: 'plan-enterprise',
    crawlLimit: Infinity,
    sources: ['world', 'us', 'tech', 'science', 'business', 'reddit', 'hackernews', 'climate'],
    briefs: true,
    drafts: true,
    allSources: true,
    aiKeywords: true
  }
};

// ========== HELPER ==========
function escapeHtml(str) {
  if (!str) return '';
  return str.replace(/[&<>]/g, function(m) {
    if (m === '&') return '&amp;';
    if (m === '<') return '&lt;';
    if (m === '>') return '&gt;';
    return m;
  });
}

// ========== SYNC CACHED USER (no flicker) ==========
function getCachedUser() {
  return cachedUser;
}

// ========== ENSURE PROFILE EXISTS (async) ==========
async function ensureProfileExists(userId, name) {
  const { data: existing } = await supabaseClient
    .from('profiles')
    .select('id')
    .eq('id', userId)
    .maybeSingle();

  if (!existing) {
    await supabaseClient
      .from('profiles')
      .insert({ id: userId, name: name || 'User', plan: 'free' });
  }
}

// ========== AUTHENTICATION ==========
async function register(name, email, password) {
  const { data, error } = await supabaseClient.auth.signUp({
    email,
    password,
    options: { data: { name } }
  });
  if (error) throw error;
  if (data.user) {
    await ensureProfileExists(data.user.id, name);
    // Update cache
    cachedUser = data.user;
  }
  return data.user;
}

async function login(email, password) {
  const { data, error } = await supabaseClient.auth.signInWithPassword({ email, password });
  if (error) throw error;
  if (data.user) {
    await ensureProfileExists(data.user.id, data.user.user_metadata?.name);
    cachedUser = data.user;
  }
  return data.user;
}

async function logout() {
  await supabaseClient.auth.signOut();
  cachedUser = null;
  window.location.href = '/';
}

async function getCurrentUser() {
  // If we already have a cached user, return it immediately
  if (cachedUser) {
    // But still refresh profile in background (optional)
    refreshProfileInBackground(cachedUser.id);
    return cachedUser;
  }
  const { data: { user } } = await supabaseClient.auth.getUser();
  if (!user) return null;
  cachedUser = user;
  await ensureProfileExists(user.id, user.user_metadata?.name);
  return user;
}

// Silently update profile in background
async function refreshProfileInBackground(userId) {
  try {
    const { data: profile } = await supabaseClient
      .from('profiles')
      .select('*')
      .eq('id', userId)
      .single();
    if (profile) {
      cachedUser = { ...cachedUser, name: profile.name, plan: profile.plan };
    }
  } catch(e) {}
}

async function getCurrentPlan() {
  if (cachedPlan) return cachedPlan;
  const user = await getCurrentUser();
  if (!user) return PLANS.free;
  const planKey = user.plan || 'free';
  cachedPlan = PLANS[planKey] || PLANS.free;
  return cachedPlan;
}

// ========== CRAWL USAGE ==========
async function incrementCrawlCount() {
  const { data: { user } } = await supabaseClient.auth.getUser();
  if (!user) throw new Error('Not logged in');
  const { error } = await supabaseClient.rpc('increment_crawl_usage', { p_user_id: user.id });
  if (error) throw error;
}

async function getCrawlCount() {
  const { data: { user } } = await supabaseClient.auth.getUser();
  if (!user) return 0;
  const currentMonth = new Date().toISOString().slice(0,7) + '-01';
  const { data, error } = await supabaseClient
    .from('crawl_usage')
    .select('count')
    .eq('user_id', user.id)
    .eq('month', currentMonth)
    .maybeSingle();
  if (error && error.code !== 'PGRST116') throw error;
  return data?.count || 0;
}

async function canCrawl() {
  const plan = await getCurrentPlan();
  if (plan.crawlLimit === Infinity) return { ok: true };
  const used = await getCrawlCount();
  return { ok: used < plan.crawlLimit, used, limit: plan.crawlLimit };
}

// ========== USER SETTINGS (unchanged) ==========
async function loadSettings() { /* same as before */ }
function mapSettingsFromDB(db) { /* same */ }
async function saveSettings(settings) { /* same */ }

// ========== AI CALL ==========
async function callAI({ prompt, maxTokens = 600, provider, useUserKey = false, userKey = '' }) {
  const { data, error } = await supabaseClient.functions.invoke('ai-proxy', {
    body: { provider, prompt, maxTokens, useUserKey, userKey }
  });
  if (error) throw new Error(error.message);
  if (data.error) throw new Error(data.error);
  return data.text;
}

async function callAIWithRetry({ prompt, maxTokens, provider, retries = 3, delayMs = 1000 }) {
  let lastError;
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      return await callAI({ prompt, maxTokens, provider, useUserKey: false });
    } catch (error) {
      lastError = error;
      const isRateLimit = error.message.includes('429') || error.message.includes('Rate limit');
      const isServerError = error.message.includes('5') || error.message.includes('server error');
      if (!isRateLimit && !isServerError) throw error;
      if (attempt === retries) throw error;
      const wait = delayMs * Math.pow(2, attempt - 1) + Math.random() * 200;
      await new Promise(resolve => setTimeout(resolve, wait));
    }
  }
  throw lastError;
}

// ========== MODAL FUNCTIONS (unchanged) ==========
function openModal(tab = 'login') { /* same */ }
function closeModal() { /* same */ }
function switchModalTab(tab) { /* same */ }
async function doLogin() { /* same, but update cachedUser on success */ }
async function doRegister() { /* same */ }

// ========== ACCOUNT DROPDOWN (synchronous header render) ==========
function renderHeaderSync() {
  const headerAuth = document.getElementById('siteHeaderAuth') || document.getElementById('headerAuth');
  if (!headerAuth) return;

  const user = getCachedUser();
  if (!user) {
    // Render logged-out buttons immediately (no flicker because it's the first render)
    headerAuth.innerHTML = `
      <button class="btn-outline btn-sm" onclick="openModal('login')">Sign in</button>
      <a href="dashboard.html"><button class="btn btn-sm">Dashboard</button></a>
    `;
    return;
  }

  // Render logged-in skeleton (will be enhanced after plan is fetched)
  const initials = (user.user_metadata?.name || user.email || 'U')
    .split(' ')
    .map(n => n[0])
    .join('')
    .toUpperCase()
    .slice(0, 2);
  const dropdownId = 'accountDropdown_' + Math.random().toString(36).substr(2, 9);
  headerAuth.innerHTML = `
    <div class="account-menu-container">
      <button class="account-menu-btn" onclick="toggleAccountDropdown('${dropdownId}')">
        <span class="account-avatar">${initials}</span>
        <span class="account-name">${escapeHtml(user.user_metadata?.name || user.email)}</span>
        <span class="dropdown-caret">▾</span>
      </button>
      <div class="account-dropdown" id="${dropdownId}" style="display:none;">
        <div class="account-dropdown-header">
          <div class="account-avatar-lg">${initials}</div>
          <div class="account-dropdown-info">
            <div class="account-dropdown-name">${escapeHtml(user.user_metadata?.name || user.email)}</div>
            <div class="account-dropdown-email">${escapeHtml(user.email)}</div>
          </div>
        </div>
        <div class="account-dropdown-divider"></div>
        <div class="account-dropdown-plan">
          <span class="plan-label">Current plan:</span>
          <span class="plan-badge plan-free">Free</span>
        </div>
        <div class="account-dropdown-divider"></div>
        <a href="dashboard.html" class="account-dropdown-item">📊 Dashboard</a>
        <a href="pricing.html" class="account-dropdown-item">💰 Upgrade plan</a>
        <div class="account-dropdown-divider"></div>
        <button class="account-dropdown-item account-dropdown-logout" onclick="logout()">🚪 Sign out</button>
      </div>
    </div>
  `;
  // Asynchronously update plan badge later
  updatePlanBadgeAsync(dropdownId);
}

async function updatePlanBadgeAsync(dropdownId) {
  const plan = await getCurrentPlan();
  const planBadge = document.querySelector(`#${dropdownId} .plan-badge`);
  if (planBadge) {
    planBadge.className = `plan-badge ${plan.badgeClass}`;
    planBadge.textContent = plan.label;
  }
}

async function initAccountDropdown() {
  renderHeaderSync(); // immediate, flicker-free render
  // Additional async updates (like plan) happen in background
}

function toggleAccountDropdown(dropdownId) {
  const dropdown = document.getElementById(dropdownId);
  if (dropdown.style.display === 'none') {
    document.querySelectorAll('.account-dropdown').forEach(d => {
      if (d.id !== dropdownId) d.style.display = 'none';
    });
    dropdown.style.display = 'block';
  } else {
    dropdown.style.display = 'none';
  }
}

// ========== EXPORT GLOBALS ==========
window.supabaseClient = supabaseClient;
window.register = register;
window.login = login;
window.logout = logout;
window.getCurrentUser = getCurrentUser;
window.getCachedUser = getCachedUser;
window.getCurrentPlan = getCurrentPlan;
window.incrementCrawlCount = incrementCrawlCount;
window.getCrawlCount = getCrawlCount;
window.canCrawl = canCrawl;
window.loadSettings = loadSettings;
window.saveSettings = saveSettings;
window.callAI = callAI;
window.callAIWithRetry = callAIWithRetry;
window.openModal = openModal;
window.closeModal = closeModal;
window.switchModalTab = switchModalTab;
window.doLogin = doLogin;
window.doRegister = doRegister;
window.escapeHtml = escapeHtml;
window.PLANS = PLANS;
window.initAccountDropdown = initAccountDropdown;
window.toggleAccountDropdown = toggleAccountDropdown;