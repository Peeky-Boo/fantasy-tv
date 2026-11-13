/*
 * Fantasy TV Alerts engine. Runs in the browser (on the Fire TV, inside PiPup).
 *
 * Every poll it reads the league's matchups (official points, worked out by Sleeper
 * with the league's own scoring rules) and the week's stat lines. When a starter's
 * points move, the change in their stat line says what happened ("34-yd TD catch").
 */
(function (global) {
  'use strict';

  var API = 'https://api.sleeper.app/v1';
  var PHOTO = 'https://sleepercdn.com/content/nfl/players/thumb/';
  var FRIEND_COLOURS = ['#29B6F6', '#FFCA28', '#AB47BC', '#FF7043', '#66BB6A', '#EC407A',
                        '#26C6DA', '#D4E157', '#8D6E63', '#7E57C2', '#FFA726', '#78909C'];
  var NFL_COLOURS = {
    ARI: '#B3264A', ATL: '#C8102E', BAL: '#6A4FC7', BUF: '#1F5BD8', CAR: '#0085CA', CHI: '#C83803',
    CIN: '#FB4F14', CLE: '#FF3C00', DAL: '#2F6FD6', DEN: '#FB4F14', DET: '#0076B6', GB: '#FFB612',
    HOU: '#C8102E', IND: '#2C6FD1', JAX: '#00839C', KC: '#E31837', LV: '#A5ACAF', LAC: '#0080C6',
    LAR: '#FFA300', MIA: '#00A3AD', MIN: '#7B4FC0', NE: '#C60C30', NO: '#D3BC8D', NYG: '#3355CC',
    NYJ: '#18A35E', PHI: '#1A8A8F', PIT: '#FFB612', SF: '#C8102E', SEA: '#69BE28', TB: '#D50A0A',
    TEN: '#4B92DB', WAS: '#B83A3A'
  };
  var IDP = { DL: 1, DE: 1, DT: 1, LB: 1, ILB: 1, OLB: 1, MLB: 1, CB: 1, S: 1, SS: 1, FS: 1, DB: 1, IDP: 1 };
  var RED = '#E53935', GOLD = '#FFC107';

  function getJSON(url) {
    return fetch(url, { cache: 'no-store' }).then(function (r) {
      if (!r.ok) throw new Error('HTTP ' + r.status + ' for ' + url);
      return r.json();
    });
  }
  function r2(x) { return Math.round(x * 100) / 100; }

  // ------------------------------------------------------------------ scoring
  function points(stats, sc) {
    var t = 0;
    for (var k in stats) if (sc[k]) t += stats[k] * sc[k];
    return r2(t);
  }
  function diff(now, before) {
    var d = {}, k;
    for (k in now) if ((now[k] || 0) !== ((before || {})[k] || 0)) d[k] = r2((now[k] || 0) - ((before || {})[k] || 0));
    for (k in before) if (!(k in now) && before[k]) d[k] = -before[k];
    return d;
  }

  function Thresholds(sc) {
    var g = function (k, d) { return (sc[k] === undefined ? d : sc[k]) || 0; };
    this.skillTd = Math.min(g('rush_td', 6), g('rec_td', 6)) || 6;
    this.passTd = g('pass_td', 4) || 4;
    var fg = ['fgm_0_19', 'fgm_20_29', 'fgm_30_39', 'fgm_40_49', 'fgm_50p', 'fgm'].map(function (k) { return g(k, 0); })
      .filter(function (x) { return x > 0; });
    if (!fg.length) fg = [3, 5];
    this.fgLo = Math.min.apply(null, fg) - 0.5;
    this.fgHi = Math.max.apply(null, fg) + 1;
    var idp = ['idp_sack', 'idp_int', 'idp_ff'].map(function (k) { return g(k, 0); }).filter(function (x) { return x > 0; });
    this.idpBig = idp.length ? Math.min.apply(null, idp) + 0.5 : 3.5;
  }

  // What happened, from the change in a player's stat line
  function describe(d, pos, delta, bigPlay) {
    var g = function (k) { return d[k] || 0; };
    var one = function (n, y) { return Math.round(n) === 1 && y > 0 ? Math.round(y) + '-yd ' : ''; };
    if (g('rush_td') > 0) return ['td', '🏈', 'TOUCHDOWN', one(g('rush_att'), g('rush_yd')) + 'rushing TD'];
    if (g('rec_td') > 0) return ['td', '🏈', 'TOUCHDOWN', one(g('rec'), g('rec_yd')) + 'TD catch'];
    if (g('pass_td') > 0) return ['td', '🏈', 'TOUCHDOWN', g('pass_td') > 1 ? g('pass_td') + ' TD passes' : one(g('pass_cmp'), g('pass_yd')) + 'TD pass'];
    if (g('def_td') > 0 || g('idp_def_td') > 0 || g('fum_rec_td') > 0) return ['td', '🛡️', 'DEFENSIVE TOUCHDOWN', ''];
    if (g('def_st_td') > 0 || g('st_td') > 0 || g('pr_td') > 0 || g('kr_td') > 0) return ['td', '🏃', 'RETURN TOUCHDOWN', ''];
    if (g('idp_int') > 0 || g('int') > 0) return ['sack', '🛡️', 'INTERCEPTION', ''];
    if (g('idp_sack') > 0 || g('sack') > 0) return ['sack', '💥', 'SACK', g('idp_sack_yd') > 0 ? Math.round(g('idp_sack_yd')) + '-yd loss' : ''];
    if (g('idp_ff') > 0 || g('ff') > 0) return ['sack', '💥', 'FORCED FUMBLE', ''];
    if (g('idp_fum_rec') > 0 || g('fum_rec') > 0) return ['sack', '🛡️', 'FUMBLE RECOVERY', ''];
    if (g('idp_safe') > 0 || g('safe') > 0) return ['sack', '🛡️', 'SAFETY', ''];
    if (g('fgm') > 0) return ['fg', '🎯', 'FIELD GOAL', g('fgm') === 1 && g('fgm_yds') > 0 ? Math.round(g('fgm_yds')) + '-yd field goal' : (g('fgm') > 1 ? g('fgm') + ' field goals' : '')];
    if (g('pass_2pt') > 0 || g('rush_2pt') > 0 || g('rec_2pt') > 0) return ['big', '✌️', '2-POINT CONVERSION', ''];
    if (g('pass_int') > 0 && delta < 0) return ['turnover', '😬', 'INTERCEPTION THROWN', ''];
    if (g('fum_lost') > 0 && delta < 0) return ['turnover', '😬', 'FUMBLE LOST', ''];
    if (g('fgmiss') > 0 && delta < 0) return ['turnover', '😬', 'MISSED FIELD GOAL', ''];
    if (Math.round(g('rush_att')) === 1 && g('rush_yd') >= 20) return ['big', '⚡', 'BIG PLAY', Math.round(g('rush_yd')) + '-yd run'];
    if (Math.round(g('rec')) === 1 && g('rec_yd') >= 20) return ['big', '⚡', 'BIG PLAY', Math.round(g('rec_yd')) + '-yd catch'];
    if (Math.round(g('pass_cmp')) === 1 && g('pass_yd') >= 30) return ['big', '⚡', 'BIG PLAY', Math.round(g('pass_yd')) + '-yd completion'];
    if (delta >= bigPlay && pos !== 'DEF' && !IDP[pos]) return ['big', '⚡', 'BIG PLAY', ''];
    return null;
  }

  // Fallback when the stat line hasn't caught up yet: guess from the points jump alone
  function guess(pos, delta, th, bigPlay, before) {
    var d = r2(delta);
    if (pos === 'DEF') {
      if (before === 0 && d >= 5) return null;
      if (d >= 5.5) return ['td', '🛡️', 'DEFENSIVE TOUCHDOWN', ''];
      if (d >= 1.8) return ['sack', '🛡️', 'TURNOVER', ''];
      if (d >= 0.8 && d <= 1.4) return ['sack', '💥', 'SACK', ''];
      return null;
    }
    if (IDP[pos]) return d >= th.idpBig ? ['sack', '💥', 'SACK / TAKEAWAY', ''] : null;
    if (pos === 'K') return d >= th.fgLo && d <= th.fgHi ? ['fg', '🎯', 'FIELD GOAL', ''] : null;
    if (pos === 'QB') {
      if (d >= th.passTd + 0.03) return ['td', '🏈', 'TOUCHDOWN', ''];
      if (d <= -0.9) return ['turnover', '😬', 'TURNOVER', ''];
      return d >= bigPlay ? ['big', '⚡', 'BIG PLAY', ''] : null;
    }
    if (d >= th.skillTd + 0.05) return ['td', '🏈', 'TOUCHDOWN', ''];
    if (d <= -0.9) return ['turnover', '😬', 'FUMBLE LOST', ''];
    return d >= bigPlay ? ['big', '⚡', 'BIG PLAY', ''] : null;
  }

  // ------------------------------------------------------------------ simulation
  // Turn a finished week's final stat lines into a pretend live afternoon.
  function rnd(seed) {
    var s = seed || Math.floor(Math.random() * 1e9);
    return function () { s = (s * 1664525 + 1013904223) % 4294967296; return s / 4294967296; };
  }
  function splitInt(total, n, R) {
    if (n <= 0) return [];
    var w = [], sum = 0, i;
    for (i = 0; i < n; i++) { w.push(Math.pow(R(), 2) + 0.05); sum += w[i]; }
    var parts = w.map(function (x) { return Math.floor(total * x / sum); });
    var left = total - parts.reduce(function (a, b) { return a + b; }, 0);
    for (i = 0; left > 0; i = (i + 1) % n, left--) parts[i]++;
    return parts;
  }
  function playerEvents(final, R, steps) {
    var left = {}, k, ev = [];
    for (k in final) if (final[k]) left[k] = final[k];
    function take(k, n) { var v = Math.min(left[k] || 0, n); left[k] = (left[k] || 0) - v; return v; }
    function attempts(nKey, ydKey, extras) {
      var n = Math.round(left[nKey] || 0); if (n <= 0) return;
      var yd = Math.round(left[ydKey] || 0), parts = splitInt(Math.max(0, yd), n, R), list = [];
      if (yd < 0) parts[0] = yd;
      take(nKey, n); take(ydKey, yd);
      for (var i = 0; i < n; i++) { var e = {}; e[nKey] = 1; e[ydKey] = parts[i]; list.push(e); ev.push(e); }
      // touchdowns go with the longest plays, the rest anywhere
      var byLen = list.slice().sort(function (a, b) { return b[ydKey] - a[ydKey]; });
      extras.forEach(function (x) {
        var c = Math.round(left[x] || 0);
        for (var j = 0; j < c; j++) {
          var e = /_td$/.test(x) ? byLen[j % byLen.length] : list[Math.floor(R() * list.length)];
          e[x] = (e[x] || 0) + 1; take(x, 1);
        }
      });
    }
    attempts('rush_att', 'rush_yd', ['rush_td', 'rush_fd', 'rush_2pt']);
    attempts('rec', 'rec_yd', ['rec_td', 'rec_fd', 'rec_2pt', 'bonus_rec_wr', 'bonus_rec_te', 'bonus_rec_rb']);
    attempts('pass_cmp', 'pass_yd', ['pass_td', 'pass_fd', 'pass_2pt']);
    // field goals: one event per kick, with its distance bracket
    var fgm = Math.round(left.fgm || 0);
    if (fgm > 0) {
      var fy = splitInt(Math.round(left.fgm_yds || 0), fgm, R), brackets = [];
      ['fgm_0_19', 'fgm_20_29', 'fgm_30_39', 'fgm_40_49', 'fgm_50_59', 'fgm_50p', 'fgm_60p'].forEach(function (b) {
        for (var j = Math.round(left[b] || 0); j > 0; j--) brackets.push(b);
      });
      var RANGE = { fgm_0_19: [18, 19], fgm_20_29: [20, 29], fgm_30_39: [30, 39], fgm_40_49: [40, 49], fgm_50_59: [50, 56], fgm_50p: [50, 56], fgm_60p: [60, 63] };
      for (var i = 0; i < fgm; i++) {
        var rg = RANGE[brackets[i]];
        var e = { fgm: 1, fgm_yds: rg ? rg[0] + Math.floor(R() * (rg[1] - rg[0] + 1)) : fy[i] };
        if (brackets[i]) { e[brackets[i]] = 1; take(brackets[i], 1); }
        if (brackets[i] === 'fgm_50_59' && left.fgm_50p) { e.fgm_50p = 1; take('fgm_50p', 1); }
        ev.push(e);
      }
      take('fgm', fgm); take('fgm_yds', left.fgm_yds || 0);
    }
    var sacks = Math.floor(left.idp_sack || 0), sackYd = left.idp_sack_yd || 0;
    for (var sk = 0; sk < sacks; sk++) { ev.push({ idp_sack: 1, idp_sack_yd: take('idp_sack_yd', sackYd / sacks) }); take('idp_sack', 1); }
    // everything else: whole units at random moments
    for (k in left) {
      var v = left[k]; if (!v) continue;
      if (Number.isInteger(v) && v > 0 && v < 40) for (var u = 0; u < v; u++) { var e2 = {}; e2[k] = 1; ev.push(e2); }
      else { var e3 = {}; e3[k] = v; ev.push(e3); }
    }
    ev.forEach(function (e) { e._step = 1 + Math.floor(R() * steps); });
    return ev;
  }

  function Simulation(rows, stats, scoring, steps, seed) {
    var R = rnd(seed), self = this;
    this.steps = steps; this.i = 0;
    this.events = {};
    rows.forEach(function (r) {
      (r.starters || []).forEach(function (pid) {
        if (pid && pid !== '0' && !self.events[pid]) self.events[pid] = playerEvents(stats[pid] || {}, R, steps);
      });
    });
    this.rowsTemplate = rows;
    this.scoring = scoring;
  }
  Simulation.prototype.frame = function () {
    var i = this.i, stats = {}, self = this;
    Object.keys(this.events).forEach(function (pid) {
      var s = {};
      self.events[pid].forEach(function (e) {
        if (e._step > i) return;
        for (var k in e) if (k !== '_step') s[k] = (s[k] || 0) + e[k];
      });
      stats[pid] = s;
    });
    var rows = this.rowsTemplate.map(function (r) {
      var pp = {}, tot = 0;
      (r.starters || []).forEach(function (pid) { pp[pid] = points(stats[pid] || {}, self.scoring); tot += pp[pid]; });
      return { roster_id: r.roster_id, matchup_id: r.matchup_id, starters: r.starters, players_points: pp, points: r2(tot) };
    });
    return { rows: rows, stats: stats };
  };
  Simulation.prototype.next = function () { if (this.i < this.steps) this.i++; return this.i >= this.steps; };

  // ------------------------------------------------------------------ engine
  function Engine(cfg, hooks) {
    this.cfg = cfg;
    this.hooks = hooks;
    this.prevPts = {}; this.snaps = {}; this.prevLeader = {};
    this.primed = false; this.players = {}; this.lookups = {};
  }

  Engine.prototype.log = function (m) { if (this.hooks.status) this.hooks.status(m); };

  Engine.prototype.start = function () {
    var self = this, cfg = this.cfg;
    return getJSON(API + '/state/nfl').then(function (state) {
      self.season = cfg.season || state.league_season || state.season;
      self.week = cfg.week || state.display_week || state.week;
      if (cfg.simulate) self.week = cfg.simulate === 'last' ? Math.max(1, (state.week || 2) - 1) : Number(cfg.simulate);
      return getJSON(API + '/user/' + encodeURIComponent(cfg.user));
    }).then(function (u) {
      if (!u) throw new Error('No Sleeper user called ' + cfg.user);
      self.me = u.user_id;
      return getJSON(API + '/user/' + u.user_id + '/leagues/nfl/' + self.season);
    }).then(function (leagues) {
      leagues = leagues || [];
      if (cfg.league) {
        var w = String(cfg.league).toLowerCase();
        leagues = leagues.filter(function (l) { return l.league_id === cfg.league || (l.name || '').toLowerCase().indexOf(w) >= 0; });
      }
      if (!leagues.length) throw new Error('No league found for ' + cfg.user + ' in ' + self.season);
      self.league = leagues[0];
      self.scoring = self.league.scoring_settings || {};
      self.th = new Thresholds(self.scoring);
      var id = self.league.league_id;
      return Promise.all([getJSON(API + '/league/' + id + '/users'), getJSON(API + '/league/' + id + '/rosters'),
                          getJSON(cfg.playersUrl || 'players.json').catch(function () { return {}; })]);
    }).then(function (res) {
      var users = {}, rosters = res[1];
      res[0].forEach(function (u) { users[u.user_id] = u; });
      self.players = res[2] || {};
      self.names = {}; self.colours = {}; self.mine = {};
      rosters.forEach(function (r, i) {
        var o = users[r.owner_id] || {};
        var team = (o.metadata || {}).team_name;
        self.names[r.roster_id] = (cfg.teamNames && team ? team : (o.display_name || team || 'Team ' + r.roster_id)).trim();
        self.colours[r.roster_id] = FRIEND_COLOURS[i % FRIEND_COLOURS.length];
        if (r.owner_id === self.me || (r.co_owners || []).indexOf(self.me) >= 0) self.mine[r.roster_id] = true;
      });
      if (cfg.simulate) {
        return Promise.all([getJSON(API + '/league/' + self.league.league_id + '/matchups/' + self.week),
                            getJSON(API + '/stats/nfl/regular/' + self.season + '/' + self.week)])
          .then(function (x) { self.sim = new Simulation(x[0] || [], x[1] || {}, self.scoring, cfg.steps || 120, cfg.seed); });
      }
    }).then(function () {
      self.log((self.league.name || 'League').trim() + ', week ' + self.week + (cfg.simulate ? ' (practice run)' : ''));
      return self.fetch();
    }).then(function (data) {
      self.announce(data.rows);
      self.process(data);
      self.primed = true;
      self.loop();
    });
  };

  Engine.prototype.fetch = function () {
    if (this.sim) return Promise.resolve(this.sim.frame());
    var id = this.league.league_id;
    return Promise.all([getJSON(API + '/league/' + id + '/matchups/' + this.week),
                        getJSON(API + '/stats/nfl/regular/' + this.season + '/' + this.week).catch(function () { return {}; })])
      .then(function (x) { return { rows: x[0] || [], stats: x[1] || {} }; });
  };

  Engine.prototype.loop = function () {
    var self = this, cfg = this.cfg, fails = 0;
    var wait = (cfg.simulate ? (cfg.speed || 6) : (cfg.interval || 30)) * 1000;
    function tick() {
      var done = false;
      if (self.sim) done = self.sim.next();
      self.fetch().then(function (data) {
        fails = 0;
        self.process(data);
        if (done) { self.scoreboard(data.rows, true); self.log('Practice run finished'); return; }
        setTimeout(tick, wait);
      }).catch(function (e) {
        fails++;
        self.log('Sleeper didn\'t answer (' + e.message + '), trying again');
        setTimeout(tick, Math.min(300000, wait * fails));
      });
    }
    setTimeout(tick, wait);
    if (cfg.board) setInterval(function () { if (self.lastRows) self.scoreboard(self.lastRows); }, cfg.board * 60000);
  };

  // pairs of rows that play each other, your own matchup first
  Engine.prototype.pairs = function (rows) {
    var self = this, out = [], seen = {};
    rows = rows.slice().sort(function (a, b) {
      return (self.mine[a.roster_id] ? 0 : 1) - (self.mine[b.roster_id] ? 0 : 1) || (a.matchup_id || 99) - (b.matchup_id || 99);
    });
    rows.forEach(function (r) {
      var m = r.matchup_id;
      if (m != null && seen[m]) return;
      if (m != null) seen[m] = true;
      var other = m == null ? null : rows.filter(function (x) { return x.matchup_id === m && x.roster_id !== r.roster_id; })[0] || null;
      out.push([r, other]);
    });
    return out;
  };

  Engine.prototype.side = function (r) {
    return { name: this.names[r.roster_id] || 'Team', pts: r2(r.points || 0), colour: this.colours[r.roster_id], mine: !!this.mine[r.roster_id] };
  };
  Engine.prototype.score = function (a, b) { return { a: this.side(a), b: b ? this.side(b) : null }; };

  Engine.prototype.player = function (pid) {
    var p = this.players[pid];
    if (p) return { name: p[0], pos: p[1], team: p[2] };
    if (/^[A-Z]{2,3}$/.test(pid)) return { name: pid + ' D/ST', pos: 'DEF', team: pid };
    var self = this;
    if (!this.lookups[pid]) {  // a player newer than players.json: look them up once
      this.lookups[pid] = true;
      getJSON('https://api.sleeper.com/stats/nfl/player/' + pid + '?season_type=regular&season=' + this.season + '&grouping=week')
        .then(function (w) {
          for (var k in w) {
            var pl = w[k] && w[k].player;
            if (pl) { self.players[pid] = [(pl.first_name + ' ' + pl.last_name).trim(), pl.position || '', pl.team || w[k].team || '']; return; }
          }
        }).catch(function () {});
    }
    return { name: 'Player ' + pid, pos: '', team: '' };
  };

  Engine.prototype.announce = function (rows) {
    var self = this;
    var lines = this.pairs(rows).map(function (p) {
      var s = self.score(p[0], p[1]); s.preview = true; s.mine = s.a.mine || !!(s.b && s.b.mine); return s;
    });
    this.hooks.alert({ kind: 'matchups', emoji: '🏈', colour: GOLD, duration: Math.max(10, 2 * lines.length),
      label: (this.league.name || '').trim() + '  WEEK ' + this.week + (this.cfg.simulate ? ' (PRACTICE)' : ''),
      title: 'This week', lines: lines, mine: true });
  };

  Engine.prototype.board = function (rows) {
    var self = this;
    return { league: (this.league.name || '').trim(), week: this.week, rows: this.pairs(rows).map(function (p) {
      var s = self.score(p[0], p[1]); s.mine = s.a.mine || !!(s.b && s.b.mine); return s;
    }) };
  };

  Engine.prototype.scoreboard = function (rows, final) {
    var b = this.board(rows);
    this.hooks.alert({ kind: 'scores', emoji: '📊', colour: GOLD, label: b.league + '  WEEK ' + b.week + (final ? '  FINAL' : ''),
      lines: b.rows, duration: Math.max(10, 2 * b.rows.length), mine: true });
  };

  Engine.prototype.process = function (data) {
    var self = this, cfg = this.cfg, rows = data.rows, stats = data.stats || {};
    this.lastRows = rows;
    this.pairs(rows).forEach(function (pair) {
      var a = pair[0], b = pair[1];
      var isMine = !!(self.mine[a.roster_id] || (b && self.mine[b.roster_id]));
      var tdsOnly = cfg.tdsOnly || (!isMine && !cfg.everything);
      [[a, b], [b, a]].forEach(function (sides) {
        var row = sides[0], other = sides[1];
        if (!row) return;
        var pp = row.players_points || {};
        (row.starters || []).forEach(function (pid) {
          if (!pid || pid === '0') return;
          var key = row.roster_id + ':' + pid, now = Number(pp[pid] || 0), before = self.prevPts[key];
          var st = stats[pid] || {};
          self.prevPts[key] = now;
          if (!self.primed || before === undefined) { self.snaps[key] = st; return; }
          var delta = r2(now - before);
          if (Math.abs(delta) < 0.05) return;
          var d = diff(st, self.snaps[key]);
          self.snaps[key] = st;
          var pl = self.player(pid);
          // trust the stat line only if it explains the points change
          var hit = Math.abs(points(d, self.scoring) - delta) <= 0.6 ? describe(d, pl.pos, delta, cfg.bigPlay || 3)
                                                                     : guess(pl.pos, delta, self.th, cfg.bigPlay || 3, before);
          if (!hit) return;
          var kind = hit[0];
          if (kind === 'sack' && cfg.sacks === false) return;
          if (tdsOnly && kind !== 'td') return;
          var mineRow = !!self.mine[row.roster_id], oppOfMine = !mineRow && other && self.mine[other.roster_id];
          var sound = kind === 'td' && isMine ? (oppOfMine ? 'boo' : 'td') : null;
          var bad = delta < 0;
          self.hooks.alert({
            kind: kind, emoji: hit[1], label: hit[2], detail: hit[3],
            who: self.names[row.roster_id], colour: self.colours[row.roster_id], good: !bad,
            player: pl.name, pos: pl.pos, nfl: pl.team, nflColour: NFL_COLOURS[pl.team] || '',
            photo: pl.pos && pl.pos !== 'DEF' ? PHOTO + pid + '.jpg' : '',
            delta: delta, score: self.score(a, b), sound: sound, mine: isMine,
            title: hit[2] + ': ' + self.names[row.roster_id]
          });
        });
      });
      // lead changes
      if (b) {
        var m = a.matchup_id, pa = a.points || 0, pb = b.points || 0;
        var leader = pa > pb ? a.roster_id : pb > pa ? b.roster_id : self.prevLeader[m];
        var was = self.prevLeader[m];
        if (self.primed && cfg.leadChanges !== false && was && leader !== was) {
          var lead = leader === a.roster_id ? a : b, trail = lead === a ? b : a;
          var lostMine = self.mine[trail.roster_id];
          self.hooks.alert({
            kind: lostMine ? 'lost' : 'lead', emoji: lostMine ? '⚠️' : '🔥',
            label: lostMine ? self.names[trail.roster_id].toUpperCase() + ' HAS LOST THE LEAD'
                            : self.names[lead.roster_id].toUpperCase() + ' TAKES THE LEAD',
            colour: lostMine ? RED : self.colours[lead.roster_id], good: !lostMine,
            score: self.score(a, b), sound: isMine ? 'lead' : null, mine: isMine
          });
        }
        self.prevLeader[m] = leader;
      }
    });
    if (this.hooks.board) this.hooks.board(this.board(rows));
  };

  // sample alerts for the look (?demo=1)
  function demoAlerts() {
    var sc = function (a, ap, b, bp) {
      return { a: { name: a, pts: ap, colour: '#29B6F6', mine: true }, b: { name: b, pts: bp, colour: '#EC407A' } };
    };
    return [
      { kind: 'td', emoji: '🏈', label: 'TOUCHDOWN', detail: '34-yd TD catch', who: 'You', colour: '#29B6F6', good: true,
        player: "Ja'Marr Chase", pos: 'WR', nfl: 'CIN', nflColour: NFL_COLOURS.CIN, photo: PHOTO + '7564.jpg',
        delta: 9.9, score: sc('You', 74.2, 'Your opponent', 61.0), sound: 'td', mine: true },
      { kind: 'sack', emoji: '💥', label: 'SACK', detail: '8-yd loss', who: 'Your opponent', colour: '#EC407A', good: true,
        player: 'Myles Garrett', pos: 'DE', nfl: 'LAR', nflColour: NFL_COLOURS.LAR, photo: PHOTO + '3973.jpg',
        delta: 9.6, score: sc('You', 74.2, 'Your opponent', 70.6), mine: true },
      { kind: 'td', emoji: '🏈', label: 'TOUCHDOWN', detail: '2-yd rushing TD', who: 'Your opponent', colour: '#EC407A', good: true,
        player: 'Saquon Barkley', pos: 'RB', nfl: 'PHI', nflColour: NFL_COLOURS.PHI, photo: PHOTO + '4866.jpg',
        delta: 6.6, score: sc('You', 74.2, 'Your opponent', 77.2), sound: 'boo', mine: true },
      { kind: 'lost', emoji: '⚠️', label: 'YOU HAVE LOST THE LEAD', colour: RED, good: false,
        score: sc('You', 74.2, 'Your opponent', 77.2), sound: 'lead', mine: true },
      { kind: 'fg', emoji: '🎯', label: 'FIELD GOAL', detail: '52-yd field goal', who: 'You', colour: '#29B6F6', good: true,
        player: 'Trey Smack', pos: 'K', nfl: 'GB', nflColour: NFL_COLOURS.GB, photo: PHOTO + '13545.jpg',
        delta: 5.0, score: sc('You', 79.2, 'Your opponent', 77.2), mine: true }
    ];
  }

  global.FTA = { Engine: Engine, points: points, describe: describe, demoAlerts: demoAlerts, NFL_COLOURS: NFL_COLOURS };
})(window);
