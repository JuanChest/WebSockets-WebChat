const express = require('express');
const WebSocket = require('ws');
const path = require('path');
const crypto = require('crypto');

const app = express();
const port = process.env.PORT || 3000;

const MAX_MESSAGE_LENGTH = 500;
const MAX_USERNAME_LENGTH = 25;

// Servir archivos estáticos desde la carpeta public
app.use(express.static(path.join(__dirname, 'public')));

// Crear servidor HTTP
const server = app.listen(port, () => {
  console.log(`🚀 Servidor corriendo en http://localhost:${port}`);
});

// Crear servidor WebSocket
const wss = new WebSocket.Server({ server });

// Almacenar conexiones activas: Map<WebSocket, { id, username }>
const clients = new Map();

function getFormattedTime() {
  return new Date().toLocaleTimeString('es-EC', {
    hour: '2-digit',
    minute: '2-digit'
  });
}

function getActiveUsers() {
  const users = [];
  clients.forEach((info) => {
    if (info.username) {
      users.push({ id: info.id, username: info.username });
    }
  });
  return users;
}

function broadcast(payload, excludeWs = null) {
  const data = JSON.stringify(payload);
  clients.forEach((_, client) => {
    if (client !== excludeWs && client.readyState === WebSocket.OPEN) {
      client.send(data);
    }
  });
}

function sendJson(ws, payload) {
  if (ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify(payload));
  }
}

wss.on('connection', (ws) => {
  const clientId = crypto.randomUUID();
  clients.set(ws, { id: clientId, username: null });

  // Enviar confirmación de conexión con el ID asignado al cliente
  sendJson(ws, {
    type: 'welcome',
    clientId,
    userCount: getActiveUsers().length,
    users: getActiveUsers(),
    maxMessageLength: MAX_MESSAGE_LENGTH,
    timestamp: getFormattedTime()
  });

  ws.on('message', (rawData) => {
    try {
      const data = JSON.parse(rawData);
      const clientInfo = clients.get(ws);
      if (!clientInfo) return;

      const msgType = data.type || 'chat';

      // Evento de unión al chat
      if (msgType === 'join') {
        const cleanUsername = typeof data.username === 'string' ? data.username.trim() : '';

        if (!cleanUsername) {
          sendJson(ws, {
            type: 'error',
            text: 'El nombre de usuario no puede estar vacío.',
            timestamp: getFormattedTime()
          });
          return;
        }

        if (cleanUsername.length > MAX_USERNAME_LENGTH) {
          sendJson(ws, {
            type: 'error',
            text: `El nombre de usuario no puede superar los ${MAX_USERNAME_LENGTH} caracteres.`,
            timestamp: getFormattedTime()
          });
          return;
        }

        const hadJoinedBefore = Boolean(clientInfo.username);
        clientInfo.username = cleanUsername;
        clients.set(ws, clientInfo);

        const activeUsers = getActiveUsers();
        console.log(`Usuario "${cleanUsername}" conectado. Total activos: ${activeUsers.length}`);

        if (!hadJoinedBefore) {
          broadcast({
            type: 'system',
            event: 'join',
            clientId: clientInfo.id,
            username: cleanUsername,
            text: `${cleanUsername} se unió al chat`,
            userCount: activeUsers.length,
            users: activeUsers,
            timestamp: getFormattedTime()
          });
        } else {
          broadcast({
            type: 'users_update',
            userCount: activeUsers.length,
            users: activeUsers,
            timestamp: getFormattedTime()
          });
        }
        return;
      }

      // Evento de indicador "escribiendo..."
      if (msgType === 'typing') {
        const username = clientInfo.username || (typeof data.username === 'string' ? data.username.trim() : '');
        if (!username) return;

        broadcast(
          {
            type: 'typing',
            clientId: clientInfo.id,
            username,
            isTyping: Boolean(data.isTyping),
            timestamp: getFormattedTime()
          },
          ws
        );
        return;
      }

      // Mensaje de chat estándar
      if (msgType === 'chat') {
        const username = clientInfo.username || (typeof data.username === 'string' ? data.username.trim() : '');
        const rawText = typeof data.text === 'string' ? data.text.trim() : '';

        if (!username) {
          sendJson(ws, {
            type: 'error',
            text: 'Debes ingresar un nombre de usuario antes de enviar mensajes.',
            timestamp: getFormattedTime()
          });
          return;
        }

        // Rechazar mensajes vacíos
        if (!rawText) {
          sendJson(ws, {
            type: 'error',
            text: 'No se permiten mensajes vacíos.',
            timestamp: getFormattedTime()
          });
          return;
        }

        // Rechazar mensajes demasiado largos
        if (rawText.length > MAX_MESSAGE_LENGTH) {
          sendJson(ws, {
            type: 'error',
            text: `El mensaje supera el límite máximo permitido de ${MAX_MESSAGE_LENGTH} caracteres (enviado: ${rawText.length}).`,
            timestamp: getFormattedTime()
          });
          return;
        }

        // Si el cliente aún no tenía su nombre registrado en la sesión, registrarlo
        if (!clientInfo.username) {
          clientInfo.username = username.slice(0, MAX_USERNAME_LENGTH);
          clients.set(ws, clientInfo);
        }

        // Reenviar mensaje en formato JSON a todos los clientes conectados
        broadcast({
          type: 'chat',
          clientId: clientInfo.id,
          username: clientInfo.username,
          text: rawText,
          timestamp: getFormattedTime(),
          isoTimestamp: new Date().toISOString()
        });
      }
    } catch (error) {
      console.error('Error procesando mensaje:', error);
      sendJson(ws, {
        type: 'error',
        text: 'Formato de mensaje inválido (se requiere JSON válido).',
        timestamp: getFormattedTime()
      });
    }
  });

  ws.on('close', () => {
    const clientInfo = clients.get(ws);
    clients.delete(ws);

    const activeUsers = getActiveUsers();
    if (clientInfo && clientInfo.username) {
      console.log(`Usuario "${clientInfo.username}" desconectado. Total activos: ${activeUsers.length}`);
      // Limpiar estado de escritura y notificar salida
      broadcast({
        type: 'typing',
        clientId: clientInfo.id,
        username: clientInfo.username,
        isTyping: false,
        timestamp: getFormattedTime()
      });
      broadcast({
        type: 'system',
        event: 'leave',
        clientId: clientInfo.id,
        username: clientInfo.username,
        text: `${clientInfo.username} salió del chat`,
        userCount: activeUsers.length,
        users: activeUsers,
        timestamp: getFormattedTime()
      });
    } else {
      console.log('Cliente sin identificar desconectado. Total activos:', activeUsers.length);
    }
  });

  ws.on('error', (error) => {
    console.error('Error WebSocket:', error);
    clients.delete(ws);
  });
});
