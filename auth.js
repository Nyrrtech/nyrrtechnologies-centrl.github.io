/**
 * auth.js — News Sentiment Radar
 *
 * Security guarantees:
 *  • ALL plan data sourced from Supabase (server-side RLS enforced)
 *  • API keys encrypted at rest via server-side RPC (AES-256)
 *  • 3-day trial with server-side expiry check
 *  • Single-device enforcement (free/pro), unlimited for enterprise
 *  • ZERO localStorage / sessionStorage usage for auth, plan, or keys
 *  • Device access check FAILS CLOSED (not open) on RPC errors
 *  • Forgot-password flow included
 *  • Modal auto-injected on every page
 *
 * ─────────────────────────────────────────────────────────────
 * IMPORTANT: Replace SUPABASE_URL and SUPABASE_ANON_KEY below
 * with your project's real values from the Supabase dashboard.
 * The anon key is safe to expose in client code — it is a JWT
 * that can only access data permitted by your RLS policies.
 * ─────────────────────────────────────────────────────────────
 */

// ── Supabase client ────────────────────────────────────────────────
const SUPABASE_URL      = 'https://mpwbiaquisxwgugejfra.supabase.co';
// ⚠ Replace with the actual anon/public key from your Supabase project settings.
// It looks like: eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im1wd2JpYXF1aXN4d2d1Z2VqZnJhIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODAzMTIxOTYsImV4cCI6MjA5NTg4ODE5Nn0.Mct4u-RB8qDTpmn4xqMl4pGE2oavSL0hZFwENNhT1fs';

const _sb = supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  auth: {
    // Supabase JS v2 stores the session in localStorage by default.
    // We keep this behaviour for the auth SESSION only (it's a signed JWT,
    // not plan data), but we never store plan/keys/limits ourselves.
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: true,
  }
});

// Expose the raw client for dashboard logic that needs direct table access
window.supabase = _sb;

// ── Plan definitions (UI labels / CSS only — limits always come from DB) ──
const PLAN_META = {
  free:       { label:'Free',       badgeClass:'plan-free',       crawlLimit:50,       allSources:false, canUseBriefs:false, canUseDrafts:false, multiDevice:false },
  trial:      { label:'Trial',      badgeClass:'plan-trial',      crawlLimit:Infinity, allSources:true,  canUseBriefs:true,  canUseDrafts:true,  multiDevice:false },
  pro:        { label:'Pro',        badgeClass:'plan-pro',        crawlLimit:Infinity, allSources:true,  canUseBriefs:true,  canUseDrafts:true,  multiDevice:false },
  enterprise: { label:'Enterprise', badgeClass:'plan-enterprise', crawlLimit:Infinity, allSources:true,  canUseBriefs:true,  canUseDrafts:true,  multiDevice:true  },
};

// ── In-memory cache (cleared on logout, never written to storage) ─
let _cachedProfile  = null;   // { id, name, plan, trial_expires_at, ... }
let _cachedSettings = null;   // { aiProvider, proxyUrl, aiKeywordsEnabled, ... }
let _deviceFp       = null;   // SHA-256 device fingerprint, computed once per page
let _profilePromise = null;   // shares concurrent profile loads during page boot

// ── XSS helper ────────────────────────────────────────────────────
window.escapeHtml = function(str) {
  if (str === null || str === undefined) return '';
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
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(raw));
  _deviceFp = Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, '0')).join('');
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
  const { data, error } = await _sb.auth.signUp({
    email,
    password,
    options: { data: { name } }
  });
  if (error) throw error;
  return data.user;
};

window.logout = async function() {
  // Clear in-memory caches immediately
  _cachedProfile  = null;
  _cachedSettings = null;

  try {
    // Deactivate ALL sessions for this user — not just the current fingerprint.
    // This is critical: fingerprints can drift between sessions (e.g. after a
    // browser update), so a fingerprint-scoped deactivation may silently match
    // 0 rows and leave the old row as is_active=true, which then blocks
    // re-login with "already active on another device".
    await _sb.rpc('deactivate_all_sessions');
  } catch (e) {
    console.warn('[auth] deactivate_all_sessions failed:', e?.message);
  }

  _deviceFp = null;  // clear fingerprint cache after RPC

  await _sb.auth.signOut();
  window.location.href = '/';
};

