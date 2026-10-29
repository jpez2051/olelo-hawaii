import { matchingEntries } from './lexicon.js?v=7.3.0';
import { gradeAnswer } from "./grading.js?v=7.3.0";
import { evidenceKind, recordEvidence, evidenceTotals, mixedQueue, diagnose } from "./learning.js?v=7.3.0";
import { dueLabel, freshReviewState, isDue, scheduleReview } from "./srs.js?v=7.3.0";
import { clearProgress, exportProgress, loadProgress, saveProgress } from "./storage.js?v=7.3.0";

const $ = (selector) => document.querySelector(selector);
const $$ = (selector) => [...document.querySelectorAll(selector)];
const PLAYABLE_CONTENT_STATUSES = new Set(["source-checked", "expert-reviewed"]);

let curriculum = null;
let progress = loadProgress();
let activities = [];
let practiceQueue = [];
let currentActivity = null;
let answerLocked = false;
let activityStage = "answer";
let selectedChoice = "";
let usedHelp = false;
let lessonSession = null;
let roundAttempts = 0;
let roundCorrect = 0;
const modelKey = activity => (activity.model || activity.sentence || activity.studyWord || (activity.answerLanguage === 'haw' ? activity.answer : '') || '').normalize('NFC').toLowerCase().replace(/[.,!?]/g, '').trim();
function markModelSeen(activity) {
  const key = modelKey(activity);
  if (!key) return;
  progress.recentModels[key] = Date.now();
  saveProgress(progress);
}


