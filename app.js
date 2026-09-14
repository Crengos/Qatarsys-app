"use strict";

/* =========================================================================
   Registro de Horas - Qatarsys (version movil / PWA)
   Misma logica de calculo que la version de escritorio (horas_qatarsys.py):
   - Cada entrada tiene hora de inicio y de fin (se calculan las horas
     totales). Las horas de ese dia por encima de 8h son SIEMPRE extra
     automaticamente; la casilla "Horas extra" marca el dia entero como
     extra a mano (turnos cortos, de menos de 8h).
   - Solo las horas que cuentan como horas de contrato (normales) rellenan,
     en orden de fecha, el cupo mensual de horas de contrato; las horas ya
     marcadas como extra (casilla o por superar las 8h del dia) nunca
     ocupan ese cupo. Al agotarse el cupo, el resto se paga tambien como
     hora extra.
   - Los proyectos cerrados del mes (pestana aparte) se registran por
     separado y se suman al total a pagar.
   ========================================================================= */

const MESES_ES = ["Enero","Febrero","Marzo","Abril","Mayo","Junio",
                   "Julio","Agosto","Septiembre","Octubre","Noviembre","Diciembre"];

const DAILY_NORMAL_HOURS = 8; // horas de contrato maximas por dia; el resto es extra automaticamente

const DEFAULT_CONFIG = {
  employee_name: "",
  contract_hours: 80,
  contract_salary: 650.0,
  extra_base_rate: 8.13,
  extra_multiplier: 1.5,
};

const ENTRIES_KEY = "horas_entries";
const CONFIG_KEY = "horas_config";
const PROJECTS_KEY = "horas_projects";

/* ---------------------------------------------------------------------
   Persistencia (localStorage)
   --------------------------------------------------------------------- */
