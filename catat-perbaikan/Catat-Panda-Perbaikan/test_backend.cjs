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
    formatDate: (d, tz, pattern) => {
      const date = new Date(d);
      if (pattern === 'yyyy-MM-dd') return date.toISOString().slice(0,10);
      if (pattern === 'yyyy-MM') return date.toISOString().slice(0,7);
      return date.toISOString();
    },
    getUuid: () => 'uuid-test'
  },
  Session: {getScriptTimeZone: ()=>'UTC'},
  SpreadsheetApp: {},
  ContentService: {createTextOutput: s=>({text:s,setMimeType(){return this;}}), MimeType:{JSON:'json'}}
};
vm.createContext(context);
vm.runInContext(code, context);
const headers = ['Submission ID','Respondent ID','Submitted at','Tanggal Transaksi','Untuk apa?','Kategori','Tipe','Metode Pembayaran','Kebutuhan atau Keinginan?','Jumlah cepat','Jumlah','Nama orang','Hutang atau Piutang?'];
const sheet = new Sheet([headers, ['tally-123','r1',new Date('2026-10-28T00:00:00Z'),new Date('2026-10-28T00:00:00Z'),'Makan siang','Makan','❤️ Keluar','Cash','Need','',25000,'','']]);
const cols = context.getColumns_(sheet);
const ss = {getSpreadsheetTimeZone:()=>'UTC', getSheetByName:(name)=>name==='Form Responses 1'?sheet:null};
context.SpreadsheetApp.getActiveSpreadsheet = () => ss;
const routeResponse = context.doPost({postData:{contents:JSON.stringify({action:'update',token:'GANTI_DENGAN_TOKEN_YANG_SAMA_DI_APLIKASI',id:'tally-123',tanggal:'2026-10-29',desc:'Rute update',kategori:'Makan',tipe:'Keluar',metode:'Cash',amount:26000,nama:'',jenis:''})}});
assert.equal(JSON.parse(routeResponse.text).ok,true, 'doPost accepts the exact update action sent by the frontend');
const data = context.getAppData(ss,sheet,cols,'2026-10');
assert.equal(data.recent[0].id, 'tally-123', 'frontend receives the real stable Submission ID');
const result = context.updateTransaction(sheet,cols,{id:'tally-123',tanggal:'2026-10-29',desc:'Makan malam',kategori:'Makan',tipe:'Keluar',metode:'Debit',amount:30000,nama:'',jenis:''});
assert.equal(result.ok,true, 'update locates the same source row by Submission ID');
assert.equal(sheet.data[1][4], 'Makan malam');
assert.equal(sheet.data[1][10], 30000);
const added = context.addTransaction(sheet, cols, {desc:'Kopi',amount:18000,tipe:'Keluar',kategori:'Makan',metode:'Cash',tanggal:'2026-10-29',reqId:'client-42'});
assert.equal(added.ok, true);
assert.equal(added.id, 'app_client-42');
const rowsAfterFirstAdd = sheet.data.length;
const retried = context.addTransaction(sheet, cols, {desc:'Kopi',amount:18000,tipe:'Keluar',kategori:'Makan',metode:'Cash',tanggal:'2026-10-29',reqId:'client-42'});
assert.equal(retried.id, added.id, 'retry keeps the same id');
assert.equal(sheet.data.length, rowsAfterFirstAdd, 'retry must not create a duplicate row');
const afterAdd = context.getAppData(ss,sheet,cols,'2026-10');
assert(afterAdd.recent.some(t => t.id === added.id), 'new app entry exposes the exact stored ID');
const edited = context.updateTransaction(sheet,cols,{id:added.id,tanggal:'2026-10-29',desc:'Kopi susu',kategori:'Makan',tipe:'Keluar',metode:'Cash',amount:20000,nama:'',jenis:''});
assert.equal(edited.ok,true);
assert.equal(sheet.data[2][4], 'Kopi susu');
console.log('PASS: stable Tally ID is returned and edited in place; new app entries retain an editable stable ID.');
