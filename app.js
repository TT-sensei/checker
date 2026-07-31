(function () {
  "use strict";

  const C = window.TrackerCore;
  const STATUS = {
    missing: { label: "未提出", symbol: "—" },
    submitted: { label: "提出済み", symbol: "✓" },
    late: { label: "遅れて提出", symbol: "△" },
    exempt: { label: "欠席・免除", symbol: "除" },
    overdue: { label: "期限超過", symbol: "!" }
  };
  const COLORS = ["#2f7656", "#3971a8", "#8a5b9e", "#c56b35", "#a13f4c", "#5b6d7b", "#8a7a31"];
  const appView = document.getElementById("app-view");
  const modalRoot = document.getElementById("modal-root");
  const fileInput = document.getElementById("json-file-input");
  const today = () => C.getTodayJST();

  let state = loadState();
  const ui = {
    view: "dashboard",
    selectedItemId: state.settings.selectedItemId || "",
    dailyDate: state.settings.selectedDailyDate || today(),
    filter: "all",
    search: "",
    selectedStudents: new Set(),
    selectedStudentId: activeStudents()[0]?.id || "",
    historyFilter: "all"
  };

  function loadState() {
    try {
      const raw = localStorage.getItem(C.STORAGE_KEY);
      if (!raw) return C.createInitialState();
      const parsed = JSON.parse(raw);
      return C.validateState(parsed).valid ? parsed : C.createInitialState();
    } catch (error) {
      console.error("保存データを読み込めませんでした。", error);
      return C.createInitialState();
    }
  }

  function saveState(message = "保存しました") {
    state.settings.lastSavedAt = C.toJstIso();
    state.settings.selectedItemId = ui.selectedItemId;
    state.settings.selectedDailyDate = ui.dailyDate;
    localStorage.setItem(C.STORAGE_KEY, JSON.stringify(state));
    const indicator = document.getElementById("save-indicator");
    if (indicator) indicator.textContent = "保存済み";
    if (message) toast(message);
  }

  function esc(value) {
    return String(value ?? "")
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#039;");
  }

  function activeStudents() {
    return (state.classInfo.students || [])
      .filter((student) => student.active !== false)
      .sort((a, b) => Number(a.number) - Number(b.number));
  }

  function items(type) {
    return state.items.filter((item) => !type || item.type === type);
  }

  function selectedItem(type) {
    let item = state.items.find((entry) => entry.id === ui.selectedItemId && (!type || entry.type === type));
    if (!item) item = items(type)[0] || null;
    if (item) ui.selectedItemId = item.id;
    return item;
  }

  function selectedStudent() {
    let student = activeStudents().find((entry) => entry.id === ui.selectedStudentId);
    if (!student) student = activeStudents()[0] || null;
    if (student) ui.selectedStudentId = student.id;
    return student;
  }

  function dateLabel(dateKey, includeYear = true) {
    if (!C.isDateKey(dateKey)) return "";
    const [year, month, day] = dateKey.split("-").map(Number);
    const weekdays = ["日", "月", "火", "水", "木", "金", "土"];
    const prefix = includeYear ? `${year}年` : "";
    return `${prefix}${month}月${day}日（${weekdays[C.getWeekday(dateKey)]}）`;
  }

  function shortDate(dateKey) {
    const [, month, day] = dateKey.split("-").map(Number);
    return `${month}/${day}`;
  }

  function rateText(rate) {
    return rate === null ? "対象なし" : `${rate}%`;
  }

  function statusBadge(status, deadlineMode = false) {
    const meta = { ...(STATUS[status] || STATUS.missing) };
    if (deadlineMode && status === "submitted") meta.label = "期限内提出";
    return `<span class="status-badge ${status}">${meta.symbol} ${meta.label}</span>`;
  }

  function itemScheduleLabel(item) {
    if (item.type === "daily") {
      const patterns = { everyday: "毎日", weekday: "平日のみ", custom: "曜日指定" };
      return `${item.schedule.startDate}開始・${patterns[item.schedule.pattern] || "毎日"}`;
    }
    return `締め切り ${item.schedule.dueDate} ${item.schedule.dueTime || "23:59"}`;
  }

  function toast(message, type = "") {
    const node = document.createElement("div");
    node.className = `toast ${type}`.trim();
    node.textContent = message;
    document.getElementById("toast-region").appendChild(node);
    setTimeout(() => node.remove(), 3200);
  }

  function setView(view, itemId = "") {
    ui.view = view;
    if (itemId) ui.selectedItemId = itemId;
    ui.selectedStudents.clear();
    ui.filter = "all";
    ui.search = "";
    render();
    document.getElementById("main-content").focus({ preventScroll: true });
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  function render() {
    document.getElementById("class-label").textContent =
      state.classInfo.className || "学級を設定してください";
    document.querySelectorAll(".nav-button").forEach((button) => {
      button.classList.toggle("is-active", button.dataset.view === ui.view);
      if (button.dataset.view === ui.view) button.setAttribute("aria-current", "page");
      else button.removeAttribute("aria-current");
    });
    renderQuickItems();

    if (ui.view === "daily") renderDaily();
    else if (ui.view === "deadline") renderDeadline();
    else if (ui.view === "student") renderStudent();
    else if (ui.view === "settings") renderSettings();
    else renderDashboard();
  }

  function renderQuickItems() {
    const holder = document.getElementById("quick-items");
    holder.innerHTML = state.items.length
      ? state.items.map((item) => `
          <button class="quick-item" type="button" data-open-item="${esc(item.id)}" aria-label="${esc(item.name)}を開く">
            <span class="quick-dot" style="background:${esc(item.color)}"></span>
            <span>${esc(item.name)}</span>
          </button>
        `).join("")
      : `<p class="panel-sub">設定から追加できます</p>`;
  }

  function renderDashboard() {
    const students = activeStudents();
    const dailyItems = items("daily");
    const deadlineItems = items("deadline");
    const todayKey = today();
    const dailyStatuses = [];
    const missingStudents = new Set();
    dailyItems.forEach((item) => {
      const isTarget = C.getTargetDates(item, todayKey, todayKey).length > 0;
      if (!isTarget) return;
      students.forEach((student) => {
        const status = C.getDailyStatus(state, item.id, student.id, todayKey);
        dailyStatuses.push(status);
        if (status === "missing") missingStudents.add(student.id);
      });
    });
    const todayStats = C.calculateRateFromStatuses(dailyStatuses);
    const overdueStudents = new Set();
    deadlineItems.forEach((item) => {
      students.forEach((student) => {
        const display = C.getDeadlineDisplayStatus(
          item,
          C.getDeadlineRecord(state, item.id, student.id)
        );
        if (display === "overdue") overdueStudents.add(student.id);
      });
    });

    const completeItems = [];
    state.items.forEach((item) => {
      if (item.type === "daily") {
        if (!C.getTargetDates(item, todayKey, todayKey).length) return;
        const stats = C.calculateDailyItemStats(state, item, students, todayKey, todayKey);
        if (stats.denominator > 0 && stats.rate === 100) completeItems.push(item);
      } else {
        const stats = C.calculateDeadlineItemStats(state, item, students);
        if (stats.denominator > 0 && stats.rate === 100) completeItems.push(item);
      }
    });

    const attention = students.map((student) => {
      let missing = 0;
      let overdue = 0;
      dailyItems.forEach((item) => {
        if (C.getTargetDates(item, todayKey, todayKey).length &&
            C.getDailyStatus(state, item.id, student.id, todayKey) === "missing") missing += 1;
      });
      deadlineItems.forEach((item) => {
        if (C.getDeadlineDisplayStatus(item, C.getDeadlineRecord(state, item.id, student.id)) === "overdue") overdue += 1;
      });
      return { student, missing, overdue, total: missing + overdue };
    }).filter((entry) => entry.total).sort((a, b) => b.total - a.total);

    const progress = state.items.map((item) => {
      if (item.type === "daily") {
        const target = C.getTargetDates(item, todayKey, todayKey).length > 0;
        const stats = target
          ? C.calculateDailyItemStats(state, item, students, todayKey, todayKey)
          : { rate: null, numerator: 0, denominator: 0 };
        return { item, stats, note: target ? "今日" : "今日は対象外" };
      }
      return { item, stats: C.calculateDeadlineItemStats(state, item, students), note: "継続記録" };
    });

    const last7 = Array.from({ length: 7 }, (_, index) => C.addDaysToDateKey(todayKey, index - 6)).map((dateKey) => {
      const statuses = [];
      dailyItems.forEach((item) => {
        if (!C.getTargetDates(item, dateKey, dateKey).length) return;
        students.forEach((student) => statuses.push(C.getDailyStatus(state, item.id, student.id, dateKey)));
      });
      return { dateKey, stats: C.calculateRateFromStatuses(statuses) };
    });

    appView.innerHTML = `
      <section class="page">
        <div class="page-title-row">
          <div class="page-title">
            <h2>ダッシュボード</h2>
            <p>${dateLabel(todayKey)}の状況です。</p>
          </div>
          <button class="button primary" type="button" data-action="add-item">＋ 提出物を追加</button>
        </div>

        <div class="summary-grid">
          <button class="summary-card" type="button" data-view="daily">
            <span class="eyebrow">今日の毎日型提出率</span>
            <div class="metric green">${todayStats.rate === null ? "—" : todayStats.rate}<small>${todayStats.rate === null ? "" : "%"}</small></div>
            <p class="metric-note">${todayStats.numerator}/${todayStats.denominator}件（免除を除く）</p>
          </button>
          <button class="summary-card" type="button" data-view="daily">
            <span class="eyebrow">今日の未提出児童</span>
            <div class="metric ${missingStudents.size ? "orange" : "green"}">${missingStudents.size}<small>人</small></div>
            <p class="metric-note">毎日型の対象提出物</p>
          </button>
          <button class="summary-card" type="button" data-view="deadline">
            <span class="eyebrow">期限超過の児童</span>
            <div class="metric ${overdueStudents.size ? "red" : "green"}">${overdueStudents.size}<small>人</small></div>
            <p class="metric-note">未提出の締め切り型</p>
          </button>
          <div class="summary-card">
            <span class="eyebrow">全員提出</span>
            <div class="metric green">${completeItems.length}<small>件</small></div>
            <p class="metric-note">現在100％の提出物</p>
          </div>
        </div>

        ${state.items.length ? `
          <div class="dashboard-grid">
            <div>
              <section class="panel">
                <div class="panel-head">
                  <h3>提出物ごとの状況</h3>
                  <span class="panel-sub">カードを押してチェック</span>
                </div>
                <div class="progress-list">
                  ${progress.map(({ item, stats, note }) => `
                    <button class="progress-item" type="button" data-open-item="${esc(item.id)}">
                      <span class="progress-name">${esc(item.name)}</span>
                      <span class="progress-track" aria-label="提出率${rateText(stats.rate)}">
                        <span class="progress-fill" style="width:${stats.rate || 0}%;background:${esc(item.color)}"></span>
                      </span>
                      <strong>${rateText(stats.rate)}</strong>
                      <span class="visually-hidden">${esc(note)}</span>
                    </button>
                  `).join("")}
                </div>
              </section>

              <section class="panel">
                <div class="panel-head">
                  <h3>最近7日間の毎日型提出率</h3>
                  <span class="panel-sub">記録なしも未提出として集計</span>
                </div>
                <div class="bar-chart" aria-label="最近7日間の提出率グラフ">
                  ${last7.map(({ dateKey, stats }) => `
                    <div class="bar-column">
                      <div class="bar-wrap">
                        <span class="bar-value">${stats.rate === null ? "—" : `${stats.rate}%`}</span>
                        <span class="bar" style="height:${stats.rate || 0}%"></span>
                      </div>
                      <span class="bar-label">${shortDate(dateKey)}</span>
                    </div>
                  `).join("")}
                </div>
              </section>
            </div>

            <div>
              <section class="panel">
                <div class="panel-head">
                  <h3>確認が必要な児童</h3>
                  <span class="panel-sub">${attention.length}人</span>
                </div>
                <div class="attention-list">
                  ${attention.length ? attention.slice(0, 10).map((entry) => `
                    <button class="attention-item" type="button" data-student="${esc(entry.student.id)}">
                      <strong>${entry.student.number}番 ${esc(entry.student.name || "名前未設定")}</strong>
                      <span class="panel-sub">
                        ${entry.missing ? `今日未提出 ${entry.missing}件` : ""}
                        ${entry.overdue ? ` 期限超過 ${entry.overdue}件` : ""}
                      </span>
                    </button>
                  `).join("") : `<p class="panel-sub">現在、確認が必要な児童はいません。</p>`}
                </div>
              </section>

              <section class="panel">
                <div class="panel-head"><h3>全員提出</h3></div>
                <div class="attention-list">
                  ${completeItems.length ? completeItems.map((item) => `
                    <button class="attention-item" type="button" data-open-item="${esc(item.id)}">
                      <strong>✓ ${esc(item.name)}</strong>
                      <span class="panel-sub">${item.type === "daily" ? "今日" : "締め切り型"}</span>
                    </button>
                  `).join("") : `<p class="panel-sub">全員提出になった提出物はまだありません。</p>`}
                </div>
              </section>
            </div>
          </div>
        ` : emptyState("＋", "提出物を登録しましょう", "毎日の宿題や締め切りのあるプリントを登録すると、ここに提出状況が表示されます。", "提出物を追加", "add-item")}
      </section>
    `;
  }

  function emptyState(icon, title, text, buttonText, action) {
    return `
      <div class="empty-state">
        <div class="empty-icon" aria-hidden="true">${icon}</div>
        <h3>${esc(title)}</h3>
        <p>${esc(text)}</p>
        ${buttonText ? `<button class="button primary" type="button" data-action="${action}">${esc(buttonText)}</button>` : ""}
      </div>
    `;
  }

  function itemSelector(type, item) {
    return `
      <label class="visually-hidden" for="item-selector">提出物を選択</label>
      <select id="item-selector" class="form-control" data-action="select-item">
        ${items(type).map((entry) => `
          <option value="${esc(entry.id)}" ${entry.id === item?.id ? "selected" : ""}>${esc(entry.name)}</option>
        `).join("")}
      </select>
    `;
  }

  function filteredStudents(getDisplayStatus) {
    const query = ui.search.trim().toLowerCase();
    return activeStudents().filter((student) => {
      const status = getDisplayStatus(student);
      const statusMatch = ui.filter === "all" ||
        ui.filter === status ||
        (ui.filter === "submitted" && status === "late");
      const nameMatch = !query ||
        String(student.number).includes(query) ||
        (student.name || "").toLowerCase().includes(query);
      return statusMatch && nameMatch;
    });
  }

  function renderStudentCards(students, getStatus, disabled = false, deadlineMode = false) {
    if (!students.length) return emptyState("?", "該当する児童がいません", "検索条件または状態フィルターを変更してください。");
    return `
      <div class="student-grid">
        ${students.map((student) => {
          const status = getStatus(student);
          const meta = { ...(STATUS[status] || STATUS.missing) };
          if (deadlineMode && status === "submitted") meta.label = "期限内提出";
          const selected = ui.selectedStudents.has(student.id);
          return `
            <div class="student-card-wrap">
              <button class="student-card status-${status} ${selected ? "is-selected" : ""}" type="button"
                data-card-student="${esc(student.id)}"
                aria-label="${student.number}番 ${esc(student.name || "名前未設定")}、${meta.label}。押すと状態を変更"
                ${disabled ? "disabled" : ""}>
                <span class="student-card-top">
                  <span class="student-number">${student.number}</span>
                  <span class="student-name">${esc(student.name || "名前未設定")}</span>
                </span>
                <span class="student-card-status">
                  <span class="status-symbol" aria-hidden="true">${meta.symbol}</span>
                  <span>${meta.label}</span>
                </span>
              </button>
              <button class="detail-button" type="button" data-detail-student="${esc(student.id)}" aria-label="${student.number}番の記録詳細">…</button>
              <input class="card-check" type="checkbox" data-select-student="${esc(student.id)}"
                aria-label="${student.number}番を一括操作の対象にする" ${selected ? "checked" : ""}>
            </div>
          `;
        }).join("")}
      </div>
    `;
  }

  function selectionBar() {
    return `
      <div class="selection-bar ${ui.selectedStudents.size ? "is-visible" : ""}" id="selection-bar">
        <strong><span id="selection-count">${ui.selectedStudents.size}</span>人を選択中</strong>
        <div class="toolbar-group">
          <button class="button small" type="button" data-bulk="selected-submitted">選択を提出済み</button>
          <button class="button small" type="button" data-bulk="selected-exempt">選択を欠席・免除</button>
          <button class="button small" type="button" data-action="clear-selection">選択解除</button>
        </div>
      </div>
    `;
  }

  function renderDaily() {
    const item = selectedItem("daily");
    if (!item) {
      appView.innerHTML = `<section class="page">
        <div class="page-title-row"><div class="page-title"><h2>毎日型チェック</h2><p>日ごとの提出状況を記録します。</p></div></div>
        ${emptyState("日", "毎日型の提出物がありません", "設定から「毎日型」を追加してください。", "毎日型を追加", "add-daily")}
      </section>`;
      return;
    }
    if (ui.dailyDate > today()) ui.dailyDate = today();
    const target = C.getTargetDates(item, ui.dailyDate, ui.dailyDate).length > 0;
    const students = activeStudents();
    const statuses = target ? students.map((student) => C.getDailyStatus(state, item.id, student.id, ui.dailyDate)) : [];
    const stats = C.calculateRateFromStatuses(statuses);
    const shown = filteredStudents((student) => target
      ? C.getDailyStatus(state, item.id, student.id, ui.dailyDate)
      : "missing"
    );

    appView.innerHTML = `
      <section class="page">
        <div class="page-title-row">
          <div class="page-title"><h2>毎日型チェック</h2><p>カード全体をタップして状態を切り替えます。</p></div>
          <button class="button" type="button" data-action="edit-current-item">提出物を編集</button>
        </div>

        <div class="context-banner" style="background:${esc(item.color)}">
          <div>
            <h3>${esc(item.name)}</h3>
            <p>${dateLabel(ui.dailyDate)}${target ? "" : "・この日は提出対象外"}</p>
          </div>
          <div class="summary-row">
            <span class="summary-pill"><strong>${rateText(stats.rate)}</strong><span>提出率</span></span>
            <span class="summary-pill"><strong>${stats.missing}</strong><span>未提出</span></span>
            <span class="summary-pill"><strong>${stats.exempt}</strong><span>欠席・免除</span></span>
          </div>
        </div>

        <div class="toolbar">
          <div class="toolbar-group">
            ${itemSelector("daily", item)}
            <button class="date-button" type="button" data-action="previous-date" aria-label="前日へ">← 前日</button>
            <input class="date-input" type="date" value="${esc(ui.dailyDate)}" max="${today()}" data-action="daily-date" aria-label="表示する日付">
            <button class="date-button" type="button" data-action="next-date" aria-label="翌日へ" ${ui.dailyDate >= today() ? "disabled" : ""}>翌日 →</button>
            <button class="date-button" type="button" data-action="today">今日</button>
          </div>
          <div class="toolbar-group">
            <input class="search-input" type="search" value="${esc(ui.search)}" placeholder="番号・名前で検索" data-action="search" aria-label="番号または名前で検索">
          </div>
        </div>

        <div class="toolbar">
          <div class="toolbar-group" role="group" aria-label="状態で絞り込み">
            ${filterButton("all", "全員")}
            ${filterButton("missing", "未提出")}
            ${filterButton("submitted", "提出済み")}
            ${filterButton("exempt", "欠席・免除")}
          </div>
          <div class="toolbar-group">
            <button class="button small" type="button" data-bulk="visible-submitted">表示中を全員提出済み</button>
            <button class="button small" type="button" data-bulk="visible-missing">表示中を未提出に戻す</button>
          </div>
        </div>

        ${selectionBar()}
        ${target
          ? renderStudentCards(shown, (student) => C.getDailyStatus(state, item.id, student.id, ui.dailyDate))
          : emptyState("休", "この日は提出対象外です", "曜日設定により、この日は記録・集計の対象になりません。")}
      </section>
    `;
  }

  function filterButton(value, label) {
    return `<button class="chip-button ${ui.filter === value ? "is-active" : ""}" type="button" data-filter="${value}">${label}</button>`;
  }

  function dueDistance(item) {
    const now = new Date();
    const due = C.getDueAt(item);
    const difference = due - now;
    if (difference < 0) return `${Math.max(1, Math.ceil(Math.abs(difference) / 86400000))}日超過`;
    const days = Math.ceil(difference / 86400000);
    if (days <= 1 && item.schedule.dueDate === today()) return "本日締め切り";
    return `あと${days}日`;
  }

  function renderDeadline() {
    const item = selectedItem("deadline");
    if (!item) {
      appView.innerHTML = `<section class="page">
        <div class="page-title-row"><div class="page-title"><h2>締め切り型チェック</h2><p>提出状態を日付が変わっても維持します。</p></div></div>
        ${emptyState("〆", "締め切り型の提出物がありません", "設定から「締め切り型」を追加してください。", "締め切り型を追加", "add-deadline")}
      </section>`;
      return;
    }
    const students = activeStudents();
    const stats = C.calculateDeadlineItemStats(state, item, students);
    const shown = filteredStudents((student) =>
      C.getDeadlineDisplayStatus(item, C.getDeadlineRecord(state, item.id, student.id))
    );

    appView.innerHTML = `
      <section class="page">
        <div class="page-title-row">
          <div class="page-title"><h2>締め切り型チェック</h2><p>提出済みの状態は締め切り日を過ぎても維持されます。</p></div>
          <button class="button" type="button" data-action="edit-current-item">提出物を編集</button>
        </div>

        <div class="context-banner" style="background:${esc(item.color)}">
          <div>
            <h3>${esc(item.name)}</h3>
            <p>締め切り ${dateLabel(item.schedule.dueDate)} ${esc(item.schedule.dueTime || "23:59")}・${dueDistance(item)}</p>
          </div>
          <div class="summary-row">
            <span class="summary-pill"><strong>${stats.submitted + stats.late}</strong><span>提出済み</span></span>
            <span class="summary-pill"><strong>${stats.missing}</strong><span>未提出</span></span>
            <span class="summary-pill"><strong>${stats.exempt}</strong><span>欠席・免除</span></span>
            <span class="summary-pill"><strong>${stats.overdue}</strong><span>期限超過</span></span>
          </div>
        </div>

        <div class="toolbar">
          <div class="toolbar-group">
            ${itemSelector("deadline", item)}
            <span class="summary-pill"><strong>${rateText(stats.rate)}</strong><span>現在の提出率</span></span>
          </div>
          <input class="search-input" type="search" value="${esc(ui.search)}" placeholder="番号・名前で検索" data-action="search" aria-label="番号または名前で検索">
        </div>

        <div class="toolbar">
          <div class="toolbar-group" role="group" aria-label="状態で絞り込み">
            ${filterButton("all", "全員")}
            ${filterButton("missing", "未提出")}
            ${filterButton("submitted", "提出済み")}
            ${filterButton("late", "遅れて提出")}
            ${filterButton("exempt", "欠席・免除")}
            ${filterButton("overdue", "期限超過")}
          </div>
          <div class="toolbar-group">
            <button class="button small" type="button" data-bulk="visible-submitted">表示中を全員提出済み</button>
            <button class="button small" type="button" data-bulk="visible-missing">表示中を未提出に戻す</button>
          </div>
        </div>

        ${selectionBar()}
        ${renderStudentCards(
          shown,
          (student) => C.getDeadlineDisplayStatus(item, C.getDeadlineRecord(state, item.id, student.id)),
          false,
          true
        )}
      </section>
    `;
  }

  function renderStudent() {
    const student = selectedStudent();
    if (!student) {
      appView.innerHTML = `<section class="page">${emptyState("人", "児童が登録されていません", "設定から名簿を登録してください。", "設定を開く", "open-settings")}</section>`;
      return;
    }
    const todayKey = today();
    const monthKey = todayKey.slice(0, 7);
    const month = C.monthRange(monthKey);
    const dailyEntries = [];
    const deadlineEntries = [];
    const allStatuses = [];

    items("daily").forEach((item) => {
      const dates = C.getTargetDates(item, item.schedule.startDate, todayKey);
      const statuses = dates.map((dateKey) => C.getDailyStatus(state, item.id, student.id, dateKey));
      allStatuses.push(...statuses);
      const stats = C.calculateRateFromStatuses(statuses);
      const monthStats = C.calculateDailyStudentStats(state, item, student.id, month.start, month.end);
      dailyEntries.push({ item, dates, stats, monthStats });
    });

    items("deadline").forEach((item) => {
      const status = C.getDeadlineStatus(state, item.id, student.id);
      allStatuses.push(status);
      deadlineEntries.push({
        item,
        record: C.getDeadlineRecord(state, item.id, student.id),
        status,
        display: C.getDeadlineDisplayStatus(item, C.getDeadlineRecord(state, item.id, student.id))
      });
    });

    const overall = C.calculateRateFromStatuses(allStatuses);
    const dailyHistory = dailyEntries.flatMap(({ item, dates }) => dates.map((dateKey) => {
      const record = C.getDailyRecord(state, item.id, student.id, dateKey);
      return {
        kind: "daily",
        dateKey,
        item,
        status: C.getDailyStatus(state, item.id, student.id, dateKey),
        record
      };
    }));
    const deadlineHistory = deadlineEntries.map((entry) => ({
      kind: "deadline",
      dateKey: entry.item.schedule.dueDate,
      item: entry.item,
      status: entry.display,
      record: entry.record
    }));
    const history = [...dailyHistory, ...deadlineHistory]
      .filter((entry) => ui.historyFilter === "all" ||
        (ui.historyFilter === "missing" && ["missing", "overdue"].includes(entry.status)) ||
        entry.status === ui.historyFilter)
      .sort((a, b) => b.dateKey.localeCompare(a.dateKey));

    appView.innerHTML = `
      <section class="page">
        <div class="page-title-row">
          <div class="page-title"><h2>個人ダッシュボード</h2><p>記録のない対象日も未提出として表示します。</p></div>
          <select class="form-control student-picker" data-action="select-student" aria-label="児童を選択">
            ${activeStudents().map((entry) => `<option value="${esc(entry.id)}" ${entry.id === student.id ? "selected" : ""}>${entry.number}番 ${esc(entry.name || "名前未設定")}</option>`).join("")}
          </select>
        </div>

        <div class="student-profile">
          <aside>
            <div class="profile-card">
              <div class="profile-number">${student.number}</div>
              <h3>${esc(student.name || "名前未設定")}</h3>
              <p>${esc(state.classInfo.className)}</p>
              <div class="profile-rate">${rateText(overall.rate)}</div>
              <p>総合提出率 ${overall.numerator}/${overall.denominator}</p>
            </div>
            <section class="panel">
              <div class="panel-head"><h3>教師用メモ</h3></div>
              <textarea class="form-control" style="width:100%;min-height:130px" id="student-note" placeholder="支援や声かけの記録">${esc(state.studentNotes[student.id]?.note || "")}</textarea>
              <div class="form-actions"><button class="button primary small" type="button" data-action="save-student-note">メモを保存</button></div>
            </section>
          </aside>

          <div>
            <section class="panel">
              <div class="panel-head"><h3>提出物別の状況</h3><span class="panel-sub">${monthKey.replace("-", "年")}月</span></div>
              <div class="progress-list">
                ${dailyEntries.map(({ item, stats, monthStats }) => `
                  <button class="progress-item" type="button" data-open-item="${esc(item.id)}">
                    <span class="progress-meta">
                      <span class="progress-name">${esc(item.name)}</span>
                      <small class="panel-sub">今月 ${rateText(monthStats.rate)}</small>
                    </span>
                    <span class="progress-track"><span class="progress-fill" style="width:${stats.rate || 0}%;background:${esc(item.color)}"></span></span>
                    <strong>${rateText(stats.rate)}</strong>
                  </button>
                `).join("")}
                ${deadlineEntries.map(({ item, display }) => `
                  <button class="progress-item" type="button" data-open-item="${esc(item.id)}">
                    <span class="progress-name">${esc(item.name)}</span>
                    <span class="progress-track"><span class="progress-fill" style="width:${["submitted", "late"].includes(display) ? 100 : 0}%;background:${esc(item.color)}"></span></span>
                    ${statusBadge(display, true)}
                  </button>
                `).join("")}
                ${state.items.length ? "" : `<p class="panel-sub">提出物がまだありません。</p>`}
              </div>
            </section>

            <section class="panel">
              <div class="panel-head">
                <h3>履歴</h3>
                <div class="segmented" role="group" aria-label="履歴の絞り込み">
                  ${historyFilterButton("all", "すべて")}
                  ${historyFilterButton("missing", "未提出")}
                  ${historyFilterButton("exempt", "欠席・免除")}
                </div>
              </div>
              <div class="history-list">
                ${history.length ? history.slice(0, 250).map((entry) => `
                  <div class="history-item">
                    <strong>${entry.kind === "daily" ? dateLabel(entry.dateKey, false) : "締切 " + dateLabel(entry.dateKey, false)}</strong>
                    <span>${esc(entry.item.name)}${entry.record?.reason ? `<br><small>${esc(entry.record.reason)}</small>` : ""}</span>
                    ${statusBadge(entry.status)}
                  </div>
                `).join("") : `<p class="panel-sub">該当する履歴はありません。</p>`}
              </div>
            </section>
          </div>
        </div>
      </section>
    `;
  }

  function historyFilterButton(value, label) {
    return `<button type="button" class="${ui.historyFilter === value ? "is-active" : ""}" data-history-filter="${value}">${label}</button>`;
  }

  function renderSettings() {
    appView.innerHTML = `
      <section class="page">
        <div class="page-title-row">
          <div class="page-title"><h2>設定</h2><p>学級・名簿・提出物・バックアップを管理します。</p></div>
        </div>

        <div class="settings-grid">
          <div>
            <section class="panel">
              <div class="panel-head"><h3>学級情報</h3></div>
              <div class="form-grid">
                <div class="form-field">
                  <label for="class-name">学級名</label>
                  <input id="class-name" class="form-control" value="${esc(state.classInfo.className)}" placeholder="6年1組">
                </div>
                <div class="form-field">
                  <label for="teacher-name">担任名</label>
                  <input id="teacher-name" class="form-control" value="${esc(state.classInfo.teacherName)}" placeholder="担任名">
                </div>
                <div class="form-field full">
                  <span class="field-label">児童数</span>
                  <output class="form-control">${activeStudents().length}人</output>
                  <span class="form-hint">児童の追加・集計対象からの除外は、下の名簿編集で行います。</span>
                </div>
              </div>
              <div class="form-actions"><button class="button primary small" type="button" data-action="save-class">学級情報を保存</button></div>
            </section>

            <section class="panel">
              <div class="panel-head">
                <h3>名簿編集</h3>
                <button class="button small" type="button" data-action="add-student">児童を追加</button>
              </div>
              <div class="roster-list">
                ${state.classInfo.students.map((student) => `
                  <div class="roster-row">
                    <span class="roster-number">${student.number}</span>
                    <input class="form-control" value="${esc(student.name)}" data-roster-name="${esc(student.id)}" aria-label="${student.number}番の名前" ${student.active === false ? "disabled" : ""}>
                    <button class="button small ${student.active === false ? "" : "danger"}" type="button" data-toggle-student="${esc(student.id)}" aria-label="${student.number}番を${student.active === false ? "復元" : "名簿から外す"}">${student.active === false ? "戻" : "×"}</button>
                  </div>
                `).join("")}
              </div>
              <div class="form-actions"><button class="button primary small" type="button" data-action="save-roster">名簿を保存</button></div>
            </section>
          </div>

          <div>
            <section class="panel">
              <div class="panel-head">
                <h3>提出物</h3>
                <button class="button primary small" type="button" data-action="add-item">＋ 追加</button>
              </div>
              <div class="item-list">
                ${state.items.length ? state.items.map((item) => `
                  <div class="item-row">
                    <span class="item-color" style="background:${esc(item.color)}"></span>
                    <div><h4>${esc(item.name)}</h4><p>${esc(itemScheduleLabel(item))}・${item.type === "daily" ? "毎日型" : "締め切り型"}</p></div>
                    <div class="item-actions">
                      <button class="button small" type="button" data-edit-item="${esc(item.id)}">編集</button>
                      <button class="button small danger" type="button" data-delete-item="${esc(item.id)}">削除</button>
                    </div>
                  </div>
                `).join("") : `<p class="panel-sub">提出物がまだありません。</p>`}
              </div>
            </section>

            <section class="panel">
              <div class="panel-head"><h3>バックアップ・出力</h3></div>
              <p class="modal-intro">このアプリのデータは、使用中のブラウザ内に保存されています。定期的にJSONバックアップを保存してください。</p>
              <div class="data-actions">
                <button class="button" type="button" data-action="backup-json">JSONバックアップ</button>
                <button class="button" type="button" data-action="import-json">JSONを読み込む</button>
                <button class="button" type="button" data-action="export-csv">CSV出力</button>
                <button class="button" type="button" data-action="run-tests">自動テストを実行</button>
              </div>
            </section>

            <section class="panel">
              <div class="panel-head"><h3>データ削除</h3></div>
              <p class="modal-intro">全ての学級情報・提出物・記録・メモをこの端末から削除します。元に戻せません。</p>
              <button class="button danger" type="button" data-action="clear-data">全データを削除</button>
            </section>
          </div>
        </div>
      </section>
    `;
  }

  function setDailyRecord(item, studentId, status, overrides = {}) {
    state.dailyRecords[item.id] ||= {};
    state.dailyRecords[item.id][studentId] ||= {};
    const old = state.dailyRecords[item.id][studentId][ui.dailyDate] || {};
    const changedAt = overrides.changedAt || C.toJstIso();
    const record = {
      ...old,
      status,
      changedAt,
      reason: status === "exempt" ? (overrides.reason ?? old.reason ?? "欠席・免除") : (overrides.reason ?? ""),
      note: overrides.note ?? old.note ?? ""
    };
    if (status === "submitted" || status === "late") record.submittedAt = overrides.submittedAt || old.submittedAt || changedAt;
    else record.submittedAt = "";
    state.dailyRecords[item.id][studentId][ui.dailyDate] = record;
  }

  function setDeadlineRecord(item, studentId, status, overrides = {}) {
    state.deadlineRecords[item.id] ||= {};
    const old = state.deadlineRecords[item.id][studentId] || {};
    const changedAt = overrides.changedAt || C.toJstIso();
    const actualStatus = status === "submitted"
      ? C.determineDeadlineSubmissionStatus(item, overrides.submittedAt || old.submittedAt || changedAt)
      : status;
    const record = {
      ...old,
      status: actualStatus,
      changedAt,
      reason: actualStatus === "exempt" ? (overrides.reason ?? old.reason ?? "欠席・免除") : (overrides.reason ?? ""),
      note: overrides.note ?? old.note ?? ""
    };
    if (actualStatus === "submitted" || actualStatus === "late") {
      record.submittedAt = overrides.submittedAt || old.submittedAt || changedAt;
      record.status = C.determineDeadlineSubmissionStatus(item, record.submittedAt);
      record.exemptedAt = "";
    } else if (actualStatus === "exempt") {
      record.submittedAt = "";
      record.exemptedAt = overrides.exemptedAt || changedAt;
    } else {
      record.submittedAt = "";
      record.exemptedAt = "";
    }
    state.deadlineRecords[item.id][studentId] = record;
  }

  function cycleStudent(studentId) {
    const item = selectedItem(ui.view === "daily" ? "daily" : "deadline");
    if (!item) return;
    if (item.type === "daily") {
      if (!C.getTargetDates(item, ui.dailyDate, ui.dailyDate).length || ui.dailyDate > today()) return;
      const current = C.getDailyStatus(state, item.id, studentId, ui.dailyDate);
      setDailyRecord(item, studentId, C.getNextBaseStatus(current));
    } else {
      const current = C.getDeadlineStatus(state, item.id, studentId);
      setDeadlineRecord(item, studentId, C.getNextDeadlineStatus(item, current, C.toJstIso()));
    }
    saveState("");
    render();
  }

  function openModal(content, wide = false) {
    modalRoot.innerHTML = `
      <div class="modal-backdrop" data-action="close-modal">
        <section class="modal ${wide ? "wide" : ""}" role="dialog" aria-modal="true" aria-labelledby="modal-title">
          ${content}
        </section>
      </div>
    `;
    const modal = modalRoot.querySelector(".modal");
    modal.addEventListener("click", (event) => event.stopPropagation());
    setTimeout(() => modal.querySelector("input,select,textarea,button")?.focus(), 0);
  }

  function closeModal() {
    modalRoot.innerHTML = "";
  }

  function setupModal() {
    openModal(`
      <h2 id="modal-title">学級を設定しましょう</h2>
      <p class="modal-intro">最初に学級名と児童数を登録します。児童名や提出物は、あとから設定画面で編集できます。</p>
      <form id="setup-form">
        <div class="form-grid">
          <div class="form-field">
            <label for="setup-class">学級名</label>
            <input id="setup-class" class="form-control" name="className" value="6年1組" required>
          </div>
          <div class="form-field">
            <label for="setup-teacher">担任名（任意）</label>
            <input id="setup-teacher" class="form-control" name="teacherName">
          </div>
          <div class="form-field">
            <label for="setup-count">児童数</label>
            <input id="setup-count" class="form-control" name="studentCount" type="number" min="1" max="60" value="30" required>
          </div>
        </div>
        <div class="modal-actions">
          <button class="button primary" type="submit">はじめる</button>
        </div>
      </form>
    `);
    document.getElementById("setup-form").addEventListener("submit", (event) => {
      event.preventDefault();
      const data = new FormData(event.currentTarget);
      state.classInfo.className = data.get("className").trim();
      state.classInfo.teacherName = data.get("teacherName").trim();
      state.classInfo.students = C.createStudents(Number(data.get("studentCount")));
      state.settings.initialized = true;
      ui.selectedStudentId = state.classInfo.students[0]?.id || "";
      saveState("");
      closeModal();
      render();
      toast("学級を設定しました。次に提出物を追加できます。");
    });
  }

  function itemModal(item = null, forcedType = "") {
    const editing = Boolean(item);
    const type = item?.type || forcedType || "daily";
    const data = item || {
      name: "",
      type,
      color: COLORS[0],
      note: "",
      schedule: type === "daily"
        ? { startDate: today(), pattern: "weekday", days: [] }
        : { registeredDate: today(), dueDate: today(), dueTime: "16:00" }
    };
    openModal(`
      <h2 id="modal-title">${editing ? "提出物を編集" : "提出物を追加"}</h2>
      <p class="modal-intro">毎日型と締め切り型では、記録の持ち方が異なります。作成後に種類は変更できません。</p>
      <form id="item-form">
        <div class="form-grid">
          <div class="form-field full">
            <label for="item-name">提出物名</label>
            <input id="item-name" class="form-control" name="name" value="${esc(data.name)}" maxlength="50" required>
          </div>
          <div class="form-field">
            <label for="item-type">種類</label>
            <select id="item-type" class="form-control" name="type" ${editing || forcedType ? "disabled" : ""}>
              <option value="daily" ${type === "daily" ? "selected" : ""}>毎日型</option>
              <option value="deadline" ${type === "deadline" ? "selected" : ""}>締め切り型</option>
            </select>
          </div>
          <div class="form-field">
            <label for="item-color">色</label>
            <input id="item-color" class="form-control" name="color" type="color" value="${esc(data.color || COLORS[0])}">
          </div>
          <div id="schedule-fields" class="form-field full"></div>
          <div class="form-field full">
            <label for="item-note">備考</label>
            <textarea id="item-note" class="form-control" name="note" maxlength="500">${esc(data.note || "")}</textarea>
          </div>
        </div>
        <div class="modal-actions">
          <button class="button" type="button" data-action="close-modal">キャンセル</button>
          <button class="button primary" type="submit">${editing ? "変更を保存" : "追加する"}</button>
        </div>
      </form>
    `);

    const typeSelect = document.getElementById("item-type");
    const scheduleHolder = document.getElementById("schedule-fields");
    function scheduleFields() {
      const currentType = editing || forcedType ? type : typeSelect.value;
      if (currentType === "daily") {
        const schedule = data.type === "daily" ? data.schedule : { startDate: today(), pattern: "weekday", days: [] };
        scheduleHolder.innerHTML = `
          <div class="form-grid">
            <div class="form-field">
              <label for="start-date">開始日</label>
              <input id="start-date" class="form-control" name="startDate" type="date" value="${esc(schedule.startDate || today())}" required>
            </div>
            <div class="form-field">
              <label for="pattern">提出対象日</label>
              <select id="pattern" class="form-control" name="pattern">
                <option value="everyday" ${schedule.pattern === "everyday" ? "selected" : ""}>毎日</option>
                <option value="weekday" ${schedule.pattern === "weekday" ? "selected" : ""}>平日のみ</option>
                <option value="custom" ${schedule.pattern === "custom" ? "selected" : ""}>曜日指定</option>
              </select>
            </div>
            <div class="form-field full">
              <span class="field-label">曜日指定</span>
              <div class="weekday-options">
                ${["日", "月", "火", "水", "木", "金", "土"].map((label, index) => `
                  <label class="weekday-option"><input type="checkbox" name="days" value="${index}" ${(schedule.days || []).map(Number).includes(index) ? "checked" : ""}>${label}</label>
                `).join("")}
              </div>
              <span class="form-hint">「曜日指定」を選んだときだけ使用します。</span>
            </div>
          </div>
        `;
      } else {
        const schedule = data.type === "deadline" ? data.schedule : { registeredDate: today(), dueDate: today(), dueTime: "16:00" };
        scheduleHolder.innerHTML = `
          <div class="form-grid">
            <div class="form-field">
              <label for="registered-date">登録日</label>
              <input id="registered-date" class="form-control" name="registeredDate" type="date" value="${esc(schedule.registeredDate || today())}" required>
            </div>
            <div class="form-field">
              <label for="due-date">締め切り日</label>
              <input id="due-date" class="form-control" name="dueDate" type="date" value="${esc(schedule.dueDate || today())}" required>
            </div>
            <div class="form-field">
              <label for="due-time">締め切り時刻</label>
              <input id="due-time" class="form-control" name="dueTime" type="time" value="${esc(schedule.dueTime || "16:00")}">
            </div>
          </div>
        `;
      }
    }
    scheduleFields();
    typeSelect.addEventListener("change", scheduleFields);

    document.getElementById("item-form").addEventListener("submit", (event) => {
      event.preventDefault();
      const form = event.currentTarget;
      const formData = new FormData(form);
      const finalType = editing ? item.type : (forcedType || formData.get("type"));
      const schedule = finalType === "daily"
        ? {
            startDate: formData.get("startDate"),
            pattern: formData.get("pattern"),
            days: formData.getAll("days").map(Number)
          }
        : {
            registeredDate: formData.get("registeredDate"),
            dueDate: formData.get("dueDate"),
            dueTime: formData.get("dueTime") || "23:59"
          };
      if (finalType === "daily" && schedule.pattern === "custom" && !schedule.days.length) {
        toast("曜日指定では、曜日を1つ以上選んでください。", "error");
        return;
      }
      if (finalType === "deadline" && schedule.registeredDate > schedule.dueDate) {
        toast("締め切り日は登録日以降にしてください。", "error");
        return;
      }
      const newItem = {
        id: item?.id || `item-${finalType}-${Date.now()}`,
        name: formData.get("name").trim(),
        type: finalType,
        color: formData.get("color") || COLORS[0],
        note: formData.get("note").trim(),
        createdAt: item?.createdAt || C.toJstIso(),
        schedule
      };
      if (editing) state.items[state.items.findIndex((entry) => entry.id === item.id)] = newItem;
      else state.items.push(newItem);
      ui.selectedItemId = newItem.id;
      saveState("");
      closeModal();
      setView(finalType === "daily" ? "daily" : "deadline", newItem.id);
      toast(editing ? "提出物を更新しました。" : "提出物を追加しました。");
    });
  }

  function detailModal(studentId) {
    const student = activeStudents().find((entry) => entry.id === studentId);
    const item = selectedItem(ui.view === "daily" ? "daily" : "deadline");
    if (!student || !item) return;
    const isDaily = item.type === "daily";
    const record = isDaily
      ? C.getDailyRecord(state, item.id, studentId, ui.dailyDate)
      : C.getDeadlineRecord(state, item.id, studentId);
    const status = isDaily
      ? C.getDailyStatus(state, item.id, studentId, ui.dailyDate)
      : C.getDeadlineStatus(state, item.id, studentId);
    const submittedAt = record?.submittedAt ? record.submittedAt.slice(0, 16) : "";
    openModal(`
      <h2 id="modal-title">${student.number}番 ${esc(student.name || "名前未設定")}</h2>
      <p class="modal-intro">${esc(item.name)}${isDaily ? `・${dateLabel(ui.dailyDate)}` : `・締め切り ${dateLabel(item.schedule.dueDate)}`}</p>
      <form id="detail-form">
        <div class="form-grid">
          <div class="form-field">
            <label for="detail-status">状態</label>
            <select id="detail-status" class="form-control" name="status">
              <option value="missing" ${status === "missing" ? "selected" : ""}>未提出</option>
              <option value="submitted" ${status === "submitted" ? "selected" : ""}>提出済み</option>
              <option value="late" ${status === "late" ? "selected" : ""}>遅れて提出</option>
              <option value="exempt" ${status === "exempt" ? "selected" : ""}>欠席・免除</option>
            </select>
          </div>
          <div class="form-field">
            <label for="detail-reason">免除理由</label>
            <select id="detail-reason" class="form-control" name="reason">
              ${["", "欠席・免除", "欠席", "提出免除", "その他"].map((reason) => `<option value="${esc(reason)}" ${(record?.reason || "") === reason ? "selected" : ""}>${reason || "なし"}</option>`).join("")}
            </select>
          </div>
          <div class="form-field full">
            <label for="detail-submitted">提出日時</label>
            <input id="detail-submitted" class="form-control" name="submittedAt" type="datetime-local" value="${esc(submittedAt)}">
            <span class="form-hint">締め切り型では、この日時から期限内・期限後を自動判定します。</span>
          </div>
          <div class="form-field full">
            <label for="detail-note">記録メモ</label>
            <textarea id="detail-note" class="form-control" name="note">${esc(record?.note || "")}</textarea>
          </div>
          <div class="form-field full">
            <label for="detail-student-note">教師用児童メモ</label>
            <textarea id="detail-student-note" class="form-control" name="studentNote">${esc(state.studentNotes[student.id]?.note || "")}</textarea>
          </div>
        </div>
        <div class="modal-actions">
          <button class="button" type="button" data-action="close-modal">キャンセル</button>
          <button class="button primary" type="submit">保存</button>
        </div>
      </form>
    `);
    document.getElementById("detail-form").addEventListener("submit", (event) => {
      event.preventDefault();
      const formData = new FormData(event.currentTarget);
      const nextStatus = formData.get("status");
      const localDateTime = formData.get("submittedAt");
      const submittedIso = localDateTime ? `${localDateTime}:00+09:00` : "";
      const overrides = {
        reason: formData.get("reason"),
        note: formData.get("note").trim(),
        submittedAt: submittedIso
      };
      if (isDaily) setDailyRecord(item, studentId, nextStatus, overrides);
      else setDeadlineRecord(item, studentId, nextStatus, overrides);
      state.studentNotes[student.id] = {
        note: formData.get("studentNote").trim(),
        updatedAt: C.toJstIso()
      };
      saveState("");
      closeModal();
      render();
      toast("詳細を保存しました。");
    });
  }

  function confirmModal(title, message, onConfirm, confirmLabel = "実行する", danger = false) {
    openModal(`
      <h2 id="modal-title">${esc(title)}</h2>
      <p class="modal-intro">${esc(message)}</p>
      <div class="modal-actions">
        <button class="button" type="button" data-action="close-modal">キャンセル</button>
        <button class="button ${danger ? "danger" : "primary"}" type="button" id="confirm-action">${esc(confirmLabel)}</button>
      </div>
    `);
    document.getElementById("confirm-action").addEventListener("click", () => {
      closeModal();
      onConfirm();
    });
  }

  function applyBulk(mode) {
    const type = ui.view === "daily" ? "daily" : "deadline";
    const item = selectedItem(type);
    if (!item) return;
    const getDisplay = (student) => item.type === "daily"
      ? C.getDailyStatus(state, item.id, student.id, ui.dailyDate)
      : C.getDeadlineDisplayStatus(item, C.getDeadlineRecord(state, item.id, student.id));
    const visible = filteredStudents(getDisplay);
    const selectedMode = mode.startsWith("selected");
    const targets = selectedMode
      ? activeStudents().filter((student) => ui.selectedStudents.has(student.id))
      : visible;
    if (!targets.length) {
      toast("対象の児童がいません。", "error");
      return;
    }
    const status = mode.endsWith("submitted") ? "submitted" :
      mode.endsWith("exempt") ? "exempt" : "missing";
    const label = status === "submitted" ? "提出済み" : status === "exempt" ? "欠席・免除" : "未提出";
    confirmModal(
      "一括変更の確認",
      `${targets.length}人を「${label}」に変更します。よろしいですか。`,
      () => {
        targets.forEach((student) => {
          if (item.type === "daily") setDailyRecord(item, student.id, status);
          else setDeadlineRecord(item, student.id, status);
        });
        ui.selectedStudents.clear();
        saveState("");
        render();
        toast(`${targets.length}人を変更しました。`);
      }
    );
  }

  function downloadFile(filename, content, mime) {
    const blob = new Blob([content], { type: mime });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
  }

  function backupJson() {
    const dateKey = today().replaceAll("-", "");
    downloadFile(
      `学習トラッカー_バックアップ_${dateKey}.json`,
      JSON.stringify(state, null, 2),
      "application/json;charset=utf-8"
    );
    toast("JSONバックアップを作成しました。");
  }

  function csvCell(value) {
    const text = String(value ?? "");
    return `"${text.replaceAll('"', '""')}"`;
  }

  function statusLabel(status) {
    return (STATUS[status] || STATUS.missing).label;
  }

  function exportCsv() {
    const rows = [[
      "種類", "日付", "提出物名", "締め切り日時", "出席番号", "児童名",
      "状態", "期限内・期限後", "免除理由", "提出日時", "メモ"
    ]];
    const students = activeStudents();
    items("daily").forEach((item) => {
      const dates = C.getTargetDates(item, item.schedule.startDate, today());
      students.forEach((student) => {
        dates.forEach((dateKey) => {
          const record = C.getDailyRecord(state, item.id, student.id, dateKey);
          const status = C.getDailyStatus(state, item.id, student.id, dateKey);
          rows.push([
            "毎日型", dateKey, item.name, "", student.number, student.name,
            statusLabel(status), "", record?.reason || "", record?.submittedAt || "", record?.note || ""
          ]);
        });
      });
    });
    items("deadline").forEach((item) => {
      students.forEach((student) => {
        const record = C.getDeadlineRecord(state, item.id, student.id);
        const stored = C.getDeadlineStatus(state, item.id, student.id);
        const display = C.getDeadlineDisplayStatus(item, record);
        const timing = stored === "submitted" ? "期限内" :
          stored === "late" ? "期限後" :
          display === "overdue" ? "期限超過" : "";
        rows.push([
          "締め切り型", "", item.name,
          `${item.schedule.dueDate} ${item.schedule.dueTime || "23:59"}`,
          student.number, student.name, statusLabel(display), timing,
          record?.reason || "", record?.submittedAt || "", record?.note || ""
        ]);
      });
    });
    const csv = "\uFEFF" + rows.map((row) => row.map(csvCell).join(",")).join("\r\n");
    downloadFile(`学習トラッカー_${today().replaceAll("-", "")}.csv`, csv, "text/csv;charset=utf-8");
    toast("CSVを作成しました。");
  }

  function saveRosterInputs() {
    document.querySelectorAll("[data-roster-name]").forEach((input) => {
      const student = state.classInfo.students.find((entry) => entry.id === input.dataset.rosterName);
      if (student) student.name = input.value.trim();
    });
    saveState("");
    render();
    toast("名簿を保存しました。");
  }

  document.addEventListener("click", (event) => {
    const viewButton = event.target.closest("[data-view]");
    if (viewButton) {
      setView(viewButton.dataset.view);
      return;
    }
    const openItem = event.target.closest("[data-open-item]");
    if (openItem) {
      const item = state.items.find((entry) => entry.id === openItem.dataset.openItem);
      if (item) setView(item.type === "daily" ? "daily" : "deadline", item.id);
      return;
    }
    const studentLink = event.target.closest("[data-student]");
    if (studentLink) {
      ui.selectedStudentId = studentLink.dataset.student;
      setView("student");
      return;
    }
    const card = event.target.closest("[data-card-student]");
    if (card) {
      cycleStudent(card.dataset.cardStudent);
      return;
    }
    const detail = event.target.closest("[data-detail-student]");
    if (detail) {
      detailModal(detail.dataset.detailStudent);
      return;
    }
    const filter = event.target.closest("[data-filter]");
    if (filter) {
      ui.filter = filter.dataset.filter;
      render();
      return;
    }
    const historyFilter = event.target.closest("[data-history-filter]");
    if (historyFilter) {
      ui.historyFilter = historyFilter.dataset.historyFilter;
      render();
      return;
    }
    const bulk = event.target.closest("[data-bulk]");
    if (bulk) {
      applyBulk(bulk.dataset.bulk);
      return;
    }
    const editItem = event.target.closest("[data-edit-item]");
    if (editItem) {
      itemModal(state.items.find((item) => item.id === editItem.dataset.editItem));
      return;
    }
    const deleteItem = event.target.closest("[data-delete-item]");
    if (deleteItem) {
      const item = state.items.find((entry) => entry.id === deleteItem.dataset.deleteItem);
      if (!item) return;
      confirmModal(
        "提出物を削除",
        `「${item.name}」と、この提出物に含まれる記録をすべて削除します。元に戻せません。`,
        () => {
          state.items = state.items.filter((entry) => entry.id !== item.id);
          delete state.dailyRecords[item.id];
          delete state.deadlineRecords[item.id];
          if (ui.selectedItemId === item.id) ui.selectedItemId = "";
          saveState("");
          render();
          toast("提出物を削除しました。");
        },
        "削除する",
        true
      );
      return;
    }
    const toggleStudent = event.target.closest("[data-toggle-student]");
    if (toggleStudent) {
      const student = state.classInfo.students.find((entry) => entry.id === toggleStudent.dataset.toggleStudent);
      if (!student) return;
      student.active = student.active === false;
      saveState("");
      render();
      toast(student.active ? "児童を名簿に戻しました。" : "児童を集計対象から外しました。");
      return;
    }
    const action = event.target.closest("[data-action]")?.dataset.action;
    if (!action) return;
    if (action === "close-modal") closeModal();
    else if (action === "add-item") itemModal();
    else if (action === "add-daily") itemModal(null, "daily");
    else if (action === "add-deadline") itemModal(null, "deadline");
    else if (action === "edit-current-item") itemModal(selectedItem(ui.view === "daily" ? "daily" : "deadline"));
    else if (action === "open-settings") setView("settings");
    else if (action === "previous-date") {
      ui.dailyDate = C.addDaysToDateKey(ui.dailyDate, -1);
      render();
    } else if (action === "next-date") {
      ui.dailyDate = C.addDaysToDateKey(ui.dailyDate, 1);
      if (ui.dailyDate > today()) ui.dailyDate = today();
      render();
    } else if (action === "today") {
      ui.dailyDate = today();
      render();
    } else if (action === "clear-selection") {
      ui.selectedStudents.clear();
      render();
    } else if (action === "save-class") {
      state.classInfo.className = document.getElementById("class-name").value.trim();
      state.classInfo.teacherName = document.getElementById("teacher-name").value.trim();
      saveState("");
      render();
      toast("学級情報を保存しました。");
    } else if (action === "save-roster") saveRosterInputs();
    else if (action === "add-student") {
      const nextNumber = Math.max(0, ...state.classInfo.students.map((student) => Number(student.number))) + 1;
      state.classInfo.students.push({ id: `student-${Date.now()}-${nextNumber}`, number: nextNumber, name: "", active: true });
      saveState("");
      render();
      toast(`${nextNumber}番を追加しました。`);
    } else if (action === "backup-json") backupJson();
    else if (action === "import-json") fileInput.click();
    else if (action === "export-csv") exportCsv();
    else if (action === "run-tests") {
      const result = C.runTrackerTests();
      openModal(`
        <h2 id="modal-title">自動テスト結果</h2>
        <p class="modal-intro">${result.passed}件成功／${result.failed}件失敗。本番データは変更していません。</p>
        <div class="history-list">
          ${result.results.map((entry) => `<div class="history-item"><strong>${entry.passed ? "✓ 成功" : "! 失敗"}</strong><span>${esc(entry.name)}</span>${entry.passed ? statusBadge("submitted") : statusBadge("overdue")}</div>`).join("")}
        </div>
        <div class="modal-actions"><button class="button primary" type="button" data-action="close-modal">閉じる</button></div>
      `, true);
    } else if (action === "clear-data") {
      confirmModal(
        "全データを削除",
        "学級情報・名簿・提出物・記録・メモをすべて削除します。事前にJSONバックアップを保存することをおすすめします。",
        () => {
          localStorage.removeItem(C.STORAGE_KEY);
          state = C.createInitialState();
          ui.view = "dashboard";
          ui.selectedItemId = "";
          ui.selectedStudents.clear();
          closeModal();
          render();
          setupModal();
        },
        "すべて削除する",
        true
      );
    } else if (action === "save-student-note") {
      const student = selectedStudent();
      if (!student) return;
      state.studentNotes[student.id] = {
        note: document.getElementById("student-note").value.trim(),
        updatedAt: C.toJstIso()
      };
      saveState("");
      toast("児童メモを保存しました。");
    }
  });

  document.addEventListener("change", (event) => {
    if (event.target.matches('[data-action="select-item"]')) {
      ui.selectedItemId = event.target.value;
      ui.filter = "all";
      ui.search = "";
      ui.selectedStudents.clear();
      saveState("");
      render();
    } else if (event.target.matches('[data-action="daily-date"]')) {
      ui.dailyDate = event.target.value > today() ? today() : event.target.value;
      render();
    } else if (event.target.matches('[data-action="select-student"]')) {
      ui.selectedStudentId = event.target.value;
      render();
    } else if (event.target.matches("[data-select-student]")) {
      if (event.target.checked) ui.selectedStudents.add(event.target.dataset.selectStudent);
      else ui.selectedStudents.delete(event.target.dataset.selectStudent);
      render();
    }
  });

  document.addEventListener("input", (event) => {
    if (event.target.matches('[data-action="search"]')) {
      ui.search = event.target.value;
      const caret = event.target.selectionStart;
      render();
      const next = document.querySelector('[data-action="search"]');
      next?.focus();
      next?.setSelectionRange(caret, caret);
    }
  });

  fileInput.addEventListener("change", async () => {
    const file = fileInput.files?.[0];
    fileInput.value = "";
    if (!file) return;
    try {
      const candidate = JSON.parse(await file.text());
      const validation = C.validateState(candidate);
      if (!validation.valid) {
        toast(`読み込みできません: ${validation.errors[0]}`, "error");
        return;
      }
      confirmModal(
        "バックアップを読み込む",
        "現在のデータを、選択したバックアップの内容に置き換えます。よろしいですか。",
        () => {
          state = candidate;
          ui.selectedItemId = state.settings.selectedItemId || "";
          ui.dailyDate = state.settings.selectedDailyDate || today();
          ui.selectedStudentId = activeStudents()[0]?.id || "";
          ui.view = "dashboard";
          saveState("");
          render();
          toast("バックアップを読み込みました。");
        }
      );
    } catch (error) {
      toast("JSONの形式が正しくありません。現在のデータは変更していません。", "error");
    }
  });

  document.getElementById("print-button").addEventListener("click", () => window.print());
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && modalRoot.innerHTML) closeModal();
  });

  render();
  if (!state.settings.initialized) setupModal();
})();
