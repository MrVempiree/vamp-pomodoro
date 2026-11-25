import { test } from "node:test";
import assert from "node:assert/strict";

import {
  createTimer,
  startTimer,
  pauseTimer,
  resetTimer,
  setPhase,
  advancePhase,
  tick,
  formatTime,
  getStats,
  aggregateStats,
  addTask,
  toggleTask,
  completeTask,
  removeTask,
  clearCompleted,
  taskStats,
  DEFAULT_SETTINGS,
} from "../app.js";

const FAST = { focusSeconds: 10, shortBreakSeconds: 3, longBreakSeconds: 8, cyclesBeforeLongBreak: 4 };

test("createTimer starts idle in a full focus phase", () => {
  const timer = createTimer();
  assert.equal(timer.phase, "focus");
  assert.equal(timer.status, "idle");
  assert.equal(timer.remainingSeconds, DEFAULT_SETTINGS.focusSeconds);
  assert.equal(timer.completedFocusSessions, 0);
  assert.equal(timer.totalFocusSeconds, 0);
});

test("createTimer accepts custom settings and rejects invalid ones", () => {
  const timer = createTimer(FAST);
  assert.equal(timer.remainingSeconds, 10);
  const fallback = createTimer({ focusSeconds: -5, cyclesBeforeLongBreak: 0 });
  assert.equal(fallback.remainingSeconds, DEFAULT_SETTINGS.focusSeconds);
  assert.equal(fallback.settings.cyclesBeforeLongBreak, DEFAULT_SETTINGS.cyclesBeforeLongBreak);
});

test("tick does nothing while idle or paused", () => {
  const idle = createTimer(FAST);
  assert.equal(tick(idle, 5).remainingSeconds, 10);
  const paused = pauseTimer(startTimer(createTimer(FAST)));
  assert.equal(paused.status, "paused");
  assert.equal(tick(paused, 5).remainingSeconds, 10);
});

test("tick decrements a running timer and credits focus time", () => {
  const running = startTimer(createTimer(FAST));
  const after = tick(running, 4);
  assert.equal(after.remainingSeconds, 6);
  assert.equal(after.phaseElapsedSeconds, 4);
  assert.equal(after.totalFocusSeconds, 4);
  assert.equal(after.phase, "focus");
});

test("tick transitions focus to short break when time runs out", () => {
  const running = startTimer(createTimer(FAST));
  const after = tick(running, 10);
  assert.equal(after.phase, "shortBreak");
  assert.equal(after.remainingSeconds, FAST.shortBreakSeconds);
  assert.equal(after.completedFocusSessions, 1);
  assert.equal(after.totalFocusSeconds, 10);
});

test("tick cascades overflow into the next phase", () => {
  const running = startTimer(createTimer(FAST));
  const after = tick(running, 12); // 10s focus + 2s of the break
  assert.equal(after.phase, "shortBreak");
  assert.equal(after.remainingSeconds, 1);
  assert.equal(after.totalFocusSeconds, 10); // break time is not focus time
});

test("the fourth completed focus is followed by a long break", () => {
  let timer = startTimer(createTimer(FAST));
  for (let session = 0; session < 3; session += 1) {
    timer = tick(timer, FAST.focusSeconds);
    assert.equal(timer.phase, "shortBreak");
    timer = tick(timer, FAST.shortBreakSeconds);
    assert.equal(timer.phase, "focus");
  }
  timer = tick(timer, FAST.focusSeconds);
  assert.equal(timer.completedFocusSessions, 4);
  assert.equal(timer.phase, "longBreak");
  assert.equal(timer.remainingSeconds, FAST.longBreakSeconds);
});

test("advancePhase completes the current phase and counts focus sessions", () => {
  const timer = createTimer(FAST);
  const onBreak = advancePhase(timer);
  assert.equal(onBreak.phase, "shortBreak");
  assert.equal(onBreak.completedFocusSessions, 1);
  const backToFocus = advancePhase(onBreak);
  assert.equal(backToFocus.phase, "focus");
  assert.equal(backToFocus.completedFocusSessions, 1);
});

