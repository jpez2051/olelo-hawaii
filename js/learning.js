const DAY = 86400000;

export function evidenceKind(activity) {
  if (activity.scored === false || ['guided-listening', 'sentence-study', 'foundation-study'].includes(activity.type)) return 'exposure';
  if (activity.evidenceKind) return activity.evidenceKind;
  if (activity.type === 'sentence-choice') return 'recognition';
  if (activity.type === 'study-hide-recall' || activity.type === 'repair-spelling') return 'supported';
  return activity.answerLanguage === 'en' ? 'interpretation' : 'production';
}

// Only a later, unaided attempt can be delayed evidence. Same-day repetitions,
// answer reveals and correction retries never establish durable production.
export function recordEvidence(previous, activity, status, { now = Date.now(), helped = false, retry = false } = {}) {
  const state = structuredClone(previous || { counts: {}, successes: {}, delayed: {}, errors: {} });
  const kind = retry ? 'retry' : helped ? 'supported' : evidenceKind(activity);
  state.counts[kind] = (state.counts[kind] || 0) + 1;
  if (status === 'correct') {
    state.successes[kind] = (state.successes[kind] || 0) + 1;
    if (!helped && !retry && state.lastAttemptAt && now - state.lastAttemptAt >= DAY) {
      state.delayed[kind] = (state.delayed[kind] || 0) + 1;
    }
  } else {
    const error = status === 'almost' ? 'orthography' : activity.errorCategory || activity.skill || 'meaning';
    state.errors[error] = (state.errors[error] || 0) + 1;
    state.lastError = error;
  }
  state.lastAttemptAt = now;
  return state;
}

export function evidenceTotals(evidence = {}) {
  const totals = { recognition: 0, supported: 0, production: 0, interpretation: 0, delayedProduction: 0, retry: 0 };
  for (const state of Object.values(evidence)) {
    for (const key of ['recognition', 'supported', 'production', 'interpretation', 'retry']) totals[key] += state.successes?.[key] || 0;
    totals.delayedProduction += state.delayed?.production || 0;
  }
  return totals;
}

export function mixedQueue(items, limit = 12) {
  const groups = new Map();
  for (const item of items) {
    const key = item.skill || item.lessonId;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(item);
  }
  const result = [];
  while (result.length < limit && [...groups.values()].some(group => group.length)) {
    for (const group of groups.values()) {
      if (group.length && result.length < limit) result.push(group.shift());
    }
  }
  return result;
}

export function diagnose(given, activity, result) {
  if (result.status === 'correct') return '';
  if (result.status === 'almost') return 'The base letters match. Check vowel length and glottal stops before changing the word.';
  const pairs = [['kāua','māua'], ['kākou','mākou'], ['ʻolua','ʻoukou'], ['lāua','lākou'], ['āhea','ināhea'], ['koʻu','kaʻu'], ['kou','kāu'], ['kona','kāna']];
  const input = given.normalize('NFC').toLowerCase().replace(/[’‘']/g, 'ʻ');
  const answer = (activity.answer || '').toLowerCase();
  for (const pair of pairs) {
    if (pair.some((word, i) => input.split(/\s+/).includes(word) && answer.split(/\s+/).includes(pair[1-i]))) {
      return `Compare ${pair.join(' / ')}: ${pair[0].startsWith('kā') && pair[1].startsWith('mā') ? 'does the group include the listener?' : pair[0] === 'āhea' ? 'is the question about past or future time?' : pair[0].startsWith('ko') ? 'which relationship class does this context require?' : 'how many people does the form refer to?'}`;
    }
  }
  return activity.diagnosis || 'Compare your answer with the model and the explanation. This check accepts the taught form; it does not judge every possible Hawaiian phrasing.';
}
