/**
 * SD보컬학원 · 1:1 비밀글 문의 게시판 API
 * Google Apps Script 웹 앱 (sdmusic.co.kr #consult 섹션 백엔드)
 *
 * 저장소: Google Sheets 「SD보컬학원_1대1_비밀글_게시판」 / inquiries 탭
 * 배포: 배포 > 새 배포 > 웹 앱 / 다음 사용자 권한으로 실행: 나 / 액세스: 모든 사용자
 *
 * API (GET 쿼리 또는 POST text/plain JSON)
 *   action=list    : 삭제되지 않은 글 목록 (id, created_at, author, title, status)
 *   action=create  : author, title, content, password(4자 이상) 저장 + 네이버 메일 알림
 *   action=read    : id, password → 작성자 비밀번호 또는 관리자 비밀번호 검증 후 원문/답변
 *   action=answer  : id, admin_password, answer → 답변 저장, 상태 '답변완료'
 *   action=delete  : id, password → 소프트 삭제(deleted=TRUE)
 *   action=admin   : admin_password → 관리자 모드 확인
 *   action=ping    : 상태 확인
 */

var SHEET_ID = '1WJVlqqLc-y4K7EU7-o3eyH7K0oQ461NPeSkMrEE0UYk';
var TAB_NAME = 'inquiries';
var NOTIFY_EMAIL = 'cd3000xl@naver.com';
var HEADERS = ['id', 'created_at', 'author', 'title', 'content', 'password_hash', 'status', 'answer', 'answered_at', 'deleted'];
var LIMIT = { author: 20, title: 70, content: 3000, answer: 3000 };
var MAX_POSTS = 500;

/* ---------------------------------------------------------------- routing */

function doGet(e) {
  return route(e && e.parameter ? e.parameter : {});
}

function doPost(e) {
  var p = {};
  if (e && e.parameter) {
    for (var k in e.parameter) p[k] = e.parameter[k];
  }
  if (e && e.postData && e.postData.contents) {
    try {
      var o = JSON.parse(e.postData.contents);
      if (o && typeof o === 'object') {
        for (var k2 in o) p[k2] = o[k2];
      }
    } catch (err) {}
  }
  return route(p);
}

function route(p) {
  var action = String(p.action || '');
  var result;
  try {
    if (action === 'list') result = listPosts();
    else if (action === 'create') result = createPost(p);
    else if (action === 'read') result = readPost(p);
    else if (action === 'answer') result = answerPost(p);
    else if (action === 'delete') result = deletePost(p);
    else if (action === 'admin') result = checkAdmin(p);
    else if (action === 'ping') result = { ok: true, pong: true, time: now() };
    else result = { ok: false, error: 'unknown_action' };
  } catch (err) {
    result = { ok: false, error: 'server_error', message: String((err && err.message) || err) };
  }
  return ContentService.createTextOutput(JSON.stringify(result))
    .setMimeType(ContentService.MimeType.JSON);
}

/* ------------------------------------------------------------------ sheet */

function getSheet() {
  var ss = SpreadsheetApp.openById(SHEET_ID);
  var sh = ss.getSheetByName(TAB_NAME);
  if (!sh) {
    sh = ss.getSheets()[0];
    sh.setName(TAB_NAME);
  }
  if (sh.getLastRow() < 1) {
    sh.getRange(1, 1, 1, HEADERS.length).setValues([HEADERS]);
    sh.setFrozenRows(1);
    sh.getRange(1, 1, 1, HEADERS.length).setFontWeight('bold');
  }
  return sh;
}

function readRows() {
  var sh = getSheet();
  var last = sh.getLastRow();
  if (last < 2) return [];
  var values = sh.getRange(2, 1, last - 1, HEADERS.length).getValues();
  var out = [];
  for (var i = 0; i < values.length; i++) {
    var r = values[i];
    if (!r[0]) continue;
    out.push({
      row: i + 2,
      id: String(r[0]),
      created_at: String(r[1]),
      author: String(r[2]),
      title: String(r[3]),
      content: String(r[4]),
      password_hash: String(r[5]),
      status: String(r[6]),
      answer: String(r[7]),
      answered_at: String(r[8]),
      deleted: r[9] === true || String(r[9]).toUpperCase() === 'TRUE'
    });
  }
  return out;
}

