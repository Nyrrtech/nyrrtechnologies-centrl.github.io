/**
 * auth.js — Final working version with robust session handling
 */
const PLANS = {
  free: {
    label: 'Free',
    crawlLimit: 50,
    sources: ['world', 'tech', 'hackernews'],
    sentiment: true,
    briefs: false,
    drafts: false,
    aiKeywords: false,
    export: false,
    allSources: false,
    badgeClass: 'plan-free',
  },
  pro: {
    label: 'Pro',
    crawlLimit: Infinity,
    sources: ['world','us','tech','science','business','reddit','hackernews','climate'],
    sentiment: true,
    briefs: true,
    drafts: true,
    aiKeywords: true,
    export: true,
    allSources: true,
    badgeClass: 'plan-pro',
  },
  enterprise: {
    label: 'Enterprise',
    crawlLimit: Infinity,
    sources: ['world','us','tech','science','business','reddit','hackernews','climate'],
    sentiment: true,
    briefs: true,
    drafts: true,
    aiKeywords: true,
    export: true,
    allSources: true,
    team: true,
    badgeClass: 'plan-enterprise',
  },
};

const STORAGE_USERS = 'nyrr_users';
const STORAGE_SESSION = 'nyrr_session';
const STORAGE_CRAWL_COUNT = 'nyrr_crawl_count';

function getUsers() {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_USERS) || '[]');
  } catch (e) {
    console.error('getUsers error', e);
    return [];
  }
}

function saveUsers(users) {
  localStorage.setItem(STORAGE_USERS, JSON.stringify(users));
}

function getCurrentUser() {
  try {
    const raw = localStorage.getItem(STORAGE_SESSION);
    if (!raw) return null;
    const session = JSON.parse(raw);
    if (!session || !session.userId) return null;
    const expiry = Number(session.expires);
    if (isNaN(expiry) || Date.now() > expiry) {
      localStorage.removeItem(STORAGE_SESSION);
      return null;
    }
    const users = getUsers();
    const user = users.find(u => u.id === session.userId);
    if (!user) {
      localStorage.removeItem(STORAGE_SESSION);
      return null;
    }
    return user;
  } catch (e) {
    console.error('getCurrentUser error', e);
    return null;
  }
}

function createSession(userId) {
  const session = {
    userId,
    expires: Date.now() + 7 * 24 * 60 * 60 * 1000,
  };
  localStorage.setItem(STORAGE_SESSION, JSON.stringify(session));
  console.log('Session created for', userId);
}

function logout() {
  localStorage.removeItem(STORAGE_SESSION);
  // Force header update on current page if possible
  if (typeof updateHeaderAuth === 'function') updateHeaderAuth();
  window.location.href = 'index.html';
}

function register(name, email, password) {
  if (!name || !email || !password) return { ok: false, error: 'All fields are required.' };
  if (password.length < 8) return { ok: false, error: 'Password must be at least 8 characters.' };
  const users = getUsers();
  if (users.find(u => u.email.toLowerCase() === email.toLowerCase())) {
    return { ok: false, error: 'An account with this email already exists.' };
  }
  const user = {
    id: 'u_' + Date.now() + '_' + Math.random().toString(36).slice(2, 8),
    name,
    email: email.toLowerCase(),
    password: btoa(password),
    plan: 'free',
    createdAt: new Date().toISOString(),
  };
  users.push(user);
  saveUsers(users);
  createSession(user.id);
  return { ok: true, user };
}

function login(email, password) {
  const users = getUsers();
  const user = users.find(u => u.email.toLowerCase() === email.toLowerCase());
  if (!user) return { ok: false, error: 'No account found with that email.' };
  if (atob(user.password) !== password) return { ok: false, error: 'Incorrect password.' };
  createSession(user.id);
  return { ok: true, user };
}

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

function getCrawlCount() {
  try {
    const user = getCurrentUser();
    if (!user) return 0;
    const stored = JSON.parse(localStorage.getItem(STORAGE_CRAWL_COUNT) || '{}');
    const monthKey = new Date().toISOString().slice(0, 7);
    const key = `${user.id}_${monthKey}`;
    return stored[key] || 0;
  } catch { return 0; }
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
  const count = getCrawlCount();
  if (count >= plan.crawlLimit) {
    return { ok: false, error: `You've used all ${plan.crawlLimit} crawls this month.`, upsell: true };
  }
  return { ok: true, remaining: plan.crawlLimit - count };
}

function upgradePlan(targetPlan) {
  const user = getCurrentUser();
  if (!user) return null;
  const users = getUsers();
  const idx = users.findIndex(u => u.id === user.id);
  if (idx === -1) return null;
  users[idx].plan = targetPlan;
  saveUsers(users);
  if (typeof updateHeaderAuth === 'function') updateHeaderAuth();
  return users[idx];
}

