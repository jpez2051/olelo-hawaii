# Version 7.1.0 — 27 October 2026

Completes the content expansion on top of published 7.0.0. Existing lesson and activity IDs are preserved, including the transfer lesson. There are 352 activities across 11 lessons (133 in 7.0.0). Activities include repeated practice formats; this is not a claim of 352 unique sentences.

## Learning changes

- Added contextual study, gap filling, and typed model production across pronouns, noun phrases, questions, possession, action frames, and comprehension.
- Optional Sound guide uses the displayed study text, or appears after an answer. It does not expose a hidden recall answer. A separate, explicit model reveal counts as support.
- Recognition, supported recall, model production, typed interpretation, and correction retries have separate evidence records. A delayed success requires at least 24 hours since the previous attempt. Seen models persist across reloads; same-day study or help prevents independent-production credit.
- Corrected/supported answers do not extend an existing review interval or erase a miss. Historical review data remains available but is not retrospectively classified as independent evidence.
- Mixed review interleaves introduced skills in rounds of at most 12. Lessons resume at the current position and offer restart. Prerequisites are recommendations with links, not locks.
- Study meanings can fade automatically after independent recall, always remain visible, or start collapsed. The actual question is never hidden.
- Listening routines link to official sources and, for Kulāiwi, specific lessons and transcript passages. Learners record first listening, text comparison, and replay without text; later returns are separate. Skips record nothing.

## Source review

All lesson activities carry source references; `data/content-audit.json` inventories models and extracted forms. The 2024 Reference Grammar supplies modern grammatical examples and meanings. UH spelling guidance, Pukui–Elbert dictionary entries, Kīhei de Silva's teaching at Kamehameha Schools, Kaliko Trapp's pronunciation resources, and official UH Hilo place-name resources inform pronunciation support. Warner's UH-hosted Hawaiian Language Guidelines (printed pages 8–9) corroborate the existing Lani and verbal-marker examples when the original Maui teaching page is unavailable. Legacy font encodings are normalized to Unicode, without changing word forms. Judd does not authorize live content.

This is source checking, not a qualified educator's review. Typed checks accept the taught model; they do not evaluate all valid alternative expressions. Listening records are self-reported exposure, not measured audio comprehension or spoken-pronunciation scores. No synthetic Hawaiian voice, invented recording, or unlicensed audio redistribution is added.

## Validation

Run `node tests/regressions.mjs` for curriculum integrity, source metadata, cloze reconstruction, grading, evidence separation, and mixed review.

Run `node tests/browser.mjs` with Playwright installed (or `PLAYWRIGHT_MODULE` set to its module URL) and optionally `CHROME_PATH`. The browser test traverses every learning activity, checks a narrow mobile layout, answer concealment, and retry scheduling. The test-only local server adds inspection exports in memory; production files expose none.

Native pull-to-refresh CSS, visible versioning, and immutable source-commit deployment remain. The hosting release changes only `olelo-hawaii/index.html`; legacy `olelo.html` is not edited.
