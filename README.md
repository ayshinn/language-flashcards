# Language Flashcards

Mobile-friendly flashcard site for learning travel-useful Spanish (and eventually Korean).
Built as a static site — vanilla HTML/CSS/JS, no build step. Hosted on GitHub Pages at
`https://ayshinn.github.io/language-flashcards/`.

## Features

- **3 difficulty levels** per language (80 cards each, 240 total for Spanish).
- **Tap to flip** card (English → Spanish), with a 3D flip animation.
- **Swipe gestures**: left = next card, right = previous, up (post-flip) = mark known.
- **Text-to-speech** for the Spanish side, using the browser's Web Speech API with `es-MX` locale.
- **Progress persists** across sessions via `localStorage`, scoped per deck.
- **Shuffle remaining** at end of deck to re-quiz only the cards you didn't know.
- Mobile-first responsive layout with a classic flashcard aesthetic.

## Run locally

Any static file server works. Easiest:

```bash
python3 -m http.server 8000
# then open http://localhost:8000
```

## Deploy

Repo settings → Pages → Source: `main` branch, `/ (root)`. Site lives at
`https://ayshinn.github.io/language-flashcards/`. The `.nojekyll` file disables
Jekyll processing so nothing is rewritten.

## Adding cards

Edit `data/spanish.json`. Each entry:

```json
{ "id": "es-001", "en": "Hello", "es": "Hola", "level": 1, "topic": "greetings" }
```

`id` must be stable — it's the key used for tracking memorized state in `localStorage`.
