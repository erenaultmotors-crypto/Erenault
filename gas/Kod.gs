/**
 * Erenault · Eren Oto motor teklif, satış, iş takibi, stok ve ekip mesajlaşma sistemi
 * Google Apps Script sunucu kodu (Kod.gs) · sürüm 3
 *
 * Sürüm 3: hazır motor paketleri, parça stoğu, tedarikçi siparişleri, esnaflar,
 * hazır motor stoğu; Android uygulaması (APK) için JSON bağlantısı (doPost).
 *
 * Kurulum: Bu dosyayı ve Sayfa.html dosyasını aynı Apps Script projesine koyun,
 * "Dağıt > Yeni dağıtım > Web uygulaması" ile yayınlayın
 * (Yürütme: Ben, Erişim: Herkes).
 *
 * İlk çalıştırmada Google Drive'ınızda şunları kendisi oluşturur:
 *  - "Eren Oto Motor Kayıtları" adlı Google E-Tablo (satışlar, mesajlar, fiyatlar)
 *  - "Eren Oto Sözleşmeler" klasörü (imzalı PDF'ler)
 *  - "Eren Oto Dosyalar" klasörü (fotoğraf, dekont, ses kaydı, belge)
 *
 * Linkler:
 *  - Müşteri teklif formu: web uygulaması linki
 *  - Ekip uygulaması (patron, dükkan, çalışanlar): linkin sonuna ?p=panel
 */

var TZ = 'Europe/Istanbul';
var CORE = { getirdi: 1, sonra: 1, yok: 1 };
var COLLS = ['pos', 'supPays', 'stockLog', 'esnaf', 'units', 'prepOrders', 'unitLog', 'aiPending', 'aiLog', 'tasks', 'aiMem', 'reminders'];
var OWNER_ONLY = ['supPays', 'aiPending', 'aiLog', 'aiMem', 'reminders'];
var TASK_W = ['status', 'hist', 'photo', 'wSeen', 'seenAt', 'doneAt', 'pSeen', 'doneQty', 'unitsAdded'];
var KCOLS = ['Tür', 'Zaman', 'Özet', 'id', 'veri (dokunmayın)'];

var STATUS = { gonderildi: 'Form gönderildi', geldi: 'Teklif geldi', satildi: 'Satıldı', teslim: 'Teslim edildi' };
var COLS = ['Satış no', 'Durum', 'Müşteri', 'Telefon', 'Plaka', 'Motor', 'Paket', 'Toplam (₺)', 'Maliyet (₺)', 'Kâr (₺)',
  'Form gönderildi', 'Teklif geldi', 'Satıldı', 'Teslim edildi', 'İmzalı sözleşme', 'Not', 'id', 'veri (dokunmayın)'];
var MCOLS = ['Zaman', 'Gönderen', 'Alıcı', 'Mesaj', 'id', 'veri (dokunmayın)'];
var JOBK = { hazirlama: 'Motor hazırlama', teslimat: 'Teslimat', diger: 'Diğer iş' };
var JOBS_ST = { yeni: 'Yeni', basladi: 'Başladı', parca: 'Parça bekliyor', hazir: 'Hazır', teslim: 'Teslim edildi' };
var PRICE_KEYS = ['lines', 'laborP', 'laborC', 'disc', 'listTotal', 'ek', 'total', 'cost', 'engine', 'pkg'];
var SIGN_KEYS = ['sign', 'signedSnap', 'pdfUrl', 'pdfId', 'token'];

/* ===================== Web sayfası ===================== */

function doGet(e) {
  var boot = buildBoot((e && e.parameter) || {});
  var t = HtmlService.createTemplateFromFile('Sayfa');
  t.boot = JSON.stringify(boot).replace(/</g, '\\u003c');
  return t.evaluate()
    .setTitle(boot.mode === 'app' ? 'Erenault' : 'Eren Oto Motor Teklifi')
    .addMetaTag('viewport', 'width=device-width, initial-scale=1, viewport-fit=cover');
}

/* ===================== Uygulama bağlantısı (APK) ===================== */
// Uygulama bu adrese POST ile {fn, args} gönderir; cevap {ok, r} veya {ok:false, e}.
function doPost(e) {
  var out;
  try {
    var b = JSON.parse((e && e.postData && e.postData.contents) || '{}');
    var fns = { apiPublicBoot: apiPublicBoot, apiAiThink: apiAiThink, apiPushToken: apiPushToken, apiBoot: apiBoot, apiSetup: apiSetup, apiLogin: apiLogin, apiPull: apiPull, apiPush: apiPush, apiUpload: apiUpload, apiFile: apiFile,
      apiPubFile: apiPubFile, apiSigData: apiSigData, apiSavePdf: apiSavePdf, apiAiToken: apiAiToken, apiSubmitQuote: apiSubmitQuote, apiSign: apiSign };
    if (!fns[b.fn]) throw new Error('NOFN');
    out = { ok: true, r: fns[b.fn].apply(null, b.args || []) };
  } catch (err) { out = { ok: false, e: String(err && err.message || err) }; }
  return ContentService.createTextOutput(JSON.stringify(out)).setMimeType(ContentService.MimeType.JSON);
}

// Müşteri teklif / sözleşme sayfası (GitHub'dan açılan) için: fiyat listesi ve sözleşme
function apiPublicBoot(p) {
  p = p || {};
  var b = buildBoot({ s: p.s ? String(p.s).slice(0, 80) : '' });
  delete b.users; delete b.setup;
  return b;
}

function apiBoot() {
  var us = getUsers();
  return { url: ScriptApp.getService().getUrl(), setup: !us.length, users: us.map(function (u) { return { id: u.id, name: u.name, role: u.role }; }) };
}

function buildBoot(p) {
  var url = ScriptApp.getService().getUrl();
  var boot = { url: url, mode: 'musteri', catalog: null, contract: null };
  if (p.p === 'panel' || p.p === 'dukkan' || p.p === 'app') {
    boot.mode = 'app';
    var us = getUsers();
    boot.setup = !us.length;
    boot.users = us.map(function (u) { return { id: u.id, name: u.name, role: u.role }; });
    return boot;
  }
  boot.catalog = publicCatalog(getCatalog());
  if (p.s) {
    boot.mode = 'sozlesme';
    var hit = findByToken(String(p.s));
    boot.contract = hit ? publicSale(hit.sale) : null;
  }
  return boot;
}

/* ===================== Kişiler ve giriş ===================== */

function getUsers() {
  var v = sheetNamed('Sistem').getRange(2, 2).getValue();
  var list = [];
  if (v) { try { list = JSON.parse(v); } catch (e) { list = []; } }
  if (!list.length) {
    // Eski sürümden geçiş: eski panel şifresi patronun şifresi olur.
    var old = props().getProperty('PIN_HASH');
    if (old) {
      list = [{ id: 'u1', name: 'Patron', role: 'patron', phone: '', pinSent: true, ph: old, legacy: true }];
      saveUsers(list);
    }
  }
  return list;
}

function saveUsers(list) {
  var sh = sheetNamed('Sistem');
  sh.getRange(2, 1).setValue('kişiler');
  sh.getRange(2, 2).setValue(JSON.stringify(list));
}

function publicUser(u) {
  return { id: u.id, name: u.name, role: u.role, task: u.task || '', phone: u.phone || '', pinSent: u.pinSent !== false,
    discount: !!u.discount, lastSeen: props().getProperty('LS_' + u.id) || u.lastSeen || null };
}

function pinHash(uid, pin) { return hash('u|' + uid + '|' + pin); }

function apiSetup(name, pin) {
  var lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    if (getUsers().length) throw new Error('SETUPDONE');
    pin = String(pin || '');
    if (pin.length < 6) throw new Error('PINSHORT');
    var u = { id: 'u1', name: clip(name, 40) || 'Patron', role: 'patron', phone: '', pinSent: true };
    u.ph = pinHash(u.id, pin);
    saveUsers([u]);
    return { id: u.id };
  } finally { lock.releaseLock(); }
}

function authU(a) {
  a = a || {};
  var users = getUsers(), u = null;
  for (var i = 0; i < users.length; i++) if (users[i].id === a.u) u = users[i];
  if (!u || !u.ph) throw new Error('BADPIN');
  var c = CacheService.getScriptCache(), k = 'fail_' + u.id;
  var fails = Number(c.get(k) || 0);
  if (fails >= 8) throw new Error('LOCKED');
  var ok = u.legacy ? hash(String(a.p || '')) === u.ph : pinHash(u.id, String(a.p || '')) === u.ph;
  if (!ok) { c.put(k, String(fails + 1), 900); throw new Error('BADPIN'); }
  if (fails) c.remove(k);
  // son görülme (en fazla 2 dakikada bir yazılır)
  var key = 'LS_' + u.id, last = props().getProperty(key);
  if (!last || Date.now() - new Date(last).getTime() > 120000) props().setProperty(key, new Date().toISOString());
  return u;
}

function roleOf(u) { return u.role === 'patron' ? 'owner' : u.role === 'calisan' ? 'worker' : 'staff'; }

/* ===================== Yükleme ve eşitleme ===================== */

function apiLogin(a) {
  var u = authU(a);
  var r = pullFor(u, 0);
  r.me = publicUser(u);
  if (roleOf(u) === 'owner') { r.sheetUrl = ss().getUrl(); r.folderUrl = folder().getUrl(); r.email = ownerEmail(); }
  return r;
}

function apiPull(a, since) {
  var u = authU(a);
  return pullFor(u, Number(since) || 0);
}

function pullFor(u, since) {
  var role = roleOf(u), now = Date.now();
  var C = getCatalog();
  var out = { now: now, role: role };
  var catRev = Number(props().getProperty('CAT_REV') || 0);
  if (!since || catRev > since) out.catalog = C ? (role === 'owner' ? C : teamCatalog(C)) : null;
  var db = readSales(), ids = [], sales = [];
  db.list.forEach(function (x) {
    var v = viewSale(x.sale, u, role);
    if (!v) return;
    ids.push(v.id);
    if (!since || (x.sale.rev || 0) > since) sales.push(v);
  });
  out.ids = ids;
  out.sales = sales;
  out.msgs = readMsgs().list.filter(function (x) {
    var m = x.m;
    if (since && (m.rev || 0) <= since) return false;
    return msgVisible(m, u, role);
  }).map(function (x) { return x.m; });
  var meta = getMeta();
  out.pings = (meta.pings || []).filter(function (p) { return role === 'owner' || p.to === u.id; });
  out.pinned = meta.pinned || null;
  out.users = getUsers().map(publicUser);
  // stok, siparişler, hazır motorlar...
  var st = readStore();
  out.colls = {};
  COLLS.forEach(function (n) {
    var L = st.list(n).filter(function (r) { return !since || (r.rev || 0) > since; });
    if (!since && (n === 'stockLog' || n === 'unitLog' || n === 'aiLog')) L = L.slice(-300);
    L = L.map(function (r) { return collView(n, r, u, role); }).filter(Boolean);
    if (L.length) out.colls[n] = L;
  });
  out.gone = {};
  (meta.gone || []).forEach(function (g) { if (!since || g.t > since) (out.gone[g.c] = out.gone[g.c] || []).push(g.id); });
  if (role !== 'worker' || canPrep(u)) out.stock = getStock();
  if (role === 'owner' && meta.report) out.report = meta.report;
  return out;
}

