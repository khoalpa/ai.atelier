"""Collect Wikimedia candidates with per-file rights metadata; approve before import."""
from pathlib import Path
import concurrent.futures
import html
import json
import re
import requests
import time
from PIL import Image, ImageDraw, ImageFont, ImageOps

ROOT = Path(__file__).resolve().parents[1]
HOME = ROOT / 'workspace/sample-intake/v2/internet'
HEADERS = {'User-Agent': 'AIAtelierSampleCurator/1.0 (local offline sample curation)'}
THEMES = [
 ('nature-mountain', 'Núi và đường chân trời', 'mountain landscape photograph'),
 ('nature-coast', 'Bờ biển', 'beach coast landscape photograph'),
 ('nature-forest', 'Rừng cây', 'forest path photograph'),
 ('nature-lake', 'Mặt hồ', 'lake reflection landscape photograph'),
 ('nature-night', 'Đường phố ban đêm', 'city street night photograph'),
 ('nature-field', 'Đồng cỏ', 'countryside field landscape photograph'),
 ('interior-room', 'Phòng khách', 'living room interior photograph'),
 ('interior-hall', 'Hành lang', 'corridor interior photograph'),
 ('interior-kitchen', 'Nhà bếp', 'kitchen interior photograph'),
 ('interior-workshop', 'Xưởng làm việc', 'workshop interior photograph'),
 ('texture-wood', 'Vân gỗ', 'wood grain texture'),
 ('texture-tiles', 'Bề mặt gạch', 'ceramic tiles texture'),
 ('texture-fabric', 'Vải dệt', 'woven fabric texture'),
 ('texture-wall', 'Bề mặt tường', 'plaster wall texture'),
 ('real-vase', 'Bình gốm thật', 'ceramic vase photograph'),
 ('real-glass', 'Đồ thủy tinh thật', 'glass bottle photograph')]


def clean(value):
    return html.unescape(re.sub('<[^>]+>', '', value or ''))


def collect(theme):
    key, label, query = theme
    saved = HOME / key / 'candidates.json'
    if saved.exists():
        return json.loads(saved.read_text(encoding='utf-8'))
    time.sleep(5)
    response = requests.get('https://commons.wikimedia.org/w/api.php', params={
        'action': 'query', 'format': 'json', 'generator': 'search', 'gsrsearch': query + ' filetype:bitmap',
        'gsrnamespace': 6, 'gsrlimit': 20, 'prop': 'imageinfo', 'iiprop': 'url|size|extmetadata', 'iiurlwidth': 480}, headers=HEADERS, timeout=45)
    response.raise_for_status()
    candidates = []
    for page in sorted(response.json().get('query', {}).get('pages', {}).values(), key=lambda p: p.get('index', 999)):
        info = page.get('imageinfo', [{}])[0]
        meta = info.get('extmetadata', {})
        license = clean(meta.get('LicenseShortName', {}).get('value'))
        if not re.match(r'^(CC0|Public domain|CC BY(?:-SA)? [234])', license):
            continue
        if min(info.get('width', 0), info.get('height', 0)) < 768 or info.get('size', 0) > 20 * 1024 * 1024:
            continue
        if not re.search(r'\.(jpe?g|png)(?:\?|$)', info.get('url', ''), re.I):
            continue
        item = {'id': key, 'label': label, 'title': page['title'], 'sourceUrl': info['descriptionurl'],
                'downloadUrl': info['url'], 'thumbnailUrl': info.get('thumburl', info['url']), 'license': license,
                'licenseUrl': clean(meta.get('LicenseUrl', {}).get('value')), 'author': clean(meta.get('Artist', {}).get('value')),
                'credit': clean(meta.get('Credit', {}).get('value')), 'description': clean(meta.get('ImageDescription', {}).get('value')),
                'width': info['width'], 'height': info['height'], 'bytes': info['size'], 'originalMetadata': meta}
        candidates.append(item)
        if len(candidates) == 3:
            break
    folder = HOME / key
    folder.mkdir(parents=True, exist_ok=True)
    for index, item in enumerate(candidates):
        file = folder / f'{index}.jpg'
        if not file.exists():
            r = requests.get(item['thumbnailUrl'], headers=HEADERS, timeout=45)
            r.raise_for_status()
            file.write_bytes(r.content)
        item['preview'] = str(file)
    (folder / 'candidates.json').write_text(json.dumps(candidates, ensure_ascii=False, indent=2), encoding='utf-8')
    return candidates


def main():
    HOME.mkdir(parents=True, exist_ok=True)
    results = []
    with concurrent.futures.ThreadPoolExecutor(max_workers=1) as pool:
        for theme, candidates in zip(THEMES, pool.map(collect, THEMES)):
            results.extend(candidates)
            print(theme[0], len(candidates), flush=True)
    (HOME / 'candidates.json').write_text(json.dumps(results, ensure_ascii=False, indent=2), encoding='utf-8')
    font = ImageFont.truetype('C:/Windows/Fonts/arial.ttf', 16)
    for page in range(4):
        sheet = Image.new('RGB', (1200, 1040), '#eeeeee')
        draw = ImageDraw.Draw(sheet)
        for row, theme in enumerate(THEMES[page*4:(page+1)*4]):
            items = [x for x in results if x['id'] == theme[0]]
            for col, item in enumerate(items):
                im = ImageOps.exif_transpose(Image.open(item['preview'])).convert('RGB')
                im.thumbnail((390, 210))
                x, y = col*400, row*260
                sheet.paste(im, (x+(400-im.width)//2, y))
                draw.text((x+5, y+213), f'{theme[0]} / {col}', font=font, fill='black')
                draw.text((x+5, y+235), item['license'], font=font, fill='black')
        sheet.save(HOME / f'review-{page+1}.jpg')


if __name__ == '__main__':
    main()
