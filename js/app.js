import { gradeAnswer } from "./grading.js";
import { freshReviewState, isDue, scheduleReview } from "./srs.js";
import { clearProgress, exportProgress, loadProgress, saveProgress } from "./storage.js";

const $ = (selector) => document.querySelector(selector);
const $$ = (selector) => [...document.querySelectorAll(selector)];

let curriculum = null;
let progress = loadProgress();
let activities = [];
let lessonMap = new Map();
let practiceQueue = [];
let currentActivity = null;
let answerLocked = false;

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
  lessonMap = new Map();

  for (const unit of curriculum.units) {
    for (const lessonSummary of unit.lessons || []) {
      if (lessonSummary.status !== "active" || !lessonSummary.path) continue;
      const lesson = await loadJson(lessonSummary.path);
      lessonMap.set(lesson.id, { ...lesson, unitId: unit.id, unitTitle: unit.title });
      lesson.activities.forEach(activity => {
        activities.push({
          ...activity,
          lessonId: lesson.id,
          lessonTitle: lesson.title,
          focus: lesson.focus || []
        });
      });
    }
  }
}

function renderCurriculum() {
  const list = $("#unit-list");
  list.innerHTML = "";

  curriculum.units
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
            <p class="section-kicker">Unit ${escapeHtml(String(unit.order || ""))}</p>
            <h3>${escapeHtml(unit.title)}</h3>
            <p>${escapeHtml(unit.description)}</p>
          </div>
          <span class="tag">${planned ? "planned" : "active"}</span>
        </div>
        ${outcomes ? `<details><summary>What this unit builds</summary><ul>${outcomes}</ul></details>` : ""}
        <div class="lesson-list"></div>
      `;

      const lessonList = card.querySelector(".lesson-list");
      if (unit.lessons?.length) {
        unit.lessons.forEach(lesson => {
          const row = document.createElement("div");
          row.className = "lesson-row";
          row.innerHTML = `
            <div>
              <strong>${escapeHtml(lesson.title)}</strong>
              <small>${escapeHtml(lesson.summary || "")}</small>
            </div>
          `;
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

  $("#curriculum-status").textContent = `${activities.length} starter activities loaded. More material will be added only as it is reviewed and structured.`;
  updateDueCount();
}

function escapeHtml(value = "") {
  const el = document.createElement("span");
  el.textContent = value;
  return el.innerHTML;
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
  const lessonActivities = activities.filter(activity => activity.lessonId === lessonId);
  practiceQueue = lessonActivities.slice();
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

function showNextActivity() {
  currentActivity = practiceQueue.shift() || null;
  answerLocked = false;

  if (!currentActivity) {
    $("#answer-input")?.blur();
    $("#practice-content").hidden = true;
    $("#practice-empty").hidden = false;
    $("#practice-empty").textContent = "Round complete. Your next reviews will appear here when they are due.";
    updateDueCount();
    return;
  }

  $("#practice-empty").hidden = true;
  $("#practice-content").hidden = false;
  $("#activity-type").textContent = currentActivity.type.replaceAll("-", " ");
  $("#activity-focus").textContent = currentActivity.focus.join(" • ");
  $("#instruction").textContent = currentActivity.instruction || "Type your answer.";
  $("#prompt").textContent = currentActivity.prompt;
  $("#support").textContent = currentActivity.support || "";
  $("#answer-input").value = "";
  $("#answer-input").disabled = false;
  $("#check-btn").hidden = false;
  $("#next-btn").hidden = true;
  $("#feedback").hidden = true;
  $("#feedback").className = "feedback";
  $("#feedback").innerHTML = "";

  // Do not autofocus the answer field. On phones, autofocus opens the
  // system keyboard immediately and hides the lesson content above it.
  // The keyboard should appear only after the learner taps the text field.
  $("#answer-input").blur();
}

function feedbackTitle(status) {
  if (status === "correct") return "Correct";
  if (status === "almost") return "Almost — check the Hawaiian spelling";
  return "Not yet";
}

function checkCurrentAnswer() {
  if (!currentActivity || answerLocked) return;
  const given = $("#answer-input").value;
  if (!given.trim()) return;

  const result = gradeAnswer(
    given,
    currentActivity.answer,
    currentActivity.answerLanguage || "haw",
    currentActivity.alternatives || []
  );

  answerLocked = true;
  progress.reviews[currentActivity.id] = scheduleReview(
    progress.reviews[currentActivity.id],
    result.status
  );
  progress.totals[result.status] = (progress.totals[result.status] || 0) + 1;
  saveProgress(progress);

  const feedback = $("#feedback");
  feedback.hidden = false;
  feedback.className = `feedback ${result.status}`;

  const notes = (result.notes || []).map(note => `<li>${escapeHtml(note)}</li>`).join("");
  const explanation = currentActivity.explanation
    ? `<p>${escapeHtml(currentActivity.explanation)}</p>`
    : "";

  feedback.innerHTML = `
    <strong>${feedbackTitle(result.status)}</strong>
    ${notes ? `<ul>${notes}</ul>` : ""}
    ${result.status !== "correct" ? `<div class="expected-answer" lang="haw">Expected: ${escapeHtml(result.expected)}</div>` : ""}
    ${explanation}
  `;

  $("#answer-input").disabled = true;
  $("#check-btn").hidden = true;
  $("#next-btn").hidden = false;
  updateDueCount();
}

function insertCharacter(character) {
  const input = $("#answer-input");
  if (input.disabled) return;
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

  const stats = [
    [reviewed, "items reviewed"],
    [due, "due now"],
    [totalAttempts, "total attempts"],
    [lapses, "full misses"]
  ];

  $("#progress-summary").innerHTML = stats.map(([value, label]) => `
    <div class="stat-card">
      <span class="value">${value}</span>
      <span class="label">${label}</span>
    </div>
  `).join("");
}

function bindEvents() {
  $$(".nav-btn").forEach(btn => btn.addEventListener("click", () => switchView(btn.dataset.view)));
  $("#start-due-btn").addEventListener("click", startDuePractice);
  $("#check-btn").addEventListener("click", checkCurrentAnswer);
  $("#next-btn").addEventListener("click", showNextActivity);
  $("#answer-input").addEventListener("keydown", event => {
    if (event.key !== "Enter") return;
    event.preventDefault();
    if (answerLocked) showNextActivity();
    else checkCurrentAnswer();
  });
  $$(".hawaiian-keyboard button").forEach(btn => {
    btn.addEventListener("click", () => insertCharacter(btn.dataset.char));
  });
  $("#export-btn").addEventListener("click", () => exportProgress(progress));
  $("#reset-btn").addEventListener("click", () => {
    const confirmed = window.confirm("Reset all local review history for this app?");
    if (!confirmed) return;
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
    $("#curriculum-status").textContent = "The curriculum could not be loaded. If you opened index.html directly, run the project through a local web server instead.";
  }
}

init();
