#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
티니핑 도감.xlsx 기반 시즌별 티니핑 고화질 공식 일러스트(PNG) 자동 수집 스크립트
- 외부 패키지(openpyxl 등) 설치 없이도 동작하도록 표준 라이브러리(zipfile, xml, urllib, concurrent.futures) 기반으로 작성되었습니다.
- 엑셀 파일(티니핑 도감.xlsx)의 6개 시즌 테이블을 자동 파싱하고,
  44번 '악동핑 / 앙대핑', 5기 6번 '왕자핑 (나그네핑)', 6기 7번 '일반 프린세스핑 15종'(설명란의 15종 이름 파싱)까지
  모두 개별 캐릭터로 분리하여 image/<시즌명>/ 폴더에 고화질 원본 이미지를 다운로드합니다.
"""

import os
import re
import json
import zipfile
import urllib.parse
import urllib.request
import xml.etree.ElementTree as ET
from concurrent.futures import ThreadPoolExecutor, as_completed

# 프로젝트 루트 = 이 스크립트(scripts/)의 상위 폴더 → 어디서 실행해도 같은 경로를 씁니다.
BASE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
EXCEL_PATH = os.path.join(BASE_DIR, "data", "티니핑 도감.xlsx")
OUTPUT_DIR = os.path.join(BASE_DIR, "image_original")  # 원본 보관용 (게임용은 scripts/optimize_images.py 로 변환)
FANDOM_API = "https://catchteenieping.fandom.com/api.php"
USER_AGENT = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36"

# 엑셀 시트 내 시즌별 컬럼 매핑 (번호, 이름, 등급, 키워드, 설명)
SEASON_COLUMNS = [
    ("1기_캐치_티니핑", "Season 1", "B", "C", "D", "E", "F"),
    ("2기_반짝반짝_캐치_티니핑", "Season 2", "H", "I", "J", "K", "L"),
    ("3기_알쏭달쏭_캐치_티니핑", "Season 3", "N", "O", "P", "Q", "R"),
    ("4기_새콤달콤_캐치_티니핑", "Season 4", "T", "U", "V", "W", "X"),
    ("5기_슈팅스타_캐치_티니핑", "Season 5", "Z", "AA", "AB", "AC", "AD"),
    ("6기_프린세스_캐치_티니핑_및_극장판", "Season 6", "AF", "AG", "AH", "AI", "AJ"),
]

# 시즌별 하츄핑 및 특수 캐릭터의 위키 파일명 매핑 보정
SPECIAL_NAME_TO_WIKI_KEY = {
    ("Season 1", "하츄핑"): ("Season 1", "Heartsping"),
    ("Season 2", "다이아 하츄핑"): ("Season 2", "Dia Heartsping"),
    ("Season 3", "플로라 하츄핑"): ("Season 3", "Flora Heartsping"),
    ("Season 4", "베리 하츄핑"): ("Season 4", "Berry Heartsping"),
    ("Season 5", "스타 하츄핑"): ("Season 5", "Star Heartsping"),
    ("Season 6", "프린세스 하츄핑"): ("Season 6", "Princess Heartsping"),
    ("Season 6", "트러핑"): ("Heartsping: Teenieping of Love", "Truthping"),
}


def api_get_json(params: dict) -> dict:
    """MediaWiki API 호출 헬퍼"""
    query_string = urllib.parse.urlencode(params)
    url = f"{FANDOM_API}?{query_string}"
    req = urllib.request.Request(url, headers={"User-Agent": USER_AGENT})
    with urllib.request.urlopen(req, timeout=20) as resp:
        return json.loads(resp.read().decode("utf-8"))


def parse_excel_catalog(excel_path: str) -> dict:
    """
    티니핑 도감.xlsx 파일을 파싱하여 시즌별 캐릭터 리스트를 반환합니다.
    (openpyxl 미설치 환경에서도 동작하도록 표준 zipfile + ElementTree 사용)
    """
    if not os.path.exists(excel_path):
        raise FileNotFoundError(f"엑셀 파일을 찾을 수 없습니다: {excel_path}")

    with zipfile.ZipFile(excel_path, "r") as z:
        ss_root = ET.fromstring(z.read("xl/sharedStrings.xml"))
        ns = {"s": "http://schemas.openxmlformats.org/spreadsheetml/2006/main"}
        shared_strings = [
            "".join(t.text or "" for t in si.findall(".//s:t", ns))
            for si in ss_root.findall("s:si", ns)
        ]
        sheet_root = ET.fromstring(z.read("xl/worksheets/sheet1.xml"))

    catalog = {folder: [] for folder, *_ in SEASON_COLUMNS}

    for row in sheet_root.findall(".//s:row", ns):
        r_idx = int(row.attrib.get("r", 0))
        if r_idx < 5:  # 4행은 헤더, 5행부터 데이터
            continue

        cells = {}
        for c in row.findall("s:c", ns):
            ref = c.attrib.get("r", "")
            col = re.sub(r"\d+", "", ref)
            t = c.attrib.get("t")
            v = c.find("s:v", ns)
            val = v.text if v is not None else ""
            if t == "s" and val != "":
                val = shared_strings[int(val)]
            if val != "":
                cells[col] = val.strip()

        for folder, wiki_season, c_num, c_name, c_grade, c_kw, c_desc in SEASON_COLUMNS:
            if c_name not in cells:
                continue
            raw_num = cells.get(c_num, "")
            num = int(float(raw_num)) if raw_num.replace(".", "", 1).isdigit() else raw_num
            raw_name = cells.get(c_name, "")
            grade = cells.get(c_grade, "")
            desc = cells.get(c_desc, "")

            # 1) '일반 프린세스핑 15종'처럼 설명란에 개별 티니핑 목록이 나열된 경우 자동 전개
            if "15종" in raw_name and "핑" in desc:
                sub_names = [n.strip() for n in desc.split(",") if "핑" in n]
                for sub_idx, s_name in enumerate(sub_names, 1):
                    catalog[folder].append({
                        "code": f"{num:02d}-{sub_idx:02d}",
                        "name": s_name,
                        "grade": grade,
                        "wiki_season": wiki_season,
                    })
            # 2) '악동핑 / 앙대핑'처럼 슬래시(/)로 합쳐진 경우 분리
            elif "/" in raw_name:
                sub_names = [n.strip() for n in raw_name.split("/") if n.strip()]
                for sub_idx, s_name in enumerate(sub_names, 1):
                    catalog[folder].append({
                        "code": f"{num:02d}-{sub_idx}",
                        "name": s_name,
                        "grade": grade,
                        "wiki_season": wiki_season,
                    })
            # 3) '왕자핑 (나그네핑)'처럼 괄호 안에 별칭/변신 전후 티니핑이 함께 적힌 경우 둘 다 수집
            elif "(" in raw_name and ")" in raw_name:
                m = re.match(r"^([^\(]+)\(([^\)]+)\)", raw_name)
                if m:
                    n1, n2 = m.group(1).strip(), m.group(2).strip()
                    catalog[folder].append({
                        "code": f"{num:02d}-1",
                        "name": n1,
                        "grade": grade,
                        "wiki_season": wiki_season,
                    })
                    catalog[folder].append({
                        "code": f"{num:02d}-2",
                        "name": n2,
                        "grade": grade,
                        "wiki_season": wiki_season,
                    })
            else:
                catalog[folder].append({
                    "code": f"{num:02d}" if isinstance(num, int) else str(num),
                    "name": raw_name,
                    "grade": grade,
                    "wiki_season": wiki_season,
                })

    return catalog


def build_wiki_image_index() -> dict:
    """
    Catch! Teenieping Fandom Wiki의 시즌별 공식 도감 문서에서
    한국어 이름 -> 원본 고화질 렌더링 이미지 URL 매핑 테이블을 구축합니다.
    """
    print("[1/3] 티니핑 공식 위키 데이터베이스에서 시즌별 캐릭터 목록 및 한국어 이름 매핑 중...")
    wiki_seasons = [
        "Season 1",
        "Season 2",
        "Season 3",
        "Season 4",
        "Season 5",
        "Season 6",
        "Heartsping: Teenieping of Love",
    ]

    season_entries = []  # (wiki_season, page_link, display_label, file_title)
    char_pages = set()

    for ws in wiki_seasons:
        page_title = f"List of Teeniepings/{ws}"
        data = api_get_json({
            "action": "parse",
            "page": page_title,
            "prop": "wikitext",
            "format": "json",
        })
        wikitext = data["parse"]["wikitext"]["*"]
        for row in wikitext.split("|-")[1:]:
            links = re.findall(r"\[\[([^\]|]+)(?:\|([^\]]+))?\]\]", row)
            files = re.findall(r"\[\[(?:File|Image):([^\]|]+)", row, re.IGNORECASE)
            if links and files:
                char_link, char_label = links[0]
                char_link = char_link.strip()
                display_label = (char_label or char_link).strip()
                file_name = "File:" + files[0].strip()
                season_entries.append((ws, char_link, display_label, file_name))
                char_pages.add(char_link)

    # 캐릭터 문서 본문에서 한국어 티니핑 이름 추출 (50개씩 배치 조회)
    sorted_pages = sorted(char_pages)
    page_to_ko_names = {}
    for i in range(0, len(sorted_pages), 50):
        batch = sorted_pages[i : i + 50]
        data = api_get_json({
            "action": "query",
            "titles": "|".join(batch),
            "prop": "revisions",
            "rvprop": "content",
            "redirects": "1",
            "format": "json",
        })
        for _, pdata in data["query"]["pages"].items():
            title = pdata.get("title", "")
            revs = pdata.get("revisions", [])
            if revs:
                content = revs[0].get("*", "")
                # 인포박스 내 한글 이름 추출
                ko_matches = re.findall(r"[가-힣]+(?:\s+[가-힣]+)*핑", content)
                page_to_ko_names[title] = list(dict.fromkeys(ko_matches))

    # 파일명(File:...png)들의 원본 고화질 URL 일괄 조회 (50개씩 배치 조회)
    all_files = sorted({entry[3] for entry in season_entries})
    file_to_url = {}
    for i in range(0, len(all_files), 50):
        batch = all_files[i : i + 50]
        data = api_get_json({
            "action": "query",
            "titles": "|".join(batch),
            "prop": "imageinfo",
            "iiprop": "url|dimensions",
            "format": "json",
        })
        # Normalize 매핑 처리
        norm_map = {
            n["to"]: n["from"]
            for n in data["query"].get("normalized", [])
        }
        for _, pdata in data["query"]["pages"].items():
            ftitle = pdata.get("title", "")
            ii = pdata.get("imageinfo", [{}])[0]
            orig_url = ii.get("url")
            if orig_url:
                # 원본 해상도 보장을 위해 /scale-to-width-down/... 제거 및 images.wikia.com 원본 PNG 도메인 사용
                orig_url = re.sub(r"/scale-to-width-down/\d+", "", orig_url)
                orig_url = orig_url.replace("static.wikia.nocookie.net", "images.wikia.com")
                sep = "&" if "?" in orig_url else "?"
                orig_url = f"{orig_url}{sep}format=original"
                file_to_url[ftitle] = (orig_url, ii.get("width", 0), ii.get("height", 0))
                if ftitle in norm_map:
                    file_to_url[norm_map[ftitle]] = (orig_url, ii.get("width", 0), ii.get("height", 0))

    # 인덱스 생성:
    # 1) (wiki_season, display_label) -> (url, width, height, file_title)
    # 2) (wiki_season, ko_name) -> (url, width, height, file_title)
    # 3) ko_name -> (url, width, height, file_title)
    by_season_label = {}
    by_season_ko = {}
    by_ko_global = {}

    for ws, char_link, display_label, file_name in season_entries:
        info = file_to_url.get(file_name) or file_to_url.get(file_name.replace("_", " "))
        if not info:
            continue
        by_season_label[(ws, display_label)] = info
        ko_candidates = page_to_ko_names.get(char_link, [])
        if ko_candidates:
            # 첫 번째 매칭된 한글 이름이 해당 캐릭터의 본명
            primary_ko = ko_candidates[0]
            by_season_ko[(ws, primary_ko)] = info
            by_ko_global.setdefault(primary_ko, info)
            for ko in ko_candidates[:3]:
                by_season_ko.setdefault((ws, ko), info)
                by_ko_global.setdefault(ko, info)

    return {
        "by_season_label": by_season_label,
        "by_season_ko": by_season_ko,
        "by_ko_global": by_ko_global,
    }


def resolve_character_image(item: dict, wiki_index: dict) -> tuple:
    """개별 캐릭터에 대해 가장 적합한 고화질 이미지 URL을 찾습니다."""
    ws = item["wiki_season"]
    name = item["name"]

    # 1. 특수 매핑 확인 (시즌별 하츄핑, 극장판 트러핑 등)
    if (ws, name) in SPECIAL_NAME_TO_WIKI_KEY:
        key = SPECIAL_NAME_TO_WIKI_KEY[(ws, name)]
        if key in wiki_index["by_season_label"]:
            return wiki_index["by_season_label"][key]

    # 2. 시즌 + 한글 이름 정확 매칭
    if (ws, name) in wiki_index["by_season_ko"]:
        return wiki_index["by_season_ko"][(ws, name)]

    # 3. 전체 시즌 한글 이름 매칭
    if name in wiki_index["by_ko_global"]:
        return wiki_index["by_ko_global"][name]

    return (None, 0, 0)


def download_single_image(task: dict) -> dict:
    """단일 캐릭터 이미지를 다운로드하고 결과를 반환합니다."""
    filepath = task["filepath"]
    url = task["url"]
    os.makedirs(os.path.dirname(filepath), exist_ok=True)

    req = urllib.request.Request(url, headers={"User-Agent": USER_AGENT})
    with urllib.request.urlopen(req, timeout=30) as resp:
        img_bytes = resp.read()

    with open(filepath, "wb") as f:
        f.write(img_bytes)

    return {
        "season": task["season"],
        "code": task["code"],
        "name": task["name"],
        "filepath": filepath,
        "size_kb": len(img_bytes) / 1024.0,
        "width": task["width"],
        "height": task["height"],
    }


def main():
    print(f"=== [{EXCEL_PATH}] 기반 티니핑 시즌별 고화질 이미지 수집 시작 ===")
    catalog = parse_excel_catalog(EXCEL_PATH)
    total_chars = sum(len(v) for v in catalog.values())
    print(f"[*] 엑셀 파싱 완료: 총 {len(catalog)}개 시즌 폴더, {total_chars}종 캐릭터 확인")

    wiki_index = build_wiki_image_index()

    download_tasks = []
    missing = []

    for season_folder, items in catalog.items():
        season_dir = os.path.join(OUTPUT_DIR, season_folder)
        os.makedirs(season_dir, exist_ok=True)

        for item in items:
            url, width, height = resolve_character_image(item, wiki_index)
            if not url:
                missing.append((season_folder, item["code"], item["name"]))
                continue

            safe_name = re.sub(r'[\\/:*?"<>|]', "_", item["name"])
            filename = f"{item['code']}_{safe_name}.png"
            filepath = os.path.join(season_dir, filename)
            download_tasks.append({
                "season": season_folder,
                "code": item["code"],
                "name": item["name"],
                "url": url,
                "width": width,
                "height": height,
                "filepath": filepath,
            })

    if missing:
        print(f"[!] 매칭되지 않은 캐릭터: {missing}")

    print(f"[2/3] 총 {len(download_tasks)}개 고화질 이미지 병렬 다운로드 중 (대상 폴더: ./{OUTPUT_DIR}/)...")
    completed = []
    failed = []

    with ThreadPoolExecutor(max_workers=10) as executor:
        future_map = {executor.submit(download_single_image, t): t for t in download_tasks}
        for idx, future in enumerate(as_completed(future_map), 1):
            t = future_map[future]
            try:
                res = future.result()
                completed.append(res)
                if idx % 20 == 0 or idx == len(download_tasks):
                    print(
                        f"  -> 진행률: [{idx}/{len(download_tasks)}] "
                        f"최근 완료: {res['season']}/{os.path.basename(res['filepath'])} "
                        f"({res['width']}x{res['height']}, {res['size_kb']:.1f} KB)"
                    )
            except Exception as e:
                failed.append((t["season"], t["name"], str(e)))
                print(f"  [오류] {t['season']} - {t['name']}: {e}")

    print("\n[3/3] === 시즌별 다운로드 결과 요약 ===")
    for season_folder in catalog.keys():
        s_done = [c for c in completed if c["season"] == season_folder]
        print(f" - {season_folder}: {len(s_done)}개 파일 저장 완료 (경로: {os.path.join(OUTPUT_DIR, season_folder)})")

    print(f"\n총 {len(completed)}/{len(download_tasks)}개 고화질 티니핑 이미지 다운로드 완료! (실패: {len(failed)}건)")


if __name__ == "__main__":
    main()
