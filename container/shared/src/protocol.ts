import type { RegisteredGroup } from './schemas.js';

/** IPC sentinel markers for container <-> host communication. */
export const OUTPUT_START_MARKER = '---GUARDIAN_CORE_OUTPUT_START---';
export const OUTPUT_END_MARKER = '---GUARDIAN_CORE_OUTPUT_END---';

// --- Container I/O protocol ---

export interface ContainerInput {
	prompt: string;
	sessionId?: string;
	groupFolder: string;
	chatJid: string;
	isMain: boolean;
	isScheduledTask?: boolean;
}

export interface ContainerOutput {
	status: 'success' | 'error';
	result: string | null;
	newSessionId?: string;
	error?: string;
}

// --- IPC message types (file-based, container → host) ---

export interface IpcMessage {
	type: 'message';
	chatJid: string;
	text: string;
	groupFolder: string;
	timestamp: string;
}

export interface IpcScheduleTask {
	type: 'schedule_task';
	prompt: string;
	schedule_type: 'cron' | 'interval' | 'once';
	schedule_value: string;
	context_mode: 'group' | 'isolated';
	groupFolder: string;
	chatJid: string;
	createdBy: string;
	timestamp: string;
	target_group?: string;
}

export interface IpcPhoneCall {
	type: 'phone_call';
	reason: string;
	urgency: 'critical' | 'high';
	contact_id?: string;
	groupFolder: string;
	timestamp: string;
}

export interface IpcRegisterGroup {
	type: 'register_group';
	jid: string;
	name: string;
	folder: string;
	trigger: string;
	groupFolder: string;
	timestamp: string;
	containerConfig?: RegisteredGroup['containerConfig'];
}

export interface IpcRefreshGroups {
	type: 'refresh_groups';
	groupFolder: string;
	timestamp: string;
}

export interface IpcTaskAction {
	type: 'pause_task' | 'resume_task' | 'cancel_task';
	taskId: string;
	groupFolder: string;
	timestamp: string;
}

export type IpcPayload =
	| IpcMessage
	| IpcScheduleTask
	| IpcPhoneCall
	| IpcRegisterGroup
	| IpcRefreshGroups
	| IpcTaskAction;
