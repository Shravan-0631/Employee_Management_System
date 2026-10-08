/**
 * app.js — People Register & Employee Profile HR Portal
 * Talks to Flask backend at http://127.0.0.1:5000 using Fetch API.
 * Single Page Architecture: Staff Directory <-> Employee Profile & Career History.
 */

const API = `http://${window.location.hostname || "127.0.0.1"}:5000/api`;

// Validation regular expressions
const EMP_ID_RE = /^EMP\d{3,}$/;
const NAME_RE = /^[A-Za-z\s]{2,}$/;
const CONTACT_RE = /^[6-9]\d{9}$/;
const SALARY_RE = /^\d+(\.\d{1,2})?$/;

/** Distinct, muted department colours (matching editorial corporate theme) */
const DEPT_COLOURS = {
  Engineering: "#c8702a",
  HR: "#5c7a5a",
  Finance: "#c4a574",
  Marketing: "#b75a3a",
  Operations: "#547e9e",
  Sales: "#d09a4a",
};

function getDeptColor(deptName) {
  if (deptName && DEPT_COLOURS[deptName]) return DEPT_COLOURS[deptName];
  const palette = ["#c8702a", "#5c7a5a", "#c4a574", "#b75a3a", "#547e9e", "#d09a4a"];
  let hash = 0;
  for (let i = 0; i < (deptName || "").length; i++) {
    hash = deptName.charCodeAt(i) + ((hash << 5) - hash);
  }
  return palette[Math.abs(hash) % palette.length];
}

// DOM Elements Cache
const els = {
  // Navigation & Views
  directoryView: document.getElementById("directoryView"),
  profileView: document.getElementById("profileView"),
  navLinkDirectory: document.getElementById("navLinkDirectory"),
  navSep: document.getElementById("navSep"),
  navCurrentProfile: document.getElementById("navCurrentProfile"),
  btnBackToDirectory: document.getElementById("btnBackToDirectory"),
  railBtnDirectory: document.getElementById("railBtnDirectory"),
  railBtnProfile: document.getElementById("railBtnProfile"),

  // Stats & Directory
  statsTotal: document.getElementById("statTotal"),
  statsDepts: document.getElementById("statDepts"),
  statsAvg: document.getElementById("statAvg"),
  employeeCountBadge: document.getElementById("employeeCountBadge"),
  search: document.getElementById("searchInput"),
  deptFilter: document.getElementById("deptFilter"),
  loading: document.getElementById("loadingState"),
  empty: document.getElementById("emptyState"),
  table: document.getElementById("staffTable"),
  tbody: document.getElementById("staffBody"),
  cards: document.getElementById("cardList"),

  // Profile View (Reference UI)
  profAvatar: document.getElementById("profAvatar"),
  profTitle: document.getElementById("profTitle"),
  profRole: document.getElementById("profRole"),
  profStatusBadge: document.getElementById("profStatusBadge"),
  profStatusText: document.getElementById("profStatusText"),
  liveTimer: document.getElementById("liveTimer"),
  btnCheckToggle: document.getElementById("btnCheckToggle"),
  profManagerAvatar: document.getElementById("profManagerAvatar"),
  profManagerName: document.getElementById("profManagerName"),
  profManagerRole: document.getElementById("profManagerRole"),
  profColleaguesList: document.getElementById("profColleaguesList"),
  profDept: document.getElementById("profDept"),
  profSalary: document.getElementById("profSalary"),
  profContact: document.getElementById("profContact"),
  profId: document.getElementById("profId"),
  timelineStream: document.getElementById("timelineStream"),
  dossierGrid: document.getElementById("dossierGrid"),
  btnEditCurrentEmp: document.getElementById("btnEditCurrentEmp"),

  // Slide-in Drawer (Add / Edit)
  drawer: document.getElementById("drawer"),
  drawerBackdrop: document.getElementById("drawerBackdrop"),
  drawerTitle: document.getElementById("drawerTitle"),
  form: document.getElementById("empForm"),
  mode: document.getElementById("modeField"),
  empId: document.getElementById("empId"),
  empName: document.getElementById("empName"),
  empDept: document.getElementById("empDept"),
  empRole: document.getElementById("empRole"),
  empSalary: document.getElementById("empSalary"),
  empContact: document.getElementById("empContact"),

  // Add Milestone Modal
  historyModalBackdrop: document.getElementById("historyModalBackdrop"),
  historyForm: document.getElementById("historyForm"),
  btnOpenAddHistory: document.getElementById("btnOpenAddHistory"),
  btnCloseHistModal: document.getElementById("btnCloseHistModal"),
  btnCancelHistModal: document.getElementById("btnCancelHistModal"),
  histType: document.getElementById("histType"),
  histYear: document.getElementById("histYear"),
  histDate: document.getElementById("histDate"),
  histLocation: document.getElementById("histLocation"),
  histTitle: document.getElementById("histTitle"),
  histMessage: document.getElementById("histMessage"),

  // Delete Confirm Modal & Toasts
  confirmBackdrop: document.getElementById("confirmBackdrop"),
  confirmCopy: document.getElementById("confirmCopy"),
  btnConfirmNo: document.getElementById("btnConfirmNo"),
  btnConfirmYes: document.getElementById("btnConfirmYes"),
  toasts: document.getElementById("toasts"),
};