function msgVisible(m, u, role) {
  if (m.to === 'ekip' || m.to === u.id || m.from === u.id) return true;
  return role !== 'worker' && !!m.job; // işe bağlı mesajlar patron ve dükkanda işin altında görünür
}

function apiPush(a, body) {
  var u = authU(a), role = roleOf(u);
  body = body || {};
  var lock = LockService.getScriptLock();
  lock.waitLock(25000);
  try {
    var now = Date.now();
    // fiyat listesi ve ayarlar (sadece patron)
    if (body.catalog && role === 'owner') { saveCatalog(body.catalog); props().setProperty('CAT_REV', String(now)); }
    if (body.sales && body.sales.length) props().setProperty('NEED_FILL', '1');
    // kişiler (sadece patron)
    if (role === 'owner' && (body.users || body.userDel)) pushUsers(u, body.users || [], body.userDel || []);
    // satışlar
    if ((body.sales && body.sales.length) || (body.saleDel && body.saleDel.length)) pushSales(u, role, body.sales || [], body.saleDel || []);
    // mesajlar
    if (body.msgs && body.msgs.length) pushMsgs(u, role, body.msgs);
    // stok, sipariş, hazır motor kayıtları
    if (body.colls) pushColls(u, role, body.colls);
    if (props().getProperty('NEED_FILL') === '1') { props().deleteProperty('NEED_FILL'); try { srvFill(readSales()); } catch (err) { } }
    // durum sor ve sabit duyuru
    if ((body.pings && body.pings.length) || body.pinned !== undefined) {
      var meta = getMeta();
      if (body.pings) pushPings(u, role, meta, body.pings);
      if (body.pinned !== undefined && role === 'owner') meta.pinned = body.pinned ? clip(body.pinned, 60) : null;
      saveMeta(meta);
    }
  } finally { lock.releaseLock(); }
  return pullFor(u, Number(body.since) || 0);
}

/* ---------- satış birleştirme ---------- */

function applyPatch(s, p, coll) {
  s = JSON.parse(JSON.stringify(s || {}));
  var k;
  for (k in (p.set || {})) s[k] = p.set[k];
  (p.del || []).forEach(function (k2) { delete s[k2]; });
  for (k in (p.c || {})) {
    var ch = p.c[k], arr = (s[k] || []).filter(function (x) { return (ch.dl || []).indexOf(x.id) < 0; });
    (ch.up || []).forEach(function (x) {
      var i = -1;
      for (var j = 0; j < arr.length; j++) if (arr[j].id === x.id) i = j;
      if (i >= 0) arr[i] = x; else arr.push(x);
    });
    s[k] = arr;
  }
  if (p.log && p.log.length) {
    var have = {};
    (s.log || []).forEach(function (x) { have[JSON.stringify(x)] = 1; });
    s.log = (s.log || []).concat(p.log.filter(function (x) { return !have[JSON.stringify(x)]; }))
      .sort(function (a, b) { return String(a.t).localeCompare(String(b.t)); });
  }
  return s;
}

function pushSales(u, role, items, dels) {
  var db = readSales(), C = getCatalog();
  items.forEach(function (it) {
    if (!it || !it.id || !it.p) return;
    var hit = db.byId[it.id], cur = hit ? hit.sale : null, s;
    if (role === 'worker') {
      if (!cur) return;
      s = workerMerge(cur, it.p, u);
      if (!s) return;
    } else {
      var p = sanitizePatch(it.p, role);
      if (!cur) {
        s = applyPatch({}, p);
        s.id = it.id;
        s.dates = s.dates || {};
        s.customer = s.customer || { name: '', phone: '', plate: '' };
        s.status = s.status || 'geldi';
        if (role === 'staff') s.byStaff = true;
      } else {
        s = applyPatch(cur, p);
        SIGN_KEYS.forEach(function (k) { if (cur[k] !== undefined) s[k] = cur[k]; else delete s[k]; });
        if (cur.sign && !s.sign) s.sign = cur.sign;
      }
      if (role === 'staff') {
        var cfgChanged = !cur || JSON.stringify(priceCfg(cur.cfg)) !== JSON.stringify(priceCfg(s.cfg));
        if (cur) PRICE_KEYS.forEach(function (k) { if (cur[k] !== undefined) s[k] = cur[k]; else delete s[k]; });
        if (C && s.cfg && cfgChanged) {
          var cfg = s.cfg;
          if (!u.discount) { cfg.ek = 0; cfg.manual = 0; cfg.pmode = 'liste'; }
          var snap = snapshotSrv(C, fullCfg(C, cfg));
          for (var k in snap) s[k] = snap[k];
        }
      }
      if (!s.token) s.token = newToken();
      if (!s.no || dupNo(db, s)) s.no = nextNo(db);
      if (s.status === 'satildi' && cur && cur.status !== 'satildi' && !(s.jobs && s.jobs.length)) { /* elle satıldı: iş emri istemcide */ }
    }
    s.rev = Date.now();
    writeSale(db, s);
    var had = {}; ((cur && cur.jobs) || []).forEach(function (j) { had[j.id] = 1; });
    (s.jobs || []).forEach(function (j) { if (!had[j.id] && j.to && j.to !== u.id) pushTo([j.to], 'Yeni iş: ' + (JOBK[j.kind] || 'İş'), (s.customer.name || '') + ' · ' + (s.engine || '') + (j.note ? ' · ' + j.note : ''), 'isler'); });
    if (role === 'worker' && cur) (s.jobs || []).forEach(function (j) {
      var o = null; (cur.jobs || []).forEach(function (x) { if (x.id === j.id) o = x; });
      if (o && o.status !== j.status && (j.status === 'hazir' || j.status === 'teslim' || j.status === 'parca')) pushTo('owner', u.name + ': ' + (JOBS_ST[j.status] || j.status), (JOBK[j.kind] || '') + ' · ' + (s.customer.name || ''), 'isler');
    });
  });
  if (role === 'owner' && dels.length) {
    var rows = [];
    dels.forEach(function (id) { if (db.byId[id]) rows.push(db.byId[id].row); });
    rows.sort(function (a, b) { return b - a; }).forEach(function (r) { db.sh.deleteRow(r); });
  }
}

function sanitizePatch(p, role) {
  var q = { set: {}, del: [], c: {}, log: (p.log || []).slice(0, 50) };
  var k;
  for (k in (p.set || {})) {
    if (SIGN_KEYS.indexOf(k) >= 0 || k === 'rev' || k === 'id') continue;
    if (role === 'staff' && (k === 'byStaff')) continue;
    q.set[k] = p.set[k];
  }
  (p.del || []).forEach(function (k2) { if (SIGN_KEYS.indexOf(k2) < 0 && k2 !== 'rev' && k2 !== 'id' && k2 !== 'no') q.del.push(k2); });
  ['jobs', 'pays'].forEach(function (c) { if (p.c && p.c[c]) q.c[c] = p.c[c]; });
  return q;
}

function priceCfg(c) {
  c = c || {};
  return [c.engineId, c.core || 'getirdi', Number(c.qty) || 1, Number(c.ek) || 0, Number(c.manual) || 0, c.pmode || ''];
}

function fullCfg(C, c) {
  var o = cleanCfg(C, c);
  o.ek = Number(c.ek) || 0; o.manual = Number(c.manual) || 0;
  return o;
}

function canPrep(u) {
  var C = getCatalog();
  return u.task === 'hazirlama' || !!(C && C.settings && C.settings.vekil === u.id);
}

var WORKER_JOB_FIELDS = ['status', 'hist', 'photo', 'proof', 'wSeen', 'seenAt', 'doneAt', 'pSeen'];

function workerMerge(cur, p, u) {
  var mine = {};
  (cur.jobs || []).forEach(function (j) { if (j.to === u.id) mine[j.id] = j; });
  var up = (p.c && p.c.jobs && p.c.jobs.up) || [];
  var changed = false, s = JSON.parse(JSON.stringify(cur)), now = new Date().toISOString();
  up.forEach(function (nj) {
    if (!mine[nj.id]) return;
    var j = null;
    s.jobs.forEach(function (x) { if (x.id === nj.id) j = x; });
    var old = j.status;
    WORKER_JOB_FIELDS.forEach(function (f) { if (nj[f] !== undefined) j[f] = nj[f]; else if (f === 'doneAt' || f === 'proof') delete j[f]; });
    if (j.status && !JOBS_ST[j.status]) j.status = old;
    changed = true;
    if (old !== j.status) {
      if (j.kind === 'hazirlama' && j.status === 'hazir') {
        s.jobs.forEach(function (x) {
          if (x.kind === 'teslimat' && x.status !== 'teslim') {
            x.wSeen = false;
            x.hist = (x.hist || []).concat([{ t: now, u: 'Sistem', st: x.status, note: 'Motor hazır, teslimata çıkabilir' }]);
          }
        });
      }
      if (j.kind === 'teslimat' && j.status === 'teslim' && s.status !== 'teslim') {
        s.status = 'teslim'; s.dates = s.dates || {}; s.dates.teslim = todayTR();
        s.log = (s.log || []).concat([{ t: now, u: 'Sistem', a: 'Satış teslim edildi olarak işaretlendi' }]);
      }
    }
  });
  var logs = (p.log || []).filter(function (x) { return x && x.u === u.name; }).slice(0, 20);
  if (logs.length) { s = applyPatch(s, { log: logs }); changed = true; }
  return changed ? s : null;
}

/* ---------- satış görünümleri ---------- */

