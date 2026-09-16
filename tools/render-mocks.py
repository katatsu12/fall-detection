#!/usr/bin/env python3
"""
Render the page/*.layout.js geometry to PNG mocks (round + square) without the
simulator, so layout tweaks can be checked against the design canvas quickly.

    npm run mocks      → tools/mocks/sheet.png (+ one PNG per screen/shape)

Icons are drawn as green outlines; everything else uses the real coordinates,
colours and text sizes. Requires Pillow (pip install pillow) and Node.
"""
import json, os, re, subprocess, sys, tempfile
from PIL import Image, ImageDraw, ImageFont

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, 'tools', 'mocks')
os.makedirs(OUT, exist_ok=True)

# --- 1. evaluate the layout modules in Node with px() stubbed --------------
tmp = tempfile.mkdtemp()
pages = ['index', 'alert', 'result', 'settings']
for page in pages:
    for shape in ['r', 's']:
        src = open(os.path.join(ROOT, 'page', f'{page}.{shape}.layout.js')).read()
        src = re.sub(r"import \{ px \} from '@zos/utils'", 'const px = (v) => v', src)
        open(os.path.join(tmp, f'{page}.{shape}.mjs'), 'w').write(src)
dump = "import { writeFileSync } from 'node:fs'\nconst out = {}\n"
dump += "for (const p of %s) for (const s of ['r','s']) out[`${p}.${s}`] = await import(`./${p}.${s}.mjs`)\n" % json.dumps(pages)
dump += "writeFileSync('layouts.json', JSON.stringify(out, (k, v) => (typeof v === 'function' ? undefined : v)))\n"
open(os.path.join(tmp, 'dump.mjs'), 'w').write(dump)
subprocess.run(['node', 'dump.mjs'], cwd=tmp, check=True)
L = json.load(open(os.path.join(tmp, 'layouts.json')))

# --- 2. draw ---------------------------------------------------------------
C = dict(bg='#000000', white='#ffffff', ink='#101113', text='#ffffff', textSoft='#e8e9eb', caption='#c6c9ce',
         muted='#9a9da3', dim='#8a8f96', faint='#6e7278', card='#1d1e20', avatar='#2f3237', track='#2a2d31',
         radioOff='#4a4e54', green='#1fc08a', greenDeep='#10281f', red='#ff3b2f', redSoft='#ff6b5c', redCard='#2a1712')

def font(sz):
    for p in ['/System/Library/Fonts/Supplemental/Arial Bold.ttf', '/System/Library/Fonts/Helvetica.ttc',
              '/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf']:
        try: return ImageFont.truetype(p, int(sz))
        except OSError: pass
    return ImageFont.load_default()

def canvas(shape):
    W, H = (480, 480) if shape == 'r' else (390, 450)
    im = Image.new('RGB', (W, H), C['bg']); return im, ImageDraw.Draw(im)
def txt(d, b, s, color, al='c'):
    f = font(b['text_size']); tw = d.textlength(s, font=f)
    tx = b['x'] + (b['w'] - tw) / 2 if al == 'c' else (b['x'] if al == 'l' else b['x'] + b['w'] - tw)
    d.text((tx, b['y'] + (b['h'] - b['text_size']) / 2 - 2), s, fill=color, font=f)
def arc(d, b, color, end):
    d.arc([b['x'], b['y'], b['x'] + b['w'], b['y'] + b['h']], b['start_angle'], end, fill=color, width=b['line_width'])
def rrect(d, b, color, outline=None, width=0):
    d.rounded_rectangle([b['x'], b['y'], b['x'] + b['w'], b['y'] + b['h']], radius=b['radius'], fill=color, outline=outline, width=width)
def circ(d, c, color):
    d.ellipse([c['center_x'] - c['radius'], c['center_y'] - c['radius'], c['center_x'] + c['radius'], c['center_y'] + c['radius']], fill=color)
def icon(d, b): d.rectangle([b['x'], b['y'], b['x'] + b['w'], b['y'] + b['h']], outline=C['green'], width=2)
def mask(im, shape):
    if shape != 'r': return im
    m = Image.new('L', im.size, 0); ImageDraw.Draw(m).ellipse([0, 0, im.size[0] - 1, im.size[1] - 1], fill=255)
    bg = Image.new('RGB', im.size, '#202020'); bg.paste(im, (0, 0), m); return bg
def save(im, name, shape): mask(im, shape).save(os.path.join(OUT, f'{name}.{shape}.png'))

