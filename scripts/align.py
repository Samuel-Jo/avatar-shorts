#!/usr/bin/env python3
"""교정된 대본(script.txt)에 음성 인식 단어 타이밍을 붙입니다.

    npm run align -- <이름> [--allow-missing]

입력
  words.raw.json  음성 인식 결과 (시간은 믿고, 글자는 안 믿는다)
  script.txt      Claude 가 교정한 대본. 한 줄 = 자막 한 큐(절 하나)
                    *단어*   → 강조 (강조색)
                    +단어+   → 돈·혜택 (초록)
                    -단어-   → 문제·경고 (빨강)   ※ 한 줄에 강조는 최대 2개
                    > 로 시작 → big 스타일 (훅·결론, 박스 없이 크게)
                    # 로 시작하는 줄은 무시 (메모)
출력
  words.json      교정된 단어 + 시간  [{text, start, end, cue}]
  captions.json   자막 큐            [{start, end, text, emph, style}]

방법: 두 텍스트를 한글 음절 단위로 맞춰 보고(difflib), 맞은 음절의 시간을 가져온다.
      못 맞춘 단어(숫자 표기 차이 등)는 앞뒤 단어 사이로 보간한다.
멈춤: 대본 한 줄(3단어 이상)의 단어가 절반 넘게 소리에 없으면 아무것도 쓰지 않고 멈춘다
      (아바타 도구가 문장을 빼먹음). 일부러 뺀 거면 그 줄을 # 로 막거나 --allow-missing.
"""
from __future__ import annotations

import difflib
import json
import re
import sys
from pathlib import Path

HOLD_LAST = 0.28  # 마지막 큐 유지 시간
MIN_CUE = 0.5
EMPH = [(r"\*(.+?)\*", "key"), (r"\+(.+?)\+", "money"), (r"(?<![\w가-힣])-(.+?)-(?![0-9A-Za-z])", "problem")]  # 뒤에 조사는 OK (-0원-입니다), 2020-2025 같은 범위는 여는 쪽에서 막힘

# 숫자·기호를 소리 나는 대로 비교하기 위한 아주 작은 사전 (정렬용, 화면 글자는 안 바뀜)
READ = {"0": "영", "1": "일", "2": "이", "3": "삼", "4": "사", "5": "오", "6": "육", "7": "칠", "8": "팔", "9": "구",
        "%": "퍼센트", "+": "플러스", "&": "앤"}
# 1+1, 2+1 같은 덤 행사는 영어로 읽는다 ("원 플러스 원")
PLUS_DEAL = re.compile(r"(?<!\d)([1-3])\+([1-3])(?!\d)")
ENG = {"1": "원", "2": "투", "3": "쓰리"}


def norm(s: str) -> str:
    """비교용: 한글·영문·숫자만, 소문자, 숫자는 읽는 소리로"""
    s = s.lower()
    s = PLUS_DEAL.sub(lambda m: f"{ENG[m.group(1)]}플러스{ENG[m.group(2)]}", s)
    s = "".join(READ.get(c, c) for c in s)
    return re.sub(r"[^0-9a-z가-힣]", "", s)


DROP_RUN = 6  # 숫자 표기 차이는 1~2단어씩 못 맞춘다. 이만큼 연달아면 소리에 없는 것 (ep06-long: 아바타 도구가 두 문장을 빼먹음)


def dropped_runs(idx: list[int], min_run: int = DROP_RUN) -> list[list[int]]:
    """못 맞춘 토큰 번호 중 연달아 min_run 개 이상인 묶음"""
    runs, cur = [], []
    for i in idx:
        if cur and i != cur[-1] + 1:
            runs.append(cur)
            cur = []
        cur.append(i)
    if cur:
        runs.append(cur)
    return [r for r in runs if len(r) >= min_run]


# 대본 한 줄이 통째로 소리에 없으면 멈춘다 (ep15-long: AI Studios 가 한 문장을 빼고 첫 낱말 "계약서"만 남김).
# 단어는 글자 절반 이상이 소리와 맞아야 "들림". 들린 단어도, 맞은 글자도 절반 미만이어야 빠진 줄로 본다.
# EP01~15 66개 프로젝트 2,857줄(3단어 이상)을 쟀다. 줄의 여유 = 단어%·글자% 중 큰 쪽 (둘 다 50% 밑이어야 멈추니까).
# 여유가 가장 적은 멀쩡한 줄: ep12-long 33번째 "열 개를 팔아야 1,000원"(← "10개를… 천원") 단어 50%·글자 55% → 55%,
# 그다음 sample01 21번째 "git clone 한 줄로 받아서" 단어 60%·글자 43% → 60%. 빠진 줄은 0~33%.
# ❌ 가 나면 먼저 이 두 줄처럼 숫자·영어 표기 차이 아닌지 보고, 그 시각을 들어서 가른다. 오탐이면 그때 다시 잰다.
MISS_RATIO = 0.5   # 단어·글자 둘 다 이 비율 미만이면 빠진 줄
MISS_MIN_WORDS = 3  # 이보다 짧은 줄("네 번째,")은 우연에 흔들려서 안 본다


