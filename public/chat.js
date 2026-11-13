const THEME_STORAGE_KEY = 'telegram_chat_theme';
const SESSION_USER_KEY = 'telegram_chat_username';
const MAX_MESSAGE_LENGTH = 500;
const TYPING_TIMEOUT_MS = 1800;
const RECONNECT_DELAY_MS = 3000;

// Verificar que el usuario haya pasado por la pantalla previa (login.html)
const currentUsername = (sessionStorage.getItem(SESSION_USER_KEY) || '').trim();
if (!currentUsername) {
  window.location.replace('login.html');
}

// Referencias al DOM
const messagesArea = document.getElementById('messagesArea');
const messageForm = document.getElementById('messageForm');
const messageInput = document.getElementById('messageInput');
const charCounter = document.getElementById('charCounter');
const sendBtn = document.getElementById('sendBtn');
const statusBadge = document.getElementById('statusBadge');
const statusText = document.getElementById('statusText');
const userCountText = document.getElementById('userCountText');
const currentUserBadge = document.getElementById('currentUserBadge');
const themeToggleBtn = document.getElementById('themeToggleBtn');
const themeIcon = document.getElementById('themeIcon');
const themeLabel = document.getElementById('themeLabel');
const logoutBtn = document.getElementById('logoutBtn');
const typingIndicator = document.getElementById('typingIndicator');
const typingText = document.getElementById('typingText');
const feedbackBanner = document.getElementById('feedbackBanner');
const feedbackText = document.getElementById('feedbackText');

// Estado de la aplicación
let ws = null;
let myClientId = null;
let isConnected = false;
let hasConnectedOnce = false;
let manualClose = false;
let reconnectTimer = null;
let localTypingTimeout = null;
let isCurrentlyTyping = false;
let feedbackTimer = null;

// Mapa de usuarios escribiendo: Map<key, { username, timeoutId }>
const typingUsers = new Map();

// Colores estilo Telegram para distinguir nombres de usuarios recibidos
const USER_COLORS = [
  '#e17076',
  '#7bc862',
  '#e5ca77',
  '#65aadd',
  '#a695e7',
  '#ee7aae',
  '#6ec9cb',
  '#faa774'
];

function getUserColor(name) {
  let hash = 0;
  for (let i = 0; i < name.length; i++) {
    hash = name.charCodeAt(i) + ((hash << 5) - hash);
  }
  const index = Math.abs(hash) % USER_COLORS.length;
  return USER_COLORS[index];
}

// ============================================================================
// Gestión del Tema Claro / Oscuro con persistencia en localStorage
// ============================================================================
function applyTheme(theme) {
  const validTheme = theme === 'dark' ? 'dark' : 'light';
  document.documentElement.setAttribute('data-theme', validTheme);
  localStorage.setItem(THEME_STORAGE_KEY, validTheme);

  if (validTheme === 'dark') {
    themeIcon.textContent = '☀️';
    themeLabel.textContent = 'Claro';
  } else {
    themeIcon.textContent = '🌙';
    themeLabel.textContent = 'Oscuro';
  }
}

function initTheme() {
  const savedTheme = localStorage.getItem(THEME_STORAGE_KEY) || 'light';
  applyTheme(savedTheme);
}

themeToggleBtn.addEventListener('click', () => {
  const current = document.documentElement.getAttribute('data-theme');
  applyTheme(current === 'dark' ? 'light' : 'dark');
});

// ============================================================================
// Indicadores de Estado, Contador de Usuarios y Alertas
// ============================================================================
function setConnectionStatus(state) {
  statusBadge.classList.remove('connected', 'reconnecting', 'disconnected');

  if (state === 'connected') {
    statusBadge.classList.add('connected');
    statusText.textContent = 'Conectado';
    sendBtn.disabled = false;
  } else if (state === 'reconnecting') {
    statusBadge.classList.add('reconnecting');
    statusText.textContent = 'Reconectando...';
    sendBtn.disabled = true;
  } else {
    statusBadge.classList.add('disconnected');
    statusText.textContent = 'Desconectado';
    sendBtn.disabled = true;
  }
}

function updateUserCounter(count) {
  const total = typeof count === 'number' && count >= 0 ? count : 0;
  userCountText.textContent = total === 1 ? '1 en línea' : `${total} en línea`;
}

function showFeedback(message) {
  if (feedbackTimer) clearTimeout(feedbackTimer);
  feedbackText.textContent = message;
  feedbackBanner.classList.add('visible');

  feedbackTimer = setTimeout(() => {
    feedbackBanner.classList.remove('visible');
  }, 4000);
}

function clearFeedback() {
  if (feedbackTimer) clearTimeout(feedbackTimer);
  feedbackBanner.classList.remove('visible');
}

// ============================================================================
// Renderizado de Mensajes y Avisos del Sistema
// ============================================================================
function scrollToBottom() {
  messagesArea.scrollTop = messagesArea.scrollHeight;
}