for shape in ['r', 's']:
    l = L[f'index.{shape}']; im, d = canvas(shape)
    arc(d, l['RING'], C['track'], 270); arc(d, l['RING'], C['green'], l['RING']['start_angle'] + 360 * 0.88)
    rrect(d, l['DISC'], C['bg']); icon(d, l['SHIELD']); txt(d, l['TITLE'], "You're covered", C['text'])
    for row, (lab, val, vc) in zip(l['ROWS'], [('Last check', 'Just now', C['textSoft']), ('Battery', '78%', C['textSoft']), ('Phone', 'Connected', C['green'])]):
        rrect(d, row['rect'], C['card']); txt(d, row['label'], lab, C['muted'], 'l'); txt(d, row['value'], val, vc, 'r')
    save(im, 'home', shape)

    l = L[f'alert.{shape}']; im, d = canvas(shape)
    for g in l['GLOW']:
        ov = Image.new('RGBA', im.size, (0, 0, 0, 0))
        ImageDraw.Draw(ov).ellipse([g['center_x'] - g['radius'], g['center_y'] - g['radius'], g['center_x'] + g['radius'], g['center_y'] + g['radius']], fill=(255, 59, 47, g['alpha']))
        im = Image.alpha_composite(im.convert('RGBA'), ov).convert('RGB'); d = ImageDraw.Draw(im)
    txt(d, l['TITLE'], 'Are you alright?', C['text']); arc(d, l['RING'], C['track'], 270); arc(d, l['RING'], C['red'], l['RING']['start_angle'] + 360 * 0.58)
    txt(d, l['SECONDS'], '28', C['text']); txt(d, l['CAPTION1'], "We'll call Anna,", C['caption']); txt(d, l['CAPTION2'], 'then emergency services', C['redSoft'])
    rrect(d, l['FINE_BTN'], C['white']); txt(d, l['FINE_BTN'], "I'm fine", C['ink']); txt(d, l['HELP_BTN'], 'Get help now', C['redSoft'])
    save(im, 'alert', shape)

    l = L[f'result.{shape}']; im, d = canvas(shape)
    circ(d, l['OK_DISC'], C['greenDeep']); icon(d, l['OK_CHECK'])
    txt(d, l['OK_TITLE'], "Glad you're OK", C['text']); txt(d, l['OK_LINE1'], 'Nobody was called.', C['muted'])
    txt(d, l['OK_LINE2'], "We'll keep watching.", C['muted']); txt(d, l['OK_CLOSING'], 'Closing in 3s', C['faint'])
    save(im, 'result-ok', shape)
    im, d = canvas(shape)
    txt(d, l['SOS_HEADER'], 'CONTACTING', C['redSoft']); circ(d, l['SOS_AVATAR'], C['avatar']); txt(d, l['SOS_INITIALS'], 'AR', C['textSoft'])
    txt(d, l['SOS_NAME'], 'Anna Reyes', C['text']); txt(d, l['SOS_STATUS'], 'Alert sent · location shared', C['green'])
    rrect(d, l['SOS_DONE'], C['card']); txt(d, l['SOS_DONE'], 'Done', C['redSoft'])
    save(im, 'result-sos', shape)

    l = L[f'settings.{shape}']; im, d = canvas(shape)
    txt(d, l['TITLE'], 'How careful?', C['text'])
    for i, (row, (lab, sub)) in enumerate(zip(l['ROWS'], [('Relaxed', 'Hard falls only'), ('Balanced', 'What we suggest'), ('Watchful', 'May ask more often')])):
        sel = i == 1
        rrect(d, row['rect'], C['redCard'] if sel else C['card'], outline=C['red'] if sel else None, width=2 if sel else 0)
        if sel: circ(d, row['radio'], C['red']); circ(d, row['radioDot'], C['bg'])
        else: circ(d, row['radio'], C['radioOff']); circ(d, row['radioInner'], C['card'])
        txt(d, row['label'], lab, C['text'] if sel else C['textSoft'], 'l'); txt(d, row['sub'], sub, C['caption'] if sel else C['dim'], 'l')
    t = l['TOGGLE']; rrect(d, t['rect'], C['card']); txt(d, t['label'], 'Watch siren', C['textSoft'], 'l'); rrect(d, t['track'], C['green']); circ(d, t['knobOn'], C['white'])
    save(im, 'settings', shape)

names = ['home', 'alert', 'result-ok', 'result-sos', 'settings']
sheet = Image.new('RGB', (len(names) * 500, 950), '#303030')
for i, n in enumerate(names):
    sheet.paste(Image.open(os.path.join(OUT, f'{n}.r.png')), (i * 500 + 10, 10))
    sheet.paste(Image.open(os.path.join(OUT, f'{n}.s.png')), (i * 500 + 55, 500))
sheet.save(os.path.join(OUT, 'sheet.png'))
print('wrote', os.path.join(OUT, 'sheet.png'))
