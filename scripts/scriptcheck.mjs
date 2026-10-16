#!/usr/bin/env node
// 대본 반복 검사 — 새 편 대본이 지난 편들과 같은 말투(이음말·마무리 문장)를 되풀이하는지 본다.
//   npm run script-check -- <편 폴더> [--n 4] [--all <채널 폴더>]
//   예: npm run script-check -- projects/_channel/ep05-coupang-wow
// 같은 폴더의 longform.txt · short*.txt 를, 채널 폴더(기본: 편 폴더의 부모)의 다른 편 대본과 비교해
// 어절 n개(기본 4)가 똑같이 이어지는 구절을 알려 준다. 숫자·고유명사가 같은 건 괜찮지만, 이음말이 같으면 AI 대본처럼 들린다 (ep05, 사용자 지적).
// 편 안에서 되풀이하는 상투어(아래 STOCK)도 따로 알려 준다. 장 번호·정리·CTA·쇼츠 마무리 같은 안내 문장(ALLOW)은 반복해도 된다.
import fs from 'node:fs';
import path from 'node:path';
import {pathToFileURL} from 'node:url';

export const STOCK = ['결론부터 말씀드리면', '나쁜 회사라는 이야기가', '그 계산이 들리려면', '구조가 보이셨다면', '오늘은 그'];
// 어쩔 수 없이 반복되는 안내 문장은 괜찮다 (사용자 결정 2026-10-16): 장 번호(첫 번째, ~입니다) · 정리 · 댓글·다음 편·구독/좋아요/하이프 부탁 · 쇼츠의 '롱폼에서 …'. 억지로 바꾸면 오히려 어색하다
export const ALLOW = /번째|정리하면|댓글|다음 편|구독|좋아요|하이프|눌러|알려 주세요|롱폼에서|롱폼|따라갔습니다|정리했습니다/;

const words = (t) => t.replace(/[^가-힣0-9a-zA-Z%~ \n]/g, ' ').split(/\s+/).filter(Boolean);
export const grams = (text, n) => {
  const w = words(text);
  const s = new Set();
  for (let i = 0; i + n <= w.length; i++) s.add(w.slice(i, i + n).join(' '));
  return s;
};
const readEp = (dir) =>
  fs.existsSync(dir)
    ? fs.readdirSync(dir).filter((f) => /^(longform|short\d+)\.txt$/.test(f)).map((f) => fs.readFileSync(path.join(dir, f), 'utf8')).join('\n')
    : '';
// 숫자만 다른 구절(예: "2025년 기준 세계 1위")은 빼고 이음말 위주로: 어절 절반 이상이 숫자면 건너뜀
const mostlyNumbers = (g) => g.split(' ').filter((w) => /\d/.test(w)).length * 2 >= g.split(' ').length;

/** 새 대본 text 와 지난 편들 {이름: 대본} → [{phrase, eps}] */
export const repeats = (text, others, n = 4) => {
  const mine = grams(text, n);
  const out = [];
  for (const g of mine) {
    if (mostlyNumbers(g) || ALLOW.test(g)) continue;
    const eps = Object.entries(others).filter(([, t]) => grams(t, n).has(g)).map(([k]) => k);
    if (eps.length) out.push({phrase: g, eps});
  }
  return out.sort((a, b) => b.eps.length - a.eps.length);
};

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const args = process.argv.slice(2);
  const dir = args.find((a) => !a.startsWith('--'));
  if (!dir) {
    console.error('사용법: npm run script-check -- <편 폴더> [--n 4] [--all <채널 폴더>]');
    process.exit(1);
  }
  const n = Number(args[args.indexOf('--n') + 1]) || 4;
  const root = args.includes('--all') ? args[args.indexOf('--all') + 1] : path.dirname(path.resolve(dir));
  const me = path.resolve(dir);
  const others = Object.fromEntries(
    fs
      .readdirSync(root)
      .map((d) => path.join(root, d))
      .filter((d) => d !== me && fs.statSync(d).isDirectory())
      .map((d) => [path.basename(d), readEp(d)])
      .filter(([, t]) => t),
  );
  const text = readEp(me);
  const rep = repeats(text, others, n);
  const stock = STOCK.filter((s) => text.includes(s));
  if (!rep.length && !stock.length) {
    console.log(`✅ 지난 ${Object.keys(others).length}편과 겹치는 ${n}어절 구절 없음`);
    process.exit(0);
  }
  for (const r of rep) console.log(`⚠️  "${r.phrase}" — ${r.eps.join(', ')}`);
  for (const s of stock) console.log(`⚠️  상투어 "${s}" — 이 채널에서 이미 여러 번 썼어요. 이 편만의 말로`);
  console.log(`\n${rep.length + stock.length}곳: 숫자·이름이 아니라 이음말·마무리가 같다면 고쳐 쓰세요 (스포 넘김, 장 안의 연결 말, 공정성 한 줄 — 장 번호·CTA·'롱폼에서' 안내는 그대로 둬도 됨).`);
}
