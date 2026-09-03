const STORAGE_KEY = "olelo-hawaii-progress-v1";

function emptyProgress() {
  return {
    reviews: {},
    exposures: {},
    totals: { correct: 0, almost: 0, incorrect: 0 }
  };
}

export function loadProgress() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return emptyProgress();
    const parsed = JSON.parse(raw);
    return {
      reviews: parsed.reviews || {},
      exposures: parsed.exposures || {},
      totals: {
        correct: Number(parsed.totals?.correct) || 0,
        almost: Number(parsed.totals?.almost) || 0,
        incorrect: Number(parsed.totals?.incorrect) || 0
      }
    };
  } catch {
    return emptyProgress();
  }
}

export function saveProgress(progress) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(progress));
}

export function clearProgress() {
  localStorage.removeItem(STORAGE_KEY);
}

export function exportProgress(progress) {
  const payload = {
    schemaVersion: 2,
    exportedAt: new Date().toISOString(),
    progress
  };
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = `olelo-hawaii-progress-${new Date().toISOString().slice(0, 10)}.json`;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}
