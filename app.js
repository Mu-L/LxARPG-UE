const DEFAULT_OPTIONS = ["火锅", "烧烤", "日料", "面食", "轻食", "家常菜"];
const COLORS = ["#ff6b46", "#ffad3d", "#ffd166", "#65c28d", "#54a7d9", "#7d76d8", "#bf70c8", "#ef709d"];
const OPTION_COOKIE = "food_wheel_options";
const HISTORY_COOKIE = "food_wheel_history";
const MAX_OPTIONS = 16;
const MAX_HISTORY = 30;

/** 页面运行状态。 */
const state = {
  /** 当前有效候选项。 */
  options: readCookie(OPTION_COOKIE, DEFAULT_OPTIONS),
  /** 已产生的历史结果。 */
  history: fitHistoryForCookie(readCookie(HISTORY_COOKIE, [])),
  /** 转盘累计旋转角度。 */
  rotation: 0,
  /** 转盘是否正在转动。 */
  spinning: false,
  /** 本次预选结果下标。 */
  pendingIndex: null,
};

const elements = {
  wheel: document.querySelector("#wheel"),
  wheelStage: document.querySelector("#wheel-stage"),
  spinButton: document.querySelector("#spin-button"),
  spinText: document.querySelector("#spin-text"),
  form: document.querySelector("#add-form"),
  input: document.querySelector("#food-option"),
  optionList: document.querySelector("#option-list"),
  optionCount: document.querySelector("#option-count"),
  clearOptions: document.querySelector("#clear-options"),
  historyList: document.querySelector("#history-list"),
  clearHistory: document.querySelector("#clear-history"),
  toast: document.querySelector("#toast"),
  backdrop: document.querySelector("#result-backdrop"),
  resultTitle: document.querySelector("#result-title"),
  modalClose: document.querySelector("#modal-close"),
  modalAction: document.querySelector("#modal-action"),
};

let noticeTimer = null;

/** 从 Cookie 读取 JSON 数据。 */
function readCookie(name, fallback) {
  const prefix = `${name}=`;
  const row = document.cookie.split("; ").find((item) => item.startsWith(prefix));
  if (!row) return fallback;
  try {
    return JSON.parse(decodeURIComponent(row.slice(prefix.length)));
  } catch {
    return fallback;
  }
}

/** 将 JSON 数据保存到一年有效期的 Cookie。 */
function writeCookie(name, value) {
  const expires = new Date();
  expires.setFullYear(expires.getFullYear() + 1);
  document.cookie = `${name}=${encodeURIComponent(JSON.stringify(value))}; expires=${expires.toUTCString()}; path=/; SameSite=Lax`;
}

/** 裁剪历史记录以适配单个 Cookie 的安全容量。 */
function fitHistoryForCookie(items) {
  const fitted = Array.isArray(items) ? items.slice(0, MAX_HISTORY) : [];
  while (fitted.length > 1 && encodeURIComponent(JSON.stringify(fitted)).length > 3500) fitted.pop();
  return fitted;
}

