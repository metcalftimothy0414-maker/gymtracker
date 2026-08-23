const fs = require('fs');
const { JSDOM } = require('jsdom');

const html = fs.readFileSync('index.html', 'utf8');

// stub canvas 2d context
const ctxStub = new Proxy({}, { get: (t, k) => {
  if (k === 'canvas') return {};
  if (k === 'measureText') return () => ({ width: 10 });
  if (['fillStyle','strokeStyle','lineWidth','font','globalAlpha'].includes(k)) return '';
  return () => {};
}});

let fails = 0, passes = 0;
function ok(cond, label, extra) {
  if (cond) { passes++; }
  else { fails++; console.log('  FAIL: ' + label + (extra !== undefined ? '  -> ' + extra : '')); }
}

function boot(seed) {
  const dom = new JSDOM(html, {
    runScripts: 'dangerously',
    url: 'https://example.com/gymtracker/',
    pretendToBeVisual: true,
    beforeParse(w) {
      w.HTMLCanvasElement.prototype.getContext = () => ctxStub;
      w.confirm = () => true;
      w.alert = () => {};
      if (seed) seed(w);
    }
  });
  return dom;
}

/* ---------- TEST 1: v1 migration + local-date correctness ---------- */
console.log('\n[1] v1 migration');
{
  const dom = boot(w => {
    // Old-format data. Saturday 2026-08-22 = day 6 -> index 0 is "PUSH-UP MAX TEST"
    w.localStorage.setItem('pushupLog', JSON.stringify([
      { date: '2026-08-01', reps: 30 },
      { date: '2026-08-08', reps: 33 },
      { date: '2026-08-15', reps: 35 },
      { date: '2026-08-22', reps: 38 }
    ]));
    w.localStorage.setItem('checklist_2026-08-22', JSON.stringify({ '0': true, '1': true }));
    w.localStorage.setItem('ankle_2026-08-22', 'true');
  });
  const w = dom.window;
  const S = JSON.parse(w.localStorage.getItem('prt47:v2'));
  ok(S && S.v === 2, 'state written under v2 key');
  ok(S.pushups.length === 4, 'all 4 push-up entries migrated', S.pushups.length);
  const d = S.days['2026-08-22'];
  ok(!!d, 'checklist day migrated');
  ok(d && d.done['PUSH-UP MAX TEST'] === true, 'index 0 mapped to correct exercise name', d && Object.keys(d.done));
  ok(d && d.ready.ankle === 0, 'ankle=true migrated to ankle score 0');
  ok(w.document.getElementById('gBest').textContent === '38', 'gauge shows best set 38', w.document.getElementById('gBest').textContent);
  dom.window.close();
}

/* ---------- TEST 2: local-date keys, never UTC ---------- */
console.log('\n[2] local-date correctness (the v1 bug)');
{
  const dom = boot();
  const w = dom.window;
  const doc = w.document;
  // simulate an 8pm local check-off: jsdom clock is real, so instead assert the helper
  const res = w.eval(`(function(){
    const d = new Date(2026, 7, 22, 21, 30);   // 9:30 PM local, Aug 22
    return { local: iso(d), utc: d.toISOString().slice(0,10) };
  })()`);
  ok(res.local === '2026-08-22', 'iso() uses local calendar date at 9:30 PM', res.local);
  console.log('     local=' + res.local + '  old-code UTC=' + res.utc + (res.local !== res.utc ? '  <-- v1 would have written the wrong day' : ''));
  ok(w.eval('dayDiff("2026-08-22","2026-10-22")') === 61, 'dayDiff spans DST correctly', w.eval('dayDiff("2026-08-22","2026-10-22")'));
  ok(w.eval('addDays("2026-11-01",1)') === '2026-11-02', 'addDays across DST fallback', w.eval('addDays("2026-11-01",1)'));
  ok(w.eval('addDays("2026-02-28",1)') === '2026-03-01', 'addDays across month end', w.eval('addDays("2026-02-28",1)'));
  dom.window.close();
}

