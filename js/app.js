import { QUESTIONS } from './questions.js';
import {
  DOMAINS, TYPES, rankOf, prepare, judge, correctLines, speedScore, makeCpus, simulateCpu,
  pickQuestions, examAllocation, scaledScore, PASS_SCORE, rankPlayers, shuffle,
} from './engine.js';

// ───────────── 小道具 ─────────────
const app = document.getElementById('app');

function h(tag, props, ...children) {
  const el = document.createElement(tag);
  if (props) {
    for (const [k, v] of Object.entries(props)) {
      if (v === null || v === undefined || v === false) continue;
      if (k === 'class') el.className = v;
      else if (k === 'style') el.style.cssText = v;
      else if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
      else if (k === 'disabled' || k === 'checked') el[k] = !!v;
      else el.setAttribute(k, v === true ? '' : String(v));
    }
  }
  for (const c of children.flat(Infinity)) {
    if (c === null || c === undefined || c === false) continue;
    el.append(c instanceof Node ? c : document.createTextNode(String(c)));
  }
  return el;
}

const SVG_NS = 'http://www.w3.org/2000/svg';
function svg(tag, attrs, ...children) {
  const el = document.createElementNS(SVG_NS, tag);
  for (const [k, v] of Object.entries(attrs || {})) el.setAttribute(k, String(v));
  el.append(...children);
  return el;
}

// 学院の案内役「ホゥ教授」(オリジナルのフクロウ)。mood: think / happy / sad
function owl(mood = 'think') {
  const eye = (cx) => {
    if (mood === 'happy') return [svg('path', { d: `M${cx - 9} 60 q9 -12 18 0`, class: 'owl-line' })];
    const dy = mood === 'sad' ? 4 : -2;
    const dx = mood === 'sad' ? 0 : 3;
    return [
      svg('circle', { cx, cy: 58, r: 14, class: 'owl-eye' }),
      svg('circle', { cx: cx + dx, cy: 58 + dy, r: 6, class: 'owl-pupil' }),
      svg('circle', { cx: cx + dx + 2, cy: 56 + dy, r: 2, class: 'owl-eye' }),
    ];
  };
  return svg('svg', { viewBox: '0 0 120 120', class: `owl-svg ${mood}`, 'aria-hidden': 'true' },
    svg('path', { d: 'M28 44 L22 22 L44 36 Z M92 44 L98 22 L76 36 Z', class: 'owl-body' }),
    svg('ellipse', { cx: 60, cy: 72, rx: 40, ry: 42, class: 'owl-body' }),
    svg('ellipse', { cx: 60, cy: 86, rx: 24, ry: 24, class: 'owl-belly' }),
    svg('path', { d: 'M20 70 q-10 22 6 36 q4 -20 -6 -36 Z M100 70 q10 22 -6 36 q-4 -20 6 -36 Z', class: 'owl-wing' }),
    ...eye(44), ...eye(76),
    mood === 'sad' ? svg('path', { d: 'M30 40 l22 6 M90 40 l-22 6', class: 'owl-line' }) : svg('g', {}),
    svg('path', { d: 'M54 66 L66 66 L60 78 Z', class: 'owl-beak' }),
    svg('path', { d: 'M60 8 L100 22 L60 36 L20 22 Z', class: 'owl-cap' }),
    svg('path', { d: 'M40 29 v10 q20 10 40 0 v-10 L60 36 Z', class: 'owl-cap2' }),
    svg('path', { d: 'M100 22 v18', class: 'owl-tassel' }),
    svg('circle', { cx: 100, cy: 42, r: 4, class: 'owl-beak' }));
}

function confetti() {
  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  const colors = ['#f5c451', '#ff8fa3', '#7fd8ff', '#8fe388', '#c9a0ff'];
  const box = h('div', { class: 'confetti', 'aria-hidden': 'true' },
    Array.from({ length: 44 }, (_, i) => h('i', {
      style: `left:${Math.random() * 100}%;background:${colors[i % colors.length]};animation-delay:${(Math.random() * 0.6).toFixed(2)}s;animation-duration:${(1.8 + Math.random() * 1.4).toFixed(2)}s`,
    })));
  document.body.append(box);
  setTimeout(() => box.remove(), 4000);
}

const domainOf = (id) => DOMAINS.find((d) => d.id === id);

// ───────────── 保存データ ─────────────
const KEY = 'quizAcademy.v1';
const QIDS = new Set(QUESTIONS.map((q) => q.id));

function defaults() {
  return {
    name: 'あなた', xp: 0, sound: true,
    tournaments: 0, wins: 0, bestExam: 0, exams: 0,
    dom: Object.fromEntries(DOMAINS.map((d) => [d.id, { c: 0, t: 0 }])),
    seen: {}, wrong: [],
  };
}

const num = (v, min = 0, max = 1e9) => (Number.isFinite(v) ? Math.min(max, Math.max(min, Math.floor(v))) : min);

function sanitize(o) {
  const s = defaults();
  if (!o || typeof o !== 'object') return s;
  if (typeof o.name === 'string' && o.name.trim()) s.name = o.name.trim().slice(0, 12);
  s.xp = num(o.xp);
  s.sound = o.sound !== false;
  s.tournaments = num(o.tournaments);
  s.wins = num(o.wins);
  s.exams = num(o.exams);
  s.bestExam = num(o.bestExam, 0, 1000);
  if (o.dom && typeof o.dom === 'object') {
    for (const d of DOMAINS) {
      const v = o.dom[d.id];
      if (v && typeof v === 'object') {
        const t = num(v.t);
        s.dom[d.id] = { t, c: num(v.c, 0, t) };
      }
    }
  }
  if (o.seen && typeof o.seen === 'object') {
    for (const id of QIDS) if (Object.hasOwn(o.seen, id)) s.seen[id] = num(o.seen[id]);
  }
  if (Array.isArray(o.wrong)) s.wrong = [...new Set(o.wrong.filter((id) => QIDS.has(id)))];
  return s;
}

