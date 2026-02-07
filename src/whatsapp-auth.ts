/**
 * WhatsApp Authentication Script
 *
 * Run this during setup to authenticate with WhatsApp.
 * Displays QR code, waits for scan, saves credentials, then exits.
 *
 * Usage: bun src/whatsapp-auth.ts
 */

import fs from 'node:fs';
import makeWASocket, {
	DisconnectReason,
	makeCacheableSignalKeyStore,
	useMultiFileAuthState,
} from '@whiskeysockets/baileys';
import qrcode from 'qrcode-terminal';

import { logger as appLogger } from './AppLogger.js';

const AUTH_DIR = './store/auth';

const logger = appLogger.child({ level: 'warn' });

async function authenticate(): Promise<void> {
	fs.mkdirSync(AUTH_DIR, { recursive: true });

	const { state, saveCreds } = await useMultiFileAuthState(AUTH_DIR);

	if (state.creds.registered) {
		// biome-ignore lint/suspicious/noConsole: CLI auth script — console is the intended output
		console.log('✓ Already authenticated with WhatsApp');
		// biome-ignore lint/suspicious/noConsole: CLI auth script
		console.log('  To re-authenticate, delete the store/auth folder and run again.');
		process.exit(0);
	}

	// biome-ignore lint/suspicious/noConsole: CLI auth script
	console.log('Starting WhatsApp authentication...\n');

	const sock = makeWASocket({
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
			// biome-ignore lint/suspicious/noConsole: CLI auth script — QR code instructions
			console.log('Scan this QR code with WhatsApp:\n');
			// biome-ignore lint/suspicious/noConsole: CLI auth script
			console.log('  1. Open WhatsApp on your phone');
			// biome-ignore lint/suspicious/noConsole: CLI auth script
			console.log('  2. Tap Settings → Linked Devices → Link a Device');
			// biome-ignore lint/suspicious/noConsole: CLI auth script
			console.log('  3. Point your camera at the QR code below\n');
			qrcode.generate(qr, { small: true });
		}

		if (connection === 'close') {
			const reason = (lastDisconnect?.error as any)?.output?.statusCode;

			if (reason === DisconnectReason.loggedOut) {
				// biome-ignore lint/suspicious/noConsole: CLI auth script — error feedback
				console.log('\n✗ Logged out. Delete store/auth and try again.');
				process.exit(1);
			} else {
				// biome-ignore lint/suspicious/noConsole: CLI auth script — error feedback
				console.log('\n✗ Connection failed. Please try again.');
				process.exit(1);
			}
		}

		if (connection === 'open') {
			// biome-ignore lint/suspicious/noConsole: CLI auth script — success feedback
			console.log('\n✓ Successfully authenticated with WhatsApp!');
			// biome-ignore lint/suspicious/noConsole: CLI auth script
			console.log('  Credentials saved to store/auth/');
			// biome-ignore lint/suspicious/noConsole: CLI auth script
			console.log('  You can now start the Guardian Core service.\n');

			// Give it a moment to save credentials, then exit
			setTimeout(() => process.exit(0), 1000);
		}
	});

	sock.ev.on('creds.update', saveCreds);
}

authenticate().catch((err) => {
	logger.error({ err }, 'Authentication failed');
	process.exit(1);
});
