// ========== SUPABASE CLIENT INITIALIZATION ==========
const SUPABASE_URL = 'https://mpwbiaquisxwgugejfra.supabase.co';
const SUPABASE_ANON_KEY = 'sb_publishable__6fx1vLV-dnLmTNd0uYV9g_CQKy2Cju';

const supabaseClient = supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

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

// ========== HELPER: ESCAPE HTML ==========
function escapeHtml(str) {
  if (!str) return '';
  return str.replace(/[&<>]/g, function(m) {
    if (m === '&') return '&amp;';
    if (m === '<') return '&lt;';
    if (m === '>') return '&gt;';
    return m;
  });
}

// ========== ENSURE PROFILE EXISTS ==========
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

// ========== AUTHENTICATION FUNCTIONS ==========
async function register(name, email, password) {
  const { data, error } = await supabaseClient.auth.signUp({
    email,
    password,
    options: { data: { name } }
  });
  if (error) throw error;
  if (data.user) await ensureProfileExists(data.user.id, name);
  return data.user;
}

async function login(email, password) {
  const { data, error } = await supabaseClient.auth.signInWithPassword({ email, password });
  if (error) throw error;
  if (data.user) await ensureProfileExists(data.user.id, data.user.user_metadata?.name);
  return data.user;
}

async function logout() {
  await supabaseClient.auth.signOut();
  window.location.href = '/'; // redirect to home after logout
}

async function getCurrentUser() {
  const { data: { user } } = await supabaseClient.auth.getUser();
  if (!user) return null;

  await ensureProfileExists(user.id, user.user_metadata?.name);

  const { data: profile } = await supabaseClient
    .from('profiles')
    .select('*')
    .eq('id', user.id)
    .single();

  return {
    ...user,
    name: profile?.name || user.user_metadata?.name,
    plan: profile?.plan || 'free'
  };
}

async function getCurrentPlan() {
  const user = await getCurrentUser();
  if (!user) return PLANS.free;
  return PLANS[user.plan] || PLANS.free;
}