function loadSave() {
  try {
    return sanitize(JSON.parse(localStorage.getItem(KEY)));
  } catch {
    return defaults();
  }
}
let save = loadSave();
function persist() {
  try {
    localStorage.setItem(KEY, JSON.stringify(save));
  } catch {
    /* 保存できない環境(プライベートモード等)でも遊べるようにする */
  }
}

function recordAnswer(q, correct) {
  save.seen[q.id] = (save.seen[q.id] || 0) + 1;
  const d = save.dom[q.d];
  d.t++;
  if (correct) d.c++;
  const i = save.wrong.indexOf(q.id);
  if (correct && i >= 0) save.wrong.splice(i, 1);
  if (!correct && i < 0) save.wrong.push(q.id);
  persist();
}

// ───────────── 効果音 ─────────────
let actx = null;
function tone(freqs, dur = 0.12, type = 'triangle', gain = 0.06) {
  if (!save.sound) return;
  try {
    actx = actx || new (window.AudioContext || window.webkitAudioContext)();
    if (actx.state === 'suspended') actx.resume();
    let t = actx.currentTime;
    for (const f of freqs) {
      const o = actx.createOscillator();
      const g = actx.createGain();
      o.type = type;
      o.frequency.value = f;
      g.gain.setValueAtTime(gain, t);
      g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
      o.connect(g).connect(actx.destination);
      o.start(t);
      o.stop(t + dur);
      t += dur * 0.85;
    }
  } catch {
    /* 音が出せなくても続行 */
  }
}
const sfx = {
  ok: () => tone([660, 880, 1320], 0.11),
  ng: () => tone([220, 165], 0.2, 'sawtooth', 0.045),
  tap: () => tone([520], 0.04, 'square', 0.025),
  fanfare: () => tone([523, 659, 784, 1047, 1319], 0.16),
};
function celebrate() {
  sfx.fanfare();
  confetti();
}

// ───────────── 画面遷移 ─────────────
// 画面ごとの後始末(タイマー停止など)と、進行中セッションの中断管理
let cleanup = null;
let keyHandler = null;
let sessionToken = 0;

class Aborted extends Error {}

function show(node) {
  if (cleanup) {
    const c = cleanup;
    cleanup = null;
    c();
  }
  keyHandler = null;
  document.body.dataset.d = node.getAttribute('data-d') || '0'; // 背景の色合いを分野に合わせる
  app.replaceChildren(node);
  window.scrollTo(0, 0);
  const focus = node.querySelector('[data-autofocus]');
  if (focus) focus.focus({ preventScroll: true });
}

document.addEventListener('keydown', (e) => {
  // 押しっぱなしの連続入力と、IME 変換確定の Enter(Safari は isComposing が false になる)は無視する
  if (e.repeat || e.isComposing || e.keyCode === 229 || e.ctrlKey || e.metaKey || e.altKey) return;
  if (keyHandler) keyHandler(e);
});

function goHome() {
  sessionToken++; // 進行中のセッションを無効化
  show(homeScreen());
}

// セッション用: 現在のトークンが有効な間だけ進める
function guard(token) {
  if (token !== sessionToken) throw new Aborted();
}

async function runSession(fn) {
  const token = ++sessionToken;
  try {
    await fn(token);
  } catch (e) {
    if (!(e instanceof Aborted)) {
      console.error(e);
      if (token === sessionToken) {
        show(h('div', { class: 'screen' },
          h('div', { class: 'card' }, h('h2', null, 'エラーが発生しました'), h('p', null, String(e && e.message || e))),
          h('button', { class: 'btn primary', onclick: goHome }, 'ホームへ戻る')));
      }
    }
  }
}

// 「次へ」ボタン等を待つ。画面が切り替わったら Aborted で抜ける。
// guardMs: 表示直後の誤操作(解答に使った Enter の押しっぱなし等)で読み飛ばさないための猶予
function waitButton(token, button, guardMs = 0) {
  return new Promise((resolve, reject) => {
    const shownAt = performance.now();
    const done = () => {
      if (performance.now() - shownAt < guardMs) return;
      button.removeEventListener('click', done);
      keyHandler = null;
      cleanup = null;
      resolve();
    };
    button.addEventListener('click', done);
    cleanup = () => reject(new Aborted());
    keyHandler = (e) => {
      if (e.key === 'Enter' && document.activeElement !== button && token === sessionToken) {
        e.preventDefault();
        button.click();
      }
    };
  });
}

// ───────────── ホーム ─────────────
function header(title, { back = true } = {}) {
  return h('header', { class: 'topbar' },
    back ? h('button', { class: 'icon-btn', onclick: goHome, 'aria-label': 'ホームへ戻る' }, '←') : h('span', { class: 'icon-btn ghost' }),
    h('h1', null, title),
    h('button', {
      class: 'icon-btn', 'aria-label': '効果音の切り替え', 'aria-pressed': String(save.sound),
      onclick: (e) => {
        save.sound = !save.sound;
        persist();
        e.currentTarget.textContent = save.sound ? '🔔' : '🔕';
        e.currentTarget.setAttribute('aria-pressed', String(save.sound));
        sfx.tap();
      },
    }, save.sound ? '🔔' : '🔕'));
}

function rankBadge() {
  const r = rankOf(save.xp);
  return h('div', { class: 'rank' },
    h('div', { class: 'rank-row' },
      h('span', { class: 'rank-name' }, r.name),
      h('span', { class: 'rank-xp' }, r.next ? `${save.xp} / ${r.next.xp} XP` : `${save.xp} XP`)),
    h('div', { class: 'bar', role: 'progressbar', 'aria-valuemin': '0', 'aria-valuemax': '100', 'aria-valuenow': String(Math.round(r.progress * 100)), 'aria-label': '次の階級までの進み具合' },
      h('i', { style: `width:${Math.round(r.progress * 100)}%` })),
    r.next ? h('div', { class: 'rank-next' }, `次の階級: ${r.next.name}`) : h('div', { class: 'rank-next' }, '最高位に到達!'));
}

