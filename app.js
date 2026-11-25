// vamp-pomodoro — a night-themed Pomodoro focus timer.
// Pure logic (createTimer/tick/advancePhase, formatTime, stats, tasks) is
// exported for tests; all DOM wiring is guarded so this module can be
// imported under Node. The timer never waits on real time in its logic:
// tick() takes the elapsed seconds as an argument.

export const PHASES = ["focus", "shortBreak", "longBreak"];

export const DEFAULT_SETTINGS = Object.freeze({
  focusSeconds: 25 * 60,
  shortBreakSeconds: 5 * 60,
  longBreakSeconds: 15 * 60,
  cyclesBeforeLongBreak: 4,
});

function positiveInt(value, fallback) {
  const n = Math.floor(Number(value));
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

function normalizeSettings(options = {}) {
  const source = options && typeof options === "object" ? options : {};
  return {
    focusSeconds: positiveInt(source.focusSeconds, DEFAULT_SETTINGS.focusSeconds),
    shortBreakSeconds: positiveInt(source.shortBreakSeconds, DEFAULT_SETTINGS.shortBreakSeconds),
    longBreakSeconds: positiveInt(source.longBreakSeconds, DEFAULT_SETTINGS.longBreakSeconds),
    cyclesBeforeLongBreak: positiveInt(
      source.cyclesBeforeLongBreak,
      DEFAULT_SETTINGS.cyclesBeforeLongBreak,
    ),
  };
}

export function durationForPhase(settings, phase) {
  const normalized = normalizeSettings(settings);
  if (phase === "shortBreak") return normalized.shortBreakSeconds;
  if (phase === "longBreak") return normalized.longBreakSeconds;
  return normalized.focusSeconds;
}

/**
 * Create a fresh timer state machine.
 * State: { phase, status, remainingSeconds, phaseElapsedSeconds,
 *          completedFocusSessions, totalFocusSeconds, settings }
 * status is "idle" | "running" | "paused".
 */
export function createTimer(options = {}) {
  const settings = normalizeSettings(options);
  return {
    phase: "focus",
    status: "idle",
    remainingSeconds: settings.focusSeconds,
    phaseElapsedSeconds: 0,
    completedFocusSessions: 0,
    totalFocusSeconds: 0,
    settings,
  };
}

export function startTimer(timer) {
  return { ...timer, status: "running" };
}

export function pauseTimer(timer) {
  if (timer.status !== "running") return { ...timer };
  return { ...timer, status: "paused" };
}

/** Reset to a fresh focus phase, keeping accumulated stats. */
export function resetTimer(timer) {
  const fresh = createTimer(timer.settings);
  return {
    ...fresh,
    completedFocusSessions: timer.completedFocusSessions,
    totalFocusSeconds: timer.totalFocusSeconds,
  };
}

/** Jump straight to a phase (idle, full duration). Invalid phases are ignored. */
export function setPhase(timer, phase) {
  if (!PHASES.includes(phase)) return { ...timer };
  return {
    ...timer,
    phase,
    status: "idle",
    remainingSeconds: durationForPhase(timer.settings, phase),
    phaseElapsedSeconds: 0,
  };
}

function nextPhaseAfter(timer) {
  if (timer.phase !== "focus") return "focus";
  const completed = timer.completedFocusSessions + 1;
  return completed % timer.settings.cyclesBeforeLongBreak === 0 ? "longBreak" : "shortBreak";
}

/**
 * Complete the current phase and move to the next one.
 * Finishing a focus phase counts it as a completed session; every
 * cyclesBeforeLongBreak-th focus is followed by a long break.
 */
export function advancePhase(timer) {
  const nextPhase = nextPhaseAfter(timer);
  return {
    ...timer,
    phase: nextPhase,
    remainingSeconds: durationForPhase(timer.settings, nextPhase),
    phaseElapsedSeconds: 0,
    completedFocusSessions:
      timer.phase === "focus" ? timer.completedFocusSessions + 1 : timer.completedFocusSessions,
  };
}

/**
 * Advance a running timer by `elapsedSeconds` (injected, so tests never
 * wait). A paused/idle timer is returned unchanged. Overflow past the end
 * of a phase cascades into the following phase(s), and focus time is
 * credited only for the portion spent in a focus phase.
 */
export function tick(timer, elapsedSeconds = 1) {
  if (!timer || timer.status !== "running") return { ...timer };
  let remainingTick = Number(elapsedSeconds);
  if (!Number.isFinite(remainingTick) || remainingTick <= 0) return { ...timer };

  let state = { ...timer };
  while (remainingTick > 0) {
    const step = Math.min(remainingTick, state.remainingSeconds);
    state = {
      ...state,
      remainingSeconds: state.remainingSeconds - step,
      phaseElapsedSeconds: state.phaseElapsedSeconds + step,
      totalFocusSeconds: state.phase === "focus" ? state.totalFocusSeconds + step : state.totalFocusSeconds,
    };
    remainingTick -= step;
    if (state.remainingSeconds === 0) {
      state = advancePhase(state);
    }
  }
  return state;
}

/** Format seconds as MM:SS, or H:MM:SS once past an hour. */
export function formatTime(seconds) {
  const total = Number(seconds);
  if (!Number.isFinite(total) || total <= 0) return "00:00";
  const whole = Math.floor(total);
  const hours = Math.floor(whole / 3600);
  const minutes = Math.floor((whole % 3600) / 60);
  const secs = whole % 60;
  const mm = String(minutes).padStart(2, "0");
  const ss = String(secs).padStart(2, "0");
  return hours > 0 ? `${hours}:${mm}:${ss}` : `${mm}:${ss}`;
}

/** Stats snapshot for a timer state. */
export function getStats(timer) {
  const totalFocusSeconds = Math.max(0, Math.floor(timer?.totalFocusSeconds ?? 0));
  return {
    completedSessions: Math.max(0, Math.floor(timer?.completedFocusSessions ?? 0)),
    totalFocusSeconds,
    totalFocusMinutes: Math.floor(totalFocusSeconds / 60),
  };
}

/**
 * Aggregate stats from a list of session records:
 * { phase: "focus" | "shortBreak" | "longBreak", durationSeconds, completed }.
 * Focus durations always count toward focus time; only focus records with
 * completed === true count as completed sessions.
 */
export function aggregateStats(sessions = []) {
  let completedSessions = 0;
  let totalFocusSeconds = 0;
  let totalBreakSeconds = 0;
  if (Array.isArray(sessions)) {
    for (const session of sessions) {
      if (!session || typeof session !== "object") continue;
      const duration = Math.max(0, Math.floor(Number(session.durationSeconds) || 0));
      if (session.phase === "focus") {
        totalFocusSeconds += duration;
        if (session.completed === true) completedSessions += 1;
      } else if (session.phase === "shortBreak" || session.phase === "longBreak") {
        totalBreakSeconds += duration;
      }
    }
  }
  return {
    completedSessions,
    totalFocusSeconds,
    totalFocusMinutes: Math.floor(totalFocusSeconds / 60),
    totalBreakSeconds,
  };
}

// ---------------------------------------------------------------------------
// Task list operations (all pure: they return a new array)
// ---------------------------------------------------------------------------

export function createTaskList() {
  return [];
}

/** Append a task. Blank titles are ignored. Ids stay unique after removals. */
export function addTask(tasks, title) {
  const list = Array.isArray(tasks) ? tasks : [];
  const clean = typeof title === "string" ? title.trim() : "";
  if (clean === "") return [...list];
  const nextId = list.reduce((max, task) => Math.max(max, Number(task?.id) || 0), 0) + 1;
  return [...list, { id: nextId, title: clean, completed: false }];
}

export function toggleTask(tasks, id) {
  const list = Array.isArray(tasks) ? tasks : [];
  return list.map((task) => (task.id === id ? { ...task, completed: !task.completed } : task));
}

export function completeTask(tasks, id) {
  const list = Array.isArray(tasks) ? tasks : [];
  return list.map((task) => (task.id === id ? { ...task, completed: true } : task));
}

export function removeTask(tasks, id) {
  const list = Array.isArray(tasks) ? tasks : [];
  return list.filter((task) => task.id !== id);
}

export function clearCompleted(tasks) {
  const list = Array.isArray(tasks) ? tasks : [];
  return list.filter((task) => !task.completed);
}

export function taskStats(tasks) {
  const list = Array.isArray(tasks) ? tasks : [];
  const completed = list.filter((task) => task.completed).length;
  return { total: list.length, completed, remaining: list.length - completed };
}

// ---------------------------------------------------------------------------
// Browser UI (skipped under Node / tests)
// ---------------------------------------------------------------------------

const PHASE_LABELS = { focus: "Focus", shortBreak: "Short break", longBreak: "Long break" };

if (typeof document !== "undefined") {
  const timeDisplay = document.querySelector("#time-display");
  const phaseDisplay = document.querySelector("#phase-display");
  const ring = document.querySelector("#ring-progress");
  const startPauseButton = document.querySelector("#start-pause");
  const resetButton = document.querySelector("#reset");
  const nextButton = document.querySelector("#next-phase");
  const phaseButtons = document.querySelectorAll("[data-phase]");
  const statSessions = document.querySelector("#stat-sessions");
  const statMinutes = document.querySelector("#stat-minutes");
  const statCycle = document.querySelector("#stat-cycle");
  const settingsForm = document.querySelector("#settings");
  const taskForm = document.querySelector("#task-form");
  const taskInput = document.querySelector("#task-input");
  const taskListElement = document.querySelector("#task-list");
  const clearCompletedButton = document.querySelector("#clear-completed");

  if (timeDisplay && startPauseButton) {
    let timer = createTimer();
    let tasks = createTaskList();
    let intervalId = null;

    try {
      const saved = JSON.parse(localStorage.getItem("vamp-pomodoro-tasks") ?? "[]");
      if (Array.isArray(saved)) {
        tasks = saved.filter((t) => t && typeof t.title === "string");
      }
    } catch {
      tasks = createTaskList();
    }

    const saveTasks = () => {
      try {
        localStorage.setItem("vamp-pomodoro-tasks", JSON.stringify(tasks));
      } catch {
        // Storage is a nicety; the timer works without it.
      }
    };

    const renderTasks = () => {
      if (!taskListElement) return;
      taskListElement.innerHTML = "";
      for (const task of tasks) {
        const item = document.createElement("li");
        item.className = task.completed ? "task done" : "task";

        const label = document.createElement("label");
        const checkbox = document.createElement("input");
        checkbox.type = "checkbox";
        checkbox.checked = task.completed;
        checkbox.addEventListener("change", () => {
          tasks = toggleTask(tasks, task.id);
          saveTasks();
          renderTasks();
        });
        const text = document.createElement("span");
        text.textContent = task.title;
        label.append(checkbox, text);

        const remove = document.createElement("button");
        remove.type = "button";
        remove.className = "remove-task";
        remove.textContent = "Remove";
        remove.setAttribute("aria-label", `Remove task: ${task.title}`);
        remove.addEventListener("click", () => {
          tasks = removeTask(tasks, task.id);
          saveTasks();
          renderTasks();
        });

        item.append(label, remove);
        taskListElement.append(item);
      }
    };

    const render = () => {
      timeDisplay.textContent = formatTime(timer.remainingSeconds);
      if (phaseDisplay) phaseDisplay.textContent = PHASE_LABELS[timer.phase];
      startPauseButton.textContent = timer.status === "running" ? "Pause" : "Start";
      document.body.dataset.phase = timer.phase;

      const total = durationForPhase(timer.settings, timer.phase);
      const fraction = total > 0 ? timer.remainingSeconds / total : 0;
      if (ring) {
        const circumference = 2 * Math.PI * 90;
        ring.style.strokeDasharray = String(circumference);
        ring.style.strokeDashoffset = String(circumference * (1 - fraction));
      }

      const stats = getStats(timer);
      if (statSessions) statSessions.textContent = String(stats.completedSessions);
      if (statMinutes) statMinutes.textContent = String(stats.totalFocusMinutes);
      if (statCycle) {
        const inCycle = (stats.completedSessions % timer.settings.cyclesBeforeLongBreak) + 1;
        statCycle.textContent = `${inCycle} / ${timer.settings.cyclesBeforeLongBreak}`;
      }

      phaseButtons.forEach((button) => {
        button.classList.toggle("active", button.dataset.phase === timer.phase);
      });
    };

    const stopInterval = () => {
      if (intervalId !== null) {
        clearInterval(intervalId);
        intervalId = null;
      }
    };

    const startInterval = () => {
      stopInterval();
      intervalId = setInterval(() => {
        timer = tick(timer, 1);
        render();
      }, 1000);
    };

    startPauseButton.addEventListener("click", () => {
      if (timer.status === "running") {
        timer = pauseTimer(timer);
        stopInterval();
      } else {
        timer = startTimer(timer);
        startInterval();
      }
      render();
    });

    resetButton?.addEventListener("click", () => {
      timer = resetTimer(timer);
      stopInterval();
      render();
    });

    nextButton?.addEventListener("click", () => {
      timer = advancePhase(timer);
      render();
    });

    phaseButtons.forEach((button) => {
      button.addEventListener("click", () => {
        timer = setPhase(timer, button.dataset.phase);
        stopInterval();
        render();
      });
    });

    settingsForm?.addEventListener("submit", (event) => {
      event.preventDefault();
      const data = new FormData(settingsForm);
      const minutes = (name, fallback) => {
        const value = Number(data.get(name));
        return Number.isFinite(value) && value > 0 ? Math.round(value * 60) : fallback;
      };
      const stats = getStats(timer);
      timer = createTimer({
        focusSeconds: minutes("focus", DEFAULT_SETTINGS.focusSeconds),
        shortBreakSeconds: minutes("shortBreak", DEFAULT_SETTINGS.shortBreakSeconds),
        longBreakSeconds: minutes("longBreak", DEFAULT_SETTINGS.longBreakSeconds),
        cyclesBeforeLongBreak: Number(data.get("cycles")) || DEFAULT_SETTINGS.cyclesBeforeLongBreak,
      });
      timer = {
        ...timer,
        completedFocusSessions: stats.completedSessions,
        totalFocusSeconds: stats.totalFocusSeconds,
      };
      stopInterval();
      render();
    });

    taskForm?.addEventListener("submit", (event) => {
      event.preventDefault();
      tasks = addTask(tasks, taskInput?.value ?? "");
      if (taskInput) taskInput.value = "";
      saveTasks();
      renderTasks();
    });

    clearCompletedButton?.addEventListener("click", () => {
      tasks = clearCompleted(tasks);
      saveTasks();
      renderTasks();
    });

    render();
    renderTasks();
  }
}
