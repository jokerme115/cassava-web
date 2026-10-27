#!/usr/bin/env python
"""
Backend Executable Entry Point (Nuitka)
自动生成，请勿手动修改
"""
import os
import sys
import json
import secrets
import time
import socket
import threading
import logging
from pathlib import Path
from datetime import datetime

# 以运行时相对路径为准，避免机器相关绝对路径
THIS_DIR = Path(__file__).resolve().parent
CASSAVA_BACK = THIS_DIR / "cassavaBack"

sys.path.insert(0, str(THIS_DIR))
sys.path.insert(0, str(CASSAVA_BACK))

os.environ.setdefault('DJANGO_SETTINGS_MODULE', 'settings_desktop')

# 桌面模式标志
os.environ.setdefault('DESKTOP_MODE', '1')

# 配置日志
logging.basicConfig(
    level=logging.INFO,
    format='[%(levelname)s] %(message)s',
)
logger = logging.getLogger('backend_main')

import django
from django.core.management import execute_from_command_line

def start_health_probe(port: int, health_file: str):
    """后台探测 runserver 端口可用后写入健康文件，供 Electron 启动判定。"""
    if not health_file:
        return

    def _probe():
        deadline = time.time() + 60
        while time.time() < deadline:
            try:
                with socket.create_connection(("127.0.0.1", port), timeout=1.0):
                    payload = {
                        "ok": True,
                        "pid": os.getpid(),
                        "port": port,
                        "ts": datetime.utcnow().isoformat() + "Z",
                    }
                    Path(health_file).parent.mkdir(parents=True, exist_ok=True)
                    with open(health_file, "w", encoding="utf-8") as f:
                        json.dump(payload, f, ensure_ascii=False)
                    logger.info(f"health file ready: {health_file}")
                    return
            except Exception:
                time.sleep(0.2)

    t = threading.Thread(target=_probe, name="health-probe", daemon=True)
    t.start()

def run_safe_command(argv):
    try:
        execute_from_command_line(argv)
        return True
    except SystemExit as e:
        code = e.code if isinstance(e.code, int) else 1
        return code == 0
    except Exception as e:
        logger.error(f"command failed: {argv} error={e}")
        return False

def load_or_create_admin_credential():
    username = os.getenv('DESKTOP_ADMIN_USERNAME', 'admin')
    password = os.getenv('DESKTOP_ADMIN_PASSWORD', '').strip()
    email = os.getenv('DESKTOP_ADMIN_EMAIL', 'admin@localhost')
    cred_file = os.getenv('DESKTOP_ADMIN_CRED_FILE', '').strip()

    if cred_file:
        cred_path = Path(cred_file)
        if cred_path.exists():
            try:
                data = json.loads(cred_path.read_text(encoding='utf-8'))
                username = data.get('username') or username
                password = data.get('password') or password
                email = data.get('email') or email
            except Exception as e:
                logger.warning(f"admin cred read failed: {e}")

    if not password:
        password = secrets.token_hex(16)

    if cred_file:
        try:
            payload = {
                "username": username,
                "password": password,
                "email": email,
                "generated": datetime.utcnow().isoformat() + "Z",
            }
            cred_path = Path(cred_file)
            cred_path.parent.mkdir(parents=True, exist_ok=True)
            cred_path.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding='utf-8')
        except Exception as e:
            logger.warning(f"admin cred write failed: {e}")

    return username, password, email

def bootstrap_db_and_admin():
    # 先迁移数据库，确保表存在
    if not run_safe_command([sys.argv[0], 'migrate', '--noinput']):
        logger.error('migrate failed')
        return False

    # 初始化管理员
    username, password, email = load_or_create_admin_credential()

    try:
        from django.contrib.auth.models import User
        if not User.objects.filter(username=username).exists():
            User.objects.create_superuser(username=username, password=password, email=email)
            logger.info(f"admin created: {username}")
    except Exception as e:
        logger.error(f"admin init failed: {e}")
        return False

    return True

if __name__ == '__main__':
    # 默认启动 runserver；优先读取环境端口
    port = os.getenv('DJANGO_PORT', '58234')
    health_file = os.getenv('BACKEND_HEALTH_FILE', '')

    django.setup()
    if not bootstrap_db_and_admin():
        raise SystemExit(1)

    if len(sys.argv) == 1:
        sys.argv.append('runserver')
        sys.argv.append(f'127.0.0.1:{port}')
    elif len(sys.argv) == 2 and sys.argv[1].isdigit():
        # 兼容误传端口参数的场景：backend.exe 58234
        sys.argv = [sys.argv[0], 'runserver', f'127.0.0.1:{sys.argv[1]}']

    try:
        probe_target = sys.argv[2] if len(sys.argv) >= 3 and sys.argv[1] == 'runserver' else port
        probe_port = int(str(probe_target).split(':')[-1])
    except Exception:
        probe_port = int(port)
    start_health_probe(probe_port, health_file)

    execute_from_command_line(sys.argv)