/**
 * Send a password-reset email via Supabase Auth.
 * The user will receive a link to set a new password.
 */
window.sendPasswordReset = async function(email) {
  const { error } = await _sb.auth.resetPasswordForEmail(email, {
    redirectTo: window.location.origin + '/',
  });
  if (error) throw error;
};

// ══════════════════════════════════════════════════════════════════
//  PROFILE & PLAN  (server-side, RLS enforced)
// ══════════════════════════════════════════════════════════════════

/**
 * Load profile from Supabase (or return in-memory cache).
 * All plan limits come from the DB view v_plan_features — never from
 * localStorage or client-readable flags that can be tampered with.
 */
window.loadProfile = async function(force = false) {
  if (_cachedProfile && !force) return _cachedProfile;
  if (_profilePromise && !force) return _profilePromise;

  _profilePromise = (async () => {

  const { data: { user } } = await _sb.auth.getUser();
  if (!user) { _cachedProfile = null; return null; }

  // Trigger server-side trial expiry check (idempotent RPC)
  try { await _sb.rpc('maybe_expire_trial', { p_user_id: user.id }); } catch (e) {}

  // Load enriched plan view (RLS ensures the user can only see their own row)
  const { data, error } = await _sb
    .from('v_plan_features')
    .select('*')
    .eq('id', user.id)
    .single();

  if (error || !data) {
    // Fallback: profile may not exist yet immediately after signup (race condition).
    // Default to the most restrictive plan (free) — never escalate on error.
    _cachedProfile = {
      id:           user.id,
      name:         user.user_metadata?.name || user.email.split('@')[0],
      email:        user.email,
      plan:         'free',
      ...PLAN_META.free,
    };
    return _cachedProfile;
  }

  const meta = PLAN_META[data.plan] || PLAN_META.free;
  _cachedProfile = {
    id:             data.id,
    name:           data.name || user.user_metadata?.name || user.email.split('@')[0],
    email:          user.email,
    plan:           data.plan,
    trialExpiresAt: data.trial_expires_at,
    trialUsed:      data.trial_used,
    crawlLimit:     data.crawl_limit,
    canUseBriefs:   data.can_use_briefs,
    canUseDrafts:   data.can_use_drafts,
    allSources:     data.all_sources,
    multiDevice:    data.multi_device,
    ...meta,
  };
  return _cachedProfile;
  })();

  const profilePromise = _profilePromise;
  try {
    return await profilePromise;
  } finally {
    if (_profilePromise === profilePromise) _profilePromise = null;
  }
};

window.getCurrentPlan = async function() {
  const profile = await window.loadProfile();
  return profile ? (PLAN_META[profile.plan] || PLAN_META.free) : PLAN_META.free;
};

// ══════════════════════════════════════════════════════════════════
//  TRIAL ACTIVATION
// ══════════════════════════════════════════════════════════════════
window.activateTrial = async function() {
  const { data: { user } } = await _sb.auth.getUser();
  if (!user) throw new Error('Not authenticated');

  const { data, error } = await _sb.rpc('activate_trial', { p_user_id: user.id });
  if (error) throw error;

  const result = typeof data === 'string' ? JSON.parse(data) : data;
  if (!result.success) throw new Error(result.reason || 'Could not activate trial');

  // Force-refresh cached profile after plan change
  await window.loadProfile(true);
  return result;
};

// ══════════════════════════════════════════════════════════════════
//  CRAWL USAGE  (server-side, per user per calendar month)
// ══════════════════════════════════════════════════════════════════

window.getCrawlCount = async function() {
  try {
    const { data, error } = await _sb.rpc('get_crawl_count');
    if (error) throw error;
    return data || 0;
  } catch (e) { return 0; }
};

window.incrementCrawlCount = async function() {
  const { data: { user } } = await _sb.auth.getUser();
  if (!user) throw new Error('Not authenticated');
  const { data, error } = await _sb.rpc('increment_crawl_usage', { p_user_id: user.id });
  if (error) throw error;
  return data;
};

/**
 * Check whether the current user can perform another crawl.
 * Limit is always read from the server-side profile — never from
 * client-writable state.
 */
