---
name: elevenlabs-v3-narrator
description: Format text for Eleven Labs v3 text-to-speech with proper audio tags, pauses, and multi-character dialogue. Use when converting scripts, stories, or conversations to TTS-ready format, cleaning markdown for narration, or formatting dialogue for Eleven Labs Studio. Triggers on tasks involving TTS formatting, audiobook preparation, voice-over scripts, or Eleven Labs output.
---

# Eleven Labs v3 Narrator

Format text for optimal Eleven Labs v3 text-to-speech output using audio tags, proper punctuation, and multi-character dialogue structure.

**Note:** Eleven v3 is the model used for Rumi's phone calls (ElevenLabs Conversational AI). Voice prompts for conversational AI should be plain text with punctuation for pacing — no SSML, minimal audio tags. Conversational prompts are fundamentally different from narration: keep them natural, concise, and direct rather than dramatically styled.

## Critical: Pause Syntax

**v3 does NOT support SSML break tags** like `<break time="1.5s" />`.

### For Pauses, Use Punctuation (Most Reliable)

| Need | Use | Example |
|------|-----|---------|
| Brief pause | `-` or `,` | `Hold on - let me think.` |
| Moderate pause | `--` or `—` | `I wanted to tell you -- but I couldn't.` |
| Long pause/trailing | `...` | `I never knew...` |
| Extended pause | `-- --` | `And then -- -- everything changed.` |

### Story Beat Tags (Less Reliable)

`[pause]`, `[short pause]`, `[long pause]` are narrative tags that work inconsistently. They function as "story directions" rather than precise timing. Prefer punctuation for reliable pauses.

## Audio Tag Syntax

```
[tag] Text affected by the tag.
```

- Square brackets: `[excited]` not `(excited)` or `{excited}`
- Lowercase recommended (case-insensitive)
- Tags persist until next tag: `[whispers] This is quiet. Still quiet. [normal] Now louder.`
- Layer tags: `[hesitant][nervous] I... I don't know.`

## Common Tag Categories

### Emotion & Tone
`[excited]`, `[nervous]`, `[sad]`, `[angry]`, `[curious]`, `[sarcastic]`, `[playful]`, `[serious]`, `[matter-of-fact]`

### Delivery Style
`[whispers]`, `[shouts]`, `[softly]`, `[casual]`, `[conversational]`, `[formal]`, `[dramatic tone]`

### Pacing
`[rushed]`, `[deliberate]`, `[measured]`, `[hesitates]`, `[stammers]`

### Non-Verbal
`[sighs]`, `[laughs]`, `[gulps]`, `[clears throat]`, `[soft chuckle]`

### Narrator Styles
`[voice-over style]`, `[documentary style]`, `[cinematic tone]`

See [references/v3-audio-tags.md](references/v3-audio-tags.md) for complete tag library.

## Converting Markdown to TTS

Remove all markdown that would be read literally:

| Remove | Reason |
|--------|--------|
| `# Headers` | Reads as "hashtag" |
| `## Subheaders` | Reads as "hashtag hashtag" |
| `---` | Reads as "dash dash dash" |
| `**bold**` | Reads asterisks |
| `- bullet` | Reads "dash bullet" |
| `1. numbered` | May read oddly |

### Conversion Pattern

**Before (Markdown):**
```
# Chapter One

## The Beginning

---

This is **important** text.
```

**After (TTS-ready):**
```
[dramatic tone] Chapter One.

[pause]

The Beginning.

-- --

[serious] This is important text.
```

## Multi-Character Dialogue

### For Eleven Labs Studio

Use speaker labels that will be highlighted and assigned to voices:

```
NARRATOR: [voice-over style] The year was 2026.

-- --

ALICE: [casual] Hey, did you hear about the new project?

BOB: [curious] No, what's going on?

ALICE: [excited] They approved the budget!
```

### For Single Voice (Multi-Character Tags)

```
[as narrator] The detective entered the room.

[as gruff detective] Where were you last night?

[as nervous suspect] I... I was at home. [stammers] I swear.
```

## Best Practices

1. **Minimum length**: Prompts > 250 characters produce more consistent output
2. **Voice matching**: Base voice must support the delivery style (shouting voice won't whisper well)
3. **Punctuation matters**: Ellipses add hesitation, caps add emphasis, periods create natural rhythm
4. **Test combinations**: Different voices respond differently to tags
5. **Avoid tag overload**: Too many tags can cause instability

## Example: Full Script Formatting

**Input (messy markdown):**
```markdown
# A Conversation

## Act 1

---

**CLAUDE**: Let me analyze that.

*pauses*

**USER**: What did you find?
```

**Output (TTS-ready):**
```
[cinematic tone] A Conversation.

[long pause]

CLAUDE: [analytical] Let me analyze that.

...

USER: [curious] What did you find?
```
