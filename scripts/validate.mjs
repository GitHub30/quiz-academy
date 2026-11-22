// 問題データとゲームロジックの検証。CI とローカルで実行する: node scripts/validate.mjs
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { QUESTIONS } from '../js/questions.js';
import {
  DOMAINS, TYPES, prepare, judge, correctLines, speedScore, examAllocation, pickQuestions,
  rankPlayers, makeCpus, simulateCpu, normalizeText, rankOf, scaledScore,
} from '../js/engine.js';

const root = new URL('../', import.meta.url);
let checks = 0;
const ok = (cond, msg) => { checks++; assert.ok(cond, msg); };

// ── 問題データ ──
const ids = new Set();
const texts = new Set();
for (const q of QUESTIONS) {
  const at = `[${q.id}]`;
  ok(/^d[1-5]-\d\d$/.test(q.id), `${at} id の形式`);
  ok(!ids.has(q.id), `${at} id の重複`); ids.add(q.id);
  if (q.t !== 'assoc') { ok(!texts.has(q.q), `${at} 問題文の重複`); texts.add(q.q); }
  ok(Number(q.id[1]) === q.d, `${at} id とドメインの不一致`);
  ok(DOMAINS.some((d) => d.id === q.d), `${at} ドメイン`);
  ok(TYPES[q.t], `${at} 形式 ${q.t}`);
  ok(typeof q.q === 'string' && q.q.length >= 8, `${at} 問題文`);
  ok(typeof q.ex === 'string' && q.ex.length >= 10, `${at} 解説`);
  const uniq = (arr) => new Set(arr).size === arr.length;
  switch (q.t) {
    case 'ox': ok(typeof q.a === 'boolean', `${at} a`); break;
    case 'assoc':
      ok(Array.isArray(q.hints) && q.hints.length === 4 && uniq(q.hints), `${at} hints`);
    // fallthrough
    case 'choice':
      ok(Array.isArray(q.c) && q.c.length === 4 && uniq(q.c), `${at} 選択肢は重複なしの 4 つ`); break;
    case 'multi':
      ok(Array.isArray(q.c) && q.c.length === 4 && uniq(q.c), `${at} 選択肢`);
      ok(Array.isArray(q.a) && q.a.length >= 1 && q.a.length < q.c.length && uniq(q.a) && q.a.every((i) => Number.isInteger(i) && i >= 0 && i < q.c.length), `${at} a`);
      break;
    case 'order': ok(Array.isArray(q.items) && q.items.length >= 3 && q.items.length <= 6 && uniq(q.items), `${at} items`); break;
    case 'match':
      ok(Array.isArray(q.pairs) && q.pairs.length >= 3 && q.pairs.length <= 6, `${at} pairs`);
      ok(uniq(q.pairs.map((p) => p[0])) && uniq(q.pairs.map((p) => p[1])), `${at} pairs の重複`);
      break;
    case 'type':
      ok(Array.isArray(q.a) && q.a.length >= 1 && q.a.every((s) => normalizeText(s) !== '' && s.length <= 40), `${at} a`);
      ok(/^[\x20-\x7e]+$/.test(q.a[0]), `${at} タイピングの正解は半角`);
      break;
    case 'anagram':
      ok(/^[\x21-\x7e]+$/.test(q.a), `${at} 文字パネルは半角`);
      ok(typeof q.a === 'string' && q.a.length >= 4 && q.a.length <= 14 && new Set(q.a).size > 1, `${at} a`);
      break;
  }

  // 正解を与えれば正解、誤答を与えれば不正解と判定されること(シャッフルを変えて複数回)
  for (let k = 0; k < 5; k++) {
    const p = prepare(q);
    let right; let wrong;
    switch (q.t) {
      case 'ox': right = q.a; wrong = !q.a; break;
      case 'choice': case 'assoc':
        right = p.options.findIndex((o) => o.ok); wrong = p.options.findIndex((o) => !o.ok);
        ok(p.options.filter((o) => o.ok).length === 1, `${at} 正解は 1 つ`); break;
      case 'multi':
        right = p.options.map((o, i) => (o.ok ? i : -1)).filter((i) => i >= 0);
        wrong = right.slice(1).concat(p.options.findIndex((o) => !o.ok)); break;
      case 'order':
        right = q.items.map((_, pos) => p.options.findIndex((o) => o.pos === pos));
        wrong = p.options.map((_, i) => i);
        ok(!p.options.every((o, i) => o.pos === i), `${at} 並びが最初から正解`); break;
      case 'match':
        right = p.left.map((l) => p.right.findIndex((r) => r.id === l.id));
        wrong = p.left.map((_, i) => i);
        ok(!p.right.every((r, i) => r.id === i), `${at} 並びが最初から正解`); break;
      case 'type': right = ` ${q.a[0].toUpperCase()} `; wrong = 'zzz'; break;
      case 'anagram':
        right = q.a; wrong = p.tiles.join('');
        ok(p.tiles.slice().sort().join('') === [...q.a].sort().join(''), `${at} タイル`); break;
    }
    ok(judge(p, right) === true, `${at} 正答が正解にならない`);
    ok(judge(p, wrong) === false, `${at} 誤答が正解になる`);
    ok(judge(p, null) === false && judge(p, undefined) === false, `${at} 無回答`);
    ok(correctLines(p).length > 0, `${at} 正解表示`);
  }
}

