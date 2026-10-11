from PIL import Image, ImageDraw, ImageFilter
S = 1024
img = Image.new("RGBA", (S, S), (0, 0, 0, 0))
d = ImageDraw.Draw(img)
# macOS-style rounded square, dark warm background
d.rounded_rectangle((100, 100, 924, 924), radius=185, fill=(28, 25, 22, 255))
# fretboard: wood strip with frets and strings
fb = Image.new("RGBA", (S, S), (0, 0, 0, 0)); f = ImageDraw.Draw(fb)
f.rectangle((100, 360, 924, 664), fill=(52, 38, 28, 255))
for x in (250, 420, 570, 700, 815):
    f.rectangle((x, 360, x + 7, 664), fill=(183, 166, 138, 170))
for i, y in enumerate(range(385, 664, 54)):
    f.rectangle((100, y, 924, y + 2 + i // 2), fill=(217, 205, 180, 200))
mask = Image.new("L", (S, S), 0); ImageDraw.Draw(mask).rounded_rectangle((100, 100, 924, 924), radius=185, fill=255)
img.paste(fb, (0, 0), Image.composite(fb, Image.new("RGBA", (S, S)), mask))
d = ImageDraw.Draw(img)
# dots on the neck: green chord notes, orange home note
for (cx, cy, col) in ((175, 493, (126, 217, 139)), (870, 439, (126, 217, 139)), (762, 601, (255, 173, 51))):
    d.ellipse((cx - 30, cy - 30, cx + 30, cy + 30), fill=col + (255,))
# the pick: a classic rounded triangle (corners rounded by blur + threshold)
def pickmask(scale=1.0, dx=0, dy=0):
    m = Image.new("L", (S, S), 0)
    pts = [(512 + (x - 512) * scale + dx, 520 + (y - 520) * scale + dy) for x, y in ((265, 285), (759, 285), (512, 820))]
    ImageDraw.Draw(m).polygon(pts, fill=255)
    m = m.filter(ImageFilter.GaussianBlur(70))
    return m.point(lambda v: 255 if v > 92 else 0).filter(ImageFilter.GaussianBlur(1.2))
body = pickmask()
glow = Image.new("RGBA", (S, S), (255, 173, 51, 0)); glow.putalpha(body.filter(ImageFilter.GaussianBlur(26)).point(lambda v: v * 0.55))
img = Image.alpha_composite(img, glow)
img.paste(Image.new("RGBA", (S, S), (255, 173, 51, 255)), (0, 0), body)
shine = pickmask(0.62, -55, -60)
img.paste(Image.new("RGBA", (S, S), (255, 214, 140, 255)), (0, 0), shine.point(lambda v: v * 0.55))
img.paste(Image.new("RGBA", (S, S), (255, 173, 51, 255)), (0, 0), pickmask(0.62, -25, -20))
img.save("/Users/denizyildiz/masterprac/assets/icon.png")