/* ---------- TEST 3: regression + projection ---------- */
console.log('\n[3] projection math');
{
  const dom = boot();
  const w = dom.window;
  const r = w.eval('regress([{x:0,y:10},{x:7,y:12},{x:14,y:14},{x:21,y:16}])');
  ok(Math.abs(r.m - (2 / 7)) < 1e-9, 'slope = 2 reps per 7 days', r.m);
  ok(Math.abs(r.b - 10) < 1e-9, 'intercept = 10', r.b);
  ok(Math.abs(r.r2 - 1) < 1e-9, 'perfect fit R2 = 1', r.r2);
  ok(w.eval('regress([{x:0,y:5}])') === null, 'single point returns null');
  ok(w.eval('regress([{x:3,y:5},{x:3,y:9}])') === null, 'zero variance in x returns null');
  dom.window.close();
}

/* ---------- TEST 4: streak semantics ---------- */
console.log('\n[4] streak logic');
{
  const dom = boot();
  const w = dom.window;
  const out = w.eval(`(function(){
    const t = todayISO();
    // build: today untouched (pending), yesterday+ done, rest days empty
    for(let i=1;i<=10;i++){
      const d = addDays(t,-i);
      const prog = progFor(d);
      if(prog.rest) continue;            // deliberately leave rest days empty
      day(d).done[prog.items[0].n] = true;
    }
    const withPending = streakFrom(t);
    // now break it 5 days back on a training day
    let broke = null;
    for(let i=4;i<=8;i++){
      const d = addDays(t,-i);
      if(!progFor(d).rest){ S.days[d].done = {}; broke = i; break; }
    }
    return { withPending, afterBreak: streakFrom(t), broke };
  })()`);
  ok(out.withPending >= 6, 'streak survives untouched today + empty rest days', out.withPending);
  ok(out.afterBreak < out.withPending, 'a missed training day breaks the streak', out.afterBreak + ' vs ' + out.withPending);
  console.log('     streak=' + out.withPending + ' -> broke at day -' + out.broke + ' -> ' + out.afterBreak);
  dom.window.close();
}

