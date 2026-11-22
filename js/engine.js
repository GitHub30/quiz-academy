// 純粋なゲームロジック(DOM 非依存)。Node からもテストできる。

export const DOMAINS = [
  { id: 1, short: 'エージェント設計', name: 'エージェントアーキテクチャとオーケストレーション', weight: 27, icon: '🤖', color: '#f5a65b' },
  { id: 2, short: 'ツール / MCP', name: 'ツール設計と MCP 統合', weight: 18, icon: '🔧', color: '#5bc8f5' },
  { id: 3, short: 'Claude Code', name: 'Claude Code の設定とワークフロー', weight: 20, icon: '💻', color: '#8fe388' },
  { id: 4, short: 'プロンプト / 構造化', name: 'プロンプトエンジニアリングと構造化出力', weight: 20, icon: '✍️', color: '#e58cf0' },
  { id: 5, short: 'コンテキスト / 信頼性', name: 'コンテキスト管理と信頼性', weight: 15, icon: '🧠', color: '#f5d55b' },
];

export const TYPES = {
  ox: { label: '○×', time: 15, cpu: 1.08 },
  choice: { label: '四択', time: 30, cpu: 1.0 },
  assoc: { label: '連想', time: 28, cpu: 0.95 },
  multi: { label: '複数選択', time: 35, cpu: 0.8 },
  order: { label: '順番当て', time: 45, cpu: 0.75 },
  match: { label: '線結び', time: 50, cpu: 0.8 },
  type: { label: 'タイピング', time: 35, cpu: 0.7 },
  anagram: { label: '文字パネル', time: 40, cpu: 0.85 },
};

export const RANKS = [
  { xp: 0, name: '見習いプロンプター' },
  { xp: 200, name: 'ツールスミス' },
  { xp: 500, name: 'コンテキストの番人' },
  { xp: 1000, name: 'エージェント使い' },
  { xp: 1800, name: 'オーケストレーター' },
  { xp: 3000, name: 'アーキテクト' },
  { xp: 5000, name: 'グランドアーキテクト' },
];

export function rankOf(xp) {
  let idx = 0;
  for (let i = 0; i < RANKS.length; i++) if (xp >= RANKS[i].xp) idx = i;
  const next = RANKS[idx + 1] || null;
  return {
    index: idx,
    name: RANKS[idx].name,
    next,
    progress: next ? (xp - RANKS[idx].xp) / (next.xp - RANKS[idx].xp) : 1,
  };
}

export function shuffle(arr, rng = Math.random) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

// 元の並びと同じにならないようにシャッフルする(全要素が同一の場合を除く)
function shuffleChanged(arr, same, rng) {
  let out = shuffle(arr, rng);
  for (let i = 0; i < 20 && same(out); i++) out = shuffle(arr, rng);
  if (same(out) && out.length > 1) out = out.slice(1).concat(out[0]);
  return out;
}

