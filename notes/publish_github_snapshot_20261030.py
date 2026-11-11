"""Publish a filtered source snapshot; leave the active branch and index untouched."""
from pathlib import Path
import collections
import json
import os
import re
import subprocess

ROOT = Path(__file__).resolve().parents[1]
os.chdir(ROOT)
REPO = 'jokerme115/cassava-web'
URL = 'https://github.com/' + REPO + '.git'


def run(args, *, env=None, data=None):
    result = subprocess.run(args, input=data, capture_output=True, env=env)
    if result.returncode:
        raise RuntimeError(result.stderr.decode('utf-8', errors='replace'))
    return result.stdout.decode('utf-8').strip()


files = run(['git', 'ls-files', '--cached', '--others', '--exclude-standard', '-z']).split('\0')
# Include the upstream M6 implementation, while the rest of its package stays ignored.
files += ['网页/back/M6_best_predict_package/' + name for name in ('metadata.json', 'model.py', 'predict.py', 'requirements.txt', 'run_predict.bat')]
keep = []
excluded = collections.Counter()
for name in sorted(set(files)):
    p = Path(name)
    if not name or not p.is_file():
        continue
    reason = None
    if any(part.startswith('dist-') or part in {'.playwright-cli', 'backup-before', 'backup-after', 'node_modules', '__pycache__', '.venv-backend'} or 'backup-src' in part or part.startswith('banner-backup-') for part in p.parts):
        reason = 'historical-build-backup-or-runtime'
    elif '.sqlite' in p.name or p.suffix.lower() in {'.db', '.bak', '.zip', '.7z', '.rar', '.pth', '.pt', '.onnx', '.docx'}:
        reason = 'database-model-archive-or-office'
    elif p.name.startswith('.env') and p.name != '.env.example':
        reason = 'local-environment'
    if reason:
        excluded[reason] += 1
        continue
    if p.stat().st_size > 95 * 1024 * 1024:
        raise RuntimeError('Oversized source file: ' + name)
    if p.stat().st_size < 2_000_000:
        try:
            content = p.read_text(encoding='utf-8')
        except UnicodeError:
            content = ''
        # Do not embed a complete token pattern literal that flags this script itself.
        patterns = [r'gh[pousr]_' + r'[A-Za-z0-9]{20,}', r'github_pat_' + r'[A-Za-z0-9_]{30,}', r'LTAI' + r'[A-Za-z0-9]{12,}', r'-----BEGIN ' + r'(?:RSA |EC |OPENSSH )?PRIVATE KEY-----']
        if any(re.search(pattern, content) for pattern in patterns):
            raise RuntimeError('Potential credential in source: ' + name)
    keep.append(name)

manifest = {'files': len(keep), 'bytes': sum(Path(p).stat().st_size for p in keep), 'excluded': dict(excluded), 'paths': keep}
(ROOT / 'output/github-publish-manifest.json').write_text(json.dumps(manifest, ensure_ascii=False, indent=2), encoding='utf-8')
index = ROOT / 'output/github-publish.index'
git_env = {**os.environ, 'GIT_INDEX_FILE': str(index)}
run(['git', 'read-tree', '--empty'], env=git_env)
run(['git', 'add', '-f', '--pathspec-from-file=-', '--pathspec-file-nul'], env=git_env, data=('\0'.join(keep)+'\0').encode('utf-8'))
tree = run(['git', 'write-tree'], env=git_env)
parent_result = subprocess.run(['git', 'rev-parse', '--verify', 'refs/heads/github-main'], capture_output=True)
parent = parent_result.stdout.decode().strip() if parent_result.returncode == 0 else None
args = ['git', 'commit-tree', tree]
if parent:
    args += ['-p', parent]
commit = run(args, data=b'Publish local Cassava web upgrade and unified typography\n')
run(['git', 'update-ref', 'refs/heads/github-main', commit] + ([parent] if parent else []))

# Ask the existing credential manager; never print or persist the returned secret.
credential = run(['git', 'credential', 'fill'], env={**os.environ, 'GIT_TERMINAL_PROMPT': '0', 'GCM_INTERACTIVE': 'never'}, data=b'protocol=https\nhost=github.com\n\n')
values = dict(line.split('=', 1) for line in credential.splitlines() if '=' in line)
gh_env = {**os.environ, 'GH_TOKEN': values['password']}
assert run(['gh', 'api', 'user', '--jq', '.login'], env=gh_env) == 'jokerme115'
check = subprocess.run(['gh', 'repo', 'view', REPO, '--json', 'isPrivate'], env=gh_env, capture_output=True)
if check.returncode:
    run(['gh', 'repo', 'create', REPO, '--public', '--description', 'Cassava PPD web workspace: image management, inference, review and export'], env=gh_env)
metadata = json.loads(run(['gh', 'repo', 'view', REPO, '--json', 'isPrivate,url'], env=gh_env))
assert metadata['isPrivate'] is False
remotes = run(['git', 'remote']).splitlines()
if 'github' not in remotes:
    run(['git', 'remote', 'add', 'github', URL])
assert run(['git', 'remote', 'get-url', 'github']) == URL
run(['git', 'config', 'remote.github.push', 'refs/heads/github-main:refs/heads/main'])
# Integrate concurrent remote commits using an isolated merge tree; never overwrite the checkout.
if run(['git', 'ls-remote', 'github', 'refs/heads/main']):
    run(['git', 'fetch', 'github', 'main'])
    upstream = run(['git', 'rev-parse', 'refs/remotes/github/main'])
    ancestor = subprocess.run(['git', 'merge-base', '--is-ancestor', upstream, commit], capture_output=True)
    if ancestor.returncode:
        merged_tree = run(['git', 'merge-tree', '--write-tree', commit, upstream]).splitlines()[0]
        merged = run(['git', 'commit-tree', merged_tree, '-p', commit, '-p', upstream], data=b'Merge upstream source changes with workspace UI upgrade\n')
        run(['git', 'update-ref', 'refs/heads/github-main', merged, commit])
        commit = merged
        tree_paths = run(['git', 'ls-tree', '-r', '--name-only', '-z', commit]).split('\0')
        if set(filter(None, tree_paths)) != set(keep):
            print('Upstream-only source files preserved by the merge.')

run(['git', 'push', 'github', 'refs/heads/github-main:refs/heads/main'])
remote_sha = run(['git', 'ls-remote', 'github', 'refs/heads/main']).split()[0]
assert remote_sha == commit
proof = {'url': metadata['url'], 'private': False, 'commit': commit, 'files': len(keep), 'bytes': manifest['bytes'], 'excluded': dict(excluded), 'local_branch': run(['git', 'branch', '--show-current'])}
(ROOT / 'output/github-publish-proof.json').write_text(json.dumps(proof, ensure_ascii=False, indent=2), encoding='utf-8')
print(json.dumps(proof, ensure_ascii=False))
