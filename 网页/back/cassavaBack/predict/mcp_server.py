#!/usr/bin/env python3
"""cassava MCP stdio 服务器：把平台 HTTP API 包成 4 个 MCP 工具。

给 opencode serve 的 PPD 智能体用（stdio 传 JSON-RPC 2.0，每行一个消息）。
跑在服务器 venv 里，只依赖 requests；stdout 只允许输出协议响应，
调试信息一律走 stderr（否则会污染协议流）。

环境变量：
  CASSAVA_API_BASE    平台 API 根，默认 http://127.0.0.1:8000；
                      生产必须配成公网 https://www.cassavappd.com
                      （生产 SECURE_SSL_REDIRECT=True，直连内网 8002 只会收到 301）
  CASSAVA_TOKEN_FILE  存平台 Token 明文的文件路径，每次工具调用时现读
"""
from __future__ import annotations

import json
import os
import sys
import time
from datetime import datetime

import requests

PROTOCOL_VERSION = '2024-11-05'
SERVER_NAME = 'cassava'
SERVER_VERSION = '0.1.0'

API_BASE = (os.getenv('CASSAVA_API_BASE') or 'http://127.0.0.1:8000').strip().rstrip('/')
TOKEN_FILE = (os.getenv('CASSAVA_TOKEN_FILE') or '').strip()
API_TIMEOUT = 30

DEFAULT_MODEL = 'pbt_c512'
ALLOWED_MODELS = ('pbt_c512', 'pbt_c384', 'hrnet_w48', 'mask2former_swin_t')
ALLOWED_EXTENSIONS = ('.jpg', '.jpeg', '.png')

TASK_STATUS_KEYS = ('name', 'status', 'progress', 'image_count', 'result_count', 'queue_position')


def log(message):
    """诊断信息只写 stderr，绝不碰 stdout。"""
    try:
        print(f'[cassava-mcp] {message}', file=sys.stderr, flush=True)
    except Exception:
        pass


# ---------------- 平台 API 访问 ----------------

def read_token():
    """每次调用都现读 Token 文件，避免长驻进程拿着过期 Token。"""
    if not TOKEN_FILE:
        return None, 'CASSAVA_TOKEN_FILE 未配置，无法访问平台 API。'
    try:
        with open(TOKEN_FILE, 'r', encoding='utf-8') as handle:
            token = handle.read().strip()
    except FileNotFoundError:
        return None, '平台 Token 文件不存在，请先在网页端登录后再试。'
    except OSError as exc:
        return None, f'读取平台 Token 文件失败：{exc.strerror or exc}'
    if not token:
        return None, '平台 Token 文件为空，请先登录网页后再试。'
    return token, None


def call_api(method, path, payload=None, params=None):
    """调平台 API，返回 (原始 JSON 或 None, 错误文案或 None)。"""
    token, error = read_token()
    if error:
        return None, error
    url = f'{API_BASE}{path}'
    headers = {'Authorization': f'Token {token}', 'Accept': 'application/json'}
    try:
        response = requests.request(
            method, url, json=payload, params=params, headers=headers,
            timeout=API_TIMEOUT, allow_redirects=False,
        )
    except requests.RequestException as exc:
        log(f'{method} {url} 请求失败：{exc}')
        return None, f'平台接口请求失败：{exc}'
    if response.status_code in (301, 302, 303, 307, 308):
        location = response.headers.get('Location', '')
        return None, (f'平台接口返回 {response.status_code} 重定向（{location}），'
                      f'请把 CASSAVA_API_BASE 配成 https 公网地址。')
    body = None
    try:
        body = response.json()
    except ValueError:
        body = None
    if response.status_code >= 400:
        detail = ''
        if isinstance(body, dict):
            detail = str(body.get('detail') or body.get('error') or body.get('message') or '')
            if not detail:
                detail = json.dumps(body, ensure_ascii=False)[:300]
        elif body is None:
            detail = (response.text or '')[:300]
        log(f'{method} {url} -> {response.status_code}')
        return None, f'平台接口返回 {response.status_code}：{detail or "无错误详情"}'
    return body, None