// Application State
let departments = [];
let allEmployees = [];
let currentEmployee = null;
let pendingDeleteId = null;
let searchTimer = null;
let currentView = "directory"; // "directory" | "profile"

// Work timer ticker state
let timerSeconds = 8 * 3600 + 8 * 60 + 17; // Initial 08:08:17
let timerRunning = true;
let timerInterval = null;

// Event Listeners Setup
function setupListeners() {
  // Navigation
  els.navLinkDirectory.addEventListener("click", () => showView("directory"));
  els.btnBackToDirectory.addEventListener("click", () => showView("directory"));
  els.railBtnDirectory.addEventListener("click", () => showView("directory"));
  els.railBtnProfile.addEventListener("click", () => {
    if (currentEmployee) showView("profile", currentEmployee.emp_id);
    else if (allEmployees.length > 0) showView("profile", allEmployees[0].emp_id);
  });

  // Drawer (Add / Edit)
  document.getElementById("btnAdd").addEventListener("click", () => openDrawer("create"));
  document.getElementById("btnCloseDrawer").addEventListener("click", closeDrawer);
  document.getElementById("btnCancel").addEventListener("click", closeDrawer);
  els.drawerBackdrop.addEventListener("click", closeDrawer);
  els.form.addEventListener("submit", onSaveEmployee);

  // Edit from Profile view
  els.btnEditCurrentEmp.addEventListener("click", () => {
    if (currentEmployee) openDrawer("edit", currentEmployee);
  });

  // Search & Filter
  els.search.addEventListener("input", onSearchInput);
  els.deptFilter.addEventListener("change", loadEmployees);

  // Delete Confirmation
  els.btnConfirmNo.addEventListener("click", closeConfirm);
  els.btnConfirmYes.addEventListener("click", confirmDelete);
  els.confirmBackdrop.addEventListener("click", (e) => {
    if (e.target === els.confirmBackdrop) closeConfirm();
  });

  // Tabs on Profile View
  document.querySelectorAll(".portal-tab").forEach((tab) => {
    tab.addEventListener("click", () => onTabClick(tab.dataset.tab));
  });

  // Milestone Modal
  els.btnOpenAddHistory.addEventListener("click", openHistoryModal);
  els.btnCloseHistModal.addEventListener("click", closeHistoryModal);
  els.btnCancelHistModal.addEventListener("click", closeHistoryModal);
  els.historyModalBackdrop.addEventListener("click", (e) => {
    if (e.target === els.historyModalBackdrop) closeHistoryModal();
  });
  els.historyForm.addEventListener("submit", onSaveHistory);

  // Work timer check-out / check-in toggle
  els.btnCheckToggle.addEventListener("click", toggleWorkTimer);

  // Interactive status toggle
  els.profStatusBadge.addEventListener("click", toggleEmployeeStatus);

  // Global Keyboard shortcuts (Escape key)
  window.addEventListener("keydown", (e) => {
    if (e.key === "Escape") {
      if (!els.confirmBackdrop.hidden) closeConfirm();
      else if (!els.historyModalBackdrop.hidden) closeHistoryModal();
      else if (els.drawer.classList.contains("open")) closeDrawer();
      else if (currentView === "profile") showView("directory");
    }
  });

  // Browser hash navigation
  window.addEventListener("hashchange", handleHashChange);
}

// Start application
init();

async function init() {
  setupListeners();
  startTimerTicker();
  await loadDepartments();
  await Promise.all([loadStats(), loadEmployees()]);
  handleHashChange();
}

function handleHashChange() {
  const hash = window.location.hash;
  if (hash.startsWith("#profile/")) {
    const empId = hash.replace("#profile/", "").trim();
    if (empId) showView("profile", empId);
  } else {
    showView("directory", null, false);
  }
}