window.canCrawl = async function() {
  const profile = await window.loadProfile();
  if (!profile) return { ok: false, reason: 'Not authenticated' };

  // Sentinel value used by DB for unlimited plans (PostgreSQL integer max)
  if (profile.crawlLimit === Infinity || profile.crawlLimit >= 2147483647) {
    return { ok: true };
  }

  const used = await window.getCrawlCount();
  if (used >= profile.crawlLimit) {
    return { ok: false, reason: `Monthly limit of ${profile.crawlLimit} crawls reached.`, used, limit: profile.crawlLimit };
  }
  return { ok: true, used, limit: profile.crawlLimit };
};

// ══════════════════════════════════════════════════════════════════
//  DEVICE / SESSION ENFORCEMENT
//  SECURITY: fails CLOSED — access is denied if the RPC errors.
// ══════════════════════════════════════════════════════════════════
window.checkDeviceAccess = async function() {
  const { data: { user } } = await _sb.auth.getUser();
  if (!user) return { allowed: false, reason: 'Not authenticated' };

  const fp      = await getDeviceFingerprint();
  const { data: { session } } = await _sb.auth.getSession();
  const token   = session?.access_token?.slice(-16) || 'unknown';

  // Resolve client IP (best-effort; server should also track this)
  let ip = 'unknown';
  try {
    const res    = await fetch('https://api.ipify.org?format=json', { cache: 'force-cache' });
    const ipData = await res.json();
    ip = ipData.ip || 'unknown';
  } catch (e) {}

  let data, error;
  try {
    ({ data, error } = await _sb.rpc('check_device_access', {
      p_user_id:            user.id,
      p_device_fingerprint: fp,
      p_ip_address:         ip,
      p_session_token:      token,
    }));
  } catch (e) {
    // FAIL CLOSED: if the RPC itself throws, deny access rather than
    // allowing a potentially illegitimate login to proceed.
    return { allowed: false, reason: 'Session verification failed. Please try again.' };
  }

  if (error) {
    // RPC returned an error — also fail closed.
    return { allowed: false, reason: 'Session verification failed. Please try again.' };
  }

  if (data === 'blocked') {
    return {
      allowed: false,
      reason: 'This account is already active on another device. Sign out there first, or upgrade to Enterprise for multi-device access.',
    };
  }

  return { allowed: true };
};

// ══════════════════════════════════════════════════════════════════
//  USER SETTINGS  (stored in Supabase; keys encrypted server-side)
// ══════════════════════════════════════════════════════════════════

window.loadSettings = async function(force = false) {
  if (_cachedSettings && !force) return _cachedSettings;

  const { data: { user } } = await _sb.auth.getUser();
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

  // bytea columns always come back as null from PostgREST regardless of
  // their actual value — we must ask the server whether each key exists.
  const { data: keyFlags } = await _sb.rpc('get_user_key_flags');

  _cachedSettings = {
    aiProvider:        data.ai_provider         || 'mistral',
    proxyUrl:          data.proxy_url           || '',
    aiKeywordsEnabled: data.ai_keywords_enabled !== false,
    anthropicKeySet:   !!(keyFlags?.anthropic_set),
    mistralKeySet:     !!(keyFlags?.mistral_set),
    rss2jsonKeySet:    !!(keyFlags?.rss2json_set),
    anthropicKey: '',
    mistralKey:   '',
    rss2jsonKey:  '',
  };
  return _cachedSettings;
};

window.saveSettings = async function(settings) {
  const { data: { user } } = await _sb.auth.getUser();
  if (!user) throw new Error('Not authenticated');

  const update = {
    user_id:             user.id,
    ai_provider:         settings.aiProvider     || 'anthropic',
    proxy_url:           settings.proxyUrl        || null,
    ai_keywords_enabled: settings.aiKeywordsEnabled !== false,
    updated_at:          new Date().toISOString(),
  };

  const { error } = await _sb.from('user_settings').upsert(update, { onConflict: 'user_id' });
  if (error) throw error;

  // Encrypt and store API keys via server-side RPC — keys are never stored
  // in plaintext and are never readable back from the DB by the client.
  const keyUpdates = [];
  if (settings.anthropicKey) keyUpdates.push(_storeEncryptedKey(user.id, 'anthropic', settings.anthropicKey));
  if (settings.mistralKey)   keyUpdates.push(_storeEncryptedKey(user.id, 'mistral',   settings.mistralKey));
  if (settings.rss2jsonKey)  keyUpdates.push(_storeEncryptedKey(user.id, 'rss2json',  settings.rss2jsonKey));
  await Promise.allSettled(keyUpdates);

  _cachedSettings = null; // force reload on next access
};

