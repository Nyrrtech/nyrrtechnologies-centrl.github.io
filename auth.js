/**
 * auth.js — Master account + robust session
 */
const PLANS = {
  free: {
    label: 'Free', crawlLimit: 50,
    sources: ['world', 'tech', 'hackernews'],
    briefs: false, drafts: false, aiKeywords: false, export: false, allSources: false,
    badgeClass: 'plan-free',
  },
  pro: {
    label: 'Pro', crawlLimit: Infinity,
    sources: ['world','us','tech','science','business','reddit','hackernews','climate'],
    briefs: true, drafts: true, aiKeywords: true, export: true, allSources: true,
    badgeClass: 'plan-pro',
  },
  enterprise: {
    label: 'Enterprise', crawlLimit: Infinity,
    sources: ['world','us','tech','science','business','reddit','hackernews','climate'],
    briefs: true, drafts: true, aiKeywords: true, export: true, allSources: true, team: true,
    badgeClass: 'plan-enterprise',
  },
};

const STORAGE_USERS = 'nyrr_users';
const STORAGE_SESSION = 'nyrr_session';
const STORAGE_CRAWL_COUNT = 'nyrr_crawl_count';

// Master account
const MASTER_EMAIL = 'saad@kreators.pro';
const MASTER_PASSWORD = 'kreators';
const MASTER_PLAN = 'pro';

// ---- helpers ----
function getUsers() {
  try { return JSON.parse(localStorage.getItem(STORAGE_USERS) || '[]'); } catch(e) { return []; }
}
function saveUsers(users) { localStorage.setItem(STORAGE_USERS, JSON.stringify(users)); }

// Ensure master account exists (call immediately and on login)
function ensureMasterAccount() {
  const users = getUsers();
  const existing = users.find(u => u.email === MASTER_EMAIL);
  if (!existing) {
    users.push({
      id: 'master_' + Date.now(),
      name: 'Master Admin',
      email: MASTER_EMAIL,
      password: btoa(MASTER_PASSWORD),
      plan: MASTER_PLAN,
      createdAt: new Date().toISOString(),
      isMaster: true,
    });
    saveUsers(users);
    console.log('Master account created');
  } else if (existing.plan !== MASTER_PLAN) {
    existing.plan = MASTER_PLAN;
    saveUsers(users);
    console.log('Master account upgraded');
  }
}

// Run immediately so master is always in localStorage
ensureMasterAccount();

// ---- session ----
function getCurrentUser() {
  try {
    const raw = localStorage.getItem(STORAGE_SESSION);
    if (!raw) return null;
    const session = JSON.parse(raw);
    if (!session.userId) return null;
    if (Date.now() > Number(session.expires)) {
      localStorage.removeItem(STORAGE_SESSION);
      return null;
    }
    const users = getUsers();
    return users.find(u => u.id === session.userId) || null;
  } catch(e) { return null; }
}

function createSession(userId) {
  localStorage.setItem(STORAGE_SESSION, JSON.stringify({
    userId,
    expires: Date.now() + 7 * 24 * 60 * 60 * 1000,
  }));
}

function logout() {
  localStorage.removeItem(STORAGE_SESSION);
  if (typeof updateHeaderAuth === 'function') updateHeaderAuth();
  window.location.href = 'index.html';
}

// ---- login / register ----
function login(email, password) {
  ensureMasterAccount(); // double‑check master exists
  // Master login
  if (email.toLowerCase() === MASTER_EMAIL && password === MASTER_PASSWORD) {
    const users = getUsers();
    const master = users.find(u => u.email === MASTER_EMAIL);
    if (master) {
      createSession(master.id);
      return { ok: true, user: master };
    } else {
      return { ok: false, error: 'Master account error. Please refresh.' };
    }
  }
  // Normal login
  const users = getUsers();
  const user = users.find(u => u.email.toLowerCase() === email.toLowerCase());
  if (!user) return { ok: false, error: 'No account found with that email.' };
  if (atob(user.password) !== password) return { ok: false, error: 'Incorrect password.' };
  createSession(user.id);
  return { ok: true, user };
}

function register(name, email, password) {
  if (email.toLowerCase() === MASTER_EMAIL) {
    return { ok: false, error: 'This email is reserved. Please use a different email.' };
  }
  if (!name || !email || !password) return { ok: false, error: 'All fields required.' };
  if (password.length < 8) return { ok: false, error: 'Password must be 8+ characters.' };
  const users = getUsers();
  if (users.find(u => u.email.toLowerCase() === email.toLowerCase())) {
    return { ok: false, error: 'Email already exists.' };
  }
  const user = {
    id: 'u_' + Date.now() + '_' + Math.random().toString(36).slice(2, 8),
    name, email: email.toLowerCase(), password: btoa(password),
    plan: 'free', createdAt: new Date().toISOString(),
  };
  users.push(user);
  saveUsers(users);
  createSession(user.id);
  return { ok: true, user };
}

// ---- plan helpers ----
function getCurrentPlan() {
  const user = getCurrentUser();
  if (!user) return PLANS.free;
  return PLANS[user.plan] || PLANS.free;
}
function canUseBriefs()  { return getCurrentPlan().briefs; }
function canUseDrafts()  { return getCurrentPlan().drafts; }
function canUseExport()  { return getCurrentPlan().export; }
function canUseAllSources() { return getCurrentPlan().allSources; }
function getAllowedSources() { return getCurrentPlan().sources; }

