import { gradeAnswer } from "./grading.js";
import { freshReviewState, isDue, scheduleReview } from "./srs.js";
import { clearProgress, exportProgress, loadProgress, saveProgress } from "./storage.js";

const $ = (selector) => document.querySelector(selector);
const $$ = (selector) => [...document.querySelectorAll(selector)];

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
        if (lesson.status === "active") {
          const button = document.createElement("button");
          button.className = "primary-btn";
          button.textContent = "Start lesson";
          button.addEventListener("click", () => startLesson(lesson.id));
          row.appendChild(button);
        }
        lessonList.appendChild(row);
      });
    } else {
      const row = document.createElement("div");
      row.className = "lesson-row";
      row.innerHTML = "<div><strong>Coming next</strong><small>This unit is intentionally not filled with unchecked generated content.</small></div>";
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

function startLesson(lessonId) {
  practiceQueue = activities.filter(activity => activity.lessonId === lessonId);
  switchView("practice");
  showNextActivity();
}

function startDuePractice() {
  let due = dueActivities();
  if (!due.length) due = activities.slice();
  practiceQueue = shuffle(due);
  switchView("practice");
  showNextActivity();
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

function showNextActivity() {
  currentActivity = practiceQueue.shift() || null;
  answerLocked = false;
  resetPracticeUi();

  if (!currentActivity) {
    $("#practice-content").hidden = true;
    $("#practice-empty").hidden = false;
    $("#practice-empty").textContent = "Round complete. These words will return later for more practice.";
    updateDueCount();
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
}

function beginHiddenRecall() {
  if (!currentActivity || currentActivity.type !== "study-hide-recall") return;
  activityStage = "paper";
  $("#study-panel").hidden = true;
  $("#prompt").textContent = "Write the word you just studied.";
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
  $("#prompt").textContent = "Now type the word you studied.";
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
  $("#answer-input").blur();
  $("#check-btn").hidden = true;
  $("#next-btn").hidden = false;
  updateDueCount();
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

function renderProgress() {
  const reviewedStates = Object.values(progress.reviews);
  const reviewed = reviewedStates.length;
  const due = dueActivities().length;
  const lapses = reviewedStates.reduce((sum, state) => sum + (state.lapses || 0), 0);
  const totalAttempts = progress.totals.correct + progress.totals.almost + progress.totals.incorrect;
  const recallRate = totalAttempts ? Math.round((progress.totals.correct / totalAttempts) * 100) : 0;
  const stats = [[reviewed, "items practiced"], [due, "due now"], [recallRate + "%", "correct on first check"], [lapses, "needs more practice"]];
  $("#progress-summary").innerHTML = stats.map(([value, label]) => `<div class="stat-card"><span class="value">${value}</span><span class="label">${label}</span></div>`).join("");
}

function bindEvents() {
  $$(".nav-btn").forEach(btn => btn.addEventListener("click", () => switchView(btn.dataset.view)));
  $("#start-due-btn").addEventListener("click", startDuePractice);
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
