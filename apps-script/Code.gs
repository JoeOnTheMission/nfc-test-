/**
 * Tap-to-Attend Google Apps Script Backend
 * Timezone: Africa/Addis_Ababa
 */

const TIMEZONE = "Africa/Addis_Ababa";

/**
 * Normalizes UID: trim, lowercase, colon-separated hex pairs.
 */
function normalizeUid(rawUid) {
  if (!rawUid) return "";
  return String(rawUid).trim().toLowerCase();
}

/**
 * Format timestamp in Africa/Addis_Ababa
 */
function formatTimestamp(date) {
  return Utilities.formatDate(date || new Date(), TIMEZONE, "yyyy-MM-dd HH:mm:ss");
}

/**
 * Sanitizes course name for Google Sheets tab naming:
 * removes [ ] * ? : / \ and caps length at 100 chars.
 */
function sanitizeTabName(name) {
  if (!name) return "Course";
  const sanitized = name.replace(/[\[\]*?:/\\]/g, " ").trim();
  return (sanitized.length > 100 ? sanitized.substring(0, 100) : sanitized) || "Course";
}

/**
 * Helper to convert 1-based column index to letter (1 -> A, 2 -> B, 27 -> AA)
 */
function getColumnLetter(colIndex) {
  let temp, letter = '';
  while (colIndex > 0) {
    temp = (colIndex - 1) % 26;
    letter = String.fromCharCode(temp + 65) + letter;
    colIndex = Math.floor((colIndex - temp - 1) / 26);
  }
  return letter;
}

/**
 * Setup function (from Step 1)
 */
function setup() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const privateSheetId = ss.getId();
  
  const tabs = [
    { name: "Registry", headers: ["StudentID", "Name", "UID", "RegisteredAt"] },
    { name: "Courses", headers: ["CourseName"] },
    { name: "Sessions", headers: ["SessionKey", "Course", "Date", "StartedAt", "ViewColumn"] },
    { name: "Log", headers: ["ReceivedAt", "TapTime", "TapId", "SessionKey", "UID", "StudentID", "Name", "Method", "Result", "Reason"] },
    { name: "Audit", headers: ["Timestamp", "Action", "StudentID", "UID", "Note"] }
  ];

  tabs.forEach(tabInfo => {
    let sheet = ss.getSheetByName(tabInfo.name);
    if (!sheet) sheet = ss.insertSheet(tabInfo.name);
    
    const headerRange = sheet.getRange(1, 1, 1, tabInfo.headers.length);
    headerRange.setValues([tabInfo.headers]);
    headerRange.setFontWeight("bold");
    
    const maxRows = Math.max(sheet.getMaxRows(), 100);
    const maxCols = Math.max(sheet.getMaxColumns(), tabInfo.headers.length);
    sheet.getRange(1, 1, maxRows, maxCols).setNumberFormat("@");
    sheet.setFrozenRows(1);
  });

  const defaultSheet = ss.getSheetByName("Sheet1");
  if (defaultSheet && ss.getSheets().length > 1) {
    try { ss.deleteSheet(defaultSheet); } catch (e) {}
  }

  const scriptProps = PropertiesService.getScriptProperties();
  let publicSheetId = scriptProps.getProperty("PUBLIC_SHEET_ID");
  let publicSpreadsheet;

  if (publicSheetId) {
    try {
      publicSpreadsheet = SpreadsheetApp.openById(publicSheetId);
    } catch (e) {
      publicSpreadsheet = null;
    }
  }

  if (!publicSpreadsheet) {
    publicSpreadsheet = SpreadsheetApp.create("Attendance View");
    publicSheetId = publicSpreadsheet.getId();
  }

  scriptProps.setProperties({
    "PRIVATE_SHEET_ID": privateSheetId,
    "PUBLIC_SHEET_ID": publicSheetId
  });

  Logger.log("Setup complete. Private ID: " + privateSheetId + " | Public ID: " + publicSheetId);
}

/**
 * Standard GET handler
 */
function doGet(e) {
  return ContentService.createTextOutput(
    JSON.stringify({ ok: true, service: "tap-attendance" })
  ).setMimeType(ContentService.MimeType.JSON);
}

/**
 * Main POST handler
 */
