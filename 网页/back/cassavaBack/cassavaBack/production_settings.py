"""Linux release settings; all mutable data and secrets stay outside Git releases."""
import os
from pathlib import Path
from dotenv import load_dotenv

if not os.environ.get('CASSAVA_ENV_FILE'):
    raise RuntimeError('CASSAVA_ENV_FILE is required')
load_dotenv(os.environ['CASSAVA_ENV_FILE'])
os.environ['DEBUG'] = 'False'
from .settings import *  # noqa: F403,E402

MEDIA_ROOT = Path(os.environ['CASSAVA_MEDIA_ROOT'])
STATIC_ROOT = Path(os.environ['CASSAVA_STATIC_ROOT'])
MODERN_MODEL_ASSETS = Path(os.environ['CASSAVA_MODEL_ASSETS'])
SEVEN_ZIP_PATH = os.environ['SEVEN_ZIP_PATH']
IMPORT_STAGING_ROOT = Path(os.environ['CASSAVA_IMPORT_STAGING'])
PREDICTION_TASKS_DISABLED = os.getenv('PREDICTION_TASKS_DISABLED', 'true').lower() == 'true'
PREDICTION_TASK_WORKERS = 1
IMPORT_MIN_FREE_BYTES = 4 * 1024**3