test("setPhase jumps to a phase and ignores invalid phases", () => {
  const timer = setPhase(createTimer(FAST), "longBreak");
  assert.equal(timer.phase, "longBreak");
  assert.equal(timer.remainingSeconds, FAST.longBreakSeconds);
  assert.equal(timer.status, "idle");
  assert.equal(setPhase(timer, "nap").phase, "longBreak");
});

test("resetTimer returns to focus but keeps stats", () => {
  let timer = startTimer(createTimer(FAST));
  timer = tick(timer, FAST.focusSeconds);
  const reset = resetTimer(timer);
  assert.equal(reset.phase, "focus");
  assert.equal(reset.status, "idle");
  assert.equal(reset.remainingSeconds, FAST.focusSeconds);
  assert.equal(reset.completedFocusSessions, 1);
  assert.equal(reset.totalFocusSeconds, FAST.focusSeconds);
});

test("formatTime renders MM:SS and H:MM:SS", () => {
  assert.equal(formatTime(0), "00:00");
  assert.equal(formatTime(9), "00:09");
  assert.equal(formatTime(65), "01:05");
  assert.equal(formatTime(1500), "25:00");
  assert.equal(formatTime(3661), "1:01:01");
  assert.equal(formatTime(-30), "00:00");
  assert.equal(formatTime(Number.NaN), "00:00");
});

test("getStats reports completed sessions and whole focus minutes", () => {
  let timer = startTimer(createTimer({ focusSeconds: 90, shortBreakSeconds: 10 }));
  timer = tick(timer, 90);
  assert.deepEqual(getStats(timer), {
    completedSessions: 1,
    totalFocusSeconds: 90,
    totalFocusMinutes: 1,
  });
});

test("aggregateStats sums focus and break records", () => {
  const stats = aggregateStats([
    { phase: "focus", durationSeconds: 1500, completed: true },
    { phase: "shortBreak", durationSeconds: 300, completed: true },
    { phase: "focus", durationSeconds: 1500, completed: true },
    { phase: "focus", durationSeconds: 600, completed: false },
    { phase: "longBreak", durationSeconds: 900, completed: true },
    { phase: "mystery", durationSeconds: 999, completed: true },
    null,
  ]);
  assert.deepEqual(stats, {
    completedSessions: 2,
    totalFocusSeconds: 3600,
    totalFocusMinutes: 60,
    totalBreakSeconds: 1200,
  });
  assert.deepEqual(aggregateStats(), {
    completedSessions: 0,
    totalFocusSeconds: 0,
    totalFocusMinutes: 0,
    totalBreakSeconds: 0,
  });
});

test("addTask trims titles, ignores blanks and assigns unique ids", () => {
  let tasks = addTask([], "  Write chapter  ");
  assert.deepEqual(tasks, [{ id: 1, title: "Write chapter", completed: false }]);
  tasks = addTask(tasks, "   ");
  assert.equal(tasks.length, 1);
  tasks = addTask(tasks, "Review");
  tasks = removeTask(tasks, 1);
  tasks = addTask(tasks, "Ship");
  assert.deepEqual(
    tasks.map((t) => t.id),
    [2, 3],
  );
});

test("toggleTask and completeTask update completion without mutating input", () => {
  const tasks = addTask([], "Hunt bugs");
  const toggled = toggleTask(tasks, 1);
  assert.equal(toggled[0].completed, true);
  assert.equal(tasks[0].completed, false);
  assert.equal(toggleTask(toggled, 1)[0].completed, false);
  assert.equal(completeTask(tasks, 1)[0].completed, true);
  assert.equal(completeTask(tasks, 99)[0].completed, false);
});

test("removeTask, clearCompleted and taskStats behave", () => {
  let tasks = addTask(addTask(addTask([], "a"), "b"), "c");
  tasks = completeTask(tasks, 2);
  assert.deepEqual(taskStats(tasks), { total: 3, completed: 1, remaining: 2 });
  tasks = clearCompleted(tasks);
  assert.deepEqual(
    tasks.map((t) => t.title),
    ["a", "c"],
  );
  tasks = removeTask(tasks, 1);
  assert.deepEqual(
    tasks.map((t) => t.title),
    ["c"],
  );
  assert.deepEqual(taskStats([]), { total: 0, completed: 0, remaining: 0 });
});