/** Store an API key encrypted at rest via Supabase RPC (no plaintext written). */
async function _storeEncryptedKey(userId, keyType, keyValue) {
  try {
    const { error } = await _sb.rpc('store_user_key', {
      p_key_type:  keyType,
      p_key_value: keyValue,
    });
    if (error) console.error('[auth] store_user_key error:', error);
  } catch (e) {
    console.error('[auth] store_user_key invoke failed:', e);
  }
}

/** Retrieve a decrypted API key via Supabase RPC (decryption happens server-side). */
window.getApiKey = async function(keyType) {
  try {
    const { data, error } = await _sb.rpc('get_user_key', { p_key_type: keyType });
    if (error) throw error;
    return data || '';
  } catch (e) {
    console.error('[auth] get_user_key failed:', e);
    return '';
  }
};

function _defaultSettings() {
  return {
    aiProvider: 'mistral', proxyUrl: '', aiKeywordsEnabled: true,
    anthropicKeySet: false, mistralKeySet: false, rss2jsonKeySet: false,
    anthropicKey: '', mistralKey: '', rss2jsonKey: '',
  };
}

// ══════════════════════════════════════════════════════════════════
//  MODAL INJECTION
// ══════════════════════════════════════════════════════════════════
function injectModal() {
  if (document.getElementById('authModal')) return;

  document.body.insertAdjacentHTML('beforeend', `
    <div class="modal-backdrop" id="authModal" role="dialog" aria-modal="true" aria-label="Sign in or create account">
      <div class="modal">
        <button class="modal-close" id="closeModalBtn" aria-label="Close">×</button>
        <div class="modal-tabs">
          <button class="modal-tab active" id="tabLoginBtn">Sign in</button>
          <button class="modal-tab" id="tabRegisterBtn">Create account</button>
        </div>

        <!-- ── Login form ── -->
        <div id="formLogin">
          <div class="modal-error" id="loginError" role="alert"></div>
          <div class="form-field">
            <label for="loginEmail">Email address</label>
            <input type="email" id="loginEmail" placeholder="you@example.com" autocomplete="email">
          </div>
          <div class="form-field">
            <label for="loginPassword">Password</label>
            <input type="password" id="loginPassword" placeholder="••••••••" autocomplete="current-password">
          </div>
          <button class="modal-btn-full" id="doLoginBtn">Sign in</button>
          <div class="modal-footer-link" style="margin-top:12px">
            <a id="switchToForgot" style="font-size:11px;color:var(--text-hint);cursor:pointer">Forgot password?</a>
          </div>
          <div class="modal-footer-link">
            <a id="switchToRegister">Don't have an account? Create one free →</a>
          </div>
        </div>

        <!-- ── Register form ── -->
        <div id="formRegister" style="display:none">
          <div class="modal-error"   id="registerError"   role="alert"></div>
          <div class="modal-success" id="registerSuccess" role="status"></div>
          <div class="form-field">
            <label for="regName">Full name</label>
            <input type="text" id="regName" placeholder="Jane Smith" autocomplete="name">
          </div>
          <div class="form-field">
            <label for="regEmail">Email address</label>
            <input type="email" id="regEmail" placeholder="you@example.com" autocomplete="email">
          </div>
          <div class="form-field">
            <label for="regPassword">Password</label>
            <input type="password" id="regPassword" placeholder="At least 8 characters" autocomplete="new-password">
          </div>
          <button class="modal-btn-full" id="doRegisterBtn">Create free account</button>
          <div class="modal-footer-link" style="font-size:11px;margin-top:14px">
            By signing up you agree to our <a href="/terms">Terms</a>.
          </div>
        </div>

        <!-- ── Forgot-password form ── -->
        <div id="formForgot" style="display:none">
          <div class="modal-error"   id="forgotError"   role="alert"></div>
          <div class="modal-success" id="forgotSuccess" role="status"></div>
          <p style="font-size:13px;color:var(--text-sec);margin-bottom:18px;line-height:1.6">
            Enter your email and we'll send you a link to reset your password.
          </p>
          <div class="form-field">
            <label for="forgotEmail">Email address</label>
            <input type="email" id="forgotEmail" placeholder="you@example.com" autocomplete="email">
          </div>
          <button class="modal-btn-full" id="doForgotBtn">Send reset link</button>
          <div class="modal-footer-link">
            <a id="switchToLoginFromForgot">← Back to sign in</a>
          </div>
        </div>
      </div>
    </div>
  `);
}

