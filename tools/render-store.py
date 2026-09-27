#!/usr/bin/env python3
"""
Render the Zepp App Store icon and screenshots from the real page layouts, colours
(utils/theme.js), strings (page/i18n/en-US.po) and shield art.

    npm run store      → store/icon.png                  240 × 240
                         store/screenshots/round/*.png   360 × 360, the 480 × 480 screen scaled to fill it
                         store/screenshots/square/*.png  360 × 360, the 390 × 450 screen scaled to 312 × 360

Zepp's rules (docs.zepp.com/docs/distribute): PNG, transparent background; round screens fill
the square with no margins, rectangular ones get equal left/right margins and none top or bottom.
Everything is drawn at 4× and scaled down so edges are smooth. Text uses the same stand-in font
as render-mocks.py, not the watch's own. Requires Pillow (pip install pillow) and Node.
"""
import datetime, json, os, re, subprocess, tempfile
from pathlib import Path
from PIL import Image, ImageDraw, ImageFont

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, 'store')
S = 4  # supersampling
SIZE = 360  # screenshot side
ICON = 240

# --- 1. evaluate the layout modules and the palette in Node ------------------
tmp = tempfile.mkdtemp()
pages = ['index', 'alert', 'settings']
for page in pages:
    for shape in ['r', 's']:
        src = open(os.path.join(ROOT, 'page', f'{page}.{shape}.layout.js')).read()
        src = re.sub(r"import \{ px \} from '@zos/utils'", 'const px = (v) => v', src)
        open(os.path.join(tmp, f'{page}.{shape}.mjs'), 'w').write(src)
theme = open(os.path.join(ROOT, 'utils', 'theme.js')).read()
theme = re.sub(r"import \{ setStatusBarVisible \} from '@zos/ui'", 'const setStatusBarVisible = () => {}', theme)
open(os.path.join(tmp, 'theme.mjs'), 'w').write(theme)
dump = "import { writeFileSync } from 'node:fs'\nimport { COLOR } from './theme.mjs'\nconst out = { COLOR }\n"
dump += "for (const p of %s) for (const s of ['r','s']) out[`${p}.${s}`] = await import(`./${p}.${s}.mjs`)\n" % json.dumps(pages)
dump += "const P = await import(%s)\n" % json.dumps(Path(ROOT, 'utils', 'pulse.js').as_uri())
dump += "for (const s of ['r','s']) out[`pulse.${s}`] = P.pulseFrames(out[`index.${s}`].RING, { ...out[`index.${s}`].PULSE, color: COLOR.green })\n"
dump += "writeFileSync('layouts.json', JSON.stringify(out, (k, v) => (typeof v === 'function' ? undefined : v)))\n"
open(os.path.join(tmp, 'dump.mjs'), 'w').write(dump)
subprocess.run(['node', 'dump.mjs'], cwd=tmp, check=True)
L = json.load(open(os.path.join(tmp, 'layouts.json')))
C = {k: '#%06x' % v for k, v in L['COLOR'].items()}

po = open(os.path.join(ROOT, 'page', 'i18n', 'en-US.po'), encoding='utf-8').read()
T = dict(re.findall(r'msgid "([^"]*)"\s*msgstr "([^"]*)"', po))

# --- 2. what the screens show --------------------------------------------------
# One story across the set: a fall at 14:32, and Home later that afternoon with the day's tally.
DAY = datetime.date(2026, 9, 26)
DATE = T['home.date'].format(weekday=T['home.weekdays'].split(',')[DAY.weekday()],
                             month=T['home.months'].split(',')[DAY.month - 1], day=DAY.day)
ALERTS = T['home.alerts_many'].replace('{n}', '2').replace('{time}', '14:32')
DETAILS = T['alert.details'].replace('{g}', '3.4').replace('{ms}', '290')
STOPS = T['alert.stops'].replace('{n}', '28')

# --- 3. draw -----------------------------------------------------------------

def font(sz):
    for p in ['/System/Library/Fonts/Supplemental/Arial Bold.ttf', '/System/Library/Fonts/Helvetica.ttc',
              '/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf']:
        try: return ImageFont.truetype(p, int(sz))
        except OSError: pass
    return ImageFont.load_default()

def box(b): return [b['x'] * S, b['y'] * S, (b['x'] + b['w']) * S, (b['y'] + b['h']) * S]
def canvas(shape):
    scr = L[f'index.{shape}']['SCREEN']
    im = Image.new('RGBA', (scr['w'] * S, scr['h'] * S), C['bg']); return im, ImageDraw.Draw(im)
def txt(d, b, s, color, al='c'):
    x0, y0, x1, y1 = box(b)
    d.text(((x0 + x1) / 2 if al == 'c' else x0, (y0 + y1) / 2), s, fill=color, font=font(b['text_size'] * S),
           anchor='mm' if al == 'c' else 'lm')
def arc(d, b, color, end): d.arc(box(b), b['start_angle'], end, fill=color, width=b['line_width'] * S)
def rrect(d, b, color, outline=None, width=0):
    d.rounded_rectangle(box(b), radius=b['radius'] * S, fill=color, outline=outline, width=width * S)
