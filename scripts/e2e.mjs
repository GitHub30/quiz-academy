// ブラウザでの通しテスト。全問題を正答して各モードを最後まで遊び、オフライン動作も確かめる。
// 使い方: (python3 -m http.server 8765 &) && node scripts/e2e.mjs [スクリーンショット出力先]
import { createRequire } from 'node:module';
import assert from 'node:assert/strict';
import { QUESTIONS } from '../js/questions.js';

const { chromium } = createRequire(import.meta.url)('playwright');
const BASE = process.env.BASE_URL || 'http://localhost:8765/';
const shots = process.argv[2];
const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
const page = await ctx.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(String(e)));
page.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') errors.push(m.text()); });
page.on('dialog', (d) => d.accept());
const shot = async (name) => { if (shots) await page.screenshot({ path: `${shots}/${name}.png`, fullPage: true }); };
const noOverflow = async (where) => {
  const over = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  assert.ok(over <= 0, `横スクロールが発生: ${where} (+${over}px)`);
};

const seenTypes = new Set();
const answered = new Set();

async function findQuestion() {
  const text = await page.locator('.qtext').innerText();
  const cands = QUESTIONS.filter((q) => q.q === text);
  if (cands.length === 1) return cands[0];
  const hint = (await page.locator('.hints li').first().innerText()).trim();
  const q = cands.find((c) => c.hints && hint.endsWith(c.hints[0]));
  assert.ok(q, `問題が特定できない: ${text}`);
  return q;
}
const optByText = (scope, text) => page.locator(`${scope} .opt`).filter({ has: page.locator('span:last-child', { hasText: new RegExp(`^${text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`) }) });

async function answer({ wrong = false } = {}) {
  await page.waitForSelector('.qtext');
  const q = await findQuestion();
  seenTypes.add(q.t);
  answered.add(q.id);
  if (shots && !answer.shot?.has(q.t)) { (answer.shot ??= new Set()).add(q.t); await shot(`q-${q.t}`); }
  await noOverflow(q.id);
  switch (q.t) {
    case 'ox': await page.click((q.a !== wrong) ? '.ox.maru' : '.ox.batsu'); break;
    case 'choice': case 'assoc': await optByText('.opts', q.c[wrong ? 1 : 0]).click(); break;
    case 'multi':
      for (const i of q.a) await optByText('.opts', q.c[i]).click();
      await page.click('.ok'); break;
    case 'order':
      for (const t of q.items) await optByText('.opts', t).click();
      await page.click('.ok'); break;
    case 'match':
      for (const [l, r] of q.pairs) {
        await page.locator('.mleft').filter({ hasText: l }).first().click();
        await optByText('.match', r).click();
      }
      await page.click('.ok'); break;
    case 'type': await page.fill('.type-input', q.a[0]); await page.keyboard.press('Enter'); break;
    case 'anagram':
      for (const ch of q.a) await page.locator('.tile:not([disabled])').filter({ hasText: new RegExp(`^${ch.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`) }).first().click();
      await page.click('.ok'); break;
  }
  await page.waitForSelector('.result, .exam-score, .qcard:not(:has(.result))');
  return q;
}
async function answerWithFeedback(opts) {
  const q = await answer(opts);
  const mark = await page.locator('.result-mark').innerText({ timeout: 5000 }).catch(async (e) => {
    if (shots) await page.screenshot({ path: `${shots}/FAIL-${q.id}.png`, fullPage: true });
    throw new Error(`${q.id} (${q.t}) で結果が表示されない: ${e.message.split('\n')[0]}`);
  });
  assert.equal(mark, opts?.wrong ? '不正解…' : '正解!', `${q.id} の判定`);
  await noOverflow(`${q.id} 解説`);
  await page.waitForTimeout(420);
  await page.locator('.result .btn.primary').click();
}
const home = async () => { await page.goto(BASE); await page.waitForSelector('.modes'); };

// ── ホーム ──
await home();
await noOverflow('home');
await shot('home');
assert.equal(await page.locator('.mode').count(), 4);

// ── 修練: 全問題を一巡 ──
for (let round = 0; round < 7 && answered.size < QUESTIONS.length; round++) {
  await home();
  await page.locator('.mode').nth(1).click();
  await page.getByRole('button', { name: '20 問' }).click();
  if (round === 0) await shot('practice-config');
  await page.getByRole('button', { name: '修練を始める' }).click();
  for (let i = 0; i < 20; i++) await answerWithFeedback();
  await page.waitForSelector('text=問正解');
}
assert.equal(answered.size, QUESTIONS.length, '全問題が出題される');
assert.equal(seenTypes.size, 8, '全形式が出題される');

