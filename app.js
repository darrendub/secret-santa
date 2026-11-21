/* Secret Santa front-end. No data lives here; everything comes from the API in config.js. */
(function () {
  'use strict';
  var API = window.SANTA_API;
  var qs = new URLSearchParams(location.search);
  var TOKEN = (qs.get('k') || '').trim();
  var ADMIN = (qs.get('admin') || '').trim();
  var app = document.getElementById('app');
  var S = { me: null, view: 'home', editing: null };

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
    return fetch(u.toString()).then(function (r) { return r.json(); }).catch(function () { return { error: 'network' }; });
  }
  function money(n) { return n === null || n === undefined || n === '' || isNaN(Number(n)) ? '' : '$' + Number(n).toLocaleString('en-US', { maximumFractionDigits: 2 }); }
  function toast(msg) {
    var t = document.createElement('div');
    t.className = 'toast'; t.textContent = msg; document.body.appendChild(t);
    setTimeout(function () { t.remove(); }, 2200);
  }
  function niceDate(iso) {
    var m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso || '');
    if (!m) return iso || '';
    return new Date(+m[1], +m[2] - 1, +m[3]).toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric' });
  }
  function daysLeft(iso) {
    var m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso || '');
    if (!m) return null;
    var end = new Date(+m[1], +m[2] - 1, +m[3]), now = new Date();
    now = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    return Math.round((end - now) / 86400000);
  }
  function copy(text) {
    function fallback() {
      var ta = document.createElement('textarea'); ta.value = text; document.body.appendChild(ta);
      ta.select(); try { document.execCommand('copy'); } catch (e) {} ta.remove();
    }
    if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(text).catch(fallback); else fallback();
    toast('Copied!');
  }
  function storeInitial(store, title) {
    var s = String(store || title || '?').trim();
    return esc(s.charAt(0).toUpperCase() || '?');
  }
  function thumb(i) {
    if (i.image) return '<div class="thumb"><img src="' + esc(i.image) + '" alt="" referrerpolicy="no-referrer" onerror="this.parentNode.textContent=\'' + (i.store ? storeInitial(i.store).replace(/'/g, '') : '🎁') + '\'"></div>';
    if (i.kind === 'giftcard') return '<div class="thumb">💳</div>';
    if (i.store) return '<div class="thumb">' + storeInitial(i.store) + '</div>';
    return '<div class="thumb">🎁</div>';
  }
  function shortUrl(u) { return String(u || '').replace(/^https?:\/\/(www\.)?/i, '').slice(0, 60); }
  function ideaRow(i, actions) {
    return '<div class="idea">' + thumb(i) + '<div class="grow"><div class="t">' + esc(i.title) + '</div>' +
      '<div class="m">' + [i.store, money(i.price), i.kind === 'giftcard' ? 'Gift card' : ''].filter(Boolean).map(esc).join(' · ') + '</div>' +
      (i.notes ? '<div class="m">' + esc(i.notes) + '</div>' : '') +
      (i.url ? '<div class="m"><a class="link" href="' + esc(i.url) + '" target="_blank" rel="noopener">' + esc(shortUrl(i.url)) + '</a></div>' : '') +
      '</div>' + (actions || '') + '</div>';
  }
  function rulesBox(g) {
    return '<div class="rules"><h3>The rules</h3><ol>' +
      '<li>Add 1 to ' + g.maxIdeas + ' ideas, each with a link.</li>' +
      '<li>' + money(g.budget) + ' max. It’s a limit, not a target.</li>' +
      '<li>Your ideas can be from different stores. Your Santa will pick just one store to shop from.</li>' +
      '<li>Bring your gift wrapped to Christmas dinner. Print any digital gift cards.</li>' +
      '</ol></div>';
  }
  function topBar(name, line) {
    return '<div class="top"><div class="logo">🎅</div><div><div class="hello">' + esc(name) + '</div><div class="sub">' + esc(line) + '</div></div></div>';
  }
  function fail(msg, sub) {
    app.innerHTML = '<div class="card center stack"><div class="big-emoji">🎄</div><h2>' + esc(msg) + '</h2><p>' + esc(sub || '') + '</p></div>';
  }

  /* ------------------------------------------------------------ person */
  function load() {
    if (!TOKEN && !ADMIN) return fail('Open your personal link', 'Darren sent you a link just for you. Tap it from your text or email.');
    if (ADMIN) return loadAdmin();
    api('me', { k: TOKEN }).then(function (r) {
      if (r.error === 'not_found') return fail('Hmm, that link didn’t work', 'Ask Darren to send you a fresh one.');
      if (r.error) return fail('Something went wrong', 'Check your internet and try again in a minute.');
      S.me = r;
      var seen = false;
      try { seen = localStorage.getItem('santa_ok_' + TOKEN) === '1'; } catch (e) {}
      if (!seen) return confirmScreen();
      render();
    });
  }

  function confirmScreen() {
    app.innerHTML = '<div class="card center stack"><div class="big-emoji">🎅</div><h1>Hi ' + esc(S.me.person.name) + '!</h1><p>Is that you?</p>' +
      '<button class="btn" id="yes">Yes, that’s me</button><button class="btn white" id="no">Not me</button></div>';
    document.getElementById('yes').onclick = function () {
      try { localStorage.setItem('santa_ok_' + TOKEN, '1'); } catch (e) {}
      render();
    };
    document.getElementById('no').onclick = function () {
      fail('Oops!', 'This link belongs to someone else. Ask Darren for yours.');
    };
  }

  function render() {
    if (S.view === 'edit') return renderEdit();
    var m = S.me, g = m.group, locked = g.status === 'locked';
    var dl = daysLeft(g.deadline);
    var dlLine = locked ? 'Lists are locked' : (dl === null ? '' : dl > 1 ? 'Lists due ' + niceDate(g.deadline) + ' (' + dl + ' days)' : dl === 1 ? 'Lists due tomorrow!' : dl === 0 ? 'Lists due today!' : 'Lists were due ' + niceDate(g.deadline));
    var h = topBar('Hi ' + m.person.name + '!', g.name + ' ' + g.year);
    h += '<div class="card"><div class="row" style="justify-content:space-between"><h2 style="flex:2">Your wishlist</h2><span class="pill" style="flex:none">' + m.ideas.length + ' of ' + g.maxIdeas + '</span></div>' +
      '<p class="sub" style="margin-top:4px">' + esc(dlLine) + '</p>' + rulesBox(g);
    if (!m.ideas.length) h += '<p class="center" style="margin:6px 0 14px">Nothing here yet. Add your first idea!</p>';
    m.ideas.forEach(function (i) {
      h += ideaRow(i, (locked || String(i.id).indexOf('tmp') === 0) ? '' : '<button class="btn white small" style="flex:none;width:auto" data-edit="' + esc(i.id) + '">Edit</button>');
    });
    if (!locked && m.ideas.length < g.maxIdeas) h += '<div style="margin-top:14px"><button class="btn" id="add">+ Add an idea</button></div>';
    if (locked) h += '<div class="note" style="margin-top:12px">Lists are locked. Time to shop!</div>';
    h += '</div>';

    h += '<div class="card mission"><h2>Your secret mission</h2>';
    if (m.giftee) {
      h += '<p class="sub" style="margin:4px 0 8px">You’re Santa for <b class="fun" style="font-size:24px;color:#A51E19">' + esc(m.giftee.name) + '</b>. Shh!</p>';
      if (!m.giftee.ideas.length) h += '<div class="note">' + esc(m.giftee.name) + ' hasn’t added ideas yet. Check back soon.</div>';
      m.giftee.ideas.forEach(function (i) { h += ideaRow(i, ''); });
      if (m.giftee.ideas.some(function (i) { return i.kind === 'giftcard'; })) h += '<div class="note" style="margin-top:10px">Gift card? Print it and wrap it so there’s something to open.</div>';
      h += '<div style="margin-top:14px"><button class="btn ' + (m.bought ? 'gold' : 'white') + '" id="bought">' + (m.bought ? '✓ I bought it!' : 'I bought it!') + '</button></div>';
    } else {
      h += '<p style="margin-top:6px">Names are drawn when everyone’s ready. Your secret mission shows up right here.</p>';
    }
    h += '</div>';
    app.innerHTML = h;

    var add = document.getElementById('add');
    if (add) add.onclick = function () { S.view = 'edit'; S.editing = null; render(); window.scrollTo(0, 0); };
    Array.prototype.forEach.call(app.querySelectorAll('[data-edit]'), function (b) {
      b.onclick = function () {
        var id = b.getAttribute('data-edit');
        S.editing = S.me.ideas.filter(function (x) { return x.id === id; })[0] || null;
        S.view = 'edit'; render(); window.scrollTo(0, 0);
      };
    });
    var bought = document.getElementById('bought');
    if (bought) bought.onclick = function () {
      var next = !S.me.bought;
      S.me.bought = next; render(); toast(next ? 'Nice, mission complete!' : 'Marked as not bought');
      api('markBought', { k: TOKEN, value: next ? 'true' : 'false' }).then(function (r) {
        if (!r.ok) { S.me.bought = !next; render(); toast('Could not save. Try again.'); }
      });
    };
  }

  /* ------------------------------------------------------------ add / edit */
  function renderEdit() {
    var g = S.me.group, ed = S.editing;
    var st = { url: ed ? ed.url : '', title: ed ? ed.title : '', price: ed && ed.price !== null ? ed.price : '', notes: ed ? ed.notes : '', store: ed ? ed.store : '', image: ed ? ed.image : '', kind: ed ? ed.kind : 'gift', loading: false, failed: false, fetched: !!ed };
    var seq = 0, timer = null;

    function draw() {
      var h = '<div class="top"><button class="btn white small" id="back" style="flex:none;width:auto">← Back</button></div>';
      h += '<div class="card stack"><h2>' + (ed ? 'Edit idea' : 'Add an idea') + '</h2>';
      h += '<div><label for="url">Paste a link</label><input type="url" id="url" inputmode="url" autocapitalize="off" autocorrect="off" placeholder="Paste a link here, or type one in" value="' + esc(st.url) + '"></div>';
      if (st.loading) h += '<p><span class="spin"></span>&nbsp; Looking up your link…</p>';
      if (st.fetched && !st.loading) {
        if (st.failed) h += '<div class="note">Couldn’t grab details from that link, no worries. Fill in the name and price below.</div>';
        else h += '<div class="ok">Got it! Check the details below.</div>';
        h += '<div class="preview">' + thumb({ image: st.image, store: st.store, kind: st.kind }) + '<div class="grow"><div class="t">' + esc(st.title || 'Your idea') + '</div><div class="m">' + esc(st.store) + '</div></div></div>';
        h += '<div class="linkline">Link: <b>' + esc(shortUrl(st.url)) + '</b></div>';
      }
      h += '<div><label for="title">What is it?</label><input type="text" id="title" placeholder="Ultra light down jacket" value="' + esc(st.title) + '"></div>';
      h += '<div><label for="price">Price</label><input type="number" id="price" inputmode="decimal" min="0" step="0.01" placeholder="$0" value="' + esc(st.price) + '"></div>';
      h += '<div><label for="notes">Notes</label><textarea id="notes" placeholder="Size, color, anything helpful">' + esc(st.notes) + '</textarea></div>';
      h += '<label style="display:flex;gap:10px;align-items:center"><input type="checkbox" id="gc" style="width:26px;height:26px"' + (st.kind === 'giftcard' ? ' checked' : '') + '> This is a gift card</label>';
      h += '<div id="msg"></div>';
      h += '<button class="btn" id="save">' + (ed ? 'Save changes' : 'Save idea') + '</button>';
      if (ed) h += '<button class="btn white" id="del">Remove this idea</button>';
      h += '</div>';
      app.innerHTML = h;
      wire();
    }

    function keep() {
      ['title', 'price', 'notes'].forEach(function (k) { var el = document.getElementById(k); if (el) st[k] = el.value; });
      var u = document.getElementById('url'); if (u) st.url = u.value.trim();
      var gc = document.getElementById('gc'); if (gc) st.kind = gc.checked ? 'giftcard' : 'gift';
    }

    function lookup() {
      keep();
      if (!/^https?:\/\/\S+\.\S+/i.test(st.url)) return;
      var mine = ++seq;
      st.loading = true; st.fetched = false; draw();
      api('preview', { k: TOKEN, url: st.url }).then(function (r) {
        if (mine !== seq) return;
        keep();
        st.loading = false; st.fetched = true;
        st.failed = !(r && r.found && (r.image || (r.price !== null && r.price !== undefined)));
        if (r && r.store) st.store = r.store;
        if (r && r.image && !st.failed) st.image = r.image;
        if (!st.failed && !st.title) st.title = r.title;
        if (r && r.price !== null && r.price !== undefined && !st.price) st.price = r.price;
        draw();
      });
    }

    function wire() {
      document.getElementById('back').onclick = function () { S.view = 'home'; render(); };
      var u = document.getElementById('url');
      u.addEventListener('paste', function () { setTimeout(lookup, 50); });
      u.addEventListener('change', function () { if (u.value.trim() !== st.url) lookup(); });
      u.addEventListener('input', function () { clearTimeout(timer); timer = setTimeout(function () { if (u.value.trim() !== st.url && /^https?:\/\/\S+\.\S+/i.test(u.value.trim())) lookup(); }, 900); });
      document.getElementById('save').onclick = save;
      var del = document.getElementById('del'); if (del) del.onclick = remove;
    }

    function showMsg(t) { document.getElementById('msg').innerHTML = '<div class="err">' + esc(t) + '</div>'; }

    function save() {
      keep();
      if (!/^https?:\/\//i.test(st.url)) return showMsg('Please add a link so your Santa can find it.');
      if (!st.title.trim()) return showMsg('Tell us what it is.');
      var p = parseFloat(st.price);
      if (!isNaN(p) && p > g.budget) return showMsg('That’s over the ' + money(g.budget) + ' max. Pick something at or under it.');
      var snapshot = S.me.ideas.slice();
      var opt = { id: ed ? ed.id : 'tmp' + Date.now(), url: st.url, title: st.title.trim(), price: isNaN(p) ? null : p, notes: st.notes, kind: st.kind, store: st.store, image: st.image };
      if (ed) S.me.ideas = S.me.ideas.map(function (x) { return x.id === ed.id ? opt : x; }); else S.me.ideas = S.me.ideas.concat([opt]);
      S.view = 'home'; S.editing = null; render(); toast('Saved!'); window.scrollTo(0, 0);
      api('saveIdea', { k: TOKEN, data: JSON.stringify({ id: ed ? ed.id : '', url: st.url, title: st.title, price: st.price, notes: st.notes, kind: st.kind, store: st.store, image: st.image }) }).then(function (r) {
        if (r.ok) {
          S.me.ideas = S.me.ideas.map(function (x) { return x.id === opt.id ? r.idea : x; });
          if (S.view === 'home') render();
          return;
        }
        S.me.ideas = snapshot;
        if (S.view === 'home') render();
        toast(r.error === 'locked' ? 'Lists are locked now.' : r.error === 'max_ideas' ? 'You\u2019re at the limit.' : 'Could not save. Please try again.');
      });
    }

    function remove() {
      if (!window.confirm('Remove this idea?')) return;
      var snapshot = S.me.ideas.slice(), id = ed.id;
      S.me.ideas = S.me.ideas.filter(function (x) { return x.id !== id; });
      S.view = 'home'; S.editing = null; render(); toast('Removed'); window.scrollTo(0, 0);
      api('deleteIdea', { k: TOKEN, id: id }).then(function (r) {
        if (!r.ok) { S.me.ideas = snapshot; if (S.view === 'home') render(); toast('Could not remove. Please try again.'); }
      });
    }

    draw();
  }

  /* ------------------------------------------------------------ admin */
  function loadAdmin() {
    api('admin', { a: ADMIN }).then(function (r) {
      if (r.error === 'forbidden') return fail('Admin link not recognized', 'Check the link you saved.');
      if (r.error) return fail('Something went wrong', 'Try again in a minute.');
      renderAdmin(r);
    });
  }

  function personLink(p) { return location.origin + '/?k=' + p.token; }

  function messageFor(p, g, drawn) {
    var link = personLink(p);
    if (!p.opened) {
      return 'Hi ' + p.name + '! It’s Secret Santa time 🎅 Tap your private link to add 1 to ' + g.maxIdeas + ' gift ideas (with links, ' + money(g.budget) + ' max). Lists are due ' + niceDate(g.deadline) + '.\n' + link;
    }
    if (drawn && !p.bought) {
      return 'Hi ' + p.name + '! Reminder to buy your Secret Santa gift and bring it wrapped to Christmas dinner 🎁 Your link:\n' + link;
    }
    if (!p.ideaCount) {
      return 'Hi ' + p.name + '! Quick reminder to add your Secret Santa ideas by ' + niceDate(g.deadline) + ' 🎅 Your link:\n' + link;
    }
    return 'Hi ' + p.name + '! Here is your Secret Santa link again:\n' + link;
  }

  function renderAdmin(r) {
    var h = '<div class="top"><div class="logo">🎅</div><div><div class="hello">Santa Boss</div><div class="sub">Admin</div></div></div>';
    r.groups.forEach(function (g) {
      var opened = g.people.filter(function (p) { return p.opened; }).length;
      var done = g.people.filter(function (p) { return p.ideaCount > 0; }).length;
      h += '<div class="card"><div class="row" style="justify-content:space-between"><h2 style="flex:2">' + esc(g.name) + ' ' + esc(g.year) + '</h2>' +
        '<span class="pill ' + (g.drawn ? 'green' : '') + '" style="flex:none">' + (g.drawn ? 'Drawn' : 'Not drawn') + '</span></div>' +
        '<p class="sub" style="margin:6px 0 12px">' + opened + ' of ' + g.people.length + ' opened · ' + done + ' of ' + g.people.length + ' added ideas · ' + (g.status === 'locked' ? 'Locked' : 'Open') + '</p>';
      g.people.forEach(function (p) {
        var status = [p.opened ? 'Opened' : 'Not opened', p.ideaCount + ' idea' + (p.ideaCount === 1 ? '' : 's')];
        if (g.drawn) status.push(p.bought ? 'Bought ✓' : 'Not bought');
        var link = personLink(p), msg = messageFor(p, g, g.drawn);
        var send;
        if (p.contact === 'phone' && p.phone) send = '<a class="btn small" style="flex:none;width:auto" href="sms:' + esc(p.phone) + '?&body=' + encodeURIComponent(msg) + '">Text</a>';
        else send = '<a class="btn small" style="flex:none;width:auto" href="mailto:' + esc(p.email) + '?subject=' + encodeURIComponent('Secret Santa ' + g.year) + '&body=' + encodeURIComponent(msg) + '">Email</a>';
        h += '<div class="person"><div class="nm">' + esc(p.name) + '</div><div class="st">' + esc(status.join(' · ')) + '</div>' +
          '<button class="btn white small" style="flex:none;width:auto" data-copy="' + esc(link) + '">Copy</button>' + send +
          '<div class="link-box">' + esc(link) + '</div></div>';
      });
      h += '<div class="stack" style="margin-top:16px">';
      h += g.drawn ? '<button class="btn white" data-redraw="' + esc(g.id) + '">Re-draw names</button>' : '<button class="btn" data-draw="' + esc(g.id) + '">Draw names</button>';
      h += '<button class="btn gold" data-status="' + esc(g.id) + '" data-to="' + (g.status === 'locked' ? 'open' : 'locked') + '">' + (g.status === 'locked' ? 'Unlock lists' : 'Lock lists') + '</button>';
      h += '</div>';
      h += '<p class="sub" style="margin-top:12px">The draw is hidden from this page. Only you could see it by opening the Sheet’s hidden Draw tab.</p></div>';
    });
    app.innerHTML = h;

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
        if (!window.confirm('Re-draw? This replaces every assignment and "I bought it" marks. Only do this before sending links.')) return;
        api('runDraw', { a: ADMIN, group: b.getAttribute('data-redraw'), force: 'true' }).then(function (x) {
          toast(x.ok ? 'Re-drawn!' : 'Draw failed: ' + (x.error || '')); loadAdmin();
        });
      };
    });
    Array.prototype.forEach.call(app.querySelectorAll('[data-status]'), function (b) {
      b.onclick = function () {
        api('setStatus', { a: ADMIN, group: b.getAttribute('data-status'), status: b.getAttribute('data-to') }).then(function () { loadAdmin(); });
      };
    });
  }

  load();
})();