/* ---------- TEST 5: set logging, last-time lookup, tonnage ---------- */
console.log('\n[5] set logging + tonnage');
{
  const dom = boot();
  const w = dom.window, doc = w.document;
  const out = w.eval(`(function(){
    // find a Monday so the program has load exercises
    let d = todayISO();
    while(dow(d) !== 1) d = addDays(d,-1);
    const prev = addDays(d,-7);
    day(prev).sets['Machine chest press'] = [{w:120,r:10},{w:120,r:9}];
    day(d).sets['Machine chest press']    = [{w:125,r:10},{w:125,r:8}];
    day(d).done['Machine chest press'] = true;
    save();
    return { d, prev, ton: tonnage(d), last: lastSetsFor('Machine chest press', d) };
  })()`);
  ok(out.ton === 125 * 10 + 125 * 8, 'tonnage = sum(weight x reps)', out.ton);
  ok(out.last && out.last.date === out.prev, 'last-session lookup finds the prior week', out.last && out.last.date);
  ok(w.eval('tonnage(addDays(todayISO(),-400))') === 0, 'empty day tonnage is 0');

  // render that day and click through the UI
  w.eval(`sel = "${out.d}"; renderAll();`);
  const exs = doc.querySelectorAll('#wList .ex');
  ok(exs.length > 0, 'exercises rendered', exs.length);
  const target = [...exs].find(e => e.dataset.n === 'Machine chest press');
  ok(!!target, 'chest press row present');
  ok(target.classList.contains('done'), 'row shows as done');
  target.querySelector('[data-act="expand"]').dispatchEvent(new w.MouseEvent('click', { bubbles: true }));
  const reopened = doc.querySelector('#wList .ex[data-n="Machine chest press"]');
  ok(reopened.classList.contains('open'), 'row expands on tap');
  ok(reopened.querySelectorAll('.sets .pill').length === 2, 'two set pills shown', reopened.querySelectorAll('.sets .pill').length);
  ok(/Last \(/.test(reopened.querySelector('.last').textContent), 'last-session hint rendered');

  // add a set through the form
  const f = reopened.querySelector('.setform');
  f.querySelector('[data-f="w"]').value = '130';
  f.querySelector('[data-f="r"]').value = '6';
  f.querySelector('[data-act="addset"]').dispatchEvent(new w.MouseEvent('click', { bubbles: true }));
  const after = w.eval(`JSON.parse(JSON.stringify(day(sel).sets['Machine chest press']))`);
  ok(after.length === 3 && after[2].w === 130 && after[2].r === 6, 'set added via UI', JSON.stringify(after));
  ok(w.eval('tonnage(sel)') === 125 * 10 + 125 * 8 + 130 * 6, 'tonnage updated after add', w.eval('tonnage(sel)'));

  // delete it again
  const pills = doc.querySelectorAll('#wList .ex[data-n="Machine chest press"] .sets .pill button');
  pills[pills.length - 1].dispatchEvent(new w.MouseEvent('click', { bubbles: true }));
  ok(w.eval(`day(sel).sets['Machine chest press'].length`) === 2, 'set deleted via UI');

  // reject junk input
  const f2 = doc.querySelector('#wList .ex[data-n="Machine chest press"] .setform');
  f2.querySelector('[data-f="w"]').value = '';
  f2.querySelector('[data-f="r"]').value = 'abc';
  f2.querySelector('[data-act="addset"]').dispatchEvent(new w.MouseEvent('click', { bubbles: true }));
  ok(w.eval(`day(sel).sets['Machine chest press'].length`) === 2, 'invalid set rejected');
  dom.window.close();
}

/* ---------- TEST 6: date navigation isolates days ---------- */
console.log('\n[6] date navigation');
{
  const dom = boot();
  const w = dom.window, doc = w.document;
  const start = w.eval('sel');
  doc.getElementById('prevDay').dispatchEvent(new w.MouseEvent('click', { bubbles: true }));
  ok(w.eval('sel') === w.eval(`addDays("${start}",-1)`), 'prev moves back one day', w.eval('sel'));
  ok(doc.getElementById('jumpToday').hidden === false, 'back-to-today appears when off today');
  // tick something on the previous day
  const box = doc.querySelector('#wList .ex .box');
  if (box) box.dispatchEvent(new w.MouseEvent('click', { bubbles: true }));
  const prevDay = w.eval('sel');
  doc.getElementById('jumpToday').dispatchEvent(new w.MouseEvent('click', { bubbles: true }));
  ok(w.eval('sel') === w.eval('todayISO()'), 'jump returns to today');
  ok(doc.getElementById('jumpToday').hidden === true, 'back-to-today hides on today');
  const leaked = w.eval(`Object.keys(day(todayISO()).done).length`);
  ok(leaked === 0 || w.eval(`progFor(todayISO()).rest`), 'yesterday\'s tick did not leak into today', leaked);
  ok(w.eval(`Object.keys(day("${prevDay}").done).length`) > 0, 'yesterday retained its tick');
  dom.window.close();
}

/* ---------- TEST 7: push-up logging writes to the SELECTED date ---------- */
console.log('\n[7] backfilling a past test');
{
  const dom = boot();
  const w = dom.window, doc = w.document;
  w.eval('switchTab("log")');
  w.eval('sel = addDays(todayISO(),-9); renderAll(); renderLog();');
  doc.getElementById('pIn').value = '41';
  doc.getElementById('pSave').dispatchEvent(new w.MouseEvent('click', { bubbles: true }));
  const entry = w.eval(`S.pushups.find(e=>e.date===sel)`);
  ok(entry && entry.reps === 41, 'test saved to the selected past date', JSON.stringify(entry));
  ok(w.eval('bestReps()') === 41, 'PR reflects backfilled entry');
  // overwrite same date
  doc.getElementById('pIn').value = '43';
  doc.getElementById('pSave').dispatchEvent(new w.MouseEvent('click', { bubbles: true }));
  ok(w.eval('S.pushups.length') === 1, 'same date overwrites instead of duplicating', w.eval('S.pushups.length'));
  ok(w.eval('bestReps()') === 43, 'PR updated on overwrite');
  // delete
  doc.querySelector('#pRows button[data-k="p"]').dispatchEvent(new w.MouseEvent('click', { bubbles: true }));
  ok(w.eval('S.pushups.length') === 0, 'entry deleted');
  dom.window.close();
}

/* ---------- TEST 8: calendar ---------- */
console.log('\n[8] calendar');
{
  const dom = boot();
  const w = dom.window, doc = w.document;
  w.eval('switchTab("month")');
  const cells = doc.querySelectorAll('#calGrid .c:not(.blank)');
  const nDays = w.eval(`(function(){const [y,m]=calMonth.split('-').map(Number);return new Date(y,m,0).getDate();})()`);
  ok(cells.length === nDays, 'renders one cell per day of month', cells.length + ' vs ' + nDays);
  ok(doc.querySelectorAll('#calGrid .c.today').length === 1, 'exactly one cell marked today');
  const label = doc.getElementById('mLabel').textContent;
  doc.getElementById('mPrev').dispatchEvent(new w.MouseEvent('click', { bubbles: true }));
  ok(doc.getElementById('mLabel').textContent !== label, 'prev month changes label', doc.getElementById('mLabel').textContent);
  doc.getElementById('mNext').dispatchEvent(new w.MouseEvent('click', { bubbles: true }));
  ok(doc.getElementById('mLabel').textContent === label, 'next month returns');
  // tap a day -> jumps to Today view on that date
  const c = doc.querySelectorAll('#calGrid .c:not(.blank)')[4];
  const want = c.dataset.d;
  c.dispatchEvent(new w.MouseEvent('click', { bubbles: true }));
  ok(w.eval('sel') === want, 'tapping a date selects it', w.eval('sel'));
  ok(doc.getElementById('v-today').classList.contains('on'), 'and switches to the Today view');
  dom.window.close();
}

/* ---------- TEST 9: program editor ---------- */
console.log('\n[9] program editor');
{
  const dom = boot();
  const w = dom.window, doc = w.document;
  w.eval('switchTab("setup"); progDay = 2; renderSetup();');
  doc.getElementById('progTitle').value = 'Back Day';
  doc.getElementById('progText').value = 'Lat pulldown | 5x5 | load\nHang | 3x30s | time\nStretch |  | check';
  doc.getElementById('progSave').dispatchEvent(new w.MouseEvent('click', { bubbles: true }));
  const p = w.eval('JSON.parse(JSON.stringify(S.program[2]))');
  ok(p.title === 'Back Day', 'title saved', p.title);
  ok(p.items.length === 3, 'three items parsed', p.items.length);
  ok(p.items[0].t === 'load' && p.items[1].t === 'time' && p.items[2].t === 'check', 'types parsed', p.items.map(i => i.t).join(','));
  // bad type falls back to load
  doc.getElementById('progText').value = 'Weird | x | banana';
  doc.getElementById('progSave').dispatchEvent(new w.MouseEvent('click', { bubbles: true }));
  ok(w.eval('S.program[2].items[0].t') === 'load', 'unknown type falls back to load');
  // rest toggle
  const before = w.eval('!!S.program[2].rest');
  doc.getElementById('progRest').dispatchEvent(new w.MouseEvent('click', { bubbles: true }));
  ok(w.eval('!!S.program[2].rest') === !before, 'rest day toggles');
  dom.window.close();
}

/* ---------- TEST 10: XSS in user-entered exercise names ---------- */
console.log('\n[10] escaping');
{
  const dom = boot();
  const w = dom.window, doc = w.document;
  w.eval(`
    const d = todayISO();
    S.program[dow(d)] = {title:'<img src=x onerror="window.PWNED=1">', rest:false,
      items:[{n:'<img src=x onerror="window.PWNED=1">', s:'"><script>window.PWNED=1<\\/script>', t:'load'}]};
    save(); sel = d; renderAll();
  `);
  ok(!w.PWNED, 'no script execution from injected exercise name');
  ok(doc.querySelectorAll('#wList img').length === 0, 'no injected img element', doc.querySelectorAll('#wList img').length);
  ok(doc.getElementById('wTitle').textContent.includes('<img'), 'title rendered as literal text');
  dom.window.close();
}

/* ---------- TEST 11: export / import round-trip ---------- */
console.log('\n[11] backup round-trip');
{
  const dom = boot();
  const w = dom.window, doc = w.document;
  w.eval(`
    sel = todayISO();
    S.pushups = [{date:addDays(sel,-7),reps:36},{date:sel,reps:40}];
    S.weight = [{date:sel,lbs:171.5}];
    S.settings.goal = 51; S.settings.target = '2026-11-01';
    day(sel).sets['Thing'] = [{w:100,r:5}];
    save();
  `);
  const snapshot = w.eval('JSON.stringify(S)');
  w.eval('switchTab("setup")');
  doc.getElementById('wipe').dispatchEvent(new w.MouseEvent('click', { bubbles: true }));
  ok(w.eval('S.pushups.length') === 0, 'wipe clears data');
  ok(w.eval('S.settings.goal') === 47, 'wipe restores default goal');
  doc.getElementById('impText').value = snapshot;
  doc.getElementById('impGo').dispatchEvent(new w.MouseEvent('click', { bubbles: true }));
  ok(w.eval('S.pushups.length') === 2, 'restore brings tests back', w.eval('S.pushups.length'));
  ok(w.eval('S.settings.goal') === 51, 'restore brings settings back');
  ok(w.eval(`day(todayISO()).sets['Thing'][0].w`) === 100, 'restore brings sets back');
  ok(w.eval('JSON.stringify(S)') === snapshot, 'round-trip is byte-identical');
  // garbage import is rejected
  doc.getElementById('impText').value = '{"nope":1}';
  doc.getElementById('impGo').dispatchEvent(new w.MouseEvent('click', { bubbles: true }));
  ok(w.eval('S.pushups.length') === 2, 'non-backup JSON rejected');
  doc.getElementById('impText').value = 'not json at all';
  doc.getElementById('impGo').dispatchEvent(new w.MouseEvent('click', { bubbles: true }));
  ok(w.eval('S.pushups.length') === 2, 'invalid JSON rejected');
  dom.window.close();
}

/* ---------- TEST 12: fresh install, empty state ---------- */
console.log('\n[12] empty state');
{
  const dom = boot();
  const w = dom.window, doc = w.document;
  ok(doc.getElementById('gBest').textContent === '\u2014', 'gauge shows dash with no data');
  ok(/two points/.test(doc.getElementById('gVerdict').textContent), 'verdict explains what is needed', doc.getElementById('gVerdict').textContent);
  ok(doc.getElementById('gProj').hidden, 'projection marker hidden');
  w.eval('switchTab("log")');
  ok(/Nothing logged/.test(doc.getElementById('pRows').textContent), 'empty log invites action');
  ok(doc.getElementById('sStreak').textContent === '0', 'streak 0');
  ok(doc.getElementById('sAdhere').textContent === '\u2014', 'adherence dash with nothing due');
  // one entry -> still no projection
  w.eval('S.pushups=[{date:todayISO(),reps:31}]; renderGauge();');
  ok(/One test/.test(doc.getElementById('gVerdict').textContent), 'single test message', doc.getElementById('gVerdict').textContent);
  ok(doc.getElementById('gProj').hidden, 'still no projection with n=1');
  dom.window.close();
}

/* ---------- TEST 13: verdict wording ---------- */
console.log('\n[13] verdict');
{
  const dom = boot();
  const w = dom.window, doc = w.document;
  // on-track: rising fast
  w.eval(`
    S.settings.goal = 47; S.settings.target = addDays(todayISO(), 60);
    S.pushups = [];
    for(let i=6;i>=0;i--) S.pushups.push({date:addDays(todayISO(),-i*7), reps:30 + (6-i)*2});
    renderGauge();
  `);
  let t = doc.getElementById('gVerdict').textContent;
  ok(/clears by/.test(t), 'on-track verdict says clears', t);
  ok(!doc.getElementById('gProj').hidden, 'projection marker visible');
  ok(/reps\/wk/.test(t) && /R\u00b2/.test(t), 'shows rate and R2');
  // off-track: flat
  w.eval(`
    S.pushups = [];
    for(let i=6;i>=0;i--) S.pushups.push({date:addDays(todayISO(),-i*7), reps:30});
    renderGauge();
  `);
  t = doc.getElementById('gVerdict').textContent;
  ok(/short/.test(t), 'flat trend reports a shortfall', t);
  ok(/Needs \+/.test(t), 'states required weekly rate', t);
  dom.window.close();
}

console.log('\n' + '='.repeat(46));
console.log(`  ${passes} passed, ${fails} failed`);
console.log('='.repeat(46) + '\n');
process.exit(fails ? 1 : 0);
