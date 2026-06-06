/**
 * auth.js — News Sentiment Radar
 *
 * • All plan data comes from Supabase (server-side RLS enforced)
 * • API keys encrypted at rest in user_settings
 * • 3-day trial with automatic expiry
 * • Single-device enforcement (free/pro), unlimited for enterprise
 * • Zero localStorage usage for auth / plan / keys
 * • Modal auto-injected on every page
 */

// ── Supabase client ────────────────────────────────────────────────
const SUPABASE_URL      = 'https://mpwbiaquisxwgugejfra.supabase.co';
const SUPABASE_ANON_KEY = 'sb_publishable__6fx1vLV-dnLmTNd0uYV9g_CQKy2Cju';
const _sb = supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

// Expose the raw client for dashboard logic that needs direct table access
window.supabase = _sb;

// ── Plan definitions (UI labels / CSS only — limits come from DB) ──
const PLAN_META = {
  free:       { label:'Free',       badgeClass:'plan-free',       crawlLimit:50,          allSources:false, canUseBriefs:false, canUseDrafts:false, multiDevice:false },
  trial:      { label:'Trial',      badgeClass:'plan-trial',      crawlLimit:Infinity,    allSources:true,  canUseBriefs:true,  canUseDrafts:true,  multiDevice:false },
  pro:        { label:'Pro',        badgeClass:'plan-pro',        crawlLimit:Infinity,    allSources:true,  canUseBriefs:true,  canUseDrafts:true,  multiDevice:false },
  enterprise: { label:'Enterprise', badgeClass:'plan-enterprise', crawlLimit:Infinity,    allSources:true,  canUseBriefs:true,  canUseDrafts:true,  multiDevice:true  },
};

// ── In-memory cache (cleared on logout) ───────────────────────────
let _cachedProfile  = null;   // { id, name, plan, trial_expires_at, trial_used, ... }
let _cachedSettings = null;   // { aiProvider, anthropicKey, mistralKey, rss2jsonKey, proxyUrl, aiKeywordsEnabled }
let _deviceFp       = null;   // device fingerprint (computed once per page load)

// ── XSS helper ────────────────────────────────────────────────────
window.escapeHtml = function(str) {
  if (!str) return '';
  return String(str).replace(/[&<>"']/g, m => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m]));
};
const esc = window.escapeHtml;

// ══════════════════════════════════════════════════════════════════
//  DEVICE FINGERPRINT
// ══════════════════════════════════════════════════════════════════
async function getDeviceFingerprint() {
  if (_deviceFp) return _deviceFp;
  const raw = [
    navigator.userAgent,
    screen.width + 'x' + screen.height + 'x' + screen.colorDepth,
    Intl.DateTimeFormat().resolvedOptions().timeZone,
    navigator.language,
    navigator.hardwareConcurrency || 0,
  ].join('|');
  // SHA-256 via SubtleCrypto
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(raw));
  _deviceFp = Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2,'0')).join('');
  return _deviceFp;
}

// ══════════════════════════════════════════════════════════════════
//  AUTH FUNCTIONS
// ══════════════════════════════════════════════════════════════════
window.login = async function(email, password) {
  const { data, error } = await _sb.auth.signInWithPassword({ email, password });
  if (error) throw error;
  return data.user;
};

window.register = async function(name, email, password) {
  const { data, error } = await _sb.auth.signUp({ email, password, options:{ data:{ name } } });
  if (error) throw error;
  return data.user;
};

window.logout = async function() {
  try {
    const fp = await getDeviceFingerprint();
    // Deactivate device session server-side before signing out
    await _sb.rpc('deactivate_session', { p_device_fingerprint: fp });
  } catch(e) { /* best-effort */ }
  _cachedProfile  = null;
  _cachedSettings = null;
  await _sb.auth.signOut();
  window.location.href = 'index.html';
};

// ══════════════════════════════════════════════════════════════════
//  PROFILE & PLAN  (server-side, RLS enforced)
// ══════════════════════════════════════════════════════════════════

/**
 * Load profile from Supabase. Triggers trial expiry check on server.
 * Returns enriched profile object or null.
 */
