/**
 * CRONOGRAMA → GITLAB SYNC
 * =========================
 * Planificas en Google Sheets, se sincroniza a GitLab Issues.
 *
 * CONFIGURACIÓN INICIAL:
 *   GITLAB_URL  = "https://gitlab.com" (o tu instancia)
 *   PROJECT_ID  = "12345" (o "grupo/proyecto")
 *   TOKEN       = "glpat-..." (GitLab Personal Access Token)
 *
 * ESTRUCTURA DE LA HOJA (Fila 1 = encabezado):
 *   A: ID      | B: Módulo | C: Submódulo | D: Tarea
 *   E: Responsable | F: Horas | G: Prioridad | H: Estado
 *   I: Sprint  | J: GitLab Issue URL
 */

// ─── CONFIG ────────────────────────────────────────────────────
var GITLAB_URL = "https://gitlab.com";       // o https://gitlab.tudominio.com
var PROJECT_ID = "12345";                     // ID numérico o "grupo/proyecto"
var TOKEN      = "glpat-XXXXXXXXXXXXXX";     // Token de acceso personal

// ─── MENÚ ──────────────────────────────────────────────────────
function onOpen() {
  var ui = SpreadsheetApp.getUi();
  ui.createMenu("📋 Cronograma")
    .addItem("Push a GitLab", "pushToGitLab")
    .addItem("Pull desde GitLab", "pullFromGitLab")
    .addSeparator()
    .addItem("Generar Gantt", "generateGantt")
    .addItem("Resumen equipo", "generateTeamSummary")
    .addSeparator()
    .addItem("Limpiar todo", "clearAll")
    .addItem("Ayuda", "showHelp")
    .addToUi();
}

// ─── LEER DATOS DE LA HOJA ─────────────────────────────────────
function readSheetData() {
  var sheet = SpreadsheetApp.getActiveSheet();
  var data = sheet.getDataRange().getValues();
  if (data.length < 2) throw new Error("La hoja solo tiene encabezado. Agrega tareas.");

  var headers = data[0];
  var tasks = [];
  for (var r = 1; r < data.length; r++) {
    var row = data[r];
    var id = (row[0] || "").toString().trim();
    if (!id && !row[3]) continue; // saltar filas vacías

    tasks.push({
      row: r + 1,
      id: id || generateId(row),
      module: (row[1] || "").toString().trim(),
      submodule: (row[2] || "").toString().trim(),
      task: (row[3] || "").toString().trim(),
      assignee: (row[4] || "").toString().trim(),
      hours: row[5] || 0,
      priority: (row[6] || "").toString().trim(),
      status: (row[7] || "Pendiente").toString().trim(),
      sprint: (row[8] || "").toString().trim(),
      url: (row[9] || "").toString().trim()
    });
  }
  return { sheet, tasks, headers };
}

// ─── GENERAR ID AUTO ──────────────────────────────────────────
function generateId(row) {
  var module = (row[1] || "M00").toString().trim().match(/M\d+/);
  var prefix = module ? module[0] : "M00";
  var n = Math.floor(Math.random() * 900) + 100;
  return prefix + "-" + n;
}

// ─── ESCRIBIR CELDA ────────────────────────────────────────────
function setCell(sheet, row, col, value) {
  sheet.getRange(row, col).setValue(value);
}

// ─── ─── ─── ─── ─── ─── ─── ─── ─── ─── ─── ─── ───
//  PUSH: Sheets → GitLab
// ─── ─── ─── ─── ─── ─── ─── ─── ─── ─── ─── ─── ───
function pushToGitLab() {
  try {
    var { sheet, tasks } = readSheetData();
    var count = { created: 0, updated: 0, skipped: 0 };

    for (var i = 0; i < tasks.length; i++) {
      var t = tasks[i];
      if (!t.task) { count.skipped++; continue; }

      var title = "[" + t.module + "] " + t.task;
      var desc = "**Módulo:** " + t.module + "\n"
               + "**Submódulo:** " + t.submodule + "\n"
               + "**ID Plan:** " + t.id + "\n"
               + "**Responsable:** " + t.assignee + "\n"
               + "**Horas:** " + t.hours + "\n"
               + "**Prioridad:** " + t.priority + "\n"
               + "**Sprint:** " + t.sprint + "\n"
               + "**Estado:** " + t.status;

      var labels = [
        "Modulo::" + t.module,
        "Sprint::" + t.sprint,
        "Prioridad::" + t.priority,
        "Estado::" + t.status,
        t.assignee ? "Responsable::" + t.assignee : ""
      ].filter(Boolean);

      if (t.url) {
        // UPDATE issue existente
        var issueId = extractIssueId(t.url);
        if (issueId) {
          updateGitLabIssue(issueId, title, desc, labels, t.status);
          count.updated++;
        }
      } else {
        // CREATE issue nuevo
        var url = createGitLabIssue(title, desc, labels);
        setCell(sheet, t.row, 10, url); // col J = GitLab Issue URL
        setCell(sheet, t.row, 1, t.id); // col A = ID
        count.created++;
      }
    }

    SpreadsheetApp.getUi().alert(
      "✅ Push completado\n\n"
      + "Creados: " + count.created + "\n"
      + "Actualizados: " + count.updated + "\n"
      + "Saltados: " + count.skipped
    );
  } catch (e) {
    SpreadsheetApp.getUi().alert("❌ Error: " + e.message);
  }
}