function homeScreen() {
  const modes = [
    ['🏆', '学院トーナメント', '12 人で競う勝ち抜き戦。予選 → 準決勝 → 決勝', () => runSession(tournament)],
    ['📖', '修練(練習)', '分野と問題数を選んで、解説つきでじっくり', () => show(practiceConfig())],
    ['🎓', '模擬検定', '配点比率どおりの 20 問。1000 点満点・720 点で合格', () => runSession(exam)],
    ['📊', '成績と設定', '分野別の正答率・階級・プレイヤー名', () => show(statsScreen())],
  ];
  return h('div', { class: 'screen home' },
    header('', { back: false }),
    h('div', { class: 'logo' }, h('span', { class: 'logo-main' }, 'Quiz Academy'), h('span', { class: 'logo-sub' }, '— Claude 認定 対策クイズ学院 —')),
    h('section', { class: 'hero' },
      h('div', { class: 'owl' }, owl('happy')),
      h('div', null,
        h('p', { class: 'hero-title' }, 'Claude 認定 対策クイズ学院'),
        h('p', { class: 'hero-sub' }, `ようこそ、${save.name} さん。全 ${QUESTIONS.length} 問・8 形式で腕試し。`))),
    rankBadge(),
    h('nav', { class: 'modes' }, modes.map(([icon, title, desc, fn], i) =>
      h('button', { class: `mode m${i}`, onclick: () => { sfx.tap(); fn(); }, 'data-autofocus': i === 0 ? true : null },
        h('span', { class: 'mode-icon', 'aria-hidden': 'true' }, icon),
        h('span', { class: 'mode-text' }, h('b', null, title), h('small', null, desc))))),
    h('p', { class: 'note' },
      '本アプリは非公式のファンメイド学習ツールです。問題は Claude Certified Architect – Foundations の出題分野に沿って独自に作成したもので、実際の試験問題ではありません。'));
}

// ───────────── 出題 ─────────────
/**
 * 1 問を出題し、解答を受け付ける。
 * 戻り値: { correct, ratio(残り時間の割合), timedOut, card, body }
 */
function ask(token, p, { index, total, label, time, scoreText, rivals = [] }) {
  guard(token);
  return new Promise((resolve, reject) => {
    const q = p.q;
    const dom = domainOf(q.d);
    const limit = (time || p.time) * 1000;
    const INPUT_GUARD = 300; // 直前の問題へのダブルタップが次の問題の解答にならないようにする
    const shownAt = performance.now();
    let last = shownAt;
    let elapsed = 0; // タブが裏に回っている間や確認ダイアログ表示中は進めない
    let finished = false;
    let raf = 0;
    const advance = () => {
      const now = performance.now();
      elapsed += Math.min(250, now - last);
      last = now;
    };

    // 円形タイマー
    const R = 25;
    const CIRC = 2 * Math.PI * R;
    const arc = svg('circle', { class: 'ring-arc', cx: 30, cy: 30, r: R, 'stroke-dasharray': CIRC.toFixed(2), transform: 'rotate(-90 30 30)' });
    const timerNum = h('span', { class: 'timer-num', 'aria-hidden': 'true' }, String(Math.ceil(limit / 1000)));
    const timer = h('div', { class: 'timer' },
      svg('svg', { viewBox: '0 0 60 60', 'aria-hidden': 'true' }, svg('circle', { class: 'ring-bg', cx: 30, cy: 30, r: R }), arc),
      timerNum);

    // ライバルの解答状況(解答を済ませるとランプが点く。正誤は自分の解答後に公開)
    const lit = rivals.map(() => false);
    const rivalEls = rivals.map(({ pl }) => h('li', { class: 'rival' },
      h('span', { class: 'rv-av', 'aria-hidden': 'true' }, pl.avatar),
      h('span', { class: 'rv-name' }, pl.name),
      h('span', { class: 'rv-lamp', 'aria-hidden': 'true' }, '…')));
    const strip = rivals.length ? h('ol', { class: 'rivals', 'aria-label': 'ライバル' }, rivalEls) : null;
    const lightUp = (progress) => {
      rivals.forEach((rv, i) => {
        if (lit[i] || progress < 1 - rv.r.ratio) return;
        lit[i] = true;
        rivalEls[i].classList.add('done');
        rivalEls[i].lastChild.textContent = '済';
      });
    };
    const revealRivals = () => {
      rivals.forEach((rv, i) => {
        rivalEls[i].classList.add('done', rv.r.correct ? 'ok' : 'ng');
        rivalEls[i].lastChild.textContent = rv.r.correct ? '○' : '×';
      });
    };

    const mascot = h('div', { class: 'mascot' }, owl('think'));
    const body = h('div', { class: 'answer-area' });
    const card = h('div', { class: 'card qcard', style: `--dc:${dom.color}` },
      h('div', { class: 'qmeta' },
        h('span', { class: 'qno' }, `第 ${index + 1} 問`),
        h('span', { class: 'chip', style: `--c:${dom.color}` }, `${dom.icon} ${dom.short}`),
        h('span', { class: 'chip type' }, TYPES[p.type].label),
        h('span', { class: 'qcount' }, `${index + 1} / ${total}`)),
      h('div', { class: 'qboard' },
        h('p', { class: 'qtext', id: 'qtext', tabindex: '-1' }, q.q),
        timer, mascot),
      body);

    const finish = (answer, timedOut = false) => {
      if (finished) return;
      if (!timedOut && performance.now() - shownAt < INPUT_GUARD) return;
      advance();
      finished = true;
      cancelAnimationFrame(raf);
      cleanup = null;
      keyHandler = null;
      const ratio = timedOut ? 0 : Math.max(0, 1 - elapsed / limit);
      const correct = !timedOut && judge(p, answer);
      for (const el of body.querySelectorAll('button, input')) el.disabled = true;
      timer.classList.add('stopped');
      revealRivals();
      resolve({ correct, ratio, timedOut, card, body, answer, mascot });
    };

    const tick = () => {
      if (finished) return;
      advance();
      const remain = Math.max(0, limit - elapsed);
      const r = remain / limit;
      arc.style.strokeDashoffset = String(CIRC * (1 - r));
      timer.classList.toggle('low', r < 0.25);
      timerNum.textContent = String(Math.ceil(remain / 1000));
      if (remain <= 0) return finish(null, true);
      if (p.type === 'assoc') revealHints(1 - r);
      lightUp(1 - r);
      raf = requestAnimationFrame(tick);
    };

    let revealHints = () => {};
    const ui = buildAnswerUI(p, finish, (fn) => { revealHints = fn; });
    body.append(ui.node);

    show(h('div', { class: `screen play${strip ? ' has-rivals' : ''}`, 'data-d': q.d },
      h('header', { class: 'topbar hud' },
        h('button', {
          class: 'icon-btn', 'aria-label': '中断してホームへ戻る',
          onclick: () => { if (confirm('中断してホームへ戻りますか?')) goHome(); },
        }, '✕'),
        h('h1', null, h('span', { class: 'ribbon' }, label)),
        h('span', { class: 'score-pill' }, scoreText || '')),
      strip,
      card));
    cleanup = () => {
      finished = true;
      cancelAnimationFrame(raf);
      reject(new Aborted());
    };
    keyHandler = ui.onKey || null;
    (ui.focus || card.querySelector('#qtext')).focus({ preventScroll: true });
    raf = requestAnimationFrame(tick);
  });
}

