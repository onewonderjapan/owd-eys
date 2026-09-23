# Build the one-look contact sheet from the visual gate's frames (V6 2026-09-24).
# Reads reports/local/visual.json (the frames the gate just audited), tiles the
# images into reports/local/contact-sheet.jpg with the filename on every cell.
# Usage: python -X utf8 scripts/contact-sheet.py
import json
import sys
from pathlib import Path

from PIL import Image, ImageDraw

root = Path(__file__).resolve().parent.parent
visual = json.loads((root / 'reports/local/visual.json').read_text(encoding='utf-8'))
frames = visual.get('views', [])
if not frames:
    sys.exit('reports/local/visual.json has no frames; run scripts/smoke-visual.mjs first')

CELL_W, CELL_H, LABEL_H, COLS = 480, 300, 26, 4
rows = (len(frames) + COLS - 1) // COLS
sheet = Image.new('RGB', (COLS * CELL_W, rows * (CELL_H + LABEL_H)), '#141414')
draw = ImageDraw.Draw(sheet)

for idx, frame in enumerate(frames):
    col, row = idx % COLS, idx // COLS
    x0, y0 = col * CELL_W, row * (CELL_H + LABEL_H)
    image_path = root / frame['image']
    if image_path.is_file():
        im = Image.open(image_path).convert('RGB')
        im.thumbnail((CELL_W - 4, CELL_H - 4))
        sheet.paste(im, (x0 + (CELL_W - im.width) // 2, y0 + (CELL_H - im.height) // 2))
    else:
        draw.rectangle([x0 + 2, y0 + 2, x0 + CELL_W - 2, y0 + CELL_H - 2], outline='#664444')
        draw.text((x0 + 12, y0 + CELL_H // 2), 'missing: ' + frame['image'], fill='#cc8888')
    verdict = 'PASS' if all(v == 'pass' for v in frame.get('checks', {}).values()) or not frame.get('checks') else 'FAIL'
    draw.text((x0 + 6, y0 + CELL_H + 6), f"{frame['view']}  [{verdict}]", fill='#9fe89f' if verdict == 'PASS' else '#ff9f9f')

out = root / 'reports/local/contact-sheet.jpg'
sheet.save(out, quality=82)
print(f'contact-sheet: {out} ({len(frames)} frames, {sheet.width}x{sheet.height})')