function extractIssueId(url) {
  var m = url.match(/issues\/(\d+)/);
  return m ? m[1] : null;
}

function gitLabApi(path, method, payload) {
  var url = GITLAB_URL + "/api/v4/projects/" + encodeURIComponent(PROJECT_ID) + path;
  var options = {
    method: method || "GET",
    headers: {
      "PRIVATE-TOKEN": TOKEN,
      "Content-Type": "application/json"
    },
    muteHttpExceptions: true
  };
  if (payload) options.payload = JSON.stringify(payload);
  var resp = UrlFetchApp.fetch(url, options);
  var code = resp.getResponseCode();
  var body = JSON.parse(resp.getContentText());
  if (code >= 400) throw new Error("GitLab API " + code + ": " + (body.message || JSON.stringify(body)));
  return body;
}

function createGitLabIssue(title, desc, labels) {
  var body = gitLabApi("/issues", "POST", {
    title: title,
    description: desc,
    labels: labels.join(","),
    weight: 1
  });
  return body.web_url;
}

function updateGitLabIssue(id, title, desc, labels, status) {
  var state = (status === "Completado") ? "close" : "open";
  gitLabApi("/issues/" + id, "PUT", {
    title: title,
    description: desc,
    labels: labels.join(","),
    state_event: state
  });
}

// ─── ─── ─── ─── ─── ─── ─── ─── ─── ─── ─── ─── ───
//  PULL: GitLab → Sheets
// ─── ─── ─── ─── ─── ─── ─── ─── ─── ─── ─── ─── ───
function pullFromGitLab() {
  try {
    var { sheet, tasks } = readSheetData();
    var issues = gitLabApi("/issues?per_page=100&state=all", "GET");
    var count = 0;

    for (var i = 0; i < issues.length; i++) {
      var gl = issues[i];
      var matched = false;

      // Buscar si ya existe en el sheets por URL
      for (var j = 0; j < tasks.length; j++) {
        if (tasks[j].url === gl.web_url) {
          // Actualizar estado desde GitLab
          var glStatus = mapGitLabState(gl.state, gl.labels);
          setCell(sheet, tasks[j].row, 8, glStatus); // col H = Estado
          matched = true;
          count++;
          break;
        }
      }

      // Si no existe y tiene label de módulo, agregarlo
      if (!matched) {
        var modLabel = extractLabel(gl.labels, "Modulo");
        if (modLabel) {
          var lastRow = sheet.getLastRow() + 1;
          setCell(sheet, lastRow, 1, "GL-" + gl.iid);
          setCell(sheet, lastRow, 2, modLabel);
          setCell(sheet, lastRow, 4, gl.title);
          setCell(sheet, lastRow, 7, extractLabel(gl.labels, "Prioridad") || "Media");
          setCell(sheet, lastRow, 8, mapGitLabState(gl.state, gl.labels));
          setCell(sheet, lastRow, 9, extractLabel(gl.labels, "Sprint") || "");
          setCell(sheet, lastRow, 10, gl.web_url);
          count++;
        }
      }
    }

    SpreadsheetApp.getUi().alert("✅ Pull completado\n" + count + " issues sincronizados.");
  } catch (e) {
    SpreadsheetApp.getUi().alert("❌ Error: " + e.message);
  }
}

function mapGitLabState(state, labels) {
  if (state === "closed") return "Completado";
  var estado = extractLabel(labels, "Estado");
  return estado || (state === "opened" ? "En Progreso" : "Pendiente");
}

function extractLabel(labels, prefix) {
  if (!labels) return null;
  for (var i = 0; i < labels.length; i++) {
    var l = labels[i].includes("::") ? labels[i] : labels[i].title || "";
    if (l.startsWith(prefix + "::")) return l.split("::")[1];
  }
  return null;
}