// ── 問題数・構成 ──
for (const d of DOMAINS) {
  const n = QUESTIONS.filter((q) => q.d === d.id).length;
  ok(n >= 20, `ドメイン${d.id} の問題数が少ない (${n})`);
}
for (const t of Object.keys(TYPES)) ok(QUESTIONS.some((q) => q.t === t), `形式 ${t} の問題がない`);
ok(DOMAINS.reduce((s, d) => s + d.weight, 0) === 100, '配点比率の合計');

// ── ロジック ──
ok(speedScore(false, 1) === 0 && speedScore(true, 0) === 50 && speedScore(true, 1) === 100 && speedScore(true, 9) === 100 && speedScore(true, NaN) === 50, 'speedScore');
for (const total of [10, 20, 40, 60]) {
  const a = examAllocation(total);
  ok(Object.values(a).reduce((s, n) => s + n, 0) === total, `examAllocation(${total})`);
  for (const d of DOMAINS) ok(a[d.id] <= QUESTIONS.filter((q) => q.d === d.id).length || total > 20, '検定の問題数が足りない');
}
ok(scaledScore(15, 20) === 750 && scaledScore(0, 0) === 0, 'scaledScore');
ok(rankOf(0).index === 0 && rankOf(199).index === 0 && rankOf(200).index === 1 && rankOf(1e9).next === null, 'rankOf');
{
  const picked = pickQuestions(QUESTIONS, 10, {}, Math.random, new Set(['d1-01']));
  ok(picked.length === 10 && new Set(picked.map((q) => q.id)).size === 10 && !picked.some((q) => q.id === 'd1-01'), 'pickQuestions');
  const seen = Object.fromEntries(QUESTIONS.slice(5).map((q) => [q.id, 3]));
  const fresh = pickQuestions(QUESTIONS, 5, seen);
  ok(fresh.every((q) => !seen[q.id]), '未出題の問題が優先される');
  ok(pickQuestions(QUESTIONS.slice(0, 3), 10).length === 3, '候補が少ないとき');
}
{
  const cpus = makeCpus(11, 6);
  ok(cpus.length === 11 && new Set(cpus.map((c) => c.name)).size === 11, 'makeCpus');
  const p = prepare(QUESTIONS[0]);
  for (const c of cpus) {
    const r = simulateCpu(c, p);
    ok(r.points === 0 || (r.points >= 50 && r.points <= 100), 'simulateCpu');
  }
  const players = [{ id: 'me', me: true }, ...cpus];
  const ranked = rankPlayers(players, new Map(players.map((pl) => [pl.id, 100])));
  ok(ranked[0].me && ranked.every((r, i) => r.place === i + 1), 'rankPlayers 同点は自分が上');
}

// ── PWA の整合性 ──
const sw = readFileSync(new URL('sw.js', root), 'utf8');
const assets = [...sw.matchAll(/'\.\/([^']+)'/g)].map((m) => m[1]);
ok(assets.length >= 8, 'sw.js のプリキャッシュ一覧');
for (const a of assets) ok(existsSync(new URL(a, root)), `sw.js が存在しないファイルを参照: ${a}`);
for (const f of ['js/app.js', 'js/engine.js', 'js/questions.js', 'css/style.css', 'index.html']) ok(assets.includes(f), `sw.js に ${f} がない`);
const manifest = JSON.parse(readFileSync(new URL('manifest.webmanifest', root), 'utf8'));
for (const icon of manifest.icons) ok(existsSync(new URL(icon.src, root)), `manifest のアイコンがない: ${icon.src}`);
ok(manifest.start_url === './' && manifest.scope === './' && manifest.display === 'standalone', 'manifest');

const byType = Object.keys(TYPES).map((t) => `${TYPES[t].label} ${QUESTIONS.filter((q) => q.t === t).length}`).join(' / ');
console.log(`OK: ${QUESTIONS.length} 問(${byType})、${checks} 項目を検証しました`);
