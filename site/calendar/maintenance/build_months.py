"""Build fixed month pages inside the calendar from its shared HTML shell."""
import json
from pathlib import Path
import re


def build():
    root = Path(__file__).resolve().parents[1]
    data = json.loads((root/'schedule.json').read_text())
    first = max('2026-10', min(m['start'][:7] for m in data['meetings']))
    last = max(m['end'][:7] for m in data['meetings'])
    shell = (root/'index.html').read_text()
    count = 0
    for year in range(int(first[:4]), int(last[:4])+1):
        for month in range(1, 13):
            value = f'{year}-{month:02}'
            if not first <= value <= last:
                continue
            html = shell.replace('<body>', f'<body data-calendar-month="{value}">', 1)
            html = html.replace('<title>開催カレンダー｜競輪ラインナップ</title>', f'<title>{year}年{month}月の開催カレンダー｜競輪ラインナップ</title>', 1)
            (root/f'{year}{month:02}.html').write_text(html)
            count += 1
    return count


if __name__ == '__main__':
    print('Calendar month pages:', build())