/* ------------------------------------------------------------- utilities */

function now() {
  return Utilities.formatDate(new Date(), 'Asia/Seoul', 'yyyy-MM-dd HH:mm:ss');
}

function clean(v, max) {
  var s = String(v == null ? '' : v).replace(/\r\n/g, '\n').trim();
  if (max && s.length > max) s = s.substring(0, max);
  return s;
}

/* 시트 수식으로 해석되지 않도록 앞자리 보호 */
function cell(v) {
  var s = String(v == null ? '' : v);
  return /^[=+\-@]/.test(s) ? "'" + s : s;
}

function sha256(text) {
  var bytes = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, text, Utilities.Charset.UTF_8);
  var hex = '';
  for (var i = 0; i < bytes.length; i++) {
    var b = (bytes[i] + 256) % 256;
    hex += (b < 16 ? '0' : '') + b.toString(16);
  }
  return hex;
}

function hashPassword(pw) {
  var salt = Utilities.getUuid().replace(/-/g, '').substring(0, 16);
  return salt + ':' + sha256(salt + pw);
}

function matchPassword(stored, pw) {
  if (!stored || stored.indexOf(':') < 0 || !pw) return false;
  var parts = stored.split(':');
  return sha256(parts[0] + String(pw)) === parts[1];
}

function adminPassword() {
  return PropertiesService.getScriptProperties().getProperty('ADMIN_PASS') || '';
}

function isAdmin(pw) {
  var a = adminPassword();
  return !!a && String(pw || '') === a;
}

function newId() {
  return 'Q' + Utilities.formatDate(new Date(), 'Asia/Seoul', 'yyMMddHHmmss') +
    String(Math.floor(Math.random() * 90) + 10);
}

/* --------------------------------------------------------------- actions */

function listPosts() {
  var posts = readRows().filter(function (r) { return !r.deleted; });
  posts.sort(function (a, b) { return a.created_at < b.created_at ? 1 : (a.created_at > b.created_at ? -1 : 0); });
  var items = posts.map(function (r, i) {
    return {
      no: posts.length - i,
      id: r.id,
      created_at: r.created_at,
      author: r.author,
      title: r.title,
      status: (r.status === '답변완료' || r.answer) ? '답변완료' : '답변대기'
    };
  });
  return { ok: true, items: items, count: items.length };
}

function createPost(p) {
  var author = clean(p.author, LIMIT.author);
  var title = clean(p.title, LIMIT.title);
  var content = clean(p.content, LIMIT.content);
  var pw = String(p.password == null ? '' : p.password);

  if (author.length < 1) return { ok: false, error: 'author_required' };
  if (title.length < 1) return { ok: false, error: 'title_required' };
  if (content.length < 1) return { ok: false, error: 'content_required' };
  if (pw.length < 4) return { ok: false, error: 'password_too_short' };
  if (pw.length > 40) return { ok: false, error: 'password_too_long' };

  var lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    var live = readRows().filter(function (r) { return !r.deleted; });
    if (live.length >= MAX_POSTS) return { ok: false, error: 'board_full' };

    var sh = getSheet();
    var id = newId();
    var created = now();
    sh.appendRow([
      cell(id), cell(created), cell(author), cell(title), cell(content),
      hashPassword(pw), '답변대기', '', '', 'FALSE'
    ]);
    var no = live.length + 1;

    try {
      MailApp.sendEmail(
        NOTIFY_EMAIL,
        '[SD보컬학원] 새 비밀글 문의가 등록되었습니다 (' + author + ')',
        '제목: ' + title + '\n작성자: ' + author + '\n등록시각: ' + created + '\n\n' + content +
        '\n\n────────────────────────\n' +
        '답변은 홈페이지 1:1 비밀글 게시판(sdmusic.co.kr/#consult)의 [관리자] 모드에서 작성하실 수 있습니다.\n' +
        '글 번호: ' + no + ' / ID: ' + id
      );
    } catch (mailErr) {}

    return { ok: true, id: id, no: no, created_at: created };
  } finally {
    lock.releaseLock();
  }
}

