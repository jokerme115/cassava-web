"""Fetch only the already-frozen selected weights and portable archive runtime.

No training, system installation, or production configuration changes.
"""
import hashlib
import json
import shutil
import subprocess
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
PAPER = ROOT.parent / '木薯有监督学习论文'
BACK = ROOT / '网页/back/cassavaBack'
ASSETS = BACK / 'model_assets'
CODE = BACK / 'predict/frozen_models'


def digest(path):
    result = hashlib.sha256()
    with path.open('rb') as stream:
        for chunk in iter(lambda: stream.read(8 * 1024**2), b''):
            result.update(chunk)
    return result.hexdigest()


def remote(path, destination, expected=None):
    destination.parent.mkdir(parents=True, exist_ok=True)
    if destination.exists():
        if expected and digest(destination) != expected:
            raise RuntimeError(f'Existing asset hash differs: {destination.name}')
        return
    part = destination.with_suffix(destination.suffix + '.part')
    subprocess.run(['scp', '-q', '-o', 'BatchMode=yes', '-o', 'StrictHostKeyChecking=yes',
                    'cassava-login:' + path, str(part)], check=True, timeout=900)
    if expected and digest(part) != expected:
        raise RuntimeError(f'Weight hash mismatch: {destination.name}')
    part.rename(destination)


def main():
    ASSETS.mkdir(parents=True, exist_ok=True)
    CODE.mkdir(parents=True, exist_ok=True)
    selected = []
    pbt = json.loads((PAPER/'tasks/2026-10-27-PBT最终实验/FROZEN_PROTOCOL.json').read_text(encoding='utf-8'))
    for item in pbt['configs']:
        selected.append({**item, 'key': 'pbt_c' + str(item['crop'])})
    modern = json.loads((PAPER/'tasks/2026-10-26-统一最终评价/FROZEN_PROTOCOL.json').read_text(encoding='utf-8'))
    for item in modern['configs']:
        if (item['arm'], item['seed']) in [('D_hrnet_w48', 101), ('E_mask2former_swin_t', 42)]:
            selected.append({**item, 'key': 'hrnet_w48' if item['arm']=='D_hrnet_w48' else 'mask2former_swin_t'})
    manifest = []
    for item in selected:
        filename = f'{item["key"]}_s{item["seed"]}.pt'
        remote(item['checkpoint'], ASSETS/filename, item['checkpoint_sha256'])
        manifest.append({'key': item['key'], 'seed': item['seed'], 'file': filename,
                         'sha256': item['checkpoint_sha256'], 'source': item['checkpoint']})
        print('verified', filename, flush=True)
    (ASSETS/'manifest.json').write_text(json.dumps(manifest, indent=2), encoding='utf-8')
    repo = '/public/home/s_hetao/project/hetao/ppd_pbt_final384_20261027_r2/repo'
    remote(repo+'/rigor/external_models.py', CODE/'external_models_source.py')
    remote(repo+'/rigor/common.py', CODE/'common_source.py')
    modern_repo = '/public/home/s_hetao/project/hetao/reviewer_modern_20261023'
    remote(modern_repo+'/incoming/assets/mask2former/config.json', ASSETS/'mask2former/config.json')
    for source, target in [('modern_models.py', 'modern_source.py'), ('hrnet_compatible.py', 'hrnet_official.py'),
                           ('bn_helper.py', 'bn_helper.py'), ('hrnet_config.yaml', 'hrnet_config.yaml')]:
        shutil.copy2(PAPER/'tasks/2026-10-23-审稿补充先进模型'/source, CODE/target)
    runtime = BACK/'runtime/7zip'
    runtime.mkdir(parents=True, exist_ok=True)
    installer = runtime/'7z2605-x64.exe'
    if not installer.exists():
        urllib.request.urlretrieve('https://github.com/ip7z/7zip/releases/download/26.05/7z2605-x64.exe', installer)
    if not (runtime/'7z.exe').exists():
        subprocess.run([r'C:\Program Files\NVIDIA Corporation\NVIDIA App\7z.exe', 'x', str(installer),
                        '-o'+str(runtime), '-y'], check=True, stdout=subprocess.DEVNULL)
    result = subprocess.run([str(runtime/'7z.exe'), 'i'], capture_output=True, text=True, check=True)
    print(result.stdout[:350], flush=True)
    print('All selected assets prepared; nothing installed system-wide.', flush=True)


if __name__ == '__main__':
    main()
