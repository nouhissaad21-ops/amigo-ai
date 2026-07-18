/**
 * AmiGo AI -> Google Sheets upsert endpoint.
 *
 * Deployment:
 * 1. Create a Google Sheet and open Extensions > Apps Script.
 * 2. Paste this file.
 * 3. In Project Settings > Script properties set AMIGO_SHEETS_SECRET.
 * 4. Deploy as a Web app executed as you. Limit access as your environment permits.
 * 5. Put the deployment URL and the same secret in AmiGo's Google Sheets connector.
 */

const SHEET_NAME = "Orders";
const HEADERS = [
  "Order Number",
  "Created At",
  "Full Name",
  "Phone",
  "Wilaya",
  "Municipality",
  "Products",
  "Subtotal",
  "Delivery",
  "Total",
  "Status",
  "Last Sync",
];

function jsonResponse_(value) {
  return ContentService.createTextOutput(JSON.stringify(value)).setMimeType(
    ContentService.MimeType.JSON,
  );
}

function orderValues_(row, now) {
  return [
    String(row.orderNumber || ""),
    String(row.createdAt || ""),
    String(row.fullName || ""),
    String(row.phone || ""),
    String(row.wilaya || ""),
    String(row.municipality || ""),
    String(row.products || ""),
    Number(row.subtotal || 0),
    Number(row.delivery || 0),
    Number(row.total || 0),
    String(row.status || ""),
    now,
  ];
}

function doPost(e) {
  const lock = LockService.getScriptLock();
  try {
    const body = JSON.parse((e && e.postData && e.postData.contents) || "{}");
    const expected = PropertiesService.getScriptProperties().getProperty(
      "AMIGO_SHEETS_SECRET",
    );
    if (
      !expected ||
      typeof body.secret !== "string" ||
      body.secret !== expected
    ) {
      return jsonResponse_({ ok: false, error: "unauthorized" });
    }
    if (body.event !== "orders.sync" || !Array.isArray(body.rows)) {
      return jsonResponse_({ ok: false, error: "invalid_payload" });
    }

    lock.waitLock(30000);
    const spreadsheet = SpreadsheetApp.getActiveSpreadsheet();
    const sheet =
      spreadsheet.getSheetByName(SHEET_NAME) ||
      spreadsheet.insertSheet(SHEET_NAME);
    if (sheet.getLastRow() === 0) {
      sheet.getRange(1, 1, 1, HEADERS.length).setValues([HEADERS]);
      sheet.setFrozenRows(1);
      sheet
        .getRange(1, 1, 1, HEADERS.length)
        .setFontWeight("bold")
        .setBackground("#DCFCE7");
    }

    const lastRow = sheet.getLastRow();
    const existing =
      lastRow > 1
        ? sheet.getRange(2, 1, lastRow - 1, 1).getDisplayValues()
        : [];
    const positions = new Map();
    existing.forEach(function (value, index) {
      if (value[0]) positions.set(String(value[0]), index + 2);
    });

    const now = new Date();
    const append = [];
    let updated = 0;
    body.rows.forEach(function (row) {
      if (!row || !row.orderNumber) return;
      const values = orderValues_(row, now);
      const position = positions.get(String(row.orderNumber));
      if (position) {
        sheet.getRange(position, 1, 1, HEADERS.length).setValues([values]);
        updated += 1;
      } else {
        append.push(values);
      }
    });
    if (append.length) {
      sheet
        .getRange(sheet.getLastRow() + 1, 1, append.length, HEADERS.length)
        .setValues(append);
    }
    sheet.autoResizeColumns(1, HEADERS.length);
    return jsonResponse_({
      ok: true,
      inserted: append.length,
      updated: updated,
    });
  } catch (error) {
    return jsonResponse_({
      ok: false,
      error: String(error && error.message ? error.message : error),
    });
  } finally {
    try {
      lock.releaseLock();
    } catch (_) {
      // The lock was never acquired.
    }
  }
}