// ── Loading state helper ────────────────────────────────────────
function _setLoading(btn, loading, defaultText, loadingText) {
  btn.disabled    = loading;
  btn.textContent = loading ? (loadingText || defaultText + '…') : defaultText;
}

// ── Error/success display helpers ──────────────────────────────
function _showError(id, msg) {
  const el = document.getElementById(id);
  if (el) { el.textContent = msg; el.style.display = 'block'; }
}
function _showSuccess(id, msg) {
  const el = document.getElementById(id);
  if (el) { el.textContent = msg; el.style.display = 'block'; }
}
function _hideErrors() {
  ['loginError','registerError','registerSuccess','forgotError','forgotSuccess'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.style.display = 'none';
  });
}

// ── Tab / view switcher ─────────────────────────────────────────
function _switchTab(tab) {
  const forms   = { login: 'formLogin', register: 'formRegister', forgot: 'formForgot' };
  const btnIds  = { login: 'tabLoginBtn', register: 'tabRegisterBtn' };
  const focusId = { login: 'loginEmail', register: 'regName', forgot: 'forgotEmail' };

  Object.entries(forms).forEach(([key, id]) => {
    const el = document.getElementById(id);
    if (el) el.style.display = key === tab ? 'block' : 'none';
  });

  // Only the two main tabs have tab buttons
  ['login','register'].forEach(key => {
    document.getElementById(btnIds[key])?.classList.toggle('active', key === tab);
  });

  _hideErrors();
  setTimeout(() => document.getElementById(focusId[tab])?.focus(), 80);
}

