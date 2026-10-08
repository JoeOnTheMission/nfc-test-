/**
 * Tap-to-Attend Google Apps Script Backend
 * Timezone: Africa/Addis_Ababa
 */

function doGet(e) {
  return ContentService.createTextOutput(
    JSON.stringify({ ok: true, service: "tap-attendance" })
  ).setMimeType(ContentService.MimeType.JSON);
}

function doPost(e) {
  return ContentService.createTextOutput(
    JSON.stringify({ ok: true, status: "ready" })
  ).setMimeType(ContentService.MimeType.JSON);
}
