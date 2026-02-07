/**
 * Guardian Core Agent Runner
 * Runs inside a container, receives config via stdin, outputs result to stdout
 */

import fs from 'fs';
import path from 'path';
import { query, HookCallback, PreCompactHookInput } from '@anthropic-ai/claude-agent-sdk';
import type { ContainerInput, ContainerOutput } from '@guardian/shared';
import { OUTPUT_START_MARKER, OUTPUT_END_MARKER } from '@guardian/shared';
import { createIpcMcp } from './ipc-mcp.js';

interface SessionEntry {
  sessionId: string;
  fullPath: string;
  summary: string;
  firstPrompt: string;
}

interface SessionsIndex {
  entries: SessionEntry[];
}

async function readStdin(): Promise<string> {
  return new Promise((resolve, reject) => {
    let data = '';
    process.stdin.setEncoding('utf8');
    process.stdin.on('data', chunk => { data += chunk; });
    process.stdin.on('end', () => resolve(data));
    process.stdin.on('error', reject);
  });
}

function writeOutput(output: ContainerOutput): void {
  console.log(OUTPUT_START_MARKER);
  console.log(JSON.stringify(output));
  console.log(OUTPUT_END_MARKER);
}

function log(message: string): void {
  console.error(`[agent-runner] ${message}`);
}

function getSessionSummary(sessionId: string, transcriptPath: string): string | null {
  // sessions-index.json is in the same directory as the transcript
  const projectDir = path.dirname(transcriptPath);
  const indexPath = path.join(projectDir, 'sessions-index.json');

  if (!fs.existsSync(indexPath)) {
    log(`Sessions index not found at ${indexPath}`);
    return null;
  }

  try {
    const index: SessionsIndex = JSON.parse(fs.readFileSync(indexPath, 'utf-8'));
    const entry = index.entries.find(e => e.sessionId === sessionId);
    if (entry?.summary) {
      return entry.summary;
    }
  } catch (err) {
    log(`Failed to read sessions index: ${err instanceof Error ? err.message : String(err)}`);
  }

  return null;
}

/**
 * Archive the full transcript to conversations/ before compaction.
 */
function createPreCompactHook(): HookCallback {
  return async (input, _toolUseId, _context) => {
    const preCompact = input as PreCompactHookInput;
    const transcriptPath = preCompact.transcript_path;
    const sessionId = preCompact.session_id;

    if (!transcriptPath || !fs.existsSync(transcriptPath)) {
      log('No transcript found for archiving');
      return {};
    }

    try {
      const content = fs.readFileSync(transcriptPath, 'utf-8');
      const messages = parseTranscript(content);

      if (messages.length === 0) {
        log('No messages to archive');
        return {};
      }

      const summary = getSessionSummary(sessionId, transcriptPath);
      const name = summary ? sanitizeFilename(summary) : generateFallbackName();

      const conversationsDir = '/workspace/group/conversations';
      fs.mkdirSync(conversationsDir, { recursive: true });

      const date = new Date().toISOString().split('T')[0];
      const filename = `${date}-${name}.md`;
      const filePath = path.join(conversationsDir, filename);

      const markdown = formatTranscriptMarkdown(messages, summary);
      fs.writeFileSync(filePath, markdown);

      log(`Archived conversation to ${filePath}`);
    } catch (err) {
      log(`Failed to archive transcript: ${err instanceof Error ? err.message : String(err)}`);
    }

    return {};
  };
}

function sanitizeFilename(summary: string): string {
  return summary
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 50);
}

function generateFallbackName(): string {
  const time = new Date();
  return `conversation-${time.getHours().toString().padStart(2, '0')}${time.getMinutes().toString().padStart(2, '0')}`;
}

interface ParsedMessage {
  role: 'user' | 'assistant';
  content: string;
}

function parseTranscript(content: string): ParsedMessage[] {
  const messages: ParsedMessage[] = [];

  for (const line of content.split('\n')) {
    if (!line.trim()) continue;
    try {
      const entry = JSON.parse(line);
      if (entry.type === 'user' && entry.message?.content) {
        const text = typeof entry.message.content === 'string'
          ? entry.message.content
          : entry.message.content.map((c: { text?: string }) => c.text || '').join('');
        if (text) messages.push({ role: 'user', content: text });
      } else if (entry.type === 'assistant' && entry.message?.content) {
        const textParts = entry.message.content
          .filter((c: { type: string }) => c.type === 'text')
          .map((c: { text: string }) => c.text);
        const text = textParts.join('');
        if (text) messages.push({ role: 'assistant', content: text });
      }
    } catch {
    }
  }

  return messages;
}

function formatTranscriptMarkdown(messages: ParsedMessage[], title?: string | null): string {
  const now = new Date();
  const formatDateTime = (d: Date) => d.toLocaleString('en-US', {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    hour12: true
  });

  const lines: string[] = [];
  lines.push(`# ${title || 'Conversation'}`);
  lines.push('');
  lines.push(`Archived: ${formatDateTime(now)}`);
  lines.push('');
  lines.push('---');
  lines.push('');

  for (const msg of messages) {
    const sender = msg.role === 'user' ? 'User' : 'Rumi';
    const content = msg.content.length > 2000
      ? msg.content.slice(0, 2000) + '...'
      : msg.content;
    lines.push(`**${sender}**: ${content}`);
    lines.push('');
  }

  return lines.join('\n');
}

