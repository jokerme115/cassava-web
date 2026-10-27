from pathlib import Path
from datetime import datetime
import csv,zipfile,shutil
import cv2,numpy as np
from PIL import Image,ImageDraw,ImageFont
root=Path.cwd(); src=root/'docs/图片9数据导出_20261015_090723'
out=root/'docs'/('图片9无标题轮廓交付_'+datetime.now().strftime('%Y%m%d_%H%M%S'));out.mkdir()
rows=list(csv.DictReader((src/'PPD数值.csv').open(encoding='utf-8-sig')))
def font(n):return ImageFont.truetype('C:/Windows/Fonts/msyh.ttc',n)
colors=[(45,212,191),(255,83,114)]
for n in range(9,10):
 data=[r for r in rows if r['图片']==f'图片{n}']; total=next(r for r in data if r['范围']=='整图合计')
 sub=src/f'图片{n}_原始横截面与二值掩码'
 sheet=Image.new('RGB',(1440,680),'white');d=ImageDraw.Draw(sheet)
 d.text((40,25),f'图片{n}  |  横截面与掩码轮廓',font=font(32),fill='#152536')
 d.text((40,78),f'整图 PPD = {float(total["PPD(%)"]):.2f}%    ·    {total["结果来源"]}',font=font(25),fill='#334155')
 for j in range(1,4):
  im=Image.open(sub/f'横截面{j}.png').convert('RGB');w,h=im.size
  masks=[np.array(Image.open(sub/f'横截面{j}_{name}掩码.png').convert('L'))>0 for name in ['木薯','腐烂']]
  scale=min(410/w,410/h);size=(round(w*scale),round(h*scale))
  panel=im.resize(size,Image.Resampling.LANCZOS);pd=ImageDraw.Draw(panel)
  for mask,color in zip(masks,colors):
   contours,_=cv2.findContours(mask.astype('uint8'),cv2.RETR_LIST,cv2.CHAIN_APPROX_NONE)
   for contour in contours:
    points=[((float(x)+.5)*size[0]/w-.5,(float(y)+.5)*size[1]/h-.5) for x,y in contour[:,0,:]]
    if len(points)>1:pd.line(points+[points[0]],fill=color,width=3,joint='curve')
  x=35+(j-1)*475+(420-size[0])//2;y=155+(410-size[1])//2
  sheet.paste(panel,(x,y))
  row=next(r for r in data if r['范围']==f'横截面{j}')
  d.text((55+(j-1)*475,580),f'横截面{j}   PPD = {float(row["PPD(%)"]):.2f}%',font=font(24),fill='#152536')
 d.line((40,644,75,644),fill=colors[0],width=4);d.text((85,629),'木薯边界',font=font(20),fill='#334155')
 d.line((260,644,295,644),fill=colors[1],width=4);d.text((305,629),'腐烂边界',font=font(20),fill='#334155')
 d.text((565,629),'PPD = 腐烂像素 / 木薯像素 × 100%',font=font(20),fill='#334155')
 sheet.crop((0, 140, 1440, 680)).save(out/f'图片{n}_横截面轮廓_PPD_{float(total["PPD(%)"]):.2f}%.png',dpi=(300,300))
shutil.copy2(src/'PPD数值.csv',out/'PPD数值.csv')
archive=out.with_suffix('.zip')
with zipfile.ZipFile(archive,'w',zipfile.ZIP_DEFLATED) as z:
 for p in out.iterdir():z.write(p,p.name)
print(out);print(archive)