/* ----------------------------------------------------
   View Switching: Directory <-> Employee Profile
---------------------------------------------------- */
async function showView(viewName, empId = null, updateHash = true) {
  currentView = viewName;

  if (viewName === "directory") {
    els.directoryView.hidden = false;
    els.profileView.hidden = true;

    els.navLinkDirectory.classList.add("active");
    els.navSep.hidden = true;
    els.navCurrentProfile.hidden = true;
    els.btnBackToDirectory.hidden = true;

    els.railBtnDirectory.classList.add("active");
    els.railBtnProfile.classList.remove("active");

    if (updateHash) window.location.hash = "";
  } else if (viewName === "profile") {
    const targetId = empId || (currentEmployee ? currentEmployee.emp_id : "EMP001");
    await loadEmployeeProfile(targetId);

    els.directoryView.hidden = true;
    els.profileView.hidden = false;

    els.navLinkDirectory.classList.remove("active");
    els.navSep.hidden = false;
    els.navCurrentProfile.hidden = false;
    els.btnBackToDirectory.hidden = false;

    els.railBtnDirectory.classList.remove("active");
    els.railBtnProfile.classList.add("active");

    if (updateHash) window.location.hash = `#profile/${targetId}`;
    window.scrollTo({ top: 0, behavior: "smooth" });
  }
}

/* ----------------------------------------------------
   Profile Data & Career History Loader
---------------------------------------------------- */
async function loadEmployeeProfile(empId) {
  try {
    const res = await fetch(`${API}/employees/${encodeURIComponent(empId)}`);
    const json = await res.json();
    if (!res.ok) throw new Error(json.error || "Could not load employee details.");

    const emp = json.data;
    const reportingTo = json.reporting_to;
    const colleagues = json.colleagues || [];
    const careerHistory = json.career_history || [];

    currentEmployee = emp;

    // Header & identity
    const deptCol = getDeptColor(emp.department);
    els.profAvatar.textContent = initials(emp.name);
    els.profAvatar.style.background = deptCol;
    els.profTitle.textContent = `${emp.emp_id} · ${emp.name}`;
    els.profRole.textContent = emp.designation;
    els.navCurrentProfile.textContent = `${emp.emp_id} - ${emp.name}`;

    // Meta details
    els.profDept.textContent = emp.department;
    els.profSalary.textContent = formatInr(emp.salary);
    els.profContact.textContent = emp.contact;
    els.profId.textContent = emp.emp_id;

    // Reporting To block
    if (reportingTo) {
      els.profManagerAvatar.textContent = initials(reportingTo.name);
      els.profManagerAvatar.style.background = getDeptColor(reportingTo.department);
      els.profManagerName.textContent = reportingTo.name;
      els.profManagerRole.textContent = `${reportingTo.emp_id} · ${reportingTo.designation}`;
    } else {
      els.profManagerName.textContent = "Executive Board";
      els.profManagerRole.textContent = "Direct Report";
      els.profManagerAvatar.textContent = "EB";
    }

    // Teammates / Reportees list
    els.profColleaguesList.innerHTML = "";
    if (colleagues.length === 0) {
      els.profColleaguesList.innerHTML = `<p class="meta">No other staff currently assigned to ${escapeHtml(emp.department)}.</p>`;
    } else {
      colleagues.forEach((c) => {
        const cCol = getDeptColor(c.department);
        const html = `
          <div class="reportee-row">
            <span class="mini-avatar" style="background:${cCol}">${initials(c.name)}</span>
            <div style="flex:1; min-width:0;">
              <strong style="display:block; font-size:0.83rem;">${escapeHtml(c.name)}</strong>
              <span style="font-size:0.72rem; color:var(--muted);">${escapeHtml(c.emp_id)} · ${escapeHtml(c.designation)}</span>
            </div>
            <span class="mini-badge-present">Present</span>
          </div>`;
        els.profColleaguesList.insertAdjacentHTML("beforeend", html);
      });
    }

    // Render Timeline & Dossier
    renderCareerTimeline(careerHistory);
    renderProfileDossier(emp);
  } catch (err) {
    toast(err.message, "bad");
  }
}

