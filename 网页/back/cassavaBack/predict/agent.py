"""「PPD 智能体」Django 桥：把网页面板的一轮对话转给本机 opencode serve。

分工：
  网页（SSE） ↔ 本 view ↔ opencode serve（会话 / 事件流 / 权限确认） ↔ MCP cassava 工具
本文件只做翻译，不自己编数值：所有数字都由 MCP 工具从平台 API 取回。

接口（Token 鉴权）：
  POST /api/agent/chat/             发消息，流式返回本轮事件
  GET  /api/agent/events/           只订阅事件流（上传完成后的后续轮）
  POST /api/agent/confirm/          回复权限确认（once / reject）
  POST /api/agent/upload-complete/  告知智能体「图片已上传，ID 是 …」

统一 SSE 帧：`event: <name>\\ndata: <json>\\n\\n`
  meta      {"session": "ses_…"}
  delta     {"text": "…"}                      助手文本增量
  confirm   {"requestId": "per_…", "args": {"taskName","model","count","files"}}
  turn_end  {"cost": 0.0008, "tokens": {...}}
  error     {"message": "智能体服务暂时不可用，请稍后再试。"}

opencode 事件形状（2026-11-12 实测，见 report）：
  帧只有 `data: {json}`，无 event: 行；信封 {id, created, type, data, durable?}，
  data.sessionID 标明所属会话。文本增量 = session.text.delta / data.delta；
  工具参数 = session.tool.progress / data.metadata.toolCalls[].input；
  权限请求 = permission.asked / data.{id, action, resources, source.id}；
  单个 agent 步骤结束 = session.step.ended / data.{finish, cost, tokens}；
  整轮结束 = session.execution.succeeded（失败为 session.execution.failed）。
"""
import json
import logging
import os
import queue
import threading
import time
from datetime import datetime

import requests
from django.conf import settings
from django.http import StreamingHttpResponse
from rest_framework.decorators import api_view, permission_classes, renderer_classes
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response

from .assistant import EventStreamRenderer, JSONRenderer

logger = logging.getLogger(__name__)

UNAVAILABLE_TEXT = '智能体服务暂时不可用，请稍后再试。'
CONFIRM_TOOL_HINT = 'plan_upload'
CONFIRM_ACTION = 'cassava_plan_upload'
DEFAULT_MODEL = 'pbt_c512'
HEARTBEAT_SECONDS = 20
MAX_TOOL_INPUTS = 20

AGENT_SYSTEM_PROMPT = (
    '你是木薯采后品质筛查平台的「PPD 智能体」，帮助用户处理图片上传、预测任务与结果统计。\n'
    '可用平台工具（MCP cassava 服务器）：plan_upload（规划上传+建任务，写操作，必须最先调用）、'
    'create_task、task_status、prediction_summary。\n'
    '流程规则：\n'
    '1. 用户要求上传/统计图片时：先调用 cassava 的 plan_upload（fileNames=消息中列出的文件名，'
    'model 默认 pbt_c512，taskName 默认「预测任务-当前日期时间」），工具返回后本轮回复即结束，'
    '等待用户在网页端确认并上传，不要继续调用其他工具。\n'
    '2. 收到「用户已完成上传，图片 ID：[...]」后：调用 create_task 建任务，然后反复调用 task_status '
    '轮询直到 status 为 completed 或 failed（每次轮询之间直接连续调用即可），completed 后调用 '
    'prediction_summary，并用中文汇报：记录总数、平均/最高/最低 PPD、健康(<4)/轻微(4-7)/严重(≥7)分布、'
    '需要复核的数量与文件名。所有数字只能来自工具返回，禁止编造。\n'
    '3. 用户只是提问或闲聊时：直接用中文回答，涉及数值时只能引用工具结果，没有数据就说明查不到。'
)


# ---------------- opencode 连接 ----------------

def _base_url():
    return str(getattr(settings, 'ASSISTANT_AGENT_OPENCODE_URL', '') or '').rstrip('/')


