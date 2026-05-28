(function () {
  "use strict";

  const STORAGE_KEY = "tokushin_v2_state";
  const STATE_SCHEMA = 5;
  const APP_DATE = "2026-05-28";
  const CSV_FILES = {
    students: "students_v2.csv",
    courses: "courses_v2.csv",
    enrollments: "course_enrollments_v2.csv",
    attendance: "attendance_v2.csv",
    surveys: "survey_responses_v2.csv",
    changes: "course_changes_v2.csv",
    thresholds: "thresholds_v2.csv",
    actions: "staff_actions_v2.csv",
    teacherNotes: "teacher_notes_v2.csv",
    staffMaster: "staff_master_v2.csv",
    applications: "applications_v2.csv",
  };

  let state = null;
  let latestExport = { filename: "export_v2.csv", csv: "" };
  let tabletLastResult = "";
  let toastTimer = null;

  const qs = (selector, root = document) => root.querySelector(selector);
  const qsa = (selector, root = document) => Array.from(root.querySelectorAll(selector));
  const esc = (value) =>
    String(value ?? "")
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#039;");

  function parseCsvLine(line) {
    const values = [];
    let current = "";
    let quoted = false;
    for (let i = 0; i < line.length; i += 1) {
      const char = line[i];
      const next = line[i + 1];
      if (char === '"' && quoted && next === '"') {
        current += '"';
        i += 1;
      } else if (char === '"') {
        quoted = !quoted;
      } else if (char === "," && !quoted) {
        values.push(current);
        current = "";
      } else {
        current += char;
      }
    }
    values.push(current);
    return values;
  }

  function parseCsv(text) {
    const rows = String(text)
      .replace(/^\uFEFF/, "")
      .split(/\r?\n/)
      .filter((line) => line.trim() !== "");
    if (rows.length === 0) return [];
    const headers = parseCsvLine(rows[0]);
    return rows.slice(1).map((row) => {
      const values = parseCsvLine(row);
      return headers.reduce((item, header, index) => {
        item[header] = values[index] ?? "";
        return item;
      }, {});
    });
  }

  function csvValue(value) {
    const text = String(value ?? "");
    if (/[",\n]/.test(text)) return `"${text.replaceAll('"', '""')}"`;
    return text;
  }

  function toCsv(rows, headers) {
    return [headers.join(","), ...rows.map((row) => headers.map((header) => csvValue(row[header])).join(","))].join("\n");
  }

  async function loadCsv(file) {
    const path = `data/${file}`;
    if (window.__MOCK_V2_CSVS__ && window.__MOCK_V2_CSVS__[path]) {
      return parseCsv(window.__MOCK_V2_CSVS__[path]);
    }
    const response = await fetch(path);
    if (!response.ok) throw new Error(`${path} を読み込めませんでした`);
    return parseCsv(await response.text());
  }

  async function buildInitialState() {
    const entries = await Promise.all(
      Object.entries(CSV_FILES).map(async ([key, file]) => [key, await loadCsv(file)])
    );
    const initial = Object.fromEntries(entries);
    return {
      version: STATE_SCHEMA,
      loadedAt: nowStamp(),
      selected: {},
      ui: { studentShowHistory: false, attendanceMode: "read", studentCourseView: "today" },
      ...initial,
    };
  }

  function loadStoredState() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return null;
      const parsed = JSON.parse(raw);
      if (!parsed || parsed.version !== STATE_SCHEMA) return null;
      return parsed;
    } catch (_error) {
      return null;
    }
  }

  function saveState() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    } catch (_error) {
      showToast("ブラウザ保存に失敗しました。");
    }
  }

  function nowStamp() {
    const date = new Date();
    const pad = (num) => String(num).padStart(2, "0");
    return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
  }

  function makeId(prefix) {
    return `${prefix}-${Date.now()}-${Math.floor(Math.random() * 1000)}`;
  }

  function numberValue(value) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : 0;
  }

  function minutes(time) {
    const [hour, minute] = String(time || "00:00").split(":").map(Number);
    return (hour || 0) * 60 + (minute || 0);
  }

  function studentById(studentId) {
    return state.students.find((student) => student.student_id === studentId);
  }

  function studentName(studentId) {
    const student = studentById(studentId);
    return student ? student.display_name : studentId;
  }

  function studentNumber(student) {
    return student?.student_number || student?.login_id || student?.student_id || "";
  }

  function courseById(courseId) {
    return state.courses.find((course) => course.course_id === courseId);
  }

  function courseLabel(course) {
    if (!course) return "";
    return `${course.course_name} / ${course.grade} / ${course.venue}${course.room} / ${course.date} ${course.start_time}`;
  }

  function courseShort(course) {
    if (!course) return "";
    return `${course.course_name} ${course.grade} ${course.room} / ${course.teacher_name}`;
  }

  function materialsList(course) {
    return course?.materials ? course.materials.split("/").map((item) => item.trim()).filter(Boolean) : [];
  }

  function materialsButton(course) {
    return course && course.materials ? `<button class="small" type="button" data-course-materials="${esc(course.course_id)}">配布物</button>` : "";
  }

  function courseMeta(course) {
    if (!course) return "";
    return `${course.subject} / ${course.term} / ${course.venue} ${course.room} / ${course.date} ${course.start_time}-${course.end_time} / ${course.teacher_name}`;
  }

  function courseStatusChip(course) {
    const statusMap = {
      active: ["通常", ""],
      cancelled: ["休講", "red"],
      rescheduled: ["日程変更", "amber"],
      room_changed: ["教室変更", "amber"],
      time_changed: ["時間変更", "amber"],
      teacher_changed: ["講師変更", "amber"],
    };
    const [label, color] = statusMap[course?.status] || [course?.status || "-", ""];
    return `<span class="chip ${color}">${esc(label)}</span>`;
  }

  function renderCourseCard(course, options = {}) {
    if (!course) return "";
    const chips = [courseStatusChip(course), ...(options.chips || [])].join("");
    const selected = options.selected ? " selected" : "";
    return `
      <div class="course-card${selected}" data-course-id="${esc(course.course_id)}">
        <div class="course-card-head">
          <strong>${esc(courseShort(course))}</strong>
          <span class="status-row">${chips}</span>
        </div>
        <p class="meta">${options.meta || esc(courseMeta(course))}</p>
        ${options.extra || ""}
        <div class="actions">
          <button class="small" type="button" data-course-detail="${esc(course.course_id)}">詳細</button>
          ${options.actions || ""}
        </div>
      </div>
    `;
  }

  function studentCourseCard(course, studentId) {
    const attendance = attendanceFor(studentId, course.course_id);
    const response = surveyFor(studentId, course.course_id);
    const checkinStatus = attendance?.checkin_status || "未入室";
    const surveyState = surveyWindow(course, response);
    const surveyStatus = response?.status || surveyState;
    const checkinDone = checkinStatus === "入室済";
    const surveyDone = surveyStatus === "提出済" || surveyState === "回答済み";
    const canSurvey = surveyState === "回答受付中";
    const status = `
      <div class="status-row">
        <span class="chip ${statusColor(checkinStatus)}">出席 ${esc(checkinStatus)}</span>
        <span class="chip ${statusColor(surveyDone ? "提出済" : "未提出")}">アンケート ${esc(surveyDone ? "回答済み" : surveyStatus)}</span>
      </div>
    `;
    const actions = `
      <button class="small ${checkinDone ? "" : "primary"}" type="button" data-student-checkin="${esc(course.course_id)}">${checkinDone ? "入室済み" : "出席登録"}</button>
      <button class="small ${canSurvey ? "primary" : ""}" type="button" data-student-survey="${esc(course.course_id)}" ${canSurvey ? "" : "disabled"}>${surveyDone ? "回答済み" : canSurvey ? "アンケート回答" : surveyState}</button>
    `;
    return renderCourseCard(course, { extra: status, actions });
  }

  function sortCourses(courses) {
    return [...courses].sort((a, b) =>
      `${a.date} ${a.start_time} ${a.venue} ${a.room} ${a.grade}`.localeCompare(
        `${b.date} ${b.start_time} ${b.venue} ${b.room} ${b.grade}`,
        "ja"
      )
    );
  }

  function activeEnrollments() {
    return state.enrollments.filter((enrollment) => enrollment.enrollment_status === "active");
  }

  function studentCourses(studentId) {
    const courseIds = activeEnrollments()
      .filter((enrollment) => enrollment.student_id === studentId)
      .map((enrollment) => enrollment.course_id);
    return sortCourses(state.courses.filter((course) => courseIds.includes(course.course_id)));
  }

  function courseStudentIds(courseId, includeAttendance = false) {
    const ids = activeEnrollments()
      .filter((enrollment) => enrollment.course_id === courseId)
      .map((enrollment) => enrollment.student_id);
    if (includeAttendance) {
      state.attendance
        .filter((record) => record.course_id === courseId)
        .forEach((record) => {
          if (!ids.includes(record.student_id)) ids.push(record.student_id);
        });
    }
    return ids;
  }

  function attendanceFor(studentId, courseId, create = false) {
    let record = state.attendance.find((item) => item.student_id === studentId && item.course_id === courseId);
    if (!record && create) {
      record = {
        attendance_id: makeId("ATT-V2"),
        student_id: studentId,
        course_id: courseId,
        checkin_status: "未入室",
        checkin_time: "",
        method: "未実施",
        checkout_status: "未退室",
        survey_status: "未提出",
        exception_note: "",
        corrected_by: "",
        corrected_reason: "",
        confirmed_status: "未確認",
      };
      state.attendance.push(record);
    }
    return record;
  }

  function surveyFor(studentId, courseId, create = false) {
    let response = state.surveys.find((item) => item.student_id === studentId && item.course_id === courseId);
    if (!response && create) {
      response = {
        response_id: makeId("SR-V2"),
        student_id: studentId,
        course_id: courseId,
        status: "下書き",
        satisfaction: "",
        difficulty: "",
        understanding: "",
        comment: "",
        consultation: "no",
        submitted_at: "",
        input_method: "app",
        input_by: "student",
      };
      state.surveys.push(response);
    }
    return response;
  }

  function isEnrolled(studentId, courseId) {
    return activeEnrollments().some((enrollment) => enrollment.student_id === studentId && enrollment.course_id === courseId);
  }

  function addAction(action) {
    state.actions.unshift({
      action_id: makeId("ACT-V2"),
      role: action.role || "staff",
      actor: action.actor || "staff-tanaka",
      action_type: action.action_type,
      target_type: action.target_type || "",
      target_id: action.target_id || "",
      before_value: action.before_value || "",
      after_value: action.after_value || "",
      reason: action.reason || "",
      assignee: action.assignee || "",
      created_at: action.created_at || nowStamp(),
    });
  }

  function setSelectedDefaults() {
    state.selected ||= {};
    state.ui ||= {};
    state.selected.studentId ||= state.students[0]?.student_id || "";
    state.selected.staffVenue ||= "A校";
    const firstStaffCourse = sortCourses(
      state.courses.filter((course) => course.venue === state.selected.staffVenue && course.date === APP_DATE)
    )[0];
    if (!Object.prototype.hasOwnProperty.call(state.selected, "staffCourseId")) {
      state.selected.staffCourseId = firstStaffCourse?.course_id || state.courses[0]?.course_id || "";
    }
    state.selected.teacherId ||= state.courses.find((course) => course.date === APP_DATE)?.teacher_id || state.courses[0]?.teacher_id || "";
    const firstTeacherCourse = sortCourses(
      state.courses.filter((course) => course.teacher_id === state.selected.teacherId && course.date === APP_DATE)
    )[0];
    state.selected.teacherCourseId ||= firstTeacherCourse?.course_id || state.courses[0]?.course_id || "";
    const firstStudentCourse = studentCourses(state.selected.studentId).find((course) => course.date === APP_DATE);
    state.selected.attendanceCourseId ||= firstStudentCourse?.course_id || studentCourses(state.selected.studentId)[0]?.course_id || "";
    state.selected.surveyCourseId ||= firstStudentCourse?.course_id || "";
    state.ui.studentShowHistory = Boolean(state.ui.studentShowHistory);
    state.ui.attendanceMode ||= "read";
    state.ui.studentCourseView ||= "today";
    state.ui.studentCalendarDate ||= APP_DATE;
    state.ui.realtimeSearch ||= "";
    state.ui.masterEdit ||= { students: false, courses: false, staff: false, applications: false, thresholds: false };
    state.ui.masterFilter ||= { students: "", courses: "", staff: "", applications: "" };
    state.ui.riskView ||= "all";
    state.ui.readNotices ||= [];
    state.selected.tabletVenue ||= "A校";
    const firstTabletCourse = sortCourses(
      state.courses.filter((course) => course.venue === state.selected.tabletVenue && course.date === APP_DATE)
    )[0];
    if (!Object.prototype.hasOwnProperty.call(state.selected, "tabletCourseId")) {
      state.selected.tabletCourseId = firstTabletCourse?.course_id || "";
    }
    state.selected.tabletStudentId ||= "";
  }

  function showToast(message) {
    const toast = qs("#toast");
    if (!toast) return;
    toast.textContent = message;
    toast.classList.add("show");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => toast.classList.remove("show"), 2800);
  }

  function metric(label, value, color = "") {
    return `<div class="metric"><span>${esc(label)}</span><strong class="${esc(color)}">${esc(value)}</strong></div>`;
  }

  function itemHtml(title, meta, chip = "", extra = "") {
    return `<div class="item"><div class="item-title"><strong>${title}</strong>${chip}</div><p class="meta">${meta}</p>${extra}</div>`;
  }

  function statusColor(status) {
    if (["入室済", "提出済", "回答済み", "確認済", "active", "登録済", "対応済み"].includes(status)) return "green";
    if (["未入室", "未提出", "未確認", "下書き", "紙回収待ち", "対応予定", "未対応"].includes(status)) return "amber";
    if (["欠席", "休講", "cancelled"].includes(status)) return "red";
    return "";
  }

  function surveyWindow(course, response) {
    if (!course || course.survey_required !== "yes") return "対象外";
    if (response?.status === "提出済") return "回答済み";
    if (course.status === "cancelled") return "受付終了";
    if (course.date > APP_DATE) return "受付開始前";
    if (course.date < APP_DATE) return "受付終了";
    return "回答受付中";
  }

  function selectTab(target) {
    if (!target) return;
    qsa("[data-tab-target]").forEach((button) => {
      button.classList.toggle("active", button.dataset.tabTarget === target);
    });
    qsa("[data-tab-panel]").forEach((panel) => {
      panel.classList.toggle("active", panel.dataset.tabPanel === target);
    });
  }

  function bindCommonEvents() {
    document.addEventListener("click", (event) => {
      const tabButton = event.target.closest("[data-tab-target]");
      if (tabButton) {
        selectTab(tabButton.dataset.tabTarget);
        return;
      }

      const resetButton = event.target.closest("[data-reset-state]");
      if (resetButton) {
        localStorage.removeItem(STORAGE_KEY);
        window.location.reload();
        return;
      }

      const closeModal = event.target.closest("[data-close-modal]");
      if (closeModal) {
        closeModalWindow();
        return;
      }

      const detailButton = event.target.closest("[data-course-detail]");
      if (detailButton) {
        openCourseModal(detailButton.dataset.courseDetail);
        return;
      }

      const materialsTrigger = event.target.closest("[data-course-materials]");
      if (materialsTrigger) {
        openMaterialsModal(materialsTrigger.dataset.courseMaterials);
        return;
      }

      const handoverButton = event.target.closest("[data-material-handover]");
      if (handoverButton) {
        recordMaterialHandover(handoverButton.dataset.materialHandover);
        return;
      }

      const remindButton = event.target.closest("[data-material-remind]");
      if (remindButton) {
        recordMaterialReminder(remindButton.dataset.materialRemind);
        return;
      }

      const markReadButton = event.target.closest("[data-mark-notices-read]");
      if (markReadButton) {
        const ids = markReadButton.dataset.markNoticesRead.split(",").filter(Boolean);
        state.ui.readNotices = [...new Set([...(state.ui.readNotices || []), ...ids])];
        saveState();
        closeModalWindow();
      }
    });
  }

  function openModal(title, bodyHtml) {
    const modal = qs("#detailModal");
    const titleEl = qs("#modalTitle");
    const body = qs("#modalBody");
    if (!modal || !body) return;
    if (titleEl) titleEl.textContent = title;
    body.innerHTML = bodyHtml;
    modal.classList.add("open");
  }

  function closeModalWindow() {
    qs("#detailModal")?.classList.remove("open");
    attendanceModalCourse = null;
    surveyModalCourse = null;
  }

  function openCourseModal(courseId) {
    const course = courseById(courseId);
    if (!course) return;
    const changes = state.changes.filter((change) => change.course_id === courseId);
    openModal("講座詳細", `
      <div class="stack">
        ${itemHtml(esc(courseShort(course)), esc(courseMeta(course)), courseStatusChip(course))}
        <div class="grid-2">
          ${itemHtml("講座ID", esc(course.course_id))}
          ${itemHtml("講師", esc(course.teacher_name))}
          ${itemHtml("コマ数", `${esc(course.period_count)} コマ`)}
          ${itemHtml("アンケート", course.survey_required === "yes" ? "対象" : "対象外")}
        </div>
        <div>
          <h3 class="section-title">変更履歴</h3>
          <div class="stack" style="margin-top:10px">
            ${
              changes.length
                ? changes
                    .map((change) =>
                      itemHtml(
                        esc(change.change_type),
                        `${esc(change.before_value)} → ${esc(change.after_value)} / ${esc(change.reason)} / 生徒表示: ${change.visible_to_student === "yes" ? "あり" : "なし"}`,
                        `<span class="chip ${statusColor(change.confirmed_status)}">${esc(change.confirmed_status)}</span>`
                      )
                    )
                    .join("")
                : '<div class="notice">変更履歴はありません。</div>'
            }
          </div>
        </div>
      </div>
    `);
  }

  function materialHandoverDone(studentId, courseId) {
    return state.actions.some((action) => action.action_type === "配布物受渡" && action.target_id === `${studentId}:${courseId}`);
  }

  function openMaterialsModal(courseId) {
    const course = courseById(courseId);
    if (!course) return;
    const materials = materialsList(course);
    const rows = courseStudentIds(courseId, true).map((studentId) => ({
      student: studentById(studentId),
      attendance: attendanceFor(studentId, courseId, true),
    }));
    const absentees = rows.filter((row) => row.attendance.checkin_status !== "入室済");
    const materialHtml = materials.length
      ? `<ul class="material-list">${materials.map((item) => `<li>${esc(item)}</li>`).join("")}</ul>`
      : '<div class="notice">この講座に登録された配布物はありません。</div>';
    const absenteeHtml = absentees.length
      ? absentees
          .map((row) => {
            const studentId = row.attendance.student_id;
            const done = materialHandoverDone(studentId, courseId);
            const action = done
              ? '<span class="chip green">受渡済</span>'
              : `<button class="small" type="button" data-material-handover="${esc(studentId)}:${esc(courseId)}">受け渡し記録</button>`;
            const student = row.student;
            return itemHtml(
              esc(student?.display_name || studentId),
              `${esc(student?.school || "高校未登録")} / ${esc(student?.grade || "")} / 状態 ${esc(row.attendance.checkin_status)}`,
              action
            );
          })
          .join("")
      : '<div class="notice green">欠席者・未入室者はいません。配布物の未渡しはありません。</div>';
    openModal(
      "配布物リマインド",
      `
        <div class="stack">
          ${itemHtml(esc(courseShort(course)), esc(courseMeta(course)), courseStatusChip(course))}
          <div>
            <h3 class="section-title">配布物</h3>
            <div style="margin-top:8px">${materialHtml}</div>
          </div>
          <div class="notice amber">欠席者・未入室者には、次回までに配布物を受け取るようリマインドし、受け渡しを記録します。</div>
          <div class="actions">
            <button class="primary" type="button" data-material-remind="${esc(courseId)}">未渡し全員にリマインドを記録</button>
          </div>
          <div>
            <h3 class="section-title">受け渡し対象（${absentees.length}名）</h3>
            <div class="stack" style="margin-top:8px">${absenteeHtml}</div>
          </div>
        </div>
      `
    );
  }

  function recordMaterialHandover(target) {
    const [studentId, courseId] = String(target).split(":");
    if (!studentId || !courseId) return;
    addAction({
      role: document.body.dataset.app === "teacher-v2" ? "teacher" : "staff",
      action_type: "配布物受渡",
      target_type: "material",
      target_id: `${studentId}:${courseId}`,
      after_value: "受渡済",
      reason: `${courseShort(courseById(courseId))} 配布物`,
    });
    saveState();
    renderApp();
    openMaterialsModal(courseId);
    showToast("配布物の受け渡しを記録しました。");
  }

  function recordMaterialReminder(courseId) {
    const course = courseById(courseId);
    if (!course) return;
    const pending = courseStudentIds(courseId, true)
      .map((studentId) => ({ studentId, attendance: attendanceFor(studentId, courseId, true) }))
      .filter((row) => row.attendance.checkin_status !== "入室済" && !materialHandoverDone(row.studentId, courseId));
    if (!pending.length) {
      showToast("未渡しの対象者はいません。");
      return;
    }
    addAction({
      role: document.body.dataset.app === "teacher-v2" ? "teacher" : "staff",
      action_type: "配布物リマインド",
      target_type: "course",
      target_id: courseId,
      after_value: `${pending.length}名`,
      reason: `${courseShort(course)} 配布物リマインド`,
    });
    saveState();
    renderApp();
    openMaterialsModal(courseId);
    showToast(`未渡し ${pending.length} 名にリマインドを記録しました。`);
  }

  function collectUnreadNotices() {
    const app = document.body.dataset.app;
    const read = new Set(state.ui.readNotices || []);
    let changes = state.changes.filter((change) => !read.has(change.change_id));
    if (app === "student-v2") {
      const courseIds = studentCourses(state.selected.studentId).map((course) => course.course_id);
      changes = changes.filter((change) => change.visible_to_student === "yes" && courseIds.includes(change.course_id));
    } else if (app === "teacher-v2") {
      const courseIds = state.courses.filter((course) => course.teacher_id === state.selected.teacherId).map((course) => course.course_id);
      changes = changes.filter((change) => courseIds.includes(change.course_id));
    } else if (app === "staff-v2" || app === "tablet-v2") {
      const venue = state.selected.staffVenue || state.selected.tabletVenue;
      changes = changes.filter((change) => {
        const course = courseById(change.course_id);
        return course && course.venue === venue;
      });
    } else {
      return [];
    }
    return changes;
  }

  function showStartupNotices() {
    const notices = collectUnreadNotices();
    if (!notices.length) return;
    const ids = notices.map((change) => change.change_id).join(",");
    const body = notices
      .map((change) => {
        const course = courseById(change.course_id);
        const visible = change.visible_to_student === "yes" ? '<span class="chip amber">重要</span>' : '<span class="chip">校舎内</span>';
        return itemHtml(
          `${esc(change.change_type)} / ${esc(courseShort(course))}`,
          `${esc(change.before_value)} → ${esc(change.after_value)}<br>${esc(change.reason)} / ${esc(change.created_at)}`,
          visible
        );
      })
      .join("");
    openModal(
      "未読のお知らせ",
      `
        <div class="stack">
          <div class="notice amber">前回の確認以降に登録された重要な変更があります。内容を確認してください。</div>
          ${body}
          <div class="modal-actions">
            <button class="primary" type="button" data-mark-notices-read="${esc(ids)}">確認しました</button>
          </div>
        </div>
      `
    );
  }

  function renderApp() {
    setSelectedDefaults();
    const app = document.body.dataset.app;
    if (app === "hub-v2") renderHub();
    if (app === "student-v2") renderStudent();
    if (app === "staff-v2") renderStaff();
    if (app === "teacher-v2") renderTeacher();
    if (app === "tablet-v2") renderTablet();
  }

  function renderHub() {
    const counts = qs("#hubRoleCounts");
    if (counts) {
      const anomalyCount = detectAnomalies().filter((item) => !isAnomalyConfirmed(item.key)).length;
      counts.innerHTML = [
        metric("生徒", state.students.length),
        metric("講座", state.courses.length),
        metric("出席行", state.attendance.length),
        metric("回答", state.surveys.length),
        metric("未確認異常", anomalyCount),
      ].join("");
    }

    const dataStatus = qs("#hubDataStatus");
    if (dataStatus) {
      dataStatus.innerHTML = Object.entries(CSV_FILES)
        .map(([key, file]) => itemHtml(esc(file), `${state[key].length}件`, '<span class="chip green">読込済</span>'))
        .join("");
    }

    const log = qs("#hubOperationLog");
    if (log) {
      log.innerHTML = state.actions
        .slice(0, 6)
        .map((action) =>
          itemHtml(
            esc(action.action_type),
            `${esc(action.created_at)} / ${esc(action.actor)} / ${esc(action.target_type)}:${esc(action.target_id)} / ${esc(action.reason)}`,
            `<span class="chip">${esc(action.role)}</span>`
          )
        )
        .join("");
    }

    qs("#hubRefresh")?.addEventListener("click", renderHub, { once: true });
  }

  function bindStudentOnce() {
    const studentSelect = qs("#studentSelect");
    studentSelect?.addEventListener("change", () => {
      state.selected.studentId = studentSelect.value;
      const firstCourse = studentCourses(state.selected.studentId).find((course) => course.date === APP_DATE);
      state.selected.attendanceCourseId = firstCourse?.course_id || studentCourses(state.selected.studentId)[0]?.course_id || "";
      state.selected.surveyCourseId = state.selected.attendanceCourseId;
      saveState();
      renderStudent();
    });

    qs("#studentLoginButton")?.addEventListener("click", () => {
      const studentNumber = qs("#studentNumber")?.value.trim();
      const password = qs("#studentPassword")?.value.trim();
      const student = state.students.find((item) => item.student_number === studentNumber || item.login_id === studentNumber);
      if (!student) {
        showToast("該当する生徒がありません。");
        return;
      }
      if ((student.password || "abcdefgh") !== password) {
        showToast("パスワードが一致しません。");
        return;
      }
      state.selected.studentId = student.student_id;
      saveState();
      renderStudent();
      showToast("登録内容を確認しました。");
    });

    qsa("[data-student-course-view]").forEach((button) => {
      button.addEventListener("click", () => {
        state.ui.studentCourseView = button.dataset.studentCourseView;
        saveState();
        renderStudentHome();
      });
    });

    qs("#studentAttendanceCourseSelect")?.addEventListener("change", (event) => {
      state.selected.attendanceCourseId = event.target.value;
      saveState();
      renderStudentAttendance();
    });

    qs("#studentScanButton")?.addEventListener("click", () => {
      const studentId = state.selected.studentId;
      const courseId = state.selected.attendanceCourseId;
      const course = courseById(courseId);
      if (!course) return;
      if (!isEnrolled(studentId, courseId)) {
        showToast("登録されていない講座です。");
        return;
      }
      if (course.status === "cancelled") {
        showToast("対象講座は休講です。");
        return;
      }
      const attendance = attendanceFor(studentId, courseId, true);
      const before = attendance.checkin_status;
      attendance.checkin_status = "入室済";
      attendance.checkin_time = course.start_time > "15:00" ? course.start_time : "14:56";
      attendance.method = "教室QR";
      attendance.confirmed_status = "未確認";
      addAction({
        role: "student",
        actor: studentId,
        action_type: "入室登録",
        target_type: "attendance",
        target_id: attendance.attendance_id,
        before_value: before,
        after_value: "入室済",
        reason: "教室QR読取",
      });
      saveState();
      renderStudent();
      showToast("入室登録しました。");
    });

    qs("#studentQrRefresh")?.addEventListener("click", () => {
      showToast("提示QRを更新しました。");
      renderStudentAttendance();
    });

    qsa("[data-attendance-mode]").forEach((button) => {
      button.addEventListener("click", () => {
        state.ui.attendanceMode = button.dataset.attendanceMode;
        saveState();
        renderStudentAttendance();
      });
    });

    qs('[data-tab-target="student-notices"]')?.addEventListener("click", () => {
      markStudentNoticesRead();
    });

    qs("#studentTogglePastSurvey")?.addEventListener("click", () => {
      state.ui.studentShowHistory = !state.ui.studentShowHistory;
      saveState();
      renderStudentSurvey();
    });

    qs("#saveSurveyDraft")?.addEventListener("click", () => saveStudentSurvey("下書き"));
    qs("#submitSurvey")?.addEventListener("click", () => saveStudentSurvey("提出済"));

    document.addEventListener("click", (event) => {
      const checkin = event.target.closest("[data-student-checkin]");
      if (checkin) {
        state.selected.attendanceCourseId = checkin.dataset.studentCheckin;
        saveState();
        selectTab("student-attendance");
        renderStudentAttendance();
        return;
      }
      const survey = event.target.closest("[data-student-survey]");
      if (survey) {
        state.selected.surveyCourseId = survey.dataset.studentSurvey;
        saveState();
        selectTab("student-survey");
        renderStudentSurvey();
        return;
      }
      const calendarDay = event.target.closest("[data-student-calendar-date]");
      if (calendarDay) {
        state.ui.studentCalendarDate = calendarDay.dataset.studentCalendarDate;
        saveState();
        renderStudentCalendar();
      }
    });
  }

  function renderStudent() {
    const select = qs("#studentSelect");
    if (select) {
      select.innerHTML = state.students
        .map((student) => `<option value="${esc(student.student_id)}">${esc(student.display_name)} ${esc(student.grade)} / ${esc(studentNumber(student))}</option>`)
        .join("");
      select.value = state.selected.studentId;
    }
    const student = studentById(state.selected.studentId);
    if (!student) return;
    qs("#studentName").textContent = student.display_name;
    qs("#studentVenue").textContent = `${student.grade} / ${student.venue} / 担当 ${student.advisor}`;
    qs("#studentProfileMini").textContent = `${student.display_name} / ${student.grade} / ${student.venue}`;
    const profile = qs("#studentProfile");
    if (profile) {
      profile.innerHTML = `生徒番号 ${esc(studentNumber(student))} / ${esc(student.display_name)} / ${esc(student.grade)} / ${esc(student.venue)} / LINE ${esc(student.line_status)}`;
    }
    const numberInput = qs("#studentNumber");
    if (numberInput) numberInput.value = studentNumber(student);
    const passwordInput = qs("#studentPassword");
    if (passwordInput) passwordInput.value = student.password || "abcdefgh";
    renderStudentHome();
    renderStudentNotices();
    renderStudentAttendance();
    renderStudentSurvey();
    renderStudentCalendar();
    renderStudentLog();
  }

  function renderStudentHome() {
    const courses = studentCourses(state.selected.studentId);
    const today = courses.filter((course) => course.date === APP_DATE);
    qsa("[data-student-course-view]").forEach((button) => {
      button.classList.toggle("selected", button.dataset.studentCourseView === state.ui.studentCourseView);
    });
    qs("#studentTodaySection")?.classList.toggle("is-hidden", state.ui.studentCourseView !== "today");
    qs("#studentAllSection")?.classList.toggle("is-hidden", state.ui.studentCourseView !== "all");
    qs("#studentTodayList").innerHTML = today.length
      ? today.map((course) => studentCourseCard(course, state.selected.studentId)).join("")
      : '<div class="notice">本日の登録講座はありません。</div>';
    qs("#studentCourseList").innerHTML = courses.map((course) => studentCourseCard(course, state.selected.studentId)).join("");
  }

  function studentNotices() {
    const courses = studentCourses(state.selected.studentId);
    return state.changes
      .filter((change) => change.visible_to_student === "yes")
      .filter((change) => courses.some((course) => course.course_id === change.course_id));
  }

  function renderStudentNotices() {
    const notices = studentNotices();
    const read = new Set(state.ui.readNotices || []);
    const unread = notices.filter((change) => !read.has(change.change_id)).length;
    const badge = qs("#studentNoticeBadge");
    if (badge) {
      badge.textContent = String(unread);
      badge.classList.toggle("is-hidden", unread === 0);
    }
    const list = qs("#studentNotices");
    if (list) {
      list.innerHTML = notices.length
        ? notices
            .map((change) => {
              const course = courseById(change.course_id);
              const read2 = read.has(change.change_id);
              return itemHtml(
                esc(change.change_type),
                `${esc(courseShort(course))}<br>${esc(change.before_value)} → ${esc(change.after_value)} / ${esc(change.reason)} / ${esc(change.created_at)}`,
                `<span class="chip ${read2 ? "" : "amber"}">${read2 ? "既読" : "未読"}</span>`
              );
            })
            .join("")
        : '<div class="notice">表示対象のお知らせはありません。</div>';
    }
  }

  function markStudentNoticesRead() {
    const ids = studentNotices().map((change) => change.change_id);
    state.ui.readNotices = [...new Set([...(state.ui.readNotices || []), ...ids])];
    saveState();
    renderStudentNotices();
  }

  function renderStudentAttendance() {
    const courses = studentCourses(state.selected.studentId).filter((course) => course.date >= APP_DATE || course.date === APP_DATE);
    const select = qs("#studentAttendanceCourseSelect");
    if (select) {
      select.innerHTML = courses.map((course) => `<option value="${esc(course.course_id)}">${esc(courseShort(course))}</option>`).join("");
      if (!courses.some((course) => course.course_id === state.selected.attendanceCourseId)) {
        state.selected.attendanceCourseId = courses[0]?.course_id || "";
      }
      select.value = state.selected.attendanceCourseId;
    }
    const course = courseById(state.selected.attendanceCourseId);
    const attendance = attendanceFor(state.selected.studentId, state.selected.attendanceCourseId);
    qsa("[data-attendance-mode]").forEach((button) => button.classList.toggle("selected", button.dataset.attendanceMode === state.ui.attendanceMode));
    qs("#studentQrReadPane")?.classList.toggle("is-hidden", state.ui.attendanceMode !== "read");
    qs("#studentQrPresentPane")?.classList.toggle("is-hidden", state.ui.attendanceMode !== "present");
    if (course) {
      qs("#studentQrReadCourse").innerHTML = `${esc(courseLabel(course))}<br>${courseStatusChip(course)}`;
      qs("#studentPresentMeta").textContent = `${studentName(state.selected.studentId)} / ${courseShort(course)} / 有効期限 2分`;
      qs("#studentCheckinStatus").innerHTML = `出席状態: <strong>${esc(attendance?.checkin_status || "未入室")}</strong> / 打刻: ${esc(attendance?.checkin_time || "-")} / 方法: ${esc(attendance?.method || "-")}`;
    }
  }

  function renderStudentSurvey() {
    const courses = studentCourses(state.selected.studentId);
    const open = courses.filter((course) => {
      const response = surveyFor(state.selected.studentId, course.course_id);
      return ["回答受付中", "受付開始前"].includes(surveyWindow(course, response));
    });
    const history = courses.filter((course) => {
      const response = surveyFor(state.selected.studentId, course.course_id);
      return ["回答済み", "受付終了", "対象外"].includes(surveyWindow(course, response));
    });
    const renderSurveyItem = (course) => {
      const response = surveyFor(state.selected.studentId, course.course_id);
      const status = surveyWindow(course, response);
      const color = status === "回答受付中" ? "green" : status === "回答済み" ? "blue" : "amber";
      return renderCourseCard(course, {
        chips: [`<span class="chip ${color}">${esc(status)}</span>`],
        extra: `<div class="status-row"><span class="chip ${statusColor(response?.status || status)}">回答 ${esc(response?.status || status)}</span></div>`,
        actions: `<button class="small primary" type="button" data-student-survey="${esc(course.course_id)}" ${status === "回答受付中" ? "" : "disabled"}>${status === "回答済み" ? "回答済み" : "この講座に回答"}</button>`,
      });
    };
    qs("#studentSurveyOpenList").innerHTML = open.length ? open.map(renderSurveyItem).join("") : '<div class="notice">受付中のアンケートはありません。</div>';
    const historyPanel = qs("#studentSurveyHistory");
    historyPanel.classList.toggle("is-hidden", !state.ui.studentShowHistory);
    historyPanel.innerHTML = history.length ? history.map(renderSurveyItem).join("") : '<div class="notice">回答履歴はありません。</div>';
    qs("#studentTogglePastSurvey").textContent = state.ui.studentShowHistory ? "受付中に戻る" : "回答履歴";

    const selectedCourse = courseById(state.selected.surveyCourseId) || open[0];
    if (selectedCourse) state.selected.surveyCourseId = selectedCourse.course_id;
    const response = selectedCourse ? surveyFor(state.selected.studentId, selectedCourse.course_id) : null;
    const windowState = selectedCourse ? surveyWindow(selectedCourse, response) : "未選択";
    qs("#surveyCourseTitle").textContent = selectedCourse ? courseShort(selectedCourse) : "回答フォーム";
    qs("#studentSurveyStatusChip").textContent = windowState;
    qs("#studentSurveyStatusChip").className = `chip ${statusColor(windowState === "回答受付中" ? "入室済" : windowState === "回答済み" ? "提出済" : "未確認")}`;
    qs("#surveyDraftNotice").textContent = selectedCourse ? courseMeta(selectedCourse) : "講座を選択してください。";
    if (response) {
      qs("#surveySatisfaction").value = response.satisfaction || "4";
      qs("#surveyDifficulty").value = response.difficulty || "ちょうどよい";
      qs("#surveyUnderstanding").value = response.understanding || "4";
      qs("#studentSurveyComment").value = response.comment || qs("#studentSurveyComment").value;
      qs("#studentSurveyConsult").value = response.consultation || "no";
    }
    qs("#saveSurveyDraft").disabled = windowState !== "回答受付中";
    qs("#submitSurvey").disabled = windowState !== "回答受付中";
  }

  function saveStudentSurvey(status) {
    const courseId = state.selected.surveyCourseId;
    const course = courseById(courseId);
    if (!course) return;
    const response = surveyFor(state.selected.studentId, courseId, true);
    const before = response.status;
    response.status = status;
    response.satisfaction = qs("#surveySatisfaction").value;
    response.difficulty = qs("#surveyDifficulty").value;
    response.understanding = qs("#surveyUnderstanding").value;
    response.comment = qs("#studentSurveyComment").value.trim();
    response.consultation = qs("#studentSurveyConsult").value;
    response.input_method = "app";
    response.input_by = "student";
    if (status === "提出済") response.submitted_at = nowStamp();
    const attendance = attendanceFor(state.selected.studentId, courseId, true);
    attendance.survey_status = status === "提出済" ? "提出済" : "下書き";
    addAction({
      role: "student",
      actor: state.selected.studentId,
      action_type: status === "提出済" ? "アンケート提出" : "アンケート一時保存",
      target_type: "survey",
      target_id: response.response_id,
      before_value: before,
      after_value: status,
      reason: courseShort(course),
    });
    saveState();
    renderStudent();
    showToast(status === "提出済" ? "アンケートを提出しました。" : "下書きを保存しました。");
  }

  function renderStudentCalendar() {
    const courses = studentCourses(state.selected.studentId);
    const dates = [...new Set(courses.map((course) => course.date))].sort();
    if (!dates.includes(state.ui.studentCalendarDate)) state.ui.studentCalendarDate = dates[0] || APP_DATE;
    const days = qs("#studentCalendarDays");
    if (days) {
      days.innerHTML = dates
        .map((date) => `<button class="choice ${date === state.ui.studentCalendarDate ? "selected" : ""}" type="button" data-student-calendar-date="${esc(date)}">${date === APP_DATE ? "今日" : esc(date.slice(5))}</button>`)
        .join("");
    }
    const selectedCourses = courses.filter((course) => course.date === state.ui.studentCalendarDate);
    const list = qs("#studentCalendarCourses");
    if (list) {
      list.innerHTML = selectedCourses.length
        ? selectedCourses.map((course) => studentCourseCard(course, state.selected.studentId)).join("")
        : '<div class="notice">選択日の登録講座はありません。</div>';
    }
  }

  function renderStudentLog() {
    const studentId = state.selected.studentId;
    const courses = studentCourses(studentId);
    const bySubject = {};
    courses.forEach((course) => {
      bySubject[course.subject] ||= { planned: 0, attended: 0 };
      bySubject[course.subject].planned += numberValue(course.period_count);
      const attendance = attendanceFor(studentId, course.course_id);
      if (attendance?.checkin_status === "入室済") bySubject[course.subject].attended += numberValue(course.period_count);
    });
    qs("#studentSubjectBars").innerHTML = Object.entries(bySubject)
      .map(([subject, counts]) => {
        const pct = counts.planned ? Math.round((counts.attended / counts.planned) * 100) : 0;
        return itemHtml(
          esc(subject),
          `受講済み ${counts.attended} / 予定 ${counts.planned} コマ`,
          `<span class="chip blue">${pct}%</span>`,
          `<div class="bar" style="margin-top:10px"><span style="width:${Math.min(100, pct)}%"></span></div>`
        );
      })
      .join("");
    qs("#studentHistoryRows").innerHTML = courses
      .map((course) => {
        const attendance = attendanceFor(studentId, course.course_id);
        const response = surveyFor(studentId, course.course_id);
        return `<tr><td>${esc(courseShort(course))}</td><td><span class="chip ${statusColor(attendance?.checkin_status)}">${esc(attendance?.checkin_status || "未入室")}</span></td><td>${esc(response?.status || attendance?.survey_status || "未提出")}</td></tr>`;
      })
      .join("");
  }

  function bindStaffOnce() {
    qs("#staffVenueSelect")?.addEventListener("change", (event) => {
      state.selected.staffVenue = event.target.value;
      saveState();
      renderStaff();
    });
    qs("#realtimeSearch")?.addEventListener("input", (event) => {
      state.ui.realtimeSearch = event.target.value;
      saveState();
      renderStaffRealtime();
    });
    qs("#voiceButton")?.addEventListener("click", staffAddVoiceAction);
    qs("#saveStaffSettings")?.addEventListener("click", saveStaffSettings);
    qs("#previewExport")?.addEventListener("click", renderExportPreview);
    qs("#downloadExport")?.addEventListener("click", downloadLatestExport);
    qs("#exportType")?.addEventListener("change", renderExportPreview);
    qs("#thresholdGrade")?.addEventListener("change", (event) => {
      state.selected.thresholdGrade = event.target.value;
      renderStaffMaster();
    });
    [
      ["#editThresholds", "thresholds"],
      ["#editStudents", "students"],
      ["#editCourses", "courses"],
      ["#editStaff", "staff"],
      ["#editApplications", "applications"],
    ].forEach(([selector, key]) => {
      qs(selector)?.addEventListener("click", () => {
        state.ui.masterEdit[key] = !state.ui.masterEdit[key];
        saveState();
        renderStaffMaster();
      });
    });
    [
      ["#filterStudents", "students"],
      ["#filterCourses", "courses"],
      ["#filterStaff", "staff"],
      ["#filterApplications", "applications"],
    ].forEach(([selector, key]) => {
      qs(selector)?.addEventListener("input", (event) => {
        state.ui.masterFilter[key] = event.target.value;
        saveState();
        renderStaffMaster();
      });
    });
    [
      ["#exportStudents", "students"],
      ["#exportCourses", "courses"],
      ["#exportStaff", "staff"],
      ["#exportApplications", "applications"],
    ].forEach(([selector, key]) => {
      qs(selector)?.addEventListener("click", () => exportMasterCsv(key));
    });

    document.addEventListener("click", (event) => {
      const masterViewButton = event.target.closest("[data-staff-master-view]");
      if (masterViewButton) {
        focusMasterView(masterViewButton.dataset.staffMasterView);
        return;
      }
      const openChangeButton = event.target.closest("[data-open-course-change]");
      if (openChangeButton) {
        const courseId = openChangeButton.dataset.openCourseChange || state.selected.staffCourseId;
        state.selected.staffCourseId = courseId;
        saveState();
        renderStaff();
        openCourseChangeModal(courseId);
        return;
      }
      const editStudentButton = event.target.closest("[data-edit-student]");
      if (editStudentButton) {
        openStudentMasterModal(editStudentButton.dataset.editStudent);
        return;
      }
      const editCourseButton = event.target.closest("[data-edit-course]");
      if (editCourseButton) {
        openCourseMasterModal(editCourseButton.dataset.editCourse);
        return;
      }
      const saveStudentButton = event.target.closest("#modalSaveStudent");
      if (saveStudentButton) {
        saveStudentMasterFromModal();
        return;
      }
      const saveCourseButton = event.target.closest("#modalSaveCourse");
      if (saveCourseButton) {
        saveCourseMasterFromModal();
        return;
      }
      const editStaffButton = event.target.closest("[data-edit-staff]");
      if (editStaffButton) {
        openStaffMasterModal(editStaffButton.dataset.editStaff);
        return;
      }
      const saveStaffButton = event.target.closest("#modalSaveStaff");
      if (saveStaffButton) {
        saveStaffMasterFromModal();
        return;
      }
      const editApplicationButton = event.target.closest("[data-edit-application]");
      if (editApplicationButton) {
        openApplicationModal(editApplicationButton.dataset.editApplication);
        return;
      }
      const saveApplicationButton = event.target.closest("#modalSaveApplication");
      if (saveApplicationButton) {
        saveApplicationFromModal();
        return;
      }
      const riskViewButton = event.target.closest("[data-risk-view]");
      if (riskViewButton) {
        state.ui.riskView = riskViewButton.dataset.riskView;
        saveState();
        renderStaffRisk();
        return;
      }
      const saveCourseChangeButton = event.target.closest("#modalSaveCourseChange");
      if (saveCourseChangeButton) {
        saveCourseChange();
        return;
      }
      const attendanceButton = event.target.closest("[data-staff-attendance]");
      if (attendanceButton) {
        const [studentId, courseId, status] = attendanceButton.dataset.staffAttendance.split("|");
        updateAttendanceStatus(studentId, courseId, status);
        return;
      }
      const attendanceTableButton = event.target.closest("[data-attendance-table]");
      if (attendanceTableButton) {
        openAttendanceTableModal(attendanceTableButton.dataset.attendanceTable);
        return;
      }
      const courseSurveyButton = event.target.closest("[data-course-survey]");
      if (courseSurveyButton) {
        openSurveyModal(courseSurveyButton.dataset.courseSurvey);
        return;
      }
      const proxyCheckinButton = event.target.closest("[data-proxy-checkin]");
      if (proxyCheckinButton) {
        const [studentId, courseId] = proxyCheckinButton.dataset.proxyCheckin.split("|");
        proxyCheckin(studentId, courseId, "スマホ忘れ本人確認済");
        return;
      }
      const paperOpenButton = event.target.closest("[data-paper-open]");
      if (paperOpenButton) {
        const [studentId, courseId] = paperOpenButton.dataset.paperOpen.split("|");
        openPaperModal(studentId, courseId);
        return;
      }
      const savePaperButton = event.target.closest("#modalSavePaper");
      if (savePaperButton) {
        savePaperFromModal();
        return;
      }
      const anomalyButton = event.target.closest("[data-anomaly-confirm]");
      if (anomalyButton) {
        addAction({
          role: "staff",
          action_type: "異常確認",
          target_type: "anomaly",
          target_id: anomalyButton.dataset.anomalyConfirm,
          after_value: "確認済",
          reason: "画面確認",
        });
        saveState();
        renderStaff();
        showToast("異常を確認済みにしました。");
        return;
      }
      const commentVoiceButton = event.target.closest("[data-comment-voice]");
      if (commentVoiceButton) {
        const studentId = commentVoiceButton.dataset.commentVoice;
        addAction({
          role: "staff",
          action_type: "声かけ予定",
          target_type: "student",
          target_id: studentId,
          before_value: "未対応",
          after_value: "対応予定",
          reason: "アンケート相談希望",
        });
        saveState();
        renderStaff();
        if (surveyModalCourse && qs("#detailModal")?.classList.contains("open")) openSurveyModal(surveyModalCourse);
        showToast("声かけ対象に追加しました。");
        return;
      }
      const shortageButton = event.target.closest("[data-shortage-voice]");
      if (shortageButton) {
        const [studentId, reason] = shortageButton.dataset.shortageVoice.split("|");
        addAction({
          role: "staff",
          action_type: "声かけ予定",
          target_type: "student",
          target_id: studentId,
          before_value: "未対応",
          after_value: "対応予定",
          reason,
        });
        markVoiceStatus(studentId, reason.replace("コマ数不足", ""), "対応予定");
        saveState();
        renderStaff();
        showToast("声かけ対象に追加しました。");
        return;
      }
      const shortageComplete = event.target.closest("[data-shortage-complete]");
      if (shortageComplete) {
        const [studentId, subject] = shortageComplete.dataset.shortageComplete.split("|");
        markVoiceStatus(studentId, subject, "対応済み");
        saveState();
        renderStaff();
        showToast("声かけを対応済みにしました。");
      }
    });

    document.addEventListener("change", (event) => {
      if (event.target?.id === "modalChangeType") {
        renderCourseChangeAfterControl();
        updateCourseChangePreview();
      }
      if (event.target?.id === "modalChangeAfter") {
        updateCourseChangePreview();
      }
    });

    document.addEventListener("input", (event) => {
      if (["modalChangeReason", "modalChangeAfter"].includes(event.target?.id)) {
        updateCourseChangePreview();
      }
    });
  }

  function renderStaff() {
    renderStaffSelectors();
    renderStaffDashboard();
    renderStaffRealtime();
    renderStaffMaster();
    renderStaffRisk();
    renderStaffExport();
  }

  function venueTodayCourses() {
    return sortCourses(state.courses.filter((course) => course.venue === state.selected.staffVenue && course.date === APP_DATE));
  }

  function courseAttendanceRows(courseId) {
    return courseStudentIds(courseId, true).map((studentId) => ({
      student: studentById(studentId),
      attendance: attendanceFor(studentId, courseId, true),
      survey: surveyFor(studentId, courseId),
    }));
  }

  function focusMasterView(view) {
    selectTab("staff-master");
    const target = view === "students" ? "#masterStudentsPanel" : view === "courses" ? "#masterCoursesPanel" : "#masterSettingsPanel";
    qs(target)?.scrollIntoView({ behavior: "smooth", block: "start" });
  }


  function renderStaffSelectors() {
    const venues = [...new Set(state.courses.map((course) => course.venue))];
    const venueSelect = qs("#staffVenueSelect");
    if (venueSelect) {
      venueSelect.innerHTML = venues.map((venue) => `<option>${esc(venue)}</option>`).join("");
      venueSelect.value = state.selected.staffVenue;
    }
  }


  function renderStaffDashboard() {
    const courses = venueTodayCourses();
    const courseIds = courses.map((course) => course.course_id);
    const targetIds = new Set();
    activeEnrollments().forEach((enrollment) => {
      if (courseIds.includes(enrollment.course_id)) targetIds.add(enrollment.student_id);
    });
    const checkedIds = new Set();
    let submitted = 0;
    courses.forEach((course) =>
      courseAttendanceRows(course.course_id).forEach((row) => {
        if (row.attendance.checkin_status === "入室済") checkedIds.add(row.attendance.student_id);
        if (row.survey?.status === "提出済") submitted += 1;
      })
    );
    const anomalies = detectAnomalies().filter((item) => !isAnomalyConfirmed(item.key));
    qs("#staffDashboardMetrics").innerHTML = [
      metric("本日の講座", courses.length),
      metric("対象者", targetIds.size),
      metric("入室済", checkedIds.size),
      metric("回答済", submitted),
      metric("未確認異常", anomalies.length),
    ].join("");
    qs("#dashboardAlerts").innerHTML =
      [
        ...anomalies.slice(0, 6).map((item) => itemHtml(esc(item.type), esc(item.detail), '<span class="chip red">未確認</span>')),
        ...state.changes
          .filter((change) => change.confirmed_status !== "確認済")
          .map((change) => itemHtml(esc(change.change_type), `${esc(courseShort(courseById(change.course_id)))} / ${esc(change.reason)}`, '<span class="chip amber">未確認</span>')),
      ].join("") || '<div class="notice green">未対応事項はありません。</div>';
    qs("#dashboardCourseList").innerHTML = courses.length
      ? courses
          .map((course) => {
            const rows = courseAttendanceRows(course.course_id);
            const checked = rows.filter((row) => row.attendance.checkin_status === "入室済").length;
            const missing = rows.filter((row) => row.attendance.checkin_status === "未入室").length;
            const answered = rows.filter((row) => row.survey?.status === "提出済").length;
            return renderCourseCard(course, {
              extra: `<div class="status-row"><span class="chip green">入室 ${checked}/${rows.length}</span><span class="chip amber">未入室 ${missing}</span><span class="chip blue">回答 ${answered}/${rows.length}</span></div>`,
              actions: `
                <button class="small primary" type="button" data-attendance-table="${esc(course.course_id)}">出席状況</button>
                <button class="small" type="button" data-course-survey="${esc(course.course_id)}">アンケート</button>
                <button class="small" type="button" data-open-course-change="${esc(course.course_id)}">講座変更</button>
                ${materialsButton(course)}
              `,
            });
          })
          .join("")
      : '<div class="notice">本日この校舎の講座はありません。</div>';
  }

  function renderStaffRealtime() {
    const venue = state.selected.staffVenue;
    const courses = sortCourses(state.courses.filter((course) => course.venue === venue && course.date === APP_DATE));
    const seen = new Set();
    const rows = [];
    courses.forEach((course) => {
      courseStudentIds(course.course_id, true).forEach((studentId) => {
        const key = `${studentId}:${course.course_id}`;
        if (seen.has(key)) return;
        seen.add(key);
        rows.push({ student: studentById(studentId), course, attendance: attendanceFor(studentId, course.course_id, true), survey: surveyFor(studentId, course.course_id) });
      });
    });
    rows.sort((a, b) => {
      const aIn = a.attendance.checkin_status === "入室済" ? 1 : 0;
      const bIn = b.attendance.checkin_status === "入室済" ? 1 : 0;
      if (aIn !== bIn) return bIn - aIn;
      return String(b.attendance.checkin_time).localeCompare(String(a.attendance.checkin_time));
    });
    const checkedCount = rows.filter((row) => row.attendance.checkin_status === "入室済").length;
    const metrics = qs("#realtimeMetrics");
    if (metrics) {
      metrics.innerHTML = [
        metric("本日の講座", courses.length),
        metric("対象(のべ)", rows.length),
        metric("入室済", checkedCount),
        metric("未入室", rows.length - checkedCount),
      ].join("");
    }
    const query = (state.ui.realtimeSearch || "").trim().toLowerCase();
    const search = qs("#realtimeSearch");
    if (search && document.activeElement !== search) search.value = state.ui.realtimeSearch || "";
    const filtered = rows.filter(
      (row) => !query || `${row.student?.display_name || ""} ${studentNumber(row.student)} ${row.student?.grade || ""} ${row.student?.school || ""} ${courseShort(row.course)}`.toLowerCase().includes(query)
    );
    const list = qs("#realtimeList");
    if (!list) return;
    list.innerHTML = filtered.length
      ? filtered
          .map((row) => {
            const sid = row.attendance.student_id;
            const inRoom = row.attendance.checkin_status === "入室済";
            const summary = studentPeriodSummary(sid);
            const past = pastAttendanceSummary(sid);
            const surveyDone = row.survey?.status === "提出済";
            const flags = studentRosterFlags(sid, row.attendance, row.course)
              .map((flag) => `<span class="chip ${flag.color}">${esc(flag.label)}</span>`)
              .join("");
            const actions = `
              ${inRoom ? "" : `<button class="small primary" type="button" data-proxy-checkin="${esc(sid)}|${esc(row.course.course_id)}">代理入室</button>`}
              <button class="small" type="button" data-paper-open="${esc(sid)}|${esc(row.course.course_id)}">紙回答</button>
            `;
            return `
              <div class="wide-row">
                <div class="wide-main">
                  <strong>${esc(row.student?.display_name || sid)}</strong>
                  <span class="meta">${esc(row.student?.grade || "")} / ${esc(row.student?.school || "高校未登録")} / ${esc(studentNumber(row.student))}</span>
                  <span class="meta">${esc(courseShort(row.course))}</span>
                </div>
                <div class="wide-status status-row">
                  <span class="chip ${statusColor(row.attendance.checkin_status)}">${esc(row.attendance.checkin_status)}${inRoom && row.attendance.checkin_time ? " " + esc(row.attendance.checkin_time) : ""}</span>
                  <span class="chip ${surveyDone ? "green" : "amber"}">ｱﾝｹｰﾄ${surveyDone ? "済" : "未"}</span>
                  <span class="chip blue">受講${summary.attended}/${summary.planned}</span>
                  <span class="chip">過去${past.present}/${past.absent}</span>
                  ${flags}
                </div>
                <div class="wide-actions">${actions}</div>
              </div>
            `;
          })
          .join("")
      : '<div class="notice">該当する入室・対象者はありません。</div>';
  }

  let attendanceModalCourse = null;

  function openAttendanceTableModal(courseId) {
    const course = courseById(courseId);
    if (!course) return;
    attendanceModalCourse = courseId;
    const rows = courseAttendanceRows(courseId);
    const body = rows
      .map((row) => {
        const sid = row.attendance.student_id;
        const student = row.student;
        const summary = studentPeriodSummary(sid);
        const past = pastAttendanceSummary(sid);
        const voiced = state.actions.some((action) => action.action_type === "声かけ予定" && action.target_id === sid);
        const inRoom = row.attendance.checkin_status === "入室済";
        const surveyDone = row.survey?.status === "提出済";
        return `<tr>
          <td>${esc(student?.display_name || sid)}</td>
          <td>${esc(student?.school || "-")}</td>
          <td>${esc(student?.grade || "-")}</td>
          <td>${esc(studentNumber(student))}</td>
          <td><span class="chip ${statusColor(row.attendance.checkin_status)}">${esc(row.attendance.checkin_status)}</span></td>
          <td>${esc(row.attendance.checkin_time || "-")}</td>
          <td><span class="chip ${surveyDone ? "green" : "amber"}">${surveyDone ? "済" : "未"}</span></td>
          <td>${esc(row.survey?.submitted_at || "-")}</td>
          <td>${voiced ? '<span class="chip amber">対象</span>' : "-"}</td>
          <td>${summary.attended}/${summary.planned}</td>
          <td>${past.present}/${past.absent}</td>
          <td>${esc(row.attendance.exception_note || row.attendance.corrected_reason || "-")}</td>
          <td class="nowrap">${inRoom ? "" : `<button class="small" type="button" data-proxy-checkin="${esc(sid)}|${esc(courseId)}">代理</button>`}<button class="small" type="button" data-paper-open="${esc(sid)}|${esc(courseId)}">紙</button></td>
        </tr>`;
      })
      .join("");
    openModal(
      "出席状況 / " + courseShort(course),
      `
        <div class="stack">
          ${itemHtml(esc(courseShort(course)), esc(courseMeta(course)), courseStatusChip(course))}
          <div class="table-scroll">
            <table class="dense">
              <thead><tr><th>氏名</th><th>高校</th><th>学年</th><th>生徒番号</th><th>出席</th><th>打刻</th><th>ｱﾝｹｰﾄ</th><th>回答時刻</th><th>声かけ</th><th>受講ｺﾏ</th><th>過去出欠</th><th>備考</th><th>操作</th></tr></thead>
              <tbody>${body}</tbody>
            </table>
          </div>
        </div>
      `
    );
  }

  let surveyModalCourse = null;

  function surveyBodyHtml(course) {
    const rows = courseAttendanceRows(course.course_id);
    const target = rows.length;
    const submitted = rows.filter((row) => row.survey?.status === "提出済");
    const pending = rows.filter((row) => row.survey?.status !== "提出済");
    const responses = submitted.map((row) => row.survey);
    const avg = (key) => {
      const nums = responses.map((response) => numberValue(response[key])).filter(Boolean);
      return nums.length ? (nums.reduce((sum, value) => sum + value, 0) / nums.length).toFixed(1) : "-";
    };
    const diffDist = ["易しい", "ちょうどよい", "難しい"].map((level) => `${level} ${responses.filter((response) => response.difficulty === level).length}`).join(" / ");
    const metricsHtml = [
      metric("回答率", `${target ? Math.round((submitted.length / target) * 100) : 0}%`),
      metric("回答済", `${submitted.length}/${target}`),
      metric("満足度平均", avg("satisfaction")),
      metric("理解度平均", avg("understanding")),
    ].join("");
    const pendingHtml = pending.length
      ? pending.map((row) => itemHtml(esc(row.student?.display_name || row.attendance.student_id), `${esc(row.student?.grade || "")} / 未回答`, '<span class="chip amber">未回答</span>')).join("")
      : '<div class="notice green">未回答者はいません。</div>';
    const commentRows = submitted.filter((row) => row.survey?.comment);
    const commentsHtml = commentRows.length
      ? commentRows
          .map((row) => {
            const studentId = row.attendance.student_id;
            const consult = row.survey.consultation === "yes";
            const voiced = voiceActionFor(studentId, "アンケート");
            const op = voiced
              ? `<span class="chip green">${esc(voiced.after_value)}</span>`
              : `<button class="small" type="button" data-comment-voice="${esc(studentId)}">声かけ対象に追加</button>`;
            return itemHtml(
              esc(row.student?.display_name || studentId),
              `${esc(row.survey.comment)}<br>満足度${esc(row.survey.satisfaction)} / 難易度${esc(row.survey.difficulty)} / 理解度${esc(row.survey.understanding)}`,
              `${consult ? '<span class="chip amber">相談希望</span>' : ""}${op}`
            );
          })
          .join("")
      : '<div class="notice">コメントはまだありません。</div>';
    return `
      ${itemHtml(esc(courseShort(course)), esc(courseMeta(course)), courseStatusChip(course))}
      <div class="metric-grid" style="margin-top:12px">${metricsHtml}</div>
      <div class="notice" style="margin-top:10px">難易度分布: ${esc(diffDist)}</div>
      <div class="grid-2" style="margin-top:12px">
        <div><h3 class="section-title">未回答者（${pending.length}名）</h3><div class="stack" style="margin-top:8px">${pendingHtml}</div></div>
        <div><h3 class="section-title">コメント・相談</h3><div class="stack" style="margin-top:8px">${commentsHtml}</div></div>
      </div>
    `;
  }

  function openSurveyModal(courseId) {
    const course = courseById(courseId);
    if (!course) return;
    surveyModalCourse = courseId;
    openModal("アンケート状況 / " + courseShort(course), `<div class="stack">${surveyBodyHtml(course)}</div>`);
  }

  function proxyCheckin(studentId, courseId, reason) {
    const course = courseById(courseId);
    if (!course || !studentId) return;
    const attendance = attendanceFor(studentId, courseId, true);
    const before = attendance.checkin_status;
    attendance.checkin_status = "入室済";
    attendance.checkin_time = attendance.checkin_time || nowStamp().slice(11);
    attendance.method = "代理";
    attendance.exception_note = reason || "スマホ忘れ本人確認済";
    attendance.corrected_by = "staff-tanaka";
    attendance.corrected_reason = attendance.exception_note;
    attendance.confirmed_status = "確認済";
    addAction({
      role: "staff",
      action_type: "代理入室",
      target_type: "attendance",
      target_id: attendance.attendance_id,
      before_value: before,
      after_value: "入室済",
      reason: attendance.exception_note,
    });
    saveState();
    renderStaff();
    if (attendanceModalCourse && qs("#detailModal")?.classList.contains("open")) openAttendanceTableModal(attendanceModalCourse);
    showToast("代理入室を記録しました。");
  }

  function openPaperModal(studentId, courseId) {
    const student = studentById(studentId);
    const course = courseById(courseId);
    if (!student || !course) return;
    openModal(
      "紙回答入力 / " + courseShort(course),
      `
        <div class="stack" data-paper-student="${esc(studentId)}" data-paper-course="${esc(courseId)}">
          ${itemHtml(esc(student.display_name), esc(courseShort(course)))}
          <div class="form-grid" style="grid-template-columns:repeat(2,minmax(0,1fr))">
            <label>満足度<select id="modalPaperSat"><option>5</option><option selected>4</option><option>3</option><option>2</option><option>1</option></select></label>
            <label>難易度<select id="modalPaperDiff"><option>易しい</option><option selected>ちょうどよい</option><option>難しい</option></select></label>
            <label>理解度<select id="modalPaperUnd"><option>5</option><option selected>4</option><option>3</option><option>2</option><option>1</option></select></label>
            <label>相談希望<select id="modalPaperConsult"><option value="no">なし</option><option value="yes">あり</option></select></label>
          </div>
          <label>コメント<textarea id="modalPaperComment">紙回答を代理入力</textarea></label>
          <div class="modal-actions"><button type="button" data-close-modal>キャンセル</button><button class="primary" id="modalSavePaper" type="button">登録</button></div>
        </div>
      `
    );
  }

  function savePaperFromModal() {
    const wrap = qs("[data-paper-student]");
    if (!wrap) return;
    const studentId = wrap.dataset.paperStudent;
    const courseId = wrap.dataset.paperCourse;
    const response = surveyFor(studentId, courseId, true);
    const before = response.status;
    response.status = "提出済";
    response.satisfaction = qs("#modalPaperSat").value;
    response.difficulty = qs("#modalPaperDiff").value;
    response.understanding = qs("#modalPaperUnd").value;
    response.consultation = qs("#modalPaperConsult").value;
    response.comment = qs("#modalPaperComment").value.trim() || "紙回答を代理入力";
    response.submitted_at = nowStamp();
    response.input_method = "paper";
    response.input_by = "staff-tanaka";
    attendanceFor(studentId, courseId, true).survey_status = "提出済";
    addAction({
      role: "staff",
      action_type: "紙回答入力",
      target_type: "survey",
      target_id: response.response_id,
      before_value: before,
      after_value: "提出済",
      reason: "紙回答回収",
    });
    saveState();
    renderStaff();
    if (attendanceModalCourse) openAttendanceTableModal(attendanceModalCourse);
    else closeModalWindow();
    showToast("紙回答を登録しました。");
  }


  function thresholdForGrade(grade) {
    return (
      state.thresholds.find((threshold) => threshold.grade === grade && threshold.subject === "全体") ||
      state.thresholds.find((threshold) => threshold.grade === grade) ||
      null
    );
  }

  function masterEditLabel(editing) {
    return editing ? "閲覧に戻る" : "編集";
  }

  function applyMasterEditButton(selector, key) {
    const btn = qs(selector);
    if (btn) btn.textContent = masterEditLabel(state.ui.masterEdit[key]);
  }

  function syncMasterFilter(selector, key) {
    const el = qs(selector);
    if (el && document.activeElement !== el) el.value = state.ui.masterFilter[key] || "";
  }

  function courseStatusLabel(course) {
    const map = { active: "通常", cancelled: "休講", rescheduled: "日程変更", room_changed: "教室変更", time_changed: "時間変更", teacher_changed: "講師変更" };
    return map[course?.status] || course?.status || "";
  }

  function renderStaffMaster() {
    const grades = [...new Set([...state.students.map((student) => student.grade), ...state.thresholds.map((threshold) => threshold.grade)])].filter(Boolean);
    const editingThresholds = state.ui.masterEdit.thresholds;
    applyMasterEditButton("#editThresholds", "thresholds");
    qs("#thresholdView")?.classList.toggle("is-hidden", editingThresholds);
    qs("#thresholdEdit")?.classList.toggle("is-hidden", !editingThresholds);
    const thresholdView = qs("#thresholdView");
    if (thresholdView) {
      thresholdView.innerHTML = grades
        .map((grade) => {
          const threshold = thresholdForGrade(grade);
          return itemHtml(`${esc(grade)} 受講コマ達成基準`, `${esc(threshold?.term || "第1期")} / ${esc(threshold?.threshold_periods || "0")} コマ以上`);
        })
        .join("");
    }
    const gradeSelect = qs("#thresholdGrade");
    if (gradeSelect) {
      gradeSelect.innerHTML = grades.map((grade) => `<option>${esc(grade)}</option>`).join("");
      gradeSelect.value = state.selected.thresholdGrade || grades[0] || "";
    }
    const selectedThreshold = thresholdForGrade(gradeSelect?.value || grades[0]);
    const thresholdValue = qs("#thresholdValue");
    if (thresholdValue && selectedThreshold) thresholdValue.value = selectedThreshold.threshold_periods;

    renderMasterStudents();
    renderMasterCourses();
    renderMasterStaff();
    renderMasterApplications();

    const venues = [...new Set(state.courses.map((course) => course.venue))];
    const settings = qs("#staffSettings");
    if (settings) {
      settings.innerHTML = venues
        .map((venue) => {
          const rooms = [...new Set(state.courses.filter((course) => course.venue === venue).map((course) => course.room))];
          return itemHtml(esc(venue), `教室 ${esc(rooms.join(" / "))}<br>CSV出力権限: 校舎スタッフ以上`);
        })
        .join("");
    }
  }

  function renderMasterStudents() {
    const editing = state.ui.masterEdit.students;
    applyMasterEditButton("#editStudents", "students");
    syncMasterFilter("#filterStudents", "students");
    const query = (state.ui.masterFilter.students || "").trim().toLowerCase();
    const rows = state.students.filter((student) => !query || `${student.display_name} ${student.grade} ${student.venue} ${student.advisor} ${studentNumber(student)}`.toLowerCase().includes(query));
    const body = qs("#masterStudents");
    if (body) {
      body.innerHTML =
        rows
          .map(
            (student) =>
              `<tr><td>${esc(student.display_name)}<br><span class="meta">${esc(studentNumber(student))} / ${esc(student.student_id)}</span></td><td>${esc(student.grade)}</td><td>${esc(student.venue)}</td><td>${esc(student.advisor)}</td><td>${editing ? `<button class="small" type="button" data-edit-student="${esc(student.student_id)}">編集</button>` : ""}</td></tr>`
          )
          .join("") || '<tr><td colspan="5">該当する生徒はいません。</td></tr>';
    }
  }

  function renderMasterCourses() {
    const editing = state.ui.masterEdit.courses;
    applyMasterEditButton("#editCourses", "courses");
    syncMasterFilter("#filterCourses", "courses");
    const query = (state.ui.masterFilter.courses || "").trim().toLowerCase();
    const rows = sortCourses(state.courses).filter(
      (course) => !query || `${course.course_name} ${course.grade} ${course.subject} ${course.venue} ${course.room} ${courseStatusLabel(course)} ${course.date} ${course.teacher_name} ${course.course_id}`.toLowerCase().includes(query)
    );
    const body = qs("#masterCourses");
    if (body) {
      body.innerHTML =
        rows
          .map(
            (course) =>
              `<tr><td>${esc(course.course_name)}<br><span class="meta">${esc(course.course_id)}</span></td><td>${esc(course.grade)} ${esc(course.venue)} ${esc(course.room)}<br><span class="meta">${esc(course.date)} ${esc(course.start_time)}</span></td><td>${courseStatusChip(course)}</td><td>${esc(course.teacher_name)}</td><td>${editing ? `<button class="small" type="button" data-edit-course="${esc(course.course_id)}">編集</button>` : ""}</td></tr>`
          )
          .join("") || '<tr><td colspan="5">該当する講座はありません。</td></tr>';
    }
  }

  function renderMasterStaff() {
    const editing = state.ui.masterEdit.staff;
    applyMasterEditButton("#editStaff", "staff");
    syncMasterFilter("#filterStaff", "staff");
    const query = (state.ui.masterFilter.staff || "").trim().toLowerCase();
    const rows = state.staffMaster.filter((member) => !query || `${member.name} ${member.venue} ${member.role} ${member.staff_id}`.toLowerCase().includes(query));
    const body = qs("#masterStaff");
    if (body) {
      body.innerHTML =
        rows
          .map(
            (member) =>
              `<tr><td>${esc(member.staff_id)}</td><td>${esc(member.name)}</td><td>${esc(member.venue)}</td><td>${esc(member.role)}</td><td>${editing ? `<button class="small" type="button" data-edit-staff="${esc(member.staff_id)}">編集</button>` : ""}</td></tr>`
          )
          .join("") || '<tr><td colspan="5">該当する担当者はいません。</td></tr>';
    }
  }

  function renderMasterApplications() {
    const editing = state.ui.masterEdit.applications;
    applyMasterEditButton("#editApplications", "applications");
    syncMasterFilter("#filterApplications", "applications");
    const query = (state.ui.masterFilter.applications || "").trim().toLowerCase();
    const rows = state.applications.filter((app) => {
      const sn = studentName(app.student_id);
      const cs = courseShort(courseById(app.course_id));
      return !query || `${sn} ${cs} ${app.status} ${app.source} ${app.applied_at} ${app.student_id} ${app.course_id}`.toLowerCase().includes(query);
    });
    const body = qs("#masterApplications");
    if (body) {
      body.innerHTML =
        rows
          .map((app) => {
            const color = app.status === "申込済" ? "green" : app.status === "キャンセル" ? "red" : "amber";
            return `<tr><td>${esc(studentName(app.student_id))}<br><span class="meta">${esc(app.student_id)}</span></td><td>${esc(courseShort(courseById(app.course_id)))}<br><span class="meta">${esc(app.course_id)}</span></td><td>${esc(app.applied_at)}</td><td><span class="chip ${color}">${esc(app.status)}</span></td><td>${esc(app.source)}</td><td>${editing ? `<button class="small" type="button" data-edit-application="${esc(app.application_id)}">編集</button>` : ""}</td></tr>`;
          })
          .join("") || '<tr><td colspan="6">該当する申込はありません。</td></tr>';
    }
  }

  const MASTER_EXPORT = {
    students: { filename: "students_master_v2.csv", headers: ["student_id", "student_number", "display_name", "grade", "venue", "advisor", "line_status", "school", "status", "login_id", "password"] },
    courses: { filename: "courses_master_v2.csv", headers: ["course_id", "grade", "subject", "course_name", "term", "venue", "room", "date", "start_time", "end_time", "period_count", "status", "teacher_id", "teacher_name", "survey_required", "qr_mode", "notice", "materials"] },
    staff: { filename: "staff_master_v2.csv", headers: ["staff_id", "name", "venue", "role"] },
    applications: { filename: "applications_master_v2.csv", headers: ["application_id", "student_id", "course_id", "applied_at", "status", "source"] },
  };

  function exportMasterCsv(key) {
    const def = MASTER_EXPORT[key];
    if (!def) return;
    const data = key === "students" ? state.students : key === "courses" ? state.courses : key === "staff" ? state.staffMaster : state.applications;
    downloadCsv(def.filename, toCsv(data, def.headers));
    addAction({ role: "staff", action_type: "マスタCSV出力", target_type: "master", target_id: key, after_value: `${data.length}件`, reason: "編集後CSV出力" });
    saveState();
    renderStaff();
    showToast(`${def.filename} を出力しました。`);
  }

  function openStaffMasterModal(staffId) {
    const member = state.staffMaster.find((item) => item.staff_id === staffId);
    if (!member) return;
    const venues = [...new Set([...state.courses.map((course) => course.venue), member.venue])];
    openModal(
      "担当者マスタ編集",
      `
        <div class="stack" data-edit-staff-id="${esc(member.staff_id)}">
          ${itemHtml(esc(member.name), `${esc(member.staff_id)} / ${esc(member.venue)} / ${esc(member.role)}`)}
          <div class="form-grid">
            <label>氏名<input id="modalStaffName" value="${esc(member.name)}"></label>
            <label>校舎<select id="modalStaffVenue">${venues.map((venue) => `<option ${venue === member.venue ? "selected" : ""}>${esc(venue)}</option>`).join("")}</select></label>
            <label>役割<input id="modalStaffRole" value="${esc(member.role)}"></label>
          </div>
          <div class="modal-actions"><button type="button" data-close-modal>キャンセル</button><button class="primary" id="modalSaveStaff" type="button">保存</button></div>
        </div>
      `
    );
  }

  function saveStaffMasterFromModal() {
    const member = state.staffMaster.find((item) => item.staff_id === qs("[data-edit-staff-id]")?.dataset.editStaffId);
    if (!member) return;
    const before = `${member.name} / ${member.venue} / ${member.role}`;
    member.name = qs("#modalStaffName").value.trim();
    member.venue = qs("#modalStaffVenue").value;
    member.role = qs("#modalStaffRole").value.trim();
    addAction({ role: "staff", action_type: "担当者マスタ更新", target_type: "staff", target_id: member.staff_id, before_value: before, after_value: `${member.name} / ${member.venue} / ${member.role}`, reason: "モーダル編集" });
    saveState();
    closeModalWindow();
    renderStaff();
    showToast("担当者マスタを保存しました。");
  }

  function openApplicationModal(appId) {
    const app = state.applications.find((item) => item.application_id === appId);
    if (!app) return;
    openModal(
      "申込情報編集",
      `
        <div class="stack" data-edit-app-id="${esc(app.application_id)}">
          ${itemHtml(esc(studentName(app.student_id)), esc(courseShort(courseById(app.course_id))))}
          <div class="form-grid">
            <label>申込日<input id="modalAppDate" value="${esc(app.applied_at)}"></label>
            <label>状態<select id="modalAppStatus">${["申込済", "仮申込", "キャンセル"].map((status) => `<option ${status === app.status ? "selected" : ""}>${esc(status)}</option>`).join("")}</select></label>
            <label>経路<select id="modalAppSource">${["窓口", "Web", "電話", "Access"].map((source) => `<option ${source === app.source ? "selected" : ""}>${esc(source)}</option>`).join("")}</select></label>
          </div>
          <div class="modal-actions"><button type="button" data-close-modal>キャンセル</button><button class="primary" id="modalSaveApplication" type="button">保存</button></div>
        </div>
      `
    );
  }

  function saveApplicationFromModal() {
    const app = state.applications.find((item) => item.application_id === qs("[data-edit-app-id]")?.dataset.editAppId);
    if (!app) return;
    const before = `${app.applied_at} / ${app.status} / ${app.source}`;
    app.applied_at = qs("#modalAppDate").value.trim();
    app.status = qs("#modalAppStatus").value;
    app.source = qs("#modalAppSource").value;
    addAction({ role: "staff", action_type: "申込情報更新", target_type: "application", target_id: app.application_id, before_value: before, after_value: `${app.applied_at} / ${app.status} / ${app.source}`, reason: "モーダル編集" });
    saveState();
    closeModalWindow();
    renderStaff();
    showToast("申込情報を保存しました。");
  }

  function saveStaffSettings() {
    const grade = qs("#thresholdGrade").value;
    const value = qs("#thresholdValue").value.trim();
    let threshold = thresholdForGrade(grade);
    if (!threshold) {
      threshold = {
        threshold_id: makeId("THR-V2"),
        grade,
        term: "第1期",
        subject: "全体",
        threshold_periods: "0",
        starts_at: "2026-05-01",
        ends_at: "2026-06-30",
      };
      state.thresholds.push(threshold);
    }
    const before = threshold.threshold_periods;
    threshold.threshold_periods = value;
    threshold.subject = "全体";
    state.selected.thresholdGrade = grade;
    addAction({
      role: "staff",
      action_type: "基準コマ設定",
      target_type: "threshold",
      target_id: threshold.threshold_id,
      before_value: before,
      after_value: value,
      reason: "基準コマ数変更",
    });
    saveState();
    renderStaff();
    showToast("基準コマ設定を保存しました。");
  }

  function courseChangeTypes() {
    return ["休講", "日程変更", "時間変更", "教室変更", "講師変更"];
  }

  function courseChangeAfterOptions(course, type) {
    if (type === "休講") return ["休講"];
    if (type === "日程変更") {
      return [...new Set([course.date, APP_DATE, "2026-05-29", "2026-05-30", "2026-06-01", "2026-06-02"])].sort();
    }
    if (type === "時間変更") {
      return [...new Set([`${course.start_time}-${course.end_time}`, "10:00-12:00", "13:00-15:00", "15:00-17:00", "17:20-19:20", "18:00-20:00"])];
    }
    if (type === "教室変更") {
      const rooms = state.courses.filter((item) => item.venue === course.venue).map((item) => item.room);
      const extras = course.venue === "C校" ? ["301", "302"] : ["101", "102", "103", "104", "105"];
      return [...new Set([course.room, ...rooms, ...extras])].filter(Boolean).sort();
    }
    if (type === "講師変更") {
      return [...new Set([course.teacher_name, ...state.courses.map((item) => item.teacher_name)])].filter(Boolean).sort();
    }
    return [""];
  }

  function renderCourseChangeAfterSelect(course, type) {
    const options = courseChangeAfterOptions(course, type);
    const currentValue =
      type === "日程変更"
        ? course.date
        : type === "時間変更"
          ? `${course.start_time}-${course.end_time}`
          : type === "教室変更"
            ? course.room
            : type === "講師変更"
              ? course.teacher_name
              : "休講";
    const defaultValue = type === "休講" ? options[0] : options.find((option) => option !== currentValue) || options[0];
    return `
      <label>変更後
        <select id="modalChangeAfter">
          ${options.map((option) => `<option value="${esc(option)}" ${option === defaultValue ? "selected" : ""}>${esc(option)}</option>`).join("")}
        </select>
      </label>
    `;
  }

  function courseChangeAfterValue(course, type, after) {
    if (type === "日程変更") return `${after} ${course.start_time}`;
    return after;
  }

  function changeVisibleToStudent(type) {
    return ["休講", "日程変更", "時間変更"].includes(type);
  }

  function courseSnapshot(course) {
    return {
      status: course.status === "cancelled" ? "休講" : "実施",
      date: course.date,
      time: `${course.start_time}-${course.end_time}`,
      room: course.room,
      teacher: course.teacher_name,
    };
  }

  function plannedCourseSnapshot(course, type, after) {
    const snapshot = courseSnapshot(course);
    if (type === "休講") snapshot.status = "休講";
    if (type === "日程変更") snapshot.date = after;
    if (type === "時間変更") snapshot.time = after;
    if (type === "教室変更") snapshot.room = after;
    if (type === "講師変更") snapshot.teacher = after;
    return snapshot;
  }

  function renderCourseChangePreview(course, type, after) {
    const before = courseSnapshot(course);
    const planned = plannedCourseSnapshot(course, type, after);
    const rows = [
      ["状態", before.status, planned.status],
      ["日付", before.date, planned.date],
      ["時間", before.time, planned.time],
      ["教室", before.room, planned.room],
      ["講師", before.teacher, planned.teacher],
    ]
      .map(([label, from, to]) => `<tr class="${from !== to ? "changed-row" : ""}"><th>${esc(label)}</th><td>${esc(from)}</td><td>${esc(to)}</td></tr>`)
      .join("");
    const targetCount = courseStudentIds(course.course_id).length;
    const notice = changeVisibleToStudent(type)
      ? `<div class="notice amber">確定すると、対象生徒 ${targetCount} 名の生徒画面「お知らせ」に変更内容が表示されます。</div>`
      : '<div class="notice">この変更は校舎内の運用情報として保存します。生徒画面のお知らせには表示しません。</div>';
    return `
      ${notice}
      <table class="compare-table">
        <thead><tr><th>項目</th><th>変更前</th><th>変更後</th></tr></thead>
        <tbody>${rows}</tbody>
      </table>
    `;
  }

  function openCourseChangeModal(courseId) {
    const course = courseById(courseId);
    if (!course) return;
    const defaultType = "日程変更";
    openModal(
      "講座変更の確認",
      `
        <div class="stack" data-change-course-id="${esc(course.course_id)}">
          ${itemHtml(esc(courseShort(course)), esc(courseMeta(course)), courseStatusChip(course))}
          <div class="form-grid">
            <label>変更種別
              <select id="modalChangeType">
                ${courseChangeTypes().map((type) => `<option>${esc(type)}</option>`).join("")}
              </select>
            </label>
            <div id="modalChangeAfterWrap">${renderCourseChangeAfterSelect(course, defaultType)}</div>
            <label class="field-span-2">理由
              <textarea id="modalChangeReason">校舎運用上の調整</textarea>
            </label>
          </div>
          <div id="courseChangePreview"></div>
          <label class="setting-toggle"><input id="modalChangeConfirm" type="checkbox">変更前/変更後と生徒通知範囲を確認した</label>
          <div class="modal-actions">
            <button type="button" data-close-modal>キャンセル</button>
            <button class="primary" id="modalSaveCourseChange" type="button">確定</button>
          </div>
        </div>
      `
    );
    const typeSelect = qs("#modalChangeType");
    if (typeSelect) typeSelect.value = defaultType;
    updateCourseChangePreview();
  }

  function renderCourseChangeAfterControl() {
    const wrapper = qs("#modalChangeAfterWrap");
    const courseId = qs("[data-change-course-id]")?.dataset.changeCourseId;
    const course = courseById(courseId);
    const type = qs("#modalChangeType")?.value;
    if (!wrapper || !course || !type) return;
    wrapper.innerHTML = renderCourseChangeAfterSelect(course, type);
  }

  function updateCourseChangePreview() {
    const courseId = qs("[data-change-course-id]")?.dataset.changeCourseId;
    const course = courseById(courseId);
    const type = qs("#modalChangeType")?.value;
    const after = qs("#modalChangeAfter")?.value;
    const preview = qs("#courseChangePreview");
    if (!course || !type || !after || !preview) return;
    preview.innerHTML = renderCourseChangePreview(course, type, after);
  }

  function saveCourseChange() {
    const courseId = qs("[data-change-course-id]")?.dataset.changeCourseId || "";
    const course = courseById(courseId);
    const type = qs("#modalChangeType")?.value;
    const after = (qs("#modalChangeAfter")?.value || "").trim();
    const reason = (qs("#modalChangeReason")?.value || "").trim();
    if (!course || !after || !reason) {
      showToast("講座、変更後、理由を入力してください。");
      return;
    }
    if (!qs("#modalChangeConfirm")?.checked) {
      showToast("変更前/変更後と通知範囲を確認してください。");
      return;
    }
    const beforeMap = {
      休講: course.status === "cancelled" ? "休講" : "実施",
      日程変更: `${course.date} ${course.start_time}`,
      時間変更: `${course.start_time}-${course.end_time}`,
      教室変更: course.room,
      講師変更: course.teacher_name,
    };
    const before = beforeMap[type] || "";
    const afterDisplay = courseChangeAfterValue(course, type, after);
    if (type === "休講") course.status = "cancelled";
    if (type === "日程変更") {
      course.status = "rescheduled";
      course.date = after;
    }
    if (type === "時間変更") {
      const [start, end] = after.split("-");
      course.status = "time_changed";
      course.start_time = start || course.start_time;
      course.end_time = end || course.end_time;
    }
    if (type === "教室変更") {
      course.status = "room_changed";
      course.room = after;
    }
    if (type === "講師変更") {
      course.status = "teacher_changed";
      course.teacher_name = after;
    }
    const visible = changeVisibleToStudent(type) ? "yes" : "no";
    if (visible === "yes") course.notice = `${type}: ${before} → ${afterDisplay}`;
    const change = {
      change_id: makeId("CHG-V2"),
      course_id: courseId,
      change_type: type,
      before_value: before,
      after_value: afterDisplay,
      reason,
      impact_count: String(courseStudentIds(courseId).length),
      visible_to_student: visible,
      created_at: nowStamp(),
      created_by: "staff-tanaka",
      confirmed_status: "確認済",
    };
    state.changes.unshift(change);
    addAction({
      role: "staff",
      action_type: "講座変更",
      target_type: "course",
      target_id: courseId,
      before_value: before,
      after_value: afterDisplay,
      reason,
    });
    saveState();
    closeModalWindow();
    renderStaff();
    showToast(visible === "yes" ? "講座変更を確定し、生徒のお知らせ対象にしました。" : "講座変更を確定しました。");
  }

  function openStudentMasterModal(studentId) {
    const student = studentById(studentId);
    if (!student) return;
    const venues = [...new Set(state.courses.map((course) => course.venue))];
    const grades = [...new Set(state.students.map((item) => item.grade))];
    openModal(
      "生徒マスタ編集",
      `
        <div class="stack" data-edit-student-id="${esc(student.student_id)}">
          ${itemHtml(esc(student.display_name), `${esc(studentNumber(student))} / ${esc(student.grade)} / ${esc(student.venue)}`, '<span class="chip blue">生徒</span>')}
          <div class="form-grid">
            <label>氏名<input id="modalStudentName" value="${esc(student.display_name)}"></label>
            <label>生徒番号<input id="modalStudentNumber" value="${esc(studentNumber(student))}" inputmode="numeric"></label>
            <label>学年<select id="modalStudentGrade">${grades.map((grade) => `<option ${grade === student.grade ? "selected" : ""}>${esc(grade)}</option>`).join("")}</select></label>
            <label>校舎<select id="modalStudentVenue">${venues.map((venue) => `<option ${venue === student.venue ? "selected" : ""}>${esc(venue)}</option>`).join("")}</select></label>
            <label>担当<input id="modalStudentAdvisor" value="${esc(student.advisor)}"></label>
            <label>通知登録<select id="modalStudentLine"><option ${student.line_status === "登録済" ? "selected" : ""}>登録済</option><option ${student.line_status !== "登録済" ? "selected" : ""}>未登録</option></select></label>
            <label class="field-span-2">学校<input id="modalStudentSchool" value="${esc(student.school || "")}"></label>
          </div>
          <div class="modal-actions">
            <button type="button" data-close-modal>キャンセル</button>
            <button class="primary" id="modalSaveStudent" type="button">保存</button>
          </div>
        </div>
      `
    );
  }

  function saveStudentMasterFromModal() {
    const student = studentById(qs("[data-edit-student-id]")?.dataset.editStudentId);
    if (!student) return;
    const before = `${student.display_name} / ${student.grade} / ${student.venue}`;
    student.display_name = qs("#modalStudentName").value.trim();
    student.student_number = qs("#modalStudentNumber").value.trim();
    student.login_id = student.student_number;
    student.grade = qs("#modalStudentGrade").value;
    student.venue = qs("#modalStudentVenue").value;
    student.advisor = qs("#modalStudentAdvisor").value.trim();
    student.line_status = qs("#modalStudentLine").value;
    student.school = qs("#modalStudentSchool").value.trim();
    addAction({
      role: "staff",
      action_type: "生徒マスタ更新",
      target_type: "student",
      target_id: student.student_id,
      before_value: before,
      after_value: `${student.display_name} / ${student.grade} / ${student.venue}`,
      reason: "モーダル編集",
    });
    saveState();
    closeModalWindow();
    renderStaff();
    showToast("生徒マスタを保存しました。");
  }

  function openCourseMasterModal(courseId) {
    const course = courseById(courseId);
    if (!course) return;
    const venues = [...new Set(state.courses.map((item) => item.venue))];
    const grades = [...new Set(state.courses.map((item) => item.grade))];
    const subjects = [...new Set(state.courses.map((item) => item.subject))];
    const teachers = [...new Set(state.courses.map((item) => item.teacher_name))];
    openModal(
      "講座マスタ編集",
      `
        <div class="stack" data-edit-course-id="${esc(course.course_id)}">
          ${itemHtml(esc(course.course_name), esc(courseMeta(course)), courseStatusChip(course))}
          <div class="form-grid">
            <label class="field-span-2">講座名<input id="modalCourseName" value="${esc(course.course_name)}"></label>
            <label>学年<select id="modalCourseGrade">${grades.map((grade) => `<option ${grade === course.grade ? "selected" : ""}>${esc(grade)}</option>`).join("")}</select></label>
            <label>科目<select id="modalCourseSubject">${subjects.map((subject) => `<option ${subject === course.subject ? "selected" : ""}>${esc(subject)}</option>`).join("")}</select></label>
            <label>校舎<select id="modalCourseVenue">${venues.map((venue) => `<option ${venue === course.venue ? "selected" : ""}>${esc(venue)}</option>`).join("")}</select></label>
            <label>教室<input id="modalCourseRoom" value="${esc(course.room)}"></label>
            <label>日付<input id="modalCourseDate" value="${esc(course.date)}"></label>
            <label>開始<input id="modalCourseStart" value="${esc(course.start_time)}"></label>
            <label>終了<input id="modalCourseEnd" value="${esc(course.end_time)}"></label>
            <label>コマ数<input id="modalCoursePeriods" value="${esc(course.period_count)}" inputmode="numeric"></label>
            <label>講師<select id="modalCourseTeacher">${teachers.map((teacher) => `<option ${teacher === course.teacher_name ? "selected" : ""}>${esc(teacher)}</option>`).join("")}</select></label>
            <label>状態<select id="modalCourseStatus"><option value="active" ${course.status === "active" ? "selected" : ""}>実施</option><option value="cancelled" ${course.status === "cancelled" ? "selected" : ""}>休講</option><option value="rescheduled" ${course.status === "rescheduled" ? "selected" : ""}>日程変更</option><option value="time_changed" ${course.status === "time_changed" ? "selected" : ""}>時間変更</option><option value="room_changed" ${course.status === "room_changed" ? "selected" : ""}>教室変更</option><option value="teacher_changed" ${course.status === "teacher_changed" ? "selected" : ""}>講師変更</option></select></label>
            <label>アンケート<select id="modalCourseSurvey"><option value="yes" ${course.survey_required === "yes" ? "selected" : ""}>対象</option><option value="no" ${course.survey_required !== "yes" ? "selected" : ""}>対象外</option></select></label>
          </div>
          <div class="modal-actions">
            <button type="button" data-close-modal>キャンセル</button>
            <button class="primary" id="modalSaveCourse" type="button">保存</button>
          </div>
        </div>
      `
    );
  }

  function saveCourseMasterFromModal() {
    const course = courseById(qs("[data-edit-course-id]")?.dataset.editCourseId);
    if (!course) return;
    const before = courseShort(course);
    course.course_name = qs("#modalCourseName").value.trim();
    course.grade = qs("#modalCourseGrade").value;
    course.subject = qs("#modalCourseSubject").value;
    course.venue = qs("#modalCourseVenue").value;
    course.room = qs("#modalCourseRoom").value.trim();
    course.date = qs("#modalCourseDate").value.trim();
    course.start_time = qs("#modalCourseStart").value.trim();
    course.end_time = qs("#modalCourseEnd").value.trim();
    course.period_count = qs("#modalCoursePeriods").value.trim();
    course.teacher_name = qs("#modalCourseTeacher").value;
    course.status = qs("#modalCourseStatus").value;
    course.survey_required = qs("#modalCourseSurvey").value;
    addAction({
      role: "staff",
      action_type: "講座マスタ更新",
      target_type: "course",
      target_id: course.course_id,
      before_value: before,
      after_value: courseShort(course),
      reason: "モーダル編集",
    });
    saveState();
    closeModalWindow();
    renderStaff();
    showToast("講座マスタを保存しました。");
  }

  function updateAttendanceStatus(studentId, courseId, status) {
    const attendance = attendanceFor(studentId, courseId, true);
    const before = attendance.checkin_status;
    attendance.checkin_status = status;
    attendance.checkin_time = status === "入室済" ? attendance.checkin_time || nowStamp().slice(11) : "";
    attendance.method = status === "入室済" ? (attendance.method && attendance.method !== "未実施" ? attendance.method : "校舎修正") : "校舎修正";
    attendance.corrected_by = "staff-tanaka";
    attendance.corrected_reason = status === "欠席" ? "校舎確認" : "校舎画面で修正";
    attendance.confirmed_status = "確認済";
    addAction({
      role: "staff",
      action_type: "出席修正",
      target_type: "attendance",
      target_id: attendance.attendance_id,
      before_value: before,
      after_value: status,
      reason: attendance.corrected_reason,
    });
    saveState();
    renderStaff();
    showToast("出席状態を更新しました。");
  }


  function renderSurveyTrend(container, courseId) {
    if (!container) return;
    const responses = state.surveys.filter((survey) => survey.course_id === courseId && survey.status === "提出済");
    const targetCount = courseStudentIds(courseId).length;
    const avg = (key) => {
      const nums = responses.map((response) => numberValue(response[key])).filter(Boolean);
      if (!nums.length) return "-";
      return (nums.reduce((sum, value) => sum + value, 0) / nums.length).toFixed(1);
    };
    const difficult = responses.filter((response) => response.difficulty === "難しい").length;
    container.innerHTML = [
      metric("回答率", `${targetCount ? Math.round((responses.length / targetCount) * 100) : 0}%`),
      metric("満足度平均", avg("satisfaction")),
      metric("理解度平均", avg("understanding")),
      metric("難しい", difficult),
    ].join("");
  }

  function detectAnomalies() {
    const anomalies = [];
    state.attendance
      .filter((record) => record.checkin_status === "入室済")
      .forEach((record) => {
        const course = courseById(record.course_id);
        if (!course) {
          anomalies.push({ key: `missing-course:${record.attendance_id}`, type: "存在しない講座ID", detail: `${record.course_id} / ${studentName(record.student_id)}`, severity: "高" });
          return;
        }
        if (!isEnrolled(record.student_id, record.course_id)) {
          anomalies.push({ key: `unregistered:${record.student_id}:${record.course_id}`, type: "未申込講座打刻", detail: `${studentName(record.student_id)} / ${courseShort(course)}`, severity: "高" });
        }
        if (course.status === "cancelled") {
          anomalies.push({ key: `cancelled:${record.student_id}:${record.course_id}`, type: "休講講座への打刻", detail: `${studentName(record.student_id)} / ${courseShort(course)}`, severity: "高" });
        }
        if (record.method === "代理" && !record.exception_note && !record.corrected_reason) {
          anomalies.push({ key: `proxy-no-reason:${record.attendance_id}`, type: "代理理由未記録", detail: `${studentName(record.student_id)} / ${courseShort(course)}`, severity: "中" });
        }
        if (record.checkin_time) {
          const check = minutes(record.checkin_time);
          if (check < minutes(course.start_time) - 60 || check > minutes(course.end_time)) {
            anomalies.push({ key: `outside-time:${record.attendance_id}`, type: "時間外打刻", detail: `${studentName(record.student_id)} / ${record.checkin_time}`, severity: "中" });
          }
        }
      });

    return anomalies;
  }

  function isAnomalyConfirmed(key) {
    return state.actions.some((action) => action.action_type === "異常確認" && action.target_id === key);
  }

  function voiceActionFor(studentId, subject) {
    return state.actions.find(
      (action) =>
        action.action_type === "声かけ予定" &&
        action.target_id === studentId &&
        String(action.reason || "").includes(subject)
    );
  }

  function markVoiceStatus(studentId, subject, status) {
    const existing = voiceActionFor(studentId, subject);
    if (existing) {
      existing.after_value = status;
      existing.created_at = nowStamp();
      return existing;
    }
    const action = {
      role: "staff",
      action_type: "声かけ予定",
      target_type: "student",
      target_id: studentId,
      before_value: "未対応",
      after_value: status,
      reason: subject.endsWith("コマ数") ? `${subject}不足` : `${subject}コマ数不足`,
    };
    addAction(action);
    return state.actions[0];
  }

  function renderStaffRisk() {
    const view = state.ui.riskView || "all";
    qsa("[data-risk-view]").forEach((button) => button.classList.toggle("selected", button.dataset.riskView === view));
    qs("#riskPanels")?.classList.toggle("single", view !== "all");
    const showPanel = (selector, key) => qs(selector)?.classList.toggle("is-hidden", !(view === "all" || view === key));
    showPanel("#riskAnomalyPanel", "anomaly");
    showPanel("#riskShortagePanel", "shortage");
    showPanel("#riskVoicePanel", "voice");
    showPanel("#riskLogPanel", "log");

    const anomalies = detectAnomalies();
    qs("#anomalyRows").innerHTML = anomalies
      .map((item) => {
        const confirmed = isAnomalyConfirmed(item.key);
        return `<tr><td>${esc(item.type)}</td><td>${esc(item.detail)}</td><td><span class="chip ${item.severity === "高" ? "red" : "amber"}">${esc(item.severity)}</span></td><td>${confirmed ? '<span class="chip green">確認済</span>' : `<button class="small" type="button" data-anomaly-confirm="${esc(item.key)}">確認済</button>`}</td></tr>`;
      })
      .join("") || '<tr><td colspan="4">異常はありません。</td></tr>';

    const shortages = computeShortages();
    qs("#shortageRows").innerHTML = shortages
      .map((row) => {
        const action = voiceActionFor(row.student_id, row.scope);
        const status = action?.after_value || "未対応";
        const assignee = action?.assignee ? ` / 担当 ${esc(action.assignee)}` : "";
        const op =
          status === "対応済み"
            ? '<span class="chip green">対応済み</span>'
            : status === "対応予定"
              ? `<button class="small" type="button" data-shortage-complete="${esc(row.student_id)}|${esc(row.scope)}">対応済みにする</button>`
              : `<button class="small" type="button" data-shortage-voice="${esc(row.student_id)}|${esc(row.scope)}コマ数不足">声かけ</button>`;
        return `<tr><td>${esc(studentName(row.student_id))}</td><td>${esc(row.scope)}</td><td>${row.actual}/${row.threshold} 不足${row.shortage}<br><span class="chip ${status === "対応済み" ? "green" : status === "対応予定" ? "amber" : ""}">${esc(status)}</span>${assignee}</td><td>${op}</td></tr>`;
      })
      .join("") || '<tr><td colspan="4">基準未達はありません。</td></tr>';
    qs("#voiceStudent").innerHTML = state.students.map((student) => `<option value="${esc(student.student_id)}">${esc(student.display_name)}</option>`).join("");
    const assigneeSelect = qs("#voiceAssignee");
    if (assigneeSelect) {
      assigneeSelect.innerHTML = state.staffMaster.map((member) => `<option value="${esc(member.name)}">${esc(member.name)}（${esc(member.venue)}）</option>`).join("") || `<option value="">担当者なし</option>`;
    }
    qs("#voiceRows").innerHTML = state.actions
      .filter((action) => action.action_type.includes("声かけ"))
      .map((action) => itemHtml(esc(studentName(action.target_id)), `${esc(action.reason)} / ${esc(action.created_at)} / ${esc(action.after_value)}${action.assignee ? ` / 担当 ${esc(action.assignee)}` : ""}`, '<span class="chip amber">声かけ</span>'))
      .join("") || '<div class="notice">声かけ予定はありません。</div>';
    qs("#operationLogRows").innerHTML = state.actions
      .slice(0, 20)
      .map((action) => `<tr><td>${esc(action.created_at)}</td><td>${esc(action.action_type)}</td><td>${esc(action.target_type)}:${esc(action.target_id)}</td><td>${esc(action.reason)}</td></tr>`)
      .join("");
  }

  function computeShortages() {
    const rows = [];
    state.students.forEach((student) => {
      const threshold = thresholdForGrade(student.grade);
      if (!threshold) return;
      const courses = studentCourses(student.student_id).filter((course) => course.term === threshold.term);
      const actual = courses.reduce((sum, course) => {
        const attendance = attendanceFor(student.student_id, course.course_id);
        return sum + (attendance?.checkin_status === "入室済" ? numberValue(course.period_count) : 0);
      }, 0);
      const required = numberValue(threshold.threshold_periods);
      if (courses.length && actual < required) {
        rows.push({
          student_id: student.student_id,
          scope: `${student.grade} 期間合計`,
          actual,
          threshold: required,
          shortage: required - actual,
        });
      }
    });
    return rows;
  }

  function staffAddVoiceAction() {
    const studentId = qs("#voiceStudent").value;
    const reason = qs("#voiceReason").value.trim();
    const assignee = qs("#voiceAssignee")?.value || "";
    const scope = "受講コマ";
    const action = markVoiceStatus(studentId, scope, "対応予定");
    action.reason = reason;
    action.assignee = assignee;
    saveState();
    renderStaff();
    showToast("声かけ予定を追加しました。");
  }

  function renderStaffExport() {
    const refs = Object.entries(CSV_FILES)
      .map(([key, file]) => itemHtml(esc(file), `${state[key].length}件 / v2画面で参照`, '<span class="chip blue">CSV</span>'))
      .join("");
    qs("#csvReferenceRows").innerHTML = refs;
    renderExportPreview();
  }

  function exportRows(type) {
    if (type === "attendance") {
      const headers = ["attendance_id", "student_id", "student_name", "course_id", "course_name", "checkin_status", "checkin_time", "method", "survey_status", "confirmed_status"];
      return {
        filename: "attendance_export_v2.csv",
        headers,
        rows: state.attendance.map((row) => {
          const course = courseById(row.course_id);
          return { ...row, student_name: studentName(row.student_id), course_name: courseShort(course) };
        }),
      };
    }
    if (type === "counts") {
      const headers = ["student_id", "student_name", "scope", "actual_periods", "threshold_periods", "shortage_periods"];
      return {
        filename: "course_counts_export_v2.csv",
        headers,
        rows: computeShortages().map((row) => ({
          student_id: row.student_id,
          student_name: studentName(row.student_id),
          scope: row.scope,
          actual_periods: row.actual,
          threshold_periods: row.threshold,
          shortage_periods: row.shortage,
        })),
      };
    }
    if (type === "survey") {
      const headers = ["response_id", "student_id", "student_name", "course_id", "course_name", "status", "satisfaction", "difficulty", "understanding", "consultation", "submitted_at", "input_method"];
      return {
        filename: "survey_export_v2.csv",
        headers,
        rows: state.surveys.map((row) => ({
          ...row,
          student_name: studentName(row.student_id),
          course_name: courseShort(courseById(row.course_id)),
        })),
      };
    }
    if (type === "pos") {
      const headers = ["student_id", "course_id", "date", "start_time", "attendance_status", "period_count"];
      return {
        filename: "pos_import_sample_v2.csv",
        headers,
        rows: state.attendance.map((row) => {
          const course = courseById(row.course_id) || {};
          return {
            student_id: row.student_id,
            course_id: row.course_id,
            date: course.date || "",
            start_time: course.start_time || "",
            attendance_status: row.checkin_status,
            period_count: course.period_count || "",
          };
        }),
      };
    }
    if (type === "access") {
      const headers = ["course_id", "grade", "term", "venue", "room", "date", "start_time", "end_time", "student_id", "status"];
      return {
        filename: "access_import_sample_v2.csv",
        headers,
        rows: state.attendance.map((row) => {
          const course = courseById(row.course_id) || {};
          return {
            course_id: row.course_id,
            grade: course.grade || "",
            term: course.term || "",
            venue: course.venue || "",
            room: course.room || "",
            date: course.date || "",
            start_time: course.start_time || "",
            end_time: course.end_time || "",
            student_id: row.student_id,
            status: row.checkin_status,
          };
        }),
      };
    }
    return {
      filename: "actions_export_v2.csv",
      headers: ["action_id", "role", "actor", "action_type", "target_type", "target_id", "before_value", "after_value", "reason", "created_at"],
      rows: state.actions,
    };
  }

  function renderExportPreview() {
    const type = qs("#exportType")?.value || "attendance";
    const exportData = exportRows(type);
    latestExport = {
      filename: exportData.filename,
      csv: toCsv(exportData.rows, exportData.headers),
    };
    const preview = qs("#exportPreview");
    if (preview) preview.textContent = latestExport.csv;
  }

  function downloadCsv(filename, csv) {
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
  }

  function downloadLatestExport() {
    renderExportPreview();
    downloadCsv(latestExport.filename, latestExport.csv);
    addAction({
      role: "staff",
      action_type: "CSV出力",
      target_type: "export",
      target_id: latestExport.filename,
      after_value: "download",
      reason: qs("#exportType")?.value || "attendance",
    });
    saveState();
    renderStaff();
  }

  function bindTeacherOnce() {
    qs("#teacherSelect")?.addEventListener("change", (event) => {
      state.selected.teacherId = event.target.value;
      const first = sortCourses(state.courses.filter((course) => course.teacher_id === state.selected.teacherId && course.date === APP_DATE))[0];
      state.selected.teacherCourseId = first?.course_id || sortCourses(state.courses.filter((course) => course.teacher_id === state.selected.teacherId))[0]?.course_id || "";
      saveState();
      renderTeacher();
    });
    qs("#teacherCourseSelect")?.addEventListener("change", (event) => {
      state.selected.teacherCourseId = event.target.value;
      saveState();
      renderTeacher();
    });
    qs("#todayOnlyToggle")?.addEventListener("change", renderTeacherCourses);
    qs("#saveTeacherNote")?.addEventListener("click", saveTeacherNote);
    qs("#saveTeacherNextMemo")?.addEventListener("click", saveTeacherNextMemo);

    document.addEventListener("click", (event) => {
      const button = event.target.closest("[data-teacher-course]");
      if (button) {
        state.selected.teacherCourseId = button.dataset.teacherCourse;
        saveState();
        selectTab("teacher-class");
        renderTeacher();
      }
    });
  }

  function renderTeacher() {
    renderTeacherSelectors();
    renderTeacherCourses();
    renderTeacherClass();
    renderTeacherReview();
  }

  function teachers() {
    const map = new Map();
    state.courses.forEach((course) => map.set(course.teacher_id, course.teacher_name));
    return Array.from(map.entries()).map(([teacher_id, teacher_name]) => ({ teacher_id, teacher_name }));
  }

  function renderTeacherSelectors() {
    const teacherSelect = qs("#teacherSelect");
    if (teacherSelect) {
      teacherSelect.innerHTML = teachers().map((teacher) => `<option value="${esc(teacher.teacher_id)}">${esc(teacher.teacher_name)}</option>`).join("");
      teacherSelect.value = state.selected.teacherId;
    }
    const courses = sortCourses(state.courses.filter((course) => course.teacher_id === state.selected.teacherId));
    const courseSelect = qs("#teacherCourseSelect");
    if (courseSelect) {
      courseSelect.innerHTML = courses.map((course) => `<option value="${esc(course.course_id)}">${esc(courseShort(course))} ${esc(course.date)}</option>`).join("");
      if (!courses.some((course) => course.course_id === state.selected.teacherCourseId)) state.selected.teacherCourseId = courses[0]?.course_id || "";
      courseSelect.value = state.selected.teacherCourseId;
    }
  }

  function renderTeacherCourses() {
    const todayOnly = qs("#todayOnlyToggle")?.checked;
    const courses = sortCourses(state.courses.filter((course) => course.teacher_id === state.selected.teacherId && (!todayOnly || course.date === APP_DATE)));
    qs("#teacherCourseList").innerHTML = courses
      .map((course) => {
        const rows = courseStudentIds(course.course_id).map((studentId) => attendanceFor(studentId, course.course_id, true));
        const checked = rows.filter((row) => row.checkin_status === "入室済").length;
        return renderCourseCard(course, {
          extra: `<div class="status-row"><span class="chip green">入室 ${checked}/${rows.length}</span></div>`,
          actions: `<button class="small primary" type="button" data-teacher-course="${esc(course.course_id)}">授業中管理</button>${materialsButton(course)}`,
          selected: course.course_id === state.selected.teacherCourseId,
        });
      })
      .join("") || '<div class="notice">表示対象の講座はありません。</div>';
  }

  function currentTeacherCourse() {
    return courseById(state.selected.teacherCourseId) || state.courses.find((course) => course.teacher_id === state.selected.teacherId);
  }

  function renderTeacherClass() {
    const course = currentTeacherCourse();
    if (!course) return;
    const rows = courseStudentIds(course.course_id).map((studentId) => ({
      student: studentById(studentId),
      attendance: attendanceFor(studentId, course.course_id, true),
    }));
    qs("#teacherClassSummary").innerHTML = [
      metric("対象者", rows.length),
      metric("入室済", rows.filter((row) => row.attendance.checkin_status === "入室済").length),
      metric("未入室", rows.filter((row) => row.attendance.checkin_status === "未入室").length),
      metric("欠席", rows.filter((row) => row.attendance.checkin_status === "欠席").length),
    ].join("");
    qs("#teacherAttendanceRows").innerHTML = rows
      .map(({ student, attendance }) => `<tr><td>${esc(student?.display_name || attendance.student_id)}</td><td><span class="chip ${statusColor(attendance.checkin_status)}">${esc(attendance.checkin_status)}</span></td><td>${esc(attendance.exception_note || "-")}</td></tr>`)
      .join("");
    qs("#teacherLateStudent").innerHTML = rows.map(({ student, attendance }) => `<option value="${esc(attendance.student_id)}">${esc(student?.display_name || attendance.student_id)}</option>`).join("");
    renderTeacherNotes();
    const materials = materialsList(course);
    const materialsSummary = materials.length
      ? itemHtml("本日の配布物", esc(materials.join(" / ")), `<button class="small" type="button" data-course-materials="${esc(course.course_id)}">配布物一覧</button>`)
      : '<div class="notice">この講座に登録された配布物はありません。</div>';
    const absenteeRows = rows
      .filter(({ attendance }) => attendance.checkin_status !== "入室済")
      .map(({ student, attendance }) => {
        const done = materialHandoverDone(attendance.student_id, course.course_id);
        return itemHtml(
          esc(student?.display_name || attendance.student_id),
          `${esc(student?.school || "高校未登録")} / ${esc(attendance.checkin_status)} / 配布物: ${done ? "受渡済" : "未渡し"}`,
          done ? '<span class="chip green">受渡済</span>' : '<span class="chip amber">要リマインド</span>'
        );
      })
      .join("") || '<div class="notice green">欠席者・未入室者はいません。</div>';
    qs("#teacherMaterialsRows").innerHTML = `${materialsSummary}${absenteeRows}`;
  }

  function renderTeacherNotes() {
    const course = currentTeacherCourse();
    const notes = state.teacherNotes.filter((note) => note.course_id === course?.course_id);
    qs("#teacherNoteRows").innerHTML = notes
      .filter((note) => note.note_type !== "次回メモ")
      .map((note) => itemHtml(esc(note.note_type), `${esc(studentName(note.student_id))} / ${esc(note.content)} / ${esc(note.created_at)}`, note.shared_to_staff === "yes" ? '<span class="chip green">共有済</span>' : '<span class="chip amber">未共有</span>'))
      .join("") || '<div class="notice">授業中メモはありません。</div>';
  }

  function saveTeacherNote() {
    const course = currentTeacherCourse();
    if (!course) return;
    const note = {
      note_id: makeId("NOTE-V2"),
      teacher_id: state.selected.teacherId,
      course_id: course.course_id,
      note_type: qs("#teacherLateType").value,
      student_id: qs("#teacherLateStudent").value,
      content: qs("#teacherLateContent").value.trim(),
      shared_to_staff: "yes",
      status: "共有済",
      created_at: nowStamp(),
    };
    state.teacherNotes.unshift(note);
    addAction({
      role: "teacher",
      actor: state.selected.teacherId,
      action_type: "授業中メモ",
      target_type: "course",
      target_id: course.course_id,
      after_value: note.status,
      reason: note.content,
    });
    saveState();
    renderTeacher();
    showToast("メモを保存しました。");
  }

  function renderTeacherReview() {
    const course = currentTeacherCourse();
    if (!course) return;
    renderSurveyTrend(qs("#teacherSurveySummary"), course.course_id);
    qs("#teacherTrendPanel").innerHTML = state.surveys
      .filter((survey) => survey.course_id === course.course_id && survey.status === "提出済")
      .map((survey) => itemHtml(esc(studentName(survey.student_id)), `${esc(survey.comment)}<br>満足度 ${esc(survey.satisfaction)} / 難易度 ${esc(survey.difficulty)} / 理解度 ${esc(survey.understanding)}`, survey.consultation === "yes" ? '<span class="chip amber">相談希望</span>' : '<span class="chip green">通常</span>'))
      .join("") || '<div class="notice">提出済み回答はありません。</div>';
    qs("#teacherReviewNotes").innerHTML = state.teacherNotes
      .filter((note) => note.course_id === course.course_id && note.note_type === "次回メモ")
      .map((note) => itemHtml(esc(note.created_at), esc(note.content), note.shared_to_staff === "yes" ? '<span class="chip green">共有済</span>' : '<span class="chip amber">下書き</span>'))
      .join("") || '<div class="notice">次回メモはありません。</div>';
  }

  function saveTeacherNextMemo() {
    const course = currentTeacherCourse();
    if (!course) return;
    const content = qs("#teacherNextMemo").value.trim();
    state.teacherNotes.unshift({
      note_id: makeId("NOTE-V2"),
      teacher_id: state.selected.teacherId,
      course_id: course.course_id,
      note_type: "次回メモ",
      student_id: "",
      content,
      shared_to_staff: "no",
      status: "下書き",
      created_at: nowStamp(),
    });
    addAction({
      role: "teacher",
      actor: state.selected.teacherId,
      action_type: "次回メモ",
      target_type: "course",
      target_id: course.course_id,
      after_value: "下書き",
      reason: content,
    });
    saveState();
    renderTeacher();
    showToast("次回メモを保存しました。");
  }

  function studentPeriodSummary(studentId) {
    let attended = 0;
    let planned = 0;
    studentCourses(studentId).forEach((course) => {
      planned += numberValue(course.period_count);
      const attendance = attendanceFor(studentId, course.course_id);
      if (attendance?.checkin_status === "入室済") attended += numberValue(course.period_count);
    });
    return { attended, planned };
  }

  function pastAttendanceSummary(studentId) {
    let present = 0;
    let absent = 0;
    studentCourses(studentId).forEach((course) => {
      if (course.date >= APP_DATE) return;
      const attendance = attendanceFor(studentId, course.course_id);
      if (!attendance) return;
      if (attendance.checkin_status === "入室済") present += 1;
      else absent += 1;
    });
    return { present, absent };
  }

  function studentRosterFlags(studentId, attendance, course) {
    const flags = [];
    const student = studentById(studentId);
    if (computeShortages().some((row) => row.student_id === studentId)) flags.push({ label: "基準未達", color: "red" });
    if (course && !isEnrolled(studentId, course.course_id)) flags.push({ label: "未申込打刻", color: "red" });
    if (attendance?.method === "代理") flags.push({ label: "代理入室", color: "amber" });
    const past = pastAttendanceSummary(studentId);
    if (past.absent >= 1) flags.push({ label: `過去欠席${past.absent}`, color: "amber" });
    const pendingSurvey = studentCourses(studentId).some(
      (item) => item.date === APP_DATE && item.survey_required === "yes" && surveyWindow(item, surveyFor(studentId, item.course_id)) === "回答受付中"
    );
    if (pendingSurvey) flags.push({ label: "アンケート未回答", color: "amber" });
    if (student && student.line_status !== "登録済") flags.push({ label: "LINE未登録", color: "" });
    return flags;
  }

  let tabletAuthed = false;

  function bindTabletOnce() {
    qs("#tabletLoginButton")?.addEventListener("click", () => {
      const id = qs("#tabletAdminId")?.value.trim();
      const pw = qs("#tabletAdminPw")?.value.trim();
      const err = qs("#tabletLoginError");
      if (id === "admin" && pw === "admin1234") {
        tabletAuthed = true;
        if (err) err.classList.add("is-hidden");
        renderTablet();
      } else if (err) {
        err.textContent = "管理者IDまたはパスワードが違います。";
        err.classList.remove("is-hidden");
      }
    });
    qs("#tabletLogout")?.addEventListener("click", () => {
      tabletAuthed = false;
      renderTablet();
    });
    qs("#tabletVenueSelect")?.addEventListener("change", (event) => {
      state.selected.tabletVenue = event.target.value;
      state.selected.tabletCourseId = "";
      state.selected.tabletStudentId = "";
      saveState();
      renderTablet();
    });
    qs("#tabletCourseSelect")?.addEventListener("change", (event) => {
      state.selected.tabletCourseId = event.target.value;
      state.selected.tabletStudentId = "";
      saveState();
      renderTablet();
    });
    qs("#tabletScanStudent")?.addEventListener("change", (event) => {
      state.selected.tabletStudentId = event.target.value;
      saveState();
    });
    qs("#tabletScanButton")?.addEventListener("click", registerTabletCheckin);
    window.addEventListener("storage", (event) => {
      if (event.key !== STORAGE_KEY) return;
      const next = loadStoredState();
      if (next) {
        state = next;
        setSelectedDefaults();
        renderTablet();
      }
    });
  }

  function renderTabletSelectors() {
    const venues = [...new Set(state.courses.map((course) => course.venue))];
    const venueSelect = qs("#tabletVenueSelect");
    if (venueSelect) {
      venueSelect.innerHTML = venues.map((venue) => `<option>${esc(venue)}</option>`).join("");
      venueSelect.value = state.selected.tabletVenue;
    }
    const venue = state.selected.tabletVenue;
    const courses = sortCourses(state.courses.filter((course) => course.venue === venue && course.date === APP_DATE));
    const courseSelect = qs("#tabletCourseSelect");
    if (courseSelect) {
      courseSelect.innerHTML = courses
        .map((course) => `<option value="${esc(course.course_id)}">${esc(courseShort(course))} ${esc(course.start_time)}</option>`)
        .join("") || `<option value="">本日の講座なし</option>`;
      if (!courses.some((course) => course.course_id === state.selected.tabletCourseId)) state.selected.tabletCourseId = courses[0]?.course_id || "";
      courseSelect.value = state.selected.tabletCourseId;
    }
    const course = courseById(state.selected.tabletCourseId);
    const studentSelect = qs("#tabletScanStudent");
    if (studentSelect) {
      const students = (course ? courseStudentIds(course.course_id) : []).map((id) => studentById(id)).filter(Boolean);
      studentSelect.innerHTML = students
        .map((student) => `<option value="${esc(student.student_id)}">${esc(student.display_name)} / ${esc(student.grade)} / ${esc(studentNumber(student))}</option>`)
        .join("") || `<option value="">対象生徒なし</option>`;
      if (!students.some((student) => student.student_id === state.selected.tabletStudentId)) state.selected.tabletStudentId = students[0]?.student_id || "";
      studentSelect.value = state.selected.tabletStudentId;
    }
  }

  function registerTabletCheckin() {
    const courseId = qs("#tabletCourseSelect")?.value || state.selected.tabletCourseId;
    const studentId = qs("#tabletScanStudent")?.value || state.selected.tabletStudentId;
    const course = courseById(courseId);
    const student = studentById(studentId);
    if (!course) {
      showToast("読取対象の講座を選択してください。");
      return;
    }
    if (!student) {
      tabletLastResult = '<div class="notice red"><strong>エラー</strong>：QRを読み取れませんでした。もう一度かざしてください。</div>';
      renderTablet();
      return;
    }
    if (!isEnrolled(studentId, courseId) || course.status === "cancelled") {
      const reason = course.status === "cancelled" ? "この講座は休講です" : "この講座の申込が確認できません";
      tabletLastResult = `<div class="notice red"><strong>エラー：登録できません</strong><br>${esc(student.display_name)} / ${esc(courseShort(course))}<br>${esc(reason)}。校舎スタッフにお声がけください。</div>`;
      renderTablet();
      showToast("エラー：登録できませんでした。");
      return;
    }
    const attendance = attendanceFor(studentId, courseId, true);
    const before = attendance.checkin_status;
    if (before === "入室済") {
      tabletLastResult = `<div class="notice amber"><strong>すでに入室済みです</strong><br>${esc(student.display_name)} / ${esc(courseShort(course))}</div>`;
      renderTablet();
      return;
    }
    attendance.checkin_status = "入室済";
    attendance.checkin_time = attendance.checkin_time || (course.start_time > "15:00" ? course.start_time : nowStamp().slice(11));
    attendance.method = "校舎QR";
    attendance.confirmed_status = "未確認";
    addAction({
      role: "staff",
      actor: `tablet-${state.selected.tabletVenue || ""}`,
      action_type: "校舎QR入室",
      target_type: "attendance",
      target_id: attendance.attendance_id,
      before_value: before,
      after_value: "入室済",
      reason: "校舎タブレットで生徒提示QRを読取",
    });
    tabletLastResult = `<div class="notice green"><strong>登録完了</strong><br>${esc(student.display_name)} さん（${esc(student.grade)}）<br>${esc(courseShort(course))}<br>入室を受け付けました。</div>`;
    saveState();
    renderTablet();
    showToast(`${student.display_name} を入室登録しました。`);
  }

  function renderTablet() {
    qs("#tabletLogin")?.classList.toggle("is-hidden", tabletAuthed);
    qs("#tabletScanner")?.classList.toggle("is-hidden", !tabletAuthed);
    if (!tabletAuthed) return;
    renderTabletSelectors();
    const result = qs("#tabletReadResult");
    if (result) {
      result.innerHTML = tabletLastResult || '<div class="notice">講座を選び、生徒の提示QRを読み取ると、登録結果がここに大きく表示されます。</div>';
    }
  }

  async function init() {
    bindCommonEvents();
    const initial = await buildInitialState();
    state = loadStoredState() || initial;
    setSelectedDefaults();
    const app = document.body.dataset.app;
    if (app === "student-v2") bindStudentOnce();
    if (app === "staff-v2") bindStaffOnce();
    if (app === "teacher-v2") bindTeacherOnce();
    if (app === "tablet-v2") bindTabletOnce();
    renderApp();
    showStartupNotices();
  }

  document.addEventListener("DOMContentLoaded", () => {
    init().catch((error) => {
      const message = `v2アプリの読み込みに失敗しました: ${error.message}`;
      document.body.insertAdjacentHTML("afterbegin", `<div class="notice red">${esc(message)}</div>`);
    });
  });
})();
