# ʻŌlelo Hawaiʻi

A personal Hawaiian-language learning app focused on **real comprehension and production**, not streaks, XP, or gamified translation drills.

## Learning philosophy

The app is being built around a repeating cycle:

**Hear → understand → notice the pattern → build it → say it → write it → review it later.**

Flashcards remain useful, but vocabulary is only one part of the system. The long-term goal is to train:

- Hawaiian orthography: ʻokina and kahakō
- pronunciation and listening
- sentence patterns / pepeke
- vocabulary in context
- reading comprehension
- written production
- spoken production
- spaced review based on actual weak points

English is used as scaffolding. Spanish comparisons may be used selectively when they make a Hawaiian concept clearer, but the goal is to reduce translation dependence over time.

## Project status

This repository is the clean successor to the original single-file `olelo.html` prototype in `jpez2051.github.io`. The original file remains untouched.

The first milestone establishes:

1. a modular project structure,
2. strict Hawaiian orthography-aware grading,
3. local progress persistence,
4. a lesson/curriculum data model,
5. a simple spaced-review model,
6. a foundation lesson on ʻokina and kahakō.

## Structure

```text
olelo-hawaii/
├── index.html
├── css/
│   └── app.css
├── js/
│   ├── app.js
│   ├── grading.js
│   ├── srs.js
│   └── storage.js
├── data/
│   ├── curriculum.json
│   └── lessons/
│       └── 01-orthography.json
└── docs/
    ├── curriculum.md
    └── content-sources.md
```

## Content standards

Hawaiian content should be checked against authoritative or expert-reviewed sources before being treated as production curriculum. See `docs/content-sources.md`.

The app uses the Unicode ʻokina **U+02BB** and Unicode vowels with kahakō. Missing or misplaced Hawaiian orthography is intentionally not treated as fully correct.

## Run locally

Because curriculum is loaded from JSON, serve the directory with a small local web server rather than opening `index.html` directly from the filesystem.

For example:

```bash
python -m http.server 8000
```

Then open `http://localhost:8000`.

## Deployment

The project is designed to work as a static site and can be deployed with GitHub Pages once Pages is enabled for this repository.