function doPost(e) {
  const lock = LockService.getScriptLock();
  try {
    const hasLock = lock.tryLock(30000);
    if (!hasLock) {
      return makeJsonResponse({ ok: false, error: "busy", message: "Server is busy processing another sync" });
    }
  } catch (err) {
    return makeJsonResponse({ ok: false, error: "busy", message: "Lock timeout: " + err.message });
  }

  try {
    let payload;
    try {
      payload = JSON.parse(e.postData.contents);
    } catch (parseErr) {
      return makeJsonResponse({ ok: false, error: "invalid_json" });
    }

    const scriptProps = PropertiesService.getScriptProperties();
    const correctPin = scriptProps.getProperty("PIN");
    
    if (!payload.pin || String(payload.pin) !== String(correctPin)) {
      return makeJsonResponse({ ok: false, error: "bad_pin" });
    }

    const action = payload.action;
    const privateSheetId = scriptProps.getProperty("PRIVATE_SHEET_ID");
    const publicSheetId = scriptProps.getProperty("PUBLIC_SHEET_ID");
    
    const privateSs = privateSheetId ? SpreadsheetApp.openById(privateSheetId) : SpreadsheetApp.getActiveSpreadsheet();
    const publicSs = publicSheetId ? SpreadsheetApp.openById(publicSheetId) : null;

    if (!privateSs) {
      return makeJsonResponse({ ok: false, error: "server_error", message: "Private spreadsheet not found" });
    }

    switch (action) {
      case "ping":
        return makeJsonResponse({ ok: true, serverTime: formatTimestamp(new Date()) });

      case "get_bootstrap":
        return handleGetBootstrap(privateSs);

      case "sync":
        return handleSync(privateSs, publicSs, payload);

      case "register":
        return handleRegister(privateSs, payload);

      default:
        return makeJsonResponse({ ok: false, error: "bad_action" });
    }

  } catch (err) {
    Logger.log("doPost error: " + err.stack);
    return makeJsonResponse({ ok: false, error: "server_error", message: err.message });
  } finally {
    try {
      lock.releaseLock();
    } catch (e) {}
  }
}

function makeJsonResponse(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}

/**
 * Handle get_bootstrap action
 */
function handleGetBootstrap(privateSs) {
  const coursesSheet = privateSs.getSheetByName("Courses");
  const registrySheet = privateSs.getSheetByName("Registry");

  let courses = [];
  if (coursesSheet && coursesSheet.getLastRow() >= 2) {
    const courseValues = coursesSheet.getRange(2, 1, coursesSheet.getLastRow() - 1, 1).getValues();
    courses = courseValues.map(r => String(r[0]).trim()).filter(Boolean);
  }

  let registry = [];
  if (registrySheet && registrySheet.getLastRow() >= 2) {
    const regValues = registrySheet.getRange(2, 1, registrySheet.getLastRow() - 1, 4).getValues();
    registry = regValues.map(r => ({
      studentId: String(r[0]).trim(),
      name: String(r[1]).trim(),
      uid: normalizeUid(r[2]),
      registeredAt: r[3] ? String(r[3]) : ""
    })).filter(r => r.studentId || r.name);
  }

  return makeJsonResponse({
    ok: true,
    courses: courses,
    registry: registry.map(r => ({ studentId: r.studentId, name: r.name, uid: r.uid })),
    serverTime: formatTimestamp(new Date())
  });
}

/**
 * Helper to fetch full Registry records
 */
function getRegistryData(registrySheet) {
  if (!registrySheet || registrySheet.getLastRow() < 2) return [];
  const rows = registrySheet.getRange(2, 1, registrySheet.getLastRow() - 1, 4).getValues();
  return rows.map((r, idx) => ({
    rowIndex: idx + 2, // 1-based sheet row
    studentIndex: idx, // 0-based student list index
    studentId: String(r[0]).trim(),
    name: String(r[1]).trim(),
    uid: normalizeUid(r[2]),
    registeredAt: r[3] ? String(r[3]) : ""
  })).filter(r => r.studentId || r.name);
}

/**
 * Handle register action
 */