/* ----------------------------------------------------
   Career History Timeline Renderer (Reference Design)
---------------------------------------------------- */
function renderCareerTimeline(history) {
  els.timelineStream.innerHTML = "";

  if (!history || history.length === 0) {
    els.timelineStream.innerHTML = `
      <div class="timeline-empty">
        <p style="font-family:'Fraunces', serif; font-size:1.15rem; color:var(--text); margin:0 0 6px;">No Career Milestones Logged Yet</p>
        <p class="meta">Click the <strong>Add Milestone</strong> button above to record promotions, transfers, and project deliverables for this employee.</p>
      </div>`;
    return;
  }

  // Group by Year in descending order
  const grouped = {};
  history.forEach((h) => {
    const yr = h.year || 2024;
    if (!grouped[yr]) grouped[yr] = [];
    grouped[yr].push(h);
  });

  const sortedYears = Object.keys(grouped).sort((a, b) => Number(b) - Number(a));

  sortedYears.forEach((year) => {
    const yearEvents = grouped[year];
    let eventsHtml = "";

    yearEvents.forEach((ev) => {
      eventsHtml += timelineCardHtml(ev);
    });

    const yearGroupHtml = `
      <section class="timeline-year-group">
        <div class="timeline-year-label">
          <span class="timeline-year-badge">${escapeHtml(year)}</span>
          <span class="timeline-year-line"></span>
        </div>
        <div class="timeline-events-list">
          ${eventsHtml}
        </div>
      </section>`;

    els.timelineStream.insertAdjacentHTML("beforeend", yearGroupHtml);
  });

  // Attach delete buttons for history entries
  document.querySelectorAll("[data-del-history]").forEach((btn) => {
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      onDeleteHistory(btn.dataset.delHistory);
    });
  });
}

function timelineCardHtml(ev) {
  const type = ev.event_type || "project";
  let cardClass = "card-project";
  let iconSvg = "";
  let primaryLabel = "Project:";
  let primaryValue = ev.title;

  switch (type) {
    case "location":
      cardClass = "card-location";
      primaryLabel = "Location:";
      primaryValue = ev.location || ev.title;
      iconSvg = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"/><circle cx="12" cy="10" r="3"/></svg>`;
      break;

    case "designation":
      cardClass = "card-designation";
      primaryLabel = "Designation:";
      primaryValue = ev.title;
      iconSvg = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="4" width="18" height="16" rx="2"/><line x1="7" y1="8" x2="17" y2="8"/><line x1="7" y1="12" x2="13" y2="12"/></svg>`;
      break;

    case "department":
      cardClass = "card-department";
      primaryLabel = "Department:";
      primaryValue = ev.title;
      iconSvg = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="8" r="6"/><path d="M15.477 12.89 17 22l-5-3-5 3 1.523-9.11"/></svg>`;
      break;

    case "milestone":
      cardClass = "card-milestone";
      primaryLabel = "Milestone:";
      primaryValue = ev.title;
      iconSvg = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/></svg>`;
      break;

    default: // project
      cardClass = "card-project";
      primaryLabel = "Project:";
      primaryValue = ev.title;
      iconSvg = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="16 18 22 12 16 6"/><polyline points="8 6 2 12 8 18"/></svg>`;
      break;
  }

  const dateParts = (ev.event_date || "").split(" ");
  const dayStr = dateParts[0] || "";
  const monthStr = dateParts.slice(1).join(" ") || "";

  return `
    <article class="timeline-event-row">
      <div class="event-date-col">
        <span class="event-date-main">${escapeHtml(dayStr)}</span>
        <span class="event-date-sub">${escapeHtml(monthStr)}</span>
      </div>
      <div class="event-spine">
        <span class="spine-line"></span>
        <span class="spine-node"></span>
      </div>
      <div class="event-card ${cardClass}">
        <div class="event-icon-box">
          ${iconSvg}
        </div>
        <div class="event-details">
          <div class="event-prop">
            <span class="event-prop-name">${escapeHtml(primaryLabel)}</span>
            <span class="event-prop-val">${escapeHtml(primaryValue)}</span>
          </div>
          ${
            ev.location && type !== "location"
              ? `<div class="event-prop"><span class="event-prop-name">Location:</span><span class="event-prop-val">${escapeHtml(ev.location)}</span></div>`
              : ""
          }
          <div class="event-msg-row">
            <span class="event-prop-name">Message:</span>
            <span class="event-msg-val">${escapeHtml(ev.message)}</span>
          </div>
        </div>
        <button type="button" class="btn-del-history" data-del-history="${ev.id}" title="Delete milestone">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>
        </button>
      </div>
    </article>`;
}

/* ----------------------------------------------------
   Profile Dossier Grid
---------------------------------------------------- */
function renderProfileDossier(emp) {
  els.dossierGrid.innerHTML = `
    <div class="dossier-cell">
      <span>Official Name</span>
      <strong>${escapeHtml(emp.name)}</strong>
    </div>
    <div class="dossier-cell">
      <span>Employee ID</span>
      <strong class="mono">${escapeHtml(emp.emp_id)}</strong>
    </div>
    <div class="dossier-cell">
      <span>Department</span>
      <strong>${escapeHtml(emp.department)}</strong>
    </div>
    <div class="dossier-cell">
      <span>Current Designation</span>
      <strong>${escapeHtml(emp.designation)}</strong>
    </div>
    <div class="dossier-cell">
      <span>Annual CTC</span>
      <strong class="mono">${formatInr(emp.salary)}</strong>
    </div>
    <div class="dossier-cell">
      <span>Primary Mobile</span>
      <strong class="mono">${escapeHtml(emp.contact)}</strong>
    </div>
    <div class="dossier-cell">
      <span>Employment Status</span>
      <strong style="color:#50c878;">Full-Time / Permanent</strong>
    </div>
    <div class="dossier-cell">
      <span>Registration Date</span>
      <strong class="mono">${escapeHtml(emp.created_at ? emp.created_at.split(" ")[0] : "Active")}</strong>
    </div>`;
}