async function main(): Promise<void> {
  let input: ContainerInput;

  try {
    const stdinData = await readStdin();
    input = JSON.parse(stdinData);
    log(`Received input for group: ${input.groupFolder}`);
  } catch (err) {
    writeOutput({
      status: 'error',
      result: null,
      error: `Failed to parse input: ${err instanceof Error ? err.message : String(err)}`
    });
    process.exit(1);
  }

  const ipcMcp = createIpcMcp({
    chatJid: input.chatJid,
    groupFolder: input.groupFolder,
    isMain: input.isMain
  });

  let result: string | null = null;
  let newSessionId: string | undefined;

  // BCP: Backup template files before each session, validate on read
  const TEMPLATE_FILES = ['SOUL.md', 'IDENTITY.md', 'USER.md', 'TOOLS.md', 'HEARTBEAT.md', 'BOOT.md', 'VOICE_PROMPT.md', 'THREAT_MODEL.json'];
  const GROUP_DIR = '/workspace/group';
  const BACKUP_DIR = path.join(GROUP_DIR, '_backups');
  const MAX_BACKUPS = 5;

  // Create rolling backup of all templates
  try {
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const backupSubdir = path.join(BACKUP_DIR, timestamp);
    fs.mkdirSync(backupSubdir, { recursive: true });

    for (const file of TEMPLATE_FILES) {
      const src = path.join(GROUP_DIR, file);
      if (fs.existsSync(src)) {
        fs.copyFileSync(src, path.join(backupSubdir, file));
      }
    }

    // Prune old backups beyond MAX_BACKUPS
    const backups = fs.readdirSync(BACKUP_DIR)
      .filter(d => fs.statSync(path.join(BACKUP_DIR, d)).isDirectory())
      .sort()
      .reverse();
    for (const old of backups.slice(MAX_BACKUPS)) {
      const oldDir = path.join(BACKUP_DIR, old);
      for (const f of fs.readdirSync(oldDir)) {
        fs.unlinkSync(path.join(oldDir, f));
      }
      fs.rmdirSync(oldDir);
    }
    log(`Template backup created: ${timestamp} (${backups.length} total)`);
  } catch (err) {
    log(`Template backup failed (non-fatal): ${err instanceof Error ? err.message : String(err)}`);
  }

  // Inject template files (OpenClaw-style) into the prompt context
  // Validate each file: if empty/corrupted, restore from latest backup
  const templateSections: string[] = [];
  for (const file of TEMPLATE_FILES) {
    const filePath = path.join(GROUP_DIR, file);
    try {
      if (fs.existsSync(filePath)) {
        let content = fs.readFileSync(filePath, 'utf-8').trim();

        // Validation: file exists but is empty or suspiciously short (<10 chars)
        if (content.length < 10) {
          log(`WARNING: ${file} appears corrupted (${content.length} chars), attempting restore`);
          const restored = restoreFromBackup(file);
          if (restored) {
            content = restored;
            log(`Restored ${file} from backup`);
          } else {
            log(`No backup available for ${file}, skipping`);
            continue;
          }
        }

        templateSections.push(`<${file}>\n${content}\n</${file}>`);
      }
    } catch {
      // Skip unreadable files
    }
  }

  function restoreFromBackup(file: string): string | null {
    try {
      const backups = fs.readdirSync(BACKUP_DIR)
        .filter(d => fs.statSync(path.join(BACKUP_DIR, d)).isDirectory())
        .sort()
        .reverse();

      for (const backup of backups) {
        const backupFile = path.join(BACKUP_DIR, backup, file);
        if (fs.existsSync(backupFile)) {
          const content = fs.readFileSync(backupFile, 'utf-8').trim();
          if (content.length >= 10) {
            // Restore to live file
            fs.writeFileSync(path.join(GROUP_DIR, file), content);
            return content;
          }
        }
      }
    } catch {
      // Backup dir doesn't exist or isn't readable
    }
    return null;
  }

  let prompt = input.prompt;

  if (templateSections.length > 0) {
    prompt = `<context>\n${templateSections.join('\n\n')}\n</context>\n\n${prompt}`;
  }

  // Add context for scheduled tasks
  if (input.isScheduledTask) {
    prompt = `[SCHEDULED TASK - You are running automatically, not in response to a user message. Use mcp__guardian_core__send_message if needed to communicate with the user.]\n\n${prompt}`;
  }

  try {
    log('Starting agent...');

    for await (const message of query({
      prompt,
      options: {
        cwd: '/workspace/group',
        resume: input.sessionId,
        allowedTools: [
          'Bash',
          'Read', 'Write', 'Edit', 'Glob', 'Grep',
          'WebSearch', 'WebFetch',
          'mcp__guardian_core__*'
        ],
        permissionMode: 'bypassPermissions',
        allowDangerouslySkipPermissions: true,
        settingSources: ['project'],
        mcpServers: {
          guardian_core: ipcMcp
        },
        hooks: {
          PreCompact: [{ hooks: [createPreCompactHook()] }]
        }
      }
    })) {
      if (message.type === 'system' && message.subtype === 'init') {
        newSessionId = message.session_id;
        log(`Session initialized: ${newSessionId}`);
      }

      if ('result' in message && message.result) {
        result = message.result as string;
      }
    }

    log('Agent completed successfully');
    writeOutput({
      status: 'success',
      result,
      newSessionId
    });

  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : String(err);
    log(`Agent error: ${errorMessage}`);
    writeOutput({
      status: 'error',
      result: null,
      newSessionId,
      error: errorMessage
    });
    process.exit(1);
  }
}

main();
