/**
 * CATAT KEUANGAN OTOMATIS DARI NOTIFIKASI
 * Dipasang di Google Sheets yang sama dengan form Tally (Extensions > Apps Script).
 * Shortcut iPhone mengirim teks notifikasi ke Web App ini; baris baru masuk ke
 * sheet "Form Responses 1", jadi Catatan Harian dan Dashboard ikut otomatis.
 * Alamat Web App yang sama melayani: (1) Shortcut notifikasi, (2) aplikasi PWA di layar utama lewat JSON API,
 * dan (3) halaman cadangan bila file HTML "Index" dipasang (opsional).
 */

// ====== GANTI INI SEBELUM DEPLOY ======
var TOKEN = 'GANTI-DENGAN-KODE-RAHASIA-KAMU';   // huruf/angka acak, minimal 16 karakter

// ====== PENGATURAN ======
var SHEET_FR = 'Form Responses 1';
var SHEET_LOG = 'Log Notif';
var SHEET_RULES = 'Aturan';
var DEDUPE_SECONDS = 600;     // notifikasi yang sama dalam 10 menit dianggap duplikat
var TIMEZONE = 'Asia/Jakarta';

var CATEGORY_EMOJI = {
  'Makan': '🍚', 'Jajan': '🍟', 'Transportasi': '🚗', 'Belanja': '🛍️',
  'Belanja Pakaian / Fashion': '👗', 'Belanja Kebutuhan Harian': '🧺',
  'Tagihan & Utilitas': '💡', 'Hiburan': '🎬', 'Kesehatan': '🏥', 'Pendidikan': '📚',
  'E-Money / Dompet Digital': '📱', 'Tithe & Offering': '🙏',
  'Kasih ke Orang Tua / Keluarga': '👪', 'Hutang / Piutang': '🤝', 'Lainnya': '✨', 'Gaji': '💰',
  'Bonus': '🎁', 'Hadiah': '🎀', 'Investasi Masuk': '📈'
};
var METHOD_LABEL = {
  'Cash': '💸 Cash', 'Transfer': '🔄 Transfer', 'QRIS': '📱 QRIS',
  'Kartu Kredit BCA': '🔵💳 Kartu Kredit BCA',
  'Kartu Kredit Danamon': '🔴💳 Kartu Kredit Danamon',
  'Kartu Kredit DBS': '⬛💳 Kartu Kredit DBS',
  'Kartu Kredit BNI': '🟠💳 Kartu Kredit BNI'
};
var TIPE_LABEL = { 'Masuk': '💚 Masuk', 'Keluar': '❤️ Keluar' };

// Kata kunci bawaan (regex, huruf kecil). Aturan di sheet "Aturan" diperiksa lebih dulu.
var DEFAULT_RULES = [
  [/gereja|persembahan|donasi|kitabisa|zakat|infaq|sedekah/, 'Tithe & Offering'],
  [/flazz|e-?money|brizzi|tapcash|top[- ]?up (?:e-?money|flazz)/, 'E-Money / Dompet Digital'],
  [/\bgrab\b(?!food)|gojek|gocar|goride|bluebird|maxim|\btol\b|e-?toll|\bmrt\b|\bkrl\b|commuter|transjakarta|parkir|spbu|pertamina|\bshell\b|\bbp\b|traveloka|tiket\.com|\bkai\b/, 'Transportasi'],
  [/\bpln\b|listrik|token|pdam|telkom|indihome|biznet|pulsa|telkomsel|indosat|smartfren|\bxl\b|bpjs|first media/, 'Tagihan & Utilitas'],
  [/netflix|spotify|disney|youtube|xxi|cgv|bioskop|steam|playstation|nintendo|vidio/, 'Hiburan'],
  [/apotek|kimia farma|guardian|\bk24\b|rumah sakit|klinik|dokter|halodoc|\brs\b/, 'Kesehatan'],
  [/udemy|coursera|sekolah|kursus|gramedia|buku|universitas|kampus/, 'Pendidikan'],
  [/uniqlo|h&m|\bzara\b|zalora|cotton on|matahari|pull&bear|erigo/, 'Belanja Pakaian / Fashion'],
  [/indomaret|alfamart|alfamidi|superindo|super indo|hypermart|lotte mart|ranch market|farmers|transmart|giant|carrefour/, 'Belanja Kebutuhan Harian'],
  [/tokopedia|shopee(?!food|pay)|lazada|blibli|bukalapak|ikea|ace hardware|informa/, 'Belanja'],
  [/starbucks|kopi|coffee|janji jiwa|\bfore\b|kenangan|tomoro|cafe|bakery|roti|boba|chatime|gelato|j\.?co|dunkin|es teh|minuman|dessert/, 'Jajan'],
  [/mcd|mcdonald|\bkfc\b|pizza|burger|resto|restaurant|warung|nasi|ayam|bakso|\bmie\b|sate|geprek|gofood|grabfood|shopeefood|sushi|ramen|padang|makan|food/, 'Makan']
];

