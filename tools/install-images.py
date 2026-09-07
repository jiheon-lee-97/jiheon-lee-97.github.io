#!/usr/bin/env python3
"""
Validate and install the two portraits WITHOUT looking at them.

Reads only PNG chunk headers (type + length) and the 13-byte IHDR, which
carries dimensions/bit-depth/colour-type. Pixel data (IDAT) is copied byte
for byte and never decompressed, so image content is never decoded here.

  python3 tools/install-images.py           # inspect only
  python3 tools/install-images.py --install # inspect, strip metadata, install
"""
import struct, sys, zlib, pathlib

ROOT = pathlib.Path(__file__).resolve().parent.parent
SRC = [ROOT/'incoming'/'image0.png', ROOT/'incoming'/'image1.png']
DST = [ROOT/'images'/'start.png',    ROOT/'images'/'end.png']

COLOR = {0:'grayscale', 2:'RGB', 3:'palette', 4:'grayscale+alpha', 6:'RGBA'}
# chunks worth keeping: structure + colour fidelity. everything else is
# metadata that would be published to the open web along with the image.
KEEP = {b'IHDR', b'PLTE', b'tRNS', b'IDAT', b'IEND',
        b'gAMA', b'cHRM', b'sRGB', b'iCCP', b'sBIT', b'pHYs'}
PRIVACY = {b'eXIf': 'EXIF (may contain GPS, camera serial, timestamps)',
           b'tEXt': 'text metadata', b'iTXt': 'text metadata',
           b'zTXt': 'compressed text metadata', b'tIME': 'last-modified time'}

def chunks(raw):
    if raw[:8] != b'\x89PNG\r\n\x1a\n':
        raise SystemExit('not a PNG (bad signature)')
    o = 8
    while o < len(raw):
        (ln,) = struct.unpack('>I', raw[o:o+4])
        yield raw[o+4:o+8], raw[o+8:o+8+ln]
        o += 12 + ln

def inspect(path):
    raw = path.read_bytes()
    info, seen = None, []
    for typ, data in chunks(raw):
        seen.append(typ)
        if typ == b'IHDR':
            w, h, depth, ct, _, _, il = struct.unpack('>IIBBBBB', data[:13])
            info = dict(w=w, h=h, depth=depth, ct=ct, interlace=il)
    if not info:
        raise SystemExit(f'{path.name}: no IHDR chunk')
    info['bytes'] = len(raw)
    info['chunks'] = seen
    return raw, info

def strip(raw):
    out = [b'\x89PNG\r\n\x1a\n']
    removed = []
    for typ, data in chunks(raw):
        if typ in KEEP:
            out.append(struct.pack('>I', len(data)) + typ + data +
                       struct.pack('>I', zlib.crc32(typ + data) & 0xffffffff))
        else:
            removed.append(typ.decode('latin1'))
    return b''.join(out), removed

def main():
    do_install = '--install' in sys.argv
    for p in SRC:
        if not p.exists():
            raise SystemExit(f'missing {p.relative_to(ROOT)} - see incoming/DROP_IMAGES_HERE.txt')

    blobs, infos = [], []
    for p in SRC:
        raw, i = inspect(p)
        blobs.append(raw); infos.append(i)
        print(f'{p.name}')
        print(f'  {i["w"]} x {i["h"]} px   {i["depth"]}-bit {COLOR.get(i["ct"], "?")}'
              f'{"   INTERLACED" if i["interlace"] else ""}')
        print(f'  {i["bytes"]/1024:.0f} KB on disk')
        flagged = [PRIVACY[c] for c in i['chunks'] if c in PRIVACY]
        print('  metadata: ' + (', '.join(sorted(set(flagged))) if flagged else 'none found'))

    a, b = infos
    if (a['w'], a['h']) != (b['w'], b['h']):
        raise SystemExit(f'\nFAIL dimensions differ: {a["w"]}x{a["h"]} vs {b["w"]}x{b["h"]}'
                         '\nthe two images must match exactly.')

    total = a['w'] * a['h']
    print(f'\nOK  dimensions match: {a["w"]} x {a["h"]}')
    print(f'    {total:,} pixels -> {total:,} visits to fully converge')
    print(f'    page weight: {(infos[0]["bytes"]+infos[1]["bytes"])/1024:.0f} KB for both')
    if a['w'] != a['h']:
        print('    note: not square; shown whole, so the page reserves its exact aspect ratio')
    if total > 1_000_000:
        print('    note: >1M pixels. works, but slower to composite and very slow to converge')

    if not do_install:
        print('\n(inspect only - rerun with --install to publish)')
        return

    for raw, dst, src in zip(blobs, DST, SRC):
        clean, removed = strip(raw)
        dst.write_bytes(clean)
        note = f'stripped {", ".join(removed)}' if removed else 'no metadata to strip'
        print(f'installed {src.name} -> {dst.relative_to(ROOT)}  ({note}, '
              f'{len(clean)/1024:.0f} KB)')

main()