function addSystemMessage(text, timestamp) {
  const row = document.createElement('div');
  row.className = 'message-row system';

  const pill = document.createElement('div');
  pill.className = 'system-pill';
  pill.textContent = timestamp ? `${text} • ${timestamp}` : text;

  row.appendChild(pill);
  messagesArea.appendChild(row);
  scrollToBottom();
}

function addChatMessage({ clientId, username, text, timestamp }) {
  const isOwnMessage =
    (myClientId && clientId && clientId === myClientId) ||
    (!clientId && username === currentUsername);

  const row = document.createElement('div');
  row.className = `message-row ${isOwnMessage ? 'sent' : 'received'}`;

  const bubble = document.createElement('div');
  bubble.className = 'message-bubble';

  // Si es un mensaje recibido, mostrar el nombre del remitente arriba
  if (!isOwnMessage) {
    const senderEl = document.createElement('span');
    senderEl.className = 'message-sender';
    senderEl.textContent = username || 'Usuario';
    senderEl.style.color = getUserColor(username || 'Usuario');
    bubble.appendChild(senderEl);
  }

  const contentEl = document.createElement('div');
  contentEl.className = 'message-content';
  contentEl.textContent = text;
  bubble.appendChild(contentEl);

  const metaEl = document.createElement('div');
  metaEl.className = 'message-meta';

  const timeEl = document.createElement('span');
  timeEl.className = 'message-time';
  timeEl.textContent =
    timestamp ||
    new Date().toLocaleTimeString('es-EC', {
      hour: '2-digit',
      minute: '2-digit'
    });
  metaEl.appendChild(timeEl);

  if (isOwnMessage) {
    const checksEl = document.createElement('span');
    checksEl.className = 'message-checks';
    checksEl.setAttribute('aria-label', 'Enviado');
    checksEl.textContent = '✓✓';
    metaEl.appendChild(checksEl);
  }

  bubble.appendChild(metaEl);
  row.appendChild(bubble);
  messagesArea.appendChild(row);
  scrollToBottom();
}

// ============================================================================
// Gestión del Indicador "Escribiendo..."
// ============================================================================
function renderTypingIndicator() {
  const names = Array.from(typingUsers.values()).map((entry) => entry.username);

  if (names.length === 0) {
    typingIndicator.classList.remove('active');
    typingText.textContent = '';
    return;
  }

  let label = '';
  if (names.length === 1) {
    label = `${names[0]} está escribiendo...`;
  } else if (names.length === 2) {
    label = `${names[0]} y ${names[1]} están escribiendo...`;
  } else {
    label = `${names.slice(0, 2).join(', ')} y ${names.length - 2} más están escribiendo...`;
  }

  typingText.textContent = label;
  typingIndicator.classList.add('active');
}

function handleRemoteTyping({ clientId, username, isTyping }) {
  if (!username) return;
  if (myClientId && clientId === myClientId) return;

  const key = clientId || username;
  const existing = typingUsers.get(key);
  if (existing && existing.timeoutId) {
    clearTimeout(existing.timeoutId);
  }

  if (isTyping) {
    const timeoutId = setTimeout(() => {
      typingUsers.delete(key);
      renderTypingIndicator();
    }, 3000);

    typingUsers.set(key, { username, timeoutId });
  } else {
    typingUsers.delete(key);
  }

  renderTypingIndicator();
}

function sendTypingStatus(isTyping) {
  if (!isConnected || !ws || ws.readyState !== WebSocket.OPEN) return;

  ws.send(
    JSON.stringify({
      type: 'typing',
      username: currentUsername,
      isTyping: Boolean(isTyping),
      timestamp: new Date().toLocaleTimeString('es-EC', {
        hour: '2-digit',
        minute: '2-digit'
      })
    })
  );
}