// =====================================================================
//  BAGIAN 1 - PEMBACA NOTIFIKASI (fungsi murni, tidak memakai layanan Google)
// =====================================================================

function parseAmount_(raw) {
  var s = String(raw).replace(/[^0-9.,]/g, '');
  if (!s) return NaN;
  var lastDot = s.lastIndexOf('.'), lastComma = s.lastIndexOf(',');
  if (lastDot > -1 && lastComma > -1) {
    s = s.slice(0, Math.max(lastDot, lastComma)).replace(/[.,]/g, '');   // buang desimal
  } else if (lastDot > -1 || lastComma > -1) {
    var sep = lastDot > -1 ? '.' : ',';
    var parts = s.split(sep);
    if (parts.length > 2) s = parts.join('');            // 1.250.000
    else if (parts[1].length === 3) s = parts.join('');  // 50.000
    else s = parts[0];                                   // 50,5 -> desimal dibuang
  }
  return parseInt(s, 10);
}

function extractAmount_(text) {
  var re = /(?:rp\.?|idr)\s*([0-9]+(?:[.,][0-9]+)*)/gi, m;
  while ((m = re.exec(text)) !== null) {
    var before = text.slice(Math.max(0, m.index - 22), m.index).toLowerCase();
    if (/saldo|sisa|limit|biaya|fee|admin/.test(before)) continue;
    var n = parseAmount_(m[1]);
    if (n > 0 && n < 1000000000) return n;
  }
  return 0;
}

function detectDirection_(t) {
  if (/(?:tagihan|pembayaran|bayar)\s+kartu\s+kredit/.test(t) && /(pembayaran|bayar|dibayar)/.test(t)) return 'KKBAYAR';
  if (/(menerima|diterima|dana masuk|transfer masuk|uang masuk|setoran|cashback|refund|pengembalian|dikreditkan|received|incoming)/.test(t)) return 'Masuk';
  if (/(pembayaran|dibayar|membayar|pembelian|belanja|transaksi|debit|didebet|tarik tunai|transfer|top[- ]?up|purchase|payment|charged|withdraw|bayar)/.test(t)) return 'Keluar';
  return '';
}

function detectBank_(t) {
  if (/danamon|d-?bank/.test(t)) return 'Danamon';
  if (/digibank|\bdbs\b/.test(t)) return 'DBS';
  if (/\bbni\b/.test(t)) return 'BNI';
  if (/\bbca\b|mybca|klikbca/.test(t)) return 'BCA';
  return '';
}

function detectMethod_(t, bank) {
  if (/kartu\s+kredit|credit\s*card|\bcc\b|\bkk\b/.test(t)) return bank ? 'Kartu Kredit ' + bank : '';
  if (/qris/.test(t)) return 'QRIS';
  if (/transfer|\btrf\b|bi-?fast|rtgs|skn/.test(t)) return 'Transfer';
  if (/gopay|ovo|\bdana\b|shopeepay|linkaja/.test(t)) return 'QRIS';
  return 'Transfer';   // kartu debit / m-banking
}

function toTitle_(s) {
  return String(s).toLowerCase().replace(/(^|\s)([a-z])/g, function (m, a, b) { return a + b.toUpperCase(); });
}

