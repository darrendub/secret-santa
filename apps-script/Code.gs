/*
 * Secret Santa API (Google Apps Script web app)
 *
 * The site calls this with GET requests only, so every response is readable
 * from the browser. All data lives in the linked Google Sheet. This file
 * contains no names, phone numbers, or tokens.
 *
 * Access model:
 *   - Each person has a private random token (People.token). The token is their login.
 *   - The admin has one secret (Config.admin_token).
 *   - A person only ever receives their own ideas and their own giftee's ideas.
 *   - Nothing returned to a person says who their Santa is.
 */

var TABS = {
  Groups: ['group_id', 'name', 'year', 'budget', 'deadline', 'max_ideas', 'status', 'drawn_at'],
  People: ['person_id', 'group_id', 'name', 'full_name', 'phone', 'email', 'household', 'token', 'opened_at', 'active', 'avatar', 'location', 'weakness'],
  Exclusions: ['group_id', 'person_a', 'person_b'],
  Ideas: ['idea_id', 'person_id', 'url', 'title', 'price', 'notes', 'kind', 'store', 'image', 'created_at', 'updated_at'],
  Draw: ['group_id', 'santa_id', 'giftee_id', 'bought_at'],
  Config: ['key', 'value']
};
var TOKEN_CHARS = '23456789abcdefghjkmnpqrstuvwxyz';
var UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1';

/* ------------------------------------------------------------------ entry */

function doGet(e) {
  var p = (e && e.parameter) || {};
  var res;
  try {
    switch (p.action) {
      case 'ping': res = { ok: true }; break;
      case 'me': res = me_(p); break;
      case 'saveIdea': res = saveIdea_(p); break;
      case 'deleteIdea': res = deleteIdea_(p); break;
      case 'markBought': res = markBought_(p); break;
      case 'preview': res = preview_(p); break;
      case 'admin': res = admin_(p); break;
      case 'runDraw': res = runDraw_(p); break;
      case 'clearDraw': res = clearDraw_(p); break;
      case 'newLink': res = newLink_(p); break;
      case 'setStatus': res = setStatus_(p); break;
      default: res = { error: 'unknown_action' };
    }
  } catch (err) {
    console.error(err && err.stack ? err.stack : String(err));
    res = { error: 'server' };
  }
  return ContentService.createTextOutput(JSON.stringify(res)).setMimeType(ContentService.MimeType.JSON);
}

/* ---------------------------------------------------------- sheet helpers */

function ss_() {
  var id = PropertiesService.getScriptProperties().getProperty('SHEET_ID');
  return id ? SpreadsheetApp.openById(id) : SpreadsheetApp.getActiveSpreadsheet();
}

function tab_(name) {
  var s = ss_().getSheetByName(name);
  if (!s) throw new Error('Missing tab ' + name);
  return s;
}

function headers_(name) {
  var sh = tab_(name);
  return sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0];
}

function all_(name) {
  var v = tab_(name).getDataRange().getDisplayValues();
  var out = [];
  if (v.length < 2) return out;
  var h = v[0];
  for (var i = 1; i < v.length; i++) {
    if (v[i].join('') === '') continue;
    var o = { _row: i + 1 };
    for (var j = 0; j < h.length; j++) o[h[j]] = v[i][j];
    out.push(o);
  }
  return out;
}

// Always write as text so Sheets never turns dates or numbers into other types.
function writeRow_(name, obj, row) {
  var sh = tab_(name), h = headers_(name);
  var vals = h.map(function (k) { return obj[k] === undefined || obj[k] === null ? '' : String(obj[k]); });
  var r = row || sh.getLastRow() + 1;
  var rng = sh.getRange(r, 1, 1, h.length);
  rng.setNumberFormat('@');
  rng.setValues([vals]);
  return r;
}

function set_(name, row, key, val) {
  var idx = headers_(name).indexOf(key) + 1;
  var cell = tab_(name).getRange(row, idx);
  cell.setNumberFormat('@');
  cell.setValue(String(val));
}