/** 创建本地唯一标识。 */
function createId() {
  return crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

/** 生成随机候选项下标。 */
function getRandomIndex(length) {
  if (crypto.getRandomValues) {
    const values = new Uint32Array(1);
    crypto.getRandomValues(values);
    return values[0] % length;
  }
  return Math.floor(Math.random() * length);
}

/** 格式化历史记录时间。 */
function formatTime(value) {
  return new Intl.DateTimeFormat("zh-CN", {
    month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false,
  }).format(new Date(value));
}

/** 显示短暂的操作提示。 */
function showNotice(message) {
  elements.toast.textContent = message;
  elements.toast.hidden = false;
  clearTimeout(noticeTimer);
  noticeTimer = setTimeout(() => { elements.toast.hidden = true; }, 2200);
}

/** 创建仅包含文本的元素，避免插入不可信 HTML。 */
function createTextElement(tag, className, text) {
  const element = document.createElement(tag);
  element.className = className;
  element.textContent = text;
  return element;
}

/** 根据状态重新绘制转盘。 */
function renderWheel() {
  const hub = elements.wheel.querySelector(".wheel-hub");
  elements.wheel.replaceChildren();
  const angle = state.options.length ? 360 / state.options.length : 360;

  if (state.options.length) {
    elements.wheel.style.background = `conic-gradient(${state.options.map((_, index) => `${COLORS[index % COLORS.length]} ${index * angle}deg ${(index + 1) * angle}deg`).join(",")})`;
    elements.wheel.classList.remove("is-empty");
    state.options.forEach((option, index) => {
      const labelAngle = (index + 0.5) * angle;
      const label = createTextElement("span", "wheel-label", option);
      label.style.left = `${50 + Math.sin((labelAngle * Math.PI) / 180) * 32}%`;
      label.style.top = `${50 - Math.cos((labelAngle * Math.PI) / 180) * 32}%`;
      elements.wheel.append(label);
    });
  } else {
    elements.wheel.style.background = "#f1e7d9";
    elements.wheel.classList.add("is-empty");
    elements.wheel.append(createTextElement("span", "empty-wheel-label", "等待加菜"));
  }
  elements.wheel.append(hub);
  elements.wheel.style.transform = `rotate(${state.rotation}deg)`;
  elements.wheelStage.setAttribute("aria-label", `包含 ${state.options.length} 个选项的转盘`);
}

/** 根据状态重新绘制候选项列表。 */
function renderOptions() {
  elements.optionList.replaceChildren();
  if (!state.options.length) {
    elements.optionList.append(createTextElement("p", "empty-state", "还没有选项，先添加今天想吃的吧。"));
  } else {
    state.options.forEach((option, index) => {
      const chip = document.createElement("div");
      chip.className = "option-chip";
      const dot = document.createElement("span");
      dot.className = "color-dot";
      dot.style.background = COLORS[index % COLORS.length];
      const remove = createTextElement("button", "", "×");
      remove.type = "button";
      remove.disabled = state.spinning;
      remove.setAttribute("aria-label", `删除 ${option}`);
      remove.addEventListener("click", () => removeOption(index));
      chip.append(dot, createTextElement("span", "", option), remove);
      elements.optionList.append(chip);
    });
  }
  elements.optionCount.textContent = `已添加 ${state.options.length} / ${MAX_OPTIONS} 项 · 转动时不可编辑`;
}

/** 根据状态重新绘制历史记录。 */
function renderHistory() {
  elements.historyList.replaceChildren();
  if (!state.history.length) {
    const empty = document.createElement("div");
    empty.className = "empty-history";
    empty.append(createTextElement("span", "", "空"), createTextElement("p", "", "转一次，答案就会出现在这里"));
    elements.historyList.append(empty);
  } else {
    state.history.forEach((item, index) => {
      const row = document.createElement("div");
      row.className = "history-row";
      const detail = document.createElement("div");
      const time = createTextElement("time", "", formatTime(item.time));
      time.dateTime = item.time;
      detail.append(createTextElement("strong", "", item.result), time);
      row.append(createTextElement("span", "history-rank", String(index + 1).padStart(2, "0")), detail);
      elements.historyList.append(row);
    });
  }
}

/** 同步所有操作控件的锁定状态。 */
function renderControls() {
  elements.input.disabled = state.spinning;
  elements.form.querySelector("button").disabled = state.spinning;
  elements.clearOptions.disabled = state.spinning || !state.options.length;
  elements.clearHistory.disabled = !state.history.length;
  elements.spinButton.disabled = state.spinning;
  elements.spinText.textContent = state.spinning ? "转动中" : "吃什么";
}

/** 删除指定下标的候选项。 */
function removeOption(index) {
  if (state.spinning) return;
  state.options.splice(index, 1);
  writeCookie(OPTION_COOKIE, state.options);
  renderWheel();
  renderOptions();
  renderControls();
}

/** 启动转盘动画并计算停靠位置。 */
function spinWheel() {
  if (state.spinning) return;
  if (state.options.length < 2) return showNotice("至少添加 2 个选项才能开始");
  const angle = 360 / state.options.length;
  state.pendingIndex = getRandomIndex(state.options.length);
  const target = -(state.pendingIndex + 0.5) * angle;
  const currentNormalized = ((state.rotation % 360) + 360) % 360;
  const targetNormalized = ((target % 360) + 360) % 360;
  state.rotation += 6 * 360 + ((targetNormalized - currentNormalized + 360) % 360);
  state.spinning = true;
  elements.wheel.style.transform = `rotate(${state.rotation}deg)`;
  renderOptions();
  renderControls();
}

/** 完成转动、记录历史并显示结果弹窗。 */
function finishSpin(event) {
  if (event.propertyName !== "transform" || !state.spinning || state.pendingIndex === null) return;
  const result = state.options[state.pendingIndex];
  state.history = fitHistoryForCookie([{ id: createId(), result, time: new Date().toISOString() }, ...state.history]);
  state.spinning = false;
  state.pendingIndex = null;
  writeCookie(HISTORY_COOKIE, state.history);
  renderOptions();
  renderHistory();
  renderControls();
  elements.resultTitle.textContent = `就吃「${result}」`;
  elements.backdrop.hidden = false;
  elements.modalClose.focus();
}

/** 关闭结果弹窗。 */
function closeModal() {
  elements.backdrop.hidden = true;
  elements.spinButton.focus();
}

elements.form.addEventListener("submit", (event) => {
  event.preventDefault();
  if (state.spinning) return;
  const option = elements.input.value.trim();
  if (!option) return showNotice("先写下一个想吃的选项吧");
  if (option.length > 12) return showNotice("每个选项最多 12 个字");
  if (state.options.includes(option)) return showNotice("这个选项已经在转盘里了");
  if (state.options.length >= MAX_OPTIONS) return showNotice(`最多可以添加 ${MAX_OPTIONS} 个选项`);
  state.options.push(option);
  elements.input.value = "";
  writeCookie(OPTION_COOKIE, state.options);
  renderWheel();
  renderOptions();
  renderControls();
});

elements.clearOptions.addEventListener("click", () => {
  if (state.spinning || !state.options.length) return;
  state.options = [];
  writeCookie(OPTION_COOKIE, []);
  renderWheel();
  renderOptions();
  renderControls();
});

elements.clearHistory.addEventListener("click", () => {
  state.history = [];
  writeCookie(HISTORY_COOKIE, []);
  renderHistory();
  renderControls();
});

elements.spinButton.addEventListener("click", spinWheel);
elements.wheel.addEventListener("transitionend", finishSpin);
elements.modalClose.addEventListener("click", closeModal);
elements.modalAction.addEventListener("click", closeModal);
elements.backdrop.addEventListener("mousedown", (event) => { if (event.target === elements.backdrop) closeModal(); });
document.addEventListener("keydown", (event) => { if (event.key === "Escape" && !elements.backdrop.hidden) closeModal(); });

renderWheel();
renderOptions();
renderHistory();
renderControls();
