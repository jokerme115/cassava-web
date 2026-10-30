"""Advanced c384 ensemble loading and CPU inference, no training."""
from verify_models_cpu_20261029 import ROOT, np, torch, Image, predict_roi, load_member, native_tensor, members
import json
import time

rgb = np.asarray(Image.open(ROOT/'output/upgrade-cpu-cassava-input.png').convert('RGB'))
torch.set_num_threads(8)
started = time.perf_counter()
actual = predict_roi(rgb, 'pbt_c384')
votes = np.zeros(rgb.shape[:2], np.uint8)
with torch.inference_mode():
    for member in members('pbt_c384'):
        votes += load_member('pbt_c384', member['file'], member['sha256'])(native_tensor(rgb)).argmax(1)[0,:rgb.shape[0],:rgb.shape[1]].numpy().astype(np.uint8)
assert np.array_equal(actual, votes >= 3)
report = {'model': 'pbt_c384', 'members_loaded': 5, 'device': 'cpu', 'pixels_equal': True, 'seconds': round(time.perf_counter()-started, 3)}
(ROOT/'output/c384-cpu-verification.json').write_text(json.dumps(report, indent=2), encoding='utf-8')
print(json.dumps(report))
