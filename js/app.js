import { gradeAnswer } from "./grading.js";
import { dueLabel, freshReviewState, isDue, scheduleReview } from "./srs.js";
import { clearProgress, exportProgress, loadProgress, saveProgress } from "./storage.js";

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

function shuffle(items) {
  const copy = items.slice();
  for (let i = copy.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}

function isScoredActivity(activity) {
  return activity?.scored !== false && !["guided-listening", "sentence-study"].includes(activity?.type);
}

function switchView(name) {
  $$(".nav-btn").forEach(btn => btn.classList.toggle("active", btn.dataset.view === name));
  $$(".view").forEach(view => view.classList.toggle("active", view.id === `view-${name}`));
  if (name === "progress") renderProgress();
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
  list.innerHTML = (curriculum.stages || []).map((stage, index) => `
    <div class="stage-card ${index < 3 ? "available" : "planned"}">
      <span class="stage-number">${index + 1}</span>
      <div><strong>${escapeHtml(stage.title)}</strong><span>${escapeHtml(stage.description)}</span></div>
    </div>`).join("");
}

function renderCurriculum() {
  renderStages();
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
      <div class="immersion-actions">
        <a class="primary-link" href="${escapeHtml(activity.sourcePageUrl || "#")}" target="_blank" rel="noopener noreferrer">${escapeHtml(activity.openLabel || "Open source")}</a>
        <button class="secondary-btn log-listen-btn" type="button">Log listening session</button>
      </div>
      <p class="exposure-note">${escapeHtml(activity.sourceNote || "Open the trusted source in your browser for playback. Listening never changes your mastery score.")}</p>`;
    const button = card.querySelector(".log-listen-btn");
    button.addEventListener("click", () => {
      recordExposure(activity);
      button.textContent = "Session logged";
      button.disabled = true;
    });
    list.appendChild(card);
  });
}
function reviewStateFor(activityId) {
  return progress.reviews[activityId] || freshReviewState();
}

function dueActivities() {
  return activities.filter(activity => isScoredActivity(activity) && isDue(reviewStateFor(activity.id)));
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
    const key = (activity.answer || activity.id).normalize("NFC").toLocaleLowerCase();
    if (!groups.has(key)) groups.set(key, { answer: activity.answer, skill: activity.skill || "spelling", activities: [], states: [] });
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

function startLesson(lessonId) {
  practiceQueue = activities.filter(activity => activity.lessonId === lessonId);
  switchView("practice");
  showNextActivity(false);
  scrollPracticeToTop("smooth");
}

function startDuePractice() {
  let due = dueActivities();
  if (!due.length) due = activities.filter(isScoredActivity);
  practiceQueue = shuffle(due);
  switchView("practice");
  showNextActivity(false);
  scrollPracticeToTop("smooth");
}

function startNeedsPractice() {
  const weak = needsPracticeGroups().map(group => group.representative).filter(Boolean);
  if (!weak.length) return;
  practiceQueue = shuffle(weak);
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
  audio.pause();
  audio.removeAttribute("src");
  audio.load();
}

function showNextActivity(returnToTop = true) {
  currentActivity = practiceQueue.shift() || null;
  answerLocked = false;
  resetPracticeUi();

  if (!currentActivity) {
    $("#practice-content").hidden = true;
    $("#practice-empty").hidden = false;
    $("#practice-empty").textContent = "Round complete. This material will return when more practice is useful.";
    updateDueCount();
    if (returnToTop) scrollPracticeToTop();
    return;
  }

  $("#practice-empty").hidden = true;
  $("#practice-content").hidden = false;
  const activityLabels = {
    "repair-spelling": "spelling repair",
    "study-hide-recall": "study then recall",
    "meaning-recall": "meaning recall",
    "sentence-study": "sentence study",
    "sentence-choice": "sentence check",
    "sentence-recall": "sentence recall",
    "guided-listening": "listening"
  };
  $("#activity-type").textContent = activityLabels[currentActivity.type] || currentActivity.type.replaceAll("-", " ");
  $("#activity-focus").textContent = currentActivity.focus.join(" • ");
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
  } else if (currentActivity.type === "sentence-study") {
    activityStage = "sentence-study";
    $("#answer-area").hidden = true;
    $("#sentence-panel").hidden = false;
    $("#sentence-text").textContent = currentActivity.sentence || "";
    $("#sentence-english").textContent = currentActivity.naturalEnglish || "";
    $("#sentence-pattern-name").textContent = currentActivity.patternName || "Sentence pattern";
    $("#sentence-pattern-intro").textContent = currentActivity.patternIntro || "";
    $("#sentence-language-note").textContent = currentActivity.languageNote || "";
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
    $("#listening-source-name").textContent = currentActivity.audioSourceName || "Trusted audio source";
    $("#listening-speaker").textContent = currentActivity.audioSpeaker ? `Speaker: ${currentActivity.audioSpeaker}` : "";
    $("#listening-notes").innerHTML = (currentActivity.listeningNotes || []).map(note => `<li>${escapeHtml(note)}</li>`).join("");
    $("#listening-source-link").href = currentActivity.audioUrl;
    $("#listening-continue-btn").textContent = currentActivity.completionLabel || "Continue";
    const audio = $("#listening-audio");
    audio.src = currentActivity.audioUrl;
    audio.load();
  } else if (currentActivity.type === "study-hide-recall") {
    activityStage = "study";
    $("#study-panel").hidden = false;
    $("#answer-area").hidden = true;
    $("#study-word").textContent = currentActivity.studyWord;
    $("#study-notes").innerHTML = (currentActivity.studyNotes || []).map(note => `<li>${escapeHtml(note)}</li>`).join("");
  } else {
    activityStage = "answer";
  }

  if (returnToTop) scrollPracticeToTop();
}

function beginHiddenRecall() {
  if (!currentActivity || currentActivity.type !== "study-hide-recall") return;
  activityStage = "paper";
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
  showNextActivity();
}

function completeSentenceStudy() {
  if (!currentActivity || currentActivity.type !== "sentence-study") return;
  recordExposure(currentActivity);
  showNextActivity();
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
  progress.reviews[currentActivity.id] = scheduleReview(progress.reviews[currentActivity.id], status);
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
  const explanation = currentActivity.explanation ? `<p>${escapeHtml(currentActivity.explanation)}</p>` : "";
  feedback.innerHTML = `
    <strong>${feedbackTitle(status)}</strong>
    ${status !== "correct" ? `<div class="expected-answer">Answer: ${escapeHtml(currentActivity.answer)}</div>` : ""}
    ${explanation}`;
  $("#choice-check-btn").hidden = true;
  $("#choice-next-btn").hidden = false;
  $("#retry-actions").hidden = status === "correct";
  updateDueCount();
}

function checkCurrentAnswer() {
  if (!currentActivity || answerLocked || activityStage !== "answer") return;
  const given = $("#answer-input").value;
  if (!given.trim()) return;

  const result = gradeAnswer(given, currentActivity.answer, currentActivity.answerLanguage || "haw", currentActivity.alternatives || []);
  answerLocked = true;
  progress.reviews[currentActivity.id] = scheduleReview(progress.reviews[currentActivity.id], result.status);
  progress.totals[result.status] = (progress.totals[result.status] || 0) + 1;
  saveProgress(progress);

  const feedback = $("#feedback");
  feedback.hidden = false;
  feedback.className = `feedback ${result.status}`;
  const notes = (result.notes || []).map(note => `<li>${escapeHtml(note)}</li>`).join("");
  const explanation = currentActivity.explanation ? `<p>${escapeHtml(currentActivity.explanation)}</p>` : "";
  const correctionPractice = result.status === "correct" || currentActivity.skill === "sentence-patterns" ? "" : `<p><strong>Try it on paper:</strong> Write the correct spelling 3 times before moving on if you can.</p>`;
  feedback.innerHTML = `
    <strong>${feedbackTitle(result.status)}</strong>
    ${notes ? `<ul>${notes}</ul>` : ""}
    ${result.status !== "correct" ? `<div class="expected-answer" lang="haw">Expected: ${escapeHtml(result.expected)}</div>` : ""}
    ${correctionPractice}
    ${explanation}`;

  $("#answer-input").disabled = true;
  $("#check-btn").hidden = true;
  $("#next-btn").hidden = false;
  $("#retry-actions").hidden = result.status === "correct";
  updateDueCount();
  settleAfterKeyboard();
}

function retryCurrentActivity() {
  if (!currentActivity || !answerLocked) return;
  const retry = currentActivity;
  practiceQueue.unshift(retry);
  showNextActivity();
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
        <strong lang="haw">${escapeHtml(group.answer)}</strong>
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
  const spellingReviewed = scored.filter(activity => activity.skill === "spelling" && progress.reviews[activity.id]).length;
  const sentenceReviewed = scored.filter(activity => activity.skill === "sentence-patterns" && progress.reviews[activity.id]).length;
  const groups = needsPracticeGroups();
  const weakSpelling = groups.filter(group => group.skill === "spelling").length;
  const weakSentences = groups.filter(group => group.skill === "sentence-patterns").length;
  const listeningSessions = exposureCountForSkill("listening");
  const sentenceStudySessions = exposureCountForSkill("sentence-patterns");

  $("#skill-progress").innerHTML = `
    <div class="skill-card">
      <div><strong>Spelling & recall</strong><span>${spellingReviewed} scored items practiced</span></div>
      <span class="skill-detail">${weakSpelling} item${weakSpelling === 1 ? "" : "s"} need${weakSpelling === 1 ? "s" : ""} practice</span>
    </div>
    <div class="skill-card">
      <div><strong>Sentence patterns</strong><span>${sentenceReviewed} scored checks · ${sentenceStudySessions} study session${sentenceStudySessions === 1 ? "" : "s"}</span></div>
      <span class="skill-detail">${weakSentences} pattern item${weakSentences === 1 ? "" : "s"} need review</span>
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
  renderNeedsPractice();
  renderSkillProgress();
}

function bindEvents() {
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
    if (currentActivity?.type === "guided-listening") $("#listening-continue-btn").disabled = false;
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