function viewSale(s, u, role) {
  if (role === 'owner') return s;
  if (role === 'staff') return staffView(s);
  var my = (s.jobs || []).filter(function (j) { return j.to === u.id; });
  if (!my.length) return null;
  var del = my.some(function (j) { return j.kind === 'teslimat'; });
  return {
    id: s.id, no: s.no, status: s.status, rev: s.rev,
    customer: { name: s.customer.name || '', plate: s.customer.plate || '', phone: del ? (s.customer.phone || '') : '' },
    engine: s.engine, pkg: s.pkg, qty: s.qty || 1, core: s.core || '', cfg: { engineId: (s.cfg || {}).engineId, qty: (s.cfg || {}).qty || 1 },
    lines: (s.lines || []).map(function (l) { return { id: l.id, name: l.name, qty: l.qty, unit: l.unit, b: l.b || '', kind: l.kind }; }),
    jobs: s.jobs || [], dates: { satildi: (s.dates || {}).satildi || '', teslim: (s.dates || {}).teslim || '' }
  };
}

function staffView(s) {
  var v = JSON.parse(JSON.stringify(s));
  delete v.cost; delete v.laborC; delete v.partsC;
  (v.lines || []).forEach(function (l) { l.c = 0; });
  if (v.signedSnap) (v.signedSnap.lines || []).forEach(function (l) { l.c = 0; });
  if (v.orig) (v.orig.lines || []).forEach(function (l) { delete l.c; });
  return v;
}

/* ---------- kişiler ---------- */

function pushUsers(me, items, dels) {
  var list = getUsers(), byId = {};
  list.forEach(function (x) { byId[x.id] = x; });
  items.forEach(function (it) {
    if (!it || !it.id) return;
    var x = byId[it.id];
    if (!x) {
      if (!it.pin) return;
      x = { id: clip(it.id, 30) }; list.push(x); byId[x.id] = x;
    }
    x.name = clip(it.name, 40) || x.name || 'Kişi';
    if (x.id !== me.id) x.role = ({ patron: 1, dukkan: 1, calisan: 1 })[it.role] ? it.role : (x.role || 'calisan');
    x.task = clip(it.task, 20);
    x.phone = clip(it.phone, 30);
    x.discount = !!it.discount;
    x.pinSent = it.pinSent !== false;
    if (it.pin && String(it.pin).length >= 4) { x.ph = pinHash(x.id, String(it.pin)); delete x.legacy; }
  });
  dels.forEach(function (id) { if (id !== me.id) list = list.filter(function (x) { return x.id !== id; }); });
  saveUsers(list);
}

/* ---------- durum sor ---------- */

function pushPings(u, role, meta, items) {
  var list = meta.pings || [], byId = {};
  list.forEach(function (x) { byId[x.id] = x; });
  items.forEach(function (it) {
    if (!it || !it.id) return;
    var x = byId[it.id];
    if (!x) {
      if (role !== 'owner') return;
      x = { id: clip(it.id, 40), to: clip(it.to, 30), by: u.name, t: it.t || new Date().toISOString(), answered: false };
      list.push(x); byId[x.id] = x;
      pushTo([x.to], u.name + ' durum soruyor', 'İşlerin ne durumda? Dokunup cevaplayın.', 'isler');
      return;
    }
    if (u.id === x.to) {
      ['answered', 'reply', 'note', 'rt', 'seenAt'].forEach(function (f) { if (it[f] !== undefined) x[f] = typeof it[f] === 'string' ? clip(it[f], 300) : it[f]; });
      if (it.answered) x.pSeen = false;
    }
    if (role === 'owner' && it.pSeen !== undefined) x.pSeen = it.pSeen;
  });
  meta.pings = list.slice(-200);
}

/* ---------- mesajlar ---------- */

function pushMsgs(u, role, items) {
  var db = readMsgs(), users = getUsers(), ok = {};
  users.forEach(function (x) { ok[x.id] = 1; });
  items.forEach(function (it) {
    if (!it || !it.id) return;
    var hit = db.byId[it.id];
    if (!hit) {
      if (it.from !== u.id || !(it.to === 'ekip' || ok[it.to])) return;
      var m = { id: clip(it.id, 40), from: u.id, to: it.to, t: it.t || new Date().toISOString(), text: clip(it.text, 4000), readBy: {} };
      m.readBy[u.id] = m.t;
      if (it.job && it.job.sid) m.job = { sid: clip(it.job.sid, 40), jid: clip(it.job.jid, 40) };
      if (isRef(it.photo)) m.photo = it.photo;
      if (it.audio && isRef(it.audio.data)) m.audio = { data: it.audio.data, dur: Number(it.audio.dur) || 0, type: clip(it.audio.type, 40) };
      if (it.doc && isRef(it.doc.data)) m.doc = { data: it.doc.data, name: clip(it.doc.name, 120), size: Number(it.doc.size) || 0, type: clip(it.doc.type, 80) };
      if (it.loc) m.loc = { name: clip(it.loc.name, 80), addr: clip(it.loc.addr, 200), url: clip(it.loc.url, 300),
        lat: it.loc.lat != null ? Number(it.loc.lat) : undefined, lng: it.loc.lng != null ? Number(it.loc.lng) : undefined, acc: Number(it.loc.acc) || undefined };
      m.rev = Date.now();
      writeMsg(db, m);
      var prev = m.text ? m.text.slice(0, 120) : m.audio ? '🎤 Sesli mesaj' : m.photo ? '📷 Fotoğraf' : m.doc ? '📎 ' + m.doc.name : m.loc ? '📍 Konum' : '';
      pushTo(m.to === 'ekip' ? users.filter(function (x) { return x.id !== u.id; }).map(function (x) { return x.id; }) : [m.to],
        u.name + (m.to === 'ekip' ? ' · Ekip' : ''), prev, 'mesaj');
      return;
    }
    var m2 = hit.m, ch = false;
    if (msgVisible(m2, u, role) && it.readBy && it.readBy[u.id] && !(m2.readBy || {})[u.id]) { m2.readBy = m2.readBy || {}; m2.readBy[u.id] = it.readBy[u.id]; ch = true; }
    if (it.deleted && !m2.deleted && (m2.from === u.id || role === 'owner')) {
      [m2.photo, m2.audio && m2.audio.data, m2.doc && m2.doc.data].forEach(function (r) { if (isRef(r)) try { DriveApp.getFileById(r.slice(4)).setTrashed(true); } catch (e) { } });
      m2.deleted = true; m2.delBy = u.id; ['text', 'photo', 'doc', 'loc', 'audio', 'job'].forEach(function (f) { delete m2[f]; }); ch = true;
    }
    if (ch) { m2.rev = Date.now(); writeMsg(db, m2); }
  });
}

function isRef(v) { return typeof v === "string" && /^drv:[\w-]{3,120}$/.test(v); }

function readMsgs() {
  var sh = sheetNamed('Mesajlar'), n = sh.getLastRow(), list = [], byId = {};
  if (n >= 2) {
    var v = sh.getRange(2, 1, n - 1, MCOLS.length).getValues();
    for (var i = 0; i < v.length; i++) {
      var raw = v[i][MCOLS.length - 1];
      if (!raw) continue;
      try { var m = JSON.parse(raw), x = { row: i + 2, m: m }; list.push(x); byId[m.id] = x; } catch (e) { }
    }
  }
  return { sh: sh, list: list, byId: byId };
}

function writeMsg(db, m) {
  var names = {};
  getUsers().forEach(function (x) { names[x.id] = x.name; });
  var row = [m.t, names[m.from] || m.from, m.to === 'ekip' ? 'Ekip' : (names[m.to] || m.to),
    m.deleted ? '(silindi)' : (m.text || (m.audio ? '(sesli mesaj)' : m.photo ? '(fotoğraf)' : m.doc ? '(belge) ' + m.doc.name : m.loc ? '(konum) ' + (m.loc.name || '') : '')),
    m.id, JSON.stringify(m)];
  var hit = db.byId[m.id];
  if (hit) { db.sh.getRange(hit.row, 1, 1, MCOLS.length).setValues([row]); hit.m = m; }
  else {
    var r = db.sh.getLastRow() + 1;
    db.sh.getRange(r, 1, 1, MCOLS.length).setValues([row]);
    var x = { row: r, m: m }; db.list.push(x); db.byId[m.id] = x;
  }
}

/* ---------- dosyalar (fotoğraf, dekont, ses, belge) ---------- */

function apiUpload(a, dataUrl, name) {
  authU(a);
  var m = String(dataUrl || '').match(/^data:([^;,]+)?(;base64)?,(.*)$/);
  if (!m || !m[2]) throw new Error('BADFILE');
  if (m[3].length > 16000000) throw new Error('TOOBIG');
  var blob = Utilities.newBlob(Utilities.base64Decode(m[3]), m[1] || 'application/octet-stream', clip(name, 120) || 'dosya');
  var f = mediaFolder().createFile(blob);
  return 'drv:' + f.getId();
}

function apiFile(a, ref) {
  authU(a);
  var id = String(ref || '').replace(/^drv:/, '');
  var f = DriveApp.getFileById(id);
  var allowed = { }, it = f.getParents();
  allowed[mediaFolder().getId()] = 1; allowed[folder().getId()] = 1;
  var okp = false;
  while (it.hasNext()) if (allowed[it.next().getId()]) okp = true;
  if (!okp) throw new Error('NOTFOUND');
  var b = f.getBlob();
  return 'data:' + (b.getContentType() || 'application/octet-stream') + ';base64,' + Utilities.base64Encode(b.getBytes());
}

/* ---------- imza, PDF ---------- */

function apiSigData(a, id) {
  var u = authU(a);
  if (roleOf(u) === 'worker') throw new Error('NOTFOUND');
  var hit = readSales().byId[id];
  if (!hit || !hit.sale.sign || !hit.sale.sign.sigFile) return null;
  var b = DriveApp.getFileById(hit.sale.sign.sigFile).getBlob();
  return 'data:image/png;base64,' + Utilities.base64Encode(b.getBytes());
}

function apiSavePdf(a, id, b64) {
  var u = authU(a);
  if (roleOf(u) === 'worker') throw new Error('NOTFOUND');
  var lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    var db = readSales(), hit = db.byId[id];
    if (!hit) throw new Error('NOTFOUND');
    var s = hit.sale;
    savePdfFile(s, b64);
    s.rev = Date.now();
    writeSale(db, s);
    return true;
  } finally { lock.releaseLock(); }
}

/* ===================== Müşteri işlemleri ===================== */