// ─── ─── ─── ─── ─── ─── ─── ─── ─── ─── ─── ─── ───
//  GENERAR GANTT
// ─── ─── ─── ─── ─── ─── ─── ─── ─── ─── ─── ─── ───
function generateGantt() {
  try {
    var ss = SpreadsheetApp.getActiveSpreadsheet();
    var ganttSheet = ss.getSheetByName("Gantt");
    if (ganttSheet) ss.deleteSheet(ganttSheet);
    ganttSheet = ss.insertSheet("Gantt");

    var { tasks } = readSheetData();
    if (!tasks.length) throw new Error("No hay tareas.");

    // Calcular semanas del proyecto (13 Jul 2026 → 8 Ene 2027)
    var startDate = new Date(2026, 6, 13);
    var endDate = new Date(2027, 0, 8);
    var weeks = [];
    var d = new Date(startDate);
    while (d <= endDate) {
      weeks.push(new Date(d));
      d.setDate(d.getDate() + 7);
    }

    // Encabezado
    ganttSheet.getRange(1, 1).setValue("Tarea");
    ganttSheet.getRange(1, 2).setValue("Responsable");
    ganttSheet.getRange(1, 2).setFontWeight("bold");
    ganttSheet.getRange(1, 1).setFontWeight("bold");
    for (var w = 0; w < weeks.length; w++) {
      var col = w + 3;
      var header = Utilities.formatDate(weeks[w], "GMT-4", "dd/MM");
      ganttSheet.getRange(1, col).setValue(header);
      ganttSheet.getRange(1, col).setFontWeight("bold");
      ganttSheet.setColumnWidth(col, 70);
    }

    // Filas
    var modules = {};
    for (var i = 0; i < tasks.length; i++) {
      var t = tasks[i];
      if (!modules[t.module]) modules[t.module] = [];
      modules[t.module].push(t);
    }

    var row = 2;
    var colors = {
      "Pendiente": "#e0e0e0",
      "En Progreso": "#64b5f6",
      "En QA": "#fff176",
      "Completado": "#81c784",
      "Bloqueado": "#e57373"
    };

    Object.keys(modules).forEach(function(mod) {
      ganttSheet.getRange(row, 1).setValue("📦 " + mod);
      ganttSheet.getRange(row, 1).setFontWeight("bold");
      ganttSheet.getRange(row, 1, 1, 2).setBackground("#e8eaf6");
      row++;

      modules[mod].forEach(function(t) {
        ganttSheet.getRange(row, 1).setValue(t.task);
        ganttSheet.getRange(row, 2).setValue(t.assignee);

        // Pintar semana actual
        var weekCol = getWeekColumn(weeks, new Date());
        if (weekCol) {
          var color = colors[t.status] || "#e0e0e0";
          ganttSheet.getRange(row, weekCol).setBackground(color);
          ganttSheet.getRange(row, weekCol).setValue(t.status.charAt(0));
        }
        row++;
      });
    });

    ganttSheet.setColumnWidth(1, 350);
    ganttSheet.setColumnWidth(2, 100);
    ganttSheet.getRange(1, 1, 1, weeks.length + 2).setBackground("#e0e0e0");
  } catch (e) {
    SpreadsheetApp.getUi().alert("❌ Error Gantt: " + e.message);
  }
}

function getWeekColumn(weeks, date) {
  for (var i = 0; i < weeks.length; i++) {
    var diff = (date - weeks[i]) / (7 * 24 * 60 * 60 * 1000);
    if (diff >= 0 && diff < 1) return i + 3;
  }
  return weeks.length + 2; // última columna
}

