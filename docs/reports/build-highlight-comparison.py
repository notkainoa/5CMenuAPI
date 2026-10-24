"""Build a self-contained report from two frozen evaluations of the same menus."""
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
RUNS = ROOT / '.wrangler/highlight-eval'
OLD = '1791085430294-baseline-2026-10-02.json'
NEW = '1791086353782-live-2026-10-02.json'
old = json.loads((RUNS / OLD).read_text())['results']
new = json.loads((RUNS / NEW).read_text())['results']
notes = {
    'hoch': 'Now includes the lemongrass tofu bao alongside the pork bao.',
    'malott': 'Drops roasted cauliflower and adds a composed breakfast dish.',
    'mcconnell': 'Finds the dinner bars, but still misses tofu fajitas and a lunch priority.',
    'collins': 'Drops potatoes and polenta; finds French toast, pot pie and the Nashville sandwich.',
    'frank': 'Keeps orange chicken. The one flagged check already passed before.',
    'frary': 'Drops plain quinoa; finds the tostada bowl, poke bowl and turkey burger.',
}
data = []
for before, after in zip(old, new):
    assert before['hall'] == after['hall']
    assert len(before['meals']) == len(after['meals'])
    data.append({
        'hall': before['hall'], 'note': notes[before['hall']],
        'before': before['passed'], 'after': after['passed'], 'checks': before['checks'],
        'sidesBefore': before['sides'], 'sidesAfter': after['sides'],
        'meals': [{'name': a['meal'], 'before': a['names'], 'after': b['names'],
                   'sidesBefore': a['sides'], 'missed': b['missed']}
                  for a, b in zip(before['meals'], after['meals'])],
    })
assert sum(h['before'] for h in data) == 12
assert sum(h['after'] for h in data) == 21
assert sum(h['checks'] for h in data) == 24
assert sum(h['sidesBefore'] for h in data) == 4
assert sum(h['sidesAfter'] for h in data) == 0
assert sum(len(m['before']) for h in data for m in h['meals']) == 61
assert sum(len(m['after']) for h in data for m in h['meals']) == 77
template = (ROOT / 'docs/reports/highlight-comparison.template.html').read_text()
payload = json.dumps(data, ensure_ascii=False).replace('<', '\\u003c')
content = template.replace('__DATA__', payload)
out = ROOT / '.wrangler/highlight-comparison/index.html'
out.write_text(content)
print(json.dumps({'output': str(out), 'bytes': len(content.encode()), 'halls': len(data),
                  'priorityChecks': [12, 21, 24], 'knownSideErrors': [4, 0]}))
