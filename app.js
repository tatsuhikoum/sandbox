(function () {
  const KEY = "kijo.v1";
  const MAX_ITEMS = 20;
  const MAX_TEXT = 80;
  const MAX_NOTE = 2000;
  const MIN_MINUTES = 1;
  const MAX_MINUTES = 180;
  const TIME_ZONE = "Asia/Tokyo";

  const PRESETS = [
    { id: "25", seconds: 25 * 60 },
    { id: "5", seconds: 5 * 60 },
    { id: "15", seconds: 15 * 60 },
  ];

  const SAMPLE_ITEMS = [
    { text: "提案の見出しを3つ書く", done: false },
    { text: "届いている確認を返す", done: true },
    { text: "明日の最初の30分を決める", done: false },
  ];

  const SAMPLE_NOTE =
    "午後は深い作業に使う。通知は、タイマーが終わるまで閉じる。";

  const $ = (id) => document.getElementById(id);

  const els = {
    clockHm: $("clock-hm"),
    clockS: $("clock-s"),
    dateLine: $("date-line"),
    timerDisplay: $("timer-display"),
    timerStatus: $("timer-status"),
    timerDone: $("timer-done"),
    timerToggle: $("timer-toggle"),
    timerReset: $("timer-reset"),
    doneActions: $("timer-done-actions"),
    breakButton: $("break-button"),
    againButton: $("again-button"),
    customForm: $("custom-form"),
    customMinutes: $("custom-minutes"),
    customApply: $("custom-apply"),
    timerMessage: $("timer-message"),
    sampleBanner: $("sample-banner"),
    progressText: $("progress-text"),
    meter: $("meter"),
    meterBar: $("meter-bar"),
    list: $("focus-list"),
    empty: $("empty-focus"),
    addForm: $("add-form"),
    addInput: $("add-input"),
    listMessage: $("list-message"),
    note: $("note"),
    clearStart: $("clear-start"),
    clearConfirm: $("clear-confirm"),
    clearDo: $("clear-do"),
    clearCancel: $("clear-cancel"),
    sampleStart: $("sample-start"),
    sampleConfirm: $("sample-confirm"),
    sampleDo: $("sample-do"),
    sampleCancel: $("sample-cancel"),
  };

  let state = load();
  let audioCtx = null;
  let listMessage = "";
  let timerMessage = "";

  function sampleItems() {
    return SAMPLE_ITEMS.map((item) => ({
      id: uid(),
      text: item.text,
      done: item.done,
    }));
  }

  function freshTimer() {
    return {
      presetId: "25",
      duration: 25 * 60,
      remaining: 25 * 60,
      phase: "idle",
      endsAt: null,
    };
  }

  function sampleState() {
    return {
      version: 1,
      sample: true,
      items: sampleItems(),
      note: SAMPLE_NOTE,
      timer: freshTimer(),
    };
  }

  function uid() {
    if (window.crypto && typeof window.crypto.randomUUID === "function") {
      return window.crypto.randomUUID();
    }
    return "id-" + Date.now().toString(36) + "-" + Math.random().toString(36).slice(2);
  }

  function clampText(value, max) {
    return String(value ?? "").slice(0, max);
  }

  function normalize(data) {
    const timer = data.timer || {};
    const duration = clampDuration(timer.duration, 25 * 60);
    let remaining = clampRemaining(timer.remaining, duration);
    let phase = ["idle", "running", "paused", "done"].includes(timer.phase)
      ? timer.phase
      : "idle";
    let endsAt = Number.isFinite(timer.endsAt) ? timer.endsAt : null;

    if (phase === "running" && endsAt) {
      remaining = Math.max(0, Math.ceil((endsAt - Date.now()) / 1000));
      if (remaining <= 0) {
        phase = "done";
        remaining = 0;
        endsAt = null;
      }
    } else if (phase === "done") {
      remaining = 0;
      endsAt = null;
    } else {
      endsAt = null;
      if (phase === "idle") remaining = duration;
    }

    const presetId = PRESETS.some((preset) => preset.id === timer.presetId)
      ? timer.presetId
      : "custom";

    const items = Array.isArray(data.items)
      ? data.items.slice(0, MAX_ITEMS).map((item) => ({
          id: typeof item.id === "string" && item.id ? item.id : uid(),
          text: clampText(item.text, MAX_TEXT).trim(),
          done: Boolean(item.done),
        })).filter((item) => item.text)
      : sampleItems();

    return {
      version: 1,
      sample: Boolean(data.sample),
      items,
      note: clampText(data.note, MAX_NOTE),
      timer: { presetId, duration, remaining, phase, endsAt },
    };
  }

  function clampDuration(value, fallback) {
    const number = Number(value);
    if (!Number.isFinite(number)) return fallback;
    return Math.min(MAX_MINUTES * 60, Math.max(MIN_MINUTES * 60, Math.round(number)));
  }

  function clampRemaining(value, duration) {
    const number = Number(value);
    if (!Number.isFinite(number)) return duration;
    return Math.min(duration, Math.max(0, Math.round(number)));
  }

  function load() {
    try {
      const raw = localStorage.getItem(KEY);
      if (!raw) return sampleState();
      return normalize(JSON.parse(raw));
    } catch {
      return sampleState();
    }
  }

  function persist() {
    try {
      localStorage.setItem(KEY, JSON.stringify(state));
    } catch {
      timerMessage = "このブラウザには保存できませんでした。";
      setText(els.timerMessage, timerMessage);
    }
  }

  function touchContent() {
    if (state.sample) {
      state.sample = false;
      renderBanner();
    }
  }

  function remainingNow() {
    const timer = state.timer;
    if (timer.phase === "running" && timer.endsAt) {
      return Math.max(0, Math.ceil((timer.endsAt - Date.now()) / 1000));
    }
    return timer.remaining;
  }

  function formatClock(total) {
    const safe = Math.max(0, total);
    const minutes = Math.floor(safe / 60);
    const seconds = safe % 60;
    return String(minutes).padStart(2, "0") + ":" + String(seconds).padStart(2, "0");
  }

  function setText(node, text) {
    if (node.textContent !== text) node.textContent = text;
  }

  function show(node, visible) {
    node.hidden = !visible;
  }

  function renderClock() {
    const parts = new Intl.DateTimeFormat("ja-JP", {
      timeZone: TIME_ZONE,
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hourCycle: "h23",
    }).formatToParts(new Date());
    const pick = (type) => parts.find((part) => part.type === type)?.value || "--";
    setText(els.clockHm, pick("hour") + ":" + pick("minute"));
    setText(els.clockS, pick("second"));
    setText(
      els.dateLine,
      new Intl.DateTimeFormat("ja-JP", {
        timeZone: TIME_ZONE,
        year: "numeric",
        month: "long",
        day: "numeric",
        weekday: "long",
      }).format(new Date())
    );
    els.clockHm.parentElement.setAttribute(
      "aria-label",
      "東京 " + els.dateLine.textContent + " " + els.clockHm.textContent
    );
    els.clockHm.parentElement.removeAttribute("aria-hidden");
  }

  function renderBanner() {
    show(els.sampleBanner, state.sample);
  }

  function progressCopy(done, total) {
    if (total === 0) return "焦点はまだありません";
    if (done === 0) return "まだ手を付けていません";
    if (done === total) return "今日の焦点は終わりました";
    return total + "件中" + done + "件まで進みました";
  }

  function renderProgress() {
    const total = state.items.length;
    const done = state.items.filter((item) => item.done).length;
    setText(els.progressText, progressCopy(done, total));
    show(els.meter, total > 0);
    els.meter.setAttribute("aria-valuemax", String(total));
    els.meter.setAttribute("aria-valuenow", String(done));
    els.meterBar.style.width = total === 0 ? "0" : (done / total) * 100 + "%";
    show(els.empty, total === 0);
  }

  function checkLabel(item) {
    return item.text + (item.done ? "の完了を外す" : "を完了にする");
  }

  function renderList() {
    els.list.replaceChildren();
    state.items.forEach((item) => {
      const li = document.createElement("li");
      li.className = "focus-item" + (item.done ? " is-done" : "");
      li.dataset.id = item.id;

      const check = document.createElement("input");
      check.type = "checkbox";
      check.className = "focus-check";
      check.checked = item.done;
      check.setAttribute("aria-label", checkLabel(item));

      const text = document.createElement("button");
      text.type = "button";
      text.className = "focus-text";
      text.textContent = item.text;
      text.title = "クリックして書き換える";

      const del = document.createElement("button");
      del.type = "button";
      del.className = "focus-delete";
      del.textContent = "消す";
      del.setAttribute("aria-label", item.text + "を消す");

      li.append(check, text, del);
      els.list.append(li);
    });
  }

  function statusCopy(phase) {
    if (phase === "running") return "集中中";
    if (phase === "paused") return "止めています";
    if (phase === "done") return "区切りです";
    return "待機中";
  }

  function toggleCopy(phase) {
    if (phase === "running") return "一時停止";
    if (phase === "paused") return "続ける";
    return "始める";
  }

  function renderTimer() {
    const timer = state.timer;
    const remaining = remainingNow();
    setText(els.timerDisplay, formatClock(remaining));
    setText(els.timerStatus, statusCopy(timer.phase));
    setText(els.timerToggle, toggleCopy(timer.phase));
    show(els.timerDone, timer.phase === "done");
    show(els.timerToggle, timer.phase !== "done");
    show(els.timerReset, timer.phase === "running" || timer.phase === "paused");
    show(els.doneActions, timer.phase === "done");

    const locked = timer.phase === "running";
    document.querySelectorAll(".preset").forEach((button) => {
      const selected = button.dataset.preset === timer.presetId;
      button.setAttribute("aria-pressed", selected ? "true" : "false");
      button.disabled = locked;
    });
    els.customMinutes.disabled = locked;
    els.customApply.disabled = locked;
    setText(els.timerMessage, timerMessage);

    const title =
      timer.phase === "running" ? formatClock(remaining) + " 机上" : "机上";
    if (document.title !== title) document.title = title;

    els.timerDisplay.setAttribute(
      "aria-label",
      "残り " + formatClock(remaining)
    );
  }

  function render() {
    renderClock();
    renderBanner();
    renderProgress();
    renderList();
    renderTimer();
    if (document.activeElement !== els.note && els.note.value !== state.note) {
      els.note.value = state.note;
    }
    setText(els.listMessage, listMessage);
  }

  function commitTimerTick() {
    const timer = state.timer;
    if (timer.phase !== "running" || !timer.endsAt) return;
    const remaining = remainingNow();
    if (remaining <= 0) {
      timer.phase = "done";
      timer.remaining = 0;
      timer.endsAt = null;
      persist();
      chime();
      renderTimer();
      return;
    }
    timer.remaining = remaining;
    renderTimer();
  }

  function ensureAudio() {
    const Ctx = window.AudioContext || window.webkitAudioContext;
    if (!Ctx) return null;
    if (!audioCtx) audioCtx = new Ctx();
    if (audioCtx.state === "suspended") audioCtx.resume();
    return audioCtx;
  }

  function chime() {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    try {
      const ctx = ensureAudio();
      if (!ctx) return;
      const now = ctx.currentTime;
      [523.25, 659.25].forEach((freq, index) => {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = "sine";
        osc.frequency.value = freq;
        const start = now + index * 0.12;
        gain.gain.setValueAtTime(0.0001, start);
        gain.gain.exponentialRampToValueAtTime(0.05, start + 0.03);
        gain.gain.exponentialRampToValueAtTime(0.0001, start + 0.45);
        osc.connect(gain).connect(ctx.destination);
        osc.start(start);
        osc.stop(start + 0.5);
      });
    } catch {
      // 音が出せない環境でも、画面の区切りはそのまま出す。
    }
  }

  function startOrPause() {
    const timer = state.timer;
    timerMessage = "";
    if (timer.phase === "running") {
      timer.remaining = remainingNow();
      timer.endsAt = null;
      timer.phase = "paused";
      persist();
      renderTimer();
      return;
    }
    if (timer.phase === "done") return;
    ensureAudio();
    timer.endsAt = Date.now() + timer.remaining * 1000;
    timer.phase = "running";
    persist();
    renderTimer();
  }

  function resetTimer() {
    const timer = state.timer;
    timer.remaining = timer.duration;
    timer.endsAt = null;
    timer.phase = "idle";
    timerMessage = "";
    persist();
    renderTimer();
  }

  function applyDuration(seconds, presetId) {
    if (state.timer.phase === "running") return;
    state.timer.duration = seconds;
    state.timer.remaining = seconds;
    state.timer.presetId = presetId;
    state.timer.phase = "idle";
    state.timer.endsAt = null;
    timerMessage = "";
    persist();
    renderTimer();
  }

  function beginSpan(seconds, presetId) {
    ensureAudio();
    state.timer.duration = seconds;
    state.timer.remaining = seconds;
    state.timer.presetId = presetId;
    state.timer.endsAt = Date.now() + seconds * 1000;
    state.timer.phase = "running";
    timerMessage = "";
    persist();
    renderTimer();
  }

  function findItem(id) {
    return state.items.find((item) => item.id === id);
  }

  function closeConfirms() {
    show(els.clearConfirm, false);
    show(els.sampleConfirm, false);
    show(els.clearStart, true);
    show(els.sampleStart, true);
  }

  els.timerToggle.addEventListener("click", startOrPause);
  els.timerReset.addEventListener("click", resetTimer);
  els.breakButton.addEventListener("click", () => beginSpan(5 * 60, "5"));
  els.againButton.addEventListener("click", () =>
    beginSpan(state.timer.duration, state.timer.presetId)
  );

  document.querySelectorAll(".preset").forEach((button) => {
    button.addEventListener("click", () => {
      const preset = PRESETS.find((item) => item.id === button.dataset.preset);
      if (!preset) return;
      applyDuration(preset.seconds, preset.id);
      els.customMinutes.value = String(preset.seconds / 60);
    });
  });

  els.customForm.addEventListener("submit", (event) => {
    event.preventDefault();
    const minutes = Number(els.customMinutes.value);
    if (!Number.isInteger(minutes) || minutes < MIN_MINUTES || minutes > MAX_MINUTES) {
      timerMessage = "1から180までの整数にしてください。";
      renderTimer();
      return;
    }
    applyDuration(minutes * 60, "custom");
  });

  els.addForm.addEventListener("submit", (event) => {
    event.preventDefault();
    const text = els.addInput.value.trim();
    if (!text) {
      listMessage = "文を書いてから加えてください。";
      setText(els.listMessage, listMessage);
      return;
    }
    if (state.items.length >= MAX_ITEMS) {
      listMessage = "焦点は" + MAX_ITEMS + "件までです。";
      setText(els.listMessage, listMessage);
      return;
    }
    state.items.push({ id: uid(), text: clampText(text, MAX_TEXT), done: false });
    els.addInput.value = "";
    listMessage = "";
    touchContent();
    persist();
    renderProgress();
    renderList();
    setText(els.listMessage, listMessage);
  });

  els.list.addEventListener("change", (event) => {
    const target = event.target;
    if (!(target instanceof HTMLInputElement) || !target.classList.contains("focus-check")) {
      return;
    }
    const item = findItem(target.closest(".focus-item")?.dataset.id);
    if (!item) return;
    item.done = target.checked;
    touchContent();
    persist();
    target.closest(".focus-item").classList.toggle("is-done", item.done);
    target.setAttribute("aria-label", checkLabel(item));
    renderProgress();
  });

  els.list.addEventListener("click", (event) => {
    const target = event.target;
    if (!(target instanceof HTMLElement)) return;
    const row = target.closest(".focus-item");
    if (!row) return;
    const item = findItem(row.dataset.id);
    if (!item) return;

    if (target.classList.contains("focus-delete")) {
      state.items = state.items.filter((entry) => entry.id !== item.id);
      listMessage = "";
      touchContent();
      persist();
      renderProgress();
      renderList();
      setText(els.listMessage, "");
      return;
    }

    if (target.classList.contains("focus-text")) {
      const input = document.createElement("input");
      input.type = "text";
      input.className = "focus-edit";
      input.value = item.text;
      input.maxLength = MAX_TEXT;
      input.setAttribute("aria-label", "焦点を書き換える");
      target.replaceWith(input);
      input.focus();
      input.select();

      const finish = (commit) => {
        if (!input.isConnected) return;
        const next = input.value.trim();
        if (commit && next && next !== item.text) {
          item.text = clampText(next, MAX_TEXT);
          touchContent();
          persist();
        }
        renderList();
        renderProgress();
      };

      input.addEventListener("keydown", (keyEvent) => {
        if (keyEvent.key === "Enter") {
          keyEvent.preventDefault();
          finish(true);
        } else if (keyEvent.key === "Escape") {
          finish(false);
        }
      });
      input.addEventListener("blur", () => finish(true));
    }
  });

  els.note.addEventListener("input", () => {
    state.note = clampText(els.note.value, MAX_NOTE);
    touchContent();
    persist();
  });

  els.clearStart.addEventListener("click", () => {
    show(els.sampleConfirm, false);
    show(els.sampleStart, true);
    show(els.clearStart, false);
    show(els.clearConfirm, true);
    els.clearDo.focus();
  });

  els.clearCancel.addEventListener("click", () => {
    closeConfirms();
    els.clearStart.focus();
  });

  els.clearDo.addEventListener("click", () => {
    state.items = [];
    state.note = "";
    state.sample = false;
    listMessage = "";
    els.note.value = "";
    closeConfirms();
    persist();
    renderBanner();
    renderProgress();
    renderList();
    setText(els.listMessage, "");
  });

  els.sampleStart.addEventListener("click", () => {
    show(els.clearConfirm, false);
    show(els.clearStart, true);
    show(els.sampleStart, false);
    show(els.sampleConfirm, true);
    els.sampleDo.focus();
  });

  els.sampleCancel.addEventListener("click", () => {
    closeConfirms();
    els.sampleStart.focus();
  });

  els.sampleDo.addEventListener("click", () => {
    state.items = sampleItems();
    state.note = SAMPLE_NOTE;
    state.sample = true;
    listMessage = "";
    els.note.value = state.note;
    closeConfirms();
    persist();
    render();
  });

  render();
  window.setInterval(() => {
    renderClock();
    commitTimerTick();
  }, 250);
})();