function apiSubmitQuote(d) {
  d = d || {};
  var name = clip(d.name, 80), phone = clip(d.phone, 30), plate = clip(d.plate, 20), note = clip(d.note, 500);
  if (!name || digits(phone).length < 10) throw new Error('BADINPUT');
  if (!d.kvkk) throw new Error('KVKK');
  var c = CacheService.getScriptCache();
  var n = Number(c.get('quotes') || 0);
  if (n > 40) throw new Error('BUSY');
  c.put('quotes', String(n + 1), 600);
  var C = getCatalog();
  if (!C) throw new Error('NOCAT');
  var cfg = cleanCfg(C, d.cfg || {});
  var snap = snapshotSrv(C, cfg);
  var lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    var db = readSales();
    var key = waKey(phone), s = null;
    db.list.forEach(function (x) { if (!s && x.sale.status === 'gonderildi' && waKey(x.sale.customer.phone) === key) s = x.sale; });
    if (!s) s = { id: 's' + Date.now() + Math.floor(Math.random() * 1000), no: nextNo(db), token: newToken(), dates: {} };
    for (var k in snap) s[k] = snap[k];
    cfg.name = name; cfg.phone = phone; cfg.plate = plate; cfg.note = note; cfg.kvkk = true;
    s.cfg = cfg;
    s.customer = { name: name, phone: phone, plate: plate };
    s.note = note;
    s.status = 'geldi';
    s.dates = s.dates || {};
    s.dates.geldi = todayTR();
    s.seen = false;
    s.recvAt = new Date().toISOString();
    s.kvkk = { at: s.recvAt, how: 'form' };
    s.orig = { lines: s.lines.map(function (l) { return { id: l.id, name: l.name, qty: l.qty, p: 0, kind: l.kind }; }), total: s.total };
    s.log = (s.log || []).concat([{ t: s.recvAt, u: 'Müşteri', a: 'Teklif formunu gönderdi' }]);
    if (!s.token) s.token = newToken();
    s.rev = Date.now();
    writeSale(db, s);
    notify('Yeni teklif: ' + name + ' · ' + money(s.total),
      name + ' (' + phone + ') yeni bir motor teklifi gönderdi.\n\nMotor: ' + s.engine + '\nAdet: ' + (s.qty || 1) + '\nEski motor: ' + ({ getirdi: 'getirecek', sonra: 'sonra getirecek (depozito)', yok: 'teslim edilmeyecek' })[s.core] + '\nToplam: ' + money(s.total) + '\nSatış no: ' + s.no);
    pushTo('staff', 'Yeni teklif: ' + name, s.engine + ' · ' + money(s.total), 'satislar');
    return { no: s.no, total: s.total };
  } finally { lock.releaseLock(); }
}

function apiSign(token, d) {
  d = d || {};
  var name = clip(d.name, 80);
  if (!name) throw new Error('BADINPUT');
  var lock = LockService.getScriptLock();
  lock.waitLock(25000);
  try {
    var db = readSales(), hit = null;
    db.list.forEach(function (x) { if (!hit && x.sale.token === String(token)) hit = x; });
    if (!hit) throw new Error('NOTFOUND');
    var s = hit.sale;
    if (s.sign) return { already: true, pdfUrl: s.pdfUrl || null };
    if (!s.lines) throw new Error('NOQUOTE');
    if (!s.kvkk && !d.kv) throw new Error('KVKK');
    var now = new Date(), at = now.toISOString();
    var ca = d.at ? new Date(d.at) : null;
    if (ca && !isNaN(ca) && Math.abs(ca - now) < 15 * 60 * 1000) at = ca.toISOString();
    var sigFile = null;
    if (d.sig && /^data:image\/png;base64,/.test(d.sig) && d.sig.length < 2000000) {
      var blob = Utilities.newBlob(Utilities.base64Decode(d.sig.split(',')[1]), 'image/png', s.no + ' imza.png');
      sigFile = folder().createFile(blob).getId();
    }
    var by = clip(d.by, 40) || null;
    s.sign = { name: name, at: at, sigFile: sigFile, phone: s.customer.phone, by: by };
    if (!s.kvkk && d.kv) s.kvkk = { at: at, how: 'imza' };
    s.signSeen = false;
    s.signedSnap = {
      customer: s.customer, engine: s.engine, pkg: s.pkg, lines: s.lines, laborP: s.laborP, disc: s.disc,
      base: s.base, coreFee: s.coreFee || 0, dep: s.dep || 0, core: s.core || 'getirdi', qty: s.qty || 1,
      listTotal: s.listTotal || null, ek: s.ek || 0, terms: (s.terms && s.terms.length) ? s.terms : genTerms(),
      plan: s.plan || [], orig: s.orig || null,
      total: s.total, no: s.no, dates: { geldi: s.dates.geldi, gonderildi: s.dates.gonderildi }
    };
    if (s.status !== 'teslim') s.status = 'satildi';
    s.dates.satildi = Utilities.formatDate(new Date(at), TZ, 'yyyy-MM-dd');
    s.log = (s.log || []).concat([{ t: at, u: by || 'Müşteri', a: by ? 'Sözleşmeyi yüz yüze imzalattı (' + name + ')' : 'Sözleşmeyi okudu ve imzaladı' }]);
    if (d.pdf) { try { savePdfFile(s, d.pdf); } catch (err) { } }
    autoJobsSrv(s, 'imza');
    s.rev = Date.now();
    writeSale(db, s);
    try { srvFill(db); } catch (err) { }
    pushTo('staff', 'Sözleşme imzalandı: ' + name, s.no + ' · ' + money(s.total), 'satislar');
    (s.jobs || []).forEach(function (j) { if (j.to) pushTo([j.to], 'Yeni iş: ' + (JOBK[j.kind] || 'İş'), (s.customer.name || '') + ' · ' + (s.engine || ''), 'isler'); });
    notify('Sözleşme imzalandı: ' + name + ' · ' + money(s.total),
      name + ', ' + s.no + ' numaralı sözleşmeyi okudu ve imzaladı.\n\n' +
      'Motor: ' + s.engine + '\nToplam: ' + money(s.total) +
      (s.pdfUrl ? '\nİmzalı sözleşme: ' + s.pdfUrl : '\nPDF panelden oluşturulabilir.'));
    return { pdfUrl: s.pdfUrl || null, at: at };
  } finally { lock.releaseLock(); }
}

/* ---------- otomatik iş emri (imzada) ---------- */

function autoJobsSrv(s, trig) {
  var C = getCatalog(), st = (C && C.settings) || {};
  if ((st.jobTrigger || 'imza') !== trig || (s.jobs && s.jobs.length)) return;
  var rules = st.rules || {}, users = getUsers(), ids = {}, made = [], t = new Date().toISOString();
  users.forEach(function (x) { ids[x.id] = x.name; });
  ['hazirlama', 'teslimat'].forEach(function (k) {
    (rules[k] || []).forEach(function (uid) {
      if (!ids[uid]) return;
      (s.jobs = s.jobs || []).push({ id: newToken(), kind: k, to: uid, status: 'yeni',
        due: addDaysTR(k === 'teslimat' ? 3 : 2), t: t, by: 'Sistem', mode: 'dukkan', where: '', note: '',
        wSeen: false, pSeen: true, auto: true, hist: [{ t: t, u: 'Sistem', st: 'yeni', note: 'İş emri oluşturuldu' }] });
      made.push(ids[uid] + ': ' + JOBK[k].toLowerCase());
    });
  });
  if (made.length) s.log = (s.log || []).concat([{ t: t, u: 'Sistem', a: 'İş emirleri otomatik oluşturuldu (' + made.join(', ') + ')' }]);
}

function addDaysTR(n) { return Utilities.formatDate(new Date(Date.now() + n * 864e5), TZ, 'yyyy-MM-dd'); }

/* ===================== Fiyat hesabı (sunucu) ===================== */

function r50(x) { return Math.round(x / 50) * 50; }

function cleanCfg(C, q) {
  q = q || {};
  var e = C.engines.filter(function (x) { return x.id === q.engineId; })[0] || C.engines[0];
  var n = Math.round(Number(q.qty) || 1); if (n < 1) n = 1; if (n > 50) n = 50;
  return { engineId: e.id, core: CORE[q.core] ? q.core : 'getirdi', qty: n };
}

function snapshotSrv(C, q) {
  var e = C.engines.filter(function (x) { return x.id === q.engineId; })[0] || C.engines[0];
  var n = Math.max(1, Math.round(Number(q.qty) || 1)), parts = {};
  (C.parts || []).forEach(function (p) { parts[p.id] = p; });
  var pc = 0, lines = (e.recipe || []).map(function (r) {
    var p = parts[r.pid] || { name: '?', cost: 0 }, u = Number(r.qty) || 0;
    pc += (Number(p.cost) || 0) * u * n;
    return { id: r.pid, name: p.name, qty: u * n, unit: u, c: (Number(p.cost) || 0) * u * n, p: 0, b: '', kind: 'part' };
  });
  var dep = Number((C.settings || {}).depozito) || 0, core = CORE[q.core] ? q.core : 'getirdi';
  var coreFee = core === 'yok' ? dep * n : 0, depo = core === 'sonra' ? dep * n : 0;
  var base = (Number(e.price) || 0) * n, listTotal = base + coreFee, total = listTotal, ek = 0;
  if (Number(q.manual) > 0) { total = Math.round(Number(q.manual)); ek = listTotal - total; }
  else if (Number(q.ek) > 0) { ek = Math.round(Number(q.ek)); total = listTotal - ek; }
  var lc = (Number(e.laborC) || 0) * n;
  return {
    engine: e.name + ' (' + (e.code || '') + ')', pkg: n > 1 ? n + ' adet' : 'Hazır paket', lines: lines,
    laborP: 0, laborC: lc, disc: 0, base: base, coreFee: coreFee, dep: depo, core: core, qty: n,
    listTotal: listTotal, ek: ek, total: total, cost: pc + lc
  };
}

/* ===================== Stok, sipariş, hazır motor kayıtları ===================== */

function getStock() {
  var v = sheetNamed('Sistem').getRange(4, 2).getValue();
  if (!v) return {};
  try { return JSON.parse(v); } catch (e) { return {}; }
}

function saveStock(m) {
  var sh = sheetNamed('Sistem');
  sh.getRange(4, 1).setValue('stok');
  sh.getRange(4, 2).setValue(JSON.stringify(m));
}

