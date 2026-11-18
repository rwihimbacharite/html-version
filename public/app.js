const API_BASE_URL = (() => {
  const isLocalHost = ['localhost', '127.0.0.1'].includes(window.location.hostname);
  if (window.location.protocol === 'file:') return 'http://localhost:3000';
  if (isLocalHost && window.location.port !== '3000') return `${window.location.protocol}//${window.location.hostname}:3000`;
  return '';
})();

function apiFetch(path, options) {
  return fetch(`${API_BASE_URL}${path}`, options);
}

async function fetchData() {
  const res = await apiFetch('/api/data');
  return res.json();
}

function showMessage(text, type = 'success') {
  const el = document.getElementById('message');
  if (!el) return;
  el.textContent = text;
  el.className = `message ${type}`;
  el.style.display = 'block';
  setTimeout(() => { el.style.display = 'none'; }, 4000);
}

function getUser() {
  try { return JSON.parse(sessionStorage.getItem('user')); } catch { return null; }
}

function setUser(user) {
  sessionStorage.setItem('user', JSON.stringify(user));
}

function clearUser() {
  sessionStorage.removeItem('user');
}

function updateNavAuth() {
  const user = getUser();
  const loginLink = document.getElementById('nav-login');
  const registerLink = document.getElementById('nav-register');
  const userSpan = document.getElementById('nav-user-name');
  const logoutBtn = document.getElementById('nav-logout');
  if (user) {
    if (loginLink) loginLink.style.display = 'none';
    if (registerLink) registerLink.style.display = 'none';
    if (userSpan) { userSpan.textContent = `Hi, ${user.name}`; userSpan.style.display = 'inline'; }
    if (logoutBtn) logoutBtn.style.display = 'inline-block';
  } else {
    if (loginLink) loginLink.style.display = 'inline';
    if (registerLink) registerLink.style.display = 'inline';
    if (userSpan) userSpan.style.display = 'none';
    if (logoutBtn) logoutBtn.style.display = 'none';
  }
}
