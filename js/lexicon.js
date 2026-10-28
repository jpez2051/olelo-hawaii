// Selected senses checked against Pukui–Elbert (1986), via UH Hilo,
// 2026-10-28. These lexical checks do not certify whole sentences.
export const lexicon = [
  ['hale', 'house; building', 'Sense 1. The appropriate English word depends on the kind of building.'],
  ['kula', 'school', 'Sense 4 in school contexts. Other senses include a plain or field; do not assume every occurrence means school.'],
  ['kumu', 'teacher; tutor', 'Sense 2 in teacher contexts. Other senses include foundation, source, and reason. Keep kumu distinct from kūmū.'],
  ['hele', 'go; come; walk', 'Sense 1. Directional words and context affect the translation.'],
  ['hana', 'do; make; work', 'Sense 1. This broad word needs context; work is not always the appropriate translation.'],
  ['holoi', 'wash; clean; wipe', 'Use the object and context to choose the meaning.'],
  ['keiki', 'child; offspring', 'Sense 1. Do not automatically translate this word as boy.']
].map(([word, meaning, note]) => ({word, meaning, note, url: `https://wehe.hilo.hawaii.edu/?q=${encodeURIComponent(word)}`}));

export function matchingEntries(text) {
  const words = new Set((text.normalize('NFC').toLowerCase().match(/[a-zāēīōūʻ]+/g) || []));
  return lexicon.filter(entry => words.has(entry.word));
}