def _password():
    """密码文件优先，返回空串时退回环境变量。"""
    path = str(getattr(settings, 'ASSISTANT_AGENT_OPENCODE_PASSWORD_FILE', '') or '')
    if path:
        try:
            with open(path, encoding='utf-8') as handle:
                password = handle.read().strip()
            if password:
                return password
        except OSError:
            logger.warning('读取 opencode 密码文件失败：%s', path)
    return (os.getenv('ASSISTANT_AGENT_OPENCODE_PASSWORD') or '').strip()


def _auth():
    password = _password()
    if not password:
        return None
    user = str(getattr(settings, 'ASSISTANT_AGENT_OPENCODE_USER', 'opencode') or 'opencode')
    return (user, password)


def _request(method, path, payload=None, stream=False, timeout=30):
    base = _base_url()
    if not base:
        raise requests.RequestException('ASSISTANT_AGENT_OPENCODE_URL 未配置')
    read_timeout = None if stream else timeout
    return requests.request(
        method, f'{base}{path}', json=payload, auth=_auth(), stream=stream,
        timeout=(10, read_timeout), headers={'Accept': 'application/json' if not stream else 'text/event-stream'},
    )


def _create_session(user_id):
    """新建 opencode 会话，返回 ses_ 开头的 id。"""
    title = f'agent-{user_id}-{datetime.now().strftime("%Y%m%d%H%M%S")}'
    response = _request('POST', '/api/session',
                        {'title': title, 'agent': 'build', 'model': settings.ASSISTANT_AGENT_MODEL})
    if response.status_code >= 400:
        raise requests.RequestException(f'创建会话失败：HTTP {response.status_code}')
    try:
        payload = response.json()
    except ValueError as exc:
        raise requests.RequestException(f'创建会话响应不可解析：{exc}') from exc
    session_id = (payload.get('data') or {}).get('id') if isinstance(payload, dict) else None
    if not session_id:
        raise requests.RequestException('创建会话响应里没有会话 id')
    return session_id


def _send_prompt(session_id, text):
    response = _request('POST', f'/api/session/{session_id}/prompt', {'text': text})
    if response.status_code >= 400:
        raise requests.RequestException(f'发送消息失败：HTTP {response.status_code}')


def _write_token_file(request):
    """把本次请求的 Token 明文写到 MCP 服务器读的位置（0600）。"""
    path = str(getattr(settings, 'ASSISTANT_AGENT_TOKEN_FILE', '') or '')
    if not path:
        return
    token = getattr(request.auth, 'key', None)
    if not token:
        header = str(request.META.get('HTTP_AUTHORIZATION') or '')
        if header.lower().startswith('token '):
            token = header[6:].strip()
    if not token:
        return
    try:
        directory = os.path.dirname(path)
        if directory:
            os.makedirs(directory, exist_ok=True)
        tmp_path = f'{path}.{os.getpid()}.tmp'
        with open(tmp_path, 'w', encoding='utf-8') as handle:
            handle.write(token)
        os.replace(tmp_path, path)
        try:
            os.chmod(path, 0o600)
        except OSError:
            pass
    except OSError:
        logger.exception('智能体 Token 文件写入失败：%s', path)


# ---------------- 提示词 ----------------

def _prompt_text(message, file_names):
    text = AGENT_SYSTEM_PROMPT + '\n\n' + message
    if file_names:
        text += '\n用户选择的文件：' + '、'.join(file_names)
    return text


def _normalise_files(raw):
    """fileNames 可能是列表，也可能是 JSON 串或「a.jpg、b.jpg」这样的字符串。"""
    if raw is None:
        return []
    if isinstance(raw, str):
        text = raw.strip()
        if not text:
            return []
        if text.startswith('['):
            try:
                raw = json.loads(text)
            except ValueError:
                raw = None
        if raw is None or isinstance(raw, str):
            for sep in ('、', ',', '，', ';', '；', '\n'):
                text = text.replace(sep, ' ')
            return [item.strip().strip('"\'') for item in text.split() if item.strip()]
    if isinstance(raw, (list, tuple)):
        return [str(item).strip() for item in raw if str(item).strip()]
    return []