function shuffle(items) {
  const copy = items.slice();
  for (let i = copy.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}

function isScoredActivity(activity) {
  return activity?.scored !== false && !["guided-listening", "sentence-study", "foundation-study"].includes(activity?.type);
}

function switchView(name) {
  $$(".nav-btn").forEach(btn => btn.classList.toggle("active", btn.dataset.view === name));
  $$(".view").forEach(view => view.classList.toggle("active", view.id === `view-${name}`));
  if (name === "progress") renderProgress();
  if (name === "learn" && curriculum) renderCurriculum();
  if (name === "immerse") renderImmersionLibrary();
}

function scrollPracticeToTop(behavior = "smooth") {
  requestAnimationFrame(() => {
    const target = $("#view-practice");
    if (!target || !target.classList.contains("active")) return;
    const top = Math.max(0, target.getBoundingClientRect().top + window.scrollY - 8);
    window.scrollTo({ top, behavior });
  });
}

function settleAfterKeyboard() {
  const input = $("#answer-input");
  input.blur();
  const run = () => scrollPracticeToTop("smooth");
  if (window.visualViewport) {
    const baseline = window.visualViewport.height;
    const onResize = () => {
      if (window.visualViewport.height > baseline + 40) {
        window.visualViewport.removeEventListener("resize", onResize);
        setTimeout(run, 80);
      }
    };
    window.visualViewport.addEventListener("resize", onResize);
    setTimeout(() => {
      window.visualViewport.removeEventListener("resize", onResize);
      run();
    }, 450);
  } else {
    setTimeout(run, 220);
  }
}

async function loadJson(path) {
  const response = await fetch(path, { cache: "no-store" });
  if (!response.ok) throw new Error(`Could not load ${path}`);
  return response.json();
}

async function loadCurriculum() {
  curriculum = await loadJson("./data/curriculum.json");
  activities = [];
  for (const unit of curriculum.units) {
    for (const lessonSummary of unit.lessons || []) {
      if (lessonSummary.status !== "active" || !lessonSummary.path) continue;
      const lesson = await loadJson(lessonSummary.path);
      lessonSummary.contentStatus = lesson.contentStatus || "draft";
      lessonSummary.playable = PLAYABLE_CONTENT_STATUSES.has(lessonSummary.contentStatus);
      lessonSummary.unitMode = unit.mode || "learn";
      if (!lessonSummary.playable) continue;
      lesson.activities.forEach(activity => {
        activities.push({
          ...activity,
          lessonId: lesson.id,
          lessonTitle: lesson.title,
          unitMode: unit.mode || "learn",
          focus: lesson.focus || [],
          skill: activity.skill || (activity.type === "guided-listening" ? "listening" : activity.type === "sentence-study" ? "sentence-patterns" : "spelling")
        });
      });
    }
  }
}

function escapeHtml(value = "") {
  const el = document.createElement("span");
  el.textContent = value;
  return el.innerHTML;
}

function renderStages() {
  const list = $("#stage-list");
  const activeStages = new Set((curriculum.units || []).filter(unit => unit.status !== "planned" && (unit.lessons || []).some(lesson => lesson.status === "active")).map(unit => unit.stage));
  list.innerHTML = (curriculum.stages || []).map((stage, index) => `
    <div class="stage-card ${activeStages.has(stage.id) ? "available" : "planned"}">
      <span class="stage-number">${index + 1}</span>
      <div><strong>${escapeHtml(stage.title)}</strong><span>${escapeHtml(stage.description)}</span></div>
    </div>`).join("");
}

function renderCurriculum() {
  renderStages();
  $('#vocabulary-families').innerHTML = (curriculum.vocabularyFamilies || []).map(family => `<div class="family-card"><strong>${escapeHtml(family.title)}</strong><p lang="haw">${escapeHtml(family.words)}</p><p>${escapeHtml(family.note)}</p><button type="button" class="text-btn" data-family-lesson="${escapeHtml(family.lessonId)}">Explore in context</button></div>`).join('');
  const list = $("#unit-list");
  list.innerHTML = "";
  curriculum.units
    .filter(unit => unit.mode !== "immersion")
    .slice()
    .sort((a, b) => (a.order || 0) - (b.order || 0))
    .forEach(unit => {
      const card = document.createElement("article");
      card.className = "unit-card";
      const planned = unit.status === "planned" || !(unit.lessons || []).length;
      const outcomes = (unit.outcomes || []).map(item => `<li>${escapeHtml(item)}</li>`).join("");
      card.innerHTML = `
        <div class="unit-top">
          <div>
            <p class="section-kicker">Stage ${escapeHtml(String(unit.order || ""))}</p>
            <h3>${escapeHtml(unit.title)}</h3>
            <p>${escapeHtml(unit.description)}</p>
          </div>
          <span class="tag">${planned ? "planned" : "active"}</span>
        </div>
        ${outcomes ? `<details><summary>What this stage builds</summary><ul>${outcomes}</ul></details>` : ""}
        <div class="lesson-list"></div>`;

      const lessonList = card.querySelector(".lesson-list");
      if (unit.lessons?.length) {
        unit.lessons.forEach(lesson => {
          const row = document.createElement("div");
          row.className = "lesson-row";
          row.innerHTML = `<div><strong>${escapeHtml(lesson.title)}</strong><small>${escapeHtml(lesson.summary || "")}</small></div>`;
          if (lesson.status === "active" && lesson.playable) {
            const button = document.createElement("button");
            button.className = "primary-btn";
            button.textContent = "Start lesson";
            button.addEventListener("click", () => startLesson(lesson.id));
            row.appendChild(button);
            const prerequisites = (lesson.prerequisites || []).map(id => curriculum.units.flatMap(u => u.lessons || []).find(l => l.id === id)).filter(Boolean);
            if (prerequisites.length) {
              const note = document.createElement('small');
              note.className = 'prerequisites';
              note.textContent = 'Builds on: ';
              prerequisites.forEach((prior, index) => {
                const link = document.createElement('button');
                link.className = 'text-btn'; link.textContent = prior.title;
                link.addEventListener('click', () => startLesson(prior.id));
                note.append(link, index < prerequisites.length - 1 ? ' · ' : '');
              });
              row.firstElementChild.appendChild(note);
            }
            const total = activities.filter(a => a.lessonId === lesson.id).length;
            const done = activities.filter(a => a.lessonId === lesson.id && (progress.reviews[a.id] || progress.exposures[a.id])).length;
            const count = document.createElement('small'); count.textContent = `${done} of ${total} activities explored`;
            row.firstElementChild.appendChild(count);
            if (progress.lessonPositions?.[lesson.id]) {
              button.textContent = 'Continue lesson';
              const restart = document.createElement('button'); restart.className = 'text-btn'; restart.textContent = 'Start again';
              restart.addEventListener('click', () => startLesson(lesson.id, true)); row.appendChild(restart);
            }
          } else if (lesson.status === "active" && lesson.playable === false) {
            const tag = document.createElement("span");
            tag.className = "tag";
            tag.textContent = "content check";
            row.appendChild(tag);
          }
          lessonList.appendChild(row);
        });
      } else {
        const row = document.createElement("div");
        row.className = "lesson-row";
        row.innerHTML = "<div><strong>Coming next</strong><small>New Hawaiian-language content is added only after it has been checked against trusted sources.</small></div>";
        lessonList.appendChild(row);
      }
      list.appendChild(card);
    });

  $("#curriculum-status").textContent = `${activities.filter(activity => activity.unitMode !== "immersion").length} learning activities loaded.`;
  updateDueCount();
}

function recordExposure(activity, key = activity.id) {
  markModelSeen(activity);
  const previous = progress.exposures?.[key] || {};
  progress.exposures = progress.exposures || {};
  progress.exposures[key] = {
    count: (Number(previous.count) || 0) + 1,
    lastCompletedAt: new Date().toISOString(),
    skill: activity.skill || "exposure"
  };
  saveProgress(progress);
}

function renderImmersionLibrary() {
  const list = $("#immersion-list");
  const listening = activities.filter(activity => activity.type === "guided-listening");
  if (!listening.length) {
    list.innerHTML = '<div class="panel"><p>No immersion audio is available yet.</p></div>';
    return;
  }

  list.innerHTML = "";
  listening.forEach(activity => {
    const card = document.createElement("article");
    card.className = "immersion-card";
    const refs = activity.episodeRefs ? `<div class="episode-ref">On the UH Hilo page: <strong>${escapeHtml(activity.episodeRefs)}</strong></div>` : "";
    const notes = (activity.listeningNotes || []).map(note => `<li>${escapeHtml(note)}</li>`).join("");
    const bridge = activity.learningBridge ? `<div class="learning-bridge"><strong>Connect this to what you know</strong><span>${escapeHtml(activity.learningBridge)}</span></div>` : "";
    card.innerHTML = `
      <div class="immersion-card-head">
        <div>
          <p class="section-kicker">Trusted source</p>
          <h3>${escapeHtml(activity.prompt || activity.lessonTitle)}</h3>
          <p>${escapeHtml(activity.audioSourceName || "")}${activity.audioSpeaker ? ` · ${escapeHtml(activity.audioSpeaker)}` : ""}</p>
        </div>
        <span class="tag">${escapeHtml(activity.resourceType || "immersion")}</span>
      </div>
      ${activity.collectionSize ? `<div class="collection-size">${escapeHtml(activity.collectionSize)}</div>` : ""}
      <p>${escapeHtml(activity.support || "Listen freely and replay as often as you like.")}</p>
      ${refs}
      ${notes ? `<ul class="immersion-focus-list">${notes}</ul>` : ""}
      ${bridge}
      <div class="immersion-actions">
        <a class="primary-link" href="${escapeHtml(activity.sourcePageUrl || "#")}" target="_blank" rel="noopener noreferrer">${escapeHtml(activity.openLabel || "Open source")}</a>
        <button class="secondary-btn log-listen-btn" type="button">Start listening routine</button>
      </div>
      <p class="exposure-note">${escapeHtml(activity.sourceNote || "Open the trusted source in your browser for playback. Listening never changes your mastery score.")}</p>`;
    const button = card.querySelector(".log-listen-btn");
    button.addEventListener("click", () => {
      lessonSession = null;
      roundAttempts = 0; roundCorrect = 0;
      practiceQueue = [activity];
      switchView('practice');
      showNextActivity(false);
      scrollPracticeToTop();
    });
    list.appendChild(card);
  });
}
function reviewStateFor(activityId) {
  return progress.reviews[activityId] || freshReviewState();
}

function dueActivities() {
  return activities.filter(activity => isScoredActivity(activity) && progress.reviews[activity.id] && isDue(reviewStateFor(activity.id)));
}

function updateDueCount() {
  const count = dueActivities().length;
  $("#practice-count").textContent = `${count} due`;
  $("#start-due-btn").textContent = count ? `Practice ${count} due` : "Review a lesson";
}

function needsMorePractice(state) {
  if (!state) return false;
  const misses = (state.almostCount || 0) + (state.incorrectCount || state.lapses || 0);
  if (state.lastGrade === "incorrect" || state.lastGrade === "almost") return true;
  return misses > 0 && (state.consecutiveCorrect || 0) < 2;
}

function practiceReason(group) {
  const states = group.states;
  if (group.skill === "sentence-patterns") {
    if (states.some(state => state.lastGrade === "incorrect")) return "Sentence pattern needs another look";
    return "Keep reviewing this sentence pattern";
  }
  if (group.skill === "pronouns") {
    if (states.some(state => state.lastGrade === "incorrect")) return "Participant or inclusion meaning needs review";
    return "Keep checking who is included";
  }
  if (group.skill === "comprehension") {
    if (states.some(state => state.lastGrade === "incorrect")) return "Whole-sentence meaning needs another look";
    return "Keep rebuilding the sentence context";
  }
  if (group.skill === "noun-phrases") {
    if (states.some(state => state.lastGrade === "incorrect")) return "Number or noun-phrase meaning needs review";
    return "Keep tracking singular and plural noun phrases";
  }
  if (group.skill === "questions") {
    if (states.some(state => state.lastGrade === "incorrect")) return "Question meaning or expected answer type needs review";
    return "Keep tracking what information the question requests";
  }
  if (group.skill === "possessives") {
    if (states.some(state => state.lastGrade === "incorrect")) return "Possessor or relationship meaning needs review";
    return "Keep tracking whose relationship is being described";
  }
  if (states.some(state => state.lastGrade === "incorrect")) return "Missed on the last try";
  if (states.some(state => state.lastGrade === "almost")) return "Spelling was close on the last try";
  return "Improving — keep reviewing until it sticks";
}

function representativeActivity(groupActivities) {
  const strength = { "sentence-recall": 6, "meaning-recall": 5, "sentence-choice": 4, "repair-spelling": 2, "study-hide-recall": 1 };
  return groupActivities.slice().sort((a, b) => (strength[b.type] || 0) - (strength[a.type] || 0))[0];
}

function needsPracticeGroups() {
  const groups = new Map();
  activities.filter(isScoredActivity).forEach(activity => {
    const state = progress.reviews[activity.id];
    if (!needsMorePractice(state)) return;
    const normalizedAnswer = (activity.answer || activity.id).normalize("NFC").toLocaleLowerCase();
    const key = activity.skill === "spelling" ? normalizedAnswer : activity.id;
    const label = activity.skill === "spelling" ? activity.answer : (activity.prompt || activity.answer || activity.id);
    if (!groups.has(key)) groups.set(key, { answer: activity.answer, label, skill: activity.skill || "spelling", activities: [], states: [] });
    const group = groups.get(key);
    group.activities.push(activity);
    group.states.push(state);
  });

  return [...groups.values()].map(group => ({
    ...group,
    reason: practiceReason(group),
    representative: representativeActivity(group.activities),
    due: group.states.some(state => isDue(state)),
    nextReview: group.states.reduce((earliest, state) => {
      if (!state?.dueAt) return earliest;
      return !earliest || state.dueAt < earliest.dueAt ? state : earliest;
    }, null)
  }));
}

function startLesson(lessonId, restart = false) {
  const lessonActivities = activities.filter(activity => activity.lessonId === lessonId);
  const offset = restart ? 0 : (progress.lessonPositions?.[lessonId] || 0);
  lessonSession = { id: lessonId, total: lessonActivities.length, position: offset };
  const remaining = lessonActivities.slice(offset);
  let end = Math.min(12, remaining.length);
  // Prefer stopping before a new study model, keeping its follow-up with it.
  for (let i = 8; i < end; i++) if (['sentence-study','foundation-study','study-hide-recall'].includes(remaining[i].type)) { end = i; break; }
  practiceQueue = remaining.slice(0, end);
  roundAttempts = 0; roundCorrect = 0;
  const lesson = curriculum.units.flatMap(u => u.lessons || []).find(l => l.id === lessonId);
  $('#lesson-purpose').textContent = lesson?.summary || 'Practice this lesson in manageable steps.';
  $('#lesson-purpose').hidden = false;
  switchView("practice");
  showNextActivity(false);
  scrollPracticeToTop("smooth");
}

function startDuePractice() {
  let due = dueActivities();
  lessonSession = null;
  roundAttempts = 0; roundCorrect = 0;
  $('#lesson-purpose').hidden = true;
  if (!due.length) due = activities.filter(a => isScoredActivity(a) && progress.reviews[a.id]);
  practiceQueue = mixedQueue(shuffle(due).sort((a,b) => (progress.reviews[a.id]?.dueAt || 0) - (progress.reviews[b.id]?.dueAt || 0)));
  switchView("practice");
  showNextActivity(false);
  scrollPracticeToTop("smooth");
}

function startNeedsPractice() {
  const weak = needsPracticeGroups().map(group => group.representative).filter(Boolean);
  if (!weak.length) return;
  lessonSession = null;
  roundAttempts = 0; roundCorrect = 0;
  $('#lesson-purpose').hidden = true;
  practiceQueue = mixedQueue(shuffle(weak));
  switchView("practice");
  showNextActivity(false);
  scrollPracticeToTop("smooth");
}

function resetPracticeUi() {
  const input = $("#answer-input");
  const audio = $("#listening-audio");
  input.value = "";
  input.disabled = false;
  input.readOnly = true;
  input.hidden = false;
  input.blur();
  $(".hawaiian-keyboard").hidden = false;
  $(".answer-label").hidden = false;
  $("#study-panel").hidden = true;
  $("#paper-panel").hidden = true;
  $("#listening-panel").hidden = true;
  $("#sentence-panel").hidden = true;
  $("#choice-panel").hidden = true;
  $("#choice-options").innerHTML = "";
  $("#choice-check-btn").disabled = true;
  $("#choice-check-btn").hidden = false;
  $("#choice-next-btn").hidden = true;
  selectedChoice = "";
  $("#answer-area").hidden = false;
  $("#check-btn").hidden = false;
  $("#next-btn").hidden = true;
  $("#listening-continue-btn").disabled = true;
  $("#feedback").hidden = true;
  $("#feedback").className = "feedback";
  $("#feedback").innerHTML = "";
  $("#retry-actions").hidden = true;
  $("#sound-guide").hidden = true;
  $("#word-meanings").hidden = true;
  $("#model-help").hidden = true;
  $("#source-details").open = false;
  audio.pause();
  audio.removeAttribute("src");
  audio.load();
}

function showNextActivity(returnToTop = true) {
  if (currentActivity && lessonSession && returnToTop) {
    lessonSession.position += 1;
    progress.lessonPositions[lessonSession.id] = lessonSession.position >= lessonSession.total ? 0 : lessonSession.position;
    saveProgress(progress);
  }
  currentActivity = practiceQueue.shift() || null;
  usedHelp = !!currentActivity && Date.now() - (progress.recentModels[modelKey(currentActivity)] || 0) < 86400000;
  answerLocked = false;
  resetPracticeUi();

  if (!currentActivity) {
    $("#practice-content").hidden = true;
    $("#practice-empty").hidden = false;
    $("#round-actions").hidden = false;
    const more = lessonSession && lessonSession.position < lessonSession.total;
    $('#round-continue-btn').hidden = !more;
    const recap = roundAttempts ? `${roundCorrect} of ${roundAttempts} checks correct in this round (including supported attempts and retries).` : 'This round introduced material; it did not measure independent recall.';
    $("#practice-empty").textContent = `${more ? 'Section complete. Your place is saved. Continue now or take a break.' : 'Round complete. Choose another lesson or revisit introduced material.'} ${recap} Completion is not a mastery score.`;
    updateDueCount();
    if (returnToTop) scrollPracticeToTop();
    return;
  }

  $("#practice-empty").hidden = true;
  $("#round-actions").hidden = true;
  $("#practice-content").hidden = false;
  const activityLabels = {
    "repair-spelling": "spelling repair",
    "study-hide-recall": "study then recall",
    "meaning-recall": "meaning recall",
    "sentence-study": "sentence study",
    "sentence-choice": "sentence check",
    "sentence-recall": "sentence recall",
    "guided-listening": "listening",
    "foundation-study": "pronunciation study"
  };
  $("#activity-type").textContent = activityLabels[currentActivity.type] || currentActivity.type.replaceAll("-", " ");
  $("#activity-focus").textContent = currentActivity.transfer ? 'Mixed practice' : currentActivity.focus.join(" • ");
  $("#session-position").textContent = lessonSession ? `Activity ${lessonSession.position + 1} of ${lessonSession.total} · You can leave and continue later` : `${practiceQueue.length + 1} remaining in this round`;
  $("#instruction").textContent = currentActivity.instruction || "Continue the activity.";
  $("#prompt").textContent = currentActivity.prompt || "";
  $("#support").textContent = currentActivity.support || "";

  if (currentActivity.type === "sentence-choice") {
    activityStage = "choice";
    $("#answer-area").hidden = true;
    $("#choice-panel").hidden = false;
    $("#choice-check-btn").disabled = true;
    $("#choice-check-btn").hidden = false;
    $("#choice-next-btn").hidden = true;
    selectedChoice = "";
    $("#choice-options").innerHTML = (currentActivity.options || []).map(option => `
      <button type="button" class="choice-option" data-answer="${escapeHtml(option)}">${escapeHtml(option)}</button>`
    ).join("");
  } else if (["sentence-study", "foundation-study"].includes(currentActivity.type)) {
    activityStage = "sentence-study";
    $("#answer-area").hidden = true;
    $("#sentence-panel").hidden = false;
    $("#sentence-text").textContent = currentActivity.sentence || "";
    $("#sentence-english").textContent = currentActivity.naturalEnglish || "";
    const mode = progress.settings?.supportMode || 'auto';
    const lessonProduction = activities.filter(a => a.lessonId === currentActivity.lessonId).reduce((n,a) => n + (progress.evidence[a.id]?.successes?.production || 0), 0);
    const fade = currentActivity.type !== 'foundation-study' && (mode === 'hawaiian' || (mode === 'auto' && lessonProduction >= 3));
    $('#sentence-meaning-details').open = !fade;
    $('#foundation-listen').hidden = !currentActivity.listenUrl;
    $('#foundation-listen').href = currentActivity.listenUrl || '#';
    $("#sentence-pattern-name").textContent = currentActivity.patternName || "Sentence pattern";
    $("#sentence-pattern-intro").textContent = currentActivity.patternIntro || "";
    $("#sentence-language-note").textContent = currentActivity.languageNote || "";
    $("#sentence-language-note").hidden = !currentActivity.languageNote?.trim();
    $('#sentence-panel .study-label').textContent = currentActivity.type === 'foundation-study' ? 'Pronunciation foundation' : 'Sentence';
    $('.sentence-pattern-heading').hidden = !currentActivity.patternName;
    $('#sentence-pattern-intro').hidden = !currentActivity.patternIntro?.trim();
    $('#sentence-parts').hidden = !currentActivity.parts?.length;
    $("#sentence-continue-btn").textContent = currentActivity.completionLabel || "Continue";
    $("#sentence-parts").innerHTML = (currentActivity.parts || []).map(part => `
      <div class="sentence-part">
        <span>${escapeHtml(part.label)}</span>
        <strong lang="haw">${escapeHtml(part.hawaiian)}</strong>
        <p>${escapeHtml(part.note)}</p>
      </div>`).join("");
  } else if (currentActivity.type === "guided-listening") {
    activityStage = "listening";
    $("#answer-area").hidden = true;
    $("#listening-panel").hidden = false;
    $('#lesson-purpose').hidden = true;
    $('#listening-reflection').value = '';
    $('#listening-reflection-status').textContent = '';
    $("#listening-source-name").textContent = currentActivity.audioSourceName || "Trusted audio source";
    $("#listening-speaker").textContent = currentActivity.audioSpeaker ? `Speaker: ${currentActivity.audioSpeaker}` : "";
    $("#listening-notes").innerHTML = (currentActivity.listeningNotes || []).map(note => `<li>${escapeHtml(note)}</li>`).join("");
    $("#listening-source-link").href = currentActivity.sourcePageUrl || currentActivity.audioUrl;
    $("#listening-continue-btn").textContent = currentActivity.completionLabel || "Continue";
    const audio = $("#listening-audio");
    audio.hidden = !currentActivity.audioUrl;
    if (currentActivity.audioUrl) { audio.src = currentActivity.audioUrl; audio.load(); }
    $('#listening-continue-btn').disabled = true;
    $('#listening-confirm').checked = false;
    $('#listening-skip-btn').hidden = false;
    $('#listening-replay-stage').value = 'first';
    $('#listening-status').textContent = 'Listen at the source, then record the step you completed. Skipping records no exposure.';
    $('#listening-transcript').hidden = !currentActivity.transcriptUrl;
    $('#listening-transcript').href = currentActivity.transcriptUrl || '#';
  } else if (currentActivity.type === "study-hide-recall") {
    activityStage = "study";
    $("#study-panel").hidden = false;
    $("#answer-area").hidden = true;
    $("#study-word").textContent = currentActivity.studyWord;
    $("#study-notes").innerHTML = (currentActivity.studyNotes || []).map(note => `<li>${escapeHtml(note)}</li>`).join("");
  } else {
    activityStage = "answer";
  }

  renderActivityHelp();
  if (['sentence-study', 'foundation-study', 'study-hide-recall'].includes(currentActivity.type)) markModelSeen(currentActivity);
  if (returnToTop) scrollPracticeToTop();
}

function beginHiddenRecall() {
  if (!currentActivity || currentActivity.type !== "study-hide-recall") return;
  activityStage = "paper";
  $("#sound-guide").hidden = true;
  $("#word-meanings").hidden = true;
  $("#source-details").hidden = true;
  markModelSeen(currentActivity);
  usedHelp = true;
  $("#study-panel").hidden = true;
  $("#prompt").textContent = currentActivity.studyWord?.includes(" ") ? "Write the phrase you just studied." : "Write the word you just studied.";
  $("#support").textContent = "Use paper if you have it. You can also skip this step and type the answer instead.";
  $("#paper-instruction").textContent = currentActivity.paperInstruction || "Write it three times from memory, then continue.";
  $("#paper-panel").hidden = false;
  $("#answer-area").hidden = true;
}

function finishPaperStage() {
  if (activityStage !== "paper") return;
  activityStage = "answer";
  $("#paper-panel").hidden = true;
  $("#answer-area").hidden = false;
  $("#answer-input").readOnly = true;
  $("#answer-input").blur();
  $("#prompt").textContent = currentActivity.studyWord?.includes(" ") ? "Now type the phrase you studied." : "Now type the word you studied.";
  $("#support").textContent = "Tap the answer box when you are ready to type.";
}

function completeListeningActivity() {
  if (!currentActivity || currentActivity.type !== "guided-listening") return;
  recordExposure(currentActivity);
  const key = currentActivity.id;
  const previous = progress.listening[key] || {};
  const stage = $('#listening-replay-stage').value;
  const now = Date.now();
  const reflection = $('#listening-reflection').value;
  progress.listening[key] = { ...previous, reflection, [stage]: (previous[stage] || 0) + 1, lastAt: now,
    delayedReplays: (previous.delayedReplays || 0) + (previous.lastAt && now - previous.lastAt >= 86400000 ? 1 : 0) };
  saveProgress(progress);
  showNextActivity();
}

function completeSentenceStudy() {
  if (!currentActivity || !["sentence-study", "foundation-study"].includes(currentActivity.type)) return;
  recordExposure(currentActivity);
  showNextActivity();
}

function attemptDescription() {
  if (currentActivity.correctionRetry) return 'Recorded as correction practice. Revisit later without the answer to check retention.';
  if (usedHelp || evidenceKind(currentActivity) === 'supported') return 'Recorded as supported practice because a model or help was available recently. Revisit after a day without help to check retention.';
  const kind = evidenceKind(currentActivity);
  return kind === 'recognition' ? 'Recorded as recognition: choosing an answer is different from producing it yourself.' : kind === 'interpretation' ? 'Recorded as meaning interpretation. This does not assess spoken comprehension.' : 'Recorded as an unaided written attempt. A later successful attempt provides stronger evidence of retention.';
}

function feedbackTitle(status) {
  if (status === "correct") return "Correct";
  if (status === "almost") return "Almost — check the spelling";
  return "Not yet";
}

function checkChoiceAnswer() {
  if (!currentActivity || currentActivity.type !== "sentence-choice" || answerLocked || !selectedChoice) return;
  const selected = selectedChoice;
  const status = selected === currentActivity.answer ? "correct" : "incorrect";
  answerLocked = true;
  recordAttempt(status);
  progress.totals[status] = (progress.totals[status] || 0) + 1;
  saveProgress(progress);

  $$("#choice-options .choice-option").forEach(button => {
    button.disabled = true;
    if (button.dataset.answer === currentActivity.answer) button.classList.add("correct-choice");
    if (button.dataset.answer === selected && status !== "correct") button.classList.add("wrong-choice");
  });

  const feedback = $("#feedback");
  feedback.hidden = false;
  feedback.className = `feedback ${status}`;
  const explanation = (currentActivity.explanation ? `<p>${escapeHtml(currentActivity.explanation)}</p>` : '') + `<p>${escapeHtml(diagnose(currentActivity.type === 'sentence-choice' ? selectedChoice : $('#answer-input').value, currentActivity, {status}))}</p>`;
  feedback.innerHTML = `
    <strong>${feedbackTitle(status)}</strong>
    ${status !== "correct" ? `<div class="expected-answer">Answer: ${escapeHtml(currentActivity.answer)}</div>` : ""}
    ${explanation}<p class="evidence-note">${escapeHtml(attemptDescription())}</p>`;
  $("#choice-check-btn").hidden = true;
  $("#choice-next-btn").hidden = false;
  $("#retry-actions").hidden = status === "correct";
  renderActivityHelp(true);
  updateDueCount();
}

function checkCurrentAnswer() {
  if (!currentActivity || answerLocked || activityStage !== "answer") return;
  const given = $("#answer-input").value;
  if (!given.trim()) return;

  const result = gradeAnswer(given, currentActivity.answer, currentActivity.answerLanguage || "haw", currentActivity.alternatives || []);
  answerLocked = true;
  recordAttempt(result.status);
  progress.totals[result.status] = (progress.totals[result.status] || 0) + 1;
  saveProgress(progress);

  const feedback = $("#feedback");
  feedback.hidden = false;
  feedback.className = `feedback ${result.status}`;
  const notes = (result.notes || []).map(note => `<li>${escapeHtml(note)}</li>`).join("");
  const explanation = (currentActivity.explanation ? `<p>${escapeHtml(currentActivity.explanation)}</p>` : '') + `<p>${escapeHtml(diagnose(currentActivity.type === 'sentence-choice' ? selectedChoice : $('#answer-input').value, currentActivity, result))}</p>`;
  const correctionPractice = result.status === "correct" || currentActivity.skill === "sentence-patterns" ? "" : `<p><strong>Try it on paper:</strong> Write the correct spelling 3 times before moving on if you can.</p>`;
  feedback.innerHTML = `
    <strong>${feedbackTitle(result.status)}</strong>
    ${notes ? `<ul>${notes}</ul>` : ""}
    ${result.status !== "correct" ? `<div class="expected-answer" lang="haw">Expected: ${escapeHtml(result.expected)}</div>` : ""}
    ${correctionPractice}
    ${explanation}<p class="evidence-note">${escapeHtml(attemptDescription())}</p>`;

  $("#answer-input").disabled = true;
  $("#check-btn").hidden = true;
  $("#next-btn").hidden = false;
  $("#retry-actions").hidden = result.status === "correct";
  renderActivityHelp(true);
  updateDueCount();
  settleAfterKeyboard();
}

function retryCurrentActivity() {
  if (!currentActivity || !answerLocked) return;
  const retry = { ...currentActivity, correctionRetry: true };
  practiceQueue.unshift(retry);
  showNextActivity(false);
}

function insertCharacter(character) {
  const input = $("#answer-input");
  if (input.disabled || input.readOnly) return;
  const start = input.selectionStart ?? input.value.length;
  const end = input.selectionEnd ?? input.value.length;
  input.value = input.value.slice(0, start) + character + input.value.slice(end);
  input.focus();
  input.setSelectionRange(start + character.length, start + character.length);
}

function renderNeedsPractice() {
  const groups = needsPracticeGroups();
  const list = $("#needs-practice-list");
  const empty = $("#needs-practice-empty");
  const button = $("#practice-needs-btn");

  list.innerHTML = "";
  empty.hidden = groups.length > 0;
  button.hidden = groups.length === 0;

  groups.forEach(group => {
    const item = document.createElement("div");
    item.className = "needs-item";
    const when = group.due ? "Due now" : dueLabel(group.nextReview);
    item.innerHTML = `
      <div class="needs-copy">
        <strong${group.skill === "spelling" ? ' lang="haw"' : ""}>${escapeHtml(group.label || group.answer)}</strong>
        <span>${escapeHtml(group.reason)}</span>
      </div>
      <span class="needs-when">${escapeHtml(when)}</span>`;
    list.appendChild(item);
  });
}

function exposureCountForSkill(skill) {
  return Object.values(progress.exposures || {}).filter(item => item.skill === skill).reduce((sum, item) => sum + (Number(item.count) || 0), 0);
}

function renderSkillProgress() {
  const scored = activities.filter(isScoredActivity);
  const groups = needsPracticeGroups();
  const countReviewed = skill => scored.filter(activity => activity.skill === skill && progress.reviews[activity.id]).length;
  const countWeak = skill => groups.filter(group => group.skill === skill).length;
  const listeningSessions = exposureCountForSkill("listening");
  const sentenceStudySessions = exposureCountForSkill("sentence-patterns");

  $("#skill-progress").innerHTML = `
    <div class="skill-card">
      <div><strong>Spelling & recall</strong><span>${countReviewed("spelling")} scored items practiced</span></div>
      <span class="skill-detail">${countWeak("spelling")} item${countWeak("spelling") === 1 ? "" : "s"} need${countWeak("spelling") === 1 ? "s" : ""} practice</span>
    </div>
    <div class="skill-card">
      <div><strong>Pronouns & participants</strong><span>${countReviewed("pronouns")} scored checks practiced</span></div>
      <span class="skill-detail">${countWeak("pronouns")} item${countWeak("pronouns") === 1 ? "" : "s"} need review</span>
    </div>
    <div class="skill-card">
      <div><strong>Sentence patterns</strong><span>${countReviewed("sentence-patterns")} scored checks · ${sentenceStudySessions} study session${sentenceStudySessions === 1 ? "" : "s"}</span></div>
      <span class="skill-detail">${countWeak("sentence-patterns")} pattern item${countWeak("sentence-patterns") === 1 ? "" : "s"} need review</span>
    </div>
    <div class="skill-card">
      <div><strong>Whole-sentence comprehension</strong><span>${countReviewed("comprehension")} scored checks practiced</span></div>
      <span class="skill-detail">${countWeak("comprehension")} context item${countWeak("comprehension") === 1 ? "" : "s"} need review</span>
    </div>
    <div class="skill-card">
      <div><strong>Noun phrases & number</strong><span>${countReviewed("noun-phrases")} scored checks practiced</span></div>
      <span class="skill-detail">${countWeak("noun-phrases")} item${countWeak("noun-phrases") === 1 ? "" : "s"} need review</span>
    </div>
    <div class="skill-card">
      <div><strong>Questions & information gaps</strong><span>${countReviewed("questions")} scored checks practiced</span></div>
      <span class="skill-detail">${countWeak("questions")} item${countWeak("questions") === 1 ? "" : "s"} need review</span>
    </div>
    <div class="skill-card">
      <div><strong>Possession & relationships</strong><span>${countReviewed("possessives")} scored checks practiced</span></div>
      <span class="skill-detail">${countWeak("possessives")} item${countWeak("possessives") === 1 ? "" : "s"} need review</span>
    </div>
    <div class="skill-card">
      <div><strong>Immersion</strong><span>${listeningSessions} listening session${listeningSessions === 1 ? "" : "s"}</span></div>
      <span class="skill-detail">Exposure only — not a mastery score</span>
    </div>`;
}
function renderProgress() {
  const activeReviewStates = activities.filter(isScoredActivity).map(activity => progress.reviews[activity.id]).filter(Boolean);
  const reviewed = activeReviewStates.length;
  const due = dueActivities().length;
  const weak = needsPracticeGroups().length;
  const totalAttempts = progress.totals.correct + progress.totals.almost + progress.totals.incorrect;
  const recallRate = totalAttempts ? Math.round((progress.totals.correct / totalAttempts) * 100) : 0;
  const stats = [[reviewed, "items practiced"], [due, "due now"], [recallRate + "%", "correct answers"], [weak, "needs practice"]];
  $("#progress-summary").innerHTML = stats.map(([value, label]) => `<div class="stat-card"><span class="value">${value}</span><span class="label">${label}</span></div>`).join("");
  $('#progress-next').textContent = due ? `${due} introduced activities are due. A short mixed round will revisit them.` : weak ? `${weak} items need more practice. Review the explanation, then return later without help.` : 'Choose a lesson to build on what you have studied. Revisit it later without help to check retention.';
  $('#progress-next-btn').textContent = due ? 'Review due material' : weak ? 'Practice difficult items' : 'Choose a lesson';
  const e = evidenceTotals(progress.evidence);
  $('#evidence-summary').innerHTML = [
    [e.recognition, 'recognition successes'], [e.supported, 'supported recall successes'],
    [e.production, 'unaided written successes'], [e.delayedProduction, 'production successes after 24+ hours'],
    [e.interpretation, 'typed meaning successes'], [e.retry, 'correction successes']
  ].map(([value,label]) => `<div class="stat-card"><span class="value">${value}</span><span class="label">${label}</span></div>`).join('');
  const listening = Object.values(progress.listening || {});
  $('#listening-evidence').textContent = `${listening.reduce((n,s)=>n+(s.first||0)+(s.support||0)+(s.hidden||0),0)} self-reported listening steps · ${listening.reduce((n,s)=>n+(s.delayedReplays||0),0)} returns after 24+ hours. Listening and written pronunciation knowledge are not spoken-skill scores.`;
  renderNeedsPractice();
  renderSkillProgress();
}

function recordAttempt(status) {
  roundAttempts++;
  if (status === 'correct') roundCorrect++;
  const prior = progress.reviews[currentActivity.id];
  const supported = usedHelp || evidenceKind(currentActivity) === 'supported';
  progress.evidence[currentActivity.id] = recordEvidence(progress.evidence[currentActivity.id], currentActivity, status, { helped: supported, retry: !!currentActivity.correctionRetry });
  // Corrected or supported answers cannot erase a recent miss or extend its due date.
  if (!(status === 'correct' && (supported || currentActivity.correctionRetry) && prior)) {
    progress.reviews[currentActivity.id] = scheduleReview(prior, status);
  }
  markModelSeen(currentActivity);
}

function renderActivityHelp(afterAnswer = false) {
  const a = currentActivity;
  if (!a) return;
  const guide = $('#sound-guide');
  guide.open = false;
  const visible = afterAnswer ? modelKey(a) : a.type === 'sentence-study' || a.type === 'foundation-study' ? a.sentence : a.type === 'study-hide-recall' ? a.studyWord : '';
  guide.hidden = !visible;
  const words = [...new Set((visible || '').match(/[a-zāēīōūʻ]+/gi) || [])];
  $('#sound-guide-body').innerHTML = words.map(word => {
    const marks = [...new Set(word.match(/[āēīōū]/gi) || [])];
    const cues = [marks.length ? `Long vowel${marks.length>1?'s':''}: ${marks.join(', ')}.` : 'No written long vowel.', word.includes('ʻ') ? 'Keep the written glottal stop(s).' : 'Do not add an unwritten glottal stop.'];
    return `<p><strong lang="haw">${escapeHtml(word)}</strong> — ${escapeHtml(cues.join(' '))}</p>`;
  }).join('') + '<p>Syllables end in vowels. This is a spelling-based reminder, not a full phonetic transcription or a stress prediction. Hear the whole phrase in context.</p><a href="https://oleloonline.com/0400-series-index/" target="_blank" rel="noopener noreferrer">Hear pronunciation lessons</a> · <a href="https://www.hawaii.edu/offices/communications/standards/hawaiian-language-considerations/" target="_blank" rel="noopener noreferrer">UH spelling guidance</a>';
  const entries = matchingEntries(visible || '');
  $('#word-meanings').hidden = !entries.length;
  $('#word-meanings').open = false;
  $('#word-meanings-body').innerHTML = '<p>Selected dictionary senses, not automatic translations. Read the sentence context. Pukui–Elbert (1986), via UH Hilo Wehewehe Wikiwiki.</p>' + entries.map(entry => `<p><strong lang="haw">${escapeHtml(entry.word)}</strong> — ${escapeHtml(entry.meaning)}<br>${escapeHtml(entry.note)} <a href="${entry.url}" target="_blank" rel="noopener noreferrer">Read dictionary entry</a></p>`).join('');
  const help = $('#model-help'); help.open = false;
  help.hidden = afterAnswer || !isScoredActivity(a) || a.type === 'sentence-choice' || a.type === 'study-hide-recall';
  $('#model-help-text').textContent = a.model || a.answer || '';
  $('#source-details').hidden = false;
  $('#activity-sources').innerHTML = (a.sourceRefs || []).map(ref => `<li><a href="${escapeHtml(ref.url)}" target="_blank" rel="noopener noreferrer">${escapeHtml(ref.section || 'Source')}</a></li>`).join('');
}

function bindEvents() {
  $('#round-continue-btn').addEventListener('click', () => { if (lessonSession) startLesson(lessonSession.id); });
  $('#progress-next-btn').addEventListener('click', () => { if (dueActivities().length) startDuePractice(); else if(needsPracticeGroups().length) startNeedsPractice(); else switchView('learn'); });
  $('#round-learn-btn').addEventListener('click', () => switchView('learn'));
  $('#round-review-btn').addEventListener('click', startDuePractice);
  $('#vocabulary-families').addEventListener('click', event => { const button = event.target.closest('[data-family-lesson]'); if (button) startLesson(button.dataset.familyLesson); });
  $('#support-mode').value = progress.settings.supportMode || 'auto';
  $('#support-mode').addEventListener('change', event => { progress.settings.supportMode = event.target.value; saveProgress(progress); });
  $('#listening-reflection').addEventListener('change', event => { $('#listening-reflection-status').textContent = event.target.value === 'uncertain' ? 'Replay a short passage with source support. Choose one sound or word to notice, then listen again.' : event.target.value === 'noticed' ? 'Replay without text and check whether you notice the same detail again. This is reflection, not a comprehension score.' : ''; });
  $('#listening-confirm').addEventListener('change', event => { $('#listening-continue-btn').disabled = !event.target.checked; });
  $('#listening-skip-btn').addEventListener('click', () => showNextActivity());
  $('#model-help').addEventListener('toggle', event => { if (event.target.open && !answerLocked) { usedHelp = true; markModelSeen(currentActivity); } });
  $('#source-details').addEventListener('toggle', event => { if (event.target.open && !answerLocked) usedHelp = true; });
  $('#sound-guide').addEventListener('toggle', event => { if (event.target.open && !answerLocked) usedHelp = true; });
  $('#listening-audio').addEventListener('error', () => { $('#listening-status').textContent = 'Playback did not load. Open the official source or skip this step.'; });

  $$(".nav-btn").forEach(btn => btn.addEventListener("click", () => switchView(btn.dataset.view)));
  $("#start-due-btn").addEventListener("click", startDuePractice);
  $("#practice-needs-btn").addEventListener("click", startNeedsPractice);
  $("#hide-and-recall-btn").addEventListener("click", beginHiddenRecall);
  $("#paper-done-btn").addEventListener("click", finishPaperStage);
  $("#skip-paper-btn").addEventListener("click", finishPaperStage);
  $("#check-btn").addEventListener("click", checkCurrentAnswer);
  $("#next-btn").addEventListener("click", showNextActivity);
  $("#sentence-continue-btn").addEventListener("click", completeSentenceStudy);
  $("#choice-options").addEventListener("click", event => {
    const button = event.target.closest(".choice-option");
    if (!button || answerLocked) return;
    selectedChoice = button.dataset.answer;
    $$("#choice-options .choice-option").forEach(option => option.classList.toggle("selected-choice", option === button));
    $("#choice-check-btn").disabled = false;
  });
  $("#choice-check-btn").addEventListener("click", checkChoiceAnswer);
  $("#choice-next-btn").addEventListener("click", showNextActivity);
  $("#retry-btn").addEventListener("click", retryCurrentActivity);
  $("#listening-continue-btn").addEventListener("click", completeListeningActivity);
  $("#listening-audio").addEventListener("play", () => {
    if (currentActivity?.type === "guided-listening") $("#listening-status").textContent = "After listening, mark the step you completed.";
  });
  $("#answer-input").addEventListener("keydown", event => {
    if (event.key !== "Enter") return;
    event.preventDefault();
    if (answerLocked) showNextActivity();
    else checkCurrentAnswer();
  });
  $$(".hawaiian-keyboard button").forEach(btn => btn.addEventListener("click", () => insertCharacter(btn.dataset.char)));
  $("#export-btn").addEventListener("click", () => exportProgress(progress));
  $("#reset-btn").addEventListener("click", () => {
    if (!window.confirm("Reset all local review history for this app?")) return;
    clearProgress();
    progress = loadProgress();
    updateDueCount();
    renderProgress();
    renderImmersionLibrary();
  });
}

async function init() {
  bindEvents();
  try {
    await loadCurriculum();
    renderCurriculum();
    renderImmersionLibrary();
    renderProgress();
  } catch (error) {
    console.error(error);
    $("#curriculum-status").textContent = "The curriculum could not be loaded.";
  }
}

init();
