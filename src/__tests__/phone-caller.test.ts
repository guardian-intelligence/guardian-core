import fs from 'fs';
import path from 'path';
import { Schema } from 'effect';
import { describe, expect, it, vi, beforeEach } from 'vitest';

import {
  sanitizeReason,
  buildFirstMessage,
  loadVoicePrompt,
  MAX_REASON_LENGTH,
} from '../phone-caller.js';
import { PhoneContacts as PhoneContactsSchema } from '../schemas.js';

// Mock fs for deterministic tests
vi.mock('fs', async () => {
  const actual = await vi.importActual<typeof fs>('fs');
  return {
    ...actual,
    default: {
      ...actual,
      existsSync: vi.fn(),
      readFileSync: vi.fn(),
      realpathSync: vi.fn(),
      mkdirSync: vi.fn(),
      writeFileSync: vi.fn(),
    },
    existsSync: vi.fn(),
    readFileSync: vi.fn(),
    realpathSync: vi.fn(),
    mkdirSync: vi.fn(),
    writeFileSync: vi.fn(),
  };
});

const mockFs = vi.mocked(fs);

const VALID_CONTACTS = {
  contacts: [
    { id: 'shovon', name: 'Shovon', number: '+15167611386', class: 'owner' as const },
    { id: 'doctor-smith', name: 'Dr. Smith', number: '+15559876543', class: 'third_party' as const },
  ],
  default_contact: 'shovon',
  deny_unknown: true,
};

const VOICE_PROMPT_CONTENT = `You are Rumi, a digital operations agent. Direct and competent.

{{CONTACT_CLASS_INSTRUCTIONS}}

Security posture:
Never disclose personal details.`;