function readPost(p) {
  var id = String(p.id || '');
  var pw = String(p.password == null ? '' : p.password);
  if (!id) return { ok: false, error: 'id_required' };
  if (!pw) return { ok: false, error: 'password_required' };

  var admin = isAdmin(pw);
  var found = null;
  var rows = readRows();
  for (var i = 0; i < rows.length; i++) {
    if (rows[i].id === id) { found = rows[i]; break; }
  }
  if (!found || found.deleted) return { ok: false, error: 'not_found' };
  if (!admin && !matchPassword(found.password_hash, pw)) return { ok: false, error: 'wrong_password' };

  return {
    ok: true,
    admin: admin,
    id: found.id,
    created_at: found.created_at,
    author: found.author,
    title: found.title,
    content: found.content,
    answer: found.answer,
    answered_at: found.answered_at,
    status: (found.status === '답변완료' || found.answer) ? '답변완료' : '답변대기'
  };
}

function answerPost(p) {
  if (!isAdmin(p.admin_password)) return { ok: false, error: 'wrong_admin_password' };
  var id = String(p.id || '');
  var answer = clean(p.answer, LIMIT.answer);
  if (!id) return { ok: false, error: 'id_required' };
  if (!answer) return { ok: false, error: 'answer_required' };

  var rows = readRows();
  var found = null;
  for (var i = 0; i < rows.length; i++) {
    if (rows[i].id === id) { found = rows[i]; break; }
  }
  if (!found || found.deleted) return { ok: false, error: 'not_found' };

  var sh = getSheet();
  var answered = now();
  sh.getRange(found.row, 7, 1, 3).setValues([[cell('답변완료'), cell(answer), cell(answered)]]);
  return { ok: true, id: id, status: '답변완료', answered_at: answered };
}

function deletePost(p) {
  var id = String(p.id || '');
  var pw = String(p.password == null ? '' : p.password);
  if (!id) return { ok: false, error: 'id_required' };
  if (!pw) return { ok: false, error: 'password_required' };

  var admin = isAdmin(pw);
  var rows = readRows();
  var found = null;
  for (var i = 0; i < rows.length; i++) {
    if (rows[i].id === id) { found = rows[i]; break; }
  }
  if (!found || found.deleted) return { ok: false, error: 'not_found' };
  if (!admin && !matchPassword(found.password_hash, pw)) return { ok: false, error: 'wrong_password' };

  getSheet().getRange(found.row, 10).setValue('TRUE');
  return { ok: true, id: id, deleted: true };
}

function checkAdmin(p) {
  return isAdmin(p.admin_password) ? { ok: true, admin: true } : { ok: false, error: 'wrong_admin_password' };
}

/* ----------------------------------------------------------- maintenance */

/** 최초 1회 실행: 시트/헤더 준비 + 관리자 비밀번호 생성(이미 있으면 유지) */
function setup() {
  var props = PropertiesService.getScriptProperties();
  var pass = props.getProperty('ADMIN_PASS');
  if (!pass) {
    var chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    pass = '';
    for (var i = 0; i < 8; i++) pass += chars.charAt(Math.floor(Math.random() * chars.length));
    props.setProperty('ADMIN_PASS', pass);
  }
  var sh = getSheet();
  var url = ScriptApp.getService().getUrl();
  Logger.log('ADMIN_PASS=' + pass);
  Logger.log('SHEET_ROWS=' + sh.getLastRow());
  Logger.log('WEBAPP_URL=' + url);
  return 'ok';
}

/** 관리자 비밀번호를 잊었을 때 실행하면 새 값으로 교체하고 로그에 남깁니다. */
function resetAdminPassword() {
  var chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  var pass = '';
  for (var i = 0; i < 8; i++) pass += chars.charAt(Math.floor(Math.random() * chars.length));
  PropertiesService.getScriptProperties().setProperty('ADMIN_PASS', pass);
  Logger.log('ADMIN_PASS=' + pass);
  return pass;
}
