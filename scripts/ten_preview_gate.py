"""Keep the old trial visible until high-grade calendar joins are checked."""
import hashlib
import json
from pathlib import Path
import re

def ready_for_export(site):
    root=Path(site);pointer=root/'ten-preview/current.json'
    if not pointer.exists():return False
    meta=json.loads(pointer.read_text());relative=meta.get('path','')
    if not re.fullmatch(r'ten-preview/\d{8}/runs/run-\d+-\d+\.json',relative):raise ValueError('Invalid ten-preview path')
    payload=(root/relative).read_bytes()
    if hashlib.sha256(payload).hexdigest()!=meta.get('sha256'):raise ValueError('Ten-preview checksum differs')
    data=json.loads(payload)
    for race in data['races']:
        for player in race['players']:
            for meeting in player['meetings']:
                if ((meeting.get('grade_code') or 0)>=4 and any(d.get('video_url') for d in meeting['days'])
                        and meeting.get('calendar_sequence_verified') is not True):
                    return False
    return True
