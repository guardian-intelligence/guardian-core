# Eleven Labs v3 Audio Tags Reference

## Tag Syntax

- Format: `[tag_name]` - square brackets with tag inside
- Case-insensitive (`[happy]` = `[HAPPY]`) but lowercase recommended
- Tags affect all subsequent text until a new tag is introduced
- Tags can be layered: `[hesitant][nervous] I... I'm not sure.`

## Emotion Tags

### Core Emotions
`[excited]`, `[nervous]`, `[frustrated]`, `[tired]`, `[sad]`, `[angry]`, `[happy]`, `[scared]`, `[surprised]`, `[disgusted]`, `[confused]`

### Nuanced Emotions
`[sorrowful]`, `[awe]`, `[panicking]`, `[flustered]`, `[resigned]`, `[wistful]`, `[annoyed]`, `[curious]`, `[mischievously]`

### Tone Modifiers
`[cheerfully]`, `[flatly]`, `[deadpan]`, `[playfully]`, `[sarcastic]`, `[sarcastic tone]`, `[matter-of-fact]`

## Delivery Tags

### Volume/Manner
`[whispers]`, `[whispering]`, `[shouts]`, `[shouting]`, `[speaking softly]`, `[softly]`, `[loudly]`

### Style
`[casual]`, `[conversational]`, `[formal]`, `[intimate]`, `[dramatic]`, `[serious tone]`, `[lighthearted]`, `[reflective]`

### Narrative Voice
`[voice-over style]`, `[documentary style]`, `[cinematic tone]`, `[dramatic tone]`

## Pacing & Rhythm Tags

### Speed
`[rushed]`, `[slows down]`, `[deliberate]`, `[rapid-fire]`, `[fast-paced]`, `[measured]`

### Hesitation & Rhythm
`[stammers]`, `[drawn out]`, `[repeats]`, `[timidly]`, `[hesitates]`, `[hesitant]`

### Story Beats (Pauses)
`[pause]`, `[short pause]`, `[long pause]`, `[breathes]`, `[continues after a beat]`, `[continues softly]`

**Note**: These are narrative story beat tags, not precise timing controls. For more reliable pauses, use punctuation (see below).

## Non-Verbal Sounds

### Vocal Reactions
`[sighs]`, `[laughs]`, `[crying]`, `[gulps]`, `[clears throat]`, `[giggles]`, `[chuckles]`, `[soft chuckle]`, `[gasps]`, `[groans]`

### Actions
`[swallows]`, `[coughs]`, `[sniffs]`, `[yawns]`

## Character & Accent Tags

### Voice Types
`[childlike tone]`, `[deep voice]`, `[pirate voice]`, `[robotic]`, `[robotic tone]`

### Accents
`[French accent]`, `[strong French accent]`, `[British accent]`, `[Australian accent]`, `[Southern US accent]`, `[American accent]`, `[Russian accent]`, `[strong Russian accent]`

## Dialogue & Interaction Tags

### Turn-Taking
`[interrupting]`, `[overlapping]`, `[cuts in]`

### Context
`[as narrator]`, `[as character]`, `[aside]`

## Sound Effects

`[applause]`, `[gunshot]`, `[explosion]`, `[door creaks]`, `[footsteps]`, `[clapping]`

**Note**: Sound effect support varies by voice.

## Punctuation for Pauses (More Reliable Than Tags)

| Punctuation | Effect |
|-------------|--------|
| `...` (ellipsis) | Pause with trailing off, adds hesitation/sadness |
| `-` (dash) | Brief pause, most consistent |
| `--` (double dash) | Longer pause |
| `—` (em-dash) | Moderate pause |
| `-- --` (multiple) | Extended pause |
| `.` (period) | Natural sentence break |
| `,` (comma) | Brief breath pause |

## Layering Examples

```
[hesitant][nervous] I... I'm not sure this is going to work. [gulps] But let's try anyway.

[whispering][pause] Did you hear that?

[excited][fast-paced] Oh my god, you won't believe what just happened!

[sad][softly] I never thought it would end like this...
```

## Model-Specific Notes

### v3 Does NOT Support
- SSML break tags: `<break time="1.5s" />` (v2 only)
- Phoneme tags: `<phoneme alphabet="ipa">` (v2 only)

### v3 Best Practices
- Prompts > 250 characters produce more consistent results
- Voice selection is critical - base voice must support desired delivery
- Very short prompts cause unpredictable output
- Experiment with tag combinations for each voice
