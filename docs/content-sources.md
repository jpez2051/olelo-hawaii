# Content sources and review standard

This project is intended to teach Hawaiian carefully. Generated language content should **not** automatically become curriculum.

## Primary reference sources

### University of Hawaiʻi — Hawaiian language considerations
https://www.hawaii.edu/offices/communications/standards/hawaiian-language-considerations/

Use for orthography and digital-display standards, especially the Unicode ʻokina and vowels with kahakō.

### Nā Puke Wehewehe ʻŌlelo Hawaiʻi / Wehewehe Wikiwiki
https://wehe.hilo.hawaii.edu/

Use as a primary dictionary reference. It includes Pukui-Elbert and other referenced Hawaiian-language dictionaries and resources.

### Ka Haka ʻUla O Keʻelikōlani — College of Hawaiian Language, UH Hilo
https://www.olelo.hawaii.edu/

Use for Hawaiian-language educational resources, technology/Unicode guidance, and materials produced within UH Hilo's Hawaiian-language program.

### ʻŌlelo Online
https://oleloonline.com/

Useful for observing a structured second-language learning progression and practice types. Do not copy copyrighted lesson text or exercises into this project.

## Content review labels

Every lesson should eventually carry a `contentStatus` field:

- `draft` — structure or content not yet checked closely
- `starter-vetted` — simple material checked against reliable references, suitable for internal use
- `expert-reviewed` — reviewed by a qualified Hawaiian-language speaker/educator

## Rules for adding Hawaiian content

1. Preserve correct ʻokina and kahakō.
2. Use the Unicode ʻokina U+02BB (`ʻ`), not a straight apostrophe.
3. Do not invent translations simply to make an exercise fit the UI.
4. Prefer sentences and patterns that can be traced to reliable instructional or dictionary sources.
5. Store the source or review note with non-trivial lesson content.
6. Distinguish literal/gloss explanations from natural English translations.
7. Do not assume English grammatical categories map cleanly onto Hawaiian.
8. Audio should identify the speaker/source and usage rights before being bundled with the app.

## Product principle

The app should become more Hawaiian-forward as the learner advances. English and optional Spanish comparisons are scaffolding and should gradually recede rather than becoming permanent translation crutches.