function readStore() {
  var sh = sheetNamed('Kayıtlar'), n = sh.getLastRow(), by = {}, lists = {};
  if (n >= 2) {
    var v = sh.getRange(2, 1, n - 1, KCOLS.length).getValues();
    for (var i = 0; i < v.length; i++) {
      var raw = v[i][KCOLS.length - 1];
      if (!raw) continue;
      try { var r = JSON.parse(raw), c = String(v[i][0]); by[c + '|' + r.id] = { row: i + 2, c: c, rec: r }; } catch (e) { }
    }
  }
  return {
    sh: sh, by: by,
    get: function (c, id) { var x = by[c + '|' + id]; return x ? x.rec : null; },
    list: function (c) {
      if (!lists[c]) { lists[c] = []; for (var k in by) if (by[k].c === c) lists[c].push(by[k].rec); }
      return lists[c];
    },
    put: function (c, rec) {
      rec.rev = Date.now();
      var row = [c, rec.t || new Date().toISOString(), storeSummary(c, rec), rec.id, JSON.stringify(rec)];
      var x = by[c + '|' + rec.id];
      if (x) { sh.getRange(x.row, 1, 1, KCOLS.length).setValues([row]); x.rec = rec; }
      else {
        var r2 = sh.getLastRow() + 1;
        sh.getRange(r2, 1, 1, KCOLS.length).setValues([row]);
        by[c + '|' + rec.id] = { row: r2, c: c, rec: rec };
      }
      if (lists[c]) { var L = lists[c], f = -1; for (var i2 = 0; i2 < L.length; i2++) if (L[i2].id === rec.id) f = i2; if (f >= 0) L[f] = rec; else L.push(rec); }
    },
    del: function (c, id) {
      var x = by[c + '|' + id]; if (!x) return;
      sh.getRange(x.row, 1, 1, KCOLS.length).clearContent(); delete by[c + '|' + id]; if (lists[c]) lists[c] = lists[c].filter(function (r) { return r.id !== id; });
    }
  };
}

function storeSummary(c, r) {
  var C = getCatalogCached(), eng = {}, sup = {}, prt = {};
  if (C) { (C.engines || []).forEach(function (e) { eng[e.id] = e.name; }); (C.suppliers || []).forEach(function (t) { sup[t.id] = t.name; }); (C.parts || []).forEach(function (p) { prt[p.id] = p.name; }); }
  if (c === 'pos') return (r.no || '') + ' · ' + (sup[r.sup] || '') + ' · ' + ({ onay: 'onay bekliyor', gonderildi: 'yolda', alindi: 'teslim alındı', red: 'reddedildi' })[r.status] + ' · ' + (r.lines || []).map(function (l) { return l.name + ' ' + l.qty; }).join(', ');
  if (c === 'stockLog') return (prt[r.pid] || r.pid) + ' ' + (r.d > 0 ? '+' : '') + r.d + ' · ' + (r.ref || '') + ' · ' + (r.by || '');
  if (c === 'units') return (eng[r.eid] || r.eid) + (r.out ? ' · çıktı' : r.sale ? ' · ayrılmış' : ' · boşta');
  if (c === 'unitLog') return (r.by || '') + ': ' + r.n + ' adet ' + (eng[r.eid] || '');
  if (c === 'prepOrders') return r.qty + ' adet ' + (eng[r.eid] || '') + ' · ' + (r.done || 0) + ' hazır';
  if (c === 'esnaf') return (r.shop || '') + ' · ' + (r.name || '');
  if (c === 'supPays') return (sup[r.sup] || '') + ' · ' + money(r.amt);
  if (c === 'aiLog') return r.title || '';
  if (c === 'aiMem') return r.text || '';
  if (c === 'reminders') return (r.done ? '✓ ' : '') + (r.at || '') + ' · ' + (r.text || '');
  if (c === 'tasks') { var us = {}; getUsers().forEach(function (x) { us[x.id] = x.name; }); return (us[r.to] || '') + ' · ' + (r.title || '') + ' · ' + (JOBS_ST[r.status] || r.status); }
  if (c === 'aiPending') return (r.status || '') + ' · ' + (r.title || '');
  return '';
}

var _catCache = null;
function getCatalogCached() { if (!_catCache) _catCache = getCatalog(); return _catCache; }

// Kim neyi görür
function collView(n, r, u, role) {
  if (role === 'owner') return r;
  if (OWNER_ONLY.indexOf(n) >= 0) return null;
  if (role === 'worker') {
    if (n === 'tasks') return r.to === u.id ? r : null;
    if (!canPrep(u) || ['units', 'prepOrders', 'unitLog'].indexOf(n) < 0) return null;
    if (n === 'unitLog' && r.by !== u.name) return null;
    return r;
  }
  if (n === 'pos') {
    var x = JSON.parse(JSON.stringify(r));
    delete x.total; delete x.recvTotal;
    (x.lines || []).forEach(function (l) { l.cost = 0; });
    return x;
  }
  return r;
}

// Kim neyi yazabilir (sunucu her kaydı kendisi denetler)
function pushColls(u, role, colls) {
  var st = readStore(), C = getCatalog() || { parts: [], engines: [], suppliers: [] }, meta = null, stock = null;
  var parts = {}, engines = {}, sups = {};
  (C.parts || []).forEach(function (p) { parts[p.id] = p; });
  (C.engines || []).forEach(function (e) { engines[e.id] = e; });
  (C.suppliers || []).forEach(function (t) { sups[t.id] = t; });
  var now = new Date().toISOString(), db = null, unitsTouched = false;
  var prep = role === 'worker' && (canPrep(u) || st.list('tasks').some(function (t) { return t.to === u.id && t.kind === 'hazirlama'; }));
  function sales() { if (!db) db = readSales(); return db; }
  COLLS.forEach(function (n) {
    var ch = colls[n]; if (!ch) return;
    (ch.up || []).forEach(function (it) {
      if (!it || !it.id) return;
      it.id = clip(it.id, 40);
      var cur = st.get(n, it.id), rec = null;
      if (n === 'tasks') {
        rec = null;
        if (role === 'owner') {
          rec = it;
          if (!cur || cur.to !== it.to) pushTo([it.to], 'Yeni iş', clip(it.title || it.note || '', 120), 'isler');
        } else if (role === 'worker' && cur && cur.to === u.id) {
          rec = JSON.parse(JSON.stringify(cur));
          TASK_W.forEach(function (f) { if (it[f] !== undefined) rec[f] = it[f]; });
          if (!JOBS_ST[rec.status]) rec.status = cur.status;
          if (cur.status !== rec.status) {
            var dn = rec.status === 'hazir' || rec.status === 'teslim';
            pushTo('owner', u.name + ': ' + (dn ? 'Bitti' : JOBS_ST[rec.status] || ''), clip(rec.title || '', 100) + (dn && rec.doneQty != null && rec.kind === 'hazirlama' ? ' · ' + rec.doneQty + ' adet' : ''), 'isler');
            if (dn && rec.grp) st.list('tasks').forEach(function (x) {
              if (x.grp === rec.grp && x.id !== rec.id && x.status !== 'hazir' && x.status !== 'teslim') {
                var y = JSON.parse(JSON.stringify(x)); y.status = 'hazir'; y.doneAt = now; y.unitsAdded = true; y.doneQty = rec.doneQty;
                y.hist = (y.hist || []).concat([{ t: now, u: 'Sistem', st: 'hazir', note: u.name + ' bitirdi' }]); st.put('tasks', y);
              }
            });
          }
        }
        if (rec) st.put(n, rec);
        return;
      }
      if (role === 'owner') {
        rec = it;
        if (n === 'stockLog' && cur) rec = null; // hareketler değişmez
        if (n === 'pos') rec.total = poTotalSrv(rec, parts);
      } else if (role === 'staff') {
        if (OWNER_ONLY.indexOf(n) >= 0) rec = null;
        else if (n === 'pos') rec = staffPO(cur, it, u, parts);
        else if (n === 'stockLog') rec = cur ? null : it;
        else if (n === 'unitLog') rec = cur ? (function () { var y = JSON.parse(JSON.stringify(cur)); return y; })() : it;
        else rec = it;
        if (rec && (n === 'units' || n === 'prepOrders' || n === 'esnaf') && cur && n !== 'units') { /* serbest */ }
      } else if (prep) {
        if (n === 'stockLog' && !cur) rec = it;
        else if (n === 'unitLog' && !cur) { rec = it; rec.by = u.name; rec.pSeen = false; }
        else if (n === 'units' && !cur) {
          rec = { id: it.id, eid: it.eid, t: it.t || now, by: u.name, ref: clip(it.ref, 80), sale: null, out: null };
          if (it.sale) { var hs = sales().byId[it.sale]; if (hs && (hs.sale.jobs || []).some(function (j) { return j.to === u.id; })) rec.sale = it.sale; }
        } else if (n === 'prepOrders' && cur) {
          rec = JSON.parse(JSON.stringify(cur)); rec.done = Math.max(0, Math.min(cur.qty, Number(it.done) || 0)); if (rec.done >= rec.qty) rec.doneAt = rec.doneAt || now;
        }
      }
      if (!rec) return;
      if (n === 'stockLog') {
        var d = Math.round(Number(rec.d) || 0);
        if (!parts[rec.pid] || !d || Math.abs(d) > 100000) return;
        rec = { id: rec.id, t: rec.t || now, pid: rec.pid, d: d, ref: clip(rec.ref, 80), by: role === 'owner' ? clip(rec.by, 40) : u.name };
        if (!stock) stock = getStock();
        stock[rec.pid] = (Number(stock[rec.pid]) || 0) + d;
      }
      if (n === 'units') { if (!engines[rec.eid]) return; unitsTouched = true; }
      st.put(n, rec);
      if (!cur && n === 'pos' && rec.status === 'onay') pushTo('owner', 'Onay bekleyen sipariş', (rec.reqBy || '') + ' · ' + (sups[rec.sup] ? sups[rec.sup].name : '') + ' · ' + (rec.lines || []).map(function (l) { return l.name + ' ' + l.qty; }).join(', '), 'stok');
      if (!cur && n === 'unitLog' && role !== 'owner') pushTo('owner', rec.by + ': ' + rec.n + ' motor hazırlandı', (engines[rec.eid] || {}).name || '', 'stok');
    });
    if (role === 'owner' && ch.dl && ch.dl.length) {
      if (!meta) meta = getMeta();
      meta.gone = meta.gone || [];
      ch.dl.forEach(function (id) { if (n === 'stockLog') return; st.del(n, id); meta.gone.push({ c: n, id: id, t: Date.now() }); });
      meta.gone = meta.gone.slice(-300);
    }
  });
  if (stock) saveStock(stock);
  if (meta) saveMeta(meta);
  if (unitsTouched) srvFill(sales(), st);
}

