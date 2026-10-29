// Extra checks: legacy rows without Submission ID, and delete-to-Sampah.
const fs = require('fs');
const vm = require('vm');
const assert = require('assert/strict');

class Range {
  constructor(sheet, row, col, rows, cols) { Object.assign(this, {sheet, row, col, rows, cols}); }
  getValues() { return Array.from({length:this.rows}, (_,r)=>Array.from({length:this.cols}, (_,c)=>this.sheet.data[this.row-1+r]?.[this.col-1+c] ?? '')); }
  getValue() { return this.getValues()[0][0]; }
  setValue(v) { this.sheet.data[this.row-1] ||= []; this.sheet.data[this.row-1][this.col-1] = v; return this; }
}
class Sheet {
  constructor(data, name='Form Responses 1') { this.data=data; this.name=name; }
  getName() { return this.name; }
  getLastColumn() { return Math.max(...this.data.map(r=>r.length)); }
  getLastRow() { return this.data.length; }
  getDataRange() { return new Range(this,1,1,this.getLastRow(),this.getLastColumn()); }
  getRange(row,col,rows=1,cols=1) { return new Range(this,row,col,rows,cols); }
  appendRow(row) { this.data.push(row.slice()); }
  deleteRow(row) { this.data.splice(row-1,1); }
}

const code = fs.readFileSync(process.argv[2], 'utf8');
const context = {
  Utilities: {
    formatDate: (d, tz, pattern) => pattern === 'yyyy-MM-dd' ? new Date(d).toISOString().slice(0,10) : new Date(d).toISOString(),
    getUuid: () => 'uuid-fixed'
  },
  Session: {getScriptTimeZone: ()=>'UTC'},
  SpreadsheetApp: {},
  ContentService: {createTextOutput: s=>({text:s,setMimeType(){return this;}}), MimeType:{JSON:'json'}}
};
vm.createContext(context);
vm.runInContext(code, context);

const headers = ['Submission ID','Respondent ID','Submitted at','Tanggal Transaksi','Untuk apa?','Kategori','Tipe','Metode Pembayaran','Kebutuhan atau Keinginan?','Jumlah cepat','Jumlah','Nama orang','Hutang atau Piutang?'];
const sheet = new Sheet([
  headers,
  ['', 'r1', new Date('2026-10-20T00:00:00Z'), new Date('2026-10-20T00:00:00Z'), 'Lama tanpa ID', 'Makan', '❤️ Keluar', 'Cash', 'Need', '', 15000, '', ''],
  ['tally-9','r2',new Date('2026-10-21T00:00:00Z'),new Date('2026-10-21T00:00:00Z'),'Punya ID','Makan','❤️ Keluar','Cash','Need','',20000,'','']
]);
const ss = {getSpreadsheetTimeZone:()=>'UTC', getSheetByName:(n)=>n==='Form Responses 1'?sheet:null, insertSheet:(n)=>{ const s=new Sheet([],n); ss.__trash=s; return s; }};
context.SpreadsheetApp.getActiveSpreadsheet = () => ss;
const cols = context.getColumns_(sheet);

// 1) legacy row shows up as row_2 and is editable
const d = context.getAppData(ss, sheet, cols, '2026-10');
const legacy = d.recent.find(t => t.desc === 'Lama tanpa ID');
assert.equal(legacy.id, 'row_2');
const upd = context.updateTransaction(sheet, cols, {id:'row_2', tanggal:'2026-10-22', desc:'Lama diedit', kategori:'Makan', tipe:'Keluar', metode:'Debit', amount:17000, nama:'', jenis:''});
assert.equal(upd.ok, true, 'legacy row edit works');
assert.equal(sheet.data[1][4], 'Lama diedit');
assert.equal(sheet.data[1][10], 17000);
assert(String(sheet.data[1][0]).startsWith('legacy_'), 'legacy row gets a stable ID after first edit');

// second edit of the same legacy row must target the same row (now via its new id)
const id2 = String(sheet.data[1][0]);
const upd2 = context.updateTransaction(sheet, cols, {id:id2, tanggal:'2026-10-23', desc:'Lama diedit 2x', kategori:'Makan', tipe:'Keluar', metode:'Cash', amount:18000, nama:'', jenis:''});
assert.equal(upd2.ok, true);
assert.equal(sheet.data[1][4], 'Lama diedit 2x');

// 2) delete moves the row to Sampah
const del = context.deleteTransaction(ss, sheet, cols, 'tally-9');
assert.equal(del.ok, true);
assert.equal(sheet.data.length, 2, 'row removed from source');
assert(ss.__trash, 'Sampah sheet created');
assert.equal(ss.__trash.data[0][0], 'Submission ID', 'Sampah header written first');
assert.equal(ss.__trash.data[1][4], 'Punya ID', 'deleted row copied to Sampah');

// 3) unknown action still reported clearly
const bad = context.doPost({postData:{contents:JSON.stringify({action:'nope',token:'GANTI_DENGAN_TOKEN_YANG_SAMA_DI_APLIKASI'})}});
assert.match(JSON.parse(bad.text).error, /Aksi tidak dikenal/);

// 4) ping reports the backend version without touching the sheet
const ping = JSON.parse(context.doPost({postData:{contents:JSON.stringify({action:'ping',token:'GANTI_DENGAN_TOKEN_YANG_SAMA_DI_APLIKASI'})}}).text);
assert.equal(ping.ok, true);
assert.equal(ping.v, '2.0');
const pingAuth = JSON.parse(context.doPost({postData:{contents:JSON.stringify({action:'ping',token:'salah'})}}).text);
assert.equal(pingAuth.error, 'auth');

console.log('PASS: legacy row_ ids, legacy->stable id upgrade, delete-to-Sampah, unknown action.');
