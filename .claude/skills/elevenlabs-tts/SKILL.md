---
name: elevenlabs-tts
description: Format text for ElevenLabs text-to-speech with proper audio tags, pauses, pronunciation control, and emotional delivery. Use when preparing scripts, stories, or dialogue for TTS conversion, cleaning markdown for narration, formatting multi-character dialogue, or optimizing text for ElevenLabs models (v2, v2.5, v3). Triggers on tasks involving TTS formatting, audiobook preparation, voice-over scripts, pronunciation dictionaries, or ElevenLabs output.
---

# ElevenLabs Text-to-Speech Formatting

Format text for natural, expressive speech synthesis with ElevenLabs models.

## Model Selection

| Model | Best For | Supports |
|-------|----------|----------|
| **Eleven v3** | Expressive, emotional content | Audio tags, multi-speaker |
| **Multilingual v2** | Multi-language, natural delivery | Alias tags only |
| **Flash v2.5** | Low-latency conversational | Alias tags only |
| **Flash v2 / Turbo v2** | Fast generation | SSML phoneme tags |
| **English v1** | English-only | SSML phoneme tags |

## Quick Reference: Audio Tags (v3 only)

**Emotions:** `[happy]` `[sad]` `[excited]` `[angry]` `[curious]` `[sarcastic]` `[surprised]`

**Delivery:** `[whispers]` `[laughs]` `[sighs]` `[exhales]` `[chuckles]` `[crying]`

**Special:** `[strong X accent]` `[sings]` `[applause]` `[gunshot]`

```text
[whispers] I never knew it could be this way. [sighs] But here we are.
```

## Pauses

**v3:** Use ellipses `...` or audio tags like `[short pause]` `[long pause]`

**v2/v2.5:** Use SSML break tags (up to 3 seconds):
```text
"Hold on." <break time="1.5s" /> "I've got it."
```

**Alternatives:** Dashes (`—`) for short pauses, ellipses (`...`) for hesitation.

## Emotion and Delivery

Add narrative context or explicit dialogue tags:

```text
"You're leaving?" she asked, her voice trembling with sadness.
"That's it!" he exclaimed triumphantly.
```

**Note:** Emotional delivery guides are spoken aloud. Remove in post-production if unwanted.

## Emphasis

- **CAPITALS** increase emphasis: `"It was a VERY long day."`
- **Punctuation** affects rhythm: `!` `?` `...`
- **Structure** influences pacing: shorter sentences = faster pace

## Pronunciation Control

For difficult words, names, or acronyms:

**Phoneme tags** (Flash v2, Turbo v2, English v1 only):
```xml
<phoneme alphabet="cmu-arpabet" ph="M AE1 D IH0 S AH0 N">Madison</phoneme>
```

**Alias tags** (all models via pronunciation dictionaries):
```xml
<lexeme>
  <grapheme>Claughton</grapheme>
  <alias>Cloffton</alias>
</lexeme>
```

**Phonetic spelling** (inline alternative): Write words phonetically, e.g., "trapezIi" for emphasis on "ii".

See [references/pronunciation.md](references/pronunciation.md) for complete phoneme and dictionary guide.

## Text Normalization

Complex items (phone numbers, currencies, dates) may mispronounce. Normalize before TTS:

| Input | Normalized |
|-------|------------|
| `$42.50` | forty-two dollars and fifty cents |
| `555-555-5555` | five five five, five five five, five five five five |
| `2024-01-01` | January first, two-thousand twenty-four |
| `14:30` | two thirty PM |

See [references/normalization.md](references/normalization.md) for code examples and LLM prompts.

## Multi-Speaker Dialogue (v3)

Assign distinct voices to each speaker:

```text
Speaker 1: [excitedly] Have you tried the new model?

Speaker 2: [curiously] Just got it! The clarity is amazing—
[whispers] like this!

Speaker 1: [impressed] Check this out—
[dramatically] "To be or not to be!"
```

## Speed Control

Use the speed setting (0.7–1.2, default 1.0) in ElevenLabs UI/API. Extreme values may affect quality.

## Per-Call Conversation Config Override

**Important:** The PATCH-then-call pattern is race-prone — overlapping calls can cross-contaminate prompts. Use per-call `conversation_config_override` instead for atomic prompt injection.

### How It Works

Pass `conversation_config_override` inside `conversation_initiation_client_data` in the outbound call payload:

```json
{
  "agent_id": "<agent_id>",
  "agent_phone_number_id": "<phone_number_id>",
  "to_number": "+15551234567",
  "conversation_initiation_client_data": {
    "conversation_config_override": {
      "agent": {
        "prompt": { "prompt": "Per-call system prompt here" },
        "first_message": "Per-call opening message"
      }
    }
  }
}
```

### Setup Required

Before overrides work, you must enable them in the ElevenLabs dashboard:
1. Navigate to your agent → Security tab
2. Enable "System prompt" override
3. Enable "First message" override

Without this, the overrides will be silently ignored.

### Contact-Class Branching

Use different first_messages based on who you're calling:

- **Owner calls:** Include personal context, mention WhatsApp follow-up
  - `"Hey, this is Rumi. I'm calling because: {{reason}}. I've sent the full details to your WhatsApp."`
- **Third-party calls:** Guarded, no personal context
  - `"Hi, this is Rumi calling on behalf of Shovon. I'm reaching out because: {{reason}}."`

### Reason Sanitization

Before injecting a user-supplied reason into the first_message:
1. Strip control characters (`\x00-\x08`, `\x0B`, `\x0C`, `\x0E-\x1F`, `\x7F`)
2. Truncate to maximum length (500 chars recommended)
3. Trim whitespace

This prevents prompt injection via the reason field.

See `elevenlabs/SKILL.md` Section 7 for full security patterns including 4-tier information classification.

## Workflow

1. **Choose model** based on requirements (latency, language, features)
2. **Clean text** - remove markdown, fix formatting
3. **Normalize** phone numbers, currencies, dates, abbreviations
4. **Add audio tags** (v3) or SSML tags (v2) for emotion and pauses
5. **Handle pronunciation** with phoneme tags, aliases, or phonetic spelling
6. **Set voice settings** - stability slider affects expressiveness:
   - Creative: expressive, may hallucinate
   - Natural: balanced (recommended)
   - Robust: stable, less responsive to tags

## Resources

- [references/v3-prompting.md](references/v3-prompting.md) - Eleven v3 audio tags and multi-speaker examples
- [references/pronunciation.md](references/pronunciation.md) - Phoneme tags and pronunciation dictionaries
- [references/normalization.md](references/normalization.md) - Text normalization code and LLM prompts
