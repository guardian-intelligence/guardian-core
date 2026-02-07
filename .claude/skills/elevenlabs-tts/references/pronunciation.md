# Pronunciation Control

Control pronunciation using phoneme tags, alias tags, and pronunciation dictionaries.

## Table of Contents

1. [Phoneme Tags (SSML)](#phoneme-tags-ssml)
2. [Alias Tags](#alias-tags)
3. [Pronunciation Dictionaries](#pronunciation-dictionaries)
4. [Phonetic Spelling Tricks](#phonetic-spelling-tricks)

## Phoneme Tags (SSML)

Specify exact pronunciation using phonetic alphabets.

**Compatible models:** Eleven Flash v2, Eleven Turbo v2, Eleven English v1

**NOT compatible:** Eleven v3, Multilingual v2, Flash v2.5

### CMU Arpabet (Recommended)

More consistent and predictable results with AI models.

```xml
<phoneme alphabet="cmu-arpabet" ph="M AE1 D IH0 S AH0 N">Madison</phoneme>
```

### IPA (International Phonetic Alphabet)

```xml
<phoneme alphabet="ipa" ph="ˈæktʃuəli">actually</phoneme>
```

### Stress Marking

For multi-syllable words, correct stress marking is critical:

**Correct** (with stress markers):
```xml
<phoneme alphabet="cmu-arpabet" ph="P R AH0 N AH0 N S IY EY1 SH AH0 N">pronunciation</phoneme>
```

**Incorrect** (missing stress markers):
```xml
<phoneme alphabet="cmu-arpabet" ph="P R AH N AH N S IY EY SH AH N">pronunciation</phoneme>
```

### Multi-Word Names

Phoneme tags work for individual words only. For multi-word names, create separate tags:

```xml
<phoneme alphabet="cmu-arpabet" ph="JH AH0 N">John</phoneme>
<phoneme alphabet="cmu-arpabet" ph="S M IH1 TH">Smith</phoneme>
```

## Alias Tags

Replace words with phonetically clearer alternatives. Works with all models via pronunciation dictionaries.

### Basic Alias

```xml
<lexeme>
  <grapheme>Claughton</grapheme>
  <alias>Cloffton</alias>
</lexeme>
```

### Acronym Expansion

```xml
<lexeme>
  <grapheme>UN</grapheme>
  <alias>United Nations</alias>
</lexeme>
```

### Case Sensitivity

Searches are case-sensitive. "Apple" and "apple" are different matches.

## Pronunciation Dictionaries

Upload `.pls` (Pronunciation Lexicon Specification) or `.txt` files to Studio, Dubbing Studio, or Speech Synthesis API.

### PLS Format (CMU Arpabet)

```xml
<?xml version="1.0" encoding="UTF-8"?>
<lexicon version="1.0"
      xmlns="http://www.w3.org/2005/01/pronunciation-lexicon"
      xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"
      xsi:schemaLocation="http://www.w3.org/2005/01/pronunciation-lexicon
        http://www.w3.org/TR/2007/CR-pronunciation-lexicon-20071212/pls.xsd"
      alphabet="cmu-arpabet" xml:lang="en-GB">
  <lexeme>
    <grapheme>apple</grapheme>
    <phoneme>AE P AH L</phoneme>
  </lexeme>
  <lexeme>
    <grapheme>UN</grapheme>
    <alias>United Nations</alias>
  </lexeme>
</lexicon>
```

### PLS Format (IPA)

```xml
<?xml version="1.0" encoding="UTF-8"?>
<lexicon version="1.0"
      xmlns="http://www.w3.org/2005/01/pronunciation-lexicon"
      xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"
      xsi:schemaLocation="http://www.w3.org/2005/01/pronunciation-lexicon
        http://www.w3.org/TR/2007/CR-pronunciation-lexicon-20071212/pls.xsd"
      alphabet="ipa" xml:lang="en-GB">
  <lexeme>
    <grapheme>Apple</grapheme>
    <phoneme>ˈæpl̩</phoneme>
  </lexeme>
  <lexeme>
    <grapheme>UN</grapheme>
    <alias>United Nations</alias>
  </lexeme>
</lexicon>
```

### Dictionary Behavior

- Dictionaries are checked from start to end
- Only the first matching replacement is used
- Searches are case-sensitive

### Tools for Generating Dictionaries

- **Sequitur G2P** - Learns pronunciation rules from data
- **Phonetisaurus** - G2P system trained on CMUdict
- **eSpeak** - Speech synthesizer with phoneme generation
- **CMU Pronouncing Dictionary** - Pre-built English phonetic dictionary

## Phonetic Spelling Tricks

For models without phoneme support, use spelling tricks:

### Capitalization for Emphasis

```text
trapezIi → emphasizes the "ii"
```

### Dashes and Apostrophes

```text
pro-NOUN-see-ay-shun
```

### Single Quotes Around Letters

```text
'A'mazing → emphasizes the "A"
```

### Common Substitutions

| Original | Phonetic Alternative |
|----------|---------------------|
| often | offen |
| salmon | sammon |
| colonel | kernel |
| Worcestershire | Wooster-sheer |