// 形式ごとの解答 UI を組み立てる
function buildAnswerUI(p, finish, setHintRevealer) {
  const okBtn = (label, onclick) => h('button', { class: 'btn primary ok', onclick, disabled: true }, label);

  switch (p.type) {
    case 'ox': {
      const mk = (val, mark, text) => h('button', {
        class: `ox ${val ? 'maru' : 'batsu'}`, 'aria-label': text, onclick: () => finish(val),
      }, h('span', { 'aria-hidden': 'true' }, mark), h('small', null, text));
      return {
        node: h('div', { class: 'ox-row' }, mk(true, '○', '正しい'), mk(false, '×', '誤り')),
        onKey: (e) => {
          const k = e.key.toLowerCase();
          if (k === 'o' || k === '1') finish(true);
          if (k === 'x' || k === '2') finish(false);
        },
      };
    }
    case 'choice':
    case 'assoc': {
      const btns = p.options.map((o, i) => h('button', { class: 'opt', onclick: () => finish(i) },
        h('span', { class: 'key', 'aria-hidden': 'true' }, String(i + 1)), h('span', null, o.text)));
      const nodes = [];
      if (p.type === 'assoc') {
        const hints = p.q.hints.map((t, i) => h('li', { class: i === 0 ? 'on' : '' }, i === 0 ? t : '?'));
        const live = h('span', { class: 'sr-only', 'aria-live': 'polite' }, `ヒント1: ${p.q.hints[0]}`);
        let shown = 1;
        setHintRevealer((progress) => {
          const want = Math.min(hints.length, 1 + Math.floor(progress * hints.length));
          while (shown < want) {
            hints[shown].textContent = p.q.hints[shown];
            hints[shown].classList.add('on');
            live.textContent = `ヒント${shown + 1}: ${p.q.hints[shown]}`;
            shown++;
          }
        });
        nodes.push(h('ol', { class: 'hints', 'aria-label': 'ヒント' }, hints), live);
      }
      nodes.push(h('div', { class: 'opts', role: 'group', 'aria-labelledby': 'qtext' }, btns));
      return {
        node: h('div', null, nodes),
        onKey: (e) => {
          const n = Number(e.key);
          if (n >= 1 && n <= p.options.length) finish(n - 1);
        },
      };
    }
    case 'multi': {
      const picked = new Set();
      const ok = okBtn('これで解答', () => finish([...picked]));
      const btns = p.options.map((o, i) => {
        const b = h('button', { class: 'opt check', 'aria-pressed': 'false', onclick: () => toggle(i) },
          h('span', { class: 'key', 'aria-hidden': 'true' }, '□'), h('span', null, o.text));
        return b;
      });
      function toggle(i) {
        if (picked.has(i)) picked.delete(i); else picked.add(i);
        btns[i].classList.toggle('sel', picked.has(i));
        btns[i].setAttribute('aria-pressed', String(picked.has(i)));
        btns[i].firstChild.textContent = picked.has(i) ? '☑' : '□';
        ok.disabled = picked.size === 0;
        sfx.tap();
      }
      return {
        node: h('div', null, h('p', { class: 'hint-line' }, '当てはまるものをすべて選んで「これで解答」'),
          h('div', { class: 'opts', role: 'group', 'aria-labelledby': 'qtext' }, btns), ok),
        onKey: (e) => {
          const n = Number(e.key);
          if (n >= 1 && n <= p.options.length) toggle(n - 1);
        },
      };
    }
    case 'order': {
      const seq = [];
      const ok = okBtn('これで解答', () => finish(seq.slice()));
      const btns = p.options.map((o, i) => h('button', { class: 'opt', onclick: () => toggle(i) },
        h('span', { class: 'key' }, '・'), h('span', null, o.text)));
      function toggle(i) {
        const at = seq.indexOf(i);
        if (at >= 0) seq.splice(at, 1); else seq.push(i);
        btns.forEach((b, j) => {
          const pos = seq.indexOf(j);
          b.classList.toggle('sel', pos >= 0);
          b.firstChild.textContent = pos >= 0 ? String(pos + 1) : '・';
          b.setAttribute('aria-label', `${p.options[j].text}${pos >= 0 ? `(${pos + 1} 番目に選択中)` : ''}`);
        });
        ok.disabled = seq.length !== p.options.length;
        sfx.tap();
      }
      return {
        node: h('div', null, h('p', { class: 'hint-line' }, '正しい順にタップ(もう一度タップで取り消し)'),
          h('div', { class: 'opts' }, btns), ok),
      };
    }
    case 'match': {
      const link = new Array(p.left.length).fill(-1); // 左 → 右
      let active = 0;
      const ok = okBtn('これで解答', () => finish(link.slice()));
      const lbtns = p.left.map((l, i) => h('button', { class: 'opt mleft', onclick: () => { active = i; paint(); sfx.tap(); } },
        h('span', { class: 'key' }, ''), h('span', null, l.text)));
      const rbtns = p.right.map((r, j) => h('button', { class: 'opt mright', onclick: () => choose(j) },
        h('span', { class: 'key' }, ''), h('span', null, r.text)));
      const LETTERS = 'ABCDEF';
      function choose(j) {
        if (active < 0) return;
        const prev = link.indexOf(j);
        if (prev >= 0) link[prev] = -1;
        link[active] = j;
        const next = link.findIndex((v) => v < 0);
        active = next >= 0 ? next : active;
        paint();
        sfx.tap();
      }
      function paint() {
        lbtns.forEach((b, i) => {
          b.classList.toggle('active', i === active);
          b.classList.toggle('sel', link[i] >= 0);
          b.firstChild.textContent = LETTERS[i];
          b.setAttribute('aria-pressed', String(i === active));
        });
        rbtns.forEach((b, j) => {
          const from = link.indexOf(j);
          b.classList.toggle('sel', from >= 0);
          b.firstChild.textContent = from >= 0 ? LETTERS[from] : '?';
          b.setAttribute('aria-label', `${p.right[j].text}${from >= 0 ? `(${LETTERS[from]} と接続中)` : ''}`);
        });
        ok.disabled = link.some((v) => v < 0);
      }
      paint();
      return {
        node: h('div', null, h('p', { class: 'hint-line' }, '項目(A〜)を選び、対応する説明をタップ'),
          h('div', { class: 'match' },
            h('div', { class: 'opts', role: 'group', 'aria-label': '項目' }, lbtns),
            h('div', { class: 'opts', role: 'group', 'aria-label': '説明' }, rbtns)), ok),
      };
    }
    case 'type': {
      const input = h('input', {
        class: 'type-input', type: 'text', autocomplete: 'off', autocapitalize: 'off', autocorrect: 'off',
        spellcheck: 'false', inputmode: 'text', maxlength: '40', placeholder: '半角で入力', 'aria-labelledby': 'qtext',
      });
      const ok = okBtn('解答する', () => finish(input.value));
      input.addEventListener('input', () => { ok.disabled = input.value.trim() === ''; });
      return {
        node: h('div', null, input, ok),
        focus: input,
        onKey: (e) => {
          if (e.key === 'Enter' && input.value.trim() !== '') finish(input.value);
        },
      };
    }
    case 'anagram': {
      const used = []; // 使ったタイルの index(順番どおり)
      const slots = h('div', { class: 'slots', 'aria-live': 'polite', 'aria-label': '組み立て中の文字' });
      const ok = okBtn('解答する', () => finish(used.map((i) => p.tiles[i]).join('')));
      const tiles = p.tiles.map((ch, i) => h('button', { class: 'tile', onclick: () => { used.push(i); paint(); sfx.tap(); } }, ch));
      const back = h('button', { class: 'btn small', onclick: () => { used.pop(); paint(); } }, '1 文字戻す');
      function paint() {
        slots.replaceChildren(...p.tiles.map((_, k) =>
          h('span', { class: `slot ${k < used.length ? 'filled' : ''}` }, k < used.length ? p.tiles[used[k]] : '')));
        tiles.forEach((t, i) => { t.disabled = used.includes(i); });
        back.disabled = used.length === 0;
        ok.disabled = used.length !== p.tiles.length;
      }
      paint();
      return {
        node: h('div', null, slots, h('div', { class: 'tiles' }, tiles), h('div', { class: 'row' }, back), ok),
        onKey: (e) => {
          if (e.key === 'Backspace') { used.pop(); paint(); return; }
          if (e.key === 'Enter' && !ok.disabled) { ok.click(); return; }
          if (e.key.length !== 1) return;
          // 大文字・小文字が一致するタイルを優先する(CLAUDE.md の D と d など)
          let i = p.tiles.findIndex((ch, idx) => !used.includes(idx) && ch === e.key);
          if (i < 0) i = p.tiles.findIndex((ch, idx) => !used.includes(idx) && ch.toLowerCase() === e.key.toLowerCase());
          if (i >= 0) { used.push(i); paint(); }
        },
      };
    }
    default:
      throw new Error(`未対応の形式: ${p.type}`);
  }
}

