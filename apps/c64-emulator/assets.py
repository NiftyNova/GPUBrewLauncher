from pathlib import Path
from PIL import Image, ImageDraw, ImageFont, ImageFilter

root = Path(__file__).resolve().parent
font_path = '/usr/share/fonts/truetype/dejavu/DejaVuSansMono-Bold.ttf'
font = ImageFont.truetype(font_path, 46)
small = ImageFont.truetype(font_path, 22)

# A beige C64 monitor with a rainbow boot screen.
im = Image.new('RGBA', (256, 256), (18, 20, 26, 255))
d = ImageDraw.Draw(im)
d.rounded_rectangle((20, 22, 236, 234), radius=22, fill=(202, 186, 150, 255), outline=(116, 101, 74, 255), width=4)
d.rounded_rectangle((34, 36, 222, 188), radius=14, fill=(28, 31, 38, 255), outline=(82, 71, 52, 255), width=3)

# Screen glow.
screen = Image.new('RGBA', (188, 152), (10, 12, 18, 255))
sd = ImageDraw.Draw(screen)
colors = [(104, 55, 43), (53, 40, 121), (88, 141, 67), (184, 199, 111), (154, 103, 89), (108, 108, 108)]
for i, c in enumerate(colors):
    sd.rectangle((0, i * 5, 188, i * 5 + 4), fill=c + (255,))
sd.text((14, 42), 'C64', font=font, fill=(226, 236, 255, 255))
sd.text((14, 94), 'GPU', font=font, fill=(146, 246, 205, 255))
screen = screen.filter(ImageFilter.GaussianBlur(0.6))
im.paste(screen, (34, 36))

# C64 badge and a power LED.
d.text((38, 196), 'COMMODORE 64', font=small, fill=(72, 61, 43, 255))
d.ellipse((198, 202, 210, 214), fill=(92, 220, 120, 255))
d.rounded_rectangle((34, 222, 222, 228), radius=3, fill=(168, 151, 116, 255))

im.save(root / 'assets/icon.png')
