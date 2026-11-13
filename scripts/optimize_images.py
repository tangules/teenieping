#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
게임용 이미지 최적화 스크립트
- 원본 고화질 PNG(image_original/<시즌>/*.png)를 폰에서 빨리 뜨도록
  긴 변 최대 800px · WebP(투명 배경 유지)로 변환해 image/<시즌>/*.webp 에 저장합니다.
- 원본 폴더(image_original/)는 용량이 커서 git에 올리지 않습니다(.gitignore).
- 사용법: python scripts/optimize_images.py   (이미 최신인 파일은 건너뜀)
"""

import os
import sys
from PIL import Image

BASE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SRC_DIR = os.path.join(BASE_DIR, "image_original")
OUT_DIR = os.path.join(BASE_DIR, "image")

MAX_SIDE = 800   # 폰 화면(최대 약 400px 표시) × 고해상도 2배 기준
QUALITY = 85     # WebP 품질 (80~90이면 눈으로 원본과 구분 어려움)


def optimize_one(src: str, dst: str) -> tuple:
    with Image.open(src) as im:
        im = im.convert("RGBA")
        im.thumbnail((MAX_SIDE, MAX_SIDE), Image.LANCZOS)
        os.makedirs(os.path.dirname(dst), exist_ok=True)
        im.save(dst, "WEBP", quality=QUALITY, method=6)
    return os.path.getsize(src), os.path.getsize(dst)


def main():
    if not os.path.isdir(SRC_DIR):
        sys.exit(f"원본 폴더가 없습니다: {SRC_DIR}\n먼저 scripts/download_teenieping_images.py 로 원본을 받아주세요.")

    total_src = total_dst = count = 0
    for season in sorted(os.listdir(SRC_DIR)):
        season_dir = os.path.join(SRC_DIR, season)
        if not os.path.isdir(season_dir):
            continue
        for name in sorted(os.listdir(season_dir)):
            if not name.lower().endswith(".png"):
                continue
            src = os.path.join(season_dir, name)
            dst = os.path.join(OUT_DIR, season, os.path.splitext(name)[0] + ".webp")
            if os.path.exists(dst) and os.path.getmtime(dst) >= os.path.getmtime(src):
                continue
            s, d = optimize_one(src, dst)
            total_src += s
            total_dst += d
            count += 1

    if count:
        print(f"{count}개 변환: {total_src / 1e6:.1f}MB → {total_dst / 1e6:.1f}MB")
    else:
        print("변환할 새 이미지가 없습니다.")


if __name__ == "__main__":
    main()