/* ----------------------------------------------------
   Tabs Manager on Profile View
---------------------------------------------------- */
function onTabClick(tabName) {
  document.querySelectorAll(".portal-tab").forEach((tab) => {
    tab.classList.toggle("active", tab.dataset.tab === tabName);
  });

  const panes = {
    career: document.getElementById("paneCareer"),
    profile: document.getElementById("paneProfile"),
    activities: document.getElementById("paneActivities"),
    leave: document.getElementById("paneLeave"),
    timesheets: document.getElementById("paneTimesheets"),
  };

  Object.entries(panes).forEach(([name, pane]) => {
    if (pane) pane.hidden = name !== tabName;
  });
}

/* ----------------------------------------------------
   Work Milestone Modal Management (Add History)
---------------------------------------------------- */
function openHistoryModal() {
  if (!currentEmployee) return;
  els.historyForm.reset();
  els.histYear.value = new Date().getFullYear();

  // Set default human date string (e.g. "19 October")
  const months = ["January","February","March","April","May","June","July","August","September","October","November","December"];
  const d = new Date();
  els.histDate.value = `${String(d.getDate()).padStart(2, "0")} ${months[d.getMonth()]}`;
  els.histLocation.value = "Headquarters";

  els.historyModalBackdrop.hidden = false;
  els.histTitle.focus();
}

function closeHistoryModal() {
  els.historyModalBackdrop.hidden = true;
}

