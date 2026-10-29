/* Catat Panda — Apps Script backend
 * Canonical transaction source: Form Responses 1
 * Do not put this code in Catatan Harian; that tab is formula-generated.
 */
const TOKEN = "GANTI_DENGAN_TOKEN_YANG_SAMA_DI_APLIKASI";
const BACKEND_VERSION = "2.0";
const TRANSACTION_SHEET = "Form Responses 1";
const MONTHS_ID = ["Januari", "Februari", "Maret", "April", "Mei", "Juni", "Juli", "Agustus", "September", "Oktober", "November", "Desember"];
const DEFAULT_EXPENSE_CATEGORIES = ["Makan", "Jajan", "Transportasi", "Belanja", "Belanja Pakaian / Fashion", "Belanja Kebutuhan Harian", "Tagihan", "Lainnya"];
const DEFAULT_INCOME_CATEGORIES = ["Gaji", "Bonus", "Investasi", "Lainnya"];
const DEFAULT_METHODS = ["Cash", "Debit", "Kredit", "E-Wallet", "🔄 Transfer", "📱 QRIS"];
const EMOJI_MAP = {"Makan":"🍜","Makanan & Minuman":"🍱","Jajan":"🧋","Transportasi":"🚗","Belanja":"🛒","Belanja Pakaian / Fashion":"👕","Belanja Kebutuhan Harian":"🧴","Tagihan":"⚡","Gaji":"💵","Bonus":"🎁","Investasi":"📈","Hutang / Piutang":"🤝","🤝 Hutang / Piutang":"🤝","Lainnya":"✨","✨ Lainnya":"✨"};

function doPost(e) {
  try {
    var data = JSON.parse((e && e.postData && e.postData.contents) || "{}");
    if (data.token !== TOKEN) return responseJSON({ok:false, error:"auth"});
    var action = String(data.action || "").trim().toLowerCase();
    if (action === "ping") return responseJSON({ok:true, v:BACKEND_VERSION});
    var ss = SpreadsheetApp.getActiveSpreadsheet();
    var sheet = ss && ss.getSheetByName(TRANSACTION_SHEET);
    if (!sheet) return responseJSON({ok:false, error:'Tab "' + TRANSACTION_SHEET + '" tidak ditemukan.'});
    var cols = getColumns_(sheet);
    if (action === "data" || action === "getdata" || action === "get_data") return responseJSON(getAppData(ss, sheet, cols, data.month));
    if (action === "add" || action === "addtransaction" || action === "add_transaction" || action === "create") return responseJSON(addTransaction(sheet, cols, data));
    if (action === "update" || action === "edit" || action === "modify" || action === "change" || action === "updatetransaction" || action === "edit_transaction" || action === "edittransaction" || action === "update_transaction") return responseJSON(updateTransaction(sheet, cols, data));
    if (action === "delete" || action === "deletetransaction" || action === "delete_transaction" || action === "remove") return responseJSON(deleteTransaction(ss, sheet, cols, data.id));
    return responseJSON({ok:false, error:"Aksi tidak dikenal oleh server: [" + action + "]"});
  } catch (err) {
    return responseJSON({ok:false, error:String(err && err.message || err)});
  }
}

function responseJSON(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}