// ─── ─── ─── ─── ─── ─── ─── ─── ─── ─── ─── ─── ───
//  RESUMEN EQUIPO
// ─── ─── ─── ─── ─── ─── ─── ─── ─── ─── ─── ─── ───
function generateTeamSummary() {
  try {
    var ss = SpreadsheetApp.getActiveSpreadsheet();
    var teamSheet = ss.getSheetByName("Equipo");
    if (teamSheet) ss.deleteSheet(teamSheet);
    teamSheet = ss.insertSheet("Equipo");

    var { tasks } = readSheetData();

    // Agrupar por responsable
    var summary = {};
    tasks.forEach(function(t) {
      if (!t.assignee) return;
      if (!summary[t.assignee]) summary[t.assignee] = { total: 0, pendiente: 0, progreso: 0, qa: 0, completo: 0 };
      summary[t.assignee].total += Number(t.hours) || 0;
      if (t.status === "Completado") summary[t.assignee].completo += Number(t.hours) || 0;
      else if (t.status === "En QA") summary[t.assignee].qa += Number(t.hours) || 0;
      else if (t.status === "En Progreso") summary[t.assignee].progreso += Number(t.hours) || 0;
      else summary[t.assignee].pendiente += Number(t.hours) || 0;
    });

    // Encabezado
    var headers = [["Responsable", "Total h", "Pendiente", "En Progreso", "En QA", "Completado", "Avance %"]];
    teamSheet.getRange(1, 1, 1, 7).setValues(headers);
    teamSheet.getRange(1, 1, 1, 7).setFontWeight("bold").setBackground("#e8eaf6");

    var row = 2;
    Object.keys(summary).sort().forEach(function(person) {
      var s = summary[person];
      var avance = s.total > 0 ? Math.round((s.completo / s.total) * 100) : 0;
      teamSheet.getRange(row, 1).setValue(person);
      teamSheet.getRange(row, 2).setValue(s.total);
      teamSheet.getRange(row, 3).setValue(s.pendiente);
      teamSheet.getRange(row, 4).setValue(s.progreso);
      teamSheet.getRange(row, 5).setValue(s.qa);
      teamSheet.getRange(row, 6).setValue(s.completo);
      teamSheet.getRange(row, 7).setValue(avance + "%");
      row++;
    });

    // Totales
    var totals = { total: 0, pendiente: 0, progreso: 0, qa: 0, completo: 0 };
    Object.values(summary).forEach(function(s) {
      totals.total += s.total;
      totals.pendiente += s.pendiente;
      totals.progreso += s.progreso;
      totals.qa += s.qa;
      totals.completo += s.completo;
    });
    var avanceTotal = totals.total > 0 ? Math.round((totals.completo / totals.total) * 100) : 0;
    teamSheet.getRange(row, 1).setValue("TOTAL").setFontWeight("bold");
    teamSheet.getRange(row, 2).setValue(totals.total).setFontWeight("bold");
    teamSheet.getRange(row, 3).setValue(totals.pendiente);
    teamSheet.getRange(row, 4).setValue(totals.progreso);
    teamSheet.getRange(row, 5).setValue(totals.qa);
    teamSheet.getRange(row, 6).setValue(totals.completo).setFontWeight("bold");
    teamSheet.getRange(row, 7).setValue(avanceTotal + "%").setFontWeight("bold");

    for (var c = 1; c <= 7; c++) teamSheet.autoResizeColumn(c);
  } catch (e) {
    SpreadsheetApp.getUi().alert("❌ Error Resumen: " + e.message);
  }
}

// ─── ─── ─── ─── ─── ─── ─── ─── ─── ─── ─── ─── ───
//  UTILIDADES
// ─── ─── ─── ─── ─── ─── ─── ─── ─── ─── ─── ─── ───
function clearAll() {
  var ui = SpreadsheetApp.getUi();
  var resp = ui.alert("¿Borrar todas las tareas?", ui.ButtonSet.YES_NO);
  if (resp !== ui.Button.YES) return;
  var sheet = SpreadsheetApp.getActiveSheet();
  var last = sheet.getLastRow();
  if (last > 1) sheet.getRange(2, 1, last - 1, 10).clearContent();
  ui.alert("✅ Hoja limpiada.");
}

function showHelp() {
  var html = HtmlService.createHtmlOutput(
    "<h3>📋 Cronograma Sync</h3>"
    + "<p><b>Push a GitLab</b>: Crea o actualiza issues desde el Sheets</p>"
    + "<p><b>Pull desde GitLab</b>: Trae cambios de GitLab al Sheets</p>"
    + "<p><b>Columnas:</b><br>"
    + "A: ID único<br>"
    + "B-D: Módulo / Submódulo / Tarea<br>"
    + "E: Responsable (username GitLab)<br>"
    + "F: Horas estimadas<br>"
    + "G: Prioridad (Alta/Media/Baja)<br>"
    + "H: Estado (Pendiente/En Progreso/En QA/Completado/Bloqueado)<br>"
    + "I: Sprint<br>"
    + "J: URL GitLab Issue (se llena automáticamente al hacer push)</p>"
    + "<p><b>Tokens:</b> ve a GitLab → Settings → Access Tokens → crea uno con scope 'api'</p>"
    + "<hr><p style='color:#666'>v1.0</p>"
  ).setWidth(500).setHeight(400);
  SpreadsheetApp.getUi().showModalDialog(html, "📋 Ayuda");
}