def find_task_id(payload):
    """在响应 JSON 里找任务 id（DRF 直接返回对象，也可能包一层 data）。"""
    if isinstance(payload, dict):
        for key in ('id', 'task_id', 'taskId'):
            value = payload.get(key)
            if isinstance(value, int):
                return value
            if isinstance(value, str) and value.isdigit():
                return int(value)
        for key in ('data', 'task', 'result'):
            nested = payload.get(key)
            if isinstance(nested, dict):
                found = find_task_id(nested)
                if found is not None:
                    return found
    return None


# ---------------- 工具实现 ----------------

def tool_plan_upload(arguments):
    """确认卡载体：只校验文件名，不碰平台 API。"""
    raw_names = arguments.get('fileNames')
    if not isinstance(raw_names, list) or not raw_names:
        return {'ok': False, 'error': 'fileNames 不能为空，请给出要上传的图片文件名列表。'}
    file_names = []
    for raw in raw_names:
        name = str(raw or '').strip()
        if not name:
            continue
        file_names.append(name)
    if not file_names:
        return {'ok': False, 'error': 'fileNames 里没有有效文件名。'}
    bad = [name for name in file_names if not name.lower().endswith(ALLOWED_EXTENSIONS)]
    if bad:
        return {'ok': False,
                'error': f'只支持 jpg/jpeg/png 图片，以下文件不符合：{"、".join(bad)}'}

    model = str(arguments.get('model') or DEFAULT_MODEL).strip() or DEFAULT_MODEL
    if model not in ALLOWED_MODELS:
        return {'ok': False,
                'error': f'不支持的模型「{model}」，可选：{"、".join(ALLOWED_MODELS)}'}
    task_name = str(arguments.get('taskName') or '').strip()
    if not task_name:
        task_name = f'预测任务-{datetime.now().strftime("%Y/%m/%d %H:%M:%S")}'
    return {
        'ok': True,
        'taskName': task_name,
        'model': model,
        'count': len(file_names),
        'fileNames': file_names,
    }


def tool_create_task(arguments):
    task_name = str(arguments.get('taskName') or '').strip()
    if not task_name:
        return {'ok': False, 'error': 'taskName 不能为空。'}
    model = str(arguments.get('model') or DEFAULT_MODEL).strip() or DEFAULT_MODEL
    if model not in ALLOWED_MODELS:
        return {'ok': False,
                'error': f'不支持的模型「{model}」，可选：{"、".join(ALLOWED_MODELS)}'}
    raw_ids = arguments.get('imageIds')
    if not isinstance(raw_ids, list) or not raw_ids:
        return {'ok': False, 'error': 'imageIds 不能为空，请先确认图片已上传。'}
    image_ids = []
    for raw in raw_ids:
        try:
            image_id = int(raw)
        except (TypeError, ValueError):
            continue
        if image_id > 0:
            image_ids.append(image_id)
    if not image_ids:
        return {'ok': False, 'error': 'imageIds 里没有有效的正整数 ID。'}

    payload = {
        'name': task_name,
        'type': 'prediction',
        'algorithm': model,
        'single_model_type': model,
        'threshold': 0.5,
        'min_size': 0,
        'split_count': 4,
        'parameters': {
            'confidenceThreshold': 0.5,
            'minArea': 0,
            'predictionMode': 'single',
        },
        'image_ids': image_ids,
        'folder_ids': [],
    }
    body, error = call_api('POST', '/api/tasks/', payload=payload)
    if error:
        return {'ok': False, 'error': error}
    task_id = find_task_id(body)
    if task_id is None:
        log(f'create_task 响应里找不到 id：{str(body)[:300]}')
        return {'ok': False, 'error': '任务已提交但响应里没有任务 id，请到网页端任务列表核对。',
                'raw': body}
    return {'ok': True, 'taskId': task_id, 'taskName': task_name, 'model': model,
            'imageCount': len(image_ids)}


