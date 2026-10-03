#!/usr/bin/env python3
"""
巨天agent 应用图标生成器 v2 —— 深空玻璃

设计语言（与应用毛玻璃 UI 一脉相承）：
  - 深空石墨渐变底板（对角 #2E2E36 -> #0B0B0F）
  - 顶部玻璃高光带（磨砂反光）
  - 翡翠辉光晕（agent 在场的生命感）
  - 白色「巨」字形标识（与 BrandMark 同构：方框 + 中横），带柔和投影
  - 右下翡翠状态点（呼吸感细节）
  - 内圈发丝高光描边

产出：electron/icon_new_1024.png / icon.iconset/* / icon.icns / icon.ico / public/icon.png
"""
import os
import shutil
import subprocess
from PIL import Image, ImageDraw, ImageFilter, ImageEnhance

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)

SIZE = 1024
SS = 4
W = SIZE * SS

MARGIN = 72
RADIUS = 200

G_TOP = (58, 58, 70)
G_BOT = (13, 13, 18)
GLYPH_TOP = (255, 255, 255)
GLYPH_BOT = (208, 210, 222)
EMERALD = (52, 211, 153)
EMERALD_DEEP = (16, 185, 129)


def rounded_mask(size, margin, radius):
    m = Image.new('L', (size, size), 0)
    ImageDraw.Draw(m).rounded_rectangle(
        [margin, margin, size - margin - 1, size - margin - 1],
        radius=radius, fill=255)
    return m


def diagonal_gradient(size, c_top, c_bot):
    """显式对角渐变：t=(x+y)/(2*max)，左上 c_top -> 右下 c_bot（在小图上算，再放大）"""
    n = 512
    img = Image.new('RGB', (n, n))
    px = img.load()
    m = 2 * (n - 1)
    for y in range(n):
        for x in range(n):
            t = (x + y) / m
            px[x, y] = (
                int(c_top[0] + (c_bot[0] - c_top[0]) * t),
                int(c_top[1] + (c_bot[1] - c_top[1]) * t),
                int(c_top[2] + (c_bot[2] - c_top[2]) * t),
            )
    g = img.resize((size, size), Image.BILINEAR).convert('RGBA')
    return g


def bar(draw, x0, y0, x1, y1, radius, color):
    draw.rounded_rectangle([x0, y0, x1, y1], radius=radius, fill=color)


