const THEME_STORAGE_KEY = 'telegram_chat_theme';
const SESSION_USER_KEY = 'telegram_chat_username';
const LAST_USER_KEY = 'telegram_chat_last_username';
const MAX_USERNAME_LEN = 25;
const MIN_USERNAME_LEN = 2;

const loginForm = document.getElementById('loginForm');
const usernameInput = document.getElementById('usernameInput');
const usernameCharCount = document.getElementById('usernameCharCount');
const loginError = document.getElementById('loginError');
const themeToggleBtn = document.getElementById('themeToggleBtn');
const themeIcon = document.getElementById('themeIcon');
const themeLabel = document.getElementById('themeLabel');

function applyTheme(theme) {
  const validTheme = theme === 'dark' ? 'dark' : 'light';
  document.documentElement.setAttribute('data-theme', validTheme);
  localStorage.setItem(THEME_STORAGE_KEY, validTheme);

  if (validTheme === 'dark') {
    themeIcon.textContent = '☀️';
    themeLabel.textContent = 'Modo claro';
  } else {
    themeIcon.textContent = '🌙';
    themeLabel.textContent = 'Modo oscuro';
  }
}

function initTheme() {
  const savedTheme = localStorage.getItem(THEME_STORAGE_KEY) || 'light';
  applyTheme(savedTheme);
}

function updateCharCounter() {
  const length = usernameInput.value.length;
  usernameCharCount.textContent = `${length} / ${MAX_USERNAME_LEN}`;
  if (length > MAX_USERNAME_LEN) {
    usernameInput.classList.add('input-error');
  } else {
    usernameInput.classList.remove('input-error');
  }
}

themeToggleBtn.addEventListener('click', () => {
  const current = document.documentElement.getAttribute('data-theme');
  applyTheme(current === 'dark' ? 'light' : 'dark');
});

usernameInput.addEventListener('input', () => {
  loginError.textContent = '';
  updateCharCounter();
});

loginForm.addEventListener('submit', (event) => {
  event.preventDefault();
  const cleanName = usernameInput.value.trim();

  if (!cleanName) {
    loginError.textContent = 'Por favor, ingresa un nombre de usuario.';
    usernameInput.classList.add('input-error');
    usernameInput.focus();
    return;
  }

  if (cleanName.length < MIN_USERNAME_LEN) {
    loginError.textContent = `El nombre debe tener al menos ${MIN_USERNAME_LEN} caracteres.`;
    usernameInput.classList.add('input-error');
    usernameInput.focus();
    return;
  }

  if (cleanName.length > MAX_USERNAME_LEN) {
    loginError.textContent = `El nombre no puede superar los ${MAX_USERNAME_LEN} caracteres.`;
    usernameInput.classList.add('input-error');
    usernameInput.focus();
    return;
  }

  sessionStorage.setItem(SESSION_USER_KEY, cleanName);
  localStorage.setItem(LAST_USER_KEY, cleanName);
  window.location.href = 'index.html';
});

// Inicializar tema y restaurar último nombre sugerido si existe
initTheme();
const lastUsername = localStorage.getItem(LAST_USER_KEY);
if (lastUsername) {
  usernameInput.value = lastUsername;
  updateCharCounter();
}
usernameInput.focus();