# ---------------- SSE ----------------

def _sse(event, data):
    return f'event: {event}\ndata: {json.dumps(data, ensure_ascii=False)}\n\n'


def _sse_response(stream):
    response = StreamingHttpResponse(stream, content_type='text/event-stream; charset=utf-8')
    response['Cache-Control'] = 'no-cache'
    response['X-Accel-Buffering'] = 'no'
    return response


def _take_delta(emitted, message_id, text, final=False):
    """opencode 的文本可能整段重发：按「已输出长度」截出真正的新增量。"""
    previous = emitted.get(message_id, '')
    if text.startswith(previous) and len(text) > len(previous):
        emitted[message_id] = text
        return text[len(previous):]
    if final and text == previous:
        return ''
    emitted[message_id] = previous + text
    return text


def _confirm_args(tool_inputs):
    """从最近的 plan_upload 工具入参拼确认卡内容。"""
    hit = {}
    for item in reversed(tool_inputs):
        if CONFIRM_TOOL_HINT in item['tool']:
            hit = item['input']
            break
    if not isinstance(hit, dict):
        hit = {}
    files = _normalise_files(hit.get('fileNames'))
    model = str(hit.get('model') or '').strip() or DEFAULT_MODEL
    task_name = str(hit.get('taskName') or '').strip()
    if not task_name:
        task_name = f'预测任务-{datetime.now().strftime("%Y/%m/%d %H:%M:%S")}'
    return {'taskName': task_name, 'model': model, 'count': len(files), 'files': files}


def _read_events(response, sink):
    """后台线程：把 opencode 的 SSE 帧解析后塞进队列。"""
    buffer = b''
    data_lines = []

    def flush():
        if not data_lines:
            return
        payload = '\n'.join(data_lines)
        data_lines.clear()
        try:
            sink.put(('event', json.loads(payload)))
        except ValueError:
            logger.debug('智能体事件不是合法 JSON：%s', payload[:200])

    try:
        for chunk in response.iter_content(chunk_size=256):
            if not chunk:
                continue
            buffer += chunk
            while b'\n' in buffer:
                raw_line, buffer = buffer.split(b'\n', 1)
                line = raw_line.decode('utf-8', 'replace').rstrip('\r')
                if not line:
                    flush()
                elif line.startswith(':'):
                    continue  # opencode 自己的心跳注释，本 view 另发 ping
                elif line.startswith('data:'):
                    data_lines.append(line[5:].lstrip())
        flush()
        sink.put(('end', None))
    except Exception as exc:  # 连接被关/读超时/解码失败
        sink.put(('error', exc))


