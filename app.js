/* Secret Santa front-end. No data lives here; everything comes from the API in config.js. */
(function () {
  'use strict';
  var API = window.SANTA_API;
  var qs = new URLSearchParams(location.search);
  var TOKEN = (qs.get('k') || '').trim();
  var ADMIN = (qs.get('admin') || '').trim();
  var app = document.getElementById('app');
  var S = { me: null, view: 'home', editing: null };
  var SANTA = 'img/santa.png';

  /* ------------------------------------------------------------ helpers */
  function esc(s) {
    return String(s === undefined || s === null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function api(action, params) {
    var u = new URL(API);
    u.searchParams.set('action', action);
    Object.keys(params || {}).forEach(function (k) { u.searchParams.set(k, params[k]); });
    var ctl = window.AbortController ? new AbortController() : null;
    var timer = ctl ? setTimeout(function () { ctl.abort(); }, 20000) : null;
    return fetch(u.toString(), ctl ? { signal: ctl.signal } : {})
      .then(function (r) { return r.json(); })
      .catch(function () { return { error: 'network' }; })
      .then(function (r) { if (timer) clearTimeout(timer); return r || { error: 'network' }; });
  }
  function cleanUrl(text) {
    var s = String(text || '').trim();
    var m = /https?:\/\/[^\s<>"]+/i.exec(s);
    if (!m) {
      m = /(?:^|\s)((?:www\.)?[a-z0-9-]+(?:\.[a-z0-9-]+)*\.[a-z]{2,}(?:\/[^\s<>"]*)?)/i.exec(s);
      if (!m) return '';
      return 'https://' + m[1].replace(/[).,!?'"]+$/, '');
    }
    return m[0].replace(/[).,!?'"]+$/, '');
  }
  function num(v) {
    if (v === null || v === undefined) return NaN;
    var s = String(v).replace(/[$,\s]/g, '');
    return s === '' ? NaN : Number(s);
  }
  function money(v) {
    var n = num(v);
    if (isNaN(n)) return '';
    return '$' + (n % 1 ? n.toFixed(2) : String(n));
  }
  function store(i) {
    if (i.store) return i.store;
    try {
      var h = new URL(i.url).hostname.replace(/^www\./, '').split('.');
      var name = h.length > 1 ? h[h.length - 2] : h[0];
      return name.charAt(0).toUpperCase() + name.slice(1);
    } catch (e) { return ''; }
  }
  function toast(msg) {
    Array.prototype.forEach.call(document.querySelectorAll('.toast'), function (x) { x.remove(); });
    var t = document.createElement('div');
    t.className = 'toast'; t.textContent = msg; document.body.appendChild(t);
    setTimeout(function () { t.remove(); }, msg.length > 30 ? 4500 : 2200);
  }
  function shortDate(iso) {
    var m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso || '');
    if (!m) return iso || '';
    return new Date(+m[1], +m[2] - 1, +m[3]).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  }
  function longDate(iso) {
    var m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso || '');
    if (!m) return iso || '';
    return new Date(+m[1], +m[2] - 1, +m[3]).toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric' });
  }
  function copy(text) {
    function fallback() {
      var ta = document.createElement('textarea'); ta.value = text; document.body.appendChild(ta);
      ta.select(); try { document.execCommand('copy'); } catch (e) {} ta.remove();
    }
    if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(text).catch(fallback); else fallback();
    toast('Copied!');
  }
  function shortUrl(u) {
    var s = String(u || '');
    return s.length > 44 ? s.slice(0, 43) + '…' : s;
  }
  function store_get(k) { try { return localStorage.getItem(k); } catch (e) { return null; } }
  function store_set(k, v) { try { localStorage.setItem(k, v); } catch (e) {} }

  /* ------------------------------------------------------------ shared pieces */
  function head(title) {
    return '<div class="head"><img src="' + SANTA + '" alt=""><h1>' + esc(title) + '</h1></div>';
  }
  function countdown() {
    var now = new Date(), xmas = new Date(now.getFullYear(), 11, 25);
    if (now >= new Date(now.getFullYear(), 11, 26)) xmas = new Date(now.getFullYear() + 1, 11, 25);
    var ms = xmas - now;
    if (ms <= 0) return '<div class="countdown"><span>MERRY CHRISTMAS!</span></div>';
    var mins = Math.floor(ms / 60000), d = Math.floor(mins / 1440), h = Math.floor((mins % 1440) / 60), m = mins % 60;
    return '<div class="countdown"><b>' + d + 'D</b><b>' + h + 'H</b><b>' + m + 'M</b><span>UNTIL CHRISTMAS</span></div>';
  }
  setInterval(function () {
    var c = document.querySelector('.countdown');
    if (c) c.outerHTML = countdown();
  }, 30000);
  function page(inner) {
    document.body.classList.remove('splash-on');
    app.innerHTML = '<div class="page">' + inner + countdown() + '</div>';
  }
  function splash() {
    document.body.classList.add('splash-on');
    app.innerHTML = '<div class="splash"><div class="ring"><img class="wreath" src="img/wreath.png" alt=""><img class="santa" src="' + SANTA + '" alt="Loading"></div><div class="name">Secret Santa</div></div>';
  }
  function fail(title, sub, retry) {
    page(head('Hello!') + '<div class="card msg"><h2>' + esc(title) + '</h2><p>' + esc(sub || '') + '</p>' +
      (retry ? '<button class="btn sm" id="retry">Try again</button>' : '') + '</div>');
    if (retry) document.getElementById('retry').onclick = retry;
  }
  function missionRules(g) {
    return '<div class="mission"><p class="intro">Your mission, should you choose to accept it:</p>' +
      '<div class="rule"><span class="e">📝</span><p>Add up to ' + g.maxIdeas + ' items to your wishlist.</p></div>' +
      '<div class="rule"><span class="e">💰</span><p>Each item should be up to ' + money(g.budget) + ', from one store. It’s a limit, not a target.</p></div>' +
      '<div class="rule"><span class="e">🎁</span><p>Bring your wrapped gift to Christmas dinner. Print any digital gift cards.</p></div></div>';
  }
  function meta(i) {
    return [store(i), money(i.price), i.notes].filter(Boolean).map(esc).join(' · ');
  }

  /* ------------------------------------------------------------ person */
  function cacheMe() { if (S.me) store_set('santa_me_' + TOKEN, JSON.stringify(S.me)); }
  function load() {
    if (!TOKEN && !ADMIN) return fail('Open your personal link', 'Darren sent you a link just for you. Tap it from your text or email.');
    if (ADMIN) { splash(); return loadAdmin(); }
    var cached = null;
    if (store_get('santa_ok_' + TOKEN) === '1') { try { cached = JSON.parse(store_get('santa_me_' + TOKEN) || 'null'); } catch (e) {} }
    if (cached && cached.person && cached.group) { S.me = cached; render(); } else splash();
    api('me', { k: TOKEN }).then(function (r) {
      if (r.error === 'not_found') { store_set('santa_me_' + TOKEN, ''); return fail('Hmm, that link didn’t work', 'Ask Darren to send you a fresh one.'); }
      if (r.error) { if (cached) return; return fail('Something went wrong', 'Check your internet and try again.', load); }
      if (cached) {
        var busy = S.view !== 'home' || S.me.ideas.some(function (x) { return String(x.id).indexOf('tmp') === 0; });
        if (busy) return;
        var changed = JSON.stringify(r) !== JSON.stringify(S.me);
        S.me = r; cacheMe();
        if (changed) render();
        return;
      }
      S.me = r; cacheMe();
      if (store_get('santa_ok_' + TOKEN) !== '1') return confirmScreen();
      render();
    });
  }

  function confirmScreen() {
    page(head('Hello!') +
      '<div class="card"><div class="card-head"><h2>Are you ' + esc(S.me.person.name) + '?</h2></div>' +
      '<button class="btn sm" id="yes">Yes, that’s me</button>' +
      '<button class="btn white sm" id="no">Not me</button></div>');
    document.getElementById('yes').onclick = function () { store_set('santa_ok_' + TOKEN, '1'); render(); };
    document.getElementById('no').onclick = function () {
      fail('Oops!', 'This link belongs to someone else. Ask Darren for yours.');
    };
  }

  function render() {
    if (S.view === 'edit') return renderItem();
    var m = S.me, g = m.group, locked = g.status === 'locked';
    var max = g.maxIdeas, full = m.ideas.length >= max;
    var h = head('Hi ' + m.person.name + '!') + missionRules(g);

    h += '<div class="card"><div class="card-head"><h2>Your items</h2><span class="pill dark">' +
      (locked ? 'Lists locked' : 'Due ' + esc(shortDate(g.deadline))) + '</span></div>';
    if (m.ideas.length) {
      h += '<div class="items">';
      m.ideas.forEach(function (i, n) {
        var pending = String(i.id).indexOf('tmp') === 0;
        h += '<div class="item"><div class="num">' + (n + 1) + '</div><div class="det"><p class="t">' + esc(i.title) + '</p><p class="m">' + meta(i) + '</p></div>' +
          (locked || pending ? '' : '<button class="btn white sm auto" data-edit="' + esc(i.id) + '">Edit</button>') + '</div>';
      });
      h += '</div>';
    }
    if (!locked) h += '<button class="btn sm" id="add"' + (full ? ' disabled' : '') + '>' + (full ? max + ' of ' + max + ' added' : 'Add item') + '</button>';
    h += '</div>';

    var revealed = store_get('santa_rev_' + TOKEN) === '1';
    h += '<div class="card"><div class="card-head"><h2>Your target</h2>' +
      (m.giftee && revealed ? '<span class="pill gold">' + esc(m.giftee.name) + '</span>' : '') + '</div>';
    if (!m.giftee) {
      h += '<div class="empty">Names haven’t been drawn yet. Check back soon.</div>';
    } else if (!revealed) {
      h += '<button class="btn white sm" id="reveal">Reveal</button>';
    } else if (!m.giftee.ideas.length) {
      h += '<div class="empty">' + esc(m.giftee.name) + ' hasn’t added any items yet</div>';
    } else {
      h += '<div class="items">';
      m.giftee.ideas.forEach(function (i) {
        h += '<div class="item"><div class="det"><p class="t">' + esc(i.title) + '</p><p class="m">' + meta(i) + '</p></div>' +
          (i.url ? '<a class="btn white sm auto" href="' + esc(i.url) + '" target="_blank" rel="noopener">Buy</a>' : '') + '</div>';
      });
      h += '</div>';
    }
    h += '</div>';
    page(h);

    var add = document.getElementById('add');
    if (add && !full) add.onclick = function () { S.view = 'edit'; S.editing = null; render(); window.scrollTo(0, 0); };
    Array.prototype.forEach.call(app.querySelectorAll('[data-edit]'), function (b) {
      b.onclick = function () {
        var id = b.getAttribute('data-edit');
        S.editing = S.me.ideas.filter(function (x) { return x.id === id; })[0] || null;
        S.view = 'edit'; render(); window.scrollTo(0, 0);
      };
    });
    var rev = document.getElementById('reveal');
    if (rev) rev.onclick = function () { store_set('santa_rev_' + TOKEN, '1'); render(); };
  }

  /* ------------------------------------------------------------ add / edit item */
  function renderItem() {
    var g = S.me.group, ed = S.editing, draft = S.draft;
    S.draft = null;
    var st = draft ? draft.st : {
      url: ed ? ed.url : '', title: ed ? ed.title : '', price: ed && ed.price !== null && ed.price !== '' ? money(ed.price) : '',
      notes: ed ? ed.notes : '', store: ed ? ed.store : '', image: ed ? ed.image : '',
      loading: false, result: null, details: !!ed, looked: ed ? ed.url : ''
    };
    var errorMsg = draft ? draft.error : '';
    var start = JSON.stringify([st.url, st.title, st.price, st.notes]);
    var seq = 0, timer = null;

    function priceBad() { var t = String(st.price || '').trim(); if (!t) return false; var p = num(t); return isNaN(p) || p < 0; }
    function over() { var p = num(st.price); return !priceBad() && !isNaN(p) && p > Number(g.budget); }
    function priceMsg() { return priceBad() ? 'Enter a price like 45 or 45.99' : over() ? 'Must be ' + money(g.budget) + ' or less' : ''; }
    function valid() { return !!st.url && !!String(st.title || '').trim() && !priceMsg(); }
    function dirty() { return JSON.stringify([st.url, st.title, st.price, st.notes]) !== start; }

    function draw() {
      var h = '<div class="bar"><button class="btn white sm auto l" id="back">Back</button><h1>Item</h1>' +
        '<button class="btn sm auto r" id="save">Save</button></div>';
      if (errorMsg) h += '<div class="note bad"><img src="img/error.svg" alt=""><p>' + esc(errorMsg) + '</p></div>';
      if (st.loading) h += '<div class="note wait"><img class="spin" src="img/wreath-sm.png" alt=""><p>Looking up your link…</p></div>';
      else if (st.result === 'ok') h += '<div class="note ok"><img src="img/check.svg" alt=""><p>Details grabbed from link</p></div>';
      else if (st.result === 'fail') h += '<div class="note fail"><img src="img/alert.svg" alt=""><p>Couldn’t grab details from link. No worries. Fill in the name and price below.</p></div>';
      h += '<div class="card tight"><label for="url">Paste a link</label><div class="linkrow">' +
        '<input type="url" id="url" inputmode="url" autocapitalize="off" autocorrect="off" placeholder="Your link here" value="' + esc(st.url) + '">' +
        '<button class="btn sm auto icon" id="go" aria-label="Look up link"><svg width="24" height="24" viewBox="0 0 24 24" fill="none"><path d="M20 6L9 17L4 12" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/></svg></button>' +
        '<button class="btn white sm auto" id="clear" aria-label="Clear link">X</button></div>' +
        '<p class="err" id="urlmsg" hidden>Paste a link first</p></div>';
      if (st.details && !st.loading) {
        h += '<div class="card tight">';
        if (st.result === 'fail') h += '<p class="label">Add the details</p>';
        h += '<div class="field"><label for="title">Name</label><input type="text" id="title" placeholder="Add name" value="' + esc(st.title) + '"></div>';
        h += '<div class="field"><label for="price">Price</label><input type="text" id="price" inputmode="decimal" placeholder="Add price" value="' + esc(st.price) + '">' +
          '<p class="err" id="pricemsg"' + (priceMsg() ? '' : ' hidden') + '>' + esc(priceMsg()) + '</p></div>';
        h += '<div class="field"><label for="notes">Notes (Optional)</label><textarea id="notes" placeholder="Add notes">' + esc(st.notes) + '</textarea></div>';
        if (st.url) h += '<div class="linkline"><img src="img/link.svg" alt=""><span>' + esc(shortUrl(st.url)) + '</span></div>';
        h += '</div>';
        if (ed) h += '<button class="btn sm" id="del">Remove item</button>';
      }
      page(h);
      wire();
      refreshSave();
    }

    function keep() {
      ['title', 'price', 'notes'].forEach(function (k) { var el = document.getElementById(k); if (el) st[k] = el.value; });
      var u = document.getElementById('url'); if (u) st.url = cleanUrl(u.value);
    }
    function refreshSave() {
      var s = document.getElementById('save'); if (s) s.disabled = !valid();
      var m = document.getElementById('pricemsg');
      if (m) { var t = priceMsg(); m.textContent = t; m.hidden = !t; }
    }

    function lookup(force) {
      keep();
      if (!st.url) { var m = document.getElementById('urlmsg'); if (m && force) m.hidden = false; return; }
      if (st.url === st.looked && !force) { draw(); return; }
      var mine = ++seq;
      var changed = !!st.looked && st.url !== st.looked;
      st.looked = st.url; st.loading = true; st.result = null; draw();
      api('preview', { k: TOKEN, url: st.url }).then(function (r) {
        if (mine !== seq) return;
        st.loading = false; st.details = true;
        var good = r && r.found && (r.image || (r.price !== null && r.price !== undefined));
        st.result = good ? 'ok' : 'fail';
        var hasPrice = r && r.price !== null && r.price !== undefined;
        if (changed) {
          st.store = (r && r.store) || ''; st.image = '';
          if (good) { st.title = r.title || ''; st.price = hasPrice ? money(r.price) : ''; if (r.image) st.image = r.image; }
          else { st.title = ''; st.price = ''; }
        } else {
          if (r && r.store) st.store = r.store;
          if (good) {
            if (r.image) st.image = r.image;
            if (r.title && !st.title) st.title = r.title;
            if (hasPrice && !st.price) st.price = money(r.price);
          }
        }
        draw();
      });
    }

    function wire() {
      document.getElementById('back').onclick = function () {
        keep();
        if (dirty() && !window.confirm('Discard your changes?')) return;
        seq++; S.view = 'home'; render();
      };
      document.getElementById('save').onclick = save;
      document.getElementById('clear').onclick = function () {
        seq++; st.url = ''; st.looked = ''; st.result = null; st.loading = false;
        if (!ed) { st.details = false; st.title = ''; st.price = ''; st.notes = ''; st.store = ''; st.image = ''; }
        draw(); document.getElementById('url').focus();
      };
      document.getElementById('go').onclick = function () { clearTimeout(timer); lookup(true); };
      var u = document.getElementById('url');
      u.addEventListener('keydown', function (e) { if (e.key === 'Enter') { e.preventDefault(); clearTimeout(timer); lookup(true); } });
      u.addEventListener('paste', function () { setTimeout(lookup, 50); });
      u.addEventListener('input', function () {
        st.url = cleanUrl(u.value); refreshSave();
        var um = document.getElementById('urlmsg'); if (um) um.hidden = true;
        clearTimeout(timer);
        timer = setTimeout(function () { if (st.url && st.url !== st.looked) lookup(); }, 900);
      });
      ['title', 'price', 'notes'].forEach(function (k) {
        var el = document.getElementById(k);
        if (el) el.addEventListener('input', function () { st[k] = el.value; refreshSave(); });
      });
      var del = document.getElementById('del'); if (del) del.onclick = remove;
    }

    function save() {
      keep();
      if (!valid()) return refreshSave();
      var p = num(st.price);
      var snapshot = S.me.ideas.slice();
      var data = { id: ed ? ed.id : '', url: st.url, title: st.title.trim(), price: isNaN(p) ? '' : p, notes: st.notes.trim(), kind: 'gift', store: st.store, image: st.image };
      var opt = { id: ed ? ed.id : 'tmp' + Date.now(), url: data.url, title: data.title, price: isNaN(p) ? null : p, notes: data.notes, kind: 'gift', store: data.store, image: data.image };
      if (ed) S.me.ideas = S.me.ideas.map(function (x) { return x.id === ed.id ? opt : x; }); else S.me.ideas = S.me.ideas.concat([opt]);
      seq++; S.view = 'home'; S.editing = null; render(); toast('Saved!'); window.scrollTo(0, 0);
      api('saveIdea', { k: TOKEN, data: JSON.stringify(data) }).then(function (r) {
        if (r.ok) {
          S.me.ideas = S.me.ideas.map(function (x) { return x.id === opt.id ? r.idea : x; });
          cacheMe();
          if (S.view === 'home') render();
          return;
        }
        S.me.ideas = snapshot;
        var msg = r.error === 'locked' ? 'Lists are locked now, so this item couldn’t be saved.'
          : r.error === 'max_ideas' ? 'You already have ' + g.maxIdeas + ' items. Remove one to add this.'
          : 'Couldn’t save. Check your internet and tap Save again.';
        if (r.error === 'locked') S.me.group.status = 'locked';
        if (S.view !== 'home' || r.error === 'locked') { if (S.view === 'home') render(); toast(msg); return; }
        st.loading = false;
        Array.prototype.forEach.call(document.querySelectorAll('.toast'), function (x) { x.remove(); });
        S.draft = { st: st, error: msg };
        S.editing = ed; S.view = 'edit'; render(); window.scrollTo(0, 0);
      });
    }

    function remove() {
      if (!window.confirm('Remove this item?')) return;
      var snapshot = S.me.ideas.slice(), id = ed.id;
      S.me.ideas = S.me.ideas.filter(function (x) { return x.id !== id; });
      seq++; S.view = 'home'; S.editing = null; render(); toast('Removed'); window.scrollTo(0, 0);
      api('deleteIdea', { k: TOKEN, id: id }).then(function (r) {
        if (r.ok) cacheMe();
        if (!r.ok) {
          S.me.ideas = snapshot;
          if (r.error === 'locked') S.me.group.status = 'locked';
          if (S.view === 'home') render();
          toast(r.error === 'locked' ? 'Lists are locked now.' : 'Couldn’t remove. Check your internet and try again.');
        }
      });
    }

    draw();
  }

  /* ------------------------------------------------------------ admin */
  function loadAdmin() {
    api('admin', { a: ADMIN }).then(function (r) {
      if (r.error === 'forbidden') return fail('Admin link not recognized', 'Check the link you saved.');
      if (r.error) return fail('Something went wrong', 'Check your internet and try again.', load);
      renderAdmin(r);
    });
  }

  function personLink(p) { return location.origin + '/?k=' + p.token; }

  function messageFor(p, g) {
    var link = personLink(p);
    if (!p.opened) {
      return 'Hi ' + p.name + '! It’s Secret Santa time 🎅 Tap your private link to add up to ' + g.maxIdeas + ' items to your wishlist (' + money(g.budget) + ' max each). Lists are due ' + longDate(g.deadline) + '.\n' + link;
    }
    if (!p.ideaCount) {
      return 'Hi ' + p.name + '! Quick reminder to add your Secret Santa items by ' + longDate(g.deadline) + ' 🎅 Your link:\n' + link;
    }
    return 'Hi ' + p.name + '! Here is your Secret Santa link again:\n' + link;
  }

  function renderAdmin(r) {
    var h = head('Santa Boss');
    r.groups.forEach(function (g) {
      var opened = g.people.filter(function (p) { return p.opened; }).length;
      var items = g.people.reduce(function (a, p) { return a + (p.ideaCount || 0); }, 0);
      h += '<div class="card" style="gap:6px">';
      if (r.groups.length > 1) h += '<p class="group-name">' + esc(g.name) + '</p>';
      h += '<div class="stats"><div><b>' + opened + '</b><span>Opened</span></div><div><b>' + items + '</b><span>Items</span></div></div>';
      g.people.forEach(function (p) {
        var status = (p.opened ? 'Opened' : 'Not opened') + ' · ' + p.ideaCount + ' item' + (p.ideaCount === 1 ? '' : 's');
        var msg = messageFor(p, g), send;
        if (p.contact === 'phone' && p.phone) send = '<a class="btn sm" href="sms:' + esc(p.phone) + '?&body=' + encodeURIComponent(msg) + '">Text</a>';
        else send = '<a class="btn sm" href="mailto:' + esc(p.email) + '?subject=' + encodeURIComponent('Secret Santa ' + g.year) + '&body=' + encodeURIComponent(msg) + '">Email</a>';
        h += '<div class="person"><div class="top"><span class="nm">' + esc(p.name) + '</span><span class="st">' + esc(status) + '</span></div>' +
          '<div class="acts"><button class="btn white sm" data-copy="' + esc(personLink(p)) + '">Copy</button>' + send + '</div></div>';
      });
      h += '<div class="actions">';
      h += g.drawn ? '<button class="btn white" data-redraw="' + esc(g.id) + '">Re-draw names</button>' : '<button class="btn" data-draw="' + esc(g.id) + '">Draw names</button>';
      h += '<button class="btn gold" data-status="' + esc(g.id) + '" data-to="' + (g.status === 'locked' ? 'open' : 'locked') + '">' + (g.status === 'locked' ? 'Unlock lists' : 'Lock lists') + '</button>';
      h += '</div></div>';
    });
    page(h);

    Array.prototype.forEach.call(app.querySelectorAll('[data-copy]'), function (b) { b.onclick = function () { copy(b.getAttribute('data-copy')); }; });
    Array.prototype.forEach.call(app.querySelectorAll('[data-draw]'), function (b) {
      b.onclick = function () {
        if (!window.confirm('Draw names now? Send links after the draw.')) return;
        b.disabled = true; b.textContent = 'Drawing…';
        api('runDraw', { a: ADMIN, group: b.getAttribute('data-draw') }).then(function (x) {
          toast(x.ok ? 'Names drawn!' : x.error === 'no_valid_draw' ? 'No valid draw. Check households.' : 'Draw failed: ' + (x.error || ''));
          loadAdmin();
        });
      };
    });
    Array.prototype.forEach.call(app.querySelectorAll('[data-redraw]'), function (b) {
      b.onclick = function () {
        if (!window.confirm('Re-draw? This replaces every assignment. Only do this before sending links.')) return;
        b.disabled = true;
        api('runDraw', { a: ADMIN, group: b.getAttribute('data-redraw'), force: 'true' }).then(function (x) {
          toast(x.ok ? 'Re-drawn!' : 'Draw failed: ' + (x.error || '')); loadAdmin();
        });
      };
    });
    Array.prototype.forEach.call(app.querySelectorAll('[data-status]'), function (b) {
      b.onclick = function () {
        b.disabled = true;
        api('setStatus', { a: ADMIN, group: b.getAttribute('data-status'), status: b.getAttribute('data-to') }).then(function (x) {
          if (!x || !x.ok) toast('Couldn’t update. Check your internet and try again.');
          loadAdmin();
        });
      };
    });
  }

  load();
})();