function poTotalSrv(po, parts) {
  var t = 0;
  (po.lines || []).forEach(function (l) { var c = parts[l.pid] ? Number(parts[l.pid].cost) || 0 : Number(l.cost) || 0; l.cost = c; t += c * (Number(l.qty) || 0); });
  return t;
}

// Dükkan: sipariş oluşturur (patron onayına düşer), gönderildi/teslim alındı işaretler; tutar göremez/değiştiremez
function staffPO(cur, it, u, parts) {
  var now = new Date().toISOString();
  if (!cur) {
    var lines = (it.lines || []).filter(function (l) { return parts[l.pid] && Number(l.qty) > 0; })
      .map(function (l) { return { pid: l.pid, name: parts[l.pid].name, qty: Math.round(Number(l.qty)), cost: Number(parts[l.pid].cost) || 0 }; });
    if (!lines.length) return null;
    var po = { id: it.id, no: clip(it.no, 20), sup: clip(it.sup, 30), date: todayTR(), t: now, by: u.name, reqBy: u.name, lines: lines, status: 'onay', pSeen: false };
    po.total = poTotalSrv(po, parts);
    return po;
  }
  var x = JSON.parse(JSON.stringify(cur));
  if (cur.status === 'gonderildi' && it.sentAt && !cur.sentAt) { x.sentAt = it.sentAt; x.sentBy = u.name; }
  if (cur.status === 'gonderildi' && it.status === 'alindi') {
    var got = {}; (it.lines || []).forEach(function (l, i) { got[i] = Math.max(0, Math.round(Number(l.got) || 0)); });
    var tot = 0; x.lines.forEach(function (l, i) { l.got = got[i] != null ? got[i] : l.qty; tot += l.got * (Number(l.cost) || 0); });
    x.status = 'alindi'; x.recvAt = now; x.recvBy = u.name; x.recvTotal = tot;
  }
  return JSON.stringify(x) === JSON.stringify(cur) ? null : x;
}

// Hazır motorlar: teslim edilenleri düş, boştakileri bekleyen satışlara ayır
function srvFill(db, st) {
  st = st || readStore();
  var units = st.list('units'), now = new Date().toISOString(), changedUnits = {}, changedSales = {};
  units.forEach(function (un) {
    if (un.out || !un.sale) return;
    var x = db.byId[un.sale];
    if (x && x.sale.status === 'teslim') { un.out = now; changedUnits[un.id] = un; }
  });
  var waiting = db.list.map(function (x) { return x.sale; }).filter(function (s) { return s.status === 'satildi' && s.cfg && s.cfg.engineId; })
    .sort(function (a, b) { return String((a.dates || {}).satildi || '').localeCompare(String((b.dates || {}).satildi || '')); });
  waiting.forEach(function (s) {
    var have = units.filter(function (un) { return un.sale === s.id; }).length, need = (Number(s.qty) || 1) - have;
    if (need <= 0) return;
    var free = units.filter(function (un) { return un.eid === s.cfg.engineId && !un.sale && !un.out; }).slice(0, need);
    if (!free.length) return;
    free.forEach(function (un) { un.sale = s.id; changedUnits[un.id] = un; });
    s.log = (s.log || []).concat([{ t: now, u: 'Sistem', a: free.length + ' hazır motor bu satışa ayrıldı' }]);
    s.resv = true; s.stockOut = true;
    if (need - free.length <= 0) (s.jobs || []).forEach(function (j) {
      if (j.kind === 'hazirlama' && j.status !== 'hazir' && j.status !== 'teslim') {
        j.status = 'hazir'; j.doneAt = now; j.hist = (j.hist || []).concat([{ t: now, u: 'Sistem', st: 'hazir', note: 'Motor hazır, bu satışa ayrıldı' }]);
      }
    });
    changedSales[s.id] = s;
  });
  for (var k in changedUnits) st.put('units', changedUnits[k]);
  for (var k2 in changedSales) { changedSales[k2].rev = Date.now(); writeSale(db, changedSales[k2]); }
}

/* ===================== Telefon bildirimleri (Firebase) ===================== */
var FCM_PROJECT = 'erenault-ddf45';

// Uygulama açılınca telefonun bildirim adresini kaydeder
function apiPushToken(a, token) {
  var u = authU(a);
  token = clip(token, 400);
  if (token.length < 20) return false;
  var k = 'PT_' + u.id, list = [];
  try { list = JSON.parse(props().getProperty(k) || '[]'); } catch (e) { }
  list = list.filter(function (t) { return t !== token; });
  list.unshift(token);
  props().setProperty(k, JSON.stringify(list.slice(0, 4)));
  return true;
}

// uids: kişi id listesi veya 'owner' / 'staff' / 'all'
function pushTo(uids, title, body, tab) {
  try {
    var users = getUsers(), ids = [];
    (Array.isArray(uids) ? uids : [uids]).forEach(function (x) {
      if (x === 'owner' || x === 'staff' || x === 'all') users.forEach(function (u) { var r = roleOf(u); if (x === 'all' || r === x || (x === 'staff' && r === 'owner')) ids.push(u.id); });
      else ids.push(x);
    });
    var seen = {}, reqs = [], who = [];
    var tok = ScriptApp.getOAuthToken();
    ids.forEach(function (id) {
      if (seen[id]) return; seen[id] = 1;
      var list = []; try { list = JSON.parse(props().getProperty('PT_' + id) || '[]'); } catch (e) { }
      list.forEach(function (t) {
        reqs.push({ url: 'https://fcm.googleapis.com/v1/projects/' + FCM_PROJECT + '/messages:send', method: 'post', contentType: 'application/json', muteHttpExceptions: true,
          headers: { Authorization: 'Bearer ' + tok, 'x-goog-user-project': FCM_PROJECT },
          payload: JSON.stringify({ message: { token: t, notification: { title: clip(title, 80), body: clip(body, 200) }, data: { tab: tab || '' },
            android: { priority: 'HIGH', notification: { channel_id: 'erenault', sound: 'default' } } } }) });
        who.push([id, t]);
      });
    });
    if (!reqs.length) return;
    var res = UrlFetchApp.fetchAll(reqs), drop = {};
    res.forEach(function (r, i) {
      var c = r.getResponseCode();
      if (c === 404 || (c === 400 && /UNREGISTERED|INVALID_ARGUMENT/.test(r.getContentText()))) (drop[who[i][0]] = drop[who[i][0]] || []).push(who[i][1]);
      else if (c >= 300) console.warn('FCM ' + c + ' ' + r.getContentText().slice(0, 300));
    });
    for (var id in drop) {
      var l = []; try { l = JSON.parse(props().getProperty('PT_' + id) || '[]'); } catch (e) { }
      props().setProperty('PT_' + id, JSON.stringify(l.filter(function (t) { return drop[id].indexOf(t) < 0; })));
    }
  } catch (e) { console.warn('bildirim: ' + e); }
}

// Bildirimleri denemek için: Apps Script'te bu işlevi seçip Çalıştır'a basın
function bildirimDene() {
  var n = 0; getUsers().forEach(function (u) { if (props().getProperty('PT_' + u.id)) n++; });
  pushTo('all', 'Erenault', 'Bildirimler çalışıyor ✓', 'bildirim');
  console.log('Bildirim kaydı olan kişi sayısı: ' + n);
}

/* ===================== Yapay zeka asistanı (sadece patron) ===================== */

// Gemini'ye yazılı soru (derin düşünme ve sabah raporu için)
function geminiText(model, system, prompt, maxTok) {
  var key = props().getProperty('GEMINI_KEY');
  if (!key) throw new Error('NOKEY');
  var body = JSON.stringify({ systemInstruction: { parts: [{ text: system }] }, contents: [{ role: 'user', parts: [{ text: prompt }] }],
    generationConfig: { maxOutputTokens: maxTok || 1500, temperature: 0.4 } });
  var res = UrlFetchApp.fetch('https://generativelanguage.googleapis.com/v1beta/models/' + model + ':generateContent', {
    method: 'post', contentType: 'application/json', muteHttpExceptions: true, headers: { 'x-goog-api-key': key }, payload: body });
  if (res.getResponseCode() >= 300) throw new Error('AIERR ' + res.getResponseCode() + ' ' + res.getContentText().slice(0, 200));
  var j = JSON.parse(res.getContentText()), c = (j.candidates || [])[0];
  return ((c && c.content && c.content.parts) || []).map(function (p) { return p.text || ''; }).join('').trim();
}

function geminiTry(models, system, prompt, maxTok) {
  var last = null;
  for (var i = 0; i < models.length; i++) { try { var t = geminiText(models[i], system, prompt, maxTok); if (t) return t; } catch (e) { last = e; if (/NOKEY/.test(String(e))) throw e; } }
  throw last || new Error('AIERR boş cevap');
}

var DANISMAN = 'Sen Eren Oto (Erenault Motors; Renault ticari araç motoru revizyonu yapıp satan atölye) için deneyimli bir işletme danışmanısın. ' +
  'Güncel verilere bakarak patrona somut, uygulanabilir öneriler ver. Rakamları ve isimleri sadece veriden al, asla uydurma; veri yoksa söyle. ' +
  'Türkçe, sade, konuşur gibi yaz; madde işareti ve başlık kullanma. En fazla 8 cümle.';

function apiAiThink(a, q, data, mem) {
  var u = authU(a);
  if (roleOf(u) !== 'owner') throw new Error('NOTFOUND');
  var c = CacheService.getScriptCache(), n = Number(c.get('aithink') || 0);
  if (n > 40) throw new Error('BUSY');
  c.put('aithink', String(n + 1), 3600);
  var m1 = props().getProperty('GEMINI_DEEP_MODEL') || 'gemini-pro-latest';
  return geminiTry([m1, 'gemini-flash-latest', 'gemini-3.5-flash-lite', 'gemini-3.1-flash-lite'], DANISMAN,
    'Patronun notları: ' + clip((mem || []).join(' | '), 3000) + '\nBugün: ' + todayTR() + '\nSORU: ' + clip(q, 1000) + '\nVERİ (JSON): ' + clip(typeof data === 'string' ? data : JSON.stringify(data), 60000), 1500);
}