def circ(d, c, color, alpha=255):
    r = c['radius'] * S
    d.ellipse([c['center_x'] * S - r, c['center_y'] * S - r, c['center_x'] * S + r, c['center_y'] * S + r],
              fill=Image.new('RGB', (1, 1), color).getpixel((0, 0)) + (alpha,))
def img(im, b, path):
    art = Image.open(path).convert('RGBA').resize((b['w'] * S, b['h'] * S), Image.LANCZOS)
    im.alpha_composite(art, (b['x'] * S, b['y'] * S))

def home(shape, clock, alerts=None):
    l = L[f'index.{shape}']; beep = L[f'pulse.{shape}']
    im, d = canvas(shape)
    pulse = beep[len(beep) // 3]  # the beep a third of the way out, under the ring as on the watch
    arc(d, pulse, '#%06x' % pulse['color'], pulse['end_angle'])
    arc(d, l['RING'], C['track'], l['RING_FULL']); arc(d, l['RING'], C['green'], l['RING']['start_angle'] + 360)  # worn all along: 100 %
    rrect(d, l['DISC'], C['bg']); img(im, l['SHIELD'], os.path.join(ROOT, 'assets', f'default.{shape}', l['SHIELD']['src']))
    txt(d, l['CLOCK'], clock, C['text']); txt(d, l['DATE'], DATE, C['muted'])
    txt(d, l['TITLE'], T['home.covered'], C['text'])
    if alerts: txt(d, l['ALERTS'], alerts, C['redSoft'])
    return im

def alert(shape):
    l = L[f'alert.{shape}']; im, d = canvas(shape)
    for g in l['GLOW']:
        ov = Image.new('RGBA', im.size, (0, 0, 0, 0)); circ(ImageDraw.Draw(ov), g, C['red'], g['alpha'])
        im.alpha_composite(ov)
    d = ImageDraw.Draw(im)
    txt(d, l['TITLE'], T['alert.title'], C['text']); txt(d, l['TIME'], '14:32', C['text'])
    txt(d, l['DETAILS'], DETAILS, C['caption']); txt(d, l['STOPS'], STOPS, C['faint'])
    rrect(d, l['OK_BTN'], C['white']); txt(d, l['OK_BTN'], T['alert.ok'], C['ink'])
    return im

def settings(shape):
    l = L[f'settings.{shape}']; im, d = canvas(shape)
    txt(d, l['TITLE'], T['settings.title'], C['text'])
    for row, key in zip(l['ROWS'], ['relaxed', 'balanced', 'watchful']):
        sel = key == 'balanced'  # the default (utils/prefs.js)
        rrect(d, row['rect'], C['redCard'] if sel else C['card'])
        if sel: rrect(d, row['border'], None, outline=C['red'], width=row['border']['line_width']); circ(d, row['radio'], C['red']); circ(d, row['radioDot'], C['bg'])
        else: circ(d, row['radio'], C['radioOff']); circ(d, row['radioInner'], C['card'])
        txt(d, row['label'], T[f'settings.{key}'], C['text'] if sel else C['textSoft'], 'l')
        txt(d, row['sub'], T[f'settings.{key}_sub'], C['caption'] if sel else C['dim'], 'l')
    # the Watch siren toggle stays hidden until SIREN_READY in page/settings.js
    return im

def shrink(im, size):
    """Premultiplied resample, so transparent edges don't pick up a dark fringe."""
    return im.convert('RGBa').resize(size, Image.LANCZOS).convert('RGBA')

def store_png(im, shape, path):
    if shape == 'r':  # the screen is the circle: everything outside it transparent, no margins
        m = Image.new('L', im.size, 0); ImageDraw.Draw(m).ellipse([0, 0, im.size[0] - 1, im.size[1] - 1], fill=255)
        im.putalpha(m); out = shrink(im, (SIZE, SIZE))
    else:  # full height, equal transparent margins left and right
        w = round(SIZE * im.size[0] / im.size[1])
        out = Image.new('RGBA', (SIZE, SIZE), (0, 0, 0, 0)); out.paste(shrink(im, (w, SIZE)), ((SIZE - w) // 2, 0))
    os.makedirs(os.path.dirname(path), exist_ok=True); out.save(path, optimize=True)

shots = [('1-home', lambda s: home(s, '14:32')), ('2-alert', alert), ('3-settings', settings),
         ('4-home-alerts', lambda s: home(s, '16:05', ALERTS))]
for shape, folder in [('r', 'round'), ('s', 'square')]:
    for name, draw in shots:
        store_png(draw(shape), shape, os.path.join(OUT, 'screenshots', folder, f'{name}.png'))

# The watch icon is already a full-bleed circle on transparent corners; the store wants it at 240.
os.makedirs(OUT, exist_ok=True)
shrink(Image.open(os.path.join(ROOT, 'assets', 'default.r', 'icon.png')).convert('RGBA'), (ICON, ICON)).save(os.path.join(OUT, 'icon.png'), optimize=True)
print('wrote', OUT)