window.loadProfile = async function(force = false) {
  if (_cachedProfile && !force) return _cachedProfile;

  const { data:{ user } } = await _sb.auth.getUser();
  if (!user) { _cachedProfile = null; return null; }

  // Trigger server-side trial expiry check
  try { await _sb.rpc('maybe_expire_trial', { p_user_id: user.id }); } catch(e) {}

  // Load enriched plan view
  const { data, error } = await _sb
    .from('v_plan_features')
    .select('*')
    .eq('id', user.id)
    .single();

  if (error || !data) {
    // Fallback: profile may not exist yet (race condition after signup)
    _cachedProfile = { id: user.id, name: user.user_metadata?.name || user.email.split('@')[0], plan: 'free', ...PLAN_META.free };
    return _cachedProfile;
  }

  const meta = PLAN_META[data.plan] || PLAN_META.free;
  _cachedProfile = {
    id:              data.id,
    name:            data.name || user.user_metadata?.name || user.email.split('@')[0],
    email:           user.email,
    plan:            data.plan,
    trialExpiresAt:  data.trial_expires_at,
    trialUsed:       data.trial_used,
    crawlLimit:      data.crawl_limit,
    canUseBriefs:    data.can_use_briefs,
    canUseDrafts:    data.can_use_drafts,
    allSources:      data.all_sources,
    multiDevice:     data.multi_device,
    ...meta,
  };
  return _cachedProfile;
};

window.getCurrentPlan = async function() {
  const profile = await window.loadProfile();
  return profile ? (PLAN_META[profile.plan] || PLAN_META.free) : PLAN_META.free;
};

// ══════════════════════════════════════════════════════════════════
//  TRIAL ACTIVATION
// ══════════════════════════════════════════════════════════════════
window.activateTrial = async function() {
  const { data:{ user } } = await _sb.auth.getUser();
  if (!user) throw new Error('Not authenticated');

  const { data, error } = await _sb.rpc('activate_trial', { p_user_id: user.id });
  if (error) throw error;

  const result = typeof data === 'string' ? JSON.parse(data) : data;
  if (!result.success) throw new Error(result.reason || 'Could not activate trial');

  // Refresh cached profile
  await window.loadProfile(true);
  return result;
};

// ══════════════════════════════════════════════════════════════════
//  CRAWL USAGE  (server-side, per user per month)
// ══════════════════════════════════════════════════════════════════
window.getCrawlCount = async function() {
  try {
    const { data, error } = await _sb.rpc('get_crawl_count');
    if (error) throw error;
    return data || 0;
  } catch(e) { return 0; }
};

window.incrementCrawlCount = async function() {
  const { data:{ user } } = await _sb.auth.getUser();
  if (!user) throw new Error('Not authenticated');
  const { data, error } = await _sb.rpc('increment_crawl_usage', { p_user_id: user.id });
  if (error) throw error;
  return data;
};

window.canCrawl = async function() {
  const profile = await window.loadProfile();
  if (!profile) return { ok: false, reason: 'Not authenticated' };
  if (profile.crawlLimit === Infinity || profile.crawlLimit === 2147483647) return { ok: true };
  const used = await window.getCrawlCount();
  if (used >= profile.crawlLimit) return { ok: false, reason: `Monthly limit of ${profile.crawlLimit} crawls reached.`, used, limit: profile.crawlLimit };
  return { ok: true, used, limit: profile.crawlLimit };
};

// ══════════════════════════════════════════════════════════════════
//  DEVICE / SESSION ENFORCEMENT
// ══════════════════════════════════════════════════════════════════
window.checkDeviceAccess = async function() {
  const { data:{ user } } = await _sb.auth.getUser();
  if (!user) return { allowed: false, reason: 'Not authenticated' };

  const fp       = await getDeviceFingerprint();
  const { data:{ session } } = await _sb.auth.getSession();
  const token    = session?.access_token?.slice(-16) || 'unknown';

  // Get IP via a public free endpoint (client-side best effort)
  let ip = 'unknown';
  try {
    const res = await fetch('https://api.ipify.org?format=json', { cache: 'force-cache' });
    const ipData = await res.json();
    ip = ipData.ip || 'unknown';
  } catch(e) {}

  const { data, error } = await _sb.rpc('check_device_access', {
    p_user_id:           user.id,
    p_device_fingerprint: fp,
    p_ip_address:        ip,
    p_session_token:     token,
  });

  if (error) return { allowed: true }; // fail open on RPC error

  const result = data;
  if (result === 'blocked') {
    return {
      allowed: false,
      reason: 'This account is already active on another device. Please sign out there first, or upgrade to Enterprise for multi-device access.',
    };
  }
  return { allowed: true, result };
};