// 選択肢に正誤の色を付ける
function markOptions(p, res) {
  const { body, answer } = res;
  if (p.type === 'choice' || p.type === 'assoc' || p.type === 'multi') {
    const picked = new Set(Array.isArray(answer) ? answer : Number.isInteger(answer) ? [answer] : []);
    body.querySelectorAll('.opts .opt').forEach((b, i) => {
      if (p.options[i].ok) b.classList.add('right');
      else if (picked.has(i)) b.classList.add('wrong');
    });
  } else if (p.type === 'ox') {
    body.querySelectorAll('.ox').forEach((b, i) => {
      const val = i === 0;
      if (val === p.q.a) b.classList.add('right');
      else if (answer === val) b.classList.add('wrong');
    });
  }
}

// 解答後の正誤・解説表示。「次へ」が押されるまで待つ。
async function feedback(token, p, res, { points, extra, nextLabel = '次へ' }) {
  guard(token);
  markOptions(p, res);
  res.mascot.replaceChildren(owl(res.correct ? 'happy' : 'sad'));
  res.card.classList.add(res.correct ? 'is-good' : 'is-bad');
  if (res.correct) sfx.ok(); else sfx.ng();
  const next = h('button', { class: 'btn primary', 'data-autofocus': true }, nextLabel);
  const panel = h('div', { class: `result ${res.correct ? 'good' : 'bad'}`, role: 'status' },
    h('div', { class: 'result-head' },
      h('span', { class: 'result-mark' }, res.correct ? '正解!' : res.timedOut ? '時間切れ…' : '不正解…'),
      points !== undefined ? h('span', { class: 'result-pts' }, `+${points} 点`) : null),
    res.correct && (p.type === 'choice' || p.type === 'ox' || p.type === 'assoc') ? null
      : h('div', { class: 'answer-box' }, h('b', null, '正解'), h('ul', null, correctLines(p).map((l) => h('li', null, l)))),
    h('p', { class: 'explain' }, p.q.ex),
    extra || null,
    next);
  res.card.append(panel);
  next.focus({ preventScroll: true });
  panel.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  await waitButton(token, next, 400);
  guard(token);
}