function handleRegister(privateSs, payload) {
  const studentId = String(payload.studentId || "").trim();
  const rawUid = payload.uid;
  const replace = payload.replace === true;
  const uid = normalizeUid(rawUid);

  if (!studentId || !uid) {
    return makeJsonResponse({ ok: false, error: "bad_params", message: "studentId and uid are required" });
  }

  const registrySheet = privateSs.getSheetByName("Registry");
  const auditSheet = privateSs.getSheetByName("Audit");
  const registry = getRegistryData(registrySheet);

  const targetStudent = registry.find(s => s.studentId === studentId);
  if (!targetStudent) {
    return makeJsonResponse({ ok: false, error: "unknown_student" });
  }

  const existingOwner = registry.find(s => s.uid === uid && s.studentId !== studentId);
  if (existingOwner) {
    return makeJsonResponse({ ok: false, error: "uid_taken", ownerName: existingOwner.name });
  }

  if (targetStudent.uid && targetStudent.uid !== "" && !replace) {
    return makeJsonResponse({ ok: false, error: "student_already_registered", currentUid: targetStudent.uid });
  }

  const timestamp = formatTimestamp(new Date());
  const oldUid = targetStudent.uid;

  // Update Registry row (Column C: UID, Column D: RegisteredAt)
  registrySheet.getRange(targetStudent.rowIndex, 3, 1, 2).setValues([[uid, timestamp]]);

  // Audit log
  if (auditSheet) {
    const actionName = (oldUid && oldUid !== "") ? "replace" : "register";
    const note = (oldUid && oldUid !== "") ? ("Replaced old UID: " + oldUid) : "Initial registration";
    const auditRow = [timestamp, actionName, studentId, uid, note];
    auditSheet.getRange(Math.max(auditSheet.getLastRow() + 1, 2), 1, 1, auditRow.length).setValues([auditRow]);
  }

  // Late-resolve: retroactively mark past unknown_uid logs for this UID as present
  const logSheet = privateSs.getSheetByName("Log");
  const sessionsSheet = privateSs.getSheetByName("Sessions");
  const scriptProps = PropertiesService.getScriptProperties();
  const publicSheetId = scriptProps.getProperty("PUBLIC_SHEET_ID");
  const publicSs = publicSheetId ? SpreadsheetApp.openById(publicSheetId) : null;

  let lateResolvedCount = 0;
  if (logSheet && logSheet.getLastRow() >= 2) {
    const logRows = logSheet.getRange(2, 1, logSheet.getLastRow() - 1, 10).getValues();
    let logsChanged = false;

    // Load sessions map: sessionKey -> { course, viewColumn }
    const sessionMap = {};
    if (sessionsSheet && sessionsSheet.getLastRow() >= 2) {
      const sRows = sessionsSheet.getRange(2, 1, sessionsSheet.getLastRow() - 1, 5).getValues();
      sRows.forEach(sr => {
        sessionMap[String(sr[0])] = { course: String(sr[1]), viewColumn: Number(sr[4]) };
      });
    }

    logRows.forEach((row, idx) => {
      const rowUid = normalizeUid(row[4]);
      const rowResult = String(row[8]);

      if (rowUid === uid && rowResult === "unknown_uid") {
        row[5] = targetStudent.studentId; // StudentID
        row[6] = targetStudent.name;      // Name
        row[8] = "present";               // Result
        logsChanged = true;
        lateResolvedCount++;

        // Update public grid cell
        const sessKey = String(row[3]);
        const sInfo = sessionMap[sessKey];
        if (sInfo && publicSs) {
          const tabName = sanitizeTabName(sInfo.course);
          const courseSheet = publicSs.getSheetByName(tabName);
          if (courseSheet && sInfo.viewColumn) {
            const studentGridRow = targetStudent.studentIndex + 3;
            courseSheet.getRange(studentGridRow, sInfo.viewColumn).setValue("P");
          }
        }
      }
    });

    if (logsChanged) {
      logSheet.getRange(2, 1, logRows.length, 10).setValues(logRows);
    }
  }

  // Fetch updated registry for response
  const updatedRegistry = getRegistryData(registrySheet).map(r => ({
    studentId: r.studentId,
    name: r.name,
    uid: r.uid
  }));

  return makeJsonResponse({
    ok: true,
    registry: updatedRegistry,
    lateResolvedCount: lateResolvedCount
  });
}

/**
 * Ensure course tab and grid structure exist in Public View Sheet
 */
