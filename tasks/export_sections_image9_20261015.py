from pathlib import Path
from datetime import datetime
import sqlite3,json,csv,zipfile
import numpy as np
import cv2
from PIL import Image,ImageDraw,ImageFont
root=Path.cwd(); media=root/'网页/back/cassavaBack/media'
out=root/'docs'/('图片9数据导出_'+datetime.now().strftime('%Y%m%d_%H%M%S'));out.mkdir()
c=sqlite3.connect(f'file:{(root/"网页/back/cassavaBack/db.sqlite3").as_posix()}?mode=ro',uri=True);c.row_factory=sqlite3.Row
fontpath='C:/Windows/Fonts/msyh.ttc'
def font(n):return ImageFont.truetype(fontpath,n)
rows=[]; sources=[]
for num,iid in enumerate(range(55,56),9):
 imrow=c.execute('SELECT * FROM predict_cassavaimage WHERE id=?',(iid,)).fetchone()
 corr=c.execute('SELECT pc.* FROM predict_predictioncorrection pc JOIN predict_predictionresult p ON p.id=pc.prediction_id WHERE p.original_image_id=? ORDER BY pc.created_at DESC,pc.version DESC LIMIT 1',(iid,)).fetchone()
 pred=c.execute('SELECT * FROM predict_predictionresult WHERE original_image_id=? ORDER BY id DESC LIMIT 1',(iid,)).fetchone()
 src=corr or pred; prediction_id=corr['prediction_id'] if corr else pred['id']
 original=Image.open(media/imrow['oss_key']).convert('RGB')
 cass=np.array(Image.open(media/src['cassava_mask_key']).convert('L'))>0
 rotten=np.array(Image.open(media/src['rotten_mask_key']).convert('L'))>0
 assert original.size==(cass.shape[1],cass.shape[0]) and cass.shape==rotten.shape
 assert not np.any(rotten & ~cass)
 ppd=rotten.sum()/cass.sum()*100
 expected=corr['ppd_percent'] if corr else pred['ppd_value']
 assert abs(ppd-expected)<1e-7
 n,labels,stats,cent=cv2.connectedComponentsWithStats(cass.astype('uint8'))
 parts=sorted(range(1,n),key=lambda k:stats[k,0]);assert len(parts)==3
 source=f'人工校正 v{corr["version"]}' if corr else '模型预测（未人工校正）'
 sub=out/f'图片{num}_原始横截面与二值掩码';sub.mkdir()
 canvas=Image.new('RGB',(1120,1160),'#ffffff');d=ImageDraw.Draw(canvas)
 d.text((44,28),f'图片{num}  |  横截面与掩码',font=font(32),fill='#152536')
 d.text((44,78),f'整图 PPD = {ppd:.2f}%    ·    {source}',font=font(25),fill='#263a50')
 d.text((190,137),'横截面',font=font(23),fill='#334155');d.text((710,137),'分割掩码',font=font(23),fill='#334155')
 for j,k in enumerate(parts,1):
  x,y,w,h,area=map(int,stats[k]); pad=10
  x0=max(0,x-pad);y0=max(0,y-pad);x1=min(cass.shape[1],x+w+pad);y1=min(cass.shape[0],y+h+pad)
  cm=(labels==k)[y0:y1,x0:x1];rm=rotten[y0:y1,x0:x1]&cm
  value=rm.sum()/cm.sum()*100
  crop=original.crop((x0,y0,x1,y1))
  crop.save(sub/f'横截面{j}.png')
  Image.fromarray(cm.astype('uint8')*255).save(sub/f'横截面{j}_木薯掩码.png')
  Image.fromarray(rm.astype('uint8')*255).save(sub/f'横截面{j}_腐烂掩码.png')
  mask=np.zeros((*cm.shape,3),dtype='uint8');mask[:]=[15,23,42];mask[cm]=[45,212,191];mask[rm]=[251,113,133]
  mp=Image.fromarray(mask)
  cy=185+(j-1)*300
  for image,left,resample in [(crop,45,Image.Resampling.LANCZOS),(mp,590,Image.Resampling.NEAREST)]:
   scaled=image.copy();scaled.thumbnail((450,240),resample=resample)
   # Display at a uniform enlarged size, leaving data PNGs at native resolution.
   scale=min(450/image.width,240/image.height);scaled=image.resize((round(image.width*scale),round(image.height*scale)),resample)
   canvas.paste(scaled,(left+(450-scaled.width)//2,cy+(240-scaled.height)//2))
  d.text((50,cy+248),f'横截面 {j}（从左至右）',font=font(21),fill='#334155')
  d.text((605,cy+248),f'PPD = {value:.2f}%',font=font(24),fill='#152536')
  rows.append({'图片':f'图片{num}','范围':f'横截面{j}','结果来源':source,'预测ID':prediction_id,'木薯像素':int(cm.sum()),'腐烂像素':int(rm.sum()),'PPD(%)':round(float(value),8)})
 d.rectangle((45,1100,65,1120),fill=(45,212,191));d.text((75,1096),'木薯区域',font=font(19),fill='#334155')
 d.rectangle((250,1100,270,1120),fill=(251,113,133));d.text((280,1096),'腐烂区域',font=font(19),fill='#334155')
 d.text((520,1096),'PPD = 腐烂像素 / 木薯像素 × 100%',font=font(19),fill='#334155')
 canvas.save(out/f'图片{num}_横截面与掩码_PPD_{ppd:.2f}%.png',dpi=(300,300))
 rows.append({'图片':f'图片{num}','范围':'整图合计','结果来源':source,'预测ID':prediction_id,'木薯像素':int(cass.sum()),'腐烂像素':int(rotten.sum()),'PPD(%)':round(float(ppd),8)})
 sources.append({'image':num,'prediction_id':prediction_id,'correction_version':corr['version'] if corr else None,'cassava_mask':src['cassava_mask_key'],'rotten_mask':src['rotten_mask_key'],'ppd_percent':float(ppd)})
with (out/'PPD数值.csv').open('w',encoding='utf-8-sig',newline='') as f:
 writer=csv.DictWriter(f,fieldnames=list(rows[0]));writer.writeheader();writer.writerows(rows)
(root/'tasks/2026-10-15-图片9导出来源.json').write_text(json.dumps(sources,ensure_ascii=False,indent=2),encoding='utf-8')
archive=out.with_suffix('.zip')
with zipfile.ZipFile(archive,'w',zipfile.ZIP_DEFLATED) as z:
 for p in out.rglob('*'):
  if p.is_file():z.write(p,p.relative_to(out))
print(json.dumps({'directory':str(out),'zip':str(archive),'summary':sources},ensure_ascii=False))

