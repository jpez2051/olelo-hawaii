const DAY_MS = 24 * 60 * 60 * 1000;
const MINUTE_MS = 60 * 1000;

export function freshReviewState() {
  return {
    reps: 0,
    lapses: 0,
    intervalDays: 0,
    ease: 2.5,
    dueAt: 0,
    lastReviewedAt: null,
    lastGrade: null,
    attempts: 0,
    correctCount: 0,
    almostCount: 0,
    incorrectCount: 0,
    consecutiveCorrect: 0
  };
}

export function isDue(state, now = Date.now()) {
  if (!state) return true;
  return !state.dueAt || state.dueAt <= now;
}

export function scheduleReview(previousState, grade, now = Date.now()) {
  const state = { ...freshReviewState(), ...(previousState || {}) };
  state.lastReviewedAt = new Date(now).toISOString();
  state.lastGrade = grade;
  state.attempts = (state.attempts || 0) + 1;

  if (grade === "correct") {
    state.correctCount = (state.correctCount || 0) + 1;
    state.consecutiveCorrect = (state.consecutiveCorrect || 0) + 1;
    state.reps += 1;
    if (state.reps === 1) state.intervalDays = 1;
    else if (state.reps === 2) state.intervalDays = 3;
    else state.intervalDays = Math.max(4, Math.round(state.intervalDays * state.ease));
    state.ease = Math.min(3.0, state.ease + 0.04);
    state.dueAt = now + state.intervalDays * DAY_MS;
    return state;
  }

  state.consecutiveCorrect = 0;

  if (grade === "almost") {
    state.almostCount = (state.almostCount || 0) + 1;
    state.ease = Math.max(1.5, state.ease - 0.15);
    state.reps = Math.max(0, state.reps - 1);
    state.intervalDays = 0.5;
    state.dueAt = now + 12 * 60 * MINUTE_MS;
    return state;
  }

  state.incorrectCount = (state.incorrectCount || 0) + 1;
  state.lapses += 1;
  state.reps = 0;
  state.ease = Math.max(1.4, state.ease - 0.2);
  state.intervalDays = 0;
  state.dueAt = now + 15 * MINUTE_MS;
  return state;
}

export function dueLabel(state, now = Date.now()) {
  if (!state || isDue(state, now)) return "due now";
  const diff = state.dueAt - now;
  const hours = Math.ceil(diff / (60 * 60 * 1000));
  if (hours < 24) return `in ${hours}h`;
  const days = Math.ceil(diff / DAY_MS);
  return `in ${days}d`;
}
