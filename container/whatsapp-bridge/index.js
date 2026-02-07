/**
 * Thin WhatsApp bridge — Baileys + JSON-over-stdio.
 *
 * Reads JSON commands from stdin (one per line).
 * Writes JSON events to stdout (one per line).
 * Supervised by Elixir Port.
 */

import { makeWASocket, useMultiFileAuthState, makeCacheableSignalKeyStore, DisconnectReason } from '@whiskeysockets/baileys';
import { createInterface } from 'readline';
import pino from 'pino';

const AUTH_DIR = process.env.WHATSAPP_AUTH_DIR || 'store/auth';
const LOG_LEVEL = process.env.LOG_LEVEL || 'warn';

const logger = pino({ level: LOG_LEVEL });

function emit(event) {
  process.stdout.write(JSON.stringify(event) + '\n');
}

let sock;

async function connect() {
  const { state, saveCreds } = await useMultiFileAuthState(AUTH_DIR);

  sock = makeWASocket({
    auth: {
      creds: state.creds,
      keys: makeCacheableSignalKeyStore(state.keys, logger),
    },
    printQRInTerminal: false,
    logger,
    browser: ['Guardian Core', 'Chrome', '1.0.0'],
  });

  sock.ev.on('connection.update', (update) => {
    const { connection, lastDisconnect, qr } = update;

    if (qr) {
      emit({ type: 'connection', status: 'qr', qr });
      return;
    }

    if (connection === 'close') {
      const reason = lastDisconnect?.error?.output?.statusCode;
      emit({ type: 'connection', status: 'close', reason: reason || 0 });

      if (reason !== DisconnectReason.loggedOut) {
        // Reconnect after delay — Elixir supervisor handles permanent failures
        setTimeout(connect, 3000);
      } else {
        emit({ type: 'connection', status: 'logged_out' });
        process.exit(0);
      }
    } else if (connection === 'open') {
      emit({ type: 'connection', status: 'open' });

      // Send LID → phone mapping for self-chat translation
      if (sock.user) {
        const phoneUser = sock.user.id.split(':')[0];
        const lidUser = sock.user.lid?.split(':')[0];
        if (lidUser && phoneUser) {
          emit({
            type: 'contacts_update',
            lid: lidUser,
            phone: `${phoneUser}@s.whatsapp.net`,
          });
        }
      }
    } else if (connection === 'connecting') {
      emit({ type: 'connection', status: 'connecting' });
    }
  });

  sock.ev.on('creds.update', () => {
    saveCreds();
    emit({ type: 'creds_update' });
  });

  sock.ev.on('messages.upsert', ({ messages }) => {
    for (const msg of messages) {
      if (!msg.message) continue;
      const jid = msg.key.remoteJid;
      if (!jid || jid === 'status@broadcast') continue;

      emit({
        type: 'message',
        key: msg.key,
        message: msg.message,
        messageTimestamp: msg.messageTimestamp,
        pushName: msg.pushName || null,
      });
    }
  });
}

// Read commands from stdin (one JSON per line)
const rl = createInterface({ input: process.stdin });
rl.on('line', async (line) => {
  try {
    const cmd = JSON.parse(line);

    switch (cmd.type) {
      case 'send_message':
        if (sock && cmd.jid && cmd.text) {
          await sock.sendMessage(cmd.jid, { text: cmd.text });
        }
        break;

      case 'send_presence':
        if (sock && cmd.jid && cmd.presence) {
          await sock.sendPresenceUpdate(cmd.presence, cmd.jid);
        }
        break;

      case 'fetch_groups':
        if (sock) {
          const groups = await sock.groupFetchAllParticipating();
          const simplified = {};
          for (const [gid, meta] of Object.entries(groups)) {
            simplified[gid] = { subject: meta.subject };
          }
          emit({ type: 'groups', groups: simplified });
        }
        break;

      default:
        logger.warn({ cmd: cmd.type }, 'Unknown command');
    }
  } catch (err) {
    logger.error({ err: err.message }, 'Error processing stdin command');
  }
});

rl.on('close', () => {
  // stdin closed — Elixir Port closed us, exit gracefully
  process.exit(0);
});

connect().catch((err) => {
  logger.error({ err: err.message }, 'Fatal: failed to connect');
  emit({ type: 'connection', status: 'error', reason: err.message });
  process.exit(1);
});
