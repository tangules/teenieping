#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
귀여운 하츄핑 톤(고음역 Neural TTS) 음성 MP3 일괄 생성 스크립트
- 모든 티니핑 이름(154종): audio/names/<이름>.mp3
- 정답 음성(154종, "OO핑 정답이에요!"): audio/correct/<이름>.mp3
- 한글 낱글자 음절(186자): audio/chars/<글자>.mp3
- 공통 효과 멘트: audio/common/finish.mp3, audio/common/tts_on.mp3
"""

import os
import json
import asyncio
import edge_tts

# 프로젝트 루트 = 이 스크립트(scripts/)의 상위 폴더 → 어디서 실행해도 같은 경로를 씁니다.
BASE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DATA_JS = os.path.join(BASE_DIR, "data", "teenieping-data.js")  # 게임과 같은 데이터 파일
AUDIO_DIR = os.path.join(BASE_DIR, "audio")


def load_teenieping_data() -> list:
    """data/teenieping-data.js 의 `const TEENIEPINGS = [...]` 배열을 읽어옵니다."""
    with open(DATA_JS, "r", encoding="utf-8") as f:
        text = f.read()
    start, end = text.index("["), text.rindex("]")
    return json.loads(text[start:end + 1])

VOICE = "ko-KR-SunHiNeural"
PITCH = "+50Hz"   # 귀엽고 통통 튀는 하츄핑 스타일 고음역 피치
RATE = "+6%"     # 밝고 경쾌한 속도


async def synth_one(sem: asyncio.Semaphore, text: str, out_path: str):
    if os.path.exists(out_path) and os.path.getsize(out_path) > 200:
        return
    os.makedirs(os.path.dirname(out_path), exist_ok=True)
    async with sem:
        for attempt in range(3):
            try:
                comm = edge_tts.Communicate(text, voice=VOICE, pitch=PITCH, rate=RATE)
                await comm.save(out_path)
                return
            except Exception as e:
                if attempt == 2:
                    print(f"[오류] {text} -> {e}")
                await asyncio.sleep(0.5 * (attempt + 1))


async def main():
    data = load_teenieping_data()

    names = sorted({d["name"] for d in data})
    chars = sorted({ch for n in names for ch in n if ch.strip()})

    tasks_info = []
    for item in data:
        name = item["name"]
        kw = item["keyword"].replace("/", ", ").replace("·", ", ")
        desc = item["desc"].replace("/", ", ").replace("·", ", ")
        hint_speech = f"힌트! {kw}의 티니핑이에요! {desc}"
        tasks_info.append((hint_speech, os.path.join(AUDIO_DIR, "hints", f"{name}.mp3")))

    for name in names:
        tasks_info.append((name, os.path.join(AUDIO_DIR, "names", f"{name}.mp3")))
        tasks_info.append((f"{name}! 정답이에요!", os.path.join(AUDIO_DIR, "correct", f"{name}.mp3")))

    for ch in chars:
        tasks_info.append((ch, os.path.join(AUDIO_DIR, "chars", f"{ch}.mp3")))

    tasks_info.append(("우와! 문제를 모두 풀었어요! 정말 잘했어요, 츄!", os.path.join(AUDIO_DIR, "common", "finish.mp3")))
    tasks_info.append(("하츄핑 목소리가 켜졌어요, 츄!", os.path.join(AUDIO_DIR, "common", "tts_on.mp3")))
    tasks_info.append(("틀렸습니다!", os.path.join(AUDIO_DIR, "common", "wrong.mp3")))

    print(f"총 {len(tasks_info)}개의 귀여운 하츄핑 톤 음성 파일(MP3) 생성을 시작합니다...")
    sem = asyncio.Semaphore(20)

    total = len(tasks_info)
    completed = 0

    async def worker(text, path):
        nonlocal completed
        await synth_one(sem, text, path)
        completed += 1
        if completed % 50 == 0 or completed == total:
            print(f"  -> 진행률: [{completed}/{total}] ({os.path.basename(path)})")

    await asyncio.gather(*(worker(t, p) for t, p in tasks_info))

    # 테스트용 임시 파일 정리
    test_f = os.path.join(BASE_DIR, "test_voice.mp3")
    if os.path.exists(test_f):
        os.remove(test_f)

    print("모든 음성 파일 생성 완료!")


if __name__ == "__main__":
    asyncio.run(main())