// ───────────── 学院トーナメント ─────────────
const ROUNDS = [
  { name: '予選', n: 5, advance: 8 },
  { name: '準決勝', n: 5, advance: 4 },
  { name: '決勝', n: 6, advance: 0 },
];

function board(ranked, { cut = 0, compact = false } = {}) {
  const rows = [];
  ranked.forEach((r, i) => {
    if (compact && i >= 3 && !r.me) return;
    rows.push(h('li', { class: `${r.me ? 'me' : ''} ${cut && r.place > cut ? 'out' : ''}` },
      h('span', { class: 'place' }, `${r.place}位`),
      h('span', { class: 'who' }, `${r.avatar} ${r.name}`),
      h('span', { class: 'pts' }, `${r.score}`)));
    if (!compact && cut && r.place === cut && i < ranked.length - 1) rows.push(h('li', { class: 'cutline', 'aria-hidden': 'true' }, `── ここまで通過 ──`));
  });
  return h('ol', { class: 'board' }, rows);
}

async function tournament(token) {
  const me = { id: 'me', name: save.name, avatar: '🧑‍🎓', me: true };
  let players = [me, ...makeCpus(11, rankOf(save.xp).index)];
  const used = new Set();
  let totalPoints = 0;
  let placement = players.length;
  const themes = shuffle(DOMAINS).slice(0, 2);

  for (let ri = 0; ri < ROUNDS.length; ri++) {
    const round = ROUNDS[ri];
    const theme = themes[ri] || null; // 決勝は全分野
    const pool = theme ? QUESTIONS.filter((q) => q.d === theme.id) : QUESTIONS;
    const qs = pickQuestions(pool, round.n, save.seen, Math.random, used);
    qs.forEach((q) => used.add(q.id));

    // ラウンド開始
    const go = h('button', { class: 'btn primary', 'data-autofocus': true }, '始める');
    show(h('div', { class: 'screen' },
      header(`学院トーナメント`),
      h('div', { class: 'card center intro' },
        h('div', { class: 'owl big' }, owl('think')),
        h('p', { class: 'round-name' }, round.name),
        h('p', { class: 'round-theme' }, theme ? `${theme.icon} ${theme.name}` : '🌟 全分野総合'),
        h('p', null, round.advance ? `${players.length} 人中 上位 ${round.advance} 人が通過(全 ${round.n} 問)` : `${players.length} 人で優勝を争う(全 ${round.n} 問)`),
        h('ul', { class: 'entrants' }, players.map((pl) => h('li', { class: pl.me ? 'me' : '' }, `${pl.avatar} ${pl.name}`)))),
      go));
    await waitButton(token, go, 400);
    guard(token);

    const scores = new Map(players.map((pl) => [pl.id, 0]));
    for (let i = 0; i < qs.length; i++) {
      const p = prepare(qs[i]);
      const rivals = players.filter((pl) => !pl.me).map((pl) => ({ pl, r: simulateCpu(pl, p) }));
      const res = await ask(token, p, {
        index: i, total: qs.length, label: round.name, scoreText: `${scores.get('me')} 点`, rivals,
      });
      const pts = speedScore(res.correct, res.ratio);
      scores.set('me', scores.get('me') + pts);
      totalPoints += pts;
      let cpuOk = 0;
      for (const { pl, r } of rivals) {
        if (r.correct) cpuOk++;
        scores.set(pl.id, scores.get(pl.id) + r.points);
      }
      recordAnswer(qs[i], res.correct);
      const ranked = rankPlayers(players, scores);
      await feedback(token, p, res, {
        points: pts,
        extra: h('div', { class: 'mini' },
          h('p', { class: 'mini-title' }, `ライバルの正解: ${cpuOk} / ${players.length - 1} 人`),
          board(ranked, { compact: true })),
        nextLabel: i === qs.length - 1 ? '結果を見る' : '次の問題へ',
      });
    }

    const ranked = rankPlayers(players, scores);
    const mine = ranked.find((r) => r.me);
    placement = mine.place;
    const passed = round.advance ? mine.place <= round.advance : false;
    const isFinal = !round.advance;
    if (isFinal || !passed) {
      await finishTournament(token, ranked, { round, placement, totalPoints, isFinal });
      return;
    }
    celebrate();
    const next = h('button', { class: 'btn primary', 'data-autofocus': true }, `${ROUNDS[ri + 1].name}へ進む`);
    show(h('div', { class: 'screen' },
      header(`${round.name} 結果`),
      h('div', { class: 'card center' }, h('p', { class: 'round-name' }, `${mine.place} 位で通過!`)),
      h('div', { class: 'card' }, board(ranked, { cut: round.advance })),
      next));
    await waitButton(token, next, 400);
    guard(token);
    const ids = new Set(ranked.filter((r) => r.place <= round.advance).map((r) => r.id));
    players = players.filter((pl) => ids.has(pl.id));
  }
}