function ensureCourseGrid(publicSs, courseName, registryStudents) {
  const tabName = sanitizeTabName(courseName);
  let sheet = publicSs.getSheetByName(tabName);
  
  if (!sheet) {
    sheet = publicSs.insertSheet(tabName);
    sheet.getRange("A1").setValue("Student").setFontWeight("bold");
    sheet.getRange("A2").setValue("Present").setFontWeight("bold");
    sheet.setFrozenRows(2);
    sheet.setFrozenColumns(1);
  }

  // Ensure student names in column A match registry
  const numStudents = registryStudents.length;
  if (numStudents > 0) {
    const currentLastRow = sheet.getLastRow();
    const existingNamesRange = currentLastRow >= 3 ? sheet.getRange(3, 1, currentLastRow - 2, 1).getValues() : [];
    const existingCount = existingNamesRange.length;

    if (numStudents > existingCount) {
      const namesToWrite = registryStudents.map(s => [s.name]);
      sheet.getRange(3, 1, numStudents, 1).setValues(namesToWrite);

      // If new students were added and there are existing session columns, backfill 'A' for them
      const lastCol = sheet.getLastColumn();
      if (lastCol >= 2 && existingCount > 0) {
        const addedRows = numStudents - existingCount;
        const defaultAs = [];
        for (let r = 0; r < addedRows; r++) {
          const row = [];
          for (let c = 2; c <= lastCol; c++) row.push("A");
          defaultAs.push(row);
        }
        sheet.getRange(3 + existingCount, 2, addedRows, lastCol - 1).setValues(defaultAs);
      }
    }
  }

  return sheet;
}

/**
 * Ensure session column exists in public view sheet
 */
function ensureSessionColumn(publicSs, sessionsSheet, session, registryStudents) {
  const sessionsData = sessionsSheet.getLastRow() >= 2 
    ? sessionsSheet.getRange(2, 1, sessionsSheet.getLastRow() - 1, 5).getValues() 
    : [];

  let existingSessionRow = null;
  let existingRowIndex = -1;

  for (let i = 0; i < sessionsData.length; i++) {
    if (String(sessionsData[i][0]) === String(session.sessionKey)) {
      existingSessionRow = sessionsData[i];
      existingRowIndex = i + 2;
      break;
    }
  }

  const courseSheet = ensureCourseGrid(publicSs, session.course, registryStudents);

  if (existingSessionRow && existingSessionRow[4]) {
    // Session column already exists
    return {
      courseSheet: courseSheet,
      viewColumn: Number(existingSessionRow[4])
    };
  }

  // Allocate new column in courseSheet
  const lastCol = Math.max(courseSheet.getLastColumn(), 1);
  const newCol = lastCol + 1;
  const colLetter = getColumnLetter(newCol);

  // Format header: yyyy-MM-dd \n HH:mm
  let timePart = "00:00";
  if (session.startedAt) {
    try {
      const d = new Date(session.startedAt);
      timePart = Utilities.formatDate(d, TIMEZONE, "HH:mm");
    } catch (e) {
      timePart = String(session.startedAt).substring(11, 16) || "00:00";
    }
  }
  const headerText = `${session.date}\n${timePart}`;

  courseSheet.getRange(1, newCol).setValue(headerText).setFontWeight("bold").setWrap(true);
  
  // Set formula for total present in row 2
  const formula = `=COUNTIF(${colLetter}3:${colLetter},"P")`;
  courseSheet.getRange(2, newCol).setFormula(formula).setFontWeight("bold");

  // Initialize all students to 'A'
  const numStudents = registryStudents.length;
  if (numStudents > 0) {
    const initialA = registryStudents.map(() => ["A"]);
    courseSheet.getRange(3, newCol, numStudents, 1).setValues(initialA);
  }

  // Apply conditional formatting rules for P and A if not already applied
  applyConditionalFormatting(courseSheet);

  // Record session in Sessions tab
  const newSessionRecord = [
    session.sessionKey,
    session.course,
    session.date,
    session.startedAt || formatTimestamp(new Date()),
    newCol
  ];

  if (existingRowIndex > 0) {
    sessionsSheet.getRange(existingRowIndex, 1, 1, 5).setValues([newSessionRecord]);
  } else {
    const targetRow = Math.max(sessionsSheet.getLastRow() + 1, 2);
    sessionsSheet.getRange(targetRow, 1, 1, 5).setValues([newSessionRecord]);
  }

  return {
    courseSheet: courseSheet,
    viewColumn: newCol
  };
}

/**
 * Apply conditional formatting rules to public course grid (P = green, A = light red)
 */