// Sunucunun kendi gözünden kısa durum özeti (rapor için)
function durumOzeti() {
  var C = getCatalog() || { engines: [], parts: [] }, db = readSales(), st = readStore(), t = todayTR(), stock = getStock(), names = {};
  getUsers().forEach(function (x) { names[x.id] = x.name; });
  var jobs = [];
  db.list.forEach(function (x) { var s = x.sale; (s.jobs || []).forEach(function (j) { jobs.push({ is: JOBK[j.kind] || j.kind, kisi: names[j.to] || '', musteri: (s.customer || {}).name || '', durum: JOBS_ST[j.status] || j.status, termin: j.due || '', bitti: j.status === 'hazir' || j.status === 'teslim' }); }); });
  st.list('tasks').forEach(function (j) { jobs.push({ is: j.title || '', kisi: names[j.to] || '', durum: JOBS_ST[j.status] || j.status, termin: j.due || '', bitti: j.status === 'hazir' || j.status === 'teslim' }); });
  var open = jobs.filter(function (j) { return !j.bitti; });
  var low = (C.parts || []).filter(function (p) { return (Number(stock[p.id]) || 0) <= (Number(p.min) || 0); }).map(function (p) { return p.name + ' ' + (Number(stock[p.id]) || 0) + '/' + (p.min || 0); });
  var use = {}, from = Utilities.formatDate(new Date(Date.now() - 30 * 864e5), TZ, 'yyyy-MM-dd');
  st.list('stockLog').forEach(function (m) { if (m.d < 0 && String(m.t).slice(0, 10) >= from) use[m.pid] = (use[m.pid] || 0) - m.d; });
  var yeter = (C.parts || []).filter(function (p) { return use[p.id]; }).map(function (p) { return { parca: p.name, adet: Number(stock[p.id]) || 0, gun: Math.floor((Number(stock[p.id]) || 0) / (use[p.id] / 30)) }; })
    .filter(function (x) { return x.gun <= 10; });
  var units = st.list('units').filter(function (x) { return !x.out; }), eng = {};
  (C.engines || []).forEach(function (e) { eng[e.id] = e.name; });
  var hazir = {}; units.forEach(function (x) { var k = eng[x.eid] || x.eid; hazir[k] = hazir[k] || { dukkanda: 0, bosta: 0 }; hazir[k].dukkanda++; if (!x.sale) hazir[k].bosta++; });
  var bekleyen = db.list.map(function (x) { return x.sale; }).filter(function (s) { return s.status === 'satildi'; }).map(function (s) {
    var have = units.filter(function (x) { return x.sale === s.id; }).length; return { musteri: s.customer.name, motor: s.engine, eksik: Math.max(0, (s.qty || 1) - have) }; }).filter(function (x) { return x.eksik; });
  var alacak = db.list.map(function (x) { return x.sale; }).filter(function (s) { return s.status === 'satildi' || s.status === 'teslim'; }).map(function (s) {
    var paid = (s.pays || []).reduce(function (a2, p) { return a2 + (Number(p.amt) || 0); }, 0); return { musteri: s.customer.name, kalan: (s.total || 0) - paid }; }).filter(function (x) { return x.kalan > 0; });
  var pos = st.list('pos');
  return {
    tarih: t, acik_is: open.length, geciken_is: open.filter(function (j) { return j.termin && j.termin < t; }), bugun_termin: open.filter(function (j) { return j.termin === t; }),
    yeni_teklif: db.list.filter(function (x) { return x.sale.status === 'geldi'; }).length,
    azalan_parca: low, yakinda_biten_parca: yeter, hazir_motor: hazir, motor_bekleyen_satis: bekleyen,
    alacaklar: alacak.slice(0, 15), onay_bekleyen_siparis: pos.filter(function (p) { return p.status === 'onay'; }).length,
    gonderilmemis_siparis: pos.filter(function (p) { return p.status === 'gonderildi' && !p.sentAt; }).length,
    hatirlatmalar_bugun: st.list('reminders').filter(function (r) { return !r.done && String(r.at).slice(0, 10) === t; }).map(function (r) { return r.text; }),
    notlar: st.list('aiMem').map(function (m) { return m.text; })
  };
}

// Her sabah (zamanlayıcı ile) çalışır
function sabahRaporu() {
  var d = durumOzeti();
  var txt;
  try { txt = geminiTry([props().getProperty('GEMINI_REPORT_MODEL') || 'gemini-flash-latest', 'gemini-3.5-flash-lite', 'gemini-3.1-flash-lite'],
    DANISMAN + ' Bu bir sabah raporu: "Günaydın" ile başla, bugünün tablosunu 2-3 cümlede özetle, sonra en önemli 2-3 somut öneriyi ver (kime ne yaptırılmalı, ne sipariş edilmeli, kim aranmalı).',
    'VERİ (JSON): ' + JSON.stringify(d).slice(0, 50000), 900); }
  catch (e) {
    console.warn('Sabah raporu yazılamadı: ' + e);
    var parts = ['Günaydın.', d.acik_is + ' açık iş var' + (d.geciken_is.length ? ', ' + d.geciken_is.length + ' tanesi gecikmiş' : '') + '.'];
    if (d.azalan_parca.length) parts.push('Azalan parçalar: ' + d.azalan_parca.slice(0, 5).join(', ') + '.');
    if (d.onay_bekleyen_siparis) parts.push(d.onay_bekleyen_siparis + ' sipariş onayınızı bekliyor.');
    if (d.yeni_teklif) parts.push(d.yeni_teklif + ' yeni teklif var.');
    parts.push('(Yapay zeka kotası dolduğu için kısa rapor.)');
    txt = parts.join(' ');
  }
  var meta = getMeta(); meta.report = { t: new Date().toISOString(), text: txt }; saveMeta(meta);
  pushTo('owner', '☀️ Günaydın · Erenault', txt.replace(/^Günaydın[.,!]?\s*/i, '').slice(0, 180), 'asistan');
  return txt;
}

// 5 dakikada bir (zamanlayıcı ile) çalışır
function hatirlatmaKontrol() {
  var st = readStore(), now = Date.now();
  st.list('reminders').forEach(function (r) {
    if (r.done || !r.at || new Date(r.at).getTime() > now) return;
    var y = JSON.parse(JSON.stringify(r)); y.done = true; y.sentAt = new Date().toISOString(); st.put('reminders', y);
    pushTo('owner', '⏰ Hatırlatma', r.text, 'asistan');
  });
}

// BİR KEZ çalıştırın: sabah raporu (08:30) ve hatırlatma (5 dk) zamanlayıcılarını kurar
function kurulumZamanlayicilar() {
  ScriptApp.getProjectTriggers().forEach(function (t) { if (['sabahRaporu', 'hatirlatmaKontrol'].indexOf(t.getHandlerFunction()) >= 0) ScriptApp.deleteTrigger(t); });
  ScriptApp.newTrigger('sabahRaporu').timeBased().atHour(8).nearMinute(30).everyDays(1).inTimezone(TZ).create();
  ScriptApp.newTrigger('hatirlatmaKontrol').timeBased().everyMinutes(5).create();
  console.log('Zamanlayıcılar kuruldu. Sabah raporunu şimdi denemek için sabahRaporu işlevini çalıştırabilirsiniz.');
}

// API anahtarı Script Properties'te GEMINI_KEY adıyla durur; telefona asla gitmez.
// Telefon buradan birkaç dakikalık tek kullanımlık bir geçiş anahtarı alır.
function apiAiToken(a) {
  var u = authU(a);
  if (roleOf(u) !== 'owner') throw new Error('NOTFOUND');
  var key = props().getProperty('GEMINI_KEY');
  if (!key) throw new Error('NOKEY');
  var c = CacheService.getScriptCache(), n = Number(c.get('aitok') || 0);
  if (n > 60) throw new Error('BUSY');
  c.put('aitok', String(n + 1), 3600);
  var exp = new Date(Date.now() + 30 * 60000).toISOString(), start = new Date(Date.now() + 2 * 60000).toISOString();
  var paid = props().getProperty('GEMINI_PAID') === '1';
  var model = props().getProperty('GEMINI_MODEL') || (paid ? 'gemini-3.8-live' : 'gemini-3.1-flash-live-preview');
  var res = UrlFetchApp.fetch('https://generativelanguage.googleapis.com/v1beta/auth_tokens', {
    method: 'post', contentType: 'application/json', muteHttpExceptions: true,
    headers: { 'x-goog-api-key': key },
    payload: JSON.stringify({ uses: 1, expireTime: exp, newSessionExpireTime: start })
  });
  if (res.getResponseCode() >= 300) throw new Error('AIERR ' + res.getResponseCode() + ' ' + res.getContentText().slice(0, 200));
  var j = JSON.parse(res.getContentText());
  return { token: j.name, model: model, demo: !paid };
}

/* ===================== Depolama ===================== */

function props() { return PropertiesService.getScriptProperties(); }

function ss() {
  var id = props().getProperty('SHEET_ID');
  if (id) { try { return SpreadsheetApp.openById(id); } catch (e) { } }
  var s = SpreadsheetApp.create('Eren Oto Motor Kayıtları');  // Erenault
  props().setProperty('SHEET_ID', s.getId());
  var sh = s.getSheets()[0];
  sh.setName('Satışlar');
  sh.getRange(1, 1, 1, COLS.length).setValues([COLS]).setFontWeight('bold');
  sh.setFrozenRows(1);
  s.insertSheet('Fiyatlar');
  var sys = s.insertSheet('Sistem');
  sys.getRange(1, 1, 1, 2).setValues([['katalog', '']]);
  sys.getRange(5, 1).setValue('Bu sayfayı değiştirmeyin; uygulama kullanır.');
  try { moveToFolder(s.getId()); } catch (e) { }
  return s;
}

function folder() {
  var id = props().getProperty('FOLDER_ID');
  if (id) { try { return DriveApp.getFolderById(id); } catch (e) { } }
  var f = DriveApp.createFolder('Eren Oto Sözleşmeler');
  props().setProperty('FOLDER_ID', f.getId());
  return f;
}

function mediaFolder() {
  var id = props().getProperty('MEDIA_ID');
  if (id) { try { return DriveApp.getFolderById(id); } catch (e) { } }
  var f = DriveApp.createFolder('Eren Oto Dosyalar');
  props().setProperty('MEDIA_ID', f.getId());
  return f;
}

function moveToFolder(fileId) { DriveApp.getFileById(fileId).moveTo(folder()); }

function sheetNamed(name) {
  var s = ss(), sh = s.getSheetByName(name);
  if (!sh) {
    sh = s.insertSheet(name);
    if (name === 'Satışlar') { sh.getRange(1, 1, 1, COLS.length).setValues([COLS]).setFontWeight('bold'); sh.setFrozenRows(1); }
    if (name === 'Mesajlar') { sh.getRange(1, 1, 1, MCOLS.length).setValues([MCOLS]).setFontWeight('bold'); sh.setFrozenRows(1); }
    if (name === 'Kayıtlar') { sh.getRange(1, 1, 1, KCOLS.length).setValues([KCOLS]).setFontWeight('bold'); sh.setFrozenRows(1); }
  }
  return sh;
}