async function onSaveHistory(event) {
  event.preventDefault();
  if (!currentEmployee) return;

  const payload = {
    event_type: els.histType.value,
    year: Number(els.histYear.value),
    event_date: els.histDate.value.trim(),
    location: els.histLocation.value.trim() || "Headquarters",
    title: els.histTitle.value.trim(),
    message: els.histMessage.value.trim(),
  };

  if (!payload.title || !payload.message || !payload.event_date || !payload.year) {
    toast("Please complete all required milestone fields.", "bad");
    return;
  }

  try {
    const res = await fetch(`${API}/employees/${encodeURIComponent(currentEmployee.emp_id)}/history`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    const json = await res.json();
    if (!res.ok) throw new Error(json.error || "Could not save milestone.");

    toast("Work milestone logged successfully.", "ok");
    closeHistoryModal();
    // Refresh employee profile
    await loadEmployeeProfile(currentEmployee.emp_id);
  } catch (err) {
    toast(err.message, "bad");
  }
}

async function onDeleteHistory(historyId) {
  if (!historyId) return;
  try {
    const res = await fetch(`${API}/history/${encodeURIComponent(historyId)}`, {
      method: "DELETE",
    });
    const json = await res.json();
    if (!res.ok) throw new Error(json.error || "Could not delete milestone.");

    toast("Milestone removed.", "ok");
    if (currentEmployee) {
      await loadEmployeeProfile(currentEmployee.emp_id);
    }
  } catch (err) {
    toast(err.message, "bad");
  }
}

/* ----------------------------------------------------
   Directory: Departments, Stats & Employees Loaders
---------------------------------------------------- */
async function loadDepartments() {
  try {
    const res = await fetch(`${API}/departments`);
    const json = await res.json();
    if (!res.ok) throw new Error(json.error || "Could not load departments.");
    departments = json.data || [];

    els.deptFilter.innerHTML = `<option value="">All departments</option>`;
    els.empDept.innerHTML = `<option value="">Select department</option>`;
    departments.forEach((d) => {
      els.deptFilter.insertAdjacentHTML("beforeend", `<option value="${escapeHtml(d.name)}">${escapeHtml(d.name)}</option>`);
      els.empDept.insertAdjacentHTML("beforeend", `<option value="${escapeHtml(d.name)}">${escapeHtml(d.name)}</option>`);
    });
  } catch (err) {
    toast(err.message, "bad");
  }
}

async function loadStats() {
  try {
    const res = await fetch(`${API}/stats`);
    const json = await res.json();
    if (!res.ok) throw new Error(json.error || "Could not load stats.");
    const s = json.data;
    els.statsTotal.textContent = s.total_employees;
    els.statsDepts.textContent = s.department_count;
    els.statsAvg.textContent = formatInr(s.average_salary);
  } catch (err) {
    els.statsTotal.textContent = "—";
    toast(err.message, "bad");
  }
}

function onSearchInput() {
  clearTimeout(searchTimer);
  searchTimer = setTimeout(loadEmployees, 280);
}

async function loadEmployees() {
  const q = els.search.value.trim();
  const department = els.deptFilter.value;
  const params = new URLSearchParams();
  if (q) params.set("q", q);
  if (department) params.set("department", department);

  setLoading(true);
  try {
    const url = `${API}/employees/search?${params.toString()}`;
    const res = await fetch(url);
    const json = await res.json();
    if (!res.ok) throw new Error(json.error || "Could not load employees.");
    allEmployees = json.data || [];
    renderEmployees(allEmployees);
    els.employeeCountBadge.textContent = `${allEmployees.length} staff on record`;
  } catch (err) {
    toast(err.message, "bad");
    renderEmployees([]);
  } finally {
    setLoading(false);
  }
}

function setLoading(on) {
  els.loading.classList.toggle("hidden", !on);
  if (on) els.empty.classList.add("hidden");
}

function renderEmployees(rows) {
  els.tbody.innerHTML = "";
  els.cards.innerHTML = "";

  if (!rows.length) {
    els.empty.classList.remove("hidden");
    els.table.classList.add("hidden");
    els.cards.hidden = true;
    return;
  }

  els.empty.classList.add("hidden");
  els.table.classList.remove("hidden");
  els.cards.hidden = false;

  rows.forEach((emp) => {
    els.tbody.insertAdjacentHTML("beforeend", tableRow(emp));
    els.cards.insertAdjacentHTML("beforeend", cardRow(emp));
  });

  // Clicking anywhere on a table row navigates to Employee Profile & Career History!
  document.querySelectorAll("#staffBody tr").forEach((tr) => {
    tr.addEventListener("click", (e) => {
      // Don't trigger if clicked directly on an action button
      if (e.target.closest(".row-actions")) return;
      const empId = tr.dataset.empId;
      if (empId) showView("profile", empId);
    });
  });

  // Clicking on a card navigates to Employee Profile & Career History!
  document.querySelectorAll("#cardList article").forEach((art) => {
    art.addEventListener("click", (e) => {
      if (e.target.closest(".row-actions")) return;
      const empId = art.dataset.empId;
      if (empId) showView("profile", empId);
    });
  });

  // Direct "View Profile" button click
  document.querySelectorAll("[data-view-profile]").forEach((btn) => {
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      showView("profile", btn.dataset.viewProfile);
    });
  });

  // Edit employee button
  document.querySelectorAll("[data-edit]").forEach((btn) => {
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      const emp = rows.find((r) => r.emp_id === btn.dataset.edit);
      if (emp) openDrawer("edit", emp);
    });
  });

  // Delete employee button
  document.querySelectorAll("[data-del]").forEach((btn) => {
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      askDelete(btn.dataset.del, btn.dataset.name);
    });
  });
}

function tableRow(emp) {
  const colour = getDeptColor(emp.department);
  return `
    <tr data-emp-id="${escapeHtml(emp.emp_id)}">
      <td>
        <div class="person">
          <span class="avatar" style="background:${colour}">${initials(emp.name)}</span>
          <strong style="color:var(--text);">${escapeHtml(emp.name)}</strong>
        </div>
      </td>
      <td class="mono">${escapeHtml(emp.emp_id)}</td>
      <td>
        <span class="dept"><span class="dot" style="background:${colour}"></span>${escapeHtml(emp.department)}</span>
      </td>
      <td>${escapeHtml(emp.designation)}</td>
      <td class="mono">${formatInr(emp.salary)}</td>
      <td class="mono">${escapeHtml(emp.contact)}</td>
      <td>
        <div class="row-actions">
          <button type="button" class="btn-view-profile" data-view-profile="${escapeHtml(emp.emp_id)}" title="View Profile & Work History">History →</button>
          ${editBtn(emp.emp_id)}
          ${delBtn(emp.emp_id, emp.name)}
        </div>
      </td>
    </tr>`;
}

function cardRow(emp) {
  const colour = getDeptColor(emp.department);
  return `
    <article class="card" data-emp-id="${escapeHtml(emp.emp_id)}">
      <div class="card-top">
        <div class="person">
          <span class="avatar" style="background:${colour}">${initials(emp.name)}</span>
          <div>
            <strong>${escapeHtml(emp.name)}</strong>
            <div class="mono" style="font-size:0.8rem; color:var(--muted);">${escapeHtml(emp.emp_id)}</div>
          </div>
        </div>
        <div class="row-actions">
          <button type="button" class="btn-view-profile" data-view-profile="${escapeHtml(emp.emp_id)}">History →</button>
          ${editBtn(emp.emp_id)}
          ${delBtn(emp.emp_id, emp.name)}
        </div>
      </div>
      <p class="meta">
        <span class="dept"><span class="dot" style="background:${colour}"></span>${escapeHtml(emp.department)}</span>
        · ${escapeHtml(emp.designation)}<br />
        <span class="mono">${formatInr(emp.salary)}</span> · <span class="mono">${escapeHtml(emp.contact)}</span>
      </p>
    </article>`;
}