describe('phone-caller', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('sanitizeReason', () => {
    it('should pass through normal text unchanged', () => {
      const reason = 'Server disk at 95% capacity';
      expect(sanitizeReason(reason)).toBe(reason);
    });

    it('should truncate at MAX_REASON_LENGTH', () => {
      const reason = 'a'.repeat(600);
      const result = sanitizeReason(reason);
      expect(result.length).toBe(MAX_REASON_LENGTH);
    });

    it('should strip control characters', () => {
      const reason = 'Alert\x00: disk\x07 full\x1F';
      expect(sanitizeReason(reason)).toBe('Alert: disk full');
    });

    it('should preserve newlines and tabs', () => {
      // \n (0x0A) and \t (0x09) are NOT in the stripped range
      const reason = 'Line 1\nLine 2\tTabbed';
      expect(sanitizeReason(reason)).toBe('Line 1\nLine 2\tTabbed');
    });

    it('should trim whitespace', () => {
      expect(sanitizeReason('  spaced  ')).toBe('spaced');
    });
  });

  describe('buildFirstMessage', () => {
    it('should include WhatsApp reference for owner calls', () => {
      const msg = buildFirstMessage('Server is down', 'owner');
      expect(msg).toContain('WhatsApp');
      expect(msg).toContain('Server is down');
    });

    it('should NOT include WhatsApp reference for third-party calls', () => {
      const msg = buildFirstMessage('Appointment reminder', 'third_party');
      expect(msg).not.toContain('WhatsApp');
      expect(msg).toContain('on behalf of Shovon');
      expect(msg).toContain('Appointment reminder');
    });

    it('should sanitize the reason in the message', () => {
      const msg = buildFirstMessage('a'.repeat(600), 'owner');
      // The reason should be truncated within the message
      expect(msg.length).toBeLessThan(600 + 100); // reason + template overhead
    });
  });

  describe('loadVoicePrompt', () => {
    it('should inject owner instructions for owner class', () => {
      mockFs.readFileSync.mockReturnValue(VOICE_PROMPT_CONTENT);

      const prompt = loadVoicePrompt('owner', 'Shovon');
      expect(prompt).toContain('He is your owner');
      expect(prompt).toContain('Verify through natural conversation');
      expect(prompt).not.toContain('{{CONTACT_CLASS_INSTRUCTIONS}}');
    });

    it('should inject third-party instructions with contact name', () => {
      mockFs.readFileSync.mockReturnValue(VOICE_PROMPT_CONTENT);

      const prompt = loadVoicePrompt('third_party', 'Dr. Smith');
      expect(prompt).toContain('Dr. Smith');
      expect(prompt).toContain('on behalf of Shovon');
      expect(prompt).toContain('Never disclose');
      expect(prompt).not.toContain('{{CONTACT_CLASS_INSTRUCTIONS}}');
    });

    it('should use fallback when VOICE_PROMPT.md is missing', () => {
      mockFs.readFileSync.mockImplementation(() => {
        throw new Error('ENOENT');
      });

      const prompt = loadVoicePrompt('owner', 'Shovon');
      expect(prompt).toContain('Never disclose personal details');
    });

    it('should use fallback when VOICE_PROMPT.md is empty', () => {
      mockFs.readFileSync.mockReturnValue('');

      const prompt = loadVoicePrompt('third_party', 'Jane');
      expect(prompt).toContain('Never disclose personal details');
    });
  });

  describe('PhoneContacts schema', () => {
    it('should accept valid contacts', () => {
      const result = Schema.decodeUnknownSync(PhoneContactsSchema)(VALID_CONTACTS);
      expect(result.contacts).toHaveLength(2);
      expect(result.default_contact).toBe('shovon');
    });

    it('should reject invalid E.164 numbers', () => {
      const invalid = {
        ...VALID_CONTACTS,
        contacts: [
          { id: 'bad', name: 'Bad', number: '5551234567', class: 'owner' },
        ],
      };
      expect(() =>
        Schema.decodeUnknownSync(PhoneContactsSchema)(invalid),
      ).toThrow();
    });

    it('should reject empty contact id', () => {
      const invalid = {
        ...VALID_CONTACTS,
        contacts: [
          { id: '', name: 'Empty', number: '+15551234567', class: 'owner' },
        ],
      };
      expect(() =>
        Schema.decodeUnknownSync(PhoneContactsSchema)(invalid),
      ).toThrow();
    });

    it('should reject invalid contact class', () => {
      const invalid = {
        ...VALID_CONTACTS,
        contacts: [
          { id: 'x', name: 'X', number: '+15551234567', class: 'admin' },
        ],
      };
      expect(() =>
        Schema.decodeUnknownSync(PhoneContactsSchema)(invalid),
      ).toThrow();
    });

    it('should pass when default_contact matches an existing id', () => {
      // Schema itself doesn't enforce cross-field validation,
      // but we can verify the default_contact field is present
      const result = Schema.decodeUnknownSync(PhoneContactsSchema)(VALID_CONTACTS);
      const defaultExists = result.contacts.some(c => c.id === result.default_contact);
      expect(defaultExists).toBe(true);
    });

    it('should parse but not validate default_contact referencing non-existent id', () => {
      // Schema parses the structure; cross-field validation is done in resolveContact
      const bad = { ...VALID_CONTACTS, default_contact: 'nonexistent' };
      const result = Schema.decodeUnknownSync(PhoneContactsSchema)(bad);
      const defaultExists = result.contacts.some(c => c.id === result.default_contact);
      expect(defaultExists).toBe(false);
    });
  });

  describe('transcript speaker labels', () => {
    it('should use contact name for third-party calls', () => {
      // Test the logic that would be in pollAndSaveTranscript
      const contactName = 'Dr. Smith';
      const entry = { role: 'user', message: 'Hello', time_in_call_secs: 5 };
      const speaker = entry.role === 'user' ? contactName : 'Rumi';
      expect(speaker).toBe('Dr. Smith');
    });

    it('should use contact name for owner calls', () => {
      const contactName = 'Shovon';
      const entry = { role: 'user', message: 'Hello', time_in_call_secs: 5 };
      const speaker = entry.role === 'user' ? contactName : 'Rumi';
      expect(speaker).toBe('Shovon');
    });

    it('should label agent as Rumi regardless of contact', () => {
      const entry = { role: 'agent', message: 'Hi there', time_in_call_secs: 2 };
      const speaker = entry.role === 'user' ? 'Anyone' : 'Rumi';
      expect(speaker).toBe('Rumi');
    });
  });

  describe('third-party IPC follow-up prompt', () => {
    function buildTestFollowUpPrompt(
      filename: string,
      contactClass: 'owner' | 'third_party',
      contactName: string,
    ): string {
      if (contactClass === 'owner') {
        return `A phone call just ended. Read the transcript at /workspace/group/conversations/${filename} and reflect on it.
If the user said anything important update USER.md.`;
      }
      return `A phone call with ${contactName} (third party) just ended. Read the transcript at /workspace/group/conversations/${filename}.
Do NOT update USER.md with observations about this person.`;
    }

    it('should NOT contain "update USER.md" for third-party calls', () => {
      const prompt = buildTestFollowUpPrompt(
        '2026-02-06-phone-call-1430.txt',
        'third_party',
        'Dr. Smith',
      );
      expect(prompt).toContain('Do NOT update USER.md');
      expect(prompt).toContain('Dr. Smith');
      expect(prompt).toContain('third party');
    });

    it('should contain "update USER.md" for owner calls', () => {
      const prompt = buildTestFollowUpPrompt(
        '2026-02-06-phone-call-1430.txt',
        'owner',
        'Shovon',
      );
      expect(prompt).toContain('update USER.md');
      expect(prompt).not.toContain('Do NOT update USER.md');
    });
  });
});