def match_tokens(raw: list, cues: list):
    """음성 단어(raw)와 대본 큐를 음절 단위로 맞춘다 → (tokens, 맞은 글자 수, 대본 글자 수).
    tokens: [{text, cue, start, end, hit, n}] — hit = 소리와 맞은 글자 수, n = 비교 글자 수. 못 맞춘 단어는 start None"""
    a_chars, a_time = [], []
    for w in raw:
        n = norm(w["text"])
        if not n:
            continue
        span = max(0.01, w["end"] - w["start"])
        for k, c in enumerate(n):
            a_chars.append(c)
            a_time.append((w["start"] + span * k / len(n), w["start"] + span * (k + 1) / len(n)))

    # 대본 쪽: 글자 → (큐, 토큰)
    b_chars, b_owner, tokens = [], [], []
    for ci, cue in enumerate(cues):
        for tok in cue["tokens"]:
            ti = len(tokens)
            tokens.append({"text": tok, "cue": ci, "start": None, "end": None, "hit": 0, "n": len(norm(tok))})
            for c in norm(tok):
                b_chars.append(c)
                b_owner.append(ti)

    sm = difflib.SequenceMatcher(None, a_chars, b_chars, autojunk=False)
    matched = 0
    for blk in sm.get_matching_blocks():
        for k in range(blk.size):
            ti = b_owner[blk.b + k]
            s, e = a_time[blk.a + k]
            tk = tokens[ti]
            tk["start"] = s if tk["start"] is None else min(tk["start"], s)
            tk["end"] = e if tk["end"] is None else max(tk["end"], e)
            tk["hit"] += 1
            matched += 1
    return tokens, matched, len(b_chars)


def line_stats(cues: list, tokens: list) -> list[dict]:
    """대본 줄마다 들린 단어 수. 단어는 글자 절반 이상이 소리와 맞아야 들린 것"""
    out = []
    for ci, cue in enumerate(cues):
        ts = [t for t in tokens if t["cue"] == ci and t["n"]]
        heard = sum(1 for t in ts if t["hit"] * 2 >= t["n"])
        out.append({"cue": ci, "line": cue.get("line"), "text": cue["text"], "words": len(ts), "heard": heard,
                    "chars": sum(t["n"] for t in ts), "hit": sum(t["hit"] for t in ts),
                    "start": next((t["start"] for t in ts if t["start"] is not None), None)})
    return out


def missing_lines(stats: list[dict]) -> list[dict]:
    """소리에서 (거의) 빠진 대본 줄"""
    return [s for s in stats if s["words"] >= MISS_MIN_WORDS
            and s["heard"] < s["words"] * MISS_RATIO and s["hit"] < s["chars"] * MISS_RATIO]


def parse_script(text: str):
    cues = []
    for no, raw in enumerate(text.splitlines(), 1):
        line = raw.strip()
        if not line or line.startswith("#"):
            continue
        style = "base"
        if line.startswith(">"):
            style, line = "big", line[1:].strip()
        emph = []
        for pat, tone in EMPH:
            for m in re.finditer(pat, line):
                emph.append({"text": m.group(1), "tone": tone, "pos": m.start()})
        clean = line
        for pat, _ in EMPH:
            clean = re.sub(pat, r"\1", clean)
        emph = [{"text": e["text"], "tone": e["tone"]} for e in sorted(emph, key=lambda e: e["pos"])][:2]
        cues.append({"text": clean, "emph": emph, "style": style, "tokens": clean.split(), "line": no})
    return cues