function editBtn(id) {
  return `<button type="button" data-edit="${escapeHtml(id)}" aria-label="Edit ${escapeHtml(id)}" title="Edit Employee">
    <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 20h4l10-10-4-4L4 16v4z" fill="none" stroke="currentColor" stroke-width="1.6"/><path d="M13 7l4 4" fill="none" stroke="currentColor" stroke-width="1.6"/></svg>
  </button>`;
}

function delBtn(id, name) {
  return `<button type="button" data-del="${escapeHtml(id)}" data-name="${escapeHtml(name)}" aria-label="Delete ${escapeHtml(id)}" title="Remove Employee">
    <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 7h14M9 7V5h6v2M8 7l1 13h6l1-13" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"/></svg>
  </button>`;
}

/* ----------------------------------------------------
   Slide-in Drawer (Add / Edit Employee)
---------------------------------------------------- */
function openDrawer(mode, emp) {
  clearFieldErrors();
  els.mode.value = mode;
  els.drawerTitle.textContent = mode === "edit" ? "Edit employee" : "Add employee";
  els.empId.readOnly = mode === "edit";

  if (emp) {
    els.empId.value = emp.emp_id;
    els.empName.value = emp.name;
    els.empDept.value = emp.department;
    els.empRole.value = emp.designation;
    els.empSalary.value = Number(emp.salary).toFixed(2);
    els.empContact.value = emp.contact;
  } else {
    els.form.reset();
    els.mode.value = "create";
  }

  els.drawer.classList.add("open");
  els.drawer.setAttribute("aria-hidden", "false");
  els.drawerBackdrop.hidden = false;

  if (mode === "edit") {
    els.empName.focus();
  } else {
    els.empId.focus();
  }
}

function closeDrawer() {
  els.drawer.classList.remove("open");
  els.drawer.setAttribute("aria-hidden", "true");
  els.drawerBackdrop.hidden = true;
  clearFieldErrors();
}

function readEmployeeForm() {
  return {
    emp_id: els.empId.value.trim().toUpperCase(),
    name: els.empName.value.trim(),
    department: els.empDept.value.trim(),
    designation: els.empRole.value.trim(),
    salary: els.empSalary.value.trim(),
    contact: els.empContact.value.trim(),
  };
}

function validateClient(data) {
  const fields = {};
  if (!EMP_ID_RE.test(data.emp_id)) {
    fields.emp_id = "Employee ID must look like EMP001 (EMP + 3 or more digits).";
  }
  if (!NAME_RE.test(data.name) || data.name.trim().length < 2) {
    fields.name = "Name must be at least 2 letters (letters and spaces only).";
  }
  if (!data.department) {
    fields.department = "Department is required.";
  }
  if (!data.designation || data.designation.trim().length < 2) {
    fields.designation = "Designation must be at least 2 characters.";
  }
  const salaryNum = Number(data.salary);
  if (!SALARY_RE.test(data.salary) || !(salaryNum > 0)) {
    fields.salary = "Salary must be a positive number with up to 2 decimals.";
  }
  if (!CONTACT_RE.test(data.contact)) {
    fields.contact = "Contact must be 10 digits and start with 6, 7, 8, or 9.";
  }
  return fields;
}

function showFieldErrors(fields) {
  clearFieldErrors();
  Object.entries(fields).forEach(([key, msg]) => {
    const hint = document.querySelector(`[data-error-for="${key}"]`);
    const input = els.form.querySelector(`[name="${key}"]`);
    if (hint) hint.textContent = msg;
    if (input) input.closest(".field").classList.add("invalid");
  });
}

function clearFieldErrors() {
  els.form.querySelectorAll(".field-error").forEach((p) => {
    p.textContent = "";
  });
  els.form.querySelectorAll(".field").forEach((f) => f.classList.remove("invalid"));
}