function applyConditionalFormatting(sheet) {
  const rules = sheet.getConditionalFormatRules();
  if (rules.length >= 2) return; // already configured

  const dataRange = sheet.getRange("B3:Z100");

  const pRule = SpreadsheetApp.newConditionalFormatRule()
    .whenTextEqualTo("P")
    .setBackground("#dcfce7")
    .setFontColor("#166534")
    .setRanges([dataRange])
    .build();

  const aRule = SpreadsheetApp.newConditionalFormatRule()
    .whenTextEqualTo("A")
    .setBackground("#fee2e2")
    .setFontColor("#991b1b")
    .setRanges([dataRange])
    .build();

  sheet.setConditionalFormatRules([pRule, aRule]);
}

/**
 * Handle sync action
 */
function handleSync(privateSs, publicSs, payload) {
  const sessions = payload.sessions || [];
  const events = payload.events || [];

  const registrySheet = privateSs.getSheetByName("Registry");
  const sessionsSheet = privateSs.getSheetByName("Sessions");
  const logSheet = privateSs.getSheetByName("Log");

  const registry = getRegistryData(registrySheet);

  // 1. Process and ensure sessions
  const sessionColumnMap = {};
  sessions.forEach(sess => {
    if (sess.sessionKey && sess.course) {
      const sessInfo = ensureSessionColumn(publicSs, sessionsSheet, sess, registry);
      sessionColumnMap[sess.sessionKey] = sessInfo;
    }
  });

  // 2. Read existing Log TapIds for idempotency
  const existingTapIds = new Set();
  const logLastRow = logSheet.getLastRow();
  if (logLastRow >= 2) {
    const tapIdValues = logSheet.getRange(2, 3, logLastRow - 1, 1).getValues();
    tapIdValues.forEach(r => {
      if (r[0]) existingTapIds.add(String(r[0]));
    });
  }

  // Sort events chronologically by tapTime
  events.sort((a, b) => (a.tapTime || "").localeCompare(b.tapTime || ""));

  const results = [];
  const newLogRows = [];
  const gridUpdates = {}; // { tabName: { col: { row: 'P' } } }
  const receivedAt = formatTimestamp(new Date());

  // In-memory cache of presence per session to prevent duplicate 'P' within the batch
  const batchPresence = {}; // `${sessionKey}|${studentId}` -> true

  events.forEach(ev => {
    const tapId = String(ev.tapId || "");
    if (!tapId) return;

    if (existingTapIds.has(tapId)) {
      results.push({ tapId: tapId, status: "already_synced" });
      return;
    }

    existingTapIds.add(tapId);

    const sessionKey = String(ev.sessionKey || "");
    const sessInfo = sessionColumnMap[sessionKey] || ensureSessionColumn(publicSs, sessionsSheet, {
      sessionKey: sessionKey,
      course: sessionKey.split("|")[0] || "General",
      date: sessionKey.split("|")[1] || formatTimestamp(new Date()).substring(0, 10),
      startedAt: ev.tapTime || formatTimestamp(new Date())
    }, registry);

    sessionColumnMap[sessionKey] = sessInfo;

    const courseSheet = sessInfo.courseSheet;
    const viewCol = sessInfo.viewColumn;
    const tabName = courseSheet.getName();

    if (!gridUpdates[tabName]) gridUpdates[tabName] = {};
    if (!gridUpdates[tabName][viewCol]) gridUpdates[tabName][viewCol] = {};

    if (ev.type === "tap") {
      const uid = normalizeUid(ev.uid);
      const student = registry.find(s => s.uid === uid);

      if (!student) {
        // Unknown card
        newLogRows.push([receivedAt, ev.tapTime || receivedAt, tapId, sessionKey, uid, "", "", "tap", "unknown_uid", ""]);
        results.push({ tapId: tapId, status: "unknown_uid" });
      } else {
        const studentGridRow = student.studentIndex + 3; // Row 3 is student index 0
        const presenceKey = `${sessionKey}|${student.studentId}`;
        
        // Check if already 'P' in grid or batch
        const currentGridVal = courseSheet.getRange(studentGridRow, viewCol).getValue();
        const isAlreadyPresent = (currentGridVal === "P") || (gridUpdates[tabName][viewCol][studentGridRow] === "P") || batchPresence[presenceKey];

        if (isAlreadyPresent) {
          newLogRows.push([receivedAt, ev.tapTime || receivedAt, tapId, sessionKey, uid, student.studentId, student.name, "tap", "duplicate", ""]);
          results.push({ tapId: tapId, status: "duplicate", studentId: student.studentId, name: student.name });
        } else {
          gridUpdates[tabName][viewCol][studentGridRow] = "P";
          batchPresence[presenceKey] = true;
          newLogRows.push([receivedAt, ev.tapTime || receivedAt, tapId, sessionKey, uid, student.studentId, student.name, "tap", "present", ""]);
          results.push({ tapId: tapId, status: "present", studentId: student.studentId, name: student.name });
        }
      }
    } else if (ev.type === "manual") {
      const studentId = String(ev.studentId || "").trim();
      const reason = String(ev.reason || "").trim();
      const student = registry.find(s => s.studentId === studentId);

      if (!student || !reason) {
        newLogRows.push([receivedAt, ev.tapTime || receivedAt, tapId, sessionKey, "", studentId, "", "manual", "invalid_student", reason]);
        results.push({ tapId: tapId, status: "invalid_student" });
      } else {
        const studentGridRow = student.studentIndex + 3;
        const presenceKey = `${sessionKey}|${student.studentId}`;
        
        const currentGridVal = courseSheet.getRange(studentGridRow, viewCol).getValue();
        const isAlreadyPresent = (currentGridVal === "P") || (gridUpdates[tabName][viewCol][studentGridRow] === "P") || batchPresence[presenceKey];

        if (isAlreadyPresent) {
          newLogRows.push([receivedAt, ev.tapTime || receivedAt, tapId, sessionKey, student.uid || "", student.studentId, student.name, "manual", "duplicate", reason]);
          results.push({ tapId: tapId, status: "duplicate", studentId: student.studentId, name: student.name });
        } else {
          gridUpdates[tabName][viewCol][studentGridRow] = "P";
          batchPresence[presenceKey] = true;
          newLogRows.push([receivedAt, ev.tapTime || receivedAt, tapId, sessionKey, student.uid || "", student.studentId, student.name, "manual", "present", reason]);
          results.push({ tapId: tapId, status: "present", studentId: student.studentId, name: student.name });
        }
      }
    }
  });

  // Batch write grid updates
  Object.keys(gridUpdates).forEach(tName => {
    const sheet = publicSs.getSheetByName(tName);
    if (!sheet) return;
    const colMap = gridUpdates[tName];
    Object.keys(colMap).forEach(cIdx => {
      const rowMap = colMap[cIdx];
      Object.keys(rowMap).forEach(rIdx => {
        sheet.getRange(Number(rIdx), Number(cIdx)).setValue(rowMap[rIdx]);
      });
    });
  });

  // Batch write new log rows
  if (newLogRows.length > 0) {
    const startRow = Math.max(logSheet.getLastRow() + 1, 2);
    logSheet.getRange(startRow, 1, newLogRows.length, 10).setValues(newLogRows);
  }

  const freshRegistry = getRegistryData(registrySheet).map(r => ({
    studentId: r.studentId,
    name: r.name,
    uid: r.uid
  }));

  return makeJsonResponse({
    ok: true,
    results: results,
    registry: freshRegistry
  });
}