// ---- crawl count (simplified) ----
function getCrawlCount() {
  try {
    const user = getCurrentUser();
    if (!user) return 0;
    const stored = JSON.parse(localStorage.getItem(STORAGE_CRAWL_COUNT) || '{}');
    const monthKey = new Date().toISOString().slice(0, 7);
    return stored[`${user.id}_${monthKey}`] || 0;
  } catch(e) { return 0; }
}
function incrementCrawlCount() {
  const user = getCurrentUser();
  if (!user) return;
  const stored = JSON.parse(localStorage.getItem(STORAGE_CRAWL_COUNT) || '{}');
  const monthKey = new Date().toISOString().slice(0, 7);
  const key = `${user.id}_${monthKey}`;
  stored[key] = (stored[key] || 0) + 1;
  localStorage.setItem(STORAGE_CRAWL_COUNT, JSON.stringify(stored));
}
function canCrawl() {
  const plan = getCurrentPlan();
  if (plan.crawlLimit === Infinity) return { ok: true };
  const used = getCrawlCount();
  if (used >= plan.crawlLimit) {
    return { ok: false, error: `Free limit of ${plan.crawlLimit} crawls used.`, upsell: true };
  }
  return { ok: true, remaining: plan.crawlLimit - used };
}

// ---- header update (used by index.html and dashboard) ----
function updateHeaderAuth() {
  const el = document.getElementById('headerAuth');
  if (!el) return;
  const user = getCurrentUser();
  if (user) {
    const plan = getCurrentPlan();
    el.innerHTML = `
      <span class="plan-badge ${plan.badgeClass}">${plan.label}</span>
      <span class="header-username">${escapeHtml(user.name || user.email)}</span>
      <a href="dashboard.html"><button class="btn btn-sm">Dashboard →</button></a>
      <button class="btn-ghost" onclick="logout()">Sign out</button>`;
  } else {
    el.innerHTML = `
      <button class="btn btn-outline btn-sm" onclick="openModal('login')">Sign in</button>
      <a href="pricing.html"><button class="btn btn-sm">Get started</button></a>`;
  }
}

// ---- modal functions (same as before) ----
function openModal(tab = 'login') {
  const backdrop = document.getElementById('authModal');
  if (!backdrop) return;
  backdrop.classList.add('open');
  switchModalTab(tab);
  document.body.style.overflow = 'hidden';
}
function closeModal() {
  const backdrop = document.getElementById('authModal');
  if (!backdrop) return;
  backdrop.classList.remove('open');
  document.body.style.overflow = '';
  clearModalErrors();
}
function switchModalTab(tab) {
  const loginTab = document.getElementById('tabLogin');
  const regTab = document.getElementById('tabRegister');
  if (loginTab) loginTab.classList.toggle('active', tab === 'login');
  if (regTab) regTab.classList.toggle('active', tab === 'register');
  const formLogin = document.getElementById('formLogin');
  const formReg = document.getElementById('formRegister');
  if (formLogin) formLogin.style.display = tab === 'login' ? 'block' : 'none';
  if (formReg) formReg.style.display = tab === 'register' ? 'block' : 'none';
  clearModalErrors();
}
function clearModalErrors() {
  ['loginError','registerError','registerSuccess'].forEach(id => {
    const el = document.getElementById(id);
    if (el) { el.style.display = 'none'; el.textContent = ''; }
  });
}
function showModalError(id, msg) {
  const el = document.getElementById(id);
  if (el) { el.textContent = msg; el.style.display = 'block'; }
}
function doLogin() {
  clearModalErrors();
  const email = document.getElementById('loginEmail')?.value.trim();
  const password = document.getElementById('loginPassword')?.value;
  if (!email || !password) { showModalError('loginError', 'Please fill all fields.'); return; }
  const res = login(email, password);
  if (!res.ok) { showModalError('loginError', res.error); return; }
  closeModal();
  updateHeaderAuth();
  window.location.href = 'dashboard.html';
}
function doRegister() {
  clearModalErrors();
  const name = document.getElementById('regName')?.value.trim();
  const email = document.getElementById('regEmail')?.value.trim();
  const password = document.getElementById('regPassword')?.value;
  const res = register(name, email, password);
  if (!res.ok) { showModalError('registerError', res.error); return; }
  showModalSuccess('registerSuccess', '✓ Account created! Redirecting…');
  updateHeaderAuth();
  setTimeout(() => { closeModal(); window.location.href = 'dashboard.html'; }, 1200);
}
function showModalSuccess(id, msg) {
  const el = document.getElementById(id);
  if (el) { el.textContent = msg; el.style.display = 'block'; }
}
function escapeHtml(s) {
  return String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

// Close modal on backdrop click / Escape
document.addEventListener('click', e => { if (e.target.id === 'authModal') closeModal(); });
document.addEventListener('keydown', e => { if (e.key === 'Escape') closeModal(); });

// Update header on every page load
document.addEventListener('DOMContentLoaded', updateHeaderAuth);

// Upsell banner (for dashboard)
function renderUpsellBanner(containerId, feature) {
  const messages = {
    crawl: { title: 'Monthly crawl limit reached', sub: 'Upgrade to Pro for unlimited crawls.' },
    briefs: { title: 'Briefs are a Pro feature', sub: 'Upgrade to unlock briefs.' },
    drafts: { title: 'Drafts are a Pro feature', sub: 'Upgrade to generate drafts.' },
  };
  const m = messages[feature] || messages.briefs;
  const el = document.getElementById(containerId);
  if (!el) return;
  el.innerHTML = `<div style="padding:28px;text-align:center;"><div>${m.title}</div><div>${m.sub}</div><a href="pricing.html"><button>Upgrade</button></a></div>`;
}