// ══════════════════════════════════════════════════════════════════
//  USER SETTINGS  (stored in Supabase, encrypted keys)
// ══════════════════════════════════════════════════════════════════
window.loadSettings = async function(force = false) {
  if (_cachedSettings && !force) return _cachedSettings;

  const { data:{ user } } = await _sb.auth.getUser();
  if (!user) return _defaultSettings();

  const { data, error } = await _sb
    .from('user_settings')
    .select('ai_provider, proxy_url, ai_keywords_enabled')
    .eq('user_id', user.id)
    .maybeSingle();

  if (error || !data) {
    _cachedSettings = _defaultSettings();
    return _cachedSettings;
  }

  // Keys are never returned in plaintext from the table directly
  // — they are only decrypted server-side (via Edge Function) when actually used.
  // For display, we just indicate whether a key is set.
  const { data: keyMeta } = await _sb
    .from('user_settings')
    .select('anthropic_key_enc, mistral_key_enc, rss2json_key_enc')
    .eq('user_id', user.id)
    .maybeSingle();

  _cachedSettings = {
    aiProvider:        data.ai_provider          || 'anthropic',
    proxyUrl:          data.proxy_url            || '',
    aiKeywordsEnabled: data.ai_keywords_enabled  !== false,
    anthropicKeySet:   !!keyMeta?.anthropic_key_enc,
    mistralKeySet:     !!keyMeta?.mistral_key_enc,
    rss2jsonKeySet:    !!keyMeta?.rss2json_key_enc,
    // Actual key values are submitted directly to API — never cached here
    anthropicKey:      '',
    mistralKey:        '',
    rss2jsonKey:       '',
  };
  return _cachedSettings;
};

window.saveSettings = async function(settings) {
  const { data:{ user } } = await _sb.auth.getUser();
  if (!user) throw new Error('Not authenticated');

  // Build update payload — only send keys if the user typed something new
  const update = {
    user_id:              user.id,
    ai_provider:          settings.aiProvider     || 'anthropic',
    proxy_url:            settings.proxyUrl        || null,
    ai_keywords_enabled:  settings.aiKeywordsEnabled !== false,
    updated_at:           new Date().toISOString(),
  };

  const { error } = await _sb.from('user_settings').upsert(update, { onConflict: 'user_id' });
  if (error) throw error;

  // API keys must be stored via a secure Edge Function that encrypts before writing
  const keyUpdates = [];
  if (settings.anthropicKey)  keyUpdates.push(_storeEncryptedKey(user.id, 'anthropic', settings.anthropicKey));
  if (settings.mistralKey)    keyUpdates.push(_storeEncryptedKey(user.id, 'mistral',   settings.mistralKey));
  if (settings.rss2jsonKey)   keyUpdates.push(_storeEncryptedKey(user.id, 'rss2json',  settings.rss2jsonKey));
  await Promise.allSettled(keyUpdates);

  _cachedSettings = null; // force reload
};

/** Store an encrypted API key via Supabase Edge Function */
async function _storeEncryptedKey(userId, keyType, keyValue) {
  // Call your Supabase Edge Function: supabase/functions/store-key/index.ts
  // It receives the plaintext, encrypts with pgcrypto, writes to user_settings.
  try {
    const { error } = await _sb.functions.invoke('store-key', {
      body: { userId, keyType, keyValue },
    });
    if (error) console.error('store-key error:', error);
  } catch(e) {
    console.error('store-key invoke failed:', e);
  }
}

/** Retrieve an API key (decrypted) via Edge Function for use in AI calls */
window.getApiKey = async function(keyType) {
  try {
    const { data, error } = await _sb.functions.invoke('get-key', { body: { keyType } });
    if (error) throw error;
    return data?.keyValue || '';
  } catch(e) {
    // If edge function not deployed, fallback gracefully
    return '';
  }
};