function lock_(fn) {
  var l = LockService.getScriptLock();
  l.waitLock(15000);
  try { return fn(); } finally { l.releaseLock(); }
}

function config_() {
  var o = {};
  all_('Config').forEach(function (r) { o[r.key] = r.value; });
  return o;
}

function normDay_(s) {
  s = String(s || '').trim();
  var m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (m) return m[1] + '-' + ('0' + m[2]).slice(-2) + '-' + ('0' + m[3]).slice(-2);
  m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/);
  if (m) return m[3] + '-' + ('0' + m[1]).slice(-2) + '-' + ('0' + m[2]).slice(-2);
  return s;
}

function clean_(s, max) {
  return String(s === undefined || s === null ? '' : s).replace(/[\u0000-\u001f]/g, ' ').trim().slice(0, max);
}

function now_() { return new Date().toISOString(); }

function newToken_(taken) {
  for (var tries = 0; tries < 50; tries++) {
    var bytes = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, Utilities.getUuid() + Math.random() + Date.now());
    var t = '';
    for (var i = 0; i < 8; i++) t += TOKEN_CHARS.charAt(((bytes[i] % 256) + 256) % 256 % TOKEN_CHARS.length);
    if (!taken[t]) { taken[t] = 1; return t; }
  }
  throw new Error('Could not make a unique token');
}

/* ---------------------------------------------------------------- lookups */

function personByToken_(k) {
  k = clean_(k, 64);
  if (k.length < 6) return null;
  var ps = all_('People');
  for (var i = 0; i < ps.length; i++) {
    if (ps[i].token === k && ps[i].active.toUpperCase() !== 'FALSE') return ps[i];
  }
  return null;
}

function personById_(id) {
  var ps = all_('People');
  for (var i = 0; i < ps.length; i++) if (ps[i].person_id === id) return ps[i];
  return null;
}

function group_(id) {
  var gs = all_('Groups');
  for (var i = 0; i < gs.length; i++) if (gs[i].group_id === id) return gs[i];
  return null;
}

function groupPub_(g) {
  return {
    id: g.group_id,
    name: g.name,
    year: g.year,
    budget: Number(g.budget) || 150,
    deadline: normDay_(g.deadline),
    maxIdeas: Number(g.max_ideas) || 3,
    status: g.status || 'open',
    drawn: !!g.drawn_at
  };
}

function pubIdea_(r) {
  return {
    id: r.idea_id,
    url: r.url,
    title: r.title,
    price: r.price === '' ? null : Number(r.price),
    notes: r.notes,
    kind: r.kind || 'gift',
    store: r.store,
    image: r.image
  };
}

function ideasOf_(personId) {
  return all_('Ideas').filter(function (r) { return r.person_id === personId; }).map(pubIdea_);
}

function drawRowFor_(person) {
  var rows = all_('Draw');
  for (var i = 0; i < rows.length; i++) {
    if (rows[i].group_id === person.group_id && rows[i].santa_id === person.person_id) return rows[i];
  }
  return null;
}

/* ------------------------------------------------------------ person API */

function me_(p) {
  var me = personByToken_(p.k);
  if (!me) return { error: 'not_found' };
  if (!me.opened_at) lock_(function () { set_('People', me._row, 'opened_at', now_()); });
  var g = group_(me.group_id);
  var d = drawRowFor_(me);
  var giftee = null;
  if (d) {
    var gp = personById_(d.giftee_id);
    if (gp) giftee = {
      name: gp.name, ideas: ideasOf_(gp.person_id),
      avatar: String(gp.avatar || '').toLowerCase(), location: String(gp.location || ''), weakness: String(gp.weakness || '')
    };
  }
  return {
    ok: true,
    person: { name: me.name },
    group: g ? groupPub_(g) : null,
    ideas: ideasOf_(me.person_id),
    giftee: giftee,
    bought: !!(d && d.bought_at)
  };
}