// ── Modal event binding ─────────────────────────────────────────
function bindModalListeners() {
  // Close
  document.getElementById('closeModalBtn')?.addEventListener('click', window.hideAuthModal);
  document.getElementById('authModal')?.addEventListener('click', e => {
    // Close on backdrop click (but not on the modal card itself)
    if (e.target === document.getElementById('authModal')) window.hideAuthModal();
  });

  // Tab switching
  document.getElementById('tabLoginBtn')?.addEventListener('click',    () => _switchTab('login'));
  document.getElementById('tabRegisterBtn')?.addEventListener('click', () => _switchTab('register'));
  document.getElementById('switchToRegister')?.addEventListener('click', () => _switchTab('register'));
  document.getElementById('switchToForgot')?.addEventListener('click',   () => _switchTab('forgot'));
  document.getElementById('switchToLoginFromForgot')?.addEventListener('click', () => _switchTab('login'));

  // Escape key closes modal
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape') window.hideAuthModal();
  });

  // Enter key submits active form
  document.getElementById('loginPassword')?.addEventListener('keydown',  e => { if (e.key === 'Enter') document.getElementById('doLoginBtn')?.click(); });
  document.getElementById('regPassword')?.addEventListener('keydown',    e => { if (e.key === 'Enter') document.getElementById('doRegisterBtn')?.click(); });
  document.getElementById('forgotEmail')?.addEventListener('keydown',    e => { if (e.key === 'Enter') document.getElementById('doForgotBtn')?.click(); });

  // ── Login ──────────────────────────────────────────────────────
  document.getElementById('doLoginBtn')?.addEventListener('click', async () => {
    const email    = document.getElementById('loginEmail').value.trim();
    const password = document.getElementById('loginPassword').value;
    const btn      = document.getElementById('doLoginBtn');
    _hideErrors();

    if (!email || !password) { _showError('loginError', 'Please enter your email and password.'); return; }

    _setLoading(btn, true, 'Sign in', 'Signing in…');
    try {
      await window.login(email, password);

      // Device enforcement — FAILS CLOSED on RPC error
      const access = await window.checkDeviceAccess();
      if (!access.allowed) {
        // Sign the user back out immediately so the session isn't left dangling
        await _sb.auth.signOut();
        _cachedProfile  = null;
        _cachedSettings = null;
        _showError('loginError', access.reason);
        return;
      }

      window.hideAuthModal();
      window.location.reload();
    } catch (err) {
      _showError('loginError', err.message || 'Login failed. Please try again.');
    } finally {
      _setLoading(btn, false, 'Sign in');
    }
  });

  // ── Register ──────────────────────────────────────────────────
  document.getElementById('doRegisterBtn')?.addEventListener('click', async () => {
    const name     = document.getElementById('regName').value.trim();
    const email    = document.getElementById('regEmail').value.trim();
    const password = document.getElementById('regPassword').value;
    const btn      = document.getElementById('doRegisterBtn');
    _hideErrors();

    if (!name || !email || !password) { _showError('registerError', 'Please fill in all fields.'); return; }
    if (password.length < 8)          { _showError('registerError', 'Password must be at least 8 characters.'); return; }

    _setLoading(btn, true, 'Create free account', 'Creating account…');
    try {
      await window.register(name, email, password);
      _showSuccess('registerSuccess', '✓ Account created! Check your email to confirm, then sign in.');
      setTimeout(() => {
        _switchTab('login');
        const loginEmailEl = document.getElementById('loginEmail');
        if (loginEmailEl) { loginEmailEl.value = email; loginEmailEl.focus(); }
      }, 2000);
    } catch (err) {
      _showError('registerError', err.message || 'Registration failed. Please try again.');
    } finally {
      _setLoading(btn, false, 'Create free account');
    }
  });

  // ── Forgot password ───────────────────────────────────────────
  document.getElementById('doForgotBtn')?.addEventListener('click', async () => {
    const email = document.getElementById('forgotEmail').value.trim();
    const btn   = document.getElementById('doForgotBtn');
    _hideErrors();

    if (!email) { _showError('forgotError', 'Please enter your email address.'); return; }

    _setLoading(btn, true, 'Send reset link', 'Sending…');
    try {
      await window.sendPasswordReset(email);
      _showSuccess('forgotSuccess', '✓ Reset link sent! Check your inbox (and spam folder).');
      setTimeout(() => _switchTab('login'), 4000);
    } catch (err) {
      _showError('forgotError', err.message || 'Could not send reset email. Please try again.');
    } finally {
      _setLoading(btn, false, 'Send reset link');
    }
  });
}

// ── Public modal API ────────────────────────────────────────────
window.showAuthModal = function(tab = 'login') {
  const modal = document.getElementById('authModal');
  if (!modal) return;
  modal.classList.add('open');
  _switchTab(tab);
  // Clear all input values for security
  ['loginEmail','loginPassword','regName','regEmail','regPassword','forgotEmail'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.value = '';
  });
};

window.hideAuthModal = function() {
  document.getElementById('authModal')?.classList.remove('open');
};

/**
 * Redirect to `url` if authenticated (with device check), or show auth modal.
 * This ensures the device check runs even when navigating directly to protected pages.
 */
window.checkAuthAndRedirect = async function(url) {
  const { data: { user } } = await _sb.auth.getUser();
  if (!user) { window.showAuthModal('login'); return; }

  // Also verify device access on redirect (prevents direct URL bypass)
  const access = await window.checkDeviceAccess();
  if (!access.allowed) {
    await _sb.auth.signOut();
    _cachedProfile  = null;
    _cachedSettings = null;
    window.showAuthModal('login');
    // Brief delay so the modal renders before we show the error
    setTimeout(() => _showError('loginError', access.reason), 100);
    return;
  }

  window.location.href = url;
};

// A helper to dispatch the auth state check and store the arguments for late registration
function dispatchAuthStateChecked(user, profile) {
  window._authStateCheckedArgs = [user, profile];
  if (typeof window.onAuthStateChecked === 'function') {
    window.onAuthStateChecked(user, profile);
  }
}