async function finishTournament(token, ranked, { round, placement, totalPoints, isFinal }) {
  guard(token);
  const bonus = isFinal ? [0, 150, 100, 70, 50][placement] || 40 : placement <= 8 ? 25 : 10;
  const gained = Math.round(totalPoints / 10) + bonus;
  const before = rankOf(save.xp);
  save.xp += gained;
  save.tournaments++;
  const won = isFinal && placement === 1;
  if (won) save.wins++;
  persist();
  const after = rankOf(save.xp);
  if (won || after.index > before.index) celebrate();

  const title = won ? '🏆 優勝!' : isFinal ? `決勝 ${placement} 位` : `${round.name}敗退(${placement} 位)`;
  show(h('div', { class: 'screen' },
    header('トーナメント結果'),
    h('div', { class: `card center ${won ? 'gold' : ''}` },
      h('p', { class: 'round-name' }, title),
      h('p', null, `獲得 ${totalPoints} 点 → +${gained} XP`),
      after.index > before.index ? h('p', { class: 'promo' }, `昇格! ${before.name} → ${after.name}`) : null),
    h('div', { class: 'card' }, board(ranked, { cut: round.advance })),
    rankBadge(),
    h('div', { class: 'row' },
      h('button', { class: 'btn primary', 'data-autofocus': true, onclick: () => runSession(tournament) }, 'もう一度挑戦'),
      h('button', { class: 'btn', onclick: goHome }, 'ホームへ'))));
}

// ───────────── 修練(練習) ─────────────
function practiceConfig() {
  let domain = 0; // 0 = 全分野
  let count = 10;
  let wrongOnly = false;
  const info = h('p', { class: 'hint-line' });
  const start = h('button', { class: 'btn primary' }, '修練を始める');

  const pool = () => QUESTIONS.filter((q) => (!domain || q.d === domain) && (!wrongOnly || save.wrong.includes(q.id)));
  const refresh = () => {
    const n = pool().length;
    info.textContent = n ? `対象 ${n} 問から ${Math.min(count, n)} 問を出題します` : '対象の問題がありません';
    start.disabled = n === 0;
  };
  const group = (label, items, get, set) => {
    const btns = items.map(([val, text]) => h('button', {
      class: 'seg', 'aria-pressed': String(get() === val),
      onclick: () => {
        set(val);
        btns.forEach((b, i) => b.setAttribute('aria-pressed', String(items[i][0] === val)));
        refresh();
        sfx.tap();
      },
    }, text));
    return h('fieldset', { class: 'field' }, h('legend', null, label), h('div', { class: 'segs' }, btns));
  };
  start.addEventListener('click', () => {
    const qs = pickQuestions(pool(), count, save.seen);
    runSession((token) => practice(token, qs));
  });
  refresh();

  return h('div', { class: 'screen' },
    header('修練(練習)'),
    h('div', { class: 'card' },
      group('分野', [[0, 'すべて'], ...DOMAINS.map((d) => [d.id, `${d.icon} ${d.short}`])], () => domain, (v) => { domain = v; }),
      group('問題数', [[5, '5 問'], [10, '10 問'], [20, '20 問']], () => count, (v) => { count = v; }),
      group('出題範囲', [[false, 'すべての問題'], [true, `間違えた問題(${save.wrong.length})`]], () => wrongOnly, (v) => { wrongOnly = v; }),
      info),
    start);
}

async function practice(token, qs) {
  let correct = 0;
  let points = 0;
  for (let i = 0; i < qs.length; i++) {
    const p = prepare(qs[i]);
    const res = await ask(token, p, { index: i, total: qs.length, label: '修練', scoreText: `${correct} 問正解` });
    const pts = speedScore(res.correct, res.ratio);
    if (res.correct) correct++;
    points += pts;
    recordAnswer(qs[i], res.correct);
    await feedback(token, p, res, { points: pts, nextLabel: i === qs.length - 1 ? '結果を見る' : '次の問題へ' });
  }
  const gained = Math.round(points / 20);
  const before = rankOf(save.xp);
  save.xp += gained;
  persist();
  const after = rankOf(save.xp);
  if (after.index > before.index) celebrate();
  show(h('div', { class: 'screen' },
    header('修練の結果'),
    h('div', { class: 'card center' },
      h('p', { class: 'round-name' }, `${correct} / ${qs.length} 問正解`),
      h('p', null, `+${gained} XP`),
      after.index > before.index ? h('p', { class: 'promo' }, `昇格! ${before.name} → ${after.name}`) : null),
    rankBadge(),
    h('div', { class: 'row' },
      h('button', { class: 'btn primary', 'data-autofocus': true, onclick: () => show(practiceConfig()) }, 'もう一度'),
      h('button', { class: 'btn', onclick: goHome }, 'ホームへ'))));
}

// ───────────── 模擬検定 ─────────────
const EXAM_TOTAL = 20;

