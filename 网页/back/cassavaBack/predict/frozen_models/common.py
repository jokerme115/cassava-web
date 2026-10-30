import hashlib
from pathlib import Path
def sha256_file(path):
    return hashlib.sha256(Path(path).read_bytes()).hexdigest()