function loadEntries() {
  try {
    const raw = localStorage.getItem(ENTRIES_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch (e) { return []; }
}
function saveEntries(entries) {
  localStorage.setItem(ENTRIES_KEY, JSON.stringify(entries));
}
function loadProjects() {
  try {
    const raw = localStorage.getItem(PROJECTS_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch (e) { return []; }
}
function saveProjects(projects) {
  localStorage.setItem(PROJECTS_KEY, JSON.stringify(projects));
}
function loadConfig() {
  let cfg = { ...DEFAULT_CONFIG };
  try {
    const raw = localStorage.getItem(CONFIG_KEY);
    if (raw) cfg = { ...cfg, ...JSON.parse(raw) };
  } catch (e) { /* keep defaults */ }
  return cfg;
}
function saveConfig(cfg) {
  localStorage.setItem(CONFIG_KEY, JSON.stringify(cfg));
}

let state = {
  entries: loadEntries(),
  projects: loadProjects(),
  config: loadConfig(),
  editingId: null,
  editingProjectId: null,
};

/* ---------------------------------------------------------------------
   Horas: HH:MM -> minutos, duracion total
   --------------------------------------------------------------------- */
function parseHHMM(value) {
  const s = (value || "").trim();
  const parts = s.split(":");
  if (parts.length !== 2) {
    throw new Error(`Formato de hora invalido: '${s}' (usa HH:MM, ej. 07:00).`);
  }
  const h = parseInt(parts[0], 10);
  const m = parseInt(parts[1], 10);
  if (Number.isNaN(h) || Number.isNaN(m)) {
    throw new Error(`Formato de hora invalido: '${s}' (usa HH:MM, ej. 07:00).`);
  }
  if (!(h >= 0 && h <= 23 && m >= 0 && m <= 59)) {
    throw new Error(`Hora fuera de rango: '${s}'.`);
  }
  return h * 60 + m;
}

function computeTotalHours(startTime, endTime) {
  const startMin = parseHHMM(startTime);
  let endMin = parseHHMM(endTime);
  if (endMin === startMin) {
    throw new Error("La hora de fin no puede ser igual a la hora de inicio.");
  }
  if (endMin < startMin) {
    endMin += 24 * 60; // el turno cruza la medianoche (ej. 22:00 a 01:00 = 3h)
  }
  return rnd((endMin - startMin) / 60, 4);
}

/* Redondeo IDENTICO al de la version de escritorio (horas_qatarsys.py: rnd()).
   Medio hacia arriba (0,005 -> 0,01) con un epsilon minimo para neutralizar
   el error de coma flotante. Imprescindible que ambas versiones redondeen
   exactamente igual para que el total a pagar coincida al centimo. */
function rnd(x, ndigits = 2) {
  const f = Math.pow(10, ndigits);
  return Math.floor(x * f + 0.5 + 1e-9) / f;
}

function minutesToHHMM(totalMinutes) {
  totalMinutes = Math.max(0, Math.min(Math.round(totalMinutes), 23 * 60 + 59));
  const h = Math.floor(totalMinutes / 60), m = totalMinutes % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

/* ---------------------------------------------------------------------
   Logica de calculo (identica a build_month_rows / compute_totals en Python)
   --------------------------------------------------------------------- */
function monthEntries(entries, year, month) {
  const prefix = `${year}-${String(month).padStart(2, "0")}`;
  return entries
    .filter((e) => (e.date || "").startsWith(prefix))
    .slice()
    .sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
}

function round4(x) { return rnd(x, 4); }

function buildMonthRows(entriesForMonth, contractHours) {
  const rows = [];
  let cumulative = 0;
  for (const e of entriesForMonth) {
    let totalHours = 0;
    try { totalHours = computeTotalHours(e.start_time, e.end_time); }
    catch (err) { totalHours = 0; }
    const bonus = parseFloat(e.bonus) || 0;
    const isExtra = !!e.is_extra;

    let designatedNormal, designatedExtra;
    if (isExtra) {
      designatedExtra = totalHours;
      designatedNormal = 0;
    } else {
      designatedExtra = round4(Math.max(0, totalHours - DAILY_NORMAL_HOURS));
      designatedNormal = round4(Math.min(totalHours, DAILY_NORMAL_HOURS));
    }

    const remainingQuota = Math.max(0, contractHours - cumulative);
    const normalHours = round4(Math.min(designatedNormal, remainingQuota));
    const autoOverflow = round4(designatedNormal - normalHours);
    const extraHours = round4(designatedExtra + autoOverflow);

    cumulative += normalHours;

    rows.push({
      id: e.id, date: e.date, location: e.location || "", client: e.client || "",
      project: e.project || "",
      start_time: e.start_time || "", end_time: e.end_time || "", is_extra: isExtra,
      total_hours: totalHours, normal_hours: normalHours, extra_hours: extraHours, bonus,
    });
  }
  return rows;
}

function sum(arr) { return arr.reduce((a, b) => a + b, 0); }

function round2(x) { return rnd(x, 2); }

function computeTotals(rows, cfg) {
  const totalNormal = sum(rows.map((r) => r.normal_hours));
  const totalExtra = sum(rows.map((r) => r.extra_hours));
  const totalHours = totalNormal + totalExtra;
  const totalBonus = sum(rows.map((r) => r.bonus));
  const extraRate = cfg.extra_base_rate * cfg.extra_multiplier;
  const extraAmount = round2(totalExtra * extraRate);
  const contractSalary = cfg.contract_salary;
  const contractHours = cfg.contract_hours;
  // El salario fijo es la paga del mes por el trabajo hecho, aunque sea menos
  // de lo que dice el contrato. Solo se paga algo POR ENCIMA si el valor total
  // del trabajo (horas de contrato a salario/horas_contrato + horas extra a su
  // tarifa + proyectos) supera el salario fijo. Los premios se suman siempre.
  const normalHourValue = contractHours ? contractSalary / contractHours : 0;
  const totalNormalValue = round2(totalNormal * normalHourValue);
  const workValueHours = round2(totalNormalValue + extraAmount);
  const totalPay = round2(Math.max(contractSalary, workValueHours) + totalBonus);
  return {
    total_hours: totalHours, total_normal_hours: totalNormal, total_extra_hours: totalExtra,
    contract_hours_target: contractHours, extra_rate: extraRate,
    normal_hour_value: normalHourValue, total_normal_value: totalNormalValue,
    extra_amount: extraAmount, work_value_hours: workValueHours,
    total_bonus: totalBonus, contract_salary: contractSalary, total_pay: totalPay,
  };
}

/* ---------------------------------------------------------------------
   Proyectos cerrados (independiente de las horas; identica logica que
   compute_project_amount / build_month_projects en Python)
   --------------------------------------------------------------------- */
function computeProjectAmount(entry) {
  const cost = parseFloat(entry.cost) || 0;
  const percentage = parseFloat(entry.percentage) || 0;
  if (cost > 0 && percentage > 0) {
    return rnd(cost * percentage / 100, 2);
  }
  return rnd(parseFloat(entry.manual_amount) || 0, 2);
}

function buildMonthProjects(entriesForMonth) {
  return entriesForMonth.map((e) => ({
    id: e.id, date: e.date, name: e.name || "",
    cost: parseFloat(e.cost) || 0, percentage: parseFloat(e.percentage) || 0,
    manual_amount: parseFloat(e.manual_amount) || 0,
    amount: computeProjectAmount(e),
  }));
}

function computeProjectsTotal(rows) {
  return rnd(sum(rows.map((r) => r.amount)), 2);
}

function computeWorkValue(totals, totalProjects) {
  // Valor total del trabajo del mes: horas de contrato + horas extra + proyectos.
  return round2(totals.total_normal_value + totals.extra_amount + totalProjects);
}

function computeGrandTotal(totals, totalProjects, contractSalary) {
  // TOTAL = MAX(salario fijo ; valor total del trabajo) + premios.
  const workValue = computeWorkValue(totals, totalProjects);
  return round2(Math.max(contractSalary, workValue) + totals.total_bonus);
}

/* ---------------------------------------------------------------------
   UI: helpers generales
   --------------------------------------------------------------------- */
function $(id) { return document.getElementById(id); }
function uid() { return Math.random().toString(16).slice(2, 10); }
function fmt2(n) { return (Number(n) || 0).toFixed(2); }

let toastTimer = null;
function toast(msg) {
  const el = $("toast");
  el.textContent = msg;
  el.classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove("show"), 2600);
}

function confirmDialog(text) {
  return new Promise((resolve) => {
    const backdrop = $("confirmBackdrop");
    $("confirmText").textContent = text;
    backdrop.classList.add("show");
    const cleanup = (result) => {
      backdrop.classList.remove("show");
      okBtn.removeEventListener("click", onOk);
      cancelBtn.removeEventListener("click", onCancel);
      resolve(result);
    };
    const okBtn = $("confirmOk"), cancelBtn = $("confirmCancel");
    const onOk = () => cleanup(true);
    const onCancel = () => cleanup(false);
    okBtn.addEventListener("click", onOk);
    cancelBtn.addEventListener("click", onCancel);
  });
}

/* ---------------------------------------------------------------------
   Tabs
   --------------------------------------------------------------------- */
document.querySelectorAll(".tab-btn").forEach((btn) => {
  btn.addEventListener("click", () => {
    document.querySelectorAll(".tab-btn").forEach((b) => b.classList.remove("active"));
    document.querySelectorAll(".tabpanel").forEach((p) => p.classList.remove("active"));
    btn.classList.add("active");
    $(`tab-${btn.dataset.tab}`).classList.add("active");
    renderAll();
  });
});

/* ---------------------------------------------------------------------
   Periodo (mes/anio)
   --------------------------------------------------------------------- */
function initPeriodControls() {
  const monthSelect = $("monthSelect");
  MESES_ES.forEach((name, idx) => {
    const opt = document.createElement("option");
    opt.value = String(idx + 1);
    opt.textContent = name;
    monthSelect.appendChild(opt);
  });
  const today = new Date();
  monthSelect.value = String(today.getMonth() + 1);
  $("yearInput").value = String(today.getFullYear());
  monthSelect.addEventListener("change", renderAll);
  $("yearInput").addEventListener("change", renderAll);
}
function currentPeriod() {
  return { year: parseInt($("yearInput").value, 10), month: parseInt($("monthSelect").value, 10) };
}

/* ---------------------------------------------------------------------
   Formulario: vista previa de horas totales
   --------------------------------------------------------------------- */
function updateTotalPreview() {
  let total;
  try {
    total = computeTotalHours($("f_start").value, $("f_end").value);
  } catch (e) {
    $("totalPreview").textContent = "Horas totales: -";
    return;
  }
  if ($("f_extra").checked) {
    $("totalPreview").textContent = `Horas totales: ${fmt2(total)} h (todas extra)`;
  } else if (total > DAILY_NORMAL_HOURS) {
    $("totalPreview").textContent =
      `Horas totales: ${fmt2(total)} h (${fmt2(DAILY_NORMAL_HOURS)} normales + ${fmt2(total - DAILY_NORMAL_HOURS)} extra)`;
  } else {
    $("totalPreview").textContent = `Horas totales: ${fmt2(total)} h`;
  }
}
$("f_start").addEventListener("input", updateTotalPreview);
$("f_end").addEventListener("input", updateTotalPreview);
$("f_extra").addEventListener("change", updateTotalPreview);

/* ---------------------------------------------------------------------
   CRUD de entradas
   --------------------------------------------------------------------- */
function resetForm() {
  state.editingId = null;
  $("formTitle").textContent = "Nueva entrada";
  $("btnAdd").textContent = "Anadir";
  $("btnCancelEdit").style.display = "none";
  $("f_location").value = "";
  $("f_client").value = "";
  $("f_project").value = "";
  $("f_start").value = "";
  $("f_end").value = "";
  $("f_extra").checked = false;
  $("f_bonus").value = "0";
  updateTotalPreview();
}

function todayISO() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

$("btnAdd").addEventListener("click", () => {
  const date = $("f_date").value;
  if (!date) { toast("Indica una fecha valida."); return; }

  const startTime = $("f_start").value, endTime = $("f_end").value;
  try {
    computeTotalHours(startTime, endTime);
  } catch (err) {
    toast(err.message);
    return;
  }

  const bonus = parseFloat(($("f_bonus").value || "0").replace(",", "."));
  if (Number.isNaN(bonus) || bonus < 0) { toast("El premio debe ser un numero valido (0 o mayor)."); return; }

  const isExtra = $("f_extra").checked;

  if (state.editingId) {
    const entry = state.entries.find((e) => e.id === state.editingId);
    if (!entry) { toast("La entrada que editabas ya no existe."); resetForm(); return; }
    Object.assign(entry, {
      date, location: $("f_location").value.trim(), client: $("f_client").value.trim(),
      project: $("f_project").value.trim(),
      start_time: startTime, end_time: endTime, is_extra: isExtra, bonus,
    });
  } else {
    state.entries.push({
      id: uid(), date, location: $("f_location").value.trim(), client: $("f_client").value.trim(),
      project: $("f_project").value.trim(),
      start_time: startTime, end_time: endTime, is_extra: isExtra, bonus,
    });
  }
  saveEntries(state.entries);

  const [y, m] = date.split("-").map(Number);
  $("yearInput").value = String(y);
  $("monthSelect").value = String(m);

  resetForm();
  renderAll();
  toast("Entrada guardada.");
});

$("btnCancelEdit").addEventListener("click", resetForm);

function startEdit(id) {
  const entry = state.entries.find((e) => e.id === id);
  if (!entry) return;
  $("f_date").value = entry.date;
  $("f_location").value = entry.location || "";
  $("f_client").value = entry.client || "";
  $("f_project").value = entry.project || "";
  $("f_start").value = entry.start_time || "";
  $("f_end").value = entry.end_time || "";
  $("f_extra").checked = !!entry.is_extra;
  $("f_bonus").value = String(entry.bonus || 0);
  updateTotalPreview();

  state.editingId = id;
  $("formTitle").textContent = `Editando entrada del ${entry.date}`;
  $("btnAdd").textContent = "Guardar cambios";
  $("btnCancelEdit").style.display = "";
  document.querySelector('.tab-btn[data-tab="registro"]').click();
  $("tab-registro").scrollIntoView({ behavior: "smooth", block: "start" });
}

async function deleteEntry(id) {
  const ok = await confirmDialog("¿Eliminar esta entrada?");
  if (!ok) return;
  state.entries = state.entries.filter((e) => e.id !== id);
  saveEntries(state.entries);
  if (state.editingId === id) resetForm();
  renderAll();
  toast("Entrada eliminada.");
}

/* ---------------------------------------------------------------------
   CRUD de proyectos cerrados
   --------------------------------------------------------------------- */
function updateProjectAmountPreview() {
  const cost = parseFloat($("p_cost").value) || 0;
  const pct = parseFloat($("p_percentage").value) || 0;
  const amountInput = $("p_amount");
  if (cost > 0 && pct > 0) {
    const computed = rnd(cost * pct / 100, 2);
    amountInput.value = computed.toFixed(2);
    amountInput.readOnly = true;
  } else {
    amountInput.readOnly = false;
  }
}
$("p_cost").addEventListener("input", updateProjectAmountPreview);
$("p_percentage").addEventListener("input", updateProjectAmountPreview);

function resetProjectForm() {
  state.editingProjectId = null;
  $("projectFormTitle").textContent = "Nuevo proyecto";
  $("btnAddProject").textContent = "Anadir";
  $("btnCancelEditProject").style.display = "none";
  $("p_name").value = "";
  $("p_cost").value = "";
  $("p_percentage").value = "";
  $("p_amount").value = "";
  $("p_amount").readOnly = false;
}

$("btnAddProject").addEventListener("click", () => {
  const date = $("p_date").value;
  if (!date) { toast("Indica una fecha valida."); return; }

  const name = $("p_name").value.trim();
  if (!name) { toast("Indica el nombre del proyecto."); return; }

  const cost = parseFloat(($("p_cost").value || "").replace(",", ".")) || 0;
  const percentage = parseFloat(($("p_percentage").value || "").replace(",", ".")) || 0;
  const manualAmount = parseFloat(($("p_amount").value || "").replace(",", ".")) || 0;

  if (!(cost > 0 && percentage > 0) && manualAmount <= 0) {
    toast("Indica el importe a cobrar, o el coste y el porcentaje del proyecto.");
    return;
  }

  if (state.editingProjectId) {
    const entry = state.projects.find((e) => e.id === state.editingProjectId);
    if (!entry) { toast("El proyecto que editabas ya no existe."); resetProjectForm(); return; }
    Object.assign(entry, { date, name, cost, percentage, manual_amount: manualAmount });
  } else {
    state.projects.push({ id: uid(), date, name, cost, percentage, manual_amount: manualAmount });
  }
  saveProjects(state.projects);

  const [y, m] = date.split("-").map(Number);
  $("yearInput").value = String(y);
  $("monthSelect").value = String(m);

  resetProjectForm();
  renderAll();
  toast("Proyecto guardado.");
});

$("btnCancelEditProject").addEventListener("click", resetProjectForm);

function startEditProject(id) {
  const entry = state.projects.find((e) => e.id === id);
  if (!entry) return;
  $("p_date").value = entry.date;
  $("p_name").value = entry.name || "";
  $("p_cost").value = entry.cost ? String(entry.cost) : "";
  $("p_percentage").value = entry.percentage ? String(entry.percentage) : "";
  $("p_amount").value = entry.manual_amount ? String(entry.manual_amount) : "";
  updateProjectAmountPreview();

  state.editingProjectId = id;
  $("projectFormTitle").textContent = `Editando proyecto del ${entry.date}`;
  $("btnAddProject").textContent = "Guardar cambios";
  $("btnCancelEditProject").style.display = "";
  document.querySelector('.tab-btn[data-tab="proyectos"]').click();
  $("tab-proyectos").scrollIntoView({ behavior: "smooth", block: "start" });
}

async function deleteProject(id) {
  const ok = await confirmDialog("¿Eliminar este proyecto?");
  if (!ok) return;
  state.projects = state.projects.filter((e) => e.id !== id);
  saveProjects(state.projects);
  if (state.editingProjectId === id) resetProjectForm();
  renderAll();
  toast("Proyecto eliminado.");
}

/* ---------------------------------------------------------------------
   Render: lista de entradas (tarjetas)
   --------------------------------------------------------------------- */
function renderEntries(rows) {
  const container = $("entriesContainer");
  container.innerHTML = "";
  const { month } = currentPeriod();
  $("entriesHeading").textContent = `Entradas de ${MESES_ES[month - 1]}`;

  if (rows.length === 0) {
    container.innerHTML = `<div class="empty-state">Todavia no hay entradas este mes.</div>`;
    return;
  }

  const extraRate = state.config.extra_base_rate * state.config.extra_multiplier;

  for (const r of rows) {
    const importeExtra = round2(r.extra_hours * extraRate);
    const totalDia = round2(importeExtra + r.bonus);

    const card = document.createElement("div");
    card.className = "entry-card" + (r.is_extra ? " is-extra" : "");
    card.innerHTML = `
      <div class="row-top">
        <span class="date">${r.date}</span>
        <span class="times">${r.start_time}&ndash;${r.end_time}</span>
      </div>
      <div class="meta">${[r.location, r.client, r.project].filter(Boolean).join(" · ") || "&nbsp;"}</div>
      <div class="chips">
        <span class="chip">Total ${fmt2(r.total_hours)} h</span>
        <span class="chip">Horas ${fmt2(r.normal_hours)} h</span>
        <span class="chip extra">Extra ${fmt2(r.extra_hours)} h</span>
        ${r.bonus ? `<span class="chip">Premio ${fmt2(r.bonus)} €</span>` : ""}
        <span class="chip">Dia ${fmt2(totalDia)} €</span>
      </div>
      <div class="actions">
        <button data-act="edit">Editar</button>
        <button data-act="del" class="danger">Eliminar</button>
      </div>
    `;
    card.querySelector('[data-act="edit"]').addEventListener("click", () => startEdit(r.id));
    card.querySelector('[data-act="del"]').addEventListener("click", () => deleteEntry(r.id));
    container.appendChild(card);
  }
}

/* ---------------------------------------------------------------------
   Render: lista de proyectos (tarjetas)
   --------------------------------------------------------------------- */
function renderProjects(projectRows) {
  const container = $("projectsContainer");
  container.innerHTML = "";
  const { month } = currentPeriod();
  $("projectsHeading").textContent = `Proyectos de ${MESES_ES[month - 1]}`;

  if (projectRows.length === 0) {
    container.innerHTML = `<div class="empty-state">Todavia no hay proyectos este mes.</div>`;
    return;
  }

  for (const r of projectRows) {
    const card = document.createElement("div");
    card.className = "entry-card";
    card.innerHTML = `
      <div class="row-top">
        <span class="date">${r.date}</span>
        <span class="times">${r.name}</span>
      </div>
      <div class="chips">
        ${r.cost ? `<span class="chip">Coste ${fmt2(r.cost)} €</span>` : ""}
        ${r.percentage ? `<span class="chip">Porcentaje ${fmt2(r.percentage)} %</span>` : ""}
        <span class="chip extra">Importe ${fmt2(r.amount)} €</span>
      </div>
      <div class="actions">
        <button data-act="edit">Editar</button>
        <button data-act="del" class="danger">Eliminar</button>
      </div>
    `;
    card.querySelector('[data-act="edit"]').addEventListener("click", () => startEditProject(r.id));
    card.querySelector('[data-act="del"]').addEventListener("click", () => deleteProject(r.id));
    container.appendChild(card);
  }
}

/* ---------------------------------------------------------------------
   Render: resumen
   --------------------------------------------------------------------- */
function renderSummary(totals, totalProjects) {
  const workValue = computeWorkValue(totals, totalProjects);
  const grandTotal = computeGrandTotal(totals, totalProjects, state.config.contract_salary);
  $("employeeLabel").textContent = state.config.employee_name || "";
  $("s_total_hours").textContent = `${fmt2(totals.total_hours)} h`;
  $("s_normal_hours").textContent = `${fmt2(totals.total_normal_hours)} h (objetivo ${totals.contract_hours_target} h)`;
  $("s_extra_hours").textContent = `${fmt2(totals.total_extra_hours)} h`;
  $("s_extra_rate").textContent = `${fmt2(totals.extra_rate)} €/h`;
  $("s_normal_value").textContent = `${fmt2(totals.total_normal_value)} €`;
  $("s_extra_amount").textContent = `${fmt2(totals.extra_amount)} €`;
  $("s_projects").textContent = `${fmt2(totalProjects)} €`;
  $("s_work_value").textContent = `${fmt2(workValue)} €`;
  $("s_salary").textContent = `${fmt2(totals.contract_salary)} €`;
  $("s_bonus").textContent = `${fmt2(totals.total_bonus)} €`;
  $("s_total_pay").textContent = `${fmt2(grandTotal)} €`;
}

function renderAll() {
  const { year, month } = currentPeriod();
  const rows = buildMonthRows(monthEntries(state.entries, year, month), state.config.contract_hours);
  const projectRows = buildMonthProjects(monthEntries(state.projects, year, month));
  renderEntries(rows);
  renderProjects(projectRows);
  renderSummary(computeTotals(rows, state.config), computeProjectsTotal(projectRows));
}

/* ---------------------------------------------------------------------
   Configuracion
   --------------------------------------------------------------------- */
function fillConfigForm() {
  $("cfg_employee").value = state.config.employee_name || "";
  $("cfg_hours").value = state.config.contract_hours;
  $("cfg_salary").value = state.config.contract_salary;
  $("cfg_rate").value = state.config.extra_base_rate;
  $("cfg_mult").value = state.config.extra_multiplier;
  updateFinalRateLabel();
}
function updateFinalRateLabel() {
  const base = parseFloat($("cfg_rate").value), mult = parseFloat($("cfg_mult").value);
  if (!Number.isNaN(base) && !Number.isNaN(mult)) {
    $("finalRateLabel").textContent = `Tarifa final de hora extra: ${fmt2(base * mult)} EUR/h`;
  } else {
    $("finalRateLabel").textContent = "Tarifa final de hora extra: -";
  }
}
["cfg_rate", "cfg_mult"].forEach((id) => $(id).addEventListener("input", updateFinalRateLabel));

$("btnSaveConfig").addEventListener("click", () => {
  const hours = parseInt($("cfg_hours").value, 10);
  const salary = parseFloat($("cfg_salary").value);
  const rate = parseFloat($("cfg_rate").value);
  const mult = parseFloat($("cfg_mult").value);
  if ([hours, salary, rate, mult].some((v) => Number.isNaN(v))) {
    toast("Revisa que todos los campos sean numeros validos.");
    return;
  }
  state.config.employee_name = $("cfg_employee").value.trim();
  state.config.contract_hours = hours;
  state.config.contract_salary = salary;
  state.config.extra_base_rate = rate;
  state.config.extra_multiplier = mult;
  saveConfig(state.config);
  updateFinalRateLabel();
  renderAll();
  toast("Configuracion guardada.");
});

/* ---------------------------------------------------------------------
   Datos: exportar / importar / limpiar
   --------------------------------------------------------------------- */
function downloadJSON(obj, filename) {
  const blob = new Blob([JSON.stringify(obj, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = filename;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}

$("btnExport").addEventListener("click", () => {
  const payload = {
    exported_at: new Date().toISOString(),
    config: state.config,
    entries: state.entries,
    projects: state.projects,
  };
  downloadJSON(payload, `backup_horas_${todayISO()}.json`);
  toast("Copia de seguridad descargada.");
});

$("importFile").addEventListener("change", (ev) => {
  const file = ev.target.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = async () => {
    let data;
    try { data = JSON.parse(reader.result); }
    catch (e) { toast("El archivo no es un JSON valido."); return; }
    if (!Array.isArray(data.entries)) { toast("Este archivo no contiene datos de horas validos."); return; }
    const ok = await confirmDialog(
      "Esto reemplazara TODOS los datos actuales (entradas, proyectos y, si estan incluidos, la " +
      "configuracion) por los del archivo seleccionado.\n\n¿Continuar?"
    );
    if (!ok) { ev.target.value = ""; return; }
    state.entries = data.entries.map((e) => ({ ...e, id: e.id || uid() }));
    if (Array.isArray(data.projects)) {
      state.projects = data.projects.map((e) => ({ ...e, id: e.id || uid() }));
      saveProjects(state.projects);
    }
    if (data.config && typeof data.config === "object") {
      for (const k of Object.keys(DEFAULT_CONFIG)) {
        if (k in data.config) state.config[k] = data.config[k];
      }
      saveConfig(state.config);
    }
    saveEntries(state.entries);
    resetForm();
    resetProjectForm();
    fillConfigForm();
    renderAll();
    toast("Datos importados correctamente.");
    ev.target.value = "";
  };
  reader.readAsText(file);
});

$("btnClearData").addEventListener("click", async () => {
  if (state.entries.length === 0 && state.projects.length === 0) {
    toast("No hay entradas ni proyectos que borrar.");
    return;
  }
  const ok = await confirmDialog(
    `Se van a borrar TODAS las ${state.entries.length} entradas de horas y TODOS los ` +
    `${state.projects.length} proyectos registrados (de todos los meses). Se descargara antes ` +
    "una copia de seguridad automatica.\n\n¿Seguro que quieres continuar?"
  );
  if (!ok) return;
  downloadJSON(
    {
      exported_at: new Date().toISOString(), config: state.config,
      entries: state.entries, projects: state.projects,
    },
    `backup_antes_de_limpiar_${todayISO()}.json`
  );
  state.entries = [];
  state.projects = [];
  saveEntries(state.entries);
  saveProjects(state.projects);
  resetForm();
  resetProjectForm();
  renderAll();
  toast("Datos borrados. Copia de seguridad descargada.");
});

/* ---------------------------------------------------------------------
   Exportar informe Excel (.xlsx) - replica el estilo de la version de escritorio
   --------------------------------------------------------------------- */
const THIN = { style: "thin", color: { rgb: "BFBFBF" } };
const BORDER_ALL = { top: THIN, bottom: THIN, left: THIN, right: THIN };
const C_TITLE_BG = "1F4E78", C_LABEL_BG = "404040", C_CFG_HEADER_BG = "595959",
      C_CFG_ROW_BG = "D9D9D9", C_TABLE_HEADER_BG = "2E75B6", C_ROW_A = "DCE9F7",
      C_ROW_B = "BDD7EE", C_SUBTOTAL_BG = "1F4E78", C_TOTAL_BG = "548235",
      C_NOTE_BG = "E2EFDA",
      C_PROJECTS_TITLE_BG = "C55A11", C_PROJECTS_HEADER_BG = "F4B183",
      C_PROJECTS_ROW_A = "FCE4D6", C_PROJECTS_ROW_B = "FBE0CC",
      C_BLUE = "1F4E78", C_RED = "C00000", C_WHITE = "FFFFFF";

function xCell(value, opts = {}) {
  const { bold = false, size = 13, color, fill, align = "left", numFmt, italic = false, formula } = opts;
  const isNum = typeof value === "number";
  const c = { t: isNum ? "n" : "s", v: value };
  if (formula) c.f = formula;
  c.s = {
    font: { name: "Calibri", sz: size, bold, italic, color: { rgb: color || "000000" } },
    alignment: { horizontal: align, vertical: "center", wrapText: true },
    border: BORDER_ALL,
  };
  if (fill) c.s.fill = { patternType: "solid", fgColor: { rgb: fill } };
  if (numFmt) c.z = numFmt;
  return c;
}

function generateXlsx(rows, totals, projectRows, cfg, employeeName, year, month) {
  const ws = {};
  const merges = [];
  const rowHeights = [];
  const LAST_COL = 12; // 0-indexed -> column M (M = "Proyecto", anadida al final de la tabla diaria)
  const set = (r, c, value, opts) => { ws[XLSX.utils.encode_cell({ r, c })] = xCell(value, opts); };
  const merge = (r1, c1, r2, c2) => merges.push({ s: { r: r1, c: c1 }, e: { r: r2, c: c2 } });
  const setH = (r, pt) => { rowHeights[r] = { hpt: pt }; };

  let r = 0;
  // Filas 0-3: reservadas para el logo (mismo tamano que la version de escritorio)
  for (let i = 0; i < 4; i++) {
    merge(i, 0, i, LAST_COL);
    setH(i, 28);
  }
  r = 4;

  // Titulo
  set(r, 0, "HOJA DE CALCULO DE HORAS Y RETRIBUCION MENSUAL",
    { bold: true, size: 20, align: "center", fill: C_TITLE_BG, color: C_WHITE });
  merge(r, 0, r, LAST_COL);
  setH(r, 34);
  r += 1;
  setH(r, 6);
  r += 1;

  // Empleado / mes
  set(r, 0, "Nombre del empleado:", { bold: true, fill: C_LABEL_BG, color: C_WHITE });
  merge(r, 0, r, 1);
  set(r, 2, employeeName, { bold: true });
  merge(r, 2, r, 4);
  set(r, 5, "Mes:", { bold: true, fill: C_LABEL_BG, color: C_WHITE });
  set(r, 6, `${MESES_ES[month - 1]} ${year}`, { bold: true });
  merge(r, 6, r, LAST_COL);
  setH(r, 26);
  r += 1;
  setH(r, 7);
  r += 1;

  // Configuracion
  set(r, 0, "CONFIGURACION - EDITAR AQUI SI CAMBIA TU CONTRATO, SALARIO O TARIFA/MULTIPLICADOR",
    { bold: true, fill: C_CFG_HEADER_BG, color: C_WHITE });
  merge(r, 0, r, LAST_COL);
  setH(r, 26);
  r += 1;
  set(r, 0, "Horas de contrato/mes", { bold: true, fill: C_CFG_HEADER_BG, color: C_WHITE, align: "center", size: 13 });
  merge(r, 0, r, 1);
  set(r, 2, "Salario fijo (EUR)", { bold: true, fill: C_CFG_HEADER_BG, color: C_WHITE, align: "center", size: 13 });
  merge(r, 2, r, 3);
  set(r, 4, "Tarifa base extra (EUR/h)", { bold: true, fill: C_CFG_HEADER_BG, color: C_WHITE, align: "center", size: 13 });
  merge(r, 4, r, 5);
  set(r, 6, "Multiplicador (x)", { bold: true, fill: C_CFG_HEADER_BG, color: C_WHITE, align: "center", size: 13 });
  set(r, 7, "Tarifa final extra (EUR/h)", { bold: true, fill: C_CFG_HEADER_BG, color: C_WHITE, align: "center", size: 13 });
  merge(r, 7, r, LAST_COL);
  setH(r, 30);
  const cfgHeaderRow = r;
  r += 1;
  const cfgRow = r;
  set(r, 0, cfg.contract_hours, { align: "center", fill: C_CFG_ROW_BG, color: C_BLUE, bold: true });
  merge(r, 0, r, 1);
  set(r, 2, cfg.contract_salary, { align: "center", fill: C_CFG_ROW_BG, color: C_BLUE, bold: true, numFmt: "#,##0.00" });
  merge(r, 2, r, 3);
  set(r, 4, cfg.extra_base_rate, { align: "center", fill: C_CFG_ROW_BG, color: C_BLUE, bold: true, numFmt: "#,##0.00" });
  merge(r, 4, r, 5);
  set(r, 6, cfg.extra_multiplier, { align: "center", fill: C_CFG_ROW_BG, color: C_RED, bold: true, numFmt: "0.00" });
  const extraRateCell = XLSX.utils.encode_cell({ r: cfgRow, c: 7 });
  set(r, 7, totals.extra_rate, {
    align: "center", fill: C_CFG_ROW_BG, bold: true, numFmt: "#,##0.00",
    formula: `E${cfgRow + 1}*G${cfgRow + 1}`,
  });
  merge(r, 7, r, LAST_COL);
  setH(r, 22);
  const contractSalaryCell = `C${cfgRow + 1}`;
  r += 2;

  // Nota
  set(r, 0,
    "Nota: el salario fijo (650 EUR) es la paga del mes por el trabajo hecho, aunque sea menos " +
    "de las 80 horas de contrato. Las horas de cada dia por encima de 8h son extra " +
    "automaticamente; la casilla 'Horas extra' marca el dia entero como extra a mano. Para saber " +
    "si se paga algo POR ENCIMA del salario fijo se calcula el valor del trabajo del mes = horas " +
    "de contrato (a salario/horas de contrato, es decir 650/80) + horas extra (a su tarifa) + " +
    "proyectos cerrados. El total a pagar es el MAYOR entre el salario fijo y ese valor, mas los " +
    "premios (que se suman siempre).",
    { italic: true, size: 11, color: "595959" }
  );
  merge(r, 0, r, LAST_COL);
  setH(r, 36);
  r += 2;

  // Tabla diaria
  set(r, 0, "1. REGISTRO DIARIO DE HORAS", { bold: true, size: 14, fill: C_TITLE_BG, color: C_WHITE });
  merge(r, 0, r, LAST_COL);
  setH(r, 28);
  r += 1;
  const headers = ["Dia", "Ubicacion", "Contratista", "Inicio", "Fin", "Horas totales", "Horas",
                    "Horas extra", "Tarifa extra (EUR/h)", "Importe extra (EUR)", "Premio (EUR)",
                    "Total dia (EUR)", "Proyecto"];
  headers.forEach((h, i) => set(r, i, h, { bold: true, fill: C_TABLE_HEADER_BG, color: C_WHITE, align: "center", size: 14 }));
  setH(r, 32);
  const tableHeaderRowIdx = r;
  r += 1;
  const firstDataRow = r;

  rows.forEach((row, idx) => {
    const fill = idx % 2 === 0 ? C_ROW_A : C_ROW_B;
    const rowNum = r + 1; // 1-indexed for formulas
    set(r, 0, row.date, { fill, size: 13 });
    set(r, 1, row.location, { fill, size: 13 });
    set(r, 2, row.client, { fill, size: 13 });
    set(r, 3, row.start_time, { fill, size: 13, align: "center" });
    set(r, 4, row.end_time, { fill, size: 13, align: "center" });
    set(r, 5, row.total_hours, { fill, size: 13, align: "center", numFmt: "0.00" });
    set(r, 6, row.normal_hours, { fill, size: 13, align: "center", numFmt: "0.00" });
    set(r, 7, row.extra_hours, { fill, size: 13, align: "center", numFmt: "0.00" });
    set(r, 8, totals.extra_rate, { fill, size: 13, align: "center", bold: true, color: C_BLUE, numFmt: "#,##0.00", formula: extraRateCell });
    const importeExtra = round2(row.extra_hours * totals.extra_rate);
    set(r, 9, importeExtra, { fill, size: 13, align: "center", numFmt: "#,##0.00", formula: `H${rowNum}*I${rowNum}` });
    set(r, 10, row.bonus, { fill, size: 13, align: "center", numFmt: "#,##0.00" });
    const totalDia = round2(importeExtra + row.bonus);
    set(r, 11, totalDia, { fill, size: 13, align: "center", bold: true, numFmt: "#,##0.00", formula: `J${rowNum}+K${rowNum}` });
    set(r, 12, row.project || "", { fill, size: 13 });
    setH(r, 22);
    r += 1;
  });

  let lastDataRow = r - 1;
  if (rows.length === 0) {
    for (let c = 0; c <= LAST_COL; c++) set(r, c, "", { fill: C_ROW_A, size: 13 });
    setH(r, 22);
    lastDataRow = r;
    r += 1;
  }

  // Subtotal
  const subtotalRowIdx = r;
  set(r, 0, "SUBTOTAL", { bold: true, fill: C_SUBTOTAL_BG, color: C_WHITE });
  merge(r, 0, r, 4);
  const fdr = firstDataRow + 1, ldr = lastDataRow + 1; // 1-indexed
  set(r, 5, totals.total_hours, { bold: true, fill: C_SUBTOTAL_BG, color: C_WHITE, align: "center", numFmt: "0.00", formula: `SUM(F${fdr}:F${ldr})` });
  set(r, 6, totals.total_normal_hours, { bold: true, fill: C_SUBTOTAL_BG, color: C_WHITE, align: "center", numFmt: "0.00", formula: `SUM(G${fdr}:G${ldr})` });
  set(r, 7, totals.total_extra_hours, { bold: true, fill: C_SUBTOTAL_BG, color: C_WHITE, align: "center", numFmt: "0.00", formula: `SUM(H${fdr}:H${ldr})` });
  set(r, 8, "", { fill: C_SUBTOTAL_BG });
  set(r, 9, totals.extra_amount, { bold: true, fill: C_SUBTOTAL_BG, color: C_WHITE, align: "center", numFmt: "#,##0.00", formula: `SUM(J${fdr}:J${ldr})` });
  set(r, 10, totals.total_bonus, { bold: true, fill: C_SUBTOTAL_BG, color: C_WHITE, align: "center", numFmt: "#,##0.00", formula: `SUM(K${fdr}:K${ldr})` });
  const totalDiasSum = round2(sum(rows.map((row) => round2(round2(row.extra_hours * totals.extra_rate) + row.bonus))));
  set(r, 11, totalDiasSum, { bold: true, fill: C_SUBTOTAL_BG, color: C_WHITE, align: "center", numFmt: "#,##0.00", formula: `SUM(L${fdr}:L${ldr})` });
  set(r, 12, "", { fill: C_SUBTOTAL_BG });
  setH(r, 24);
  const importeExtraCell = `J${subtotalRowIdx + 1}`;
  const premiosCell = `K${subtotalRowIdx + 1}`;
  r += 2;

  // Tabla de proyectos cerrados (paleta naranja, igual que la plantilla del usuario)
  set(r, 0, "2. PROYECTOS CERRADOS DEL MES", { bold: true, size: 14, fill: C_PROJECTS_TITLE_BG, color: C_WHITE });
  merge(r, 0, r, LAST_COL);
  setH(r, 28);
  r += 1;
  set(r, 0, "Fecha", { bold: true, fill: C_PROJECTS_HEADER_BG, color: C_WHITE, align: "center", size: 14 });
  merge(r, 0, r, 1);
  set(r, 2, "Nombre del proyecto", { bold: true, fill: C_PROJECTS_HEADER_BG, color: C_WHITE, align: "center", size: 14 });
  merge(r, 2, r, 5);
  set(r, 6, "Importe del proyecto (EUR)", { bold: true, fill: C_PROJECTS_HEADER_BG, color: C_WHITE, align: "center", size: 14 });
  merge(r, 6, r, 7);
  set(r, 8, "% acordado", { bold: true, fill: C_PROJECTS_HEADER_BG, color: C_WHITE, align: "center", size: 14 });
  set(r, 9, "Mi comision (EUR)", { bold: true, fill: C_PROJECTS_HEADER_BG, color: C_WHITE, align: "center", size: 14 });
  merge(r, 9, r, LAST_COL);
  setH(r, 32);
  r += 1;
  const projFirstRow = r;

  projectRows.forEach((pr, idx) => {
    const fill = idx % 2 === 0 ? C_PROJECTS_ROW_A : C_PROJECTS_ROW_B;
    set(r, 0, pr.date, { fill, size: 13 });
    merge(r, 0, r, 1);
    set(r, 2, pr.name, { fill, size: 13 });
    merge(r, 2, r, 5);
    set(r, 6, pr.cost || "", { fill, size: 13, align: "center", numFmt: "#,##0.00" });
    merge(r, 6, r, 7);
    set(r, 8, pr.percentage || "", { fill, size: 13, align: "center", numFmt: "0.00" });
    set(r, 9, pr.amount, { fill, size: 13, align: "center", bold: true, numFmt: "#,##0.00" });
    merge(r, 9, r, LAST_COL);
    setH(r, 22);
    r += 1;
  });

  let projLastRow = r - 1;
  if (projectRows.length === 0) {
    set(r, 0, "", { fill: C_PROJECTS_ROW_A, size: 13 }); merge(r, 0, r, 1);
    set(r, 2, "", { fill: C_PROJECTS_ROW_A, size: 13 }); merge(r, 2, r, 5);
    set(r, 6, "", { fill: C_PROJECTS_ROW_A, size: 13 }); merge(r, 6, r, 7);
    set(r, 8, "", { fill: C_PROJECTS_ROW_A, size: 13 });
    set(r, 9, "", { fill: C_PROJECTS_ROW_A, size: 13 }); merge(r, 9, r, LAST_COL);
    setH(r, 22);
    projLastRow = r;
    r += 1;
  }

  const projSubtotalRowIdx = r;
  set(r, 0, "SUBTOTAL PROYECTOS", { bold: true, fill: C_PROJECTS_TITLE_BG, color: C_WHITE });
  merge(r, 0, r, 7);
  set(r, 8, "", { fill: C_PROJECTS_TITLE_BG });
  const totalProjects = computeProjectsTotal(projectRows);
  const pfr = projFirstRow + 1, plr = projLastRow + 1; // 1-indexed
  set(r, 9, totalProjects, { bold: true, fill: C_PROJECTS_TITLE_BG, color: C_WHITE, align: "center", numFmt: "#,##0.00", formula: `SUM(J${pfr}:J${plr})` });
  merge(r, 9, r, LAST_COL);
  setH(r, 24);
  const proyectosCell = `J${projSubtotalRowIdx + 1}`;
  r += 2;

  // Total final:  TOTAL = MAX(salario fijo ; valor del trabajo) + premios
  const workValue = computeWorkValue(totals, totalProjects);
  const grandTotal = computeGrandTotal(totals, totalProjects, cfg.contract_salary);
  const cfgHoursCell = `A${cfgRow + 1}`;
  const normalHoursTotalCell = `G${subtotalRowIdx + 1}`;

  set(r, 0, "3. CALCULO TOTAL A PAGAR", { bold: true, size: 14, fill: C_TITLE_BG, color: C_WHITE });
  merge(r, 0, r, LAST_COL);
  setH(r, 28);
  r += 1;

  const normalValueRow = r + 1;
  set(r, 0, "Valor de las horas de contrato (EUR)  [horas x salario/horas de contrato]", { bold: true, fill: C_NOTE_BG, color: "595959" });
  merge(r, 0, r, 6);
  set(r, 7, totals.total_normal_value, {
    align: "center", fill: C_NOTE_BG, bold: true, numFmt: "#,##0.00",
    formula: `IF(${cfgHoursCell}=0,0,${normalHoursTotalCell}*${contractSalaryCell}/${cfgHoursCell})`,
  });
  merge(r, 7, r, LAST_COL);
  setH(r, 22);
  r += 1;
  set(r, 0, "Importe de las horas extra (EUR)", { bold: true, fill: C_NOTE_BG, color: "595959" });
  merge(r, 0, r, 6);
  set(r, 7, totals.extra_amount, { align: "center", fill: C_NOTE_BG, bold: true, numFmt: "#,##0.00", formula: importeExtraCell });
  merge(r, 7, r, LAST_COL);
  setH(r, 22);
  r += 1;
  set(r, 0, "Importe de los proyectos cerrados (EUR)", { bold: true, fill: C_PROJECTS_TITLE_BG, color: C_WHITE });
  merge(r, 0, r, 6);
  set(r, 7, totalProjects, { align: "center", fill: C_PROJECTS_TITLE_BG, color: C_WHITE, bold: true, numFmt: "#,##0.00", formula: proyectosCell });
  merge(r, 7, r, LAST_COL);
  setH(r, 22);
  r += 1;
  const workValueRow = r + 1;
  set(r, 0, "Valor total del trabajo del mes (EUR)", { bold: true, fill: C_SUBTOTAL_BG, color: C_WHITE });
  merge(r, 0, r, 6);
  set(r, 7, workValue, {
    align: "center", fill: C_SUBTOTAL_BG, color: C_WHITE, bold: true, numFmt: "#,##0.00",
    formula: `H${normalValueRow}+H${normalValueRow + 1}+H${normalValueRow + 2}`,
  });
  merge(r, 7, r, LAST_COL);
  setH(r, 22);
  r += 1;
  const salarioRow = r + 1;
  set(r, 0, "Salario fijo garantizado (EUR)", { bold: true, fill: C_NOTE_BG, color: "595959" });
  merge(r, 0, r, 6);
  set(r, 7, totals.contract_salary, { align: "center", fill: C_NOTE_BG, bold: true, numFmt: "#,##0.00", formula: contractSalaryCell });
  merge(r, 7, r, LAST_COL);
  setH(r, 22);
  r += 1;
  const premiosFinalRow = r + 1;
  set(r, 0, "Total premios (EUR)", { bold: true, fill: C_NOTE_BG, color: "595959" });
  merge(r, 0, r, 6);
  set(r, 7, totals.total_bonus, { align: "center", fill: C_NOTE_BG, bold: true, numFmt: "#,##0.00", formula: premiosCell });
  merge(r, 7, r, LAST_COL);
  setH(r, 22);
  r += 1;
  set(r, 0, "TOTAL A PAGAR (EUR)  =  MAX(salario ; valor del trabajo) + premios", { bold: true, size: 18, fill: C_TOTAL_BG, color: C_WHITE });
  merge(r, 0, r, 6);
  set(r, 7, grandTotal, {
    bold: true, size: 18, fill: C_TOTAL_BG, color: C_WHITE, align: "center", numFmt: "#,##0.00",
    formula: `MAX(H${salarioRow},H${workValueRow})+H${premiosFinalRow}`,
  });
  merge(r, 7, r, LAST_COL);
  setH(r, 32);

  const finalRow = r; // 0-indexed, ultima fila con contenido

  ws["!merges"] = merges;
  ws["!cols"] = [16, 24, 20, 11, 11, 15, 12, 14, 18, 18, 15, 16, 20].map((wch) => ({ wch }));
  ws["!rows"] = rowHeights;
  ws["!ref"] = XLSX.utils.encode_range({ s: { r: 0, c: 0 }, e: { r: finalRow, c: LAST_COL } });
  // Margenes de pagina (fitToWidth/fitToHeight/orientacion se inyectan a
  // mano en finalizeXlsx, ya que la libreria no los escribe via '!pageSetup')
  ws["!margins"] = { left: 0.4, right: 0.4, top: 0.6, bottom: 0.6, header: 0.2, footer: 0.2 };

  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "Horas");
  // Area de impresion (toda la hoja) + fila de titulo repetida en cada
  // pagina (la cabecera de la tabla diaria de horas).
  const lastColLetter = XLSX.utils.encode_col(LAST_COL);
  wb.Workbook = wb.Workbook || {};
  wb.Workbook.Names = [
    { Name: "_xlnm.Print_Area", Sheet: 0, Ref: `Horas!$A$1:$${lastColLetter}$${finalRow + 1}` },
    { Name: "_xlnm.Print_Titles", Sheet: 0, Ref: `Horas!$${tableHeaderRowIdx + 1}:$${tableHeaderRowIdx + 1}` },
  ];
  const filename = `Horas_${(employeeName || "empleado").replace(/\s+/g, "_")}_${MESES_ES[month - 1]}_${year}.xlsx`;

  let outBytes = XLSX.write(wb, { bookType: "xlsx", type: "array" });
  return finalizeXlsx(outBytes)
    .catch((ex) => { console.warn("No se pudo terminar de preparar el Excel:", ex); return outBytes; })
    .then((finalBytes) => {
      const blob = new Blob([finalBytes], {
        type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url; a.download = filename;
      document.body.appendChild(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 4000);
    });
}

/* ---------------------------------------------------------------------
   Termina de preparar el .xlsx generado (post-procesando el .zip a mano,
   ya que la libreria de hojas de calculo usada no escribe estas partes
   via su API de alto nivel):
   1. Ajustes de pagina para imprimir en A4 apaisado sin que se corte:
      ajustar el ancho a 1 pagina y dejar el alto libre (tantas paginas
      como haga falta), igual que en el informe de escritorio.
   2. Inserta el logo (logo.png), si existe junto a la app (misma logica
      que el logo del informe de escritorio).
   --------------------------------------------------------------------- */
async function finalizeXlsx(xlsxBytes) {
  if (typeof fflate === "undefined") return xlsxBytes;
  const zip = fflate.unzipSync(new Uint8Array(xlsxBytes));

  // ---- 1. Pagina: A4 apaisado, ajustar ancho a 1 pagina, alto libre -----
  let sheetXml = fflate.strFromU8(zip["xl/worksheets/sheet1.xml"]);
  sheetXml = sheetXml.replace(
    /(<worksheet[^>]*>)/,
    '$1<sheetPr><pageSetUpPr fitToPage="1"/></sheetPr>'
  );
  const pageSetupXml =
    '<pageSetup orientation="landscape" paperSize="9" fitToWidth="1" fitToHeight="0"/>';
  if (/<pageMargins[^/]*\/>/.test(sheetXml)) {
    sheetXml = sheetXml.replace(/(<pageMargins[^/]*\/>)/, `$1${pageSetupXml}`);
  } else {
    // Sin '!margins' no habria <pageMargins>; de reserva, se anade justo
    // antes de </worksheet> (donde tambien se insertara el <drawing> luego).
    sheetXml = sheetXml.replace("</worksheet>", `${pageSetupXml}</worksheet>`);
  }

  // ---- 2. Logo (si existe logo.png junto a la app) ----------------------
  try {
    const resp = await fetch("logo.png");
    if (resp.ok) {
      const logoBuf = new Uint8Array(await resp.arrayBuffer());
      const dims = await new Promise((resolve, reject) => {
        const img = new Image();
        img.onload = () => resolve({ w: img.naturalWidth, h: img.naturalHeight });
        img.onerror = reject;
        img.src = URL.createObjectURL(new Blob([logoBuf]));
      });

      const MAX_W = 380, MAX_H = 110, EMU_PER_PX = 9525;
      const scale = Math.min(MAX_W / dims.w, MAX_H / dims.h, 1);
      const cx = Math.round(dims.w * scale * EMU_PER_PX);
      const cy = Math.round(dims.h * scale * EMU_PER_PX);

      const drawingXml =
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
        '<xdr:wsDr xmlns:xdr="http://schemas.openxmlformats.org/drawingml/2006/spreadsheetDrawing" ' +
        'xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main">' +
        '<xdr:oneCellAnchor>' +
        '<xdr:from><xdr:col>0</xdr:col><xdr:colOff>0</xdr:colOff><xdr:row>0</xdr:row><xdr:rowOff>0</xdr:rowOff></xdr:from>' +
        `<xdr:ext cx="${cx}" cy="${cy}"/>` +
        '<xdr:pic>' +
        '<xdr:nvPicPr><xdr:cNvPr id="1" name="Logo"/><xdr:cNvPicPr/></xdr:nvPicPr>' +
        '<xdr:blipFill><a:blip xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" ' +
        'r:embed="rId1"/><a:stretch><a:fillRect/></a:stretch></xdr:blipFill>' +
        '<xdr:spPr><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></xdr:spPr>' +
        '</xdr:pic>' +
        '<xdr:clientData/>' +
        '</xdr:oneCellAnchor>' +
        '</xdr:wsDr>';

      const drawingRels =
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
        '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
        '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" ' +
        'Target="/xl/media/image1.png"/></Relationships>';

      const sheetRels =
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
        '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
        '<Relationship Id="rIdDrawing1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/drawing" ' +
        'Target="/xl/drawings/drawing1.xml"/></Relationships>';

      zip["xl/media/image1.png"] = logoBuf;
      zip["xl/drawings/drawing1.xml"] = fflate.strToU8(drawingXml);
      zip["xl/drawings/_rels/drawing1.xml.rels"] = fflate.strToU8(drawingRels);
      zip["xl/worksheets/_rels/sheet1.xml.rels"] = fflate.strToU8(sheetRels);

      sheetXml = sheetXml.replace("</worksheet>", '<drawing r:id="rIdDrawing1"/></worksheet>');

      let contentTypes = fflate.strFromU8(zip["[Content_Types].xml"]);
      if (!contentTypes.includes("/xl/drawings/drawing1.xml")) {
        contentTypes = contentTypes.replace(
          "</Types>",
          '<Override PartName="/xl/drawings/drawing1.xml" ' +
          'ContentType="application/vnd.openxmlformats-officedocument.drawing+xml"/></Types>'
        );
      }
      zip["[Content_Types].xml"] = fflate.strToU8(contentTypes);
    }
  } catch (ex) {
    console.warn("No se pudo insertar el logo en el Excel:", ex);
  }

  zip["xl/worksheets/sheet1.xml"] = fflate.strToU8(sheetXml);
  return fflate.zipSync(zip, { level: 6 });
}

$("btnExportXlsx").addEventListener("click", () => {
  const { year, month } = currentPeriod();
  const rows = buildMonthRows(monthEntries(state.entries, year, month), state.config.contract_hours);
  const totals = computeTotals(rows, state.config);
  const projectRows = buildMonthProjects(monthEntries(state.projects, year, month));
  Promise.resolve(generateXlsx(rows, totals, projectRows, state.config, state.config.employee_name, year, month))
    .then(() => toast("Informe generado y descargado."))
    .catch((err) => {
      console.error(err);
      toast("No se pudo generar el informe: " + err.message);
    });
});

/* ---------------------------------------------------------------------
   Arranque
   --------------------------------------------------------------------- */
function init() {
  initPeriodControls();
  $("f_date").value = todayISO();
  $("p_date").value = todayISO();
  resetForm();
  resetProjectForm();
  fillConfigForm();
  renderAll();

  if ("serviceWorker" in navigator) {
    navigator.serviceWorker.register("sw.js").catch(() => {});
  }
}
init();
