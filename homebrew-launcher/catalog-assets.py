"""Rasterize package labels/icons into a fixed GPU catalog buffer."""
import json, struct, sys
from pathlib import Path
from PIL import Image, ImageDraw, ImageFont, ImageOps

apps=json.loads(Path(sys.argv[1]).read_text())
assert len(apps)<=32
slots=bytearray(32*131072)
font='/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf'
for i,app in enumerate(apps):
    image=Image.new('L',(512,128)); draw=ImageDraw.Draw(image); sizes=[]
    for text,size,y in [(app['name'],34,0),(app['description'],18,64)]:
        face=ImageFont.truetype(font,size)
        while draw.textbbox((0,0),text,font=face)[2]>508:
            text=text[:-2]+'…'
        box=draw.textbbox((0,0),text,font=face)
        draw.text((-box[0],y-box[1]),text,fill=255,font=face)
        sizes.extend([box[2]-box[0],box[3]-box[1]])
    base=i*131072
    slots[base:base+65536]=image.tobytes()
    icon=Image.open(app['icon']); assert icon.width<=4096 and icon.height<=4096
    icon=ImageOps.contain(icon.convert('RGBA'),(96,96),Image.Resampling.LANCZOS)
    tile=Image.new('RGBA',(96,96));tile.alpha_composite(icon,((96-icon.width)//2,(96-icon.height)//2))
    slots[base+65536:base+102400]=tile.tobytes()
    struct.pack_into('<4I',slots,base+102400,*sizes)
Path(sys.argv[2]).write_bytes(slots)