async function onSaveEmployee(event) {
  event.preventDefault();
  const data = readEmployeeForm();
  const clientErrors = validateClient(data);
  if (Object.keys(clientErrors).length) {
    showFieldErrors(clientErrors);
    return;
  }

  const isEdit = els.mode.value === "edit";
  const url = isEdit ? `${API}/employees/${encodeURIComponent(data.emp_id)}` : `${API}/employees`;
  const method = isEdit ? "PUT" : "POST";

  try {
    const res = await fetch(url, {
      method,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        ...data,
        salary: Number(data.salary),
      }),
    });
    const json = await res.json();
    if (!res.ok) {
      if (json.fields) showFieldErrors(json.fields);
      throw new Error(json.error || "Save failed.");
    }
    toast(isEdit ? "Record updated." : "Employee added.", "ok");
    closeDrawer();
    await Promise.all([loadEmployees(), loadStats()]);

    // If currently viewing this employee, reload profile view
    if (currentEmployee && currentEmployee.emp_id === data.emp_id) {
      await loadEmployeeProfile(data.emp_id);
    }
  } catch (err) {
    toast(err.message, "bad");
  }
}

/* ----------------------------------------------------
   Custom Delete Confirmation Modal
---------------------------------------------------- */
function askDelete(empId, name) {
  pendingDeleteId = empId;
  els.confirmCopy.textContent = `${name} (${empId}) will be permanently removed from the register.`;
  els.confirmBackdrop.hidden = false;
}

function closeConfirm() {
  pendingDeleteId = null;
  els.confirmBackdrop.hidden = true;
}

async function confirmDelete() {
  const empId = pendingDeleteId;
  if (!empId) return;
  closeConfirm();
  try {
    const res = await fetch(`${API}/employees/${encodeURIComponent(empId)}`, { method: "DELETE" });
    const json = await res.json();
    if (!res.ok) throw new Error(json.error || "Delete failed.");
    toast(json.message || "Removed.", "ok");

    if (currentEmployee && currentEmployee.emp_id === empId) {
      currentEmployee = null;
      showView("directory");
    }

    await Promise.all([loadEmployees(), loadStats()]);
  } catch (err) {
    toast(err.message, "bad");
  }
}

/* ----------------------------------------------------
   Interactive Widgets: Timer & Status
---------------------------------------------------- */
function startTimerTicker() {
  if (timerInterval) clearInterval(timerInterval);
  timerInterval = setInterval(() => {
    if (timerRunning) {
      timerSeconds++;
      updateTimerDisplay();
    }
  }, 1000);
}

function updateTimerDisplay() {
  const h = String(Math.floor(timerSeconds / 3600)).padStart(2, "0");
  const m = String(Math.floor((timerSeconds % 3600) / 60)).padStart(2, "0");
  const s = String(timerSeconds % 60).padStart(2, "0");
  els.liveTimer.textContent = `${h} : ${m} : ${s}`;
}

function toggleWorkTimer() {
  timerRunning = !timerRunning;
  if (timerRunning) {
    els.btnCheckToggle.textContent = "Check-out";
    els.btnCheckToggle.style.color = "#f28b80";
    els.btnCheckToggle.style.borderColor = "#d96f64";
    toast("Clocked in: timer resumed.", "ok");
  } else {
    els.btnCheckToggle.textContent = "Check-in";
    els.btnCheckToggle.style.color = "#8ed68d";
    els.btnCheckToggle.style.borderColor = "#5c7a5a";
    toast("Clocked out: attendance recorded.", "ok");
  }
}

function toggleEmployeeStatus() {
  const current = els.profStatusText.textContent.trim();
  if (current === "Present") {
    els.profStatusText.textContent = "Remote";
    els.profStatusBadge.style.color = "#e5b364";
    els.profStatusBadge.querySelector(".status-dot").style.background = "#e5b364";
    toast("Status updated to Remote.", "ok");
  } else if (current === "Remote") {
    els.profStatusText.textContent = "On Leave";
    els.profStatusBadge.style.color = "#f28b80";
    els.profStatusBadge.querySelector(".status-dot").style.background = "#f28b80";
    toast("Status updated to On Leave.", "ok");
  } else {
    els.profStatusText.textContent = "Present";
    els.profStatusBadge.style.color = "#8ed68d";
    els.profStatusBadge.querySelector(".status-dot").style.background = "#50c878";
    toast("Status updated to Present.", "ok");
  }
}

/* ----------------------------------------------------
   Utility Functions
---------------------------------------------------- */
function toast(message, kind) {
  const node = document.createElement("div");
  node.className = `toast ${kind}`;
  node.textContent = message;
  els.toasts.appendChild(node);
  setTimeout(() => node.remove(), 3200);
}

function initials(name) {
  if (!name) return "EM";
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length >= 2) {
    return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
  }
  return parts[0].slice(0, 2).toUpperCase();
}

function formatInr(value) {
  return new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    maximumFractionDigits: 2,
  }).format(Number(value) || 0);
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}
