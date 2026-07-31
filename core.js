(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  root.TrackerCore = api;
  root.runTrackerTests = api.runTrackerTests;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  const VERSION = 1;
  const STORAGE_KEY = "learningTrackerState_v1";
  const VALID_STATUSES = ["missing", "submitted", "late", "exempt"];

  function pad(value) {
    return String(value).padStart(2, "0");
  }

  function jstParts(date = new Date()) {
    const parts = new Intl.DateTimeFormat("en-US", {
      timeZone: "Asia/Tokyo",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hourCycle: "h23"
    }).formatToParts(date);
    return Object.fromEntries(parts.map((part) => [part.type, part.value]));
  }

  function getTodayJST(date = new Date()) {
    const p = jstParts(date);
    return `${p.year}-${p.month}-${p.day}`;
  }

  function toJstIso(date = new Date()) {
    const p = jstParts(date);
    return `${p.year}-${p.month}-${p.day}T${p.hour}:${p.minute}:${p.second}+09:00`;
  }

  function addDaysToDateKey(dateKey, amount) {
    const [year, month, day] = dateKey.split("-").map(Number);
    const date = new Date(Date.UTC(year, month - 1, day + amount));
    return `${date.getUTCFullYear()}-${pad(date.getUTCMonth() + 1)}-${pad(date.getUTCDate())}`;
  }

  function getWeekday(dateKey) {
    const [year, month, day] = dateKey.split("-").map(Number);
    return new Date(Date.UTC(year, month - 1, day)).getUTCDay();
  }

  function isDateKey(value) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(value || "")) return false;
    const [year, month, day] = value.split("-").map(Number);
    const d = new Date(Date.UTC(year, month - 1, day));
    return d.getUTCFullYear() === year &&
      d.getUTCMonth() + 1 === month &&
      d.getUTCDate() === day;
  }

  function minDateKey(a, b) {
    return a <= b ? a : b;
  }

  function maxDateKey(a, b) {
    return a >= b ? a : b;
  }

  function matchesSchedule(item, dateKey) {
    const pattern = item?.schedule?.pattern || "everyday";
    const weekday = getWeekday(dateKey);
    if (pattern === "everyday") return true;
    if (pattern === "weekday") return weekday >= 1 && weekday <= 5;
    if (pattern === "custom") {
      return (item.schedule.days || []).map(Number).includes(weekday);
    }
    return false;
  }

  function getTargetDates(item, startDate, endDate, options = {}) {
    if (!item || item.type !== "daily") return [];
    const today = options.today || getTodayJST();
    const itemStart = item.schedule?.startDate;
    if (!isDateKey(itemStart)) return [];
    const requestedStart = isDateKey(startDate) ? startDate : itemStart;
    const requestedEnd = isDateKey(endDate) ? endDate : today;
    const from = maxDateKey(itemStart, requestedStart);
    const to = minDateKey(requestedEnd, today);
    if (from > to) return [];

    const dates = [];
    for (let cursor = from; cursor <= to; cursor = addDaysToDateKey(cursor, 1)) {
      if (matchesSchedule(item, cursor)) dates.push(cursor);
    }
    return dates;
  }

  function normalizeStatus(status) {
    return VALID_STATUSES.includes(status) ? status : "missing";
  }

  function calculateRateFromStatuses(statuses) {
    const result = {
      submitted: 0,
      late: 0,
      missing: 0,
      exempt: 0,
      denominator: 0,
      numerator: 0,
      rate: null
    };

    statuses.map(normalizeStatus).forEach((status) => {
      result[status] += 1;
      if (status !== "exempt") result.denominator += 1;
      if (status === "submitted" || status === "late") result.numerator += 1;
    });

    result.rate = result.denominator
      ? Math.round((result.numerator / result.denominator) * 100)
      : null;
    return result;
  }

  function getDailyRecord(state, itemId, studentId, dateKey) {
    return state.dailyRecords?.[itemId]?.[studentId]?.[dateKey] || null;
  }

  function getDailyStatus(state, itemId, studentId, dateKey) {
    return normalizeStatus(getDailyRecord(state, itemId, studentId, dateKey)?.status);
  }

  function calculateDailyItemStats(state, item, students, startDate, endDate, options = {}) {
    const targetDates = getTargetDates(item, startDate, endDate, options);
    const statuses = [];
    students.forEach((student) => {
      targetDates.forEach((dateKey) => {
        statuses.push(getDailyStatus(state, item.id, student.id, dateKey));
      });
    });
    return { ...calculateRateFromStatuses(statuses), targetDates };
  }

  function calculateDailyStudentStats(state, item, studentId, startDate, endDate, options = {}) {
    return calculateDailyItemStats(
      state,
      item,
      [{ id: studentId }],
      startDate,
      endDate,
      options
    );
  }

  function getDueAt(item) {
    const dueDate = item?.schedule?.dueDate;
    const dueTime = item?.schedule?.dueTime || "23:59";
    return new Date(`${dueDate}T${dueTime}:00+09:00`);
  }

  function determineDeadlineSubmissionStatus(item, submittedAt) {
    return new Date(submittedAt) <= getDueAt(item) ? "submitted" : "late";
  }

  function getDeadlineRecord(state, itemId, studentId) {
    return state.deadlineRecords?.[itemId]?.[studentId] || null;
  }

  function getDeadlineStatus(state, itemId, studentId) {
    return normalizeStatus(getDeadlineRecord(state, itemId, studentId)?.status);
  }

  function getDeadlineDisplayStatus(item, record, now = new Date()) {
    const status = normalizeStatus(record?.status);
    if (status === "missing" && now > getDueAt(item)) return "overdue";
    return status;
  }

  function calculateDeadlineItemStats(state, item, students, now = new Date()) {
    const statuses = students.map((student) =>
      getDeadlineStatus(state, item.id, student.id)
    );
    const result = calculateRateFromStatuses(statuses);
    result.overdue = students.filter((student) =>
      getDeadlineDisplayStatus(item, getDeadlineRecord(state, item.id, student.id), now) === "overdue"
    ).length;
    return result;
  }

  function getNextBaseStatus(currentStatus) {
    const current = normalizeStatus(currentStatus);
    if (current === "missing") return "submitted";
    if (current === "submitted" || current === "late") return "exempt";
    return "missing";
  }

  function getNextDeadlineStatus(item, currentStatus, changedAt) {
    const next = getNextBaseStatus(currentStatus);
    return next === "submitted"
      ? determineDeadlineSubmissionStatus(item, changedAt)
      : next;
  }

  function createStudents(count) {
    return Array.from({ length: Math.max(1, Math.min(60, Number(count) || 30)) }, (_, index) => ({
      id: `student-${Date.now()}-${index + 1}`,
      number: index + 1,
      name: "",
      active: true
    }));
  }

  function createInitialState() {
    return {
      version: VERSION,
      settings: {
        initialized: false,
        lastSavedAt: "",
        selectedItemId: "",
        selectedDailyDate: getTodayJST(),
        theme: "green"
      },
      classInfo: {
        className: "",
        teacherName: "",
        students: createStudents(30)
      },
      items: [],
      dailyRecords: {},
      deadlineRecords: {},
      studentNotes: {}
    };
  }

  function validateState(candidate) {
    const errors = [];
    if (!candidate || typeof candidate !== "object") errors.push("データ全体がオブジェクトではありません。");
    if (candidate?.version !== VERSION) errors.push(`対応していないバージョンです（必要: ${VERSION}）。`);
    if (!candidate?.classInfo || !Array.isArray(candidate.classInfo.students)) errors.push("名簿データがありません。");
    if (!Array.isArray(candidate?.items)) errors.push("提出物データがありません。");
    if (!candidate?.dailyRecords || typeof candidate.dailyRecords !== "object") errors.push("毎日型記録がありません。");
    if (!candidate?.deadlineRecords || typeof candidate.deadlineRecords !== "object") errors.push("締め切り型記録がありません。");
    if (!candidate?.studentNotes || typeof candidate.studentNotes !== "object") errors.push("児童メモがありません。");

    const studentIds = new Set();
    (candidate?.classInfo?.students || []).forEach((student, index) => {
      if (!student?.id || studentIds.has(student.id)) errors.push(`名簿${index + 1}番目のIDが不正です。`);
      studentIds.add(student?.id);
      if (!Number.isFinite(Number(student?.number))) errors.push(`名簿${index + 1}番目の番号が不正です。`);
    });

    (candidate?.items || []).forEach((item, index) => {
      if (!item?.id || !["daily", "deadline"].includes(item.type)) {
        errors.push(`提出物${index + 1}件目の形式が不正です。`);
      }
      if (item?.type === "daily" && !isDateKey(item.schedule?.startDate)) {
        errors.push(`毎日型「${item?.name || index + 1}」の開始日が不正です。`);
      }
      if (item?.type === "deadline" &&
          (!isDateKey(item.schedule?.registeredDate) || !isDateKey(item.schedule?.dueDate))) {
        errors.push(`締め切り型「${item?.name || index + 1}」の日付が不正です。`);
      }
    });
    return { valid: errors.length === 0, errors };
  }

  function monthRange(monthKey) {
    const [year, month] = monthKey.split("-").map(Number);
    const last = new Date(Date.UTC(year, month, 0)).getUTCDate();
    return {
      start: `${year}-${pad(month)}-01`,
      end: `${year}-${pad(month)}-${pad(last)}`
    };
  }

  function runTrackerTests() {
    const results = [];
    function assertEqual(actual, expected, label) {
      if (actual !== expected) {
        throw new Error(`${label}: 期待値 ${expected} / 実際 ${actual}`);
      }
    }
    function test(name, callback) {
      try {
        callback();
        results.push({ name, passed: true, message: "成功" });
        console.log(`✅ ${name}`);
      } catch (error) {
        results.push({ name, passed: false, message: error.message });
        console.error(`❌ ${name}: ${error.message}`);
      }
    }

    const students = [{ id: "s1", number: 1, name: "児童A" }];
    const daily = {
      id: "d1",
      type: "daily",
      name: "宿題",
      schedule: { startDate: "2026-07-01", pattern: "everyday", days: [] }
    };
    function testState(records) {
      return {
        dailyRecords: { d1: { s1: records } },
        deadlineRecords: {}
      };
    }
    const options = { today: "2026-07-03" };

    test("毎日型1：提出・免除・記録なし＝50％", () => {
      const state = testState({
        "2026-07-01": { status: "submitted" },
        "2026-07-02": { status: "exempt" }
      });
      const r = calculateDailyItemStats(state, daily, students, "2026-07-01", "2026-07-03", options);
      assertEqual(r.submitted, 1, "提出済み");
      assertEqual(r.exempt, 1, "免除");
      assertEqual(r.missing, 1, "未提出");
      assertEqual(r.denominator, 2, "分母");
      assertEqual(r.numerator, 1, "分子");
      assertEqual(r.rate, 50, "提出率");
    });

    test("毎日型2：3日間記録なし＝0％", () => {
      const r = calculateDailyItemStats(testState({}), daily, students, "2026-07-01", "2026-07-03", options);
      assertEqual(r.missing, 3, "未提出");
      assertEqual(r.denominator, 3, "分母");
      assertEqual(r.numerator, 0, "分子");
      assertEqual(r.rate, 0, "提出率");
    });

    test("毎日型3：提出1・未提出2＝33％", () => {
      const r = calculateDailyItemStats(
        testState({ "2026-07-01": { status: "submitted" } }),
        daily, students, "2026-07-01", "2026-07-03", options
      );
      assertEqual(r.denominator, 3, "分母");
      assertEqual(r.numerator, 1, "分子");
      assertEqual(r.rate, 33, "提出率");
    });

    test("毎日型4：提出2・免除1＝100％", () => {
      const r = calculateDailyItemStats(testState({
        "2026-07-01": { status: "submitted" },
        "2026-07-02": { status: "exempt" },
        "2026-07-03": { status: "submitted" }
      }), daily, students, "2026-07-01", "2026-07-03", options);
      assertEqual(r.denominator, 2, "分母");
      assertEqual(r.numerator, 2, "分子");
      assertEqual(r.rate, 100, "提出率");
    });

    const deadline = {
      id: "x1",
      type: "deadline",
      schedule: {
        registeredDate: "2026-07-01",
        dueDate: "2026-07-10",
        dueTime: "16:00"
      }
    };

    test("締め切り型1：期限内提出を保持", () => {
      const submittedAt = "2026-07-08T08:20:00+09:00";
      assertEqual(determineDeadlineSubmissionStatus(deadline, submittedAt), "submitted", "状態");
      const record = { status: "submitted", submittedAt };
      assertEqual(getDeadlineDisplayStatus(deadline, record, new Date("2026-07-20T10:00:00+09:00")), "submitted", "後日の表示");
    });

    test("締め切り型2：期限後提出は遅れて提出", () => {
      const status = determineDeadlineSubmissionStatus(deadline, "2026-07-11T08:00:00+09:00");
      assertEqual(status, "late", "状態");
      const rate = calculateRateFromStatuses([status]);
      assertEqual(rate.denominator, 1, "分母");
      assertEqual(rate.numerator, 1, "分子");
    });

    test("締め切り型3：期限超過は保存上missing", () => {
      const record = { status: "missing" };
      assertEqual(record.status, "missing", "保存状態");
      assertEqual(getDeadlineDisplayStatus(deadline, record, new Date("2026-07-11T08:00:00+09:00")), "overdue", "表示状態");
      const rate = calculateRateFromStatuses([record.status]);
      assertEqual(rate.denominator, 1, "分母");
      assertEqual(rate.numerator, 0, "分子");
    });

    test("締め切り型4：免除は分母・分子から除外", () => {
      const rate = calculateRateFromStatuses(["exempt"]);
      assertEqual(rate.denominator, 0, "分母");
      assertEqual(rate.numerator, 0, "分子");
    });

    test("タップ操作：3回で一巡", () => {
      const first = getNextBaseStatus("missing");
      const second = getNextBaseStatus(first);
      const third = getNextBaseStatus(second);
      assertEqual(first, "submitted", "1回目");
      assertEqual(second, "exempt", "2回目");
      assertEqual(third, "missing", "3回目");
    });

    test("期限後タップ：missingからlate", () => {
      const next = getNextDeadlineStatus(deadline, "missing", "2026-07-11T08:00:00+09:00");
      assertEqual(next, "late", "1回目");
    });

    test("対象日：平日・未来日・開始日を正しく判定", () => {
      const item = {
        ...daily,
        schedule: { startDate: "2026-07-02", pattern: "weekday", days: [] }
      };
      const dates = getTargetDates(item, "2026-06-25", "2026-07-10", { today: "2026-07-05" });
      assertEqual(JSON.stringify(dates), JSON.stringify(["2026-07-02", "2026-07-03"]), "対象日");
    });

    test("JSON往復後も集計が一致", () => {
      const original = testState({ "2026-07-01": { status: "submitted" } });
      const cloned = JSON.parse(JSON.stringify(original));
      const a = calculateDailyItemStats(original, daily, students, "2026-07-01", "2026-07-03", options);
      const b = calculateDailyItemStats(cloned, daily, students, "2026-07-01", "2026-07-03", options);
      assertEqual(JSON.stringify(a), JSON.stringify(b), "集計");
    });

    const passed = results.filter((result) => result.passed).length;
    const failed = results.length - passed;
    console.table(results);
    console.log(`学習トラッカー: ${passed}件成功／${failed}件失敗`);
    return { passed, failed, results };
  }

  return {
    VERSION,
    STORAGE_KEY,
    VALID_STATUSES,
    getTodayJST,
    toJstIso,
    addDaysToDateKey,
    getWeekday,
    isDateKey,
    getTargetDates,
    calculateRateFromStatuses,
    getDailyRecord,
    getDailyStatus,
    calculateDailyItemStats,
    calculateDailyStudentStats,
    getDueAt,
    determineDeadlineSubmissionStatus,
    getDeadlineRecord,
    getDeadlineStatus,
    getDeadlineDisplayStatus,
    calculateDeadlineItemStats,
    getNextBaseStatus,
    getNextDeadlineStatus,
    createStudents,
    createInitialState,
    validateState,
    monthRange,
    runTrackerTests
  };
});