def main():
    args = [a for a in sys.argv[1:] if not a.startswith("--")]
    allow_missing = "--allow-missing" in sys.argv[1:]
    if not args:
        sys.exit("사용법: npm run align -- <이름> [--allow-missing]")
    proj = Path(args[0])
    raw = json.loads((proj / "words.raw.json").read_text(encoding="utf-8"))
    script_p = proj / "script.txt"
    if not script_p.exists():
        sys.exit("script.txt 가 없습니다. transcript.txt 를 교정해서 한 줄에 한 절씩 script.txt 로 저장하세요.")
    cues = parse_script(script_p.read_text(encoding="utf-8"))

    tokens, matched, n_chars = match_tokens(raw, cues)

    # 못 맞춘 토큰 보간
    guessed = []
    guessed_idx = []
    total_end = raw[-1]["end"] if raw else 0
    for i, tk in enumerate(tokens):
        if tk["start"] is not None:
            continue
        prev_end = next((tokens[j]["end"] for j in range(i - 1, -1, -1) if tokens[j]["end"] is not None), 0.0)
        nxt = next((j for j in range(i + 1, len(tokens)) if tokens[j]["start"] is not None), None)
        next_start = tokens[nxt]["start"] if nxt is not None else total_end
        gap_n = (nxt if nxt is not None else len(tokens)) - i + 1
        step = max(0.05, (next_start - prev_end) / gap_n)
        tk["start"] = prev_end + step * 0.1
        tk["end"] = tk["start"] + step * 0.9
        guessed.append(tk["text"])
        guessed_idx.append(i)
    for i in range(1, len(tokens)):  # 단조 증가 보장
        if tokens[i]["start"] < tokens[i - 1]["start"]:
            tokens[i]["start"] = tokens[i - 1]["start"] + 0.01
        tokens[i]["end"] = max(tokens[i]["end"], tokens[i]["start"] + 0.05)

    missing = missing_lines(line_stats(cues, tokens))
    if missing:
        print(("⚠️" if allow_missing else "❌") + f"  대본 {len(missing)}줄이 소리에서 (거의) 안 들립니다 — 아바타 영상에서 문장이 빠졌을 수 있어요:")
        for m in missing:
            at = f"원본 {m['start']:.1f}초 부근" if m["start"] is not None else "시각 모름"
            print(f"   script.txt {m['line']}번째 줄 ({at}, {m['words']}단어 중 {m['heard']}개 들림): {m['text']}")
        if not allow_missing:
            first = next((m["start"] for m in missing if m["start"] is not None), None)
            if first is not None:
                print(f"   들어 보기: ffplay -autoexit -ss {max(0, first - 3):.0f} -t 15 \"{proj / 'input.mp4'}\"")
            print("   → 그 구간을 직접 들어 보세요. 정말 빠졌으면 아바타 영상을 다시 만들거나(빠진 문장만 만들어 이어 붙여도 됨),")
            print("     빠진 채로 갈 거면 그 줄을 script.txt 에서 지우거나 앞에 # 를 붙이고 (남은 낱말은 edit.json 의 cut 으로),")
            print("     소리는 있는데 받아쓰기가 틀린 거면 npm run align -- <이름> --allow-missing")
            print("   words.json · captions.json 은 쓰지 않았습니다.")
            sys.exit(1)

    words = [{"text": t["text"], "start": round(t["start"], 3), "end": round(t["end"], 3), "cue": t["cue"]} for t in tokens]

    # 큐: 첫 단어 시작 ~ 다음 큐 시작 (마지막은 끝 단어 + HOLD_LAST)
    out = []
    for ci, cue in enumerate(cues):
        ws = [w for w in words if w["cue"] == ci]
        if not ws:
            continue
        out.append({"start": ws[0]["start"], "end": ws[-1]["end"], "text": cue["text"], "emph": cue["emph"], "style": cue["style"]})
    for i, c in enumerate(out):
        nxt = out[i + 1]["start"] if i + 1 < len(out) else c["end"] + HOLD_LAST
        # 다음 큐까지 1.2초 넘게 비면 끝 단어 뒤 0.5초에서 끊는다 (말 없는 구간에 자막이 떠 있지 않게)
        c["end"] = round(min(nxt, c["end"] + 0.5) if nxt - c["end"] > 1.2 else nxt, 3)
        c["start"] = round(c["start"], 3)
        if c["end"] - c["start"] < MIN_CUE:
            c["end"] = round(c["start"] + MIN_CUE, 3)
        if not c["emph"]:
            del c["emph"]
        if c["style"] == "base":
            del c["style"]

    (proj / "words.json").write_text(json.dumps(words, ensure_ascii=False, indent=1), encoding="utf-8")
    (proj / "captions.json").write_text(json.dumps(out, ensure_ascii=False, indent=1), encoding="utf-8")

    rate = matched / max(1, n_chars)
    print(f"자막 {len(out)}개, 단어 {len(words)}개 정렬 완료 (글자 일치율 {rate:.0%})")
    if guessed:
        print("시간을 추정한 단어:", ", ".join(guessed[:40]))
    for run in dropped_runs(guessed_idx):
        print(f"⚠️  대본 {len(run)}단어가 연달아 소리에서 안 들립니다 (원본 {tokens[run[0]]['start']:.1f}초 부근: "
              f"\"{' '.join(tokens[j]['text'] for j in run[:8])}…\") — 아바타 영상에서 문장이 빠졌을 수 있어요. 그 구간을 직접 들어 보세요")
    if rate < 0.7:
        print("⚠️  일치율이 낮습니다. script.txt 가 실제 말과 많이 다른지 확인하세요.")
    long = [c for c in out if len(c["text"]) > 18]
    if long:
        print("⚠️  한 줄이 긴 자막(18자 초과, 나누면 좋음):", " / ".join(c["text"] for c in long))


if __name__ == "__main__":
    main()