function saveIdea_(p) {
  var me = personByToken_(p.k);
  if (!me) return { error: 'not_found' };
  var g = group_(me.group_id);
  if (!g) return { error: 'no_group' };
  if ((g.status || 'open') === 'locked') return { error: 'locked' };

  var d = {};
  try { d = JSON.parse(p.data || '{}'); } catch (e) { return { error: 'bad_data' }; }

  var url = clean_(d.url, 1000);
  if (url && !/^https?:\/\//i.test(url)) return { error: 'bad_url' };
  var title = clean_(d.title, 200);
  if (!title && !url) return { error: 'need_title' };
  var price = parseFloat(String(d.price === undefined ? '' : d.price).replace(/[^0-9.]/g, ''));
  var kind = d.kind === 'giftcard' ? 'giftcard' : 'gift';
  var budget = Number(g.budget) || 150;

  return lock_(function () {
    var ideas = all_('Ideas');
    var mine = ideas.filter(function (r) { return r.person_id === me.person_id; });
    var existing = null;
    if (d.id) {
      for (var i = 0; i < mine.length; i++) if (mine[i].idea_id === d.id) existing = mine[i];
      if (!existing) return { error: 'not_found' };
    } else if (mine.length >= (Number(g.max_ideas) || 3)) {
      return { error: 'max_ideas' };
    }
    var rec = existing || { idea_id: 'i' + Utilities.getUuid().slice(0, 8), person_id: me.person_id, created_at: now_() };
    rec.url = url;
    rec.title = title || storeFromUrl_(url);
    rec.price = isNaN(price) ? '' : price;
    rec.notes = clean_(d.notes, 500);
    rec.kind = kind;
    rec.store = clean_(d.store, 80) || storeFromUrl_(url);
    rec.image = /^https:\/\//i.test(d.image || '') ? clean_(d.image, 1000) : '';
    rec.updated_at = now_();
    writeRow_('Ideas', rec, existing ? existing._row : null);
    return { ok: true, idea: pubIdea_(rec), overBudget: !isNaN(price) && price > budget };
  });
}

function deleteIdea_(p) {
  var me = personByToken_(p.k);
  if (!me) return { error: 'not_found' };
  var g = group_(me.group_id);
  if (g && (g.status || 'open') === 'locked') return { error: 'locked' };
  return lock_(function () {
    var ideas = all_('Ideas');
    for (var i = 0; i < ideas.length; i++) {
      if (ideas[i].idea_id === p.id && ideas[i].person_id === me.person_id) {
        tab_('Ideas').deleteRow(ideas[i]._row);
        return { ok: true };
      }
    }
    return { error: 'not_found' };
  });
}

function markBought_(p) {
  var me = personByToken_(p.k);
  if (!me) return { error: 'not_found' };
  return lock_(function () {
    var d = drawRowFor_(me);
    if (!d) return { error: 'no_draw' };
    set_('Draw', d._row, 'bought_at', p.value === 'true' ? now_() : '');
    return { ok: true, bought: p.value === 'true' };
  });
}

/* ------------------------------------------------------------ link preview */

function isPublicHost_(host) {
  if (!host || host.indexOf('.') < 0) return false;
  if (/^(localhost|.*\.local|.*\.internal)$/i.test(host)) return false;
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(host)) return false;
  if (host.indexOf(':') >= 0 || host.indexOf('[') >= 0) return false;
  return true;
}

