import path from 'node:path';
import { Context, Duration, Layer } from 'effect';

export interface AppConfigShape {
	readonly assistantName: string;
	readonly pollInterval: number;
	readonly schedulerPollInterval: number;
	readonly projectRoot: string;
	readonly homeDir: string;
	readonly mountAllowlistPath: string;
	readonly storeDir: string;
	readonly groupsDir: string;
	readonly dataDir: string;
	readonly mainGroupFolder: string;
	readonly containerImage: string;
	readonly containerTimeout: number;
	readonly containerMaxOutputSize: number;
	readonly ipcPollInterval: number;
	readonly timezone: string;
	// Duration-typed equivalents (use in Effect code)
	readonly pollIntervalDuration: Duration.Duration;
	readonly schedulerPollDuration: Duration.Duration;
	readonly containerTimeoutDuration: Duration.Duration;
	readonly ipcPollDuration: Duration.Duration;
}

export class AppConfig extends Context.Tag('AppConfig')<AppConfig, AppConfigShape>() {}

export const AppConfigLive = Layer.succeed(AppConfig, {
	assistantName: process.env.ASSISTANT_NAME || 'Andy',
	pollInterval: 2000,
	schedulerPollInterval: 60000,
	projectRoot: process.cwd(),
	homeDir: process.env.HOME || '/Users/user',
	get mountAllowlistPath() {
		return path.join(this.homeDir, '.config', 'guardian-core', 'mount-allowlist.json');
	},
	get storeDir() {
		return path.resolve(this.projectRoot, 'store');
	},
	get groupsDir() {
		return path.resolve(this.projectRoot, 'groups');
	},
	get dataDir() {
		return path.resolve(this.projectRoot, 'data');
	},
	mainGroupFolder: 'main',
	containerImage: process.env.CONTAINER_IMAGE || 'guardian-core-agent:latest',
	containerTimeout: parseInt(process.env.CONTAINER_TIMEOUT || '300000', 10),
	containerMaxOutputSize: parseInt(process.env.CONTAINER_MAX_OUTPUT_SIZE || '10485760', 10),
	ipcPollInterval: 1000,
	timezone: process.env.TZ || Intl.DateTimeFormat().resolvedOptions().timeZone,
	pollIntervalDuration: Duration.millis(2000),
	schedulerPollDuration: Duration.minutes(1),
	containerTimeoutDuration: Duration.millis(
		parseInt(process.env.CONTAINER_TIMEOUT || '300000', 10),
	),
	ipcPollDuration: Duration.seconds(1),
});

// --- Static re-exports (consumed by legacy wrappers at module-load time) ---

const PROJECT_ROOT = process.cwd();
const HOME_DIR = process.env.HOME || '/Users/user';

export const ASSISTANT_NAME = process.env.ASSISTANT_NAME || 'Andy';
export const POLL_INTERVAL = 2000;
export const SCHEDULER_POLL_INTERVAL = 60000;
export const MOUNT_ALLOWLIST_PATH = path.join(
	HOME_DIR,
	'.config',
	'guardian-core',
	'mount-allowlist.json',
);
export const PHONE_CONTACTS_PATH = path.join(
	HOME_DIR,
	'.config',
	'guardian-core',
	'phone-contacts.json',
);
export const STORE_DIR = path.resolve(PROJECT_ROOT, 'store');
export const GROUPS_DIR = path.resolve(PROJECT_ROOT, 'groups');
export const DATA_DIR = path.resolve(PROJECT_ROOT, 'data');
export const MAIN_GROUP_FOLDER = 'main';
export const CONTAINER_IMAGE = process.env.CONTAINER_IMAGE || 'guardian-core-agent:latest';
export const CONTAINER_TIMEOUT = parseInt(process.env.CONTAINER_TIMEOUT || '300000', 10);
export const CONTAINER_MAX_OUTPUT_SIZE = parseInt(
	process.env.CONTAINER_MAX_OUTPUT_SIZE || '10485760',
	10,
);
export const IPC_POLL_INTERVAL = 1000;
export const TIMEZONE = process.env.TZ || Intl.DateTimeFormat().resolvedOptions().timeZone;

function escapeRegex(str: string): string {
	return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
export const TRIGGER_PATTERN = new RegExp(`^@${escapeRegex(ASSISTANT_NAME)}\\b`, 'i');
