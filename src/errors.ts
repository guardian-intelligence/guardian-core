import { Data } from 'effect';

// --- Config errors ---
export class ConfigError extends Data.TaggedError('ConfigError')<{
	readonly key: string;
	readonly message: string;
}> {}

// --- Database errors ---
export class DatabaseInitError extends Data.TaggedError('DatabaseInitError')<{
	readonly message: string;
	readonly cause?: unknown;
}> {}

export class DatabaseQueryError extends Data.TaggedError('DatabaseQueryError')<{
	readonly operation: string;
	readonly message: string;
	readonly cause?: unknown;
}> {}

// --- Container errors ---
export class ContainerSpawnError extends Data.TaggedError('ContainerSpawnError')<{
	readonly group: string;
	readonly message: string;
	readonly cause?: unknown;
}> {}

export class ContainerTimeoutError extends Data.TaggedError('ContainerTimeoutError')<{
	readonly group: string;
	readonly timeoutMs: number;
}> {}

export class ContainerOutputParseError extends Data.TaggedError('ContainerOutputParseError')<{
	readonly group: string;
	readonly message: string;
	readonly stdout?: string;
}> {}

export class ContainerExitError extends Data.TaggedError('ContainerExitError')<{
	readonly group: string;
	readonly exitCode: number;
	readonly stderr?: string;
}> {}

// --- Mount security errors ---
export class MountAllowlistNotFoundError extends Data.TaggedError('MountAllowlistNotFoundError')<{
	readonly path: string;
}> {}

export class MountAllowlistParseError extends Data.TaggedError('MountAllowlistParseError')<{
	readonly path: string;
	readonly message: string;
	readonly cause?: unknown;
}> {}

export class MountValidationError extends Data.TaggedError('MountValidationError')<{
	readonly hostPath: string;
	readonly reason: string;
}> {}

// --- WhatsApp errors ---
export class WhatsAppConnectionError extends Data.TaggedError('WhatsAppConnectionError')<{
	readonly message: string;
	readonly cause?: unknown;
}> {}

export class WhatsAppSendError extends Data.TaggedError('WhatsAppSendError')<{
	readonly jid: string;
	readonly message: string;
	readonly cause?: unknown;
}> {}

// --- Phone caller errors ---
export class PhoneCallerConfigError extends Data.TaggedError('PhoneCallerConfigError')<{
	readonly message: string;
}> {}

export class PhoneCallerApiError extends Data.TaggedError('PhoneCallerApiError')<{
	readonly message: string;
	readonly statusCode?: number;
	readonly cause?: unknown;
}> {}

export class PhoneContactsNotFoundError extends Data.TaggedError('PhoneContactsNotFoundError')<{
	readonly path: string;
}> {}

export class PhoneContactsParseError extends Data.TaggedError('PhoneContactsParseError')<{
	readonly path: string;
	readonly message: string;
	readonly cause?: unknown;
}> {}

// --- IPC errors ---
export class IpcReadError extends Data.TaggedError('IpcReadError')<{
	readonly path: string;
	readonly message: string;
	readonly cause?: unknown;
}> {}

export class IpcParseError extends Data.TaggedError('IpcParseError')<{
	readonly path: string;
	readonly message: string;
	readonly cause?: unknown;
}> {}

export class IpcAuthorizationError extends Data.TaggedError('IpcAuthorizationError')<{
	readonly group: string;
	readonly action: string;
	readonly message: string;
}> {}

// --- File I/O errors ---
export class FileReadError extends Data.TaggedError('FileReadError')<{
	readonly path: string;
	readonly message: string;
	readonly cause?: unknown;
}> {}

export class FileWriteError extends Data.TaggedError('FileWriteError')<{
	readonly path: string;
	readonly message: string;
	readonly cause?: unknown;
}> {}

// --- Task scheduler errors ---
export class TaskSchedulerError extends Data.TaggedError('TaskSchedulerError')<{
	readonly taskId: string;
	readonly message: string;
	readonly cause?: unknown;
}> {}

// --- Deploy errors ---
export class DeployError extends Data.TaggedError('DeployError')<{
	readonly stage: string;
	readonly message: string;
	readonly cause?: unknown;
}> {}

// --- Template commit errors ---
export class TemplateCommitError extends Data.TaggedError('TemplateCommitError')<{
	readonly stage: string;
	readonly message: string;
	readonly cause?: unknown;
}> {}

// --- Secrets errors ---
export class SecretsError extends Data.TaggedError('SecretsError')<{
	readonly stage: string;
	readonly message: string;
	readonly cause?: unknown;
}> {}