function _defaultSettings() {
  return { aiProvider:'anthropic', proxyUrl:'', aiKeywordsEnabled:true, anthropicKeySet:false, mistralKeySet:false, rss2jsonKeySet:false, anthropicKey:'', mistralKey:'', rss2jsonKey:'' };
}

// ══════════════════════════════════════════════════════════════════
//  MODAL INJECTION
// ══════════════════════════════════════════════════════════════════
function injectModal() {
  if (document.getElementById('authModal')) return;

  document.body.insertAdjacentHTML('beforeend', `
    <div class="modal-backdrop" id="authModal">
      <div class="modal">
        <button class="modal-close" id="closeModalBtn" aria-label="Close">×</button>
        <div class="modal-tabs">
          <button class="modal-tab active" id="tabLoginBtn">Sign in</button>
          <button class="modal-tab" id="tabRegisterBtn">Create account</button>
        </div>

        <!-- Login form -->
        <div id="formLogin">
          <div class="modal-error" id="loginError"></div>
          <div class="form-field">
            <label>Email address</label>
            <input type="email" id="loginEmail" placeholder="you@example.com" autocomplete="email">
          </div>
          <div class="form-field">
            <label>Password</label>
            <input type="password" id="loginPassword" placeholder="••••••••" autocomplete="current-password">
          </div>
          <button class="modal-btn-full" id="doLoginBtn">Sign in</button>
          <div class="modal-footer-link">
            <a id="switchToRegister">Don't have an account? Create one free →</a>
          </div>
        </div>

        <!-- Register form -->
        <div id="formRegister" style="display:none">
          <div class="modal-error" id="registerError"></div>
          <div class="modal-success" id="registerSuccess"></div>
          <div class="form-field">
            <label>Full name</label>
            <input type="text" id="regName" placeholder="Jane Smith" autocomplete="name">
          </div>
          <div class="form-field">
            <label>Email address</label>
            <input type="email" id="regEmail" placeholder="you@example.com" autocomplete="email">
          </div>
          <div class="form-field">
            <label>Password</label>
            <input type="password" id="regPassword" placeholder="At least 8 characters" autocomplete="new-password">
          </div>
          <button class="modal-btn-full" id="doRegisterBtn">Create free account</button>
          <div class="modal-footer-link" style="font-size:11px;margin-top:14px">
            By signing up you agree to our <a href="#">Terms</a>.
          </div>
        </div>
      </div>
    </div>
  `);
}

function _setLoading(btn, loading, defaultText) {
  btn.disabled = loading;
  btn.textContent = loading ? (defaultText.includes('Sign') ? 'Signing in…' : 'Creating account…') : defaultText;
}

function _showError(id, msg) {
  const el = document.getElementById(id);
  if (el) { el.textContent = msg; el.style.display = 'block'; }
}
function _hideErrors() {
  ['loginError','registerError','registerSuccess'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.style.display = 'none';
  });
}