function normalizeHeader_(value) {
  return String(value || "").toLowerCase().replace(/[^a-z0-9]/g, "");
}
function findColumn_(headers, aliases, required) {
  var normalized = headers.map(normalizeHeader_);
  for (var a = 0; a < aliases.length; a++) {
    var idx = normalized.indexOf(normalizeHeader_(aliases[a]));
    if (idx >= 0) return idx;
  }
  if (required) throw new Error('Kolom wajib tidak ditemukan: ' + aliases[0]);
  return -1;
}
function getColumns_(sheet) {
  if (sheet.getLastColumn() < 1) throw new Error('Baris header Form Responses 1 kosong.');
  var h = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
  return {
    headers: h,
    id: findColumn_(h, ["Submission ID"], true),
    respondent: findColumn_(h, ["Respondent ID"], false),
    submitted: findColumn_(h, ["Submitted at"], false),
    date: findColumn_(h, ["Tanggal Transaksi", "Tanggal"], true),
    desc: findColumn_(h, ["Untuk apa?", "Keterangan", "Deskripsi"], true),
    category: findColumn_(h, ["Kategori"], true),
    type: findColumn_(h, ["Tipe", "Jenis"], true),
    method: findColumn_(h, ["Metode Pembayaran", "Metode"], true),
    quickAmount: findColumn_(h, ["Jumlah cepat"], false),
    amount: findColumn_(h, ["Jumlah", "Jumlah (Rp)", "Nominal"], true),
    person: findColumn_(h, ["Nama orang", "Nama (hutang/piutang)", "Nama"], false),
    loanType: findColumn_(h, ["Hutang atau Piutang?", "Jenis hutang/piutang"], false)
  };
}
function getCategoryEmoji(name) {
  var s = String(name || "").trim();
  if (EMOJI_MAP[s]) return EMOJI_MAP[s];
  for (var k in EMOJI_MAP) if (s.indexOf(k) >= 0) return EMOJI_MAP[k];
  return "🏷️";
}
function parseAmount_(value) {
  if (typeof value === "number") return Math.round(value);
  if (value == null || value === "") return 0;
  var n = Number(String(value).replace(/[^0-9-]/g, ""));
  return isFinite(n) ? Math.abs(Math.round(n)) : 0;
}
function formatDateISO_(value, tz) {
  if (!value) return "";
  if (value instanceof Date && !isNaN(value.getTime())) return Utilities.formatDate(value, tz, "yyyy-MM-dd");
  var s = String(value).trim();
  var m = s.match(/^(\d{4})[-/](\d{1,2})[-/](\d{1,2})/);
  if (m) return m[1] + "-" + ("0" + m[2]).slice(-2) + "-" + ("0" + m[3]).slice(-2);
  m = s.match(/^(\d{1,2})[-/](\d{1,2})[-/](\d{4})/);
  if (m) return m[3] + "-" + ("0" + m[2]).slice(-2) + "-" + ("0" + m[1]).slice(-2);
  var d = new Date(s);
  return isNaN(d.getTime()) ? "" : Utilities.formatDate(d, tz, "yyyy-MM-dd");
}
function monthKey_(year, monthZeroBased) {
  var y = year, m = monthZeroBased + 1;
  while (m < 1) { m += 12; y--; }
  while (m > 12) { m -= 12; y++; }
  return y + "-" + ("0" + m).slice(-2);
}
function parseMonth_(value, current) {
  return /^\d{4}-\d{2}$/.test(String(value || "")) ? String(value) : current;
}
function getAppData(ss, sheet, cols, requestedMonth) {
  var tz = ss.getSpreadsheetTimeZone() || Session.getScriptTimeZone() || "Asia/Jakarta";
  var today = Utilities.formatDate(new Date(), tz, "yyyy-MM-dd");
  var currentMonth = today.slice(0, 7);
  var month = parseMonth_(requestedMonth, currentMonth);
  var values = sheet.getDataRange().getValues();
  var all = [], categoriesMap = {}, methodMap = {}, peopleMap = {}, monthIn = 0, monthOut = 0, count = 0, todayFilled = false;
  for (var r = 1; r < values.length; r++) {
    var row = values[r];
    if (!row || row.join("").trim() === "") continue;
    var desc = String(row[cols.desc] || "").trim();
    var cat = String(row[cols.category] || "Lainnya").trim() || "Lainnya";
    var tipeRaw = String(row[cols.type] || "");
    var tipe = tipeRaw.toLowerCase().indexOf("masuk") >= 0 ? "Masuk" : "Keluar";
    var amount = parseAmount_(row[cols.amount]);
    if (!amount && cols.quickAmount >= 0) amount = parseAmount_(row[cols.quickAmount]);
    if (!desc && !amount) continue;
    var date = formatDateISO_(row[cols.date] || row[cols.submitted], tz) || today;
    var method = cols.method >= 0 ? String(row[cols.method] || "").trim() : "";
    var person = cols.person >= 0 ? String(row[cols.person] || "").trim() : "";
    var loanType = cols.loanType >= 0 ? String(row[cols.loanType] || "").trim() : "";
    var rawId = String(row[cols.id] || "").trim();
    // Tally supplies Submission ID. Fallback row IDs are supported for legacy rows with an empty ID.
    var id = rawId || ("row_" + (r + 1));
    var loan = cat.toLowerCase().indexOf("hutang") >= 0 || loanType !== "";
    var tx = {id:id, date:date, cat:cat, desc:desc || cat, amount:amount, tipe:tipe, metode:method, nama:person, jenis:loanType, loan:loan,
      src:(rawId.indexOf("app_") === 0 || (cols.respondent >= 0 && String(row[cols.respondent]).toLowerCase() === "app")) ? "app" : "form", emoji:getCategoryEmoji(cat)};
    all.push(tx);
    var rowMonth = date.slice(0, 7);
    if (date === today) todayFilled = true;
    if (rowMonth !== month) continue;
    count++;
    if (tipe === "Masuk") monthIn += amount;
    else if (!loan) {
      monthOut += amount;
      categoriesMap[cat] = (categoriesMap[cat] || 0) + amount;
      if (method) methodMap[method] = (methodMap[method] || 0) + amount;
    }
    if (person) {
      if (!peopleMap[person]) peopleMap[person] = 0;
      var delta = (loanType.toLowerCase().indexOf("piutang") >= 0) ? (tipe === "Keluar" ? amount : -amount) : (tipe === "Masuk" ? -amount : amount);
      peopleMap[person] += delta;
    }
  }
  all.sort(function(a, b) { return b.date.localeCompare(a.date); });
  var recent = all.filter(function(t) { return t.date.slice(0, 7) === month; });
  var categories = Object.keys(categoriesMap).map(function(name) {
    var amount = categoriesMap[name];
    return {name:name, amount:amount, pct:monthOut ? Math.round(amount / monthOut * 100) : 0, emoji:getCategoryEmoji(name)};
  }).sort(function(a,b) { return b.amount - a.amount; });
  var methods = Object.keys(methodMap).map(function(name) { return {name:name, value:methodMap[name], monthOut:methodMap[name], kind:name.toLowerCase().indexOf("kredit") >= 0 ? "utang" : "biasa"}; });
  var persons = Object.keys(peopleMap).map(function(name) { return {name:name, net:peopleMap[name]}; });
  var trendMap = {}, trend = [], parts = month.split("-");
  for (var i = 5; i >= 0; i--) {
    var key = monthKey_(Number(parts[0]), Number(parts[1]) - 1 - i);
    trendMap[key] = {label:MONTHS_ID[Number(key.slice(5,7))-1].slice(0,3), masuk:0, keluar:0};
  }
  all.forEach(function(t) {
    var bucket = trendMap[t.date.slice(0,7)];
    if (!bucket) return;
    if (t.tipe === "Masuk") bucket.masuk += t.amount;
    else if (!t.loan) bucket.keluar += t.amount;
  });
  Object.keys(trendMap).forEach(function(k) { trend.push(trendMap[k]); });
  var expenseCats = DEFAULT_EXPENSE_CATEGORIES.slice();
  var catSheet = ss.getSheetByName("Kategori");
  if (catSheet && catSheet.getLastRow() >= 2) {
    var dynamic = catSheet.getRange(2, 1, Math.min(catSheet.getLastRow() - 1, 100), 1).getValues().map(function(r) { return String(r[0] || "").trim(); }).filter(Boolean);
    if (dynamic.length) expenseCats = dynamic;
  }
  var prevParts = month.split("-");
  var prev = monthKey_(Number(prevParts[0]), Number(prevParts[1]) - 2);
  var next = month < currentMonth ? monthKey_(Number(prevParts[0]), Number(prevParts[1])) : "";
  return {ok:true, month:month, label:MONTHS_ID[Number(month.slice(5,7))-1] + " " + month.slice(0,4), today:today, streak:todayFilled ? 1 : 0,
    prev:prev, next:next, todayFilled:todayFilled, flagged:0, review:{pending:0, items:[]},
    kpi:{keluar:monthOut, masuk:monthIn, selisih:monthIn-monthOut, count:count}, categories:categories, methods:methods,
    kkTotal:0, loans:{persons:persons}, trend:trend, recent:recent,
    options:{expense:expenseCats, income:DEFAULT_INCOME_CATEGORIES.slice(), loan:"🤝 Hutang / Piutang", methods:DEFAULT_METHODS.slice(), emoji:EMOJI_MAP}};
}
function addTransaction(sheet, cols, data) {
  var amount = parseAmount_(data.amount);
  if (!amount || !String(data.desc || "").trim()) return {ok:false, error:"Nominal dan keterangan wajib diisi."};
  var width = Math.max(cols.headers.length, sheet.getLastColumn());
  var row = Array(width).fill("");
  var reqId = String(data.reqId || "").replace(/[^a-zA-Z0-9_-]/g, "");
  var id = "app_" + (reqId || Utilities.getUuid());
  // Idempotency: a retried offline/network request must not append a duplicate.
  if (findRowById_(sheet, cols, id) >= 0) return {ok:true, msg:"Sudah tersimpan", id:id};
  row[cols.id] = id;
  if (cols.respondent >= 0) row[cols.respondent] = "app";
  if (cols.submitted >= 0) row[cols.submitted] = new Date();
  row[cols.date] = data.tanggal || Utilities.formatDate(new Date(), Session.getScriptTimeZone() || "Asia/Jakarta", "yyyy-MM-dd");
  row[cols.desc] = String(data.desc).trim();
  row[cols.category] = data.kategori || "Lainnya";
  row[cols.type] = data.tipe === "Masuk" ? "💚 Masuk" : "❤️ Keluar";
  row[cols.method] = data.metode || "";
  if (cols.quickAmount >= 0) row[cols.quickAmount] = "";
  row[cols.amount] = amount;
  if (cols.person >= 0) row[cols.person] = data.nama || "";
  if (cols.loanType >= 0) row[cols.loanType] = data.jenis || "";
  sheet.appendRow(row);
  return {ok:true, msg:"Tersimpan", id:id};
}
function findRowById_(sheet, cols, id) {
  if (!id) return -1;
  var last = sheet.getLastRow();
  if (last < 2) return -1;
  var ids = sheet.getRange(2, cols.id + 1, last - 1, 1).getValues();
  for (var i = 0; i < ids.length; i++) if (String(ids[i][0]) === String(id)) return i + 2;
  // Legacy records without Submission ID can be edited by their displayed physical row number.
  var m = String(id).match(/^row_(\d+)$/);
  if (m) {
    var rowNumber = Number(m[1]);
    if (rowNumber >= 2 && rowNumber <= last && !String(sheet.getRange(rowNumber, cols.id + 1).getValue() || "").trim()) return rowNumber;
  }
  return -1;
}
function updateTransaction(sheet, cols, data) {
  var rowNumber = findRowById_(sheet, cols, data.id);
  if (rowNumber < 0) return {ok:false, error:"Transaksi tidak ditemukan. Muat ulang aplikasi lalu coba lagi."};
  var amount = parseAmount_(data.amount);
  if (!amount || !String(data.desc || "").trim()) return {ok:false, error:"Nominal dan keterangan wajib diisi."};
  if (String(data.id).indexOf("row_") === 0) sheet.getRange(rowNumber, cols.id + 1).setValue("legacy_" + Utilities.getUuid());
  sheet.getRange(rowNumber, cols.date + 1).setValue(data.tanggal || "");
  sheet.getRange(rowNumber, cols.desc + 1).setValue(String(data.desc).trim());
  sheet.getRange(rowNumber, cols.category + 1).setValue(data.kategori || "Lainnya");
  sheet.getRange(rowNumber, cols.type + 1).setValue(data.tipe === "Masuk" ? "💚 Masuk" : "❤️ Keluar");
  sheet.getRange(rowNumber, cols.method + 1).setValue(data.metode || "");
  if (cols.amount >= 0) sheet.getRange(rowNumber, cols.amount + 1).setValue(amount);
  if (cols.person >= 0) sheet.getRange(rowNumber, cols.person + 1).setValue(data.nama || "");
  if (cols.loanType >= 0) sheet.getRange(rowNumber, cols.loanType + 1).setValue(data.jenis || "");
  return {ok:true, msg:"Perubahan tersimpan"};
}
function deleteTransaction(ss, sheet, cols, id) {
  var rowNumber = findRowById_(sheet, cols, id);
  if (rowNumber < 0) return {ok:false, error:"Transaksi tidak ditemukan. Muat ulang aplikasi lalu coba lagi."};
  var trash = ss.getSheetByName("Sampah") || ss.insertSheet("Sampah");
  if (trash.getLastRow() === 0) trash.appendRow(cols.headers);
  trash.appendRow(sheet.getRange(rowNumber, 1, 1, sheet.getLastColumn()).getValues()[0]);
  sheet.deleteRow(rowNumber);
  return {ok:true, msg:"Catatan dihapus"};
}
