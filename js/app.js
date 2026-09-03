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

function shuffle(items) {
  const copy = items.slice();
  for (let i = copy.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}

function switchView(name) {
  $$(".nav-btn").forEach(btn => btn.classList.toggle("active", btn.dataset.view === name));
  $$(".view").forEach(view => view.classList.toggle("active", view.id === `view-${name}`));
  if (name === "progress") renderProgress();
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
    let baseline = window.visualViewport.height;
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
      if (!lessonSummary.playable) continue;
      lesson.activities.forEach(activity => {
        activities.push({ ...activity, lessonId: lesson.id, lessonTitle: lesson.title, focus: lesson.focus || [] });
      });
    }
  }
}

function escapeHtml(value = "") {
  const el = document.createElement("span");
  el.textContent = value;
  return el.innerHTML;
}

function renderCurriculum() {
  const list = $("#unit-list");
  list.innerHTML = "";
  curriculum.units.slice().sort((a, b) => (a.order || 0) - (b.order || 0)).forEach(unit => {
    const card = document.createElement("article");
    card.className = "unit-card";
    const planned = unit.status === "planned" || !(unit.lessons || []).length;
    const outcomes = (unit.outcomes || []).map(item => `<li>${escapeHtml(item)}</li>`).join("");
    card.innerHTML = `
      <div class="unit-top">
        <div>
          <p class="section-kicker">Unit ${escapeHtml(String(unit.order || ""))}</p>
          <h3>${escapeHtml(unit.title)}</h3>
          <p>${escapeHtml(unit.description)}</p>
        </div>
        <span class="tag">${planned ? "planned" : "active"}</span>
      </div>
      ${outcomes ? `<details><summary>What this unit builds</summary><ul>${outcomes}</ul></details>` : ""}
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
  $("#curriculum-status").textContent = `${activities.length} practice activities loaded.`;
  updateDueCount();
}

function reviewStateFor(activityId) {
  return progress.reviews[activityId] || freshReviewState();
}

function dueActivities() {
  return activities.filter(activity => isDue(reviewStateFor(activity.id)));
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

function practiceReason(states) {
  if (states.some(state => state.lastGrade === "incorrect")) return "Missed on the last try";
  if (states.some(state => state.lastGrade === "almost")) return "Spelling was close on the last try";
  return "Improving — keep reviewing until it sticks";
}

function representativeActivity(groupActivities) {
  const strength = { "meaning-recall": 3, "repair-spelling": 2, "study-hide-recall": 1 };
  return groupActivities.slice().sort((a, b) => (strength[b.type] || 0) - (strength[a.type] || 0))[0];
}

function needsPracticeGroups() {
  const groups = new Map();
  activities.forEach(activity => {
    const state = progress.reviews[activity.id];
    if (!needsMorePractice(state)) return;
    const key = (activity.answer || activity.id).normalize("NFC").toLocaleLowerCase();
    if (!groups.has(key)) groups.set(key, { answer: activity.answer, activities: [], states: [] });
    const group = groups.get(key);
    group.activities.push(activity);
    group.states.push(state);
  });

  return [...groups.values()].map(group => ({
    ...group,
    reason: practiceReason(group.states),
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
  if (!due.length) due = activities.slice();
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
  input.value = "";
  input.disabled = false;
  input.readOnly = true;
  input.blur();
  $("#study-panel").hidden = true;
  $("#paper-panel").hidden = true;
  $("#answer-area").hidden = false;
  $("#check-btn").hidden = false;
  $("#next-btn").hidden = true;
  $("#feedback").hidden = true;
  $("#feedback").className = "feedback";
  $("#feedback").innerHTML = "";
}

function showNextActivity(returnToTop = true) {
  currentActivity = practiceQueue.shift() || null;
  answerLocked = false;
  resetPracticeUi();

  if (!currentActivity) {
    $("#practice-content").hidden = true;
    $("#practice-empty").hidden = false;
    $("#practice-empty").textContent = "Round complete. These words will return later for more practice.";
    updateDueCount();
    if (returnToTop) scrollPracticeToTop();
    return;
  }

  $("#practice-empty").hidden = true;
  $("#practice-content").hidden = false;
  $("#activity-type").textContent = currentActivity.type.replaceAll("-", " ");
  $("#activity-focus").textContent = currentActivity.focus.join(" • ");
  $("#instruction").textContent = currentActivity.instruction || "Type your answer.";
  $("#prompt").textContent = currentActivity.prompt || "";
  $("#support").textContent = currentActivity.support || "";

  if (currentActivity.type === "study-hide-recall") {
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

function feedbackTitle(status) {
  if (status === "correct") return "Correct";
  if (status === "almost") return "Almost — check the spelling";
  return "Not yet";
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
  const correctionPractice = result.status === "correct" ? "" : `<p><strong>Try it on paper:</strong> Write the correct spelling 3 times before moving on if you can.</p>`;
  feedback.innerHTML = `
    <strong>${feedbackTitle(result.status)}</strong>
    ${notes ? `<ul>${notes}</ul>` : ""}
    ${result.status !== "correct" ? `<div class="expected-answer" lang="haw">Expected: ${escapeHtml(result.expected)}</div>` : ""}
    ${correctionPractice}
    ${explanation}`;

  $("#answer-input").disabled = true;
  $("#check-btn").hidden = true;
  $("#next-btn").hidden = false;
  updateDueCount();
  settleAfterKeyboard();
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

function renderProgress() {
  const activeReviewStates = activities.map(activity => progress.reviews[activity.id]).filter(Boolean);
  const reviewed = activeReviewStates.length;
  const due = dueActivities().length;
  const weak = needsPracticeGroups().length;
  const totalAttempts = progress.totals.correct + progress.totals.almost + progress.totals.incorrect;
  const recallRate = totalAttempts ? Math.round((progress.totals.correct / totalAttempts) * 100) : 0;
  const stats = [[reviewed, "items practiced"], [due, "due now"], [recallRate + "%", "correct answers"], [weak, "needs practice"]];
  $("#progress-summary").innerHTML = stats.map(([value, label]) => `<div class="stat-card"><span class="value">${value}</span><span class="label">${label}</span></div>`).join("");
  renderNeedsPractice();
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
  });
}

async function init() {
  bindEvents();
  try {
    await loadCurriculum();
    renderCurriculum();
    renderProgress();
  } catch (error) {
    console.error(error);
    $("#curriculum-status").textContent = "The curriculum could not be loaded.";
  }
}

init();