function bindModalListeners() {
  document.getElementById('closeModalBtn')?.addEventListener('click', window.hideAuthModal);
  document.getElementById('tabLoginBtn')?.addEventListener('click',    () => _switchTab('login'));
  document.getElementById('tabRegisterBtn')?.addEventListener('click', () => _switchTab('register'));
  document.getElementById('switchToRegister')?.addEventListener('click', () => _switchTab('register'));

  // Enter key submits
  document.getElementById('loginPassword')?.addEventListener('keydown',  e => { if (e.key === 'Enter') document.getElementById('doLoginBtn')?.click(); });
  document.getElementById('regPassword')?.addEventListener('keydown',    e => { if (e.key === 'Enter') document.getElementById('doRegisterBtn')?.click(); });

  // Login
  document.getElementById('doLoginBtn')?.addEventListener('click', async () => {
    const email    = document.getElementById('loginEmail').value.trim();
    const password = document.getElementById('loginPassword').value;
    const btn      = document.getElementById('doLoginBtn');
    _hideErrors();

    if (!email || !password) { _showError('loginError', 'Please enter your email and password.'); return; }

    _setLoading(btn, true, 'Sign in');
    try {
      await window.login(email, password);

      // Check device access after login
      const access = await window.checkDeviceAccess();
      if (!access.allowed) {
        await _sb.auth.signOut();
        _setLoading(btn, false, 'Sign in');
        _showError('loginError', access.reason);
        return;
      }

      window.hideAuthModal();
      window.location.reload();
    } catch(err) {
      _showError('loginError', err.message || 'Login failed. Please try again.');
    } finally {
      _setLoading(btn, false, 'Sign in');
    }
  });

  // Register
  document.getElementById('doRegisterBtn')?.addEventListener('click', async () => {
    const name     = document.getElementById('regName').value.trim();
    const email    = document.getElementById('regEmail').value.trim();
    const password = document.getElementById('regPassword').value;
    const btn      = document.getElementById('doRegisterBtn');
    _hideErrors();

    if (!name || !email || !password) { _showError('registerError', 'Please fill in all fields.'); return; }
    if (password.length < 8) { _showError('registerError', 'Password must be at least 8 characters.'); return; }

    _setLoading(btn, true, 'Create free account');
    try {
      await window.register(name, email, password);
      const successEl = document.getElementById('registerSuccess');
      if (successEl) { successEl.textContent = '✓ Account created! Check your email to confirm, then sign in.'; successEl.style.display = 'block'; }
      setTimeout(() => {
        _switchTab('login');
        document.getElementById('loginEmail').value = email;
        document.getElementById('loginEmail').focus();
      }, 2000);
    } catch(err) {
      _showError('registerError', err.message || 'Registration failed. Please try again.');
    } finally {
      _setLoading(btn, false, 'Create free account');
    }
  });
}

function _switchTab(tab) {
  const loginForm    = document.getElementById('formLogin');
  const registerForm = document.getElementById('formRegister');
  const tabLogin     = document.getElementById('tabLoginBtn');
  const tabRegister  = document.getElementById('tabRegisterBtn');
  if (!loginForm || !registerForm) return;
  const isLogin = tab === 'login';
  loginForm.style.display    = isLogin ? 'block' : 'none';
  registerForm.style.display = isLogin ? 'none'  : 'block';
  tabLogin?.classList.toggle('active', isLogin);
  tabRegister?.classList.toggle('active', !isLogin);
  _hideErrors();
  setTimeout(() => document.getElementById(isLogin ? 'loginEmail' : 'regName')?.focus(), 80);
}

window.showAuthModal = function(tab = 'login') {
  const modal = document.getElementById('authModal');
  if (!modal) return;
  modal.classList.add('open');
  _switchTab(tab);
  // Clear inputs
  ['loginEmail','loginPassword','regName','regEmail','regPassword'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.value = '';
  });
};

window.hideAuthModal = function() {
  document.getElementById('authModal')?.classList.remove('open');
};

window.checkAuthAndRedirect = async function(url) {
  const { data:{ user } } = await _sb.auth.getUser();
  if (user) window.location.href = url;
  else window.showAuthModal('login');
};

