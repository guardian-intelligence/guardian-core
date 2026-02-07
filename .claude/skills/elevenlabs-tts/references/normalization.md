# Text Normalization

Normalize complex text (phone numbers, currencies, dates) for proper TTS pronunciation.

## Table of Contents

1. [Common Issues](#common-issues)
2. [LLM Normalization Prompt](#llm-normalization-prompt)
3. [Python Script](#python-script)
4. [TypeScript Script](#typescript-script)

## Common Issues

Text that commonly mispronounces without normalization:

| Type | Example | Problem |
|------|---------|---------|
| Phone numbers | 123-456-7890 | May read as single number |
| Currencies | $47,345.67 | May read commas literally |
| Dates | 2024-01-01 | May read as math |
| Time | 9:23 AM | May mispronounce format |
| Addresses | 123 Main St | Abbreviations unclear |
| URLs | example.com/link | Slashes confusing |
| Units | 100 TB | Abbreviation not expanded |
| Shortcuts | Ctrl + Z | Symbols not spoken |

## LLM Normalization Prompt

Add this to your LLM prompt to automatically normalize text:

```text
Convert the output text into a format suitable for text-to-speech. Ensure that numbers, symbols, and abbreviations are expanded for clarity when read aloud. Expand all abbreviations to their full spoken forms.

Example input and output:

"$42.50" → "forty-two dollars and fifty cents"
"£1,001.32" → "one thousand and one pounds and thirty-two pence"
"1234" → "one thousand two hundred thirty-four"
"3.14" → "three point one four"
"555-555-5555" → "five five five, five five five, five five five five"
"2nd" → "second"
"XIV" → "fourteen" - unless it's a title, then it's "the fourteenth"
"3.5" → "three point five"
"⅔" → "two-thirds"
"Dr." → "Doctor"
"Ave." → "Avenue"
"St." → "Street" (but saints like "St. Patrick" should remain)
"Ctrl + Z" → "control z"
"100km" → "one hundred kilometers"
"100%" → "one hundred percent"
"elevenlabs.io/docs" → "eleven labs dot io slash docs"
"2024-01-01" → "January first, two-thousand twenty-four"
"123 Main St, Anytown, USA" → "one two three Main Street, Anytown, United States of America"
"14:30" → "two thirty PM"
"01/02/2023" → "January second, two-thousand twenty-three" or "the first of February, two-thousand twenty-three", depending on locale
```

## Python Script

Requires the `inflect` library: `pip install inflect`

```python
import inflect
import re

p = inflect.engine()

def normalize_text(text: str) -> str:
    # Convert monetary values
    def money_replacer(match):
        currency_map = {"$": "dollars", "£": "pounds", "€": "euros", "¥": "yen"}
        currency_symbol, num = match.groups()

        # Remove commas before parsing
        num_without_commas = num.replace(',', '')

        # Check for decimal points to handle cents
        if '.' in num_without_commas:
            dollars, cents = num_without_commas.split('.')
            dollars_in_words = p.number_to_words(int(dollars))
            cents_in_words = p.number_to_words(int(cents))
            return f"{dollars_in_words} {currency_map.get(currency_symbol, 'currency')} and {cents_in_words} cents"
        else:
            # Handle whole numbers
            num_in_words = p.number_to_words(int(num_without_commas))
            return f"{num_in_words} {currency_map.get(currency_symbol, 'currency')}"

    # Regex to handle commas and decimals
    text = re.sub(r"([$£€¥])(\d+(?:,\d{3})*(?:\.\d{2})?)", money_replacer, text)

    # Convert phone numbers
    def phone_replacer(match):
        return ", ".join(" ".join(p.number_to_words(int(digit)) for digit in group) for group in match.groups())

    text = re.sub(r"(\d{3})-(\d{3})-(\d{4})", phone_replacer, text)

    return text


# Example usage
print(normalize_text("$1,000"))        # "one thousand dollars"
print(normalize_text("£1000"))         # "one thousand pounds"
print(normalize_text("€1000"))         # "one thousand euros"
print(normalize_text("¥1000"))         # "one thousand yen"
print(normalize_text("$1,234.56"))     # "one thousand two hundred thirty-four dollars and fifty-six cents"
print(normalize_text("555-555-5555"))  # "five five five, five five five, five five five five"
```

## TypeScript Script

Requires the `number-to-words` library: `bun install number-to-words`

```typescript
import { toWords } from 'number-to-words';

function normalizeText(text: string): string {
  return (
    text
      // Convert monetary values
      .replace(/([$£€¥])(\d+(?:,\d{3})*(?:\.\d{2})?)/g, (_, currency, num) => {
        const numWithoutCommas = num.replace(/,/g, '');

        const currencyMap: { [key: string]: string } = {
          $: 'dollars',
          '£': 'pounds',
          '€': 'euros',
          '¥': 'yen',
        };

        if (numWithoutCommas.includes('.')) {
          const [dollars, cents] = numWithoutCommas.split('.');
          return `${toWords(Number.parseInt(dollars))} ${currencyMap[currency] || 'currency'}${cents ? ` and ${toWords(Number.parseInt(cents))} cents` : ''}`;
        }

        return `${toWords(Number.parseInt(numWithoutCommas))} ${currencyMap[currency] || 'currency'}`;
      })

      // Convert phone numbers
      .replace(/(\d{3})-(\d{3})-(\d{4})/g, (_, p1, p2, p3) => {
        return `${spellOutDigits(p1)}, ${spellOutDigits(p2)}, ${spellOutDigits(p3)}`;
      })
  );
}

function spellOutDigits(num: string): string {
  return num
    .split('')
    .map((digit) => toWords(Number.parseInt(digit)))
    .join(' ');
}


// Example usage
console.log(normalizeText('$1,000'));        // "one thousand dollars"
console.log(normalizeText('£1000'));         // "one thousand pounds"
console.log(normalizeText('€1000'));         // "one thousand euros"
console.log(normalizeText('¥1000'));         // "one thousand yen"
console.log(normalizeText('$1,234.56'));     // "one thousand two hundred thirty-four dollars and fifty-six cents"
console.log(normalizeText('555-555-5555'));  // "five five five, five five five, five five five five"
```

## Tips

- **Use larger models** (Multilingual v2) for better automatic normalization
- **Pre-process text** with regex or LLM before sending to TTS
- **Test common patterns** in your domain (phone formats, currency, etc.)
- Normalization is enabled by default in ElevenLabs TTS
