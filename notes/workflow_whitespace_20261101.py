from pathlib import Path
p=Path('网页/front/cassava_front/src/components/PredictionModule.tsx')
p.write_text(p.read_text(encoding='utf-8').rstrip()+'\n',encoding='utf-8')