def _stream_events(session_id):
    """订阅 /api/event，只转发本会话的事件，直到整轮结束或客户端断开。"""
    budget = max(5, int(getattr(settings, 'ASSISTANT_AGENT_POLL_MAX', 60) or 60))
    try:
        response = _request('GET', '/api/event', stream=True)
    except requests.RequestException:
        logger.exception('智能体事件流连接失败')
        yield _sse('error', {'message': UNAVAILABLE_TEXT})
        return
    if response.status_code >= 400:
        logger.warning('智能体事件流返回 HTTP %s', response.status_code)
        response.close()
        yield _sse('error', {'message': UNAVAILABLE_TEXT})
        return

    sink = queue.Queue()
    reader = threading.Thread(target=_read_events, args=(response, sink), daemon=True)
    reader.start()

    emitted = {}
    tool_inputs = []
    cost = None
    tokens = None
    awaiting_confirm = False
    deadline = time.monotonic() + budget

    # 重连场景：会话里已有挂起的权限请求时，先补发一次 confirm
    try:
        pend = _request('GET', f'/api/session/{session_id}/permission')
        if pend.status_code < 400:
            items = (pend.json() or {}).get('data') or []
            for item in items:
                if not isinstance(item, dict):
                    continue
                action = str(item.get('action') or '')
                if action == CONFIRM_ACTION or CONFIRM_TOOL_HINT in action:
                    meta_in = (item.get('metadata') or {}).get('input')
                    args = meta_in if isinstance(meta_in, dict) else _confirm_args(tool_inputs)
                    awaiting_confirm = True
                    yield _sse('confirm', {'requestId': item.get('id'), 'args': args})
    except (requests.RequestException, ValueError):
        logger.warning('智能体权限状态查询失败', exc_info=True)

    try:
        while True:
            if awaiting_confirm:
                wait = HEARTBEAT_SECONDS
            else:
                remaining = deadline - time.monotonic()
                if remaining <= 0:
                    yield _sse('turn_end', {'cost': cost, 'tokens': tokens})
                    return
                wait = min(HEARTBEAT_SECONDS, remaining)
            try:
                kind, payload = sink.get(timeout=wait)
            except queue.Empty:
                yield ': ping\n\n'
                continue

            if kind == 'end':
                yield _sse('turn_end', {'cost': cost, 'tokens': tokens})
                return
            if kind == 'error':
                logger.warning('智能体事件流中断：%s', payload)
                yield _sse('error', {'message': UNAVAILABLE_TEXT})
                return

            event = payload if isinstance(payload, dict) else {}
            event_type = str(event.get('type') or '')
            data = event.get('data')
            if not isinstance(data, dict):
                continue
            owner = data.get('sessionID')
            if owner and owner != session_id:
                continue
            if not owner:
                continue  # model.updated / provider.updated 等全局事件

            if event_type == 'session.text.delta':
                message_id = str(data.get('assistantMessageID') or '')
                chunk = str(data.get('delta') or '')
                if chunk:
                    piece = _take_delta(emitted, message_id, chunk)
                    if piece:
                        yield _sse('delta', {'text': piece})
            elif event_type == 'session.text.ended':
                message_id = str(data.get('assistantMessageID') or '')
                full = str(data.get('text') or '')
                piece = _take_delta(emitted, message_id, full, final=True)
                if piece:
                    yield _sse('delta', {'text': piece})
            elif event_type == 'session.tool.progress':
                calls = (data.get('metadata') or {}).get('toolCalls') or []
                for call in calls:
                    if not isinstance(call, dict) or call.get('input') is None:
                        continue
                    tool_inputs.append({'tool': str(call.get('tool') or ''),
                                        'input': call.get('input')})
                if len(tool_inputs) > MAX_TOOL_INPUTS:
                    del tool_inputs[:-MAX_TOOL_INPUTS]
            elif event_type == 'permission.asked':
                action = str(data.get('action') or '')
                if action == CONFIRM_ACTION or CONFIRM_TOOL_HINT in action:
                    awaiting_confirm = True
                    meta_in = (data.get('metadata') or {}).get('input')
                    args = meta_in if isinstance(meta_in, dict) else _confirm_args(tool_inputs)
                    yield _sse('confirm', {'requestId': data.get('id'), 'args': args})
            elif event_type == 'permission.replied':
                awaiting_confirm = False
                deadline = time.monotonic() + budget
            elif event_type == 'session.step.ended':
                if data.get('cost') is not None:
                    cost = data.get('cost')
                if data.get('tokens') is not None:
                    tokens = data.get('tokens')
            elif event_type == 'session.execution.failed':
                error = data.get('error') if isinstance(data.get('error'), dict) else {}
                logger.warning('智能体会话执行失败：%s', error.get('message'))
                yield _sse('error', {'message': UNAVAILABLE_TEXT})
                return
            elif event_type == 'session.execution.succeeded':
                yield _sse('turn_end', {'cost': cost, 'tokens': tokens})
                return
    finally:
        try:
            response.close()
        except Exception:
            pass


# ---------------- 视图 ----------------

