(function () {
  "use strict";

  const C = window.TrackerCore;
  if (!C) return;

  const CLASS_STORAGE_KEY = "learningTrackerClasses_v1";
  const LEGACY_KEY = C.STORAGE_KEY;
  const ACTIVE_KEY = "learningTrackerActiveClass_v1";

  function readJson(key, fallback) {
    try {
      const raw = localStorage.getItem(key);
      return raw ? JSON.parse(raw) : fallback;
    } catch (error) {
      console.error("学級データを読み込めませんでした。", error);
      return fallback;
    }
  }

  function writeJson(key, value) {
    localStorage.setItem(key, JSON.stringify(value));
  }

  function makeId() {
    return `class-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  }

  function loadClasses() {
    const stored = readJson(CLASS_STORAGE_KEY, null);
    if (stored && Array.isArray(stored.classes) && stored.classes.length) return stored;

    const legacy = readJson(LEGACY_KEY, null);
    const initial = legacy && C.validateState(legacy).valid ? legacy : C.createInitialState();
    const migrated = {
      version: 1,
      classes: [{ id: makeId(), name: initial.classInfo?.className || "6年1組", data: initial }]
    };
    writeJson(CLASS_STORAGE_KEY, migrated);
    writeJson(ACTIVE_KEY, migrated.classes[0].id);
    if (!legacy) writeJson(LEGACY_KEY, initial);
    return migrated;
  }

  let store = loadClasses();
  let activeId = localStorage.getItem(ACTIVE_KEY) || store.classes[0].id;
  if (!store.classes.some((entry) => entry.id === activeId)) activeId = store.classes[0].id;

  function activeClass() {
    return store.classes.find((entry) => entry.id === activeId) || store.classes[0];
  }

  function syncCurrentToActive() {
    const current = readJson(LEGACY_KEY, null);
    if (!current || !C.validateState(current).valid) return;
    const target = activeClass();
    if (!target) return;
    target.data = current;
    target.name = current.classInfo?.className || target.name || "学級";
    writeJson(CLASS_STORAGE_KEY, store);
  }

  function switchClass(id) {
    if (!store.classes.some((entry) => entry.id === id) || id === activeId) return;
    syncCurrentToActive();
    activeId = id;
    localStorage.setItem(ACTIVE_KEY, activeId);
    const target = activeClass();
    writeJson(LEGACY_KEY, target.data);
    location.reload();
  }

  function createClass() {
    const name = window.prompt("新しい学級名を入力してください。", "6年2組");
    if (!name || !name.trim()) return;
    syncCurrentToActive();
    const data = C.createInitialState();
    data.classInfo.className = name.trim();
    data.settings.initialized = false;
    const entry = { id: makeId(), name: name.trim(), data };
    store.classes.push(entry);
    writeJson(CLASS_STORAGE_KEY, store);
    activeId = entry.id;
    localStorage.setItem(ACTIVE_KEY, activeId);
    writeJson(LEGACY_KEY, data);
    location.reload();
  }

  function renameClass() {
    const target = activeClass();
    if (!target) return;
    const name = window.prompt("学級名を変更します。", target.name || "学級");
    if (!name || !name.trim()) return;
    const trimmed = name.trim();
    syncCurrentToActive();
    target.name = trimmed;
    target.data.classInfo.className = trimmed;
    writeJson(CLASS_STORAGE_KEY, store);
    writeJson(LEGACY_KEY, target.data);
    location.reload();
  }

  function deleteClass() {
    if (store.classes.length <= 1) {
      window.alert("最後の1学級は削除できません。\n新しい学級を作ってから削除してください。");
      return;
    }
    const target = activeClass();
    if (!target) return;
    if (!window.confirm(`「${target.name}」のデータを削除します。\n名簿・提出物・記録・メモもすべて削除されます。よろしいですか？`)) return;
    store.classes = store.classes.filter((entry) => entry.id !== target.id);
    activeId = store.classes[0].id;
    writeJson(CLASS_STORAGE_KEY, store);
    localStorage.setItem(ACTIVE_KEY, activeId);
    writeJson(LEGACY_KEY, activeClass().data);
    location.reload();
  }

  function injectUi() {
    const classLabel = document.getElementById("class-label");
    if (!classLabel || document.getElementById("class-switcher")) return;

    const wrap = document.createElement("div");
    wrap.id = "class-switcher";
    wrap.innerHTML = `
      <select aria-label="学級を切り替える" title="学級を切り替える">
        ${store.classes.map((entry) => `<option value="${escapeHtml(entry.id)}" ${entry.id === activeId ? "selected" : ""}>${escapeHtml(entry.name || "学級")}</option>`).join("")}
      </select>
      <button type="button" data-class-action="add" title="学級を追加">＋学級</button>
      <button type="button" data-class-action="rename" title="学級名を変更">名前変更</button>
      <button type="button" data-class-action="delete" title="現在の学級を削除">削除</button>
    `;
    classLabel.replaceWith(wrap);

    wrap.querySelector("select").addEventListener("change", (event) => switchClass(event.target.value));
    wrap.addEventListener("click", (event) => {
      const button = event.target.closest("[data-class-action]");
      if (!button) return;
      if (button.dataset.classAction === "add") createClass();
      if (button.dataset.classAction === "rename") renameClass();
      if (button.dataset.classAction === "delete") deleteClass();
    });
  }

  function escapeHtml(value) {
    return String(value ?? "")
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#039;");
  }

  // 既存アプリの「全データ削除」と学級管理データを連動させる。
  const originalRemoveItem = localStorage.removeItem.bind(localStorage);
  localStorage.removeItem = function (key) {
    if (key === LEGACY_KEY) {
      originalRemoveItem(CLASS_STORAGE_KEY);
      originalRemoveItem(ACTIVE_KEY);
    }
    return originalRemoveItem(key);
  };

  const style = document.createElement("style");
  style.textContent = `
    #class-switcher { display:flex; align-items:center; gap:6px; flex-wrap:wrap; margin-top:3px; }
    #class-switcher select, #class-switcher button { font:inherit; border:1px solid rgba(0,0,0,.18); border-radius:8px; background:#fff; color:inherit; padding:5px 8px; }
    #class-switcher select { max-width:145px; font-weight:700; }
    #class-switcher button { cursor:pointer; font-size:.82em; }
    #class-switcher button:hover { filter:brightness(.97); }
    @media (max-width:640px) {
      #class-switcher { gap:4px; }
      #class-switcher select { max-width:120px; }
      #class-switcher button { padding:4px 6px; font-size:.75em; }
    }
  `;
  document.head.appendChild(style);

  // 現在の学級名・データを起動時に最新状態へ同期。
  syncCurrentToActive();
  writeJson(ACTIVE_KEY, activeId);
  injectUi();

  window.TrackerClassManager = {
    switchClass,
    createClass,
    renameClass,
    deleteClass,
    syncCurrentToActive
  };
})();