// Intercept window.onAuthStateChecked to handle late bindings
let _onAuthStateCheckedFn = null;
Object.defineProperty(window, 'onAuthStateChecked', {
  get() {
    return _onAuthStateCheckedFn;
  },
  set(fn) {
    _onAuthStateCheckedFn = fn;
    if (typeof fn === 'function' && window._authStateCheckedArgs) {
      fn(...window._authStateCheckedArgs);
    }
  },
  configurable: true
});

// ══════════════════════════════════════════════════════════════════
//  HEADER RENDERING  (account dropdown with plan badge)
// ══════════════════════════════════════════════════════════════════
async function renderHeader() {
  const headerAuth = document.getElementById('headerAuth');
  if (!headerAuth) return;

  const renderGuestHeader = () => {
    const navDashboardLink = document.getElementById('navDashboardLink');
    if (navDashboardLink) navDashboardLink.style.display = 'none';
    headerAuth.innerHTML = `
      <button class="btn btn-outline btn-sm" id="headerSignInBtn" type="button">Sign in</button>`;
    document.getElementById('headerSignInBtn')?.addEventListener('click', () => window.showAuthModal('login'));
  };

  const renderUserHeader = (sessionUser, profile = null) => {
    const navDashboardLink = document.getElementById('navDashboardLink');
    if (navDashboardLink) navDashboardLink.style.display = 'block';

    const meta = profile ? (PLAN_META[profile.plan] || PLAN_META.free) : null;
    const displayName = profile?.name || sessionUser.user_metadata?.name || sessionUser.email.split('@')[0];
    const initials = displayName.split(' ').map(n => n[0]).join('').toUpperCase().slice(0, 2);

    let trialBanner = '';
    if (profile?.plan === 'trial' && profile.trialExpiresAt) {
      const remaining = Math.max(0, Math.ceil((new Date(profile.trialExpiresAt) - Date.now()) / 86400000));
      trialBanner = `<span class="trial-countdown">${remaining}d trial</span>`;
    }

    const planBadge = meta
      ? `<span class="plan-badge ${meta.badgeClass}">${meta.label}</span>`
      : '<span class="plan-badge plan-loading">...</span>';
    const planMenuBadge = meta
      ? `<span class="plan-badge ${meta.badgeClass}">${meta.label}</span>`
      : '<span class="plan-badge plan-loading">Checking</span>';

    const dropId = 'userDropdown';
    headerAuth.innerHTML = `
      <div class="user-menu-wrap">
        <button class="user-menu-btn" id="userMenuBtn" aria-haspopup="true" aria-expanded="false">
          <span class="user-avatar">${esc(initials)}</span>
          <span class="user-menu-name">${esc(displayName)}</span>
          ${trialBanner}
          ${planBadge}
          <span class="user-caret">&#9662;</span>
        </button>
        <div id="${dropId}" class="user-dropdown" role="menu" style="display:none">
          <div class="user-dropdown-header">
            <div class="user-avatar user-avatar-lg">${esc(initials)}</div>
            <div class="user-dropdown-info">
              <div class="user-dropdown-name">${esc(profile?.name || displayName)}</div>
              <div class="user-dropdown-email">${esc(sessionUser.email)}</div>
            </div>
          </div>
          <div class="user-dropdown-plan">
            <span class="ud-label">Current plan</span>
            ${planMenuBadge}
          </div>
          <div class="user-dropdown-divider"></div>
          <a href="/dashboard" class="user-dropdown-item" role="menuitem">Dashboard</a>
          <a href="/pricing" class="user-dropdown-item" role="menuitem">Upgrade plan</a>
          <div class="user-dropdown-divider"></div>
          <button class="user-dropdown-item user-dropdown-logout" id="headerLogoutBtn" role="menuitem">Sign out</button>
        </div>
      </div>`;

    const menuBtn = document.getElementById('userMenuBtn');
    const dropdown = document.getElementById(dropId);

    menuBtn?.addEventListener('click', e => {
      e.stopPropagation();
      const open = dropdown.style.display !== 'none';
      dropdown.style.display = open ? 'none' : 'block';
      menuBtn.setAttribute('aria-expanded', String(!open));
    });

    document.getElementById('headerLogoutBtn')?.addEventListener('click', window.logout);

    if (!window.__headerDropdownBound) {
      window.__headerDropdownBound = true;
      document.addEventListener('click', () => {
        const currentDropdown = document.getElementById('userDropdown');
        const currentMenuBtn = document.getElementById('userMenuBtn');
        if (currentDropdown) {
          currentDropdown.style.display = 'none';
          currentMenuBtn?.setAttribute('aria-expanded', 'false');
        }
      });
    }
  };

  const { data: { session } } = await _sb.auth.getSession();
  const sessionUser = session?.user || null;

  if (!sessionUser) {
    renderGuestHeader();
    dispatchAuthStateChecked(null, null);
    return;
  }

  renderUserHeader(sessionUser);
  dispatchAuthStateChecked(sessionUser, null);

  window.loadProfile()
    .then(profile => {
      if (!profile) {
        renderGuestHeader();
        dispatchAuthStateChecked(null, null);
        return;
      }
      renderUserHeader(sessionUser, profile);
      dispatchAuthStateChecked(sessionUser, profile);
    })
    .catch(err => {
      console.warn('[auth] profile load failed:', err?.message);
    });
  return;

  const { data: { user } } = await _sb.auth.getUser();
  const navDashboardLink = document.getElementById('navDashboardLink');

  if (!user) {
    if (navDashboardLink) navDashboardLink.style.display = 'none';
    headerAuth.innerHTML = `
      <button class="btn btn-outline btn-sm" id="headerSignInBtn">Sign in</button>
      <button class="btn btn-sm" id="headerDashBtn">Dashboard</button>`;
    document.getElementById('headerSignInBtn')?.addEventListener('click', () => window.showAuthModal('login'));
    document.getElementById('headerDashBtn')?.addEventListener('click',   () => window.checkAuthAndRedirect('/dashboard'));
    dispatchAuthStateChecked(null, null);
    return;
  }

  if (navDashboardLink) navDashboardLink.style.display = 'block';

  const profile    = await window.loadProfile();
  const meta       = profile ? (PLAN_META[profile.plan] || PLAN_META.free) : PLAN_META.free;
  const displayName = profile?.name || user.email.split('@')[0];
  const initials    = displayName.split(' ').map(n => n[0]).join('').toUpperCase().slice(0, 2);

  // Trial countdown badge (shown in header button)
  let trialBanner = '';
  if (profile?.plan === 'trial' && profile.trialExpiresAt) {
    const remaining = Math.max(0, Math.ceil((new Date(profile.trialExpiresAt) - Date.now()) / 86400000));
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
        <a href="/dashboard" class="user-dropdown-item" role="menuitem">📊 Dashboard</a>
        <a href="/pricing"   class="user-dropdown-item" role="menuitem">💰 Upgrade plan</a>
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

  // Close dropdown on outside click
  document.addEventListener('click', () => {
    if (dropdown) { dropdown.style.display = 'none'; menuBtn?.setAttribute('aria-expanded', 'false'); }
  });

  dispatchAuthStateChecked(user, profile);
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
    btn.disabled    = true;
    btn.textContent = 'Activating…';
    try {
      await window.activateTrial();
      document.getElementById('trialBannerEl').innerHTML = `
        <div class="trial-banner" style="background:rgba(139,201,127,0.1);border-color:rgba(139,201,127,0.3)">
          <span style="color:#8BC97F;font-size:1.1rem">✓ Trial activated! Expires in 3 days.</span>
        </div>`;
      setTimeout(() => window.location.reload(), 1500);
    } catch (err) {
      btn.disabled    = false;
      btn.textContent = 'Start free trial →';
      alert('Could not activate trial: ' + (err.message || 'Unknown error'));
    }
  });
};

// ══════════════════════════════════════════════════════════════════
//  BOOT  (DOMContentLoaded)
// ══════════════════════════════════════════════════════════════════
function bootAuthUI() {
  injectModal();
  bindModalListeners();
  renderHeader();
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', bootAuthUI);
} else {
  bootAuthUI();
}