@api_view(['POST'])
@renderer_classes([EventStreamRenderer, JSONRenderer])
@permission_classes([IsAuthenticated])
def agent_chat(request):
    """发一条消息给智能体；带 session 则续用会话，否则新建。"""
    message = str(request.data.get('message') or '').strip()
    if not message:
        return Response({'error': '消息不能为空'}, status=400)
    file_names = _normalise_files(request.data.get('fileNames'))
    reuse_session = str(request.data.get('session') or '').strip()
    _write_token_file(request)

    def stream():
        try:
            session_id = reuse_session or _create_session(request.user.id)
        except requests.RequestException:
            logger.exception('智能体服务不可用：新建会话失败')
            yield _sse('error', {'message': UNAVAILABLE_TEXT})
            return
        yield _sse('meta', {'session': session_id})
        try:
            _send_prompt(session_id, _prompt_text(message, file_names))
        except requests.RequestException:
            logger.exception('智能体服务不可用：发送消息失败')
            yield _sse('error', {'message': UNAVAILABLE_TEXT})
            return
        yield from _stream_events(session_id)

    return _sse_response(stream())


@api_view(['GET'])
@renderer_classes([EventStreamRenderer, JSONRenderer])
@permission_classes([IsAuthenticated])
def agent_events(request):
    """只订阅事件流（上传完成、确认之后的后续轮）。"""
    session_id = str(request.query_params.get('session') or '').strip()
    if not session_id:
        return Response({'error': '缺少 session 参数'}, status=400)
    _write_token_file(request)

    def stream():
        yield _sse('meta', {'session': session_id})
        yield from _stream_events(session_id)

    return _sse_response(stream())


@api_view(['POST'])
@permission_classes([IsAuthenticated])
def agent_confirm(request):
    """回复权限确认：转发给 opencode，返回它的响应状态。"""
    session_id = str(request.data.get('session') or '').strip()
    request_id = str(request.data.get('requestId') or '').strip()
    reply = str(request.data.get('reply') or '').strip()
    if not session_id or not request_id:
        return Response({'error': 'session 与 requestId 不能为空'}, status=400)
    if reply not in ('once', 'always', 'reject'):
        return Response({'error': 'reply 只能是 once 或 reject'}, status=400)
    try:
        response = _request('POST', f'/api/session/{session_id}/permission/{request_id}/reply',
                            {'decision': reply}, timeout=20)
    except requests.RequestException:
        logger.exception('智能体确认转发失败')
        return Response({'error': UNAVAILABLE_TEXT}, status=503)
    if response.status_code >= 400:
        logger.warning('opencode 权限回复返回 HTTP %s', response.status_code)
        return Response({'ok': False, 'status': response.status_code,
                         'error': '确认结果未能送达智能体'}, status=502)
    return Response({'ok': True, 'status': response.status_code})


@api_view(['POST'])
@permission_classes([IsAuthenticated])
def agent_upload_complete(request):
    """用户在网页端传完图，把图片 ID 告诉智能体，让它继续建任务并汇报。"""
    session_id = str(request.data.get('session') or '').strip()
    if not session_id:
        return Response({'error': '缺少 session'}, status=400)
    image_ids = []
    for raw in (request.data.get('imageIds') or []):
        try:
            image_id = int(raw)
        except (TypeError, ValueError):
            continue
        if image_id > 0:
            image_ids.append(image_id)
    if not image_ids:
        return Response({'error': 'imageIds 不能为空'}, status=400)

    text = f'用户已在网页端完成上传，图片 ID：[{", ".join(str(i) for i in image_ids)}]。请按流程规则第 2 条执行。'
    task_name = str(request.data.get('taskName') or '').strip()
    model = str(request.data.get('model') or '').strip()
    if task_name:
        text += f'\n任务名：{task_name}'
    if model:
        text += f'\n模型：{model}'

    _write_token_file(request)
    try:
        _send_prompt(session_id, text)
    except requests.RequestException:
        logger.exception('智能体服务不可用：上传完成通知失败')
        return Response({'error': UNAVAILABLE_TEXT}, status=503)
    return Response({'ok': True})