/**
 * Guarded reset function for development & testing.
 * Refuses to run unless script property ALLOW_RESET === "yes".
 */
function clearTestData() {
  const scriptProps = PropertiesService.getScriptProperties();
  const allowReset = scriptProps.getProperty("ALLOW_RESET");

  if (allowReset !== "yes") {
    throw new Error("Reset refused: ALLOW_RESET script property must be explicitly set to 'yes'");
  }

  const privateSheetId = scriptProps.getProperty("PRIVATE_SHEET_ID");
  const publicSheetId = scriptProps.getProperty("PUBLIC_SHEET_ID");

  const privateSs = privateSheetId ? SpreadsheetApp.openById(privateSheetId) : SpreadsheetApp.getActiveSpreadsheet();
  const publicSs = publicSheetId ? SpreadsheetApp.openById(publicSheetId) : null;

  // Clear private data tabs (keeping row 1 headers)
  ["Sessions", "Log", "Audit"].forEach(name => {
    const sheet = privateSs.getSheetByName(name);
    if (sheet && sheet.getLastRow() >= 2) {
      sheet.getRange(2, 1, sheet.getLastRow() - 1, sheet.getLastColumn()).clearContent();
    }
  });

  // Clear public course tabs
  if (publicSs) {
    const sheets = publicSs.getSheets();
    sheets.forEach(sheet => {
      try {
        if (sheets.length > 1) {
          publicSs.deleteSheet(sheet);
        } else {
          sheet.clear();
          sheet.setName("Sheet1");
        }
      } catch (e) {}
    });
  }

  Logger.log("=== Test data successfully cleared ===");
}
