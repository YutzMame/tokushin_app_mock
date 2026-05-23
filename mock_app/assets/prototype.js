(function () {
  const CSV_FILES = [
    "students.csv",
    "courses.csv",
    "course_changes.csv",
    "attendance.csv",
    "survey_responses.csv",
    "course_counts.csv",
    "thresholds.csv",
    "mock_scores.csv",
  ];

  const state = {
    data: {},
    studentId: "STU-014",
    courseId: "C-20260523-JPN-O",
    date: "2026-05-23",
    showPastSurveys: false,
    staffVenue: "御茶ノ水",
    staffCourseId: "C-20260523-JPN-O",
    staffQrCourseId: "C-20260523-JPN-O",
  };

  function qs(selector, root = document) {
    return root.querySelector(selector);
  }

  function qsa(selector, root = document) {
    return Array.from(root.querySelectorAll(selector));
  }

  function csvEscape(value) {
    const text = String(value ?? "");
    if (/[",\n]/.test(text)) return `"${text.replaceAll('"', '""')}"`;
    return text;
  }

  function toCsv(rows, columns) {
    const header = columns.join(",");
    const body = rows.map((row) => columns.map((column) => csvEscape(row[column])).join(","));
    return [header, ...body].join("\n");
  }

  function parseCsv(text) {
    const rows = [];
    let row = [];
    let cell = "";
    let quoted = false;
    for (let i = 0; i < text.length; i += 1) {
      const char = text[i];
      const next = text[i + 1];
      if (quoted) {
        if (char === '"' && next === '"') {
          cell += '"';
          i += 1;
        } else if (char === '"') {
          quoted = false;
        } else {
          cell += char;
        }
      } else if (char === '"') {
        quoted = true;
      } else if (char === ",") {
        row.push(cell);
        cell = "";
      } else if (char === "\n") {
        row.push(cell);
        rows.push(row);
        row = [];
        cell = "";
      } else if (char !== "\r") {
        cell += char;
      }
    }
    if (cell || row.length) {
      row.push(cell);
      rows.push(row);
    }
    const headers = rows.shift() || [];
    return rows
      .filter((items) => items.some((item) => item !== ""))
      .map((items) => Object.fromEntries(headers.map((header, index) => [header, items[index] || ""])));
  }

  async function loadCsv(file) {
    const path = `data/${file}`;
    if (window.__MOCK_CSVS__ && window.__MOCK_CSVS__[path]) {
      return parseCsv(window.__MOCK_CSVS__[path]);
    }
    const response = await fetch(path);
    if (!response.ok) throw new Error(`CSV load failed: ${path}`);
    return parseCsv(await response.text());
  }

  async function loadAll() {
    const entries = await Promise.all(CSV_FILES.map(async (file) => [file, await loadCsv(file)]));
    state.data = Object.fromEntries(entries);
  }

  function byId(rows, key, value) {
    return rows.find((row) => row[key] === value);
  }

  function currentStudent() {
    return byId(state.data["students.csv"], "student_id", state.studentId);
  }

  function currentCourse() {
    return byId(state.data["courses.csv"], "course_id", state.courseId);
  }

  function addDays(dateText, offset) {
    const date = new Date(`${dateText}T00:00:00`);
    date.setDate(date.getDate() + offset);
    return date.toISOString().slice(0, 10);
  }

  function dateLabel(dateText) {
    const date = new Date(`${dateText}T00:00:00`);
    return `${date.getMonth() + 1}/${date.getDate()}`;
  }

  function attendanceFor(studentId = state.studentId, courseId = state.courseId) {
    return state.data["attendance.csv"].find((row) => row.student_id === studentId && row.course_id === courseId);
  }

  function changesForDate(date = state.date) {
    const courses = state.data["courses.csv"].filter((course) => course.date === date);
    const ids = new Set(courses.map((course) => course.course_id));
    return state.data["course_changes.csv"].filter((change) => ids.has(change.course_id));
  }

  function courseById(courseId) {
    return byId(state.data["courses.csv"], "course_id", courseId);
  }

  function countsForStudent(studentId = state.studentId) {
    return state.data["course_counts.csv"].filter((row) => row.student_id === studentId);
  }

  function registeredCourseIds(studentId = state.studentId) {
    return new Set(state.data["attendance.csv"].filter((row) => row.student_id === studentId).map((row) => row.course_id));
  }

  function studentCourses(studentId = state.studentId) {
    const ids = registeredCourseIds(studentId);
    return state.data["courses.csv"].filter((course) => ids.has(course.course_id));
  }

  function courseGrade(course) {
    return course.grade || "学年共通";
  }

  function courseMeta(course) {
    return `${courseGrade(course)} / ${course.subject} / ${course.venue} / ${course.room}教室 / ${course.period_count}コマ`;
  }

  function courseTimeMeta(course) {
    return `${course.date} ${course.start_time}-${course.end_time} / ${courseMeta(course)}`;
  }

  function courseOptionLabel(course) {
    return `${course.date} ${course.start_time} ${courseGrade(course)} ${course.room}教室 ${course.course_name}`;
  }

  function courseSortKey(course) {
    return `${course.date}${course.start_time}${course.venue}${course.room}${courseGrade(course)}${course.course_id}`;
  }

  function coursesForDate(date, studentOnly = false) {
    const courses = studentOnly
      ? studentCourses()
      : state.data["courses.csv"].filter((course) => !state.staffVenue || course.venue === state.staffVenue);
    return courses
      .filter((course) => course.date === date)
      .sort((a, b) => courseSortKey(a).localeCompare(courseSortKey(b)));
  }

  function staffVenues() {
    return Array.from(new Set(state.data["courses.csv"].map((course) => course.venue))).sort();
  }

  function staffCourses() {
    return state.data["courses.csv"]
      .filter((course) => course.venue === state.staffVenue)
      .sort((a, b) => courseSortKey(a).localeCompare(courseSortKey(b)));
  }

  function ensureStaffCourse() {
    const courses = staffCourses();
    if (!courses.some((course) => course.course_id === state.staffCourseId)) {
      state.staffCourseId = courses[0]?.course_id || "";
    }
    return courseById(state.staffCourseId);
  }

  function staffAttendanceRows() {
    ensureStaffCourse();
    return state.data["attendance.csv"].filter((row) => row.course_id === state.staffCourseId);
  }

  function staffChangeRows() {
    const courseIds = new Set(staffCourses().map((course) => course.course_id));
    return state.data["course_changes.csv"].filter((change) => courseIds.has(change.course_id));
  }

  function thresholdFor(student, subject) {
    return state.data["thresholds.csv"].find(
      (row) => row.grade === student.grade && row.term === "第1期" && row.subject === subject
    );
  }

  function statusChip(status) {
    if (["済", "入室済", "提出済", "退室済", "登録済", "active", "通常", "回答受付中"].includes(status)) return "green";
    if ([
      "未",
      "未入室",
      "未提出",
      "未退室",
      "LINE未配信",
      "校舎確認中",
      "回答受付開始前",
      "room_changed",
      "rescheduled",
      "time_changed",
      "teacher_changed",
      "教室変更",
      "日程変更",
      "時間変更",
      "講師変更",
    ].includes(status)) return "amber";
    if (["休講", "cancelled", "要確認"].includes(status)) return "red";
    return "blue";
  }

  function courseStatusLabel(status) {
    return {
      active: "通常",
      room_changed: "教室変更",
      cancelled: "休講",
      rescheduled: "日程変更",
      time_changed: "時間変更",
      teacher_changed: "講師変更",
    }[status] || status;
  }

  function studentCourseStatusLabel(status) {
    return {
      active: "通常",
      room_changed: "通常",
      teacher_changed: "通常",
      cancelled: "休講",
      rescheduled: "日程変更",
    }[status] || status;
  }

  function setText(id, value) {
    const el = qs(`#${id}`);
    if (el) el.textContent = value;
  }

  function renderSubjectBars(containerId, studentId, showThresholds) {
    const container = qs(`#${containerId}`);
    if (!container) return;
    const student = byId(state.data["students.csv"], "student_id", studentId);
    const rows = countsForStudent(studentId);
    const max = Math.max(...rows.map((row) => Number(row.planned_periods || row.attended_periods || 1)), 1);
    container.innerHTML = rows
      .map((row) => {
        const attended = Number(row.attended_periods);
        const planned = Number(row.planned_periods);
        const threshold = thresholdFor(student, row.subject);
        const below = threshold && attended < Number(threshold.threshold_periods);
        const label = showThresholds && threshold ? ` / 基準${threshold.threshold_periods}` : "";
        return `
          <div class="subject-row ${below && showThresholds ? "is-alert" : ""}">
            <div>
              <strong>${row.subject}</strong>
              <span class="meta">${attended} / ${planned} コマ${label}</span>
            </div>
            <div class="progress"><span style="width:${Math.min(100, (attended / max) * 100)}%"></span></div>
            ${showThresholds && below ? '<span class="chip amber">要声かけ</span>' : ""}
          </div>
        `;
      })
      .join("");
  }

  function renderDayStrip(containerId, studentOnly) {
    const container = qs(`#${containerId}`);
    if (!container) return;
    const specs = [
      ["昨日", addDays(state.date, -1), ""],
      ["今日", state.date, "today"],
      ["明日", addDays(state.date, 1), ""],
    ];
    container.innerHTML = specs
      .map(([label, date, klass]) => {
        const courses = coursesForDate(date, studentOnly);
        const main = courses[0];
        return `
          <div class="day-card ${klass}">
            <div class="row">
              <strong>${label} ${dateLabel(date)}</strong>
              <span class="chip ${courses.length ? "blue" : ""}">${courses.length}件</span>
            </div>
            <p class="meta">${main ? `${main.start_time} ${courseGrade(main)} ${main.course_name} / ${main.room}教室` : "登録講座なし"}</p>
            <button class="secondary" type="button" data-jump-date="${date}">カレンダーで見る</button>
          </div>
        `;
      })
      .join("");
    qsa("[data-jump-date]", container).forEach((button) => {
      button.addEventListener("click", () => {
        const target = qs(`[data-calendar-date="${button.dataset.jumpDate}"]`);
        target?.scrollIntoView({ behavior: "smooth", block: "center" });
        target?.classList.add("today");
        if (studentOnly) renderStudentSelectedDay(button.dataset.jumpDate);
      });
    });
  }

  function attendanceDoneLabel(attendance) {
    return attendance?.checkin_status === "入室済" ? "済" : "未";
  }

  function surveyDoneLabel(attendance) {
    return attendance?.survey_status === "提出済" ? "済" : "未";
  }

  function courseChangeFor(courseId) {
    return state.data["course_changes.csv"].find((change) => change.course_id === courseId);
  }

  function renderStudentCourseActions(course) {
    const attendance = attendanceFor(state.studentId, course.course_id);
    const surveyWindow = surveyWindowFor(course, attendance);
    const checkinLabel = attendanceDoneLabel(attendance);
    const surveyLabel = surveyDoneLabel(attendance);
    const disabled = course.status === "cancelled" ? "disabled" : "";
    const label = studentCourseStatusLabel(course.status);
    return `
      <div class="course-action-card">
        <div class="row">
          <strong>${course.start_time} ${course.course_name}</strong>
          <span class="chip ${statusChip(label)}">${label}</span>
        </div>
        <p class="meta">${courseTimeMeta(course)}</p>
        <div class="status-pair">
          <span>出席登録 <strong class="chip ${statusChip(checkinLabel)}">${checkinLabel}</strong></span>
          <span>アンケート <strong class="chip ${statusChip(surveyLabel)}">${surveyLabel}</strong></span>
        </div>
        <div class="actions">
          <button class="secondary" type="button" data-student-checkin="${course.course_id}" ${disabled}>出席登録へ</button>
          <button class="primary" type="button" data-student-survey="${course.course_id}" ${surveyWindow !== "回答受付中" ? "disabled" : ""}>アンケート回答へ</button>
        </div>
      </div>
    `;
  }

  function surveyWindowFor(course, attendance) {
    if (attendance?.survey_status === "提出済") return "回答受付終了";
    if (course.status === "cancelled") return "回答受付終了";
    if (course.date < state.date) return "回答受付終了";
    if (course.date > state.date) return "回答受付開始前";
    if (course.start_time > "16:30") return "回答受付開始前";
    return "回答受付中";
  }

  function renderStudentTodayCourses() {
    const container = qs("#studentTodayCourses");
    if (!container) return;
    const courses = coursesForDate(state.date, true);
    container.innerHTML = courses.length
      ? courses.map((course) => renderStudentCourseActions(course)).join("")
      : '<div class="notice">本日の登録講座はありません。</div>';
    bindStudentCourseActions(container);
  }

  function renderStudentSurveyList() {
    const container = qs("#studentSurveyList");
    if (!container) return;
    const todayCourses = coursesForDate(state.date, true);
    const pastCourses = studentCourses()
      .filter((course) => course.date < state.date)
      .sort((a, b) => `${b.date}${b.start_time}`.localeCompare(`${a.date}${a.start_time}`));
    const courses = state.showPastSurveys ? [...todayCourses, ...pastCourses] : todayCourses;
    container.innerHTML = courses.length
      ? courses
      .map((course) => {
        const attendance = attendanceFor(state.studentId, course.course_id);
        const surveyWindow = surveyWindowFor(course, attendance);
        const surveyLabel = surveyDoneLabel(attendance);
        const buttonLabel = surveyLabel === "済" ? "回答済" : "この講座に回答";
        return `
          <div class="course-action-card">
            <div class="row">
              <strong>${course.course_name}</strong>
              <span class="chip ${statusChip(surveyWindow)}">${surveyWindow}</span>
            </div>
            <p class="meta">${courseTimeMeta(course)}</p>
            <div class="status-pair">
              <span>出席登録 <strong class="chip ${statusChip(attendanceDoneLabel(attendance))}">${attendanceDoneLabel(attendance)}</strong></span>
              <span>アンケート <strong class="chip ${statusChip(surveyLabel)}">${surveyLabel}</strong></span>
            </div>
            <button class="secondary" type="button" data-student-survey="${course.course_id}" ${surveyWindow !== "回答受付中" ? "disabled" : ""}>${buttonLabel}</button>
          </div>
        `;
      })
      .join("")
      : '<div class="notice">本日の回答対象はありません。</div>';
    bindStudentCourseActions(container);
  }

  function selectSurveyCourse(courseId) {
    const course = courseById(courseId);
    const attendance = attendanceFor(state.studentId, courseId);
    state.courseId = courseId;
    const surveyWindow = surveyWindowFor(course, attendance);
    setText("selectedSurveyCourse", course.course_name);
    setText("selectedSurveyStatus", surveyWindow);
    qs("#selectedSurveyStatus").className = `chip ${statusChip(surveyWindow)}`;
    setText("selectedSurveyMeta", courseTimeMeta(course));
  }

  function showSurveyForm(courseId) {
    selectSurveyCourse(courseId);
    qs("#surveyListPanel")?.classList.add("is-hidden");
    qs("#surveyFormPanel")?.classList.remove("is-hidden");
  }

  function showSurveyList() {
    qs("#surveyListPanel")?.classList.remove("is-hidden");
    qs("#surveyFormPanel")?.classList.add("is-hidden");
  }

  function bindStudentCourseActions(root) {
    qsa("[data-student-checkin]", root).forEach((button) => {
      button.addEventListener("click", () => {
        state.courseId = button.dataset.studentCheckin;
        renderStudentCourseContext();
        qsa("[data-tab-target]").find((item) => item.dataset.tabTarget === "checkin")?.click();
      });
    });
    qsa("[data-student-survey]", root).forEach((button) => {
      button.addEventListener("click", () => {
        showSurveyForm(button.dataset.studentSurvey);
        qsa("[data-tab-target]").find((item) => item.dataset.tabTarget === "survey")?.click();
      });
    });
  }

  function renderCalendar(containerId, studentOnly) {
    const container = qs(`#${containerId}`);
    if (!container) return;
    const year = 2026;
    const month = 4;
    const first = new Date(year, month, 1);
    const startDay = first.getDay();
    const daysInMonth = new Date(year, month + 1, 0).getDate();
    const headers = ["日", "月", "火", "水", "木", "金", "土"].map((day) => `<div class="calendar-head">${day}</div>`);
    const blanks = Array.from({ length: startDay }, () => '<div class="calendar-day"></div>');
    const days = Array.from({ length: daysInMonth }, (_, index) => {
      const day = index + 1;
      const date = `${year}-05-${String(day).padStart(2, "0")}`;
      const courses = coursesForDate(date, studentOnly);
      const hasCancelled = courses.some((course) => course.status === "cancelled");
      const klass = [
        courses.length ? "has-course" : "",
        date === state.date ? "today" : "",
        hasCancelled ? "cancelled" : "",
      ].join(" ");
      return `
        <div class="calendar-day ${klass}" data-calendar-date="${date}">
          <span class="calendar-date">${day}</span>
          ${courses.length ? `<span class="calendar-dot">${courses.length}</span>` : ""}
          <p class="meta">${courses[0] ? `${courses[0].start_time} ${courseGrade(courses[0])}` : ""}</p>
        </div>
      `;
    });
    container.innerHTML = [...headers, ...blanks, ...days].join("");
    qsa("[data-calendar-date]", container).forEach((day) => {
      day.addEventListener("click", () => {
        if (studentOnly) renderStudentSelectedDay(day.dataset.calendarDate);
        else renderSelectedDay(day.dataset.calendarDate);
      });
    });
  }

  function renderStudentSelectedDay(date = state.date) {
    const container = qs("#studentSelectedDay");
    if (!container) return;
    const courses = coursesForDate(date, true);
    container.innerHTML = courses.length
      ? courses.map((course) => renderStudentCourseActions(course)).join("")
      : '<div class="notice">この日の登録講座はありません。</div>';
    bindStudentCourseActions(container);
  }

  function renderSelectedDay(date = state.date) {
    const container = qs("#staffSelectedDay");
    if (!container) return;
    const courses = coursesForDate(date, false);
    container.innerHTML = courses.length
      ? courses
          .map((course) => `
            <div class="change-card">
              <div class="row">
                <strong>${course.start_time} ${course.course_name}</strong>
                <span class="chip ${statusChip(course.status)}">${courseStatusLabel(course.status)}</span>
              </div>
              <p class="meta">${courseMeta(course)}</p>
            </div>
          `)
          .join("")
      : '<div class="notice">この日の講座予定はありません。</div>';
  }

  function activateTabs(root = document) {
    qsa("[data-tab-target]", root).forEach((button) => {
      button.addEventListener("click", () => {
        const target = button.dataset.tabTarget;
        qsa("[data-tab-target]", root).forEach((item) => item.classList.toggle("active", item === button));
        qsa("[data-tab-panel]", root).forEach((panel) => panel.classList.toggle("active", panel.dataset.tabPanel === target));
      });
    });
  }

  function renderStudentCourseContext() {
    const course = currentCourse();
    const attendance = attendanceFor();
    if (!course || !attendance) return;
    const checkinLabel = attendanceDoneLabel(attendance);
    setText("checkinCourseName", course.course_name);
    setText("checkinCourseMeta", courseTimeMeta(course));
    setText("checkinCourseStatus", `出席登録 ${checkinLabel}`);
    const status = qs("#checkinCourseStatus");
    if (status) status.className = `chip ${statusChip(checkinLabel)}`;
  }

  function renderStudent() {
    const student = currentStudent();
    const course = currentCourse();
    setText("studentName", student.display_name);
    setText("studentVenue", `${student.venue} / ${student.grade}`);
    setText("todayCourseName", course.course_name);
    setText("todayCourseMeta", courseTimeMeta(course));
    renderStudentCourseContext();
    renderSubjectBars("studentSubjectBars", state.studentId, false);
    renderTodayChanges("studentChanges", false);
    renderStudentTodayCourses();
    renderStudentSurveyList();
    renderDayStrip("studentDayStrip", true);
    renderCalendar("studentCalendar", true);
    renderStudentSelectedDay(state.date);
    selectSurveyCourse(state.courseId);
  }

  function renderStudentPassCourseList() {
    const container = qs("#passCourseList");
    if (!container) return;
    const courses = coursesForDate(state.date, true);
    container.innerHTML = courses.length
      ? courses
          .map((course) => {
            const attendance = attendanceFor(state.studentId, course.course_id);
            return `
              <div class="course-action-card ${course.course_id === state.courseId ? "selected-card" : ""}">
                <div class="row">
                  <strong>${course.start_time} ${course.course_name}</strong>
                  <span class="chip ${statusChip(attendanceDoneLabel(attendance))}">出席${attendanceDoneLabel(attendance)}</span>
                </div>
                <p class="meta">${courseTimeMeta(course)}</p>
                <button class="secondary" type="button" data-pass-course="${course.course_id}">この講座のQRを表示</button>
              </div>
            `;
          })
          .join("")
      : '<div class="notice">本日の登録講座はありません。</div>';
    qsa("[data-pass-course]", container).forEach((button) => {
      button.addEventListener("click", () => {
        state.courseId = button.dataset.passCourse;
        renderStudentPass();
      });
    });
  }

  function renderStudentPass() {
    const student = currentStudent();
    const course = currentCourse();
    const attendance = attendanceFor();
    setText("passStudentName", student.display_name);
    setText("passStudentVenue", `${student.venue} / ${student.grade}`);
    setText("passCourseName", course.course_name);
    setText("passCourseMeta", courseTimeMeta(course));
    setText("passCourseStatus", `出席登録 ${attendanceDoneLabel(attendance)}`);
    qs("#passCourseStatus").className = `chip ${statusChip(attendanceDoneLabel(attendance))}`;
    setText("passQrLabel", `${state.studentId} / ${course.course_id}`);
    renderStudentPassCourseList();
  }

  function renderTodayChanges(containerId, staffMode, allChanges = false) {
    const container = qs(`#${containerId}`);
    if (!container) return;
    let changes = allChanges ? state.data["course_changes.csv"] : changesForDate();
    if (staffMode) {
      const courseIds = new Set(staffCourses().map((course) => course.course_id));
      changes = changes.filter((change) => courseIds.has(change.course_id));
    } else {
      changes = changes.filter((change) => ["休講", "日程変更"].includes(change.change_type));
    }
    if (!changes.length) {
      container.innerHTML = '<div class="notice">本日の講座変更はありません。</div>';
      return;
    }
    container.innerHTML = changes
      .map((change) => {
        const course = courseById(change.course_id);
        return `
          <div class="change-card">
            <div class="row">
              <strong>${change.change_type}: ${course.course_name}</strong>
              <span class="chip ${statusChip(change.change_type)}">${change.change_type}</span>
            </div>
            <p class="meta">${course.date} ${course.start_time}-${course.end_time} / ${courseGrade(course)} / ${course.venue} / ${course.room}教室</p>
            <p class="meta">${change.before_value} → ${change.after_value} / ${change.reason}</p>
            ${staffMode ? `<p class="meta">影響人数: ${change.affected_students}人 / 更新: ${change.updated_at}</p>` : ""}
          </div>
        `;
      })
      .join("");
  }

  function initStudent() {
    renderStudent();
    activateTabs();

    qsa("[data-choice-group]").forEach((group) => {
      group.addEventListener("click", (event) => {
        const button = event.target.closest("button");
        if (!button) return;
        qsa("button", group).forEach((item) => item.classList.remove("selected"));
        button.classList.add("selected");
      });
    });

    qs("#scanButton")?.addEventListener("click", () => {
      const attendance = attendanceFor();
      attendance.checkin_status = "入室済";
      attendance.checkin_time = "15:00";
      attendance.method = "QR";
      renderStudent();
      setText("checkinDoneText", "入室済みです。授業終了後にアンケートへ進んでください。");
      qs("#checkinDoneText").className = "notice";
    });

    qs("#togglePastSurveys")?.addEventListener("click", () => {
      state.showPastSurveys = !state.showPastSurveys;
      setText("togglePastSurveys", state.showPastSurveys ? "過去分を隠す" : "過去分を表示");
      renderStudentSurveyList();
    });

    qs("#backToSurveyList")?.addEventListener("click", () => {
      showSurveyList();
    });

    qs("#submitSurvey")?.addEventListener("click", () => {
      const attendance = attendanceFor();
      attendance.checkout_status = "退室済";
      attendance.survey_status = "提出済";
      state.data["survey_responses.csv"].push({
        response_id: "RES-DEMO",
        student_id: state.studentId,
        course_id: state.courseId,
        satisfaction: qs("[data-choice-group='satisfaction'] .selected")?.textContent || "4",
        difficulty: qs("[data-choice-group='difficulty'] .selected")?.textContent || "ちょうどよい",
        understanding: "4",
        comment: qs("#studentComment")?.value || "",
        submitted_at: "2026-05-23 17:10",
      });
      renderStudent();
      showSurveyList();
      setText("surveyDoneText", "アンケートを提出しました。退室手続きは完了です。");
      qs("#surveyDoneText").className = "notice";
    });
  }

  function initStudentPass() {
    renderStudentPass();
    qs("#passReadButton")?.addEventListener("click", () => {
      const attendance = attendanceFor();
      attendance.checkin_status = "入室済";
      attendance.checkin_time = "15:00";
      attendance.method = "校舎読取";
      renderStudentPass();
    });
  }

  function renderStaffStats() {
    const rows = staffAttendanceRows();
    setText("statTarget", rows.length);
    setText("statCheckin", rows.filter((row) => row.checkin_status === "入室済").length);
    setText("statSurvey", rows.filter((row) => row.survey_status === "提出済").length);
    const shortage = getShortageRows(state.staffVenue);
    setText("statShortage", shortage.length);
    setText("statChanges", staffChangeRows().length);
  }

  function getShortageRows(venue = null) {
    return state.data["students.csv"].filter((student) => !venue || student.venue === venue).flatMap((student) => {
      return countsForStudent(student.student_id)
        .map((count) => {
          const threshold = thresholdFor(student, count.subject);
          if (!threshold) return null;
          const attended = Number(count.attended_periods);
          const target = Number(threshold.threshold_periods);
          if (attended >= target) return null;
          return { student, count, target, shortage: target - attended };
        })
        .filter(Boolean);
    });
  }

  function renderAttendanceTable() {
    const tbody = qs("#attendanceRows");
    if (!tbody) return;
    const rows = staffAttendanceRows();
    tbody.innerHTML = rows.length
      ? rows
      .map((row) => {
        const student = byId(state.data["students.csv"], "student_id", row.student_id);
        const course = courseById(row.course_id);
        return `
          <tr>
            <td>${student.display_name}<br><span class="meta">${row.student_id} / ${student.staff_owner}</span></td>
            <td>${course.course_name}<br><span class="meta">${course.date} ${course.start_time} / ${courseGrade(course)} / ${course.room}教室</span></td>
            <td><span class="chip ${statusChip(row.checkin_status)}">${row.checkin_status}</span><br><span class="meta">${row.checkin_time || row.method}</span></td>
            <td><span class="chip ${statusChip(row.survey_status)}">${row.survey_status}</span></td>
            <td>${row.exception_note || "-"}</td>
          </tr>
        `;
      })
      .join("")
      : '<tr><td colspan="5">選択講座の出席対象者がありません。</td></tr>';
  }

  function renderProxyTable() {
    const tbody = qs("#proxyRows");
    if (!tbody) return;
    const rows = staffAttendanceRows();
    tbody.innerHTML = rows.length
      ? rows
          .map((row) => {
            const student = byId(state.data["students.csv"], "student_id", row.student_id);
            const course = courseById(row.course_id);
            return `
              <tr>
                <td>${student.display_name}<br><span class="meta">${row.student_id} / ${student.staff_owner}</span></td>
                <td>${course.course_name}<br><span class="meta">${course.date} ${course.start_time} / ${courseGrade(course)} / ${course.room}教室</span></td>
                <td><span class="chip ${statusChip(row.checkin_status)}">${row.checkin_status}</span><br><span class="meta">${row.exception_note || row.method}</span></td>
                <td><span class="chip ${statusChip(row.survey_status)}">${row.survey_status}</span></td>
                <td>
                  <div class="actions">
                    <button class="secondary" data-proxy="${row.student_id}:${row.course_id}" type="button">代理入室</button>
                    <button class="secondary" data-paper-survey="${row.student_id}:${row.course_id}" type="button">紙回答入力</button>
                  </div>
                </td>
              </tr>
            `;
          })
          .join("")
      : '<tr><td colspan="5">選択講座の対象者がありません。</td></tr>';
    qsa("[data-proxy]").forEach((button) => {
      button.addEventListener("click", () => {
        const [studentId, courseId] = button.dataset.proxy.split(":");
        const row = attendanceFor(studentId, courseId);
        row.checkin_status = "入室済";
        row.method = "代理";
        row.exception_note = "スマホ忘れ受付対応";
        renderStaff();
        showToast("代理入室として反映しました。");
      });
    });
    qsa("[data-paper-survey]").forEach((button) => {
      button.addEventListener("click", () => {
        const [studentId, courseId] = button.dataset.paperSurvey.split(":");
        const row = attendanceFor(studentId, courseId);
        row.survey_status = "提出済";
        row.checkout_status = "退室済";
        row.exception_note = "紙回答を代理入力";
        state.data["survey_responses.csv"].push({
          response_id: `RES-PAPER-${studentId}-${courseId}`,
          student_id: studentId,
          course_id: courseId,
          satisfaction: "4",
          difficulty: "ちょうどよい",
          understanding: "4",
          comment: "紙回答を代理入力",
          submitted_at: "2026-05-23 17:20",
        });
        renderStaff();
        showToast("紙回答として反映しました。");
      });
    });
  }

  function renderCountsTable() {
    const tbody = qs("#countRows");
    if (!tbody) return;
    const shortageRows = getShortageRows(state.staffVenue);
    tbody.innerHTML = shortageRows.length
      ? shortageRows
      .map(({ student, count, target, shortage }) => `
        <tr>
          <td>${student.display_name}<br><span class="meta">${student.student_id} / ${student.staff_owner}</span></td>
          <td>${count.subject}</td>
          <td>${count.attended_periods} / ${count.planned_periods}</td>
          <td>${target}</td>
          <td><span class="chip amber">あと${shortage}コマ</span></td>
          <td><button class="amber" type="button" data-toast="声かけ対象に追加しました。">声かけ</button></td>
        </tr>
      `)
      .join("")
      : '<tr><td colspan="6">選択校舎の基準未達者はありません。</td></tr>';
    bindToastButtons();
  }

  function renderSurveyTable() {
    const tbody = qs("#surveyRows");
    if (!tbody) return;
    const rows = staffAttendanceRows();
    const surveyRows = rows
      .filter((row) => ["未提出", "紙回収待ち", "提出済"].includes(row.survey_status))
      .map((row) => {
        const student = byId(state.data["students.csv"], "student_id", row.student_id);
        const course = courseById(row.course_id);
        const response = state.data["survey_responses.csv"].find((item) => item.student_id === row.student_id && item.course_id === row.course_id);
        return `
          <tr>
            <td>${student.display_name}<br><span class="meta">${student.staff_owner}</span></td>
            <td>${course.course_name}<br><span class="meta">${courseGrade(course)} / ${course.room}教室</span></td>
            <td><span class="chip ${statusChip(row.survey_status)}">${row.survey_status}</span></td>
            <td>${response ? `満足度${response.satisfaction} / ${response.difficulty}` : row.exception_note || "-"}</td>
          </tr>
        `;
      });
    tbody.innerHTML = surveyRows.length
      ? surveyRows.join("")
      : '<tr><td colspan="4">選択講座のアンケート対象者がありません。</td></tr>';
  }

  function renderStaffControls() {
    const venueOptions = staffVenues().map((venue) => `<option value="${venue}">${venue}</option>`).join("");
    ["staffVenueSelect", "staffVenueSetting"].forEach((id) => {
      const select = qs(`#${id}`);
      if (!select) return;
      select.innerHTML = venueOptions;
      select.value = state.staffVenue;
    });
    const courseSelect = qs("#staffCourseSelect");
    if (courseSelect) {
      ensureStaffCourse();
      courseSelect.innerHTML = staffCourses()
        .map((course) => `<option value="${course.course_id}">${courseOptionLabel(course)}</option>`)
        .join("");
      courseSelect.value = state.staffCourseId;
    }
  }

  function beforeValueForChange(course, changeType) {
    if (changeType === "教室変更") return course.room;
    if (changeType === "時間変更") return `${course.start_time}-${course.end_time}`;
    if (changeType === "休講") return `${course.date} ${course.start_time}`;
    if (changeType === "講師変更") return "講師未設定";
    return "";
  }

  function renderCourseChangeManager() {
    const select = qs("#changeCourseSelect");
    if (!select) return;
    ensureStaffCourse();
    select.innerHTML = staffCourses()
      .map((course) => `<option value="${course.course_id}">${courseOptionLabel(course)}</option>`)
      .join("");
    select.value = state.staffCourseId;
  }

  function bindCourseChangeManager() {
    qs("#saveCourseChange")?.addEventListener("click", () => {
      const courseId = qs("#changeCourseSelect")?.value;
      const course = courseById(courseId);
      if (!course) return;
      const changeType = qs("#changeTypeInput")?.value || "教室変更";
      const afterValue = qs("#changeAfterValue")?.value || "";
      const reason = qs("#changeReason")?.value || "運用調整";
      const beforeValue = beforeValueForChange(course, changeType);
      state.data["course_changes.csv"].unshift({
        change_id: `CHG-DEMO-${state.data["course_changes.csv"].length + 1}`,
        course_id: courseId,
        change_type: changeType,
        before_value: beforeValue,
        after_value: afterValue,
        reason,
        announced_status: "",
        affected_students: String(state.data["attendance.csv"].filter((row) => row.course_id === courseId).length),
        updated_at: "2026-05-23 11:30",
      });
      if (changeType === "教室変更") {
        course.room = afterValue;
        course.status = "room_changed";
      }
      if (changeType === "時間変更") {
        const [start, end] = afterValue.split("-");
        if (start) course.start_time = start.trim();
        if (end) course.end_time = end.trim();
        course.status = "time_changed";
      }
      if (changeType === "休講") course.status = "cancelled";
      if (changeType === "講師変更") course.status = "teacher_changed";
      const result = qs("#changeEditResult");
      if (result) {
        result.textContent = `${course.course_name} の${changeType}を画面上に反映しました。`;
        result.classList.remove("is-hidden");
      }
      renderStaff();
      showToast("講座変更を反映しました。");
    });
  }

  function bindStaffControls() {
    ["staffVenueSelect", "staffVenueSetting"].forEach((id) => {
      qs(`#${id}`)?.addEventListener("change", (event) => {
        state.staffVenue = event.target.value;
        state.staffCourseId = staffCourses()[0]?.course_id || "";
        renderStaff();
      });
    });
    qs("#staffCourseSelect")?.addEventListener("change", (event) => {
      state.staffCourseId = event.target.value;
      renderStaff();
    });
  }

  function renderStaffCourseOverview() {
    const container = qs("#staffCourseOverview");
    const course = ensureStaffCourse();
    if (!container || !course) return;
    const rows = staffAttendanceRows();
    const checkedIn = rows.filter((row) => row.checkin_status === "入室済").length;
    const submitted = rows.filter((row) => row.survey_status === "提出済").length;
    const change = courseChangeFor(course.course_id);
    setText("staffQrLabel", `${course.course_id} / ${courseGrade(course)} / ${course.room}教室`);
    container.innerHTML = `
      <div class="row-card">
        <div class="row">
          <strong>${course.course_name}</strong>
          <span class="chip ${statusChip(course.status)}">${courseStatusLabel(course.status)}</span>
        </div>
        <p class="meta">${courseTimeMeta(course)}</p>
        <div class="status-pair">
          <span>入室済 <strong class="chip green">${checkedIn}/${rows.length}</strong></span>
          <span>回答済 <strong class="chip green">${submitted}/${rows.length}</strong></span>
        </div>
      </div>
      ${change ? `<div class="notice amber">${change.change_type}: ${change.before_value} → ${change.after_value}</div>` : ""}
    `;
  }

  function renderSurveyTrends() {
    const container = qs("#surveyTrendPanel");
    if (!container) return;
    const rows = staffAttendanceRows();
    const responses = state.data["survey_responses.csv"].filter((item) => item.course_id === state.staffCourseId);
    const submitted = responses.length;
    const target = rows.length || 1;
    const avg = submitted
      ? (responses.reduce((sum, item) => sum + Number(item.satisfaction || 0), 0) / submitted).toFixed(1)
      : "-";
    const difficulty = ["易しい", "ちょうどよい", "難しい"].map((label) => {
      const count = responses.filter((item) => item.difficulty === label).length;
      return { label, count, pct: submitted ? Math.round((count / submitted) * 100) : 0 };
    });
    container.innerHTML = `
      <div class="row-card">
        <strong>回答率</strong>
        <p class="meta">${submitted} / ${rows.length}人</p>
        <div class="progress"><span style="width:${Math.round((submitted / target) * 100)}%"></span></div>
      </div>
      <div class="row-card">
        <strong>満足度平均</strong>
        <p class="count-number">${avg}</p>
      </div>
      <div class="row-card">
        <strong>難易度分布</strong>
        ${difficulty
          .map((item) => `
            <div class="trend-row">
              <span>${item.label}</span>
              <div class="progress"><span style="width:${item.pct}%"></span></div>
              <strong>${item.count}</strong>
            </div>
          `)
          .join("")}
      </div>
    `;
  }

  function renderStaffSettings() {
    const container = qs("#staffSettingsSummary");
    if (!container) return;
    const courses = staffCourses();
    const today = courses.filter((course) => course.date === state.date);
    const changes = staffChangeRows();
    container.innerHTML = `
      <div class="row-card">
        <strong>${state.staffVenue}</strong>
        <p class="meta">講座予定 ${courses.length}件 / 本日 ${today.length}件 / 講座変更 ${changes.length}件</p>
      </div>
      <div class="row-card">
        <strong>表示範囲</strong>
        <p class="meta">講座別管理、カレンダー、講座変更、受講コマ、アンケート傾向を選択校舎で絞り込みます。</p>
      </div>
    `;
  }

  function renderCsvReference() {
    const tbody = qs("#csvReferenceRows");
    if (!tbody) return;
    const refs = [
      ["students.csv", "生徒一覧とLINE登録状態", "生徒/校舎画面"],
      ["courses.csv", "講座日程・教室・状態", "今日の授業/講座変更"],
      ["course_changes.csv", "休講・日程変更・教室変更・時間変更", "変更管理/校舎変更一覧"],
      ["attendance.csv", "入室・退室・アンケート状態", "出席管理/出力"],
      ["survey_responses.csv", "アンケート回答", "集計/授業報告"],
      ["course_counts.csv", "科目別受講コマ数", "学習ログ/基準判定"],
      ["thresholds.csv", "校舎側の基準コマ数", "基準未達アラート"],
      ["mock_scores.csv", "模試成績サンプル", "将来拡張の参考"],
    ];
    tbody.innerHTML = refs
      .map(([file, purpose, screen]) => {
        const sample = state.data[file]?.[0] || {};
        return `<tr><td>${file}</td><td>${purpose}</td><td>${screen}</td><td><code>${Object.keys(sample).join(", ")}</code></td></tr>`;
      })
      .join("");
  }

  function renderExports() {
    const preview = qs("#exportPreview");
    if (!preview) return;
    const attendanceExport = state.data["attendance.csv"].map((row) => {
      const course = courseById(row.course_id);
      return {
        student_id: row.student_id,
        course_id: row.course_id,
        course_name: course.course_name,
        date: course.date,
        checkin_status: row.checkin_status,
        survey_status: row.survey_status,
      };
    });
    preview.textContent = toCsv(attendanceExport.slice(0, 5), [
      "student_id",
      "course_id",
      "course_name",
      "date",
      "checkin_status",
      "survey_status",
    ]);
  }

  function downloadCsv(filename, csvText) {
    const blob = new Blob([csvText], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
  }

  function bindExports() {
    const exports = {
      attendance_export: {
        filename: "attendance_export.csv",
        rows: state.data["attendance.csv"],
        columns: ["student_id", "course_id", "checkin_status", "checkin_time", "method", "checkout_status", "survey_status"],
      },
      course_counts_export: {
        filename: "course_counts_export.csv",
        rows: state.data["course_counts.csv"],
        columns: ["student_id", "subject", "attended_periods", "planned_periods"],
      },
      survey_export: {
        filename: "survey_export.csv",
        rows: state.data["survey_responses.csv"],
        columns: ["response_id", "student_id", "course_id", "satisfaction", "difficulty", "understanding", "comment", "submitted_at"],
      },
      pos_import_sample: {
        filename: "pos_import_sample.csv",
        rows: state.data["course_counts.csv"].map((row) => ({ student_id: row.student_id, subject: row.subject, periods: row.attended_periods })),
        columns: ["student_id", "subject", "periods"],
      },
    };
    qsa("[data-export]").forEach((button) => {
      button.addEventListener("click", () => {
        const item = exports[button.dataset.export];
        downloadCsv(item.filename, toCsv(item.rows, item.columns));
      });
    });
  }

  function bindToastButtons() {
    qsa("[data-toast]").forEach((button) => {
      button.addEventListener("click", () => showToast(button.dataset.toast));
    });
  }

  function showToast(message) {
    const toast = qs("#toast");
    if (!toast) return;
    toast.textContent = message;
    toast.classList.add("visible");
    window.setTimeout(() => toast.classList.remove("visible"), 2200);
  }

  function renderStaff() {
    renderStaffControls();
    renderCourseChangeManager();
    renderStaffStats();
    renderStaffCourseOverview();
    renderAttendanceTable();
    renderProxyTable();
    renderDayStrip("staffDayStrip", false);
    renderCalendar("staffCalendar", false);
    renderSelectedDay(state.date);
    renderTodayChanges("staffChanges", true, true);
    renderCountsTable();
    renderSurveyTable();
    renderSurveyTrends();
    renderCsvReference();
    renderExports();
    renderStaffSettings();
    bindToastButtons();
  }

  function initStaff() {
    activateTabs();
    renderStaff();
    bindStaffControls();
    bindCourseChangeManager();
    bindExports();
  }

  async function main() {
    try {
      await loadAll();
      if (document.body.dataset.app === "student") initStudent();
      if (document.body.dataset.app === "student-pass") initStudentPass();
      if (document.body.dataset.app === "staff") initStaff();
    } catch (error) {
      console.error(error);
      document.body.insertAdjacentHTML("afterbegin", `<div class="notice red">CSV読み込みに失敗しました: ${error.message}</div>`);
    }
  }

  document.addEventListener("DOMContentLoaded", main);
})();