function hostOf_(url) {
  var m = String(url || '').match(/^https?:\/\/([^\/?#:@]+)/i);
  return m ? m[1].toLowerCase() : '';
}

function storeFromUrl_(url) {
  var host = hostOf_(url).replace(/^(www|m|shop|store|us)\./, '');
  if (!host) return '';
  var parts = host.split('.');
  var name = parts.length >= 2 ? parts[parts.length - 2] : parts[0];
  if (parts.length >= 3 && name.length <= 3 && /^(co|com|org|net)$/.test(name)) name = parts[parts.length - 3];
  return name.charAt(0).toUpperCase() + name.slice(1);
}

function unescapeHtml_(s) {
  return String(s || '')
    .replace(/&#x([0-9a-f]+);/gi, function (m, h) { return String.fromCharCode(parseInt(h, 16)); })
    .replace(/&#(\d+);/g, function (m, d) { return String.fromCharCode(parseInt(d, 10)); })
    .replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&')
    .trim();
}

function metaVal_(html, key) {
  var k = key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  var a = new RegExp('<meta[^>]+(?:property|name)=["\']' + k + '["\'][^>]*content=["\']([^"\']*)["\']', 'i').exec(html);
  if (a) return unescapeHtml_(a[1]);
  var b = new RegExp('<meta[^>]+content=["\']([^"\']*)["\'][^>]*(?:property|name)=["\']' + k + '["\']', 'i').exec(html);
  return b ? unescapeHtml_(b[1]) : '';
}

function parsePage_(html) {
  html = String(html || '').slice(0, 400000);
  var title = metaVal_(html, 'og:title') || metaVal_(html, 'twitter:title');
  if (!title) {
    var t = /<title[^>]*>([^<]*)<\/title>/i.exec(html);
    title = t ? unescapeHtml_(t[1]) : '';
  }
  var image = metaVal_(html, 'og:image') || metaVal_(html, 'twitter:image');
  if (image.indexOf('//') === 0) image = 'https:' + image;
  if (!/^https:\/\//i.test(image)) image = '';
  var price = metaVal_(html, 'product:price:amount') || metaVal_(html, 'og:price:amount');
  if (!price) {
    var m = /"price"\s*:\s*"?([0-9][0-9.,]*)/i.exec(html);
    if (m) price = m[1];
  }
  var n = parseFloat(String(price).replace(/,/g, ''));
  return {
    title: title.slice(0, 200),
    image: image.slice(0, 1000),
    price: isNaN(n) ? null : n,
    siteName: metaVal_(html, 'og:site_name').slice(0, 80)
  };
}

// Follow redirects by hand so short links (a.co, amzn.to) resolve to the real store.
function resolve_(url) {
  var cur = url;
  for (var hop = 0; hop < 5; hop++) {
    if (!isPublicHost_(hostOf_(cur))) return null;
    var r = UrlFetchApp.fetch(cur, {
      muteHttpExceptions: true,
      followRedirects: false,
      headers: { 'User-Agent': UA, 'Accept-Language': 'en-US,en;q=0.9' }
    });
    var code = r.getResponseCode();
    if (code >= 300 && code < 400) {
      var loc = r.getHeaders()['Location'] || r.getHeaders()['location'];
      if (!loc) return { url: cur, code: code, body: '' };
      if (/^\//.test(loc)) loc = cur.match(/^https?:\/\/[^\/]+/i)[0] + loc;
      cur = loc;
      continue;
    }
    return { url: cur, code: code, body: code < 400 ? r.getContentText() : '' };
  }
  return { url: cur, code: 0, body: '' };
}

function preview_(p) {
  var okUser = personByToken_(p.k) || adminOk_(p);
  if (!okUser) return { error: 'not_found' };
  var url = clean_(p.url, 1000);
  if (!/^https?:\/\//i.test(url)) return { error: 'bad_url' };
  if (!isPublicHost_(hostOf_(url))) return { error: 'bad_url' };

  var cache = CacheService.getScriptCache();
  var ck = 'pv' + Utilities.base64EncodeWebSafe(Utilities.computeDigest(Utilities.DigestAlgorithm.MD5, url));
  var hit = cache.get(ck);
  if (hit) return JSON.parse(hit);

  var out = { ok: true, found: false, store: storeFromUrl_(url), title: '', image: '', price: null, finalUrl: url };
  try {
    var r = resolve_(url);
    if (r) {
      out.finalUrl = r.url;
      out.store = storeFromUrl_(r.url);
      if (r.body) {
        var pg = parsePage_(r.body);
        out.title = pg.title;
        out.image = pg.image;
        out.price = pg.price;
        if (pg.siteName && pg.siteName.length <= 40) out.store = pg.siteName;
        out.found = !!pg.title;
      }
    }
  } catch (err) {
    console.error('preview failed: ' + err);
  }
  cache.put(ck, JSON.stringify(out), 21600);
  return out;
}

/* ------------------------------------------------------------------ admin */

function adminOk_(p) {
  var cfg = config_();
  return !!(p.a && cfg.admin_token && String(p.a) === cfg.admin_token);
}

function fillMissing_() {
  return lock_(function () {
    var ps = all_('People'), taken = {}, n = 0, max = 0;
    ps.forEach(function (r) {
      if (r.token) taken[r.token] = 1;
      var m = /^p(\d+)$/.exec(r.person_id);
      if (m) max = Math.max(max, Number(m[1]));
    });
    ps.forEach(function (r) {
      if (!r.person_id) { max++; set_('People', r._row, 'person_id', 'p' + ('0' + max).slice(-2)); n++; }
      if (!r.token) { set_('People', r._row, 'token', newToken_(taken)); n++; }
      if (!r.active) { set_('People', r._row, 'active', 'TRUE'); n++; }
    });
    return n;
  });
}

function admin_(p) {
  if (!adminOk_(p)) return { error: 'forbidden' };
  fillMissing_();
  var groups = all_('Groups'), people = all_('People'), ideas = all_('Ideas'), draws = all_('Draw');
  var counts = {};
  ideas.forEach(function (r) { counts[r.person_id] = (counts[r.person_id] || 0) + 1; });
  var bought = {};
  draws.forEach(function (r) { if (r.bought_at) bought[r.santa_id] = true; });
  return {
    ok: true,
    groups: groups.map(function (g) {
      var gp = groupPub_(g);
      gp.people = people.filter(function (x) { return x.group_id === g.group_id; }).map(function (x) {
        return {
          id: x.person_id,
          name: x.name,
          household: x.household,
          phone: x.phone,
          email: x.email,
          contact: x.phone ? 'phone' : 'email',
          token: x.token,
          opened: !!x.opened_at,
          ideaCount: counts[x.person_id] || 0,
          bought: !!bought[x.person_id]
        };
      });
      return gp;
    })
  };
}

function shuffle_(a) {
  for (var i = a.length - 1; i > 0; i--) {
    var j = Math.floor(Math.random() * (i + 1));
    var t = a[i]; a[i] = a[j]; a[j] = t;
  }
  return a;
}

// ok(a, b) is true when a may give to b. Returns {giver: giftee} or null.
function solve_(ids, ok) {
  var n = ids.length, used = {}, res = {}, steps = 0;
  var order = shuffle_(ids.slice());
  function rec(i) {
    if (i === n) return true;
    if (++steps > 200000) return false;
    var a = order[i];
    var cands = shuffle_(ids.filter(function (b) { return !used[b] && ok(a, b); }));
    for (var c = 0; c < cands.length; c++) {
      used[cands[c]] = 1; res[a] = cands[c];
      if (rec(i + 1)) return true;
      used[cands[c]] = 0; delete res[a];
      if (steps > 200000) return false;
    }
    return false;
  }
  return rec(0) ? res : null;
}

function runDraw_(p) {
  if (!adminOk_(p)) return { error: 'forbidden' };
  var g = group_(p.group);
  if (!g) return { error: 'no_group' };
  return lock_(function () {
    var draws = all_('Draw').filter(function (r) { return r.group_id === g.group_id; });
    if (draws.length && p.force !== 'true') return { error: 'already_drawn' };
    var people = all_('People').filter(function (r) { return r.group_id === g.group_id && r.active.toUpperCase() !== 'FALSE'; });
    if (people.length < 3) return { error: 'too_few_people' };
    var byId = {}, bad = {};
    people.forEach(function (r) { byId[r.person_id] = r; });
    all_('Exclusions').forEach(function (r) {
      if (r.group_id === g.group_id) { bad[r.person_a + '|' + r.person_b] = 1; bad[r.person_b + '|' + r.person_a] = 1; }
    });
    var ids = people.map(function (r) { return r.person_id; });
    var res = solve_(ids, function (a, b) {
      if (a === b) return false;
      var ha = byId[a].household, hb = byId[b].household;
      if (ha && ha === hb) return false;
      return !bad[a + '|' + b];
    });
    if (!res) return { error: 'no_valid_draw' };

    // Remove old rows bottom-up, then write the new draw.
    draws.sort(function (x, y) { return y._row - x._row; }).forEach(function (r) { tab_('Draw').deleteRow(r._row); });
    ids.forEach(function (a) { writeRow_('Draw', { group_id: g.group_id, santa_id: a, giftee_id: res[a], bought_at: '' }); });
    set_('Groups', g._row, 'drawn_at', now_());
    return { ok: true, count: ids.length };
  });
}

function clearDraw_(p) {
  if (!adminOk_(p)) return { error: 'forbidden' };
  if (p.confirm !== 'yes') return { error: 'confirm_required' };
  var g = group_(p.group);
  if (!g) return { error: 'no_group' };
  return lock_(function () {
    all_('Draw').filter(function (r) { return r.group_id === g.group_id; })
      .sort(function (x, y) { return y._row - x._row; })
      .forEach(function (r) { tab_('Draw').deleteRow(r._row); });
    set_('Groups', g._row, 'drawn_at', '');
    return { ok: true };
  });
}

function newLink_(p) {
  if (!adminOk_(p)) return { error: 'forbidden' };
  return lock_(function () {
    var ps = all_('People'), taken = {}, target = null;
    ps.forEach(function (r) { if (r.token) taken[r.token] = 1; if (r.person_id === p.person) target = r; });
    if (!target) return { error: 'not_found' };
    var t = newToken_(taken);
    set_('People', target._row, 'token', t);
    set_('People', target._row, 'opened_at', '');
    return { ok: true, token: t };
  });
}

function setStatus_(p) {
  if (!adminOk_(p)) return { error: 'forbidden' };
  if (p.status !== 'open' && p.status !== 'locked') return { error: 'bad_status' };
  var g = group_(p.group);
  if (!g) return { error: 'no_group' };
  return lock_(function () { set_('Groups', g._row, 'status', p.status); return { ok: true }; });
}

/* ------------------------------------------------------------------ setup */

// Run once from the Apps Script editor. Safe to run again.
function setup() {
  var ss = ss_();
  // A Sheet created from a CSV of people arrives as one tab; name it People.
  if (!ss.getSheetByName('People') && ss.getSheets().length === 1) ss.getSheets()[0].setName('People');
  Object.keys(TABS).forEach(function (name) {
    var sh = ss.getSheetByName(name);
    if (!sh) {
      sh = ss.insertSheet(name);
      sh.getRange(1, 1, 1, TABS[name].length).setValues([TABS[name]]).setFontWeight('bold');
      sh.setFrozenRows(1);
    } else {
      // Add any columns this version expects that the tab doesn't have yet.
      var have = sh.getRange(1, 1, 1, Math.max(sh.getLastColumn(), 1)).getValues()[0];
      TABS[name].forEach(function (col) {
        if (have.indexOf(col) < 0) { sh.getRange(1, sh.getLastColumn() + 1).setValue(col).setFontWeight('bold'); have.push(col); }
      });
    }
  });
  if (!all_('Groups').length) {
    writeRow_('Groups', { group_id: 'g1', name: 'Family Secret Santa', year: '2026', budget: '150', deadline: '2026-11-30', max_ideas: '3', status: 'open', drawn_at: '' });
  }
  fillMissing_();
  var cfg = config_();
  if (!cfg.admin_token) {
    var taken = {}, t = newToken_(taken) + newToken_(taken) + newToken_(taken);
    writeRow_('Config', { key: 'admin_token', value: t });
  }
  var draw = ss.getSheetByName('Draw');
  if (draw && !draw.isSheetHidden()) draw.hideSheet();
  return 'ok';
}