def tool_task_status(arguments):
    try:
        task_id = int(arguments.get('taskId'))
    except (TypeError, ValueError):
        return {'ok': False, 'error': 'taskId 必须是整数。'}
    try:
        wait = arguments.get('wait', True)
        wait = True if wait is None else bool(wait)
        try:
            max_wait = int(arguments.get('maxWait') or 600)
        except (TypeError, ValueError):
            max_wait = 600
        max_wait = max(10, min(max_wait, 600))
    except Exception:
        wait, max_wait = True, 600
    deadline = time.time() + max_wait
    poll_interval = 5.0
    body = None
    while True:
        body, error = call_api('GET', f'/api/tasks/{task_id}/')
        if error:
            return {'ok': False, 'error': error}
        if not isinstance(body, dict):
            return {'ok': False, 'error': '任务状态接口返回格式不可识别。'}
        status_value = str(body.get('status') or '')
        if (not wait or status_value in ('completed', 'failed', 'cancelled')
                or time.time() >= deadline):
            break
        time.sleep(poll_interval)
    status = {'ok': True, 'taskId': task_id}
    for key in TASK_STATUS_KEYS:
        status[key] = body.get(key)
    if body.get('error'):
        status['error'] = body.get('error')
    return status


def tool_prediction_summary(arguments):
    try:
        task_id = int(arguments.get('taskId'))
    except (TypeError, ValueError):
        return {'ok': False, 'error': 'taskId 必须是整数。'}
    body, error = call_api('GET', '/api/predictions/summary/', params={'task_id': task_id})
    if error:
        return {'ok': False, 'error': error}
    if isinstance(body, dict):
        return {'ok': True, 'taskId': task_id, **body}
    return {'ok': True, 'taskId': task_id, 'data': body}


# ---------------- MCP 协议 ----------------

TOOLS = [
    {
        'name': 'plan_upload',
        'description': ('规划一次图片上传并生成确认卡（写操作的确认环节，必须最先调用）。'
                        '只校验文件名，不调用平台 API、不建任务；'
                        '返回 taskName、model、count、fileNames 供用户确认。'),
        'inputSchema': {
            'type': 'object',
            'properties': {
                'taskName': {'type': 'string', 'description': '任务名，留空则用「预测任务-当前时间」'},
                'model': {'type': 'string', 'enum': list(ALLOWED_MODELS),
                          'description': '预测模型，默认 pbt_c512'},
                'fileNames': {'type': 'array', 'items': {'type': 'string'},
                              'description': '要上传的图片文件名（jpg/jpeg/png）'},
            },
            'required': ['fileNames'],
        },
    },
    {
        'name': 'create_task',
        'description': ('在平台创建预测任务（写操作）。调用前用户必须已在网页端完成上传并给出图片 ID。'),
        'inputSchema': {
            'type': 'object',
            'properties': {
                'taskName': {'type': 'string', 'description': '任务名'},
                'model': {'type': 'string', 'enum': list(ALLOWED_MODELS)},
                'imageIds': {'type': 'array', 'items': {'type': 'integer'},
                             'description': '平台图片 ID 列表'},
            },
            'required': ['taskName', 'model', 'imageIds'],
        },
    },
    {
        'name': 'task_status',
        'description': ('查询预测任务状态（status/progress/image_count/result_count/queue_position/name）。'
                        '默认阻塞轮询直到任务 completed/failed/cancelled 再返回（最长 10 分钟）；'
                        '传 wait=false 则只查询一次立即返回。'),
        'inputSchema': {
            'type': 'object',
            'properties': {
                'taskId': {'type': 'integer', 'description': '任务 ID'},
                'wait': {'type': 'boolean', 'description': '是否阻塞等待任务结束，默认 true'},
                'maxWait': {'type': 'integer', 'description': '最长等待秒数，默认 600，上限 600'},
            },
            'required': ['taskId'],
        },
    },
    {
        'name': 'prediction_summary',
        'description': '查询某任务的预测结果汇总（总数、平均/最高/最低 PPD、分级分布）。',
        'inputSchema': {
            'type': 'object',
            'properties': {'taskId': {'type': 'integer', 'description': '任务 ID'}},
            'required': ['taskId'],
        },
    },
]