async function exam(token) {
  const alloc = examAllocation(EXAM_TOTAL);
  const go = h('button', { class: 'btn primary', 'data-autofocus': true }, '検定を始める');
  show(h('div', { class: 'screen' },
    header('模擬検定'),
    h('div', { class: 'card' },
      h('p', null, `全 ${EXAM_TOTAL} 問。分野ごとの出題数は本試験の配点比率に合わせています。解説は最後にまとめて表示します。`),
      h('ul', { class: 'alloc' }, DOMAINS.map((d) => h('li', null,
        h('span', null, `${d.icon} ${d.name}`), h('b', null, `${alloc[d.id]} 問(${d.weight}%)`)))),
      h('p', { class: 'hint-line' }, `1000 点満点に換算し、${PASS_SCORE} 点以上で合格。1 問 60 秒。`)),
    go));
  await waitButton(token, go, 400);
  guard(token);

  let qs = [];
  for (const d of DOMAINS) qs = qs.concat(pickQuestions(QUESTIONS.filter((q) => q.d === d.id), alloc[d.id], save.seen));
  qs = shuffle(qs);

  const log = [];
  for (let i = 0; i < qs.length; i++) {
    const p = prepare(qs[i]);
    const res = await ask(token, p, { index: i, total: qs.length, label: '模擬検定', time: 60, scoreText: '' });
    recordAnswer(qs[i], res.correct);
    log.push({ p, correct: res.correct });
  }

  const correct = log.filter((l) => l.correct).length;
  const score = scaledScore(correct, log.length);
  const pass = score >= PASS_SCORE;
  const gained = Math.round(score / 10) + (pass ? 50 : 0);
  const before = rankOf(save.xp);
  save.xp += gained;
  save.exams++;
  save.bestExam = Math.max(save.bestExam, score);
  persist();
  const after = rankOf(save.xp);
  if (pass) celebrate(); else sfx.ng();

  show(h('div', { class: 'screen' },
    header('模擬検定の結果'),
    h('div', { class: `card center ${pass ? 'gold' : ''}` },
      h('p', { class: 'exam-score' }, String(score), h('small', null, ' / 1000')),
      h('p', { class: 'round-name' }, pass ? '合格!' : '不合格…'),
      h('p', null, `${correct} / ${log.length} 問正解(合格ライン ${PASS_SCORE} 点) +${gained} XP`),
      after.index > before.index ? h('p', { class: 'promo' }, `昇格! ${before.name} → ${after.name}`) : null),
    h('div', { class: 'card' }, h('h2', null, '分野別'),
      DOMAINS.map((d) => {
        const items = log.filter((l) => l.p.q.d === d.id);
        const c = items.filter((l) => l.correct).length;
        return meter(`${d.icon} ${d.short}`, c, items.length, d.color);
      })),
    h('div', { class: 'card' }, h('h2', null, '振り返り'),
      log.map((l, i) => h('details', { class: `review ${l.correct ? 'good' : 'bad'}` },
        h('summary', null, `${l.correct ? '○' : '×'} Q${i + 1}. ${l.p.q.q}`),
        h('div', { class: 'answer-box' }, h('b', null, '正解'), h('ul', null, correctLines(l.p).map((t) => h('li', null, t)))),
        h('p', { class: 'explain' }, l.p.q.ex)))),
    h('div', { class: 'row' },
      h('button', { class: 'btn primary', onclick: () => runSession(exam) }, 'もう一度受ける'),
      h('button', { class: 'btn', onclick: goHome }, 'ホームへ'))));
}

function meter(label, c, t, color) {
  const pct = t ? Math.round((c / t) * 100) : 0;
  return h('div', { class: 'meter' },
    h('div', { class: 'meter-row' }, h('span', null, label), h('span', null, t ? `${c} / ${t}(${pct}%)` : '未挑戦')),
    h('div', { class: 'bar' }, h('i', { style: `width:${pct}%;background:${color}` })));
}

// ───────────── 成績と設定 ─────────────
function statsScreen() {
  const total = Object.values(save.dom).reduce((s, d) => s + d.t, 0);
  const correct = Object.values(save.dom).reduce((s, d) => s + d.c, 0);
  const seenCount = QUESTIONS.filter((q) => save.seen[q.id]).length;
  const nameInput = h('input', { class: 'type-input', type: 'text', maxlength: '12', value: save.name, 'aria-label': 'プレイヤー名' });
  const saved = h('span', { class: 'hint-line', role: 'status' });
  return h('div', { class: 'screen' },
    header('成績と設定'),
    rankBadge(),
    h('div', { class: 'card' }, h('h2', null, '戦績'),
      h('dl', { class: 'stats' },
        h('dt', null, '解答数'), h('dd', null, `${total} 問(正解 ${correct})`),
        h('dt', null, '出会った問題'), h('dd', null, `${seenCount} / ${QUESTIONS.length}`),
        h('dt', null, 'トーナメント'), h('dd', null, `${save.tournaments} 回出場・優勝 ${save.wins} 回`),
        h('dt', null, '模擬検定'), h('dd', null, save.exams ? `${save.exams} 回・最高 ${save.bestExam} 点` : '未受験'),
        h('dt', null, '復習リスト'), h('dd', null, `${save.wrong.length} 問`))),
    h('div', { class: 'card' }, h('h2', null, '分野別の正答率'),
      DOMAINS.map((d) => meter(`${d.icon} ${d.short}`, save.dom[d.id].c, save.dom[d.id].t, d.color))),
    h('div', { class: 'card' }, h('h2', null, 'プレイヤー名'),
      nameInput,
      h('div', { class: 'row' },
        h('button', {
          class: 'btn', onclick: () => {
            save.name = nameInput.value.trim().slice(0, 12) || 'あなた';
            nameInput.value = save.name;
            persist();
            saved.textContent = '保存しました';
          },
        }, '名前を保存'), saved)),
    h('div', { class: 'card' }, h('h2', null, 'データ'),
      h('button', {
        class: 'btn danger', onclick: () => {
          if (!confirm('成績と階級をすべて消去します。よろしいですか?')) return;
          try { localStorage.removeItem(KEY); } catch { /* 無視 */ }
          save = defaults();
          show(statsScreen());
        },
      }, '成績をリセット')),
    h('p', { class: 'note' }, 'データはこの端末のブラウザ内にのみ保存されます。'));
}

// ───────────── 起動 ─────────────
show(homeScreen());

if ('serviceWorker' in navigator && (location.protocol === 'https:' || location.hostname === 'localhost' || location.hostname === '127.0.0.1')) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('./sw.js').catch((e) => console.warn('Service Worker を登録できませんでした', e));
  });
}