// ── 誤答 → 復習リスト ──
await home();
await page.locator('.mode').nth(1).click();
await page.getByRole('button', { name: /^.{0,3}エージェント設計$/ }).click();
await page.getByRole('button', { name: '5 問' }).click();
await page.getByRole('button', { name: '修練を始める' }).click();
let wrongs = 0;
for (let i = 0; i < 5; i++) {
  const text = await page.locator('.chip.type').innerText();
  if (text === '四択' && !wrongs) { await answerWithFeedback({ wrong: true }); wrongs++; } else await answerWithFeedback();
}
await home();
await page.locator('.mode').nth(1).click();
if (wrongs) assert.ok(await page.getByRole('button', { name: '間違えた問題(1)' }).isVisible(), '復習リスト');

// ── 中断 ──
await page.getByRole('button', { name: '修練を始める' }).click();
await page.waitForSelector('.qtext');
await page.getByRole('button', { name: '中断してホームへ戻る' }).click();
await page.waitForSelector('.modes');

// ── トーナメント(全問正解で勝ち進む) ──
await page.locator('.mode').nth(0).click();
await shot('tournament-intro');
for (const n of [5, 5, 6]) {
  await page.getByRole('button', { name: '始める', exact: true }).click();
  for (let i = 0; i < n; i++) {
    if (n === 5 && i === 0) { await answer(); await shot(`tournament-feedback`); await page.waitForTimeout(420); await page.locator('.result .btn.primary').click(); } else await answerWithFeedback();
  }
  if (n === 5) { await page.waitForSelector('text=位で通過'); await shot('tournament-round'); await page.locator('.btn.primary').click(); }
}
await page.waitForSelector('text=トーナメント結果');
await noOverflow('tournament result');
await shot('tournament-result');
assert.match(await page.locator('.round-name').innerText(), /優勝|決勝 \d 位/);

// ── 模擬検定(全問正解 → 1000 点) ──
await home();
await page.locator('.mode').nth(2).click();
await shot('exam-intro');
await page.getByRole('button', { name: '検定を始める' }).click();
for (let i = 0; i < 20; i++) await answer();
await page.waitForSelector('.exam-score');
assert.match(await page.locator('.exam-score').innerText(), /^1000/);
await noOverflow('exam result');
await shot('exam-result');

// ── 成績 ──
await home();
await page.locator('.mode').nth(3).click();
await page.waitForSelector('.stats');
await noOverflow('stats');
await shot('stats');
await page.fill('.type-input', '<img src=x onerror=alert(1)>');
await page.getByRole('button', { name: '名前を保存' }).click();
await home();
assert.equal(await page.locator('.hero-sub img').count(), 0, '名前は HTML として解釈されない');
assert.ok((await page.locator('.hero-sub').innerText()).includes('<img src=x'), '名前は 12 文字に切り詰めて文字として表示');

// ── 壊れた保存データでも起動する ──
for (const bad of ['{', 'null', '[]', '{"xp":"x","dom":{"1":{"c":99,"t":-1}},"seen":{"__proto__":1},"wrong":[1,"d1-01","zz"],"name":123}']) {
  await page.evaluate((v) => localStorage.setItem('quizAcademy.v1', v), bad);
  await home();
  await page.locator('.mode').nth(3).click();
  await page.waitForSelector('.stats');
}

// ── オフライン ──
await home();
await page.evaluate(() => navigator.serviceWorker.ready);
await page.reload();
await page.waitForSelector('.modes');
await ctx.setOffline(true);
await page.reload();
await page.waitForSelector('.modes');
await page.locator('.mode').nth(1).click();
await page.getByRole('button', { name: '5 問' }).click();
await page.getByRole('button', { name: '修練を始める' }).click();
await answerWithFeedback();
await ctx.setOffline(false);

// オフライン時の読み込み失敗ログは対象外
const real = errors.filter((e) => !/ERR_INTERNET_DISCONNECTED|Failed to load resource/.test(e));
assert.deepEqual(real, [], 'コンソールエラーなし');
await browser.close();
console.log(`E2E OK: ${answered.size} 問・${seenTypes.size} 形式を通しで確認`);