// ══════════════════════════════════════════════════════════════════
//  HEADER RENDERING  (account dropdown with plan badge)
// ══════════════════════════════════════════════════════════════════
async function renderHeader() {
  const headerAuth = document.getElementById('headerAuth');
  if (!headerAuth) return;

  const { data:{ user } } = await _sb.auth.getUser();

  if (!user) {
    headerAuth.innerHTML = `
      <button class="btn btn-outline btn-sm" id="headerSignInBtn">Sign in</button>
      <a href="dashboard.html"><button class="btn btn-sm">Dashboard</button></a>`;
    document.getElementById('headerSignInBtn')?.addEventListener('click', () => window.showAuthModal('login'));
    if (typeof window.onAuthStateChecked === 'function') window.onAuthStateChecked(null);
    return;
  }

  const profile = await window.loadProfile();
  const meta    = profile ? (PLAN_META[profile.plan] || PLAN_META.free) : PLAN_META.free;
  const initials = (profile?.name || user.email)
    .split(' ').map(n => n[0]).join('').toUpperCase().slice(0, 2);
  const displayName = profile?.name || user.email.split('@')[0];

  // Trial expiry banner
  let trialBanner = '';
  if (profile?.plan === 'trial' && profile.trialExpiresAt) {
    const remaining = Math.ceil((new Date(profile.trialExpiresAt) - Date.now()) / 86400000);
    trialBanner = `<span class="trial-countdown">${remaining}d trial</span>`;
  }

  const dropId = 'userDropdown';
  headerAuth.innerHTML = `
    <div style="position:relative">
      <button class="user-menu-btn" id="userMenuBtn" aria-haspopup="true" aria-expanded="false">
        <span class="user-avatar">${esc(initials)}</span>
        <span class="user-menu-name">${esc(displayName)}</span>
        ${trialBanner}
        <span class="plan-badge ${meta.badgeClass}">${meta.label}</span>
        <span class="user-caret">▾</span>
      </button>
      <div id="${dropId}" class="user-dropdown" role="menu" style="display:none">
        <div class="user-dropdown-header">
          <div class="user-avatar user-avatar-lg">${esc(initials)}</div>
          <div class="user-dropdown-info">
            <div class="user-dropdown-name">${esc(profile?.name || displayName)}</div>
            <div class="user-dropdown-email">${esc(user.email)}</div>
          </div>
        </div>
        <div class="user-dropdown-plan">
          <span class="ud-label">Current plan</span>
          <span class="plan-badge ${meta.badgeClass}">${meta.label}</span>
        </div>
        <div class="user-dropdown-divider"></div>
        <a href="dashboard.html" class="user-dropdown-item" role="menuitem">📊 Dashboard</a>
        <a href="pricing.html"   class="user-dropdown-item" role="menuitem">💰 Upgrade plan</a>
        <div class="user-dropdown-divider"></div>
        <button class="user-dropdown-item user-dropdown-logout" id="headerLogoutBtn" role="menuitem">🚪 Sign out</button>
      </div>
    </div>`;

  const menuBtn  = document.getElementById('userMenuBtn');
  const dropdown = document.getElementById(dropId);
  menuBtn?.addEventListener('click', e => {
    e.stopPropagation();
    const open = dropdown.style.display !== 'none';
    dropdown.style.display = open ? 'none' : 'block';
    menuBtn.setAttribute('aria-expanded', String(!open));
  });
  document.getElementById('headerLogoutBtn')?.addEventListener('click', window.logout);
  document.addEventListener('click', () => {
    if (dropdown) dropdown.style.display = 'none';
  }, { capture: false });

  if (typeof window.onAuthStateChecked === 'function') window.onAuthStateChecked(user, profile);
}

// ══════════════════════════════════════════════════════════════════
//  TRIAL BANNER  (shown on dashboard for free users who haven't tried)
// ══════════════════════════════════════════════════════════════════
window.renderTrialBanner = async function(containerId) {
  const container = document.getElementById(containerId);
  if (!container) return;
  const profile = await window.loadProfile();
  if (!profile || profile.plan !== 'free' || profile.trialUsed) return;

  container.innerHTML = `
    <div class="trial-banner" id="trialBannerEl">
      <div class="trial-banner-content">
        <span class="trial-banner-icon">⚡</span>
        <div>
          <strong>Start your 3-day Pro trial — free</strong>
          <div class="trial-banner-sub">Get unlimited crawls, briefs, drafts &amp; all sources for 3 days. No credit card needed.</div>
        </div>
      </div>
      <button class="trial-banner-btn" id="startTrialBtn">Start free trial →</button>
    </div>`;

  document.getElementById('startTrialBtn')?.addEventListener('click', async () => {
    const btn = document.getElementById('startTrialBtn');
    btn.disabled = true;
    btn.textContent = 'Activating…';
    try {
      const result = await window.activateTrial();
      document.getElementById('trialBannerEl').innerHTML = `
        <div class="trial-banner" style="background:rgba(139,201,127,0.1);border-color:rgba(139,201,127,0.3)">
          <span style="color:#8BC97F;font-size:1.1rem">✓ Trial activated! Expires in 3 days.</span>
        </div>`;
      setTimeout(() => window.location.reload(), 1500);
    } catch(err) {
      btn.disabled = false;
      btn.textContent = 'Start free trial →';
      alert('Could not activate trial: ' + err.message);
    }
  });
};

// ══════════════════════════════════════════════════════════════════
//  BOOT (DOMContentLoaded)
// ══════════════════════════════════════════════════════════════════
document.addEventListener('DOMContentLoaded', () => {
  injectModal();
  bindModalListeners();
  renderHeader();
});