// ============================================================================
// Conexión y Eventos WebSocket
// ============================================================================
function connectWebSocket() {
  if (reconnectTimer) {
    clearTimeout(reconnectTimer);
    reconnectTimer = null;
  }

  if (hasConnectedOnce) {
    setConnectionStatus('reconnecting');
  }

  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  ws = new WebSocket(`${protocol}//${window.location.host}`);

  ws.onopen = () => {
    isConnected = true;
    hasConnectedOnce = true;
    setConnectionStatus('connected');
    clearFeedback();

    // Anunciar ingreso del usuario en formato JSON
    ws.send(
      JSON.stringify({
        type: 'join',
        username: currentUsername,
        timestamp: new Date().toLocaleTimeString('es-EC', {
          hour: '2-digit',
          minute: '2-digit'
        })
      })
    );
  };

  ws.onmessage = (event) => {
    try {
      const data = JSON.parse(event.data);

      switch (data.type) {
        case 'welcome':
          myClientId = data.clientId;
          if (typeof data.userCount === 'number') {
            updateUserCounter(data.userCount);
          }
          break;

        case 'system':
          if (typeof data.userCount === 'number') {
            updateUserCounter(data.userCount);
          }
          if (data.text) {
            addSystemMessage(data.text, data.timestamp);
          }
          break;

        case 'users_update':
          if (typeof data.userCount === 'number') {
            updateUserCounter(data.userCount);
          }
          break;

        case 'typing':
          handleRemoteTyping(data);
          break;

        case 'error':
          showFeedback(data.text || 'Error al procesar el mensaje.');
          break;

        case 'chat':
        default:
          // Al recibir mensaje de un usuario, ocultar su estado de "escribiendo..."
          if (data.clientId || data.username) {
            handleRemoteTyping({
              clientId: data.clientId,
              username: data.username,
              isTyping: false
            });
          }
          addChatMessage(data);
          break;
      }
    } catch (err) {
      console.error('Error al parsear mensaje JSON:', err);
    }
  };

  ws.onclose = () => {
    isConnected = false;
    typingUsers.clear();
    renderTypingIndicator();

    if (manualClose) {
      setConnectionStatus('disconnected');
      return;
    }

    setConnectionStatus('reconnecting');
    reconnectTimer = setTimeout(() => {
      connectWebSocket();
    }, RECONNECT_DELAY_MS);
  };

  ws.onerror = (error) => {
    console.error('Error en WebSocket:', error);
  };
}

// ============================================================================
// Validación y Envío de Mensajes
// ============================================================================
function updateComposerCounter() {
  const length = messageInput.value.length;
  charCounter.textContent = `${length} / ${MAX_MESSAGE_LENGTH}`;

  charCounter.classList.remove('warning', 'danger');
  messageInput.classList.remove('limit-exceeded');

  if (length > MAX_MESSAGE_LENGTH) {
    charCounter.classList.add('danger');
    messageInput.classList.add('limit-exceeded');
  } else if (length >= MAX_MESSAGE_LENGTH * 0.85) {
    charCounter.classList.add('warning');
  }
}

function sendMessage(event) {
  if (event) event.preventDefault();

  const rawValue = messageInput.value;
  const trimmedText = rawValue.trim();

  // Rechazar mensajes vacíos
  if (!trimmedText) {
    showFeedback('No puedes enviar un mensaje vacío.');
    messageInput.focus();
    return;
  }

  // Rechazar mensajes demasiado largos
  if (trimmedText.length > MAX_MESSAGE_LENGTH) {
    showFeedback(
      `El mensaje es demasiado largo (${trimmedText.length} caracteres). El máximo permitido es ${MAX_MESSAGE_LENGTH}.`
    );
    messageInput.focus();
    return;
  }

  if (!isConnected || !ws || ws.readyState !== WebSocket.OPEN) {
    showFeedback('No hay conexión activa con el servidor. Esperando reconexión...');
    return;
  }

  const nowFormatted = new Date().toLocaleTimeString('es-EC', {
    hour: '2-digit',
    minute: '2-digit'
  });

  // Enviar mensaje en formato JSON incluyendo usuario, texto y hora
  ws.send(
    JSON.stringify({
      type: 'chat',
      username: currentUsername,
      text: trimmedText,
      timestamp: nowFormatted
    })
  );

  // Limpiar estado de escritura
  if (localTypingTimeout) {
    clearTimeout(localTypingTimeout);
    localTypingTimeout = null;
  }
  isCurrentlyTyping = false;
  sendTypingStatus(false);

  // Limpiar campo de entrada
  messageInput.value = '';
  updateComposerCounter();
  clearFeedback();
  messageInput.focus();
}

messageForm.addEventListener('submit', sendMessage);

messageInput.addEventListener('input', () => {
  updateComposerCounter();

  const hasContent = messageInput.value.trim().length > 0;
  if (hasContent) {
    if (!isCurrentlyTyping) {
      isCurrentlyTyping = true;
      sendTypingStatus(true);
    }

    if (localTypingTimeout) clearTimeout(localTypingTimeout);
    localTypingTimeout = setTimeout(() => {
      isCurrentlyTyping = false;
      sendTypingStatus(false);
    }, TYPING_TIMEOUT_MS);
  } else {
    if (localTypingTimeout) clearTimeout(localTypingTimeout);
    if (isCurrentlyTyping) {
      isCurrentlyTyping = false;
      sendTypingStatus(false);
    }
  }
});

// Botón para salir y volver a la pantalla de selección de usuario (login.html)
logoutBtn.addEventListener('click', () => {
  manualClose = true;
  if (ws && ws.readyState === WebSocket.OPEN) {
    ws.close();
  }
  sessionStorage.removeItem(SESSION_USER_KEY);
  window.location.href = 'login.html';
});

// ============================================================================
// Inicialización
// ============================================================================
if (currentUsername) {
  initTheme();
  currentUserBadge.textContent = `@${currentUsername}`;
  updateComposerCounter();
  connectWebSocket();
  messageInput.focus();
}