// Global header update function (used by all pages)
function updateHeaderAuth() {
  const el = document.getElementById('headerAuth');
  if (!el) return;
  const user = getCurrentUser();
  if (user) {
    const plan = PLANS[user.plan] || PLANS.free;
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

// Modal logic (used by all pages)
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
  const tabLogin = document.getElementById('tabLogin');
  const tabRegister = document.getElementById('tabRegister');
  if (tabLogin) tabLogin.classList.toggle('active', tab === 'login');
  if (tabRegister) tabRegister.classList.toggle('active', tab === 'register');
  const formLogin = document.getElementById('formLogin');
  const formRegister = document.getElementById('formRegister');
  if (formLogin) formLogin.style.display = tab === 'login' ? 'block' : 'none';
  if (formRegister) formRegister.style.display = tab === 'register' ? 'block' : 'none';
  clearModalErrors();
}

function clearModalErrors() {
  ['loginError', 'registerError', 'registerSuccess'].forEach(id => {
    const el = document.getElementById(id);
    if (el) { el.style.display = 'none'; el.textContent = ''; }
  });
}

function showModalError(id, msg) {
  const el = document.getElementById(id);
  if (el) { el.textContent = msg; el.style.display = 'block'; }
}

function showModalSuccess(id, msg) {
  const el = document.getElementById(id);
  if (el) { el.textContent = msg; el.style.display = 'block'; }
}

function doLogin() {
  clearModalErrors();
  const email = document.getElementById('loginEmail')?.value.trim();
  const password = document.getElementById('loginPassword')?.value;
  if (!email || !password) {
    showModalError('loginError', 'Please fill in all fields.');
    return;
  }
  const result = login(email, password);
  if (!result.ok) {
    showModalError('loginError', result.error);
    return;
  }
  closeModal();
  updateHeaderAuth();
  window.location.href = 'dashboard.html';
}

function doRegister() {
  clearModalErrors();
  const name = document.getElementById('regName')?.value.trim();
  const email = document.getElementById('regEmail')?.value.trim();
  const password = document.getElementById('regPassword')?.value;
  const result = register(name, email, password);
  if (!result.ok) {
    showModalError('registerError', result.error);
    return;
  }
  showModalSuccess('registerSuccess', '✓ Account created! Redirecting to dashboard…');
  updateHeaderAuth();
  setTimeout(() => {
    closeModal();
    window.location.href = 'dashboard.html';
  }, 1200);
}

function escapeHtml(s) {
  return String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

// Global click to close modal
document.addEventListener('click', e => {
  if (e.target.id === 'authModal') closeModal();
});
document.addEventListener('keydown', e => {
  if (e.key === 'Escape') closeModal();
});

// Auto-initialize header on every page
document.addEventListener('DOMContentLoaded', updateHeaderAuth);

function renderUpsellBanner(containerId, feature) {
  const messages = {
    crawl:   { title: 'Monthly crawl limit reached', sub: 'Upgrade to Pro for unlimited crawls.' },
    briefs:  { title: 'Briefs are a Pro feature',    sub: 'Upgrade to unlock one-click article briefs.' },
    drafts:  { title: 'Drafts are a Pro feature',    sub: 'Upgrade to generate full AP-style articles.' },
    sources: { title: 'Unlock all 8 source categories', sub: 'Free plan includes 3. Upgrade for full access.' },
    keywords:{ title: 'AI keyword enrichment is Pro', sub: 'Upgrade for clusters, gaps, and AI-powered insights.' },
    export:  { title: 'Export is a Pro feature',     sub: 'Upgrade to export as Markdown or JSON.' },
  };
  const m = messages[feature] || messages.briefs;
  const el = document.getElementById(containerId);
  if (!el) return;
  el.innerHTML = `
    <div style="background:#16110a;border:1px solid rgba(245,176,66,0.25);border-radius:16px;padding:28px;text-align:center;max-width:480px;margin:40px auto;">
      <div style="font-size:2rem;margin-bottom:12px;">⚡</div>
      <div style="font-size:1rem;font-weight:700;margin-bottom:8px;">${m.title}</div>
      <div style="color:#b0b8c5;font-size:0.88rem;margin-bottom:20px;">${m.sub}</div>
      <a href="pricing.html"><button style="background:#f5b042;color:#0a0c10;padding:10px 28px;border-radius:40px;font-weight:700;border:none;cursor:pointer;font-size:14px;">View Pro Plan →</button></a>
      ${getCurrentPlan().label === 'Free'
        ? `<div style="margin-top:12px;font-size:11px;color:#6c727f;">Or <a href="contact.html" style="color:#f5b042;">contact us</a> for Enterprise pricing.</div>`
        : ''}
    </div>`;
}