def build_master():
    s = SS
    margin, radius = MARGIN * s, RADIUS * s
    mask = rounded_mask(W, margin, radius)

    canvas = Image.new('RGBA', (W, W), (0, 0, 0, 0))

    shadow_mask = Image.new('L', (W, W), 0)
    ImageDraw.Draw(shadow_mask).rounded_rectangle(
        [margin, margin + 14 * s, W - margin - 1, W - margin - 1 + 14 * s],
        radius=radius, fill=90)
    shadow = Image.new('RGBA', (W, W), (0, 0, 0, 0))
    shadow.paste((0, 0, 0, 255), (0, 0), shadow_mask.filter(ImageFilter.GaussianBlur(22 * s)))
    canvas = Image.alpha_composite(canvas, shadow)

    plate = diagonal_gradient(W, G_TOP, G_BOT)
    canvas.paste(plate, (0, 0), mask)

    # inner 层用 alpha 合成（paste 会把底板抹成透明）
    inner = Image.new('RGBA', (W, W), (0, 0, 0, 0))

    glow = Image.new('RGBA', (W, W), (0, 0, 0, 0))
    gd = ImageDraw.Draw(glow)
    cx, cy = W // 2, int(W * 0.56)
    gd.ellipse([cx - 320 * s, cy - 250 * s, cx + 320 * s, cy + 250 * s],
               fill=EMERALD_DEEP + (115,))
    glow = glow.filter(ImageFilter.GaussianBlur(120 * s))
    inner = Image.alpha_composite(inner, glow)

    hl_alpha = Image.linear_gradient('L')
    hl_alpha = hl_alpha.transpose(Image.FLIP_TOP_BOTTOM)
    hl_alpha = hl_alpha.resize((W, int(W * 0.62)), Image.BILINEAR)
    hl_alpha = hl_alpha.point(lambda v: int(v * 0.2))
    hl = Image.new('RGBA', (W, W), (0, 0, 0, 0))
    white = Image.new('RGBA', (W, int(W * 0.62)), (255, 255, 255, 255))
    hl.paste(white, (0, 0), hl_alpha)
    inner = Image.alpha_composite(inner, hl)

    vg = Image.linear_gradient('L').resize((W, W), Image.BILINEAR)
    vg = vg.point(lambda v: int(v * 0.16))
    dark = Image.new('RGBA', (W, W), (0, 0, 0, 255))
    vlayer = Image.new('RGBA', (W, W), (0, 0, 0, 0))
    vlayer.paste(dark, (0, 0), vg)
    inner = Image.alpha_composite(inner, vlayer)

    sw = 44 * s
    h = sw / 2
    L, R = 224 * s, 800 * s
    T, B = 306 * s, 718 * s
    M = (T + B) / 2
    cr = 18 * s

    glyph_shadow = Image.new('RGBA', (W, W), (0, 0, 0, 0))
    gsd = ImageDraw.Draw(glyph_shadow)
    for (x0, y0, x1, y1) in [
        (L - h, T - h, R + h, T + h),
        (R - h, T - h, R + h, B + h),
        (L - h, B - h, R + h, B + h),
        (L - h, T - h, L + h, B + h),
        (L - h, M - h, R + h, M + h),
    ]:
        gsd.rounded_rectangle([x0, y0 + 10 * s, x1, y1 + 10 * s], radius=cr, fill=(0, 0, 0, 110))
    glyph_shadow = glyph_shadow.filter(ImageFilter.GaussianBlur(14 * s))
    inner = Image.alpha_composite(inner, glyph_shadow)

    glyph_grad = diagonal_gradient(W, GLYPH_TOP, GLYPH_BOT)
    glyph_mask = Image.new('L', (W, W), 0)
    gmd = ImageDraw.Draw(glyph_mask)
    gmd.rounded_rectangle([L - h, T - h, R + h, T + h], radius=cr, fill=255)
    gmd.rounded_rectangle([R - h, T - h, R + h, B + h], radius=cr, fill=255)
    gmd.rounded_rectangle([L - h, B - h, R + h, B + h], radius=cr, fill=255)
    gmd.rounded_rectangle([L - h, T - h, L + h, B + h], radius=cr, fill=255)
    gmd.rounded_rectangle([L - h, M - h, R + h, M + h], radius=cr, fill=255)
    glyph_layer = Image.new('RGBA', (W, W), (0, 0, 0, 0))
    glyph_layer.paste(glyph_grad, (0, 0), glyph_mask)
    inner = Image.alpha_composite(inner, glyph_layer)

    # inner 层限制在圆角形状内，再整体合成到底板之上
    from PIL import ImageChops
    inner.putalpha(ImageChops.multiply(inner.getchannel('A'), mask))
    canvas = Image.alpha_composite(canvas, inner)

    dot_layer = Image.new('RGBA', (W, W), (0, 0, 0, 0))
    dl = ImageDraw.Draw(dot_layer)
    dx, dy, dr = int(W * 0.76), int(W * 0.76), 27 * s
    dl.ellipse([dx - dr * 2.1, dy - dr * 2.1, dx + dr * 2.1, dy + dr * 2.1], fill=EMERALD + (42,))
    from PIL import ImageChops
    dot_layer.putalpha(ImageChops.multiply(dot_layer.getchannel('A'), mask))
    canvas = Image.alpha_composite(canvas, dot_layer)
    glow_dot = dot_layer.filter(ImageFilter.GaussianBlur(34 * s))
    canvas = Image.alpha_composite(canvas, glow_dot)
    dd = ImageDraw.Draw(canvas)
    dd.ellipse([dx - dr, dy - dr, dx + dr, dy + dr], fill=EMERALD + (255,))
    dd.ellipse([dx - dr * 0.42, dy - dr * 0.5, dx + dr * 0.1, dy + dr * 0.05],
               fill=(255, 255, 255, 160))

    d = ImageDraw.Draw(canvas)
    d.rounded_rectangle([margin, margin, W - margin - 1, W - margin - 1],
                        radius=radius, outline=(255, 255, 255, 46), width=max(1, int(2 * s)))
    d.rounded_rectangle([margin - 1, margin - 1, W - margin, W - margin],
                        radius=radius + 1, outline=(0, 0, 0, 90), width=max(1, int(2 * s)))

    canvas = ImageEnhance.Contrast(canvas).enhance(1.02)
    return canvas.resize((SIZE, SIZE), Image.LANCZOS)


def write_iconset(master, iconset_dir):
    if os.path.isdir(iconset_dir):
        shutil.rmtree(iconset_dir)
    os.makedirs(iconset_dir)
    specs = [
        (16, 'icon_16x16.png'), (32, 'icon_16x16@2x.png'),
        (32, 'icon_32x32.png'), (64, 'icon_32x32@2x.png'),
        (128, 'icon_128x128.png'), (256, 'icon_128x128@2x.png'),
        (256, 'icon_256x256.png'), (512, 'icon_256x256@2x.png'),
        (512, 'icon_512x512.png'), (1024, 'icon_512x512@2x.png'),
    ]
    for px, name in specs:
        master.resize((px, px), Image.LANCZOS).save(os.path.join(iconset_dir, name))
    return iconset_dir


def main():
    master = build_master()
    master.save(os.path.join(HERE, 'icon_new_1024.png'))
    print('OK icon_new_1024.png')

    pub = os.path.join(ROOT, 'public', 'icon.png')
    os.makedirs(os.path.dirname(pub), exist_ok=True)
    master.save(pub)
    print('OK public/icon.png')

    iconset = write_iconset(master, os.path.join(HERE, 'icon.iconset'))
    icns = os.path.join(HERE, 'icon.icns')
    try:
        subprocess.run(['iconutil', '-c', 'icns', iconset, '-o', icns], check=True)
        print('OK icon.icns')
    except Exception as e:
        print('iconutil failed:', e)

    ico = os.path.join(HERE, 'icon.ico')
    master.save(ico, sizes=[(16, 16), (24, 24), (32, 32), (48, 48), (64, 64), (128, 128), (256, 256)])
    print('OK icon.ico')


if __name__ == '__main__':
    main()
