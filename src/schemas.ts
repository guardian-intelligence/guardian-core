import { Schema } from 'effect';

// --- Mount Security ---

export const AdditionalMount = Schema.Struct({
  hostPath: Schema.String,
  containerPath: Schema.String,
  readonly: Schema.optional(Schema.Boolean),
});
export type AdditionalMount = typeof AdditionalMount.Type;

export const AllowedRoot = Schema.Struct({
  path: Schema.String,
  allowReadWrite: Schema.Boolean,
  description: Schema.optional(Schema.String),
});
export type AllowedRoot = typeof AllowedRoot.Type;

export const MountAllowlist = Schema.Struct({
  allowedRoots: Schema.Array(AllowedRoot),
  blockedPatterns: Schema.Array(Schema.String),
  nonMainReadOnly: Schema.Boolean,
});
export type MountAllowlist = typeof MountAllowlist.Type;

// --- Container ---

export const ContainerConfig = Schema.Struct({
  additionalMounts: Schema.optional(Schema.Array(AdditionalMount)),
  timeout: Schema.optional(Schema.Number),
  env: Schema.optional(Schema.Record({ key: Schema.String, value: Schema.String })),
});
export type ContainerConfig = typeof ContainerConfig.Type;

export const RegisteredGroup = Schema.Struct({
  name: Schema.String,
  folder: Schema.String,
  trigger: Schema.String,
  added_at: Schema.String,
  containerConfig: Schema.optional(ContainerConfig),
});
export type RegisteredGroup = typeof RegisteredGroup.Type;

// --- Messages ---

export const NewMessage = Schema.Struct({
  id: Schema.String,
  chat_jid: Schema.String,
  sender: Schema.String,
  sender_name: Schema.String,
  content: Schema.String,
  timestamp: Schema.String,
});
export type NewMessage = typeof NewMessage.Type;

// --- Scheduled Tasks ---

export const ScheduledTask = Schema.Struct({
  id: Schema.String,
  group_folder: Schema.String,
  chat_jid: Schema.String,
  prompt: Schema.String,
  schedule_type: Schema.Literal('cron', 'interval', 'once'),
  schedule_value: Schema.String,
  context_mode: Schema.Literal('group', 'isolated'),
  next_run: Schema.NullOr(Schema.String),
  last_run: Schema.NullOr(Schema.String),
  last_result: Schema.NullOr(Schema.String),
  status: Schema.Literal('active', 'paused', 'completed'),
  created_at: Schema.String,
});
export type ScheduledTask = typeof ScheduledTask.Type;

export const TaskRunLog = Schema.Struct({
  task_id: Schema.String,
  run_at: Schema.String,
  duration_ms: Schema.Number,
  status: Schema.Literal('success', 'error'),
  result: Schema.NullOr(Schema.String),
  error: Schema.NullOr(Schema.String),
});
export type TaskRunLog = typeof TaskRunLog.Type;

// --- Phone Contacts ---

export const PhoneContactClass = Schema.Literal('owner', 'third_party');
export type PhoneContactClass = typeof PhoneContactClass.Type;

export const PhoneContact = Schema.Struct({
  id: Schema.NonEmptyString,
  name: Schema.NonEmptyString,
  number: Schema.String.pipe(Schema.pattern(/^\+[1-9]\d{1,14}$/)),
  class: PhoneContactClass,
});
export type PhoneContact = typeof PhoneContact.Type;

export const PhoneContacts = Schema.Struct({
  contacts: Schema.Array(PhoneContact),
  default_contact: Schema.NonEmptyString,
  deny_unknown: Schema.Boolean,
});
export type PhoneContacts = typeof PhoneContacts.Type;
