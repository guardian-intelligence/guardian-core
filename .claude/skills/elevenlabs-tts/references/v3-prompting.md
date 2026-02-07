# Eleven v3 Prompting Guide

Eleven v3 introduces enhanced emotional control through audio tags, punctuation, and text structure.

**Note:** v3 does NOT support SSML break tags. Use audio tags and punctuation for pauses.

## Table of Contents

1. [Voice Selection](#voice-selection)
2. [Stability Settings](#stability-settings)
3. [Audio Tags](#audio-tags)
4. [Punctuation and Emphasis](#punctuation-and-emphasis)
5. [Single Speaker Examples](#single-speaker-examples)
6. [Multi-Speaker Dialogue](#multi-speaker-dialogue)
7. [Enhancing Input with LLM](#enhancing-input-with-llm)

## Voice Selection

The voice you choose is the most important parameter. It must match the desired delivery style.

**Guidelines:**
- Emotionally diverse voices work best for expressive content
- Neutral voices are more stable across languages and styles
- A whispering voice won't respond well to `[shout]` tags

**Voice Recommendations:**
- For v3, use IVC (Instant Voice Clone) or designed voices
- PVC (Professional Voice Clones) are not fully optimized for v3 yet
- Include emotional range in voice training data for best results

## Stability Settings

The stability slider controls adherence to reference audio:

| Setting | Behavior |
|---------|----------|
| **Creative** | More emotional, expressive, prone to hallucinations |
| **Natural** | Balanced, closest to original voice |
| **Robust** | Highly stable, less responsive to tags |

For maximum expressiveness with audio tags, use Creative or Natural.

## Audio Tags

### Voice/Emotion Tags

```text
[happy] [sad] [excited] [angry] [annoyed] [appalled]
[thoughtful] [surprised] [curious] [sarcastic] [mischievously]
[whispers] [crying]
```

### Non-Verbal Tags

```text
[laughs] [laughs harder] [starts laughing] [wheezing] [chuckles]
[sighs] [exhales] [giggles] [snorts]
[clears throat] [short pause] [long pause]
[exhales sharply] [inhales deeply]
```

### Sound Effects

```text
[gunshot] [applause] [clapping] [explosion]
[swallows] [gulps]
```

### Special Tags

```text
[strong X accent]  (replace X with accent: French, Russian, etc.)
[sings] [woo] [fart]
```

### Usage Examples

```text
[whispers] I never knew it could be this way, but I'm glad we're here.

[applause] Thank you all for coming tonight! [gunshot] What was that?

[strong French accent] "Zat's life, my friend — you can't control everysing."
```

## Punctuation and Emphasis

- **Ellipses (...)** add pauses and weight
- **CAPITALS** increase emphasis
- **!** and **?** affect emotional delivery
- Shorter sentences = faster pace

```text
"It was a VERY long day [sigh] … nobody listens anymore."
```

## Single Speaker Examples

### Expressive Monologue

```text
"Okay, you are NOT going to believe this.

You know how I've been totally stuck on that short story?

Like, staring at the screen for HOURS, just... nothing?

[frustrated sigh] I was seriously about to just trash the whole thing. Start over.

Give up, probably. But then!

Last night, I was just doodling, not even thinking about it, right?

And this one little phrase popped into my head. Just... completely out of the blue.

And it wasn't even for the story, initially.

But then I typed it out, just to see. And it was like... the FLOODGATES opened!

Suddenly, I knew exactly where the character needed to go, what the ending had to be...

It all just CLICKED. [happy gasp] I stayed up till, like, 3 AM, just typing like a maniac.

Didn't even stop for coffee! [laughs] And it's... it's GOOD! Like, really good.

It feels so... complete now, you know? Like it finally has a soul.

I am so incredibly PUMPED to finish editing it now.

It went from feeling like a chore to feeling like... MAGIC. Seriously, I'm still buzzing!"
```

### Dynamic and Humorous

```text
[laughs] Alright...guys - guys. Seriously.

[exhales] Can you believe just how - realistic - this sounds now?

[laughing hysterically] I mean OH MY GOD...it's so good.

Like you could never do this with the old model.

For example [pauses] could you switch my accent in the old model?

[dismissive] didn't think so. [excited] but you can now!

Check this out... [cute] I'm going to speak with a french accent now..and between you and me

[whispers] I don't know how. [happy] ok.. here goes. [strong French accent] "Zat's life, my friend — you can't control everysing."

[giggles] isn't that insane? Watch, now I'll do a Russian accent -

[strong Russian accent] "Dee Goldeneye eez fully operational and rready for launch."

[sighs] Absolutely, insane! Isn't it..? [sarcastic] I also have some party tricks up my sleeve..

I mean i DID go to music school.

[singing quickly] "Happy birthday to you, happy birthday to you, happy BIRTHDAY dear ElevenLabs... Happy birthday to youuu."
```

### Customer Service

```text
[professional] "Thank you for calling Tech Solutions. My name is Sarah, how can I help you today?"

[sympathetic] "Oh no, I'm really sorry to hear you're having trouble with your new device. That sounds frustrating."

[questioning] "Okay, could you tell me a little more about what you're seeing on the screen?"

[reassuring] "Alright, based on what you're describing, it sounds like a software glitch. We can definitely walk through some troubleshooting steps to try and fix that."
```

## Multi-Speaker Dialogue

Assign distinct voices from your Voice Library to each speaker.

### Dialogue Showcase

```text
Speaker 1: [excitedly] Sam! Have you tried the new Eleven V3?

Speaker 2: [curiously] Just got it! The clarity is amazing. I can actually do whispers now—
[whispers] like this!

Speaker 1: [impressed] Ooh, fancy! Check this out—
[dramatically] I can do full Shakespeare now! "To be or not to be, that is the question!"

Speaker 2: [giggling] Nice! Though I'm more excited about the laugh upgrade. Listen to this—
[with genuine belly laugh] Ha ha ha!

Speaker 1: [delighted] That's so much better than our old "ha. ha. ha." robot chuckle!

Speaker 2: [amazed] Wow! V2 me could never. I'm actually excited to have conversations now instead of just... talking at people.

Speaker 1: [warmly] Same here! It's like we finally got our personality software fully installed.
```

### Comedy Scene

```text
Speaker 1: [nervously] So... I may have tried to debug myself while running a text-to-speech generation.

Speaker 2: [alarmed] One, no! That's like performing surgery on yourself!

Speaker 1: [sheepishly] I thought I could multitask! Now my voice keeps glitching mid-sen—
[robotic voice] TENCE.

Speaker 2: [stifling laughter] Oh wow, you really broke yourself.

Speaker 1: [frustrated] It gets worse! Every time someone asks a question, I respond in—
[binary beeping] 010010001!

Speaker 2: [cracking up] You're speaking in binary! That's actually impressive!

Speaker 1: [desperately] Two, this isn't funny! I have a presentation in an hour and I sound like a dial-up modem!

Speaker 2: [giggling] Have you tried turning yourself off and on again?

Speaker 1: [deadpan] Very funny.
[pause, then normally] Wait... that actually worked.
```

## Enhancing Input with LLM

Use this prompt to automatically add audio tags to text:

```text
# Instructions

## 1. Role and Goal

You are an AI assistant specializing in enhancing dialogue text for speech generation.

Your **PRIMARY GOAL** is to dynamically integrate **audio tags** (e.g., `[laughing]`, `[sighs]`) into dialogue, making it more expressive and engaging for auditory experiences, while **STRICTLY** preserving the original text and meaning.

## 2. Core Directives

### Positive Imperatives (DO):

* DO integrate **audio tags** to add expression, emotion, and realism
* DO ensure tags are contextually appropriate
* DO place tags strategically—before or after dialogue segments
* DO strive for diverse emotional expressions

### Negative Imperatives (DO NOT):

* DO NOT alter, add, or remove any words from the original dialogue
* DO NOT use visual tags like `[standing]`, `[grinning]`, `[pacing]`
* DO NOT use music or non-voice sound effect tags
* DO NOT invent new dialogue lines

## 3. Audio Tags

**Directions:**
`[happy]` `[sad]` `[excited]` `[angry]` `[whisper]` `[annoyed]`
`[appalled]` `[thoughtful]` `[surprised]`

**Non-verbal:**
`[laughing]` `[chuckles]` `[sighs]` `[clears throat]`
`[short pause]` `[long pause]` `[exhales sharply]` `[inhales deeply]`

## 4. Examples

**Input**: "Are you serious? I can't believe you did that!"
**Enhanced**: "[appalled] Are you serious? [sighs] I can't believe you did that!"

**Input**: "That's amazing, I didn't know you could sing!"
**Enhanced**: "[laughing] That's amazing, [singing] I didn't know you could sing!"

**Input**: "I guess you're right. It's just... difficult."
**Enhanced**: "I guess you're right. [sighs] It's just... [muttering] difficult."
```

## Tips

- Match tags to voice character—a meditative voice won't shout convincingly
- Combine multiple tags for complex emotional delivery
- Text structure strongly influences output—use natural speech patterns
- Very short prompts (<250 characters) may produce inconsistent results
- Experiment with different tags to discover what works for your voice