function getCatalog() {
  var v = sheetNamed('Sistem').getRange(1, 2).getValue();
  if (!v) return null;
  try {
    var c = JSON.parse(v);
    // eski sürümün (Uygun/Normal/Kaliteli) fiyat listesi yeni sistemde kullanılmaz
    if (!c.engines || !c.engines.length || !c.engines[0].recipe) return null;
    return c;
  } catch (e) { return null; }
}

function saveCatalog(c) {
  if (!c || !c.engines || !c.engines.length || !c.parts || !c.settings) throw new Error('BADCAT');
  var cat = { engines: c.engines, parts: (c.parts || []).map(function (p) { return { id: p.id, name: p.name, cost: Number(p.cost) || 0, sup: p.sup || '', min: Number(p.min) || 0 }; }),
    suppliers: c.suppliers || [], labor: c.labor || { c: 0 }, settings: c.settings };
  var j = JSON.stringify(cat);
  if (j.length > 48000) throw new Error('TOOBIG');
  sheetNamed('Sistem').getRange(1, 2).setValue(j);
  _catCache = cat;
  try { writePriceSheet(cat); } catch (e) { }
}

function getMeta() {
  var v = sheetNamed('Sistem').getRange(3, 2).getValue();
  if (!v) return { pings: [], pinned: null };
  try { return JSON.parse(v); } catch (e) { return { pings: [], pinned: null }; }
}

function saveMeta(m) {
  var sh = sheetNamed('Sistem');
  sh.getRange(3, 1).setValue('sistem');
  sh.getRange(3, 2).setValue(JSON.stringify(m));
}

function writePriceSheet(C) {
  var sh = sheetNamed('Fiyatlar');
  sh.clear();
  var parts = {};
  (C.parts || []).forEach(function (p) { parts[p.id] = p; });
  var rows = [['Bu sayfa bilgi içindir. Motorları ve fiyatları uygulamanın "Motorlar ve fiyatlar" sekmesinden değiştirin.', '', '', ''],
    ['', '', '', ''], ['Motor', 'Kod', 'Satış fiyatı (₺)', 'Paket içeriği']];
  C.engines.forEach(function (e) {
    rows.push([e.name, e.code || '', Number(e.price) || 0, (e.recipe || []).map(function (r) { return ((parts[r.pid] || {}).name || '?') + ' ×' + r.qty; }).join(', ')]);
  });
  rows.push(['', '', '', '']);
  rows.push(['Depozito (eski motor sonra getirilirse)', '', Number((C.settings || {}).depozito) || 0, '']);
  sh.getRange(1, 1, rows.length, 4).setValues(rows);
  sh.getRange(3, 1, 1, 4).setFontWeight('bold');
}

function readSales() {
  var sh = sheetNamed('Satışlar'), n = sh.getLastRow(), list = [], byId = {};
  if (n >= 2) {
    var v = sh.getRange(2, 1, n - 1, COLS.length).getValues();
    for (var i = 0; i < v.length; i++) {
      var raw = v[i][COLS.length - 1];
      if (!raw) continue;
      try { var s = JSON.parse(raw), x = { row: i + 2, sale: s }; list.push(x); byId[s.id] = x; } catch (e) { }
    }
  }
  return { sh: sh, list: list, byId: byId };
}

function findByToken(t) {
  var db = readSales();
  for (var i = 0; i < db.list.length; i++) if (db.list[i].sale.token === t) return db.list[i];
  return null;
}

function writeSale(db, s) {
  var j = JSON.stringify(s);
  if (j.length > 49000) {
    // çok uzun geçmişi kısalt
    if (s.log && s.log.length > 60) { s.log = s.log.slice(-60); j = JSON.stringify(s); }
    if (j.length > 49000) throw new Error('TOOBIG');
  }
  var c = s.customer || {}, d = s.dates || {};
  var row = ["'" + (s.no || ''), STATUS[s.status] || s.status, c.name || '', "'" + (c.phone || ''), c.plate || '',
    s.engine || '', s.pkg || '', s.total || '', s.cost || '', s.lines ? (s.total - (s.cost || 0)) : '',
    d.gonderildi || '', d.geldi || '', d.satildi || '', d.teslim || '', s.pdfUrl || '', s.note || '', s.id, j];
  var hit = db.byId[s.id];
  if (hit) { db.sh.getRange(hit.row, 1, 1, COLS.length).setValues([row]); hit.sale = s; }
  else {
    var r = db.sh.getLastRow() + 1;
    db.sh.getRange(r, 1, 1, COLS.length).setValues([row]);
    var x = { row: r, sale: s }; db.list.push(x); db.byId[s.id] = x;
  }
}

function savePdfFile(s, b64) {
  if (!b64 || b64.length > 15000000) throw new Error('BADPDF');
  var nm = s.no + ' - ' + ((s.customer && s.customer.name) || 'Müşteri') + ' - sözleşme.pdf';
  var f = folder().createFile(Utilities.newBlob(Utilities.base64Decode(b64), 'application/pdf', nm));
  try { f.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW); } catch (e) { }
  s.pdfId = f.getId();
  s.pdfUrl = f.getUrl();
}

/* ===================== Yardımcılar ===================== */

function hash(p) {
  var salt = props().getProperty('SALT');
  if (!salt) { salt = Utilities.getUuid(); props().setProperty('SALT', salt); }
  var d = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, salt + '|' + p, Utilities.Charset.UTF_8);
  return Utilities.base64Encode(d);
}

function publicCatalog(C) {
  if (!C) return null;
  var st = JSON.parse(JSON.stringify(C.settings || {}));
  ['rules', 'vekil', 'jobTrigger', 'places', 'orderQty'].forEach(function (k) { delete st[k]; });
  return {
    engines: C.engines.map(function (e) { return { id: e.id, name: e.name, code: e.code, price: e.price, desc: e.desc || '', photos: e.photos || [], recipe: e.recipe || [] }; }),
    parts: (C.parts || []).map(function (p) { return { id: p.id, name: p.name }; }),
    suppliers: [], labor: { c: 0 }, settings: st
  };
}

// ekip içi katalog: maliyetsiz (dükkan ve çalışanlar)
function teamCatalog(C) {
  if (!C) return null;
  var c = JSON.parse(JSON.stringify(C));
  c.parts.forEach(function (p) { p.cost = 0; });
  c.engines.forEach(function (e) { e.laborC = 0; });
  c.suppliers = (c.suppliers || []).map(function (t) { return { id: t.id, name: t.name, phone: t.phone || '' }; });
  return c;
}

// müşteri sayfası motor resimleri (sadece katalogdaki resimler)
function apiPubFile(ref) {
  var C = getCatalog(), ok = false;
  (C ? C.engines : []).forEach(function (e) { (e.photos || []).forEach(function (p) { if (p === ref) ok = true; }); });
  if (!ok || !isRef(ref)) throw new Error('NOTFOUND');
  var c = CacheService.getScriptCache(), hit = c.get('pf_' + ref);
  if (hit) return hit;
  var b = DriveApp.getFileById(String(ref).replace(/^drv:/, '')).getBlob();
  var d = 'data:' + (b.getContentType() || 'image/jpeg') + ';base64,' + Utilities.base64Encode(b.getBytes());
  if (d.length < 95000) c.put('pf_' + ref, d, 21600);
  return d;
}

function publicSale(s) {
  var b = s.signedSnap || s;
  return {
    id: 'c', token: s.token, no: s.no, status: s.status,
    customer: { name: (b.customer || s.customer || {}).name || '', phone: '', plate: (b.customer || s.customer || {}).plate || '' },
    engine: b.engine, pkg: b.pkg, lines: (b.lines || []).map(function (l) { return { id: l.id, name: l.name, b: l.b, t: l.t, p: l.p, kind: l.kind }; }),
    laborP: b.laborP, disc: b.disc, total: b.total, ek: b.ek || 0, listTotal: b.listTotal || null,
    terms: (b.terms && b.terms.length) ? b.terms : null,
    plan: (b.plan || []).map(function (p) { return { id: p.id, label: p.label, amt: p.amt, due: p.due }; }),
    orig: b.orig || null,
    dates: { geldi: (b.dates || s.dates || {}).geldi || '', gonderildi: (b.dates || s.dates || {}).gonderildi || '' },
    sign: s.sign ? { name: s.sign.name, at: s.sign.at } : null,
    pdfUrl: s.sign ? (s.pdfUrl || null) : null,
    kvkk: s.kvkk ? { at: s.kvkk.at, how: s.kvkk.how } : null
  };
}

function nextNo(db) {
  var m = 100;
  db.list.forEach(function (x) { var n = Number(String(x.sale.no || '').replace(/\D/g, '')) || 0; if (n > m) m = n; });
  return 'EO-' + (m + 1);
}

function dupNo(db, s) {
  for (var i = 0; i < db.list.length; i++) {
    var o = db.list[i].sale;
    if (o.id !== s.id && o.no === s.no) return true;
  }
  return false;
}

function genTerms() {
  var C = getCatalog();
  return String((C && C.settings && C.settings.terms) || '').split('\n').map(function (t) { return t.trim(); }).filter(String);
}

function newToken() { return Utilities.getUuid().replace(/-/g, '').slice(0, 20); }
function todayTR() { return Utilities.formatDate(new Date(), TZ, 'yyyy-MM-dd'); }
function clip(v, n) { return String(v == null ? '' : v).trim().slice(0, n); }
function digits(v) { return String(v || '').replace(/\D/g, ''); }
function waKey(p) { var d = digits(p); if (d.charAt(0) === '0') d = '9' + d; if (d.length === 10 && d.charAt(0) === '5') d = '90' + d; return d; }
function money(n) { return String(Math.round(n || 0)).replace(/\B(?=(\d{3})+(?!\d))/g, '.') + ' ₺'; }
function ownerEmail() { try { return Session.getEffectiveUser().getEmail(); } catch (e) { return ''; } }

function notify(subject, body) {
  try {
    var C = getCatalog();
    if (C && C.settings && C.settings.mail === false) return;
    var to = ownerEmail();
    if (!to) return;
    MailApp.sendEmail(to, 'Eren Oto · ' + subject, body + '\n\nEkip uygulaması: ' + ScriptApp.getService().getUrl() + '?p=panel');
  } catch (e) { }
}