export function normalizeText(s) {
  return String(s ?? '')
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[\s`'"“”‘’「」]/g, '');
}

// 問題データを、選択肢をシャッフルした出題用オブジェクトに変換する
export function prepare(q, rng = Math.random) {
  const p = { q, type: q.t, time: TYPES[q.t].time };
  switch (q.t) {
    case 'choice':
    case 'assoc':
      p.options = shuffle(q.c.map((text, i) => ({ text, ok: i === 0 })), rng);
      break;
    case 'multi':
      p.options = shuffle(q.c.map((text, i) => ({ text, ok: q.a.includes(i) })), rng);
      break;
    case 'order':
      p.options = shuffleChanged(
        q.items.map((text, pos) => ({ text, pos })),
        (o) => o.every((x, i) => x.pos === i),
        rng,
      );
      break;
    case 'match':
      p.left = q.pairs.map((pair, id) => ({ text: pair[0], id }));
      p.right = shuffleChanged(
        q.pairs.map((pair, id) => ({ text: pair[1], id })),
        (o) => o.every((x, i) => x.id === i),
        rng,
      );
      break;
    case 'anagram':
      p.tiles = shuffleChanged([...q.a], (o) => o.join('') === q.a, rng);
      break;
    default:
      break;
  }
  return p;
}

/**
 * 解答の判定。answer の形式:
 *  ox: boolean / choice, assoc: 選択肢 index / multi: index 配列
 *  order: 選んだ順の index 配列 / match: 左 index → 右 index の配列
 *  type, anagram: 文字列
 */
export function judge(p, answer) {
  const q = p.q;
  if (answer === null || answer === undefined) return false;
  switch (p.type) {
    case 'ox':
      return typeof answer === 'boolean' && answer === q.a;
    case 'choice':
    case 'assoc':
      return Number.isInteger(answer) && !!p.options[answer] && p.options[answer].ok;
    case 'multi': {
      if (!Array.isArray(answer)) return false;
      const set = new Set(answer);
      return p.options.every((o, i) => o.ok === set.has(i));
    }
    case 'order':
      return (
        Array.isArray(answer) &&
        answer.length === p.options.length &&
        answer.every((idx, i) => p.options[idx] && p.options[idx].pos === i)
      );
    case 'match':
      return (
        Array.isArray(answer) &&
        answer.length === p.left.length &&
        p.left.every((l, i) => p.right[answer[i]] && p.right[answer[i]].id === l.id)
      );
    case 'type': {
      const n = normalizeText(answer);
      return n !== '' && q.a.some((x) => normalizeText(x) === n);
    }
    case 'anagram':
      return typeof answer === 'string' && answer === q.a;
    default:
      return false;
  }
}

// 正解の表示用テキスト(行の配列)
export function correctLines(p) {
  const q = p.q;
  switch (p.type) {
    case 'ox':
      return [q.a ? '○(正しい)' : '×(誤り)'];
    case 'choice':
    case 'assoc':
      return [q.c[0]];
    case 'multi':
      return q.a.map((i) => q.c[i]);
    case 'order':
      return q.items.map((t, i) => `${i + 1}. ${t}`);
    case 'match':
      return q.pairs.map(([l, r]) => `${l} ─ ${r}`);
    case 'type':
      return [q.a[0]];
    case 'anagram':
      return [q.a];
    default:
      return [];
  }
}

// 早く答えるほど高得点。正解で 50〜100 点。
export function speedScore(correct, remainRatio) {
  if (!correct) return 0;
  const r = Math.min(1, Math.max(0, Number(remainRatio) || 0));
  return Math.round(50 + 50 * r);
}

const CPU_NAMES = [
  ['ミナト', '🦊'], ['ソラ', '🐧'], ['カエデ', '🦉'], ['リク', '🐺'], ['ユズ', '🐱'], ['ノア', '🦝'],
  ['ツムギ', '🐰'], ['イブキ', '🦅'], ['アオ', '🐬'], ['ハル', '🐻'], ['レン', '🐯'], ['シオン', '🦎'],
  ['ナギ', '🦢'], ['トワ', '🐢'], ['ヒナタ', '🐥'], ['コハク', '🦌'],
];

export function makeCpus(n, rankIndex = 0, rng = Math.random) {
  const base = 0.42 + Math.min(6, Math.max(0, rankIndex)) * 0.035;
  return shuffle(CPU_NAMES, rng)
    .slice(0, n)
    .map(([name, avatar], i) => ({
      id: `cpu${i}`,
      name,
      avatar,
      skill: Math.min(0.93, base + rng() * 0.32),
      speed: 0.25 + rng() * 0.5,
    }));
}

export function simulateCpu(cpu, p, rng = Math.random) {
  const prob = Math.min(0.97, cpu.skill * TYPES[p.type].cpu);
  const correct = rng() < prob;
  const ratio = Math.min(0.95, Math.max(0.03, cpu.speed + (rng() - 0.5) * 0.4));
  return { correct, ratio, points: speedScore(correct, ratio) };
}

/**
 * 出題選択。出題回数の少ない問題を優先しつつランダムに n 問選ぶ。
 * seen: { [id]: 出題回数 }
 */
export function pickQuestions(pool, n, seen = {}, rng = Math.random, exclude = new Set()) {
  const cands = pool.filter((q) => !exclude.has(q.id));
  const keyed = cands.map((q) => ({ q, k: (Number(seen[q.id]) || 0) + rng() * 0.9 }));
  keyed.sort((a, b) => a.k - b.k);
  return shuffle(keyed.slice(0, n).map((x) => x.q), rng);
}

// 模擬検定: ドメインの配点比率に応じて total 問を配分する(最大剰余法)
export function examAllocation(total) {
  const raw = DOMAINS.map((d) => ({ id: d.id, v: (d.weight / 100) * total }));
  const alloc = raw.map((r) => ({ id: r.id, n: Math.floor(r.v), rem: r.v - Math.floor(r.v) }));
  let left = total - alloc.reduce((s, a) => s + a.n, 0);
  const order = alloc.slice().sort((a, b) => b.rem - a.rem);
  for (let i = 0; left > 0; i = (i + 1) % order.length, left--) order[i].n++;
  return Object.fromEntries(alloc.map((a) => [a.id, a.n]));
}

export function scaledScore(correct, total) {
  return total > 0 ? Math.round((correct / total) * 1000) : 0;
}
export const PASS_SCORE = 720;

// 順位付け(同点は自分が上、その後は元の順)
export function rankPlayers(players, scores) {
  return players
    .map((p, i) => ({ p, i, s: scores.get(p.id) || 0 }))
    .sort((a, b) => b.s - a.s || (b.p.me ? 1 : 0) - (a.p.me ? 1 : 0) || a.i - b.i)
    .map((x, idx) => ({ ...x.p, score: x.s, place: idx + 1 }));
}
