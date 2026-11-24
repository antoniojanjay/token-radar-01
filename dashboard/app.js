// Token Radar's plain dashboard. It reads window.RADAR (written beside dashboard/ by main.ts)
// and renders the ranked board, a filterable table, a per-protocol detail view with the model's
// own inputs and the protocol's farm plan, and a model sandbox. No network: every byte it shows
// is in data.js.
(function () {
  'use strict';

  var DATA = window.RADAR;
  if (!DATA) return;
  var app = document.getElementById('board');
  var state = { q: '', category: 'all', chain: 'all', tab: 'pre', sort: 'implied', dir: -1, selected: null, sandbox: null };

  var usd0 = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });
  function fmtUsd(n) {
    if (n === null || n === undefined || !isFinite(n)) return 'n/a';
    if (Math.abs(n) >= 1e9) return '$' + (n / 1e9).toFixed(2) + 'B';
    if (Math.abs(n) >= 1e6) return '$' + (n / 1e6).toFixed(1) + 'M';
    if (Math.abs(n) >= 1e3) return '$' + Math.round(n / 1e3) + 'K';
    return usd0.format(n);
  }
  function fmtPct(n) {
    if (n === null || n === undefined || !isFinite(n)) return 'n/a';
    return (n > 0 ? '+' : '') + n.toFixed(2) + '%';
  }
  function fmtAge(days) {
    if (days === null || days === undefined) return 'unknown';
    if (days >= 365) return (days / 365).toFixed(1) + 'y';
    return Math.max(0, Math.round(days)) + 'd';
  }
  function esc(s) {
    return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  // The model in one function: the page recomputes a row from the snapshot figures, so the
  // page's code and the board's data are visibly the same arithmetic. The sandbox overrides
  // the growth weight and scales every category multiple, then re-ranks the board live.
  function modelOf() {
    var m = DATA.model;
    if (!state.sandbox) return m;
    return {
      growth_weight: state.sandbox.growthWeight,
      growth_floor: m.growth_floor, growth_cap: m.growth_cap,
      maturity_floor: m.maturity_floor, maturity_range: m.maturity_range,
      maturity_days: m.maturity_days, unknown_age_days: m.unknown_age_days,
      multiple_floor: m.multiple_floor, multiple_cap: m.multiple_cap,
      min_live_for_category: m.min_live_for_category
    };
  }
  function impliedOf(row, model, multScale) {
    var growth = Math.min(model.growth_cap, Math.max(model.growth_floor, row.change_7d === null || row.change_7d === undefined ? 0 : row.change_7d));
    var growthMult = 1 + (growth / 100) * model.growth_weight;
    var age = row.age_days === null || row.age_days === undefined ? model.unknown_age_days : row.age_days;
    var maturity = model.maturity_floor + (Math.min(Math.max(age, 0), model.maturity_days) / model.maturity_days) * model.maturity_range;
    var mult = row.category_multiple * (multScale || 1);
    mult = Math.min(model.multiple_cap, Math.max(model.multiple_floor, mult));
    return { implied: Math.max(1, Math.round(row.tvl_usd * mult * growthMult * maturity)), multiple: mult, growthMult: growthMult, maturity: maturity, growth: growth };
  }

  function el(tag, attrs) {
    var node = document.createElement(tag);
    if (attrs) {
      Object.keys(attrs).forEach(function (k) {
        if (k === 'class') node.className = attrs[k];
        else if (k === 'text') node.textContent = attrs[k];
        else if (k === 'html') node.innerHTML = attrs[k];
        else if (k.slice(0, 2) === 'on') node.addEventListener(k.slice(2), attrs[k]);
        else if (attrs[k] !== null && attrs[k] !== undefined) node.setAttribute(k, attrs[k]);
      });
    }
    for (var i = 2; i < arguments.length; i++) {
      var child = arguments[i];
      if (child === null || child === undefined) continue;
      if (Array.isArray(child)) child.forEach(function (c) { if (c) node.appendChild(c); });
      else if (typeof child === 'string') node.appendChild(document.createTextNode(child));
      else node.appendChild(child);
    }
    return node;
  }

  // The farm plan is the same derivation main.ts writes to board.json: category, chains, TVL
  // and age in, six concrete steps out, each with what it costs and how long it takes.
  function capitalFor(row) {
    if (row.tvl_usd >= 5e9) return 250;
    if (row.tvl_usd >= 1e9) return 150;
    if (row.tvl_usd >= 1e8) return 100;
    return 50;
  }
  function holdDaysFor(age) {
    if (age === null || age === undefined) return 30;
    if (age < 180) return 60;
    if (age < 365) return 45;
    return 30;
  }
  function actionFor(row, capital, chain) {
    var c = (row.category || '').toLowerCase();
    var name = row.name;
    if (c.indexOf('lend') >= 0 || c.indexOf('cdp') >= 0 || c.indexOf('collateral') >= 0) return 'Supply $' + capital + ' of USDC to ' + name + ' on ' + chain + ' and keep the position open.';
    if (c.indexOf('dex') >= 0 || c.indexOf('leveraged farm') >= 0 || c.indexOf('yield aggregator') >= 0) return 'Provide $' + capital + ' of liquidity to ' + name + '\'s main pool on ' + chain + ' and keep the position open.';
    if (c.indexOf('yield') >= 0) return 'Deposit $' + capital + ' of USDC into ' + name + '\'s highest-yield vault on ' + chain + ' and keep the shares.';
    if (c.indexOf('bridge') >= 0) return 'Bridge $' + capital + ' of USDC to ' + chain + ' through ' + name + ' and use the bridged funds in its app.';
    if (c.indexOf('liquid staking') >= 0 || c.indexOf('restak') >= 0) return 'Stake $' + capital + ' of the chain\'s staking asset through ' + name + ' and keep the receipt token.';
    if (c.indexOf('perpetual') >= 0 || c.indexOf('derivative') >= 0 || c.indexOf('options') >= 0) return 'Deposit $' + capital + ' of USDC as margin on ' + name + ' and open one small hedged trade.';
    if (c.indexOf('prediction') >= 0) return 'Fund $' + capital + ' and place one market position on ' + name + '.';
    if (c.indexOf('curator') >= 0 || c.indexOf('allocator') >= 0 || c.indexOf('onchain capital') >= 0) return 'Deposit $' + capital + ' into a ' + name + ' vault on ' + chain + ' and keep the shares.';
    if (c.indexOf('stable') >= 0) return 'Mint or deposit $' + capital + ' of the stable asset through ' + name + ' on ' + chain + '.';
    if (c.indexOf('rwa') >= 0) return 'Mint $' + capital + ' of the protocol\'s yield-bearing asset on ' + chain + ' and hold it.';
    if (c.indexOf('insurance') >= 0) return 'Buy $' + capital + ' of cover from ' + name + ' on ' + chain + ' and keep the policy.';
    if (c.indexOf('staking') >= 0) return 'Stake $' + capital + ' through ' + name + ' on ' + chain + ' and keep the receipt.';
    if (c.indexOf('farm') >= 0) return 'Deposit $' + capital + ' of USDC into ' + name + '\'s main farm on ' + chain + ' and keep the position open.';
    return 'Deposit $' + capital + ' of USDC into ' + name + ' on ' + chain + ' and keep the position open.';
  }
  function farmStepsFor(row) {
    var chain = row.chains && row.chains.length ? row.chains[0] : 'its main chain';
    var capital = capitalFor(row);
    var hold = holdDaysFor(row.age_days);
    var steps = [
      { text: 'Use a fresh wallet that holds only the funds you plan to farm, and keep its seed phrase offline.', cost: 'under $3 of gas for the first transaction', time: '5 minutes' },
      { text: actionFor(row, capital, chain), cost: '$' + capital + ' of capital and about $' + (capital >= 150 ? 8 : 4) + ' of gas', time: '15 minutes to set up' },
      { text: 'Make one qualifying action each week, such as a deposit, a borrow, a swap or a vote.', cost: 'about $2 of gas a week', time: '10 minutes a week' },
      { text: 'Hold the position for at least ' + hold + ' days so the activity is counted in more than one snapshot.', cost: 'the $' + capital + ' stays in the position', time: hold + ' days' },
      { text: 'Before you withdraw, open the protocol\'s own points or rewards page and claim only from the link it publishes.', cost: 'no fee to check, and never pay to claim', time: '10 minutes' },
      { text: 'Write the wallet, the dates and every transaction in a farm log so you can repeat the position or unwind it.', cost: 'nothing but the log', time: '5 minutes' }
    ];
    return steps.map(function (s) { return s.text + ' Cost: ' + s.cost + '. Time: ' + s.time + '.'; });
  }

  function visibleRows() {
    var model = modelOf();
    var multScale = state.sandbox ? state.sandbox.multScale : 1;
    var rows = DATA.rows.map(function (r) {
      var v = impliedOf(r, model, multScale);
      return { row: r, implied: v.implied, multiple: v.multiple, growthMult: v.growthMult, maturity: v.maturity, growth: v.growth };
    });
    if (state.sandbox) rows.sort(function (a, b) { return b.implied - a.implied || (a.row.slug < b.row.slug ? -1 : 1); });
    var q = state.q.trim().toLowerCase();
    return rows.filter(function (x) {
      var r = x.row;
      if (state.category !== 'all' && (r.category || '(no category)') !== state.category) return false;
      if (state.chain !== 'all' && (!r.chains || r.chains.indexOf(state.chain) < 0)) return false;
      if (q && (r.name + ' ' + r.slug + ' ' + (r.category || '')).toLowerCase().indexOf(q) < 0) return false;
      return true;
    });
  }
  function sortRows(rows) {
    var dir = state.dir;
    var key = state.sort;
    var val = function (x) {
      if (key === 'implied') return x.implied;
      if (key === 'tvl') return x.row.tvl_usd;
      if (key === 'growth') return x.row.change_7d === null ? -999 : x.row.change_7d;
      if (key === 'age') return x.row.age_days === null ? -1 : x.row.age_days;
      return x.row.rank;
    };
    return rows.slice().sort(function (a, b) {
      var d = val(a) - val(b);
      return d === 0 ? (a.row.slug < b.row.slug ? -1 : 1) : d * dir;
    });
  }

  function renderDetail(row) {
    var v = impliedOf(row, modelOf(), state.sandbox ? state.sandbox.multScale : 1);
    var steps = farmStepsFor(row);
    var chain = row.chains && row.chains.length ? row.chains.join(', ') : 'n/a';
    var comps = DATA.live.filter(function (l) { return (l.category || '(no category)') === (row.category || '(no category)'); }).slice(0, 3);
    var box = el('section', { class: 'detail', id: 'detail' },
      el('h2', { text: '#' + row.rank + ' ' + row.name }),
      el('p', { class: 'sub', text: (row.category || 'Uncategorized') + ' · ' + chain + ' · TVL ' + fmtUsd(row.tvl_usd) + ' · 7d ' + fmtPct(row.change_7d) + ' · tracked since ' + (row.listed_at || 'unknown') + ' · records no token' }),
      el('div', { class: 'math' },
        el('div', {}, el('b', { text: fmtUsd(row.tvl_usd) }), el('span', { text: 'TVL, the base' })),
        el('div', {}, el('b', { text: '× ' + v.multiple.toFixed(3) }), el('span', { text: 'category multiple (live median mcap / TVL)' })),
        el('div', {}, el('b', { text: '× ' + v.growthMult.toFixed(3) }), el('span', { text: 'growth ' + fmtPct(v.growth) + ' over 7 days' })),
        el('div', {}, el('b', { text: '× ' + v.maturity.toFixed(3) }), el('span', { text: 'maturity, ' + fmtAge(row.age_days) + ' with no token' })),
        el('div', {}, el('b', { text: fmtUsd(v.implied) }), el('span', { text: 'implied value if it issued a token' }))
      ),
      el('h3', { text: 'How to farm it' }),
      el('ol', {}, steps.map(function (s) { return el('li', { text: s }); })),
      comps.length ? el('h3', { text: 'Live priced comps in ' + (row.category || 'this category') }) : null,
      comps.length ? el('table', { class: 'comps' },
        el('tr', {}, el('th', { text: 'Protocol' }), el('th', { text: 'Market cap' }), el('th', { text: 'TVL' }), el('th', { text: 'mcap / TVL' })),
        comps.map(function (l) {
          return el('tr', {}, el('td', { text: l.name }), el('td', { text: fmtUsd(l.mcap_usd) }), el('td', { text: fmtUsd(l.tvl_usd) }), el('td', { text: (l.mcap_usd && l.tvl_usd ? (l.mcap_usd / l.tvl_usd).toFixed(3) : 'n/a') }));
        })) : null
    );
    return box;
  }

  function render() {
    app.innerHTML = '';
    var wrap = el('div', { class: 'wrap' });
    app.appendChild(wrap);
    var cats = {};
    DATA.rows.forEach(function (r) { cats[r.category || '(no category)'] = true; });
    var chains = {};
    DATA.rows.forEach(function (r) { (r.chains || []).forEach(function (c) { chains[c] = true; }); });

    wrap.appendChild(el('header', { class: 'hero' },
      el('div', { class: 'eyebrow', text: 'Token Radar · model ' + DATA.model_version + ' · snapshot ' + DATA.as_of }),
      el('h1', { text: 'Pre-token protocols, ranked by what a token would be worth' }),
      el('p', { class: 'lede', text: 'Every protocol below records no token yet. The board prices each one from the market itself: the median market-cap-to-TVL of live protocols in its category, adjusted for seven-day growth and for how long it has run with no token. A board row is a claim about value, never a promise a token is coming.' }),
      el('div', { class: 'stats' },
        el('div', { class: 'stat' }, el('b', { text: String(DATA.board_size) }), el('span', { text: 'protocols ranked' })),
        el('div', { class: 'stat' }, el('b', { text: String(DATA.watchlist_size) }), el('span', { text: 'on the watchlist' })),
        el('div', { class: 'stat' }, el('b', { text: fmtUsd(DATA.rows[0] ? DATA.rows[0].implied_value_usd : 0) }), el('span', { text: 'top implied value' })),
        el('div', { class: 'stat' }, el('b', { text: DATA.overall_multiple.toFixed(3) }), el('span', { text: 'live market median mcap / TVL' }))
      )
    ));

    var tabs = el('div', { class: 'tabs' },
      el('button', { 'aria-pressed': state.tab === 'pre' ? 'true' : 'false', text: 'Pre-token board (' + DATA.board_size + ')', onclick: function () { state.tab = 'pre'; render(); } }),
      el('button', { 'aria-pressed': state.tab === 'live' ? 'true' : 'false', text: 'Already trading (' + DATA.live_size + ')', onclick: function () { state.tab = 'live'; render(); } })
    );
    wrap.appendChild(tabs);

    if (state.tab === 'live') {
      var liveTable = el('table', { class: 'board' },
        el('caption', { text: 'Live-token protocols by market cap, at the market\u2019s own values. They are the pricing evidence, never board rows.' }),
        el('tr', {}, el('th', { text: 'Protocol' }), el('th', { text: 'Category' }), el('th', { text: 'Chains' }), el('th', { class: 'num', text: 'TVL' }), el('th', { class: 'num', text: 'Market cap' }), el('th', { class: 'num', text: 'mcap / TVL' }), el('th', { class: 'num', text: '7d' })),
        DATA.live.map(function (l) {
          return el('tr', {},
            el('td', { class: 'name' }, el('b', { text: l.name }), el('span', { text: l.slug })),
            el('td', {}, el('span', { class: 'tag', text: l.category || '—' })),
            el('td', { text: (l.chains || []).join(', ') || '—' }),
            el('td', { class: 'num', text: fmtUsd(l.tvl_usd) }),
            el('td', { class: 'num', text: fmtUsd(l.mcap_usd) }),
            el('td', { class: 'num', text: (l.mcap_usd && l.tvl_usd ? (l.mcap_usd / l.tvl_usd).toFixed(3) : 'n/a') }),
            el('td', { class: l.change_7d === null ? 'num' : (l.change_7d >= 0 ? 'num pos' : 'num neg'), text: fmtPct(l.change_7d) }));
        })
      );
      wrap.appendChild(liveTable);
    } else {
      var controls = el('div', { class: 'controls' },
        el('input', { type: 'search', placeholder: 'Search name or slug…', value: state.q, oninput: function (e) { state.q = e.target.value; renderTable(); } }),
        el('label', { text: 'Category ' }, el('select', { onchange: function (e) { state.category = e.target.value; renderTable(); } },
          el('option', { value: 'all', text: 'All categories' }),
          Object.keys(cats).sort().map(function (c) { return el('option', { value: c, selected: state.category === c ? 'selected' : null, text: c }); }))),
        el('label', { text: 'Chain ' }, el('select', { onchange: function (e) { state.chain = e.target.value; renderTable(); } },
          el('option', { value: 'all', text: 'All chains' }),
          Object.keys(chains).sort().map(function (c) { return el('option', { value: c, selected: state.chain === c ? 'selected' : null, text: c }); }))),
        el('span', { class: 'count', id: 'count' })
      );
      wrap.appendChild(controls);
      wrap.appendChild(el('div', { id: 'tablehost' }));
      var sel = DATA.rows.filter(function (r) { return state.selected === r.slug; })[0];
      if (sel) wrap.appendChild(renderDetail(sel));
    }

    // Model and sandbox.
    var modelBox = el('section', { class: 'model' },
      el('h2', { text: 'How the value is calculated' }),
      el('p', { html: 'implied value = TVL × category multiple × growth multiplier × maturity multiplier. The category multiple is the median market-cap-to-TVL of the live protocols in that category (at least five of them, else the whole live market\u2019s median), clamped to [0.05, 1.00]. Growth is the seven-day TVL change clamped to [−50%, +100%] with weight 0.6. Maturity is 0.75 + min(age, 1095 days) / 1095 × 0.25; a protocol with no listing date counts as 365 days. Nothing is priced from its name. Left out of the board are the marks of a wrapped, staked or bridged product of a token that already trades: Bridge, Canonical Bridge, Liquid Staking, Liquid Restaking, Restaked BTC and CEX categories, names carrying a whole word wrapped, staked or staking, names beginning with an exchange\u2019s name, and names ending in a version marker.' }),
      el('div', { class: 'sandbox' },
        el('div', {}, el('label', { text: 'Growth weight', html: 'Growth weight <output id="gw-out">' + (state.sandbox ? state.sandbox.growthWeight.toFixed(2) : DATA.model.growth_weight.toFixed(2)) + '</output>' }),
          el('input', { type: 'range', min: '0', max: '1', step: '0.05', value: String(state.sandbox ? state.sandbox.growthWeight : DATA.model.growth_weight), oninput: function (e) { sandboxOn(); state.sandbox.growthWeight = parseFloat(e.target.value); document.getElementById('gw-out').textContent = state.sandbox.growthWeight.toFixed(2); renderTable(); } })),
        el('div', {}, el('label', { text: 'Category multiples ×', html: 'Category multiples × <output id="ms-out">' + (state.sandbox ? state.sandbox.multScale.toFixed(2) : '1.00') + '</output>' }),
          el('input', { type: 'range', min: '0.5', max: '2', step: '0.05', value: String(state.sandbox ? state.sandbox.multScale : 1), oninput: function (e) { sandboxOn(); state.sandbox.multScale = parseFloat(e.target.value); document.getElementById('ms-out').textContent = state.sandbox.multScale.toFixed(2); renderTable(); } })),
        el('button', { text: 'Reset the model', onclick: function () { state.sandbox = null; render(); } }),
        el('p', { class: 'note', id: 'sandbox-note', text: state.sandbox ? 'Sandbox on: the board below is re-ranked with your constants. The submitted board keeps the model above.' : 'Move a slider to try other constants: the board re-ranks live, and the submitted board is untouched.' })
      ),
      el('h3', { text: 'Category multiples, from the live market' }),
      el('table', { class: 'mult' },
        el('tr', {}, el('th', { text: 'Category' }), el('th', { class: 'num', text: 'Live protocols' }), el('th', { class: 'num', text: 'Multiple' })),
        DATA.multiples.map(function (m) {
          return el('tr', {}, el('td', { text: m.category }), el('td', { class: 'num', text: String(m.live_count) }), el('td', { class: 'num', text: m.multiple.toFixed(3) }));
        })
      )
    );
    wrap.appendChild(modelBox);

    wrap.appendChild(el('footer', {},
      el('p', { text: 'Data: one sealed snapshot of DefiLlama\u2019s public protocol records, fetched ' + DATA.as_of + '. “Records no token” means the record carries no token; it is not proof a protocol has none. Implied values are this radar\u2019s own claims, never prices, and farming any protocol carries the risk of losing the funds you put in.' }),
      el('p', { text: 'Board rows: ' + DATA.board_size + ' pre-token protocols (watchlist ' + DATA.watchlist_size + ' plus every other rankable one). Live set: ' + DATA.live_size + ' protocols that already trade, shown for pricing only.' })
    ));
    app.removeAttribute('aria-busy');

    function sandboxOn() {
      if (!state.sandbox) state.sandbox = { growthWeight: DATA.model.growth_weight, multScale: 1 };
    }
    renderTable();
  }

  function renderTable() {
    var host = document.getElementById('tablehost');
    if (!host) return;
    var rows = sortRows(visibleRows());
    var count = document.getElementById('count');
    if (count) count.textContent = rows.length + ' of ' + DATA.board_size + ' rows' + (state.sandbox ? ' · sandbox' : '');
    var sortMark = function (key) { return state.sort === key ? (state.dir === -1 ? ' ▼' : ' ▲') : ''; };
    var head = function (label, key, cls) {
      return el('th', { class: cls || '', text: label + sortMark(key), onclick: function () {
        if (state.sort === key) state.dir = -state.dir; else { state.sort = key; state.dir = key === 'implied' || key === 'tvl' ? -1 : 1; }
        renderTable();
      } });
    };
    host.innerHTML = '';
    host.appendChild(el('table', { class: 'board' },
      el('caption', { text: 'Ranked by implied value. Click a row for its model maths and farm plan.' }),
      el('tr', {},
        head('#', 'rank', 'num'), head('Protocol', 'rank'), head('Category', 'rank'),
        head('Chains', 'rank'), head('TVL', 'tvl', 'num'), head('7d', 'growth', 'num'),
        head('Age', 'age', 'num'), head('Implied value', 'implied', 'num')),
      rows.slice(0, 120).map(function (x) {
        var r = x.row;
        var shown = state.sandbox ? x.implied : r.implied_value_usd;
        return el('tr', { class: state.selected === r.slug ? 'sel' : null, onclick: function () { state.selected = r.slug; render(); var d = document.getElementById('detail'); if (d) d.scrollIntoView(); } },
          el('td', { class: 'num rank', text: String(state.sandbox ? (rows.indexOf(x) + 1) : r.rank) }),
          el('td', { class: 'name' }, el('b', { text: r.name }), el('span', { text: r.slug })),
          el('td', {}, el('span', { class: 'tag', text: r.category || '—' })),
          el('td', { text: (r.chains || []).slice(0, 2).join(', ') || '—' }),
          el('td', { class: 'num', text: fmtUsd(r.tvl_usd) }),
          el('td', { class: r.change_7d === null ? 'num' : (r.change_7d >= 0 ? 'num pos' : 'num neg'), text: fmtPct(r.change_7d) }),
          el('td', { class: 'num', text: fmtAge(r.age_days) }),
          el('td', { class: 'num value', text: fmtUsd(shown) }));
      })
    ));
    if (rows.length > 120) host.appendChild(el('p', { class: 'count', text: 'Showing the first 120 of ' + rows.length + ' matching rows. Narrow the search or a filter to see the rest.' }));
  }

  // Deep links for screenshots: #/detail/<slug> opens one protocol, #/category/<name> filters.
  function route() {
    var h = window.location.hash || '';
    var m = h.match(/^#\/detail\/([A-Za-z0-9._-]+)$/);
    if (m) { state.selected = m[1]; state.tab = 'pre'; return; }
    var c = h.match(/^#\/category\/(.+)$/);
    if (c) { state.category = decodeURIComponent(c[1]); state.tab = 'pre'; }
  }
  route();
  render();
})();