// ========== CRAWL USAGE ==========
async function incrementCrawlCount() {
  const { data: { user } } = await supabaseClient.auth.getUser();
  if (!user) throw new Error('Not logged in');
  
  const { data, error } = await supabaseClient.rpc('increment_crawl_usage', {
    p_user_id: user.id
  });
  if (error) throw error;
  return data;
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

// ========== USER SETTINGS ==========
async function loadSettings() {
  const { data: { user } } = await supabaseClient.auth.getUser();
  if (!user) return { aiProvider: 'anthropic', rss2jsonKey: '', proxyUrl: '', aiKeywords: true };
  
  const { data, error } = await supabaseClient
    .from('user_settings')
    .select('*')
    .eq('user_id', user.id)
    .maybeSingle();
  
  if (error && error.code !== 'PGRST116') throw error;
  if (!data) {
    const { data: newData, error: insertError } = await supabaseClient
      .from('user_settings')
      .insert({ user_id: user.id, ai_provider: 'anthropic', ai_keywords_enabled: true })
      .select()
      .single();
    if (insertError) throw insertError;
    return mapSettingsFromDB(newData);
  }
  return mapSettingsFromDB(data);
}

function mapSettingsFromDB(db) {
  return {
    aiProvider: db.ai_provider,
    rss2jsonKey: db.rss2json_key || '',
    proxyUrl: db.proxy_url || '',
    aiKeywords: db.ai_keywords_enabled
  };
}

async function saveSettings(settings) {
  const { data: { user } } = await supabaseClient.auth.getUser();
  if (!user) return;
  
  const { error } = await supabaseClient
    .from('user_settings')
    .upsert({
      user_id: user.id,
      ai_provider: settings.aiProvider,
      rss2json_key: settings.rss2jsonKey,
      proxy_url: settings.proxyUrl,
      ai_keywords_enabled: settings.aiKeywords,
      updated_at: new Date()
    });
  if (error) throw error;
}

// ========== AI CALL THROUGH EDGE FUNCTION ==========
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

// ========== MODAL FUNCTIONS ==========
let modalOpenCallback = null;

function openModal(tab = 'login') {
  const modal = document.getElementById('authModal');
  if (!modal) return;
  modal.classList.add('open');
  switchModalTab(tab);
  setTimeout(() => {
    const input = document.querySelector(`#${tab === 'login' ? 'loginEmail' : 'regName'}`);
    if (input) input.focus();
  }, 100);
}

function closeModal() {
  const modal = document.getElementById('authModal');
  if (modal) modal.classList.remove('open');
  document.getElementById('loginEmail').value = '';
  document.getElementById('loginPassword').value = '';
  document.getElementById('regName').value = '';
  document.getElementById('regEmail').value = '';
  document.getElementById('regPassword').value = '';
}

function switchModalTab(tab) {
  const loginForm = document.getElementById('formLogin');
  const registerForm = document.getElementById('formRegister');
  const tabLogin = document.getElementById('tabLogin');
  const tabRegister = document.getElementById('tabRegister');
  
  if (tab === 'login') {
    loginForm.style.display = 'block';
    registerForm.style.display = 'none';
    tabLogin.classList.add('active');
    tabRegister.classList.remove('active');
  } else {
    loginForm.style.display = 'none';
    registerForm.style.display = 'block';
    tabRegister.classList.add('active');
    tabLogin.classList.remove('active');
  }
  
  const loginError = document.getElementById('loginError');
  const registerError = document.getElementById('registerError');
  const registerSuccess = document.getElementById('registerSuccess');
  if (loginError) loginError.style.display = 'none';
  if (registerError) registerError.style.display = 'none';
  if (registerSuccess) registerSuccess.style.display = 'none';
}

async function doLogin() {
  const email = document.getElementById('loginEmail').value.trim();
  const password = document.getElementById('loginPassword').value;
  const errorDiv = document.getElementById('loginError');
  const btn = event.target;
  
  if (!email || !password) {
    if (errorDiv) {
      errorDiv.textContent = 'Please enter both email and password';
      errorDiv.style.display = 'block';
    }
    return;
  }
  
  btn.disabled = true;
  btn.textContent = 'Signing in...';
  
  try {
    await login(email, password);
    closeModal();
    window.location.href = 'dashboard.html';
  } catch (err) {
    if (errorDiv) {
      errorDiv.textContent = err.message || 'Failed to sign in. Please check your credentials.';
      errorDiv.style.display = 'block';
    }
  } finally {
    btn.disabled = false;
    btn.textContent = 'Sign in';
  }
}

async function doRegister() {
  const name = document.getElementById('regName').value.trim();
  const email = document.getElementById('regEmail').value.trim();
  const password = document.getElementById('regPassword').value;
  const errorDiv = document.getElementById('registerError');
  const successDiv = document.getElementById('registerSuccess');
  const btn = event.target;
  
  if (!name || !email || !password) {
    if (errorDiv) {
      errorDiv.textContent = 'Please fill in all fields';
      errorDiv.style.display = 'block';
    }
    return;
  }
  
  if (password.length < 8) {
    if (errorDiv) {
      errorDiv.textContent = 'Password must be at least 8 characters';
      errorDiv.style.display = 'block';
    }
    return;
  }
  
  btn.disabled = true;
  btn.textContent = 'Creating account...';
  
  try {
    await register(name, email, password);
    if (successDiv) {
      successDiv.textContent = '✓ Account created! Check your email to confirm.';
      successDiv.style.display = 'block';
    }
    if (errorDiv) errorDiv.style.display = 'none';
    setTimeout(() => {
      switchModalTab('login');
      document.getElementById('loginEmail').value = email;
      document.getElementById('loginEmail').focus();
    }, 2000);
  } catch (err) {
    if (errorDiv) {
      errorDiv.textContent = err.message || 'Failed to create account. Please try again.';
      errorDiv.style.display = 'block';
    }
  } finally {
    btn.disabled = false;
    btn.textContent = 'Create free account';
  }
}

// ========== ACCOUNT DROPDOWN ==========
async function initAccountDropdown() {
  const user = await getCurrentUser();
  const headerAuth = document.getElementById('siteHeaderAuth') || document.getElementById('headerAuth');
  
  if (!user || !headerAuth) return;
  
  const plan = await getCurrentPlan();
  const initials = (user.name || user.email)
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
        <span class="account-name">${escapeHtml(user.name || user.email)}</span>
        <span class="dropdown-caret">▾</span>
      </button>
      <div class="account-dropdown" id="${dropdownId}" style="display:none;">
        <div class="account-dropdown-header">
          <div class="account-avatar-lg">${initials}</div>
          <div class="account-dropdown-info">
            <div class="account-dropdown-name">${escapeHtml(user.name || user.email)}</div>
            <div class="account-dropdown-email">${escapeHtml(user.email)}</div>
          </div>
        </div>
        <div class="account-dropdown-divider"></div>
        <div class="account-dropdown-plan">
          <span class="plan-label">Current plan:</span>
          <span class="plan-badge ${plan.badgeClass}">${plan.label}</span>
        </div>
        <div class="account-dropdown-divider"></div>
        <a href="dashboard.html" class="account-dropdown-item">📊 Dashboard</a>
        <a href="pricing.html" class="account-dropdown-item">💰 Upgrade plan</a>
        <div class="account-dropdown-divider"></div>
        <button class="account-dropdown-item account-dropdown-logout" onclick="logout()">🚪 Sign out</button>
      </div>
    </div>
  `;
  
  document.addEventListener('click', function(e) {
    const dropdown = document.getElementById(dropdownId);
    const btn = e.target.closest('.account-menu-btn');
    if (!btn && dropdown && dropdown.style.display !== 'none') {
      dropdown.style.display = 'none';
    }
  });
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

// ========== EXPORT ==========
window.supabaseClient = supabaseClient;
window.register = register;
window.login = login;
window.logout = logout;
window.getCurrentUser = getCurrentUser;
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