function extractMerchant_(text) {
  var re = /\b(?:di|at|ke|kepada|to|merchant|toko|dari)\b\s*[:\-]?\s*([A-Za-z0-9][A-Za-z0-9&'.\-\/ ]{1,40}?)(?=\s+(?:pada|tgl|tanggal|jam|sebesar|senilai|seharga|rp|idr|dengan|menggunakan|using|on|berhasil|sukses|ref|no|trx|dari|limit|saldo)\b|[.,;:\n]|\s*$)/ig, m;
  while ((m = re.exec(text)) !== null) {
    var c = m[1].trim();
    if (c.length < 3) continue;
    if (/^(rekening|rek|akun|account|kartu|anda|nomor|no)\b/i.test(c)) continue;
    if (/^[0-9 \-\/]+$/.test(c)) continue;
    return toTitle_(c);
  }
  return '';
}

function guessCategory_(haystack, tipe, extraRules) {
  var h = haystack.toLowerCase();
  var i;
  if (extraRules) {
    for (i = 0; i < extraRules.length; i++) {
      if (extraRules[i][0] && h.indexOf(extraRules[i][0]) > -1) return extraRules[i][1];
    }
  }
  if (tipe === 'Masuk') return /gaji|salary|payroll/.test(h) ? 'Gaji' : 'Lainnya';
  for (i = 0; i < DEFAULT_RULES.length; i++) {
    if (DEFAULT_RULES[i][0].test(h)) return DEFAULT_RULES[i][1];
  }
  return 'Lainnya';
}

/** p = {app, text}; extraRules = [[kataKunci, kategori], ...] dari sheet Aturan */
function buildEntry_(p, extraRules) {
  var raw = String(p.text || '').replace(/\s+/g, ' ').trim();
  var app = String(p.app || '').trim();
  var t = (app + ' ' + raw).toLowerCase();
  var amount = extractAmount_(raw);
  if (!amount) return { ok: false, reason: 'nominal tidak ditemukan' };
  if (/\b(promo|diskon|voucher|dapatkan|hingga|penawaran|kesempatan|undian)\b/.test(t)) return { ok: false, reason: 'terlihat seperti promosi', amount: amount };
  if (/jatuh tempo|segera|pengingat|reminder|e-?statement|rekening koran|batas waktu|pembayaran minimum|minimum payment/.test(t)) return { ok: false, reason: 'terlihat seperti pengingat tagihan', amount: amount };
  var dir = detectDirection_(t);
  if (!dir) return { ok: false, reason: 'arah transaksi tidak jelas', amount: amount };
  var bank = detectBank_(app.toLowerCase()) || detectBank_(t);
  var flags = [];

  if (dir === 'KKBAYAR') {
    if (!bank) return { ok: false, reason: 'bank kartu kredit tidak jelas', amount: amount };
    return { ok: true, amount: amount, tipe: 'Masuk', metode: 'Kartu Kredit ' + bank,
             merchant: 'Bayar tagihan kartu kredit ' + bank, kategori: 'Lainnya',
             flags: ['pembayaran kartu kredit'] };
  }

  var metode = detectMethod_(t, bank);
  if (!metode) { flags.push('kartu kredit bank tidak jelas'); }
  var merchant = extractMerchant_(raw);
  if (!merchant) {
    var an = /\b(?:a\.n\.?|a\/n)\s+([A-Za-z][A-Za-z ]{2,30}?)(?=\s+(?:berhasil|sukses|pada|tgl|tanggal)\b|[.,;]|\s*$)/i.exec(raw);
    if (an) merchant = 'Transfer ke ' + toTitle_(an[1].trim());
  }
  if (!merchant) {
    var pre = /^(.*?)(?=\s*(?:rp\.?|idr)\s*[0-9])/i.exec(raw);
    var desc = pre ? pre[1].replace(/^(anda|kamu)\s+(telah\s+)?/i, '').trim() : '';
    if (desc.length >= 3) {
      merchant = toTitle_(desc.slice(0, 40));
    } else {
      merchant = (dir === 'Masuk' ? 'Dana masuk' : 'Transaksi') + (app ? ' ' + app : '');
      flags.push('merchant tidak terbaca');
    }
  }
  var kategori = guessCategory_(merchant + ' ' + raw, dir, extraRules);
  if (kategori === 'Lainnya' && dir === 'Keluar') flags.push('kategori ditebak');
  return { ok: true, amount: amount, tipe: dir, metode: metode, merchant: merchant, kategori: kategori, flags: flags };
}

// =====================================================================
//  BAGIAN 2 - PENERIMA (Web App) DAN PENULIS KE SHEET
// =====================================================================

function json_(obj) { return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON); }

/** Jalur API untuk aplikasi yang dipasang di iPhone (PWA). Semua butuh TOKEN. */
function api_(p) {
  var a = String(p.action || '');
  if (a === 'data') return json_(appGetData(p.month || '', p.token));
  if (a === 'add') return json_(appAddTransaction(p, p.token));
  if (a === 'delete') return json_(appDeleteTransaction(p.id, p.token));
  return json_({ ok: false, error: 'aksi tidak dikenal' });
}

function doGet(e) {
  var p = e && e.parameter ? e.parameter : {};
  if (p.action) return api_(p);
  if (p.token || p.text) return handle_(p);        // jalur API (tes lewat browser)
  try {                                                    // halaman cadangan (opsional): perlu file HTML bernama Index
    return HtmlService.createHtmlOutputFromFile('Index')
      .setTitle('Catat Keuangan')
      .addMetaTag('viewport', 'width=device-width, initial-scale=1, viewport-fit=cover')
      .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
  } catch (err) {
    return json_({ ok: false, error: 'Alamat ini dipakai oleh aplikasi di layar utama HP. Buka aplikasinya dari sana.' });
  }
}

function doPost(e) {
  var p = {}, k;
  if (e && e.parameter) { for (k in e.parameter) p[k] = e.parameter[k]; }
  try {
    var body = e && e.postData && e.postData.contents;
    if (body && /^\s*\{/.test(body)) {
      var j = JSON.parse(body);
      for (k in j) p[k] = j[k];
    }
  } catch (err) { /* abaikan, pakai parameter biasa */ }
  if (p.action) return api_(p);
  return handle_(p);
}

function out_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}

function getOrCreateSheet_(ss, name, header, rows) {
  var sh = ss.getSheetByName(name);
  if (!sh) {
    sh = ss.insertSheet(name);
    sh.getRange(1, 1, 1, header.length).setValues([header]).setFontWeight('bold');
    if (rows && rows.length) sh.getRange(2, 1, rows.length, header.length).setValues(rows);
    sh.setFrozenRows(1);
  }
  return sh;
}

function readRules_(ss) {
  var sh = getOrCreateSheet_(ss, SHEET_RULES, ['Kata kunci (huruf kecil)', 'Kategori'], [
    ['contoh: kopi tuku', 'Jajan'], ['contoh: sate khas senayan', 'Makan']
  ]);
  var last = sh.getLastRow();
  if (last < 2) return [];
  var vals = sh.getRange(2, 1, last - 1, 2).getValues(), rules = [];
  for (var i = 0; i < vals.length; i++) {
    var kw = String(vals[i][0] || '').toLowerCase().trim();
    var cat = String(vals[i][1] || '').trim();
    if (kw && cat && kw.indexOf('contoh:') !== 0) rules.push([kw, cat]);
  }
  return rules;
}

function logRow_(ss, source, text, result, detail) {
  var sh = getOrCreateSheet_(ss, SHEET_LOG, ['Waktu', 'Sumber', 'Teks notifikasi', 'Hasil', 'Detail']);
  sh.appendRow([new Date(), source, text, result, detail || '']);
}

function handle_(p) {
  if (!p.token || String(p.token) !== TOKEN) return out_({ status: 'error', msg: 'token salah' });
  // isi notifikasi boleh dikirim sebagai "text", atau terpisah sebagai "title", "subtitle", "body"
  var text = String(p.text || [p.title, p.subtitle, p.body].filter(function (x) { return x; }).join(' ')).trim();
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var source = String(p.app || '');
  if (!text) {
    if (!p.dry) logRow_(ss, source, '(kosong)', 'TEKS KOSONG', 'Shortcut jalan tapi tidak mengirim isi notifikasi');
    return out_({ status: 'error', msg: 'teks notifikasi kosong' });
  }
  var rules = readRules_(ss);
  var entry = buildEntry_({ app: source, text: text }, rules);

  if (!entry.ok) {
    if (!p.dry) logRow_(ss, source, text, 'PERLU DICEK', entry.reason);
    return out_({ status: 'skip', msg: 'Tidak dicatat: ' + entry.reason });
  }
  var detail = entry.amount + ' | ' + entry.tipe + ' | ' + (entry.metode || '?') + ' | ' + entry.kategori + ' | ' + entry.merchant +
               (entry.flags.length ? ' | cek: ' + entry.flags.join(', ') : '');
  if (p.dry) return out_({ status: 'dry', msg: detail });

  // anti-duplikat
  var cache = CacheService.getScriptCache();
  var key = 'n' + Utilities.base64EncodeWebSafe(Utilities.computeDigest(Utilities.DigestAlgorithm.MD5, source + '|' + text)).slice(0, 40);
  if (cache.get(key)) {
    logRow_(ss, source, text, 'DUPLIKAT', detail);
    return out_({ status: 'duplicate', msg: 'Sudah tercatat tadi' });
  }
  cache.put(key, '1', DEDUPE_SECONDS);

  var lock = LockService.getScriptLock();
  lock.waitLock(15000);
  try {
    var fr = ss.getSheetByName(SHEET_FR);
    if (!fr) { logRow_(ss, source, text, 'ERROR', 'sheet ' + SHEET_FR + ' tidak ditemukan'); return out_({ status: 'error', msg: 'sheet tidak ditemukan' }); }
    var now = new Date();
    var today = Utilities.formatDate(now, TIMEZONE, 'yyyy-MM-dd');   // teks, sama seperti yang ditulis Tally
    var emoji = CATEGORY_EMOJI[entry.kategori];
    fr.appendRow([
      Utilities.getUuid().substring(0, 7),                 // Submission ID
      'notif',                                             // Respondent ID
      now,                                                 // Submitted at
      today,                                               // Tanggal Transaksi
      entry.merchant,                                      // Untuk apa?
      emoji ? emoji + ' ' + entry.kategori : entry.kategori,
      TIPE_LABEL[entry.tipe],
      entry.metode ? METHOD_LABEL[entry.metode] : '',
      entry.flags.length ? 'otomatis (cek)' : 'otomatis',  // kolom "Kebutuhan atau Keinginan?" dipakai sebagai penanda
      'Nominal lain (isi manual)',
      entry.amount,
      '', ''
    ]);
    logRow_(ss, source, text, entry.flags.length ? 'OK (CEK)' : 'OK', detail);
  } finally {
    lock.releaseLock();
  }
  var msg = 'Tercatat: Rp ' + String(entry.amount).replace(/\B(?=(\d{3})+(?!\d))/g, '.') + ' ' + entry.kategori + ' (' + entry.merchant + ')';
  return out_({ status: 'ok', msg: msg });
}

// =====================================================================
//  BAGIAN 3 - APLIKASI WEB (tampilan di HP, membaca sheet "Form Responses 1")
// =====================================================================

var LOAN_CAT = 'Hutang / Piutang';
var APP_EXPENSE_CATS = ['Makan', 'Jajan', 'Transportasi', 'Belanja', 'Belanja Pakaian / Fashion',
  'Belanja Kebutuhan Harian', 'Tagihan & Utilitas', 'Hiburan', 'Kesehatan', 'Pendidikan',
  'E-Money / Dompet Digital', 'Tithe & Offering', 'Kasih ke Orang Tua / Keluarga', 'Lainnya'];
var APP_INCOME_CATS = ['Gaji', 'Bonus', 'Hadiah', 'Investasi Masuk', 'Lainnya'];
var METHOD_ORDER = ['Cash', 'Transfer', 'QRIS', 'Kartu Kredit BCA', 'Kartu Kredit Danamon', 'Kartu Kredit DBS', 'Kartu Kredit BNI'];
var MONTH_NAMES = ['Januari', 'Februari', 'Maret', 'April', 'Mei', 'Juni', 'Juli', 'Agustus', 'September', 'Oktober', 'November', 'Desember'];

function pad2_(n) { n = String(n); return n.length < 2 ? '0' + n : n; }
function stripLead_(s) { return String(s == null ? '' : s).replace(/^[^A-Za-z]+/, '').trim(); }

function toNumber_(v) {
  if (typeof v === 'number') return isFinite(v) ? v : 0;
  var s = String(v == null ? '' : v);
  if (!/[0-9]/.test(s)) return 0;
  var n = parseAmount_(s);
  return isNaN(n) ? 0 : n;
}

function dateOf_(v, fmtDate) {
  if (v instanceof Date) return isNaN(v.getTime()) ? '' : fmtDate(v);
  var s = String(v == null ? '' : v), m;
  if ((m = /(\d{4})-(\d{2})-(\d{2})/.exec(s))) return m[1] + '-' + m[2] + '-' + m[3];
  if ((m = /(\d{1,2})\/(\d{1,2})\/(\d{4})/.exec(s))) return m[3] + '-' + pad2_(m[2]) + '-' + pad2_(m[1]);
  return '';
}

function addMonths_(ym, n) {
  var y = parseInt(ym.slice(0, 4), 10), m = parseInt(ym.slice(5, 7), 10) - 1 + n;
  y += Math.floor(m / 12); m = ((m % 12) + 12) % 12;
  return y + '-' + pad2_(m + 1);
}
function prevDay_(ymd) {
  var d = new Date(ymd + 'T00:00:00Z'); d.setUTCDate(d.getUTCDate() - 1);
  return d.getUTCFullYear() + '-' + pad2_(d.getUTCMonth() + 1) + '-' + pad2_(d.getUTCDate());
}
function monthLabel_(ym) { return MONTH_NAMES[parseInt(ym.slice(5, 7), 10) - 1] + ' ' + ym.slice(0, 4); }

/** Baris Form Responses 1 -> daftar transaksi yang sudah bersih */
function parseRows_(rows, fmtDate) {
  var out = [];
  for (var i = 0; i < rows.length; i++) {
    var r = rows[i];
    var desc = String(r[4] == null ? '' : r[4]).trim();
    var tipeRaw = String(r[6] == null ? '' : r[6]);
    var tipe = /masuk/i.test(tipeRaw) ? 'Masuk' : (/keluar/i.test(tipeRaw) ? 'Keluar' : '');
    var amount = toNumber_(r[10]);
    if (!amount) amount = toNumber_(r[9]);        // "Rp 100.000" dari preset cepat
    if (!desc || !tipe || !amount) continue;
    var date = dateOf_(r[3], fmtDate) || dateOf_(r[2], fmtDate);
    if (!date) continue;
    var cat = stripLead_(r[5]);
    var metode = stripLead_(r[7]);
    var jenisRaw = String(r[12] == null ? '' : r[12]);
    var marker = String(r[8] == null ? '' : r[8]);
    out.push({
      idx: i, id: String(r[0] == null ? '' : r[0]), src: String(r[1] || '') === 'notif' ? 'notif' : (String(r[1] || '') === 'app' ? 'app' : 'form'),
      date: date, desc: desc, cat: cat, tipe: tipe, metode: metode, amount: amount,
      nama: String(r[11] == null ? '' : r[11]).trim(),
      jenis: /piutang/i.test(jenisRaw) ? 'Piutang' : (/hutang/i.test(jenisRaw) ? 'Hutang' : ''),
      isLoan: cat.indexOf(LOAN_CAT) === 0,
      isKK: metode.indexOf('Kartu Kredit') === 0,
      flag: /cek/i.test(marker),
      auto: String(r[1] || '') === 'notif'
    });
  }
  return out;
}

function sumWhere_(list, fn) { var s = 0; for (var i = 0; i < list.length; i++) if (fn(list[i])) s += list[i].amount; return s; }
function isIncome_(t) { return t.tipe === 'Masuk' && !t.isLoan && !(t.isKK); }   // bayar tagihan kartu bukan pemasukan
function isExpense_(t) { return t.tipe === 'Keluar' && !t.isLoan; }

/** Fungsi murni: tidak memakai layanan Google, jadi bisa diuji. ctx = {today, fmtDate, emoji} */
function buildData_(rows, month, ctx) {
  var tx = parseRows_(rows, ctx.fmtDate);
  var today = ctx.today, curMonth = today.slice(0, 7);
  if (!/^\d{4}-\d{2}$/.test(month || '')) month = curMonth;
  if (month > curMonth) month = curMonth;

  var sorted = tx.slice().sort(function (a, b) { return a.date < b.date ? 1 : a.date > b.date ? -1 : b.idx - a.idx; });
  var mtx = sorted.filter(function (t) { return t.date.slice(0, 7) === month; });

  var masuk = sumWhere_(mtx, isIncome_), keluar = sumWhere_(mtx, isExpense_);

  var catMap = {};
  mtx.forEach(function (t) { if (isExpense_(t)) catMap[t.cat || 'Lainnya'] = (catMap[t.cat || 'Lainnya'] || 0) + t.amount; });
  var categories = Object.keys(catMap).map(function (k) {
    return { name: k, emoji: (ctx.emoji && ctx.emoji[k]) || '🏷️', amount: catMap[k], pct: keluar ? Math.round(catMap[k] / keluar * 1000) / 10 : 0 };
  }).sort(function (a, b) { return b.amount - a.amount; });

  var trend = [];
  for (var k = 5; k >= 0; k--) {
    var ym = addMonths_(month, -k);
    var sub = tx.filter(function (t) { return t.date.slice(0, 7) === ym; });
    trend.push({ month: ym, label: MONTH_NAMES[parseInt(ym.slice(5, 7), 10) - 1].slice(0, 3), masuk: sumWhere_(sub, isIncome_), keluar: sumWhere_(sub, isExpense_) });
  }

  var methods = [], kkTotal = 0;
  METHOD_ORDER.forEach(function (name) {
    var mine = tx.filter(function (t) { return t.metode.indexOf(name) === 0; });
    var inn = sumWhere_(mine, function (t) { return t.tipe === 'Masuk'; });
    var out = sumWhere_(mine, function (t) { return t.tipe === 'Keluar'; });
    var kk = name.indexOf('Kartu Kredit') === 0;
    var monthOut = sumWhere_(mtx, function (t) { return t.metode.indexOf(name) === 0 && t.tipe === 'Keluar'; });
    var value = kk ? out - inn : inn - out;
    if (kk) kkTotal += value;
    if (mine.length) methods.push({ name: name, kind: kk ? 'utang' : 'saldo', value: value, monthOut: monthOut });
  });

  var people = {}, totalPiutang = 0, totalHutang = 0;
  tx.forEach(function (t) {
    if (!t.isLoan || !t.nama || !t.jenis) return;
    var key = t.nama.toLowerCase();
    var p = people[key] || (people[key] = { name: t.nama, piutang: 0, hutang: 0 });
    if (t.jenis === 'Piutang') p.piutang += t.tipe === 'Keluar' ? t.amount : -t.amount;
    else p.hutang += t.tipe === 'Masuk' ? t.amount : -t.amount;
  });
  var persons = Object.keys(people).map(function (k) { var p = people[k]; totalPiutang += p.piutang; totalHutang += p.hutang; p.net = p.piutang - p.hutang; return p; })
    .sort(function (a, b) { return Math.abs(b.net) - Math.abs(a.net); });

  var days = {}; tx.forEach(function (t) { days[t.date] = true; });
  var streak = 0, guard = 0;
  var cursor = days[today] ? today : prevDay_(today);   // hari ini belum diisi: rantai tetap hidup sampai hari berakhir
  while (days[cursor] && guard < 400) { streak++; guard++; cursor = prevDay_(cursor); }

  var recent = mtx.slice(0, 300).map(function (t) {
    return { id: t.id, src: t.src, date: t.date, desc: t.desc, cat: t.cat, emoji: (ctx.emoji && ctx.emoji[t.cat]) || (t.isLoan ? '🤝' : '🏷️'),
             tipe: t.tipe, amount: t.amount, metode: t.metode, loan: t.isLoan, nama: t.nama, flag: t.flag, auto: t.auto };
  });

  return {
    month: month, label: monthLabel_(month), prev: addMonths_(month, -1), next: month < curMonth ? addMonths_(month, 1) : '',
    today: today, kpi: { masuk: masuk, keluar: keluar, selisih: masuk - keluar, count: mtx.length },
    categories: categories, trend: trend, recent: recent, methods: methods, kkTotal: kkTotal,
    loans: { piutang: totalPiutang, hutang: totalHutang, persons: persons },
    streak: streak, todayFilled: !!days[today], flagged: mtx.filter(function (t) { return t.flag; }).length
  };
}

// ---------- jembatan ke halaman (dipanggil lewat google.script.run) ----------

function appAuth_(token) {
  if (token && String(token) === TOKEN) return true;
  try {
    var a = Session.getActiveUser().getEmail(), b = Session.getEffectiveUser().getEmail();
    return !!a && a === b;       // hanya pemilik spreadsheet yang login
  } catch (err) { return false; }
}

function reviewInfo_(ss) {
  var sh = ss.getSheetByName(SHEET_LOG);
  if (!sh || sh.getLastRow() < 2) return { pending: 0, items: [] };
  var from = Math.max(2, sh.getLastRow() - 199);
  var vals = sh.getRange(from, 1, sh.getLastRow() - from + 1, 5).getValues(), items = [];
  for (var i = vals.length - 1; i >= 0 && items.length < 5; i--) {
    if (String(vals[i][3]) === 'PERLU DICEK') items.push({ text: String(vals[i][2]).slice(0, 120), reason: String(vals[i][4]) });
  }
  var pending = 0;
  for (var j = 0; j < vals.length; j++) if (String(vals[j][3]) === 'PERLU DICEK') pending++;
  return { pending: pending, items: items };
}

function appGetData(month, token) {
  if (!appAuth_(token)) return { ok: false, error: 'auth' };
  try {
    var ss = SpreadsheetApp.getActiveSpreadsheet();
    var tz = ss.getSpreadsheetTimeZone();
    var fr = ss.getSheetByName(SHEET_FR);
    var rows = [];
    if (fr && fr.getLastRow() > 1) {
      rows = fr.getRange(2, 1, fr.getLastRow() - 1, Math.min(13, fr.getMaxColumns())).getValues();
    }
    var data = buildData_(rows, month, {
      today: Utilities.formatDate(new Date(), TIMEZONE, 'yyyy-MM-dd'),
      fmtDate: function (d) { return Utilities.formatDate(d, tz, 'yyyy-MM-dd'); },
      emoji: CATEGORY_EMOJI
    });
    data.review = reviewInfo_(ss);
    data.options = { expense: APP_EXPENSE_CATS, income: APP_INCOME_CATS, loan: LOAN_CAT, methods: METHOD_ORDER, emoji: CATEGORY_EMOJI };
    data.ok = true;
    return data;
  } catch (err) {
    return { ok: false, error: 'Gagal membaca sheet: ' + err };
  }
}

function appAddTransaction(p, token) {
  if (!appAuth_(token)) return { ok: false, error: 'auth' };
  p = p || {};
  var desc = String(p.desc || '').replace(/\s+/g, ' ').trim().slice(0, 80);
  var amount = Math.round(Number(p.amount));
  var tipe = p.tipe === 'Masuk' ? 'Masuk' : (p.tipe === 'Keluar' ? 'Keluar' : '');
  var kat = String(p.kategori || '');
  var metode = String(p.metode || '');
  var nowStr = Utilities.formatDate(new Date(), TIMEZONE, 'yyyy-MM-dd');
  var tanggal = /^\d{4}-\d{2}-\d{2}$/.test(String(p.tanggal || '')) ? String(p.tanggal) : nowStr;
  if (tanggal > nowStr) return { ok: false, error: 'Tanggal tidak boleh di masa depan' };
  if (!desc) return { ok: false, error: 'Isi keterangan dulu' };
  if (!(amount > 0 && amount < 10000000000)) return { ok: false, error: 'Nominal belum valid' };
  if (!tipe) return { ok: false, error: 'Pilih Masuk atau Keluar' };
  if (APP_EXPENSE_CATS.concat(APP_INCOME_CATS, [LOAN_CAT]).indexOf(kat) < 0) return { ok: false, error: 'Pilih kategori' };
  if (!METHOD_LABEL[metode]) return { ok: false, error: 'Pilih metode pembayaran' };

  var nama = '', jenisLabel = '';
  if (kat === LOAN_CAT) {
    nama = String(p.nama || '').replace(/\s+/g, ' ').trim().slice(0, 40);
    if (!nama) return { ok: false, error: 'Isi nama orangnya' };
    if (p.jenis === 'Hutang') jenisLabel = '🔴 Hutang (saya pinjam)';
    else if (p.jenis === 'Piutang') jenisLabel = '🟢 Piutang (saya pinjamkan)';
    else return { ok: false, error: 'Pilih Hutang atau Piutang' };
  }

  var cache = CacheService.getScriptCache();
  var key = 'a' + String(p.reqId || '').slice(0, 40);
  if (p.reqId && cache.get(key)) return { ok: true, msg: 'Sudah tersimpan tadi' };

  var lock = LockService.getScriptLock();
  lock.waitLock(15000);
  try {
    var ss = SpreadsheetApp.getActiveSpreadsheet();
    var fr = ss.getSheetByName(SHEET_FR);
    if (!fr) return { ok: false, error: 'Sheet ' + SHEET_FR + ' tidak ditemukan' };
    var emoji = CATEGORY_EMOJI[kat];
    fr.appendRow([
      Utilities.getUuid().substring(0, 7), 'app', new Date(), tanggal, desc,
      emoji ? emoji + ' ' + kat : kat, TIPE_LABEL[tipe], METHOD_LABEL[metode], '',
      'Nominal lain (isi manual)', amount, nama, jenisLabel
    ]);
    if (p.reqId) cache.put(key, '1', 600);
  } finally {
    lock.releaseLock();
  }
  return { ok: true, msg: 'Tersimpan' };
}

function appDeleteTransaction(id, token) {
  if (!appAuth_(token)) return { ok: false, error: 'auth' };
  id = String(id || '').trim();
  if (!id) return { ok: false, error: 'ID catatan kosong' };
  var lock = LockService.getScriptLock();
  lock.waitLock(15000);
  try {
    var ss = SpreadsheetApp.getActiveSpreadsheet();
    var fr = ss.getSheetByName(SHEET_FR);
    if (!fr || fr.getLastRow() < 2) return { ok: false, error: 'Catatan tidak ditemukan' };
    var cols = Math.min(13, fr.getMaxColumns());
    var ids = fr.getRange(2, 1, fr.getLastRow() - 1, 1).getValues(), row = -1;
    for (var i = ids.length - 1; i >= 0; i--) { if (String(ids[i][0]) === id) { row = i + 2; break; } }
    if (row < 0) return { ok: false, error: 'Catatan tidak ditemukan (mungkin sudah dihapus)' };
    var vals = fr.getRange(row, 1, 1, cols).getValues()[0];
    var trash = getOrCreateSheet_(ss, 'Sampah', ['Dihapus pada', 'Submission ID', 'Respondent ID', 'Submitted at', 'Tanggal Transaksi',
      'Untuk apa?', 'Kategori', 'Tipe', 'Metode Pembayaran', 'Penanda', 'Jumlah cepat', 'Jumlah', 'Nama orang', 'Hutang atau Piutang?']);
    trash.appendRow([new Date()].concat(vals));
    // baris tidak dihapus (supaya rumus di sheet tidak bergeser); isinya dikosongkan, hanya ID dan tanda "dihapus" yang tersisa
    var rest = ['dihapus']; for (var c = 2; c < cols; c++) rest.push('');
    fr.getRange(row, 2, 1, cols - 1).setValues([rest]);
  } finally {
    lock.releaseLock();
  }
  return { ok: true, msg: 'Dihapus (salinannya ada di tab Sampah)' };
}

/** Uji tanpa menulis apa pun: pilih fungsi "tes" lalu Run, lihat hasil di Execution log. */
function tes() {
  var samples = [
    { app: 'Danamon', text: 'Transaksi kartu kredit sebesar Rp 150.000 di STARBUCKS pada 25/10/2026. Limit tersedia Rp 8.500.000' },
    { app: 'BCA', text: 'Pembayaran QRIS Rp25.000 ke WARUNG BU TINI berhasil. Saldo Rp 1.200.000' },
    { app: 'BNI', text: 'Anda menerima transfer Rp 2.500.000,00 dari BUDI SANTOSO' }
  ];
  samples.forEach(function (s) {
    s.token = TOKEN; s.dry = '1';
    Logger.log(handle_(s).getContent());
  });
}