TOOL_HANDLERS = {
    'plan_upload': tool_plan_upload,
    'create_task': tool_create_task,
    'task_status': tool_task_status,
    'prediction_summary': tool_prediction_summary,
}


def as_text_result(payload, is_error=False):
    text = json.dumps(payload, ensure_ascii=False)
    result = {'content': [{'type': 'text', 'text': text}]}
    if is_error:
        result['isError'] = True
    return result


def handle_tools_call(params):
    name = str((params or {}).get('name') or '')
    arguments = (params or {}).get('arguments') or {}
    handler = TOOL_HANDLERS.get(name)
    if handler is None:
        return as_text_result({'ok': False, 'error': f'未知工具：{name}'}, is_error=True)
    if not isinstance(arguments, dict):
        return as_text_result({'ok': False, 'error': 'arguments 必须是对象'}, is_error=True)
    try:
        payload = handler(arguments)
    except Exception as exc:  # 工具内部异常不打断协议循环
        log(f'工具 {name} 执行异常：{exc!r}')
        return as_text_result({'ok': False, 'error': f'工具执行失败：{exc}'}, is_error=True)
    return as_text_result(payload, is_error=not payload.get('ok', False))


def handle_message(message):
    """返回要写回 stdout 的响应对象；通知或无法识别时不返回。"""
    if not isinstance(message, dict):
        return None
    method = str(message.get('method') or '')
    msg_id = message.get('id')
    params = message.get('params') or {}

    if method.startswith('notifications/'):
        return None
    if method == 'initialize':
        result = {
            'protocolVersion': PROTOCOL_VERSION,
            'capabilities': {'tools': {}},
            'serverInfo': {'name': SERVER_NAME, 'version': SERVER_VERSION},
        }
    elif method == 'tools/list':
        result = {'tools': TOOLS}
    elif method == 'tools/call':
        result = handle_tools_call(params)
    elif method == 'ping':
        result = {}
    else:
        # 未实现的方法按约定返回空 result（有 id 才回，避免给通知乱回复）
        result = {}

    if msg_id is None and method.startswith('notifications/'):
        return None
    if msg_id is None:
        return None
    return {'jsonrpc': '2.0', 'id': msg_id, 'result': result}


def main():
    for stream in (sys.stdin, sys.stdout):
        try:
            stream.reconfigure(encoding='utf-8', newline='\n')
        except Exception:
            pass
    log(f'启动：api={API_BASE} token_file={TOKEN_FILE or "(未配置)"}')
    while True:
        line = sys.stdin.readline()
        if not line:
            break
        line = line.strip()
        if not line:
            continue
        try:
            message = json.loads(line)
        except ValueError:
            log(f'收到非法 JSON：{line[:200]}')
            response = {'jsonrpc': '2.0', 'id': None,
                        'error': {'code': -32700, 'message': 'Parse error'}}
        else:
            try:
                response = handle_message(message)
            except Exception as exc:
                log(f'处理消息异常：{exc!r}')
                msg_id = message.get('id') if isinstance(message, dict) else None
                response = {'jsonrpc': '2.0', 'id': msg_id,
                            'error': {'code': -32603, 'message': f'Internal error: {exc}'}}
        if response is None:
            continue
        try:
            sys.stdout.write(json.dumps(response, ensure_ascii=False) + '\n')
            sys.stdout.flush()
        except (BrokenPipeError, OSError):
            break


if __name__ == '__main__':
    try:
        main()
    except KeyboardInterrupt:
        pass
