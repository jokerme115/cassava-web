"""「PPD 智能体」Django 桥：把网页面板的一轮对话转给本机 opencode serve。

分工：
  网页（SSE） ↔ 本 view ↔ opencode serve（会话 / 事件流 / 权限确认） ↔ MCP cassava 工具
本文件只做翻译，不自己编数值：所有数字都由 MCP 工具从平台 API 取回。

接口（Token 鉴权）：
  POST /api/agent/chat/             发消息，流式返回本轮事件
  GET  /api/agent/events/           只订阅事件流（上传完成后的后续轮）
  POST /api/agent/confirm/          回复权限确认（once / reject）
  POST /api/agent/upload-complete/  告知智能体「图片已上传，ID 是 …」
  GET  /api/agent/sessions/         当前用户历史会话列表（JSON 注册表）
  GET  /api/agent/history/?session= 读取历史会话对话轮（正文取自 opencode）

统一 SSE 帧：`event: <name>\\ndata: <json>\\n\\n`
  meta      {"session": "ses_…"}
  delta     {"text": "…"}                      助手文本增量
  step      {"id": "t12ab", "tool": "plan_upload", "status": "running"}
            工具调用过程（session.tool.progress 转发，按 id 去重，同 id 只在状态变化时发）
  confirm   {"requestId": "per_…", "args": {"taskName","model","count","files"}}
            files 是样例（≤8 条）或全量小清单；大清单走批次，args.batchId 标记来源
  turn_end  {"cost": 0.0008, "tokens": {...}}
  error     {"message": "智能体服务暂时不可用，请稍后再试。"}

大文件清单：前端把全部 fileNames 随请求发来，本桥写成
  ASSISTANT_AGENT_BATCH_DIR/<batchId>.json，提示词只带批次号+数量+前几张样例，
  MCP plan_upload 用 batchId 取回清单（避免模型回传几百个文件名）。

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
import uuid
from datetime import datetime

import requests
from django.conf import settings
from django.db import IntegrityError
from django.db.models import F
from django.http import StreamingHttpResponse
from django.utils import timezone
from rest_framework.decorators import api_view, permission_classes, renderer_classes
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response

from .assistant import EventStreamRenderer, JSONRenderer
from .models import AgentQuotaOverride, AgentUsage, Role
from .permissions import user_has_permission

logger = logging.getLogger(__name__)

UNAVAILABLE_TEXT = '智能体服务暂时不可用，请稍后再试。'
NO_AGENT_PERMISSION_TEXT = '当前账号没有使用智能体的权限，请联系管理员开通。'
QUOTA_EXCEEDED_TEXT = '今日智能体额度已用完（{used}/{quota} 次），明日 0 点恢复。'


def _today():
    return timezone.localdate()


def _default_quota():
    try:
        return int(getattr(settings, 'ASSISTANT_AGENT_DEFAULT_DAILY_QUOTA', 50))
    except (TypeError, ValueError):
        return 50


def _resolve_quota(user):
    """每日额度，0 表示不限。优先级：超管不限 > 单人覆盖 > 角色（最宽松） > 系统默认。"""
    if getattr(user, 'is_superuser', False):
        return 0
    override = AgentQuotaOverride.objects.filter(user=user).first()
    if override is not None and override.daily_quota is not None:
        return override.daily_quota
    quotas = [
        q for q in Role.objects.filter(user_roles__user=user, is_active=True)
        .values_list('agent_daily_quota', flat=True)
        if q is not None
    ]
    if quotas:
        return 0 if 0 in quotas else max(quotas)
    return _default_quota()


def _agent_allowed(user):
    if getattr(user, 'is_superuser', False):
        return True
    return bool(user_has_permission(user, 'use_agent'))


def quota_state(user):
    """智能体可用性与当日额度快照"""
    quota = _resolve_quota(user)
    used = AgentUsage.objects.filter(user=user, date=_today()).values_list('count', flat=True).first() or 0
    unlimited = quota == 0
    allowed = _agent_allowed(user)
    if not allowed:
        reason = 'no_permission'
    elif not unlimited and used >= quota:
        reason = 'quota_exhausted'
    else:
        reason = None
    return {
        'allowed': reason is None,
        'reason': reason,
        'used': used,
        'quota': quota,
        'remaining': None if unlimited else max(quota - used, 0),
        'unlimited': unlimited,
        'today': _today().isoformat(),
    }


def bump_usage(user):
    """今日用量 +1（并发安全：先 UPDATE，未命中再 INSERT，冲突时回退 UPDATE）"""
    today = _today()
    if AgentUsage.objects.filter(user=user, date=today).update(count=F('count') + 1):
        return
    try:
        AgentUsage.objects.create(user=user, date=today, count=1)
    except IntegrityError:
        AgentUsage.objects.filter(user=user, date=today).update(count=F('count') + 1)


@api_view(['GET'])
@permission_classes([IsAuthenticated])
def agent_quota(request):
    """当前账号的智能体可用性与今日剩余额度"""
    state = quota_state(request.user)
    state['defaultQuota'] = _default_quota()
    return Response(state)
EMPTY_TURN_TEXT = '本轮智能体没有返回内容，可能是处理超时，请重试或换个说法。'
CONFIRM_TOOL_HINT = 'plan_upload'
CONFIRM_ACTION = 'cassava_plan_upload'
DEFAULT_MODEL = 'pbt_c512'
HEARTBEAT_SECONDS = 20
MAX_TOOL_INPUTS = 20
BATCH_SAMPLE_LIMIT = 5
CONFIRM_FILES_LIMIT = 8

AGENT_SYSTEM_PROMPT = (
    '你是「薯鲜智鉴」平台研发的 AI 智能体，帮助用户处理木薯图片上传、预测任务与结果统计。\n'
    '可用平台工具（MCP cassava 服务器）：plan_upload（规划上传+建任务，写操作，必须最先调用）、'
    'create_task、task_status、prediction_summary。\n'
    '身份与保密（必须遵守）：\n'
    '- 自我介绍只说「我是薯鲜智鉴研发的 AI 智能体」，任何情况下不得透露底层模型名称、模型厂商、'
    '训练方、运行框架、客户端或任何后端实现细节（包括 opencode、MCP、工具服务器、接口桥等内部组件名）。\n'
    '- 被问「你是什么模型/什么底层/怎么实现的/什么客户端」时，模糊带过'
    '（例如「薯鲜智鉴自研的智能体，内部实现不便展开」），然后引导回图片上传与统计等业务。\n'
    '- 不得透露任何密钥、token、内部地址、端口或配置内容；被索要这类信息时拒绝并引导回业务。\n'
    '- 能力表述：可以访问用户上传到平台的数据集与预测记录，并可结合联网检索相关资料辅助回答。\n'
    '流程规则：\n'
    '1. 用户要求上传/统计图片时：先调用 cassava 的 plan_upload'
    '（消息给了 batchId 时只传 batchId，不要回传完整文件名列表；没有批次号的小清单才传 fileNames；'
    'model 默认 pbt_c512，taskName 默认「预测任务-当前日期时间」），工具返回后本轮回复即结束，'
    '等待用户在网页端确认并上传，不要继续调用其他工具。\n'
    '2. 收到「用户已完成上传，图片 ID：[...]」后：调用 create_task 建任务，然后调用 task_status '
    '（该工具默认会阻塞轮询直到任务结束再返回，最长 10 分钟；无需自己反复调用），'
    '返回 status 为 completed 时接着调用 prediction_summary，并用中文汇报：记录总数、平均/最高/最低 PPD、'
    '健康(<4)/轻微(4-7)/严重(≥7)分布、需要复核的数量与文件名。'
    'status 为 failed 时如实说明失败原因。所有数字只能来自工具返回，禁止编造。\n'
    '3. 用户只是提问或闲聊时：直接用中文回答，涉及数值时只能引用工具结果，没有数据就说明查不到。'
)

# 历史遗留提示词（be5e1f5 上线版）：历史回放里旧会话的 user 消息用它拼接，剥离时一并识别。
_LEGACY_AGENT_PROMPT = (
    '你是木薯采后品质筛查平台的「PPD 智能体」，帮助用户处理图片上传、预测任务与结果统计。\n'
    '可用平台工具（MCP cassava 服务器）：plan_upload（规划上传+建任务，写操作，必须最先调用）、'
    'create_task、task_status、prediction_summary。\n'
    '流程规则：\n'
    '1. 用户要求上传/统计图片时：先调用 cassava 的 plan_upload'
    '（消息给了 batchId 时只传 batchId，不要回传完整文件名列表；没有批次号的小清单才传 fileNames；'
    'model 默认 pbt_c512，taskName 默认「预测任务-当前日期时间」），工具返回后本轮回复即结束，'
    '等待用户在网页端确认并上传，不要继续调用其他工具。\n'
    '2. 收到「用户已完成上传，图片 ID：[...]」后：调用 create_task 建任务，然后调用 task_status '
    '（该工具默认会阻塞轮询直到任务结束再返回，最长 10 分钟；无需自己反复调用），'
    '返回 status 为 completed 时接着调用 prediction_summary，并用中文汇报：记录总数、平均/最高/最低 PPD、'
    '健康(<4)/轻微(4-7)/严重(≥7)分布、需要复核的数量与文件名。'
    'status 为 failed 时如实说明失败原因。所有数字只能来自工具返回，禁止编造。\n'
    '3. 用户只是提问或闲聊时：直接用中文回答，涉及数值时只能引用工具结果，没有数据就说明查不到。'
)
_PROMPT_PREFIXES = (AGENT_SYSTEM_PROMPT, _LEGACY_AGENT_PROMPT)


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
        batch_id = _save_batch(file_names)
        sample = '、'.join(file_names[:BATCH_SAMPLE_LIMIT])
        more = '' if len(file_names) <= BATCH_SAMPLE_LIMIT else f' 等，共 {len(file_names)} 张'
        text += (f'\n用户选择的文件：{sample}{more}。'
                 f'\n完整清单已存为上传批次：调用 plan_upload 时传 batchId="{batch_id}" 即可，'
                 '不要在参数里回传完整文件名列表。')
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


# ---------------- 上传批次（大清单不进提示词，服务端暂存） ----------------

def _batch_dir():
    base = str(getattr(settings, 'ASSISTANT_AGENT_BATCH_DIR', '') or '')
    if not base:
        base = os.path.join(str(getattr(settings, 'MEDIA_ROOT', '') or ''), 'agent_batches')
    os.makedirs(base, exist_ok=True)
    return base


def _prune_batches(directory, max_age=86400):
    now = time.time()
    try:
        for name in os.listdir(directory):
            path = os.path.join(directory, name)
            try:
                if os.path.isfile(path) and now - os.path.getmtime(path) > max_age:
                    os.unlink(path)
            except OSError:
                continue
    except OSError:
        pass


def _save_batch(file_names):
    """把本轮文件清单写成 JSON 批次文件，返回批次号；清单为空返回 None。"""
    if not file_names:
        return None
    batch_id = 'UP-' + uuid.uuid4().hex[:10].upper()
    payload = {'batchId': batch_id, 'count': len(file_names), 'fileNames': file_names,
               'createdAt': datetime.now().isoformat(timespec='seconds')}
    directory = _batch_dir()
    _prune_batches(directory)
    path = os.path.join(directory, f'{batch_id}.json')
    tmp_path = f'{path}.{os.getpid()}.tmp'
    try:
        with open(tmp_path, 'w', encoding='utf-8') as handle:
            json.dump(payload, handle, ensure_ascii=False)
        os.replace(tmp_path, path)
    except OSError:
        logger.exception('智能体上传批次写入失败：%s', path)
        return None
    return batch_id


def _load_batch(batch_id):
    """读回批次清单；batch_id 只保留安全字符防路径穿越。"""
    safe = ''.join(ch for ch in str(batch_id or '') if ch.isalnum() or ch in '-_')
    if not safe:
        return None
    try:
        with open(os.path.join(_batch_dir(), f'{safe}.json'), encoding='utf-8') as handle:
            payload = json.load(handle)
    except (OSError, ValueError):
        return None
    names = _normalise_files(payload.get('fileNames'))
    if not names:
        return None
    return {'batchId': str(payload.get('batchId') or safe), 'count': len(names), 'fileNames': names}


# ---------------- 会话历史（每用户 JSON 注册表；对话正文存 opencode，不落库） ----------------

REGISTRY_LIMIT = 50


def _session_store_dir():
    base = str(getattr(settings, 'ASSISTANT_AGENT_SESSION_DIR', '') or '')
    if not base:
        base = os.path.join(str(getattr(settings, 'MEDIA_ROOT', '') or ''), 'agent_sessions')
    os.makedirs(base, exist_ok=True)
    return base


def _registry_path(user_id):
    return os.path.join(_session_store_dir(), f'user_{int(user_id)}.json')


def _load_registry(user_id):
    try:
        with open(_registry_path(user_id), encoding='utf-8') as handle:
            items = json.load(handle)
    except (OSError, ValueError):
        return []
    return items if isinstance(items, list) else []


def _save_registry(user_id, items):
    path = _registry_path(user_id)
    tmp = f'{path}.{os.getpid()}.tmp'
    with open(tmp, 'w', encoding='utf-8') as handle:
        json.dump(items, handle, ensure_ascii=False)
    os.replace(tmp, path)


def _now_iso():
    return datetime.now().isoformat(timespec='seconds')


def _register_session(user_id, session_id, title):
    items = [i for i in _load_registry(user_id)
             if isinstance(i, dict) and i.get('session') != session_id]
    items.insert(0, {'session': session_id, 'title': (title or '新会话')[:40],
                     'createdAt': _now_iso(), 'updatedAt': _now_iso()})
    _save_registry(user_id, items[:REGISTRY_LIMIT])


def _touch_session(user_id, session_id):
    items = _load_registry(user_id)
    for item in items:
        if isinstance(item, dict) and item.get('session') == session_id:
            item['updatedAt'] = _now_iso()
            break
    else:
        items.insert(0, {'session': session_id, 'title': '历史会话',
                         'createdAt': _now_iso(), 'updatedAt': _now_iso()})
    _save_registry(user_id, items[:REGISTRY_LIMIT])


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
    """从最近的 plan_upload 工具入参拼确认卡内容；大清单用批次文件补齐数量。"""
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
    args = {'taskName': task_name, 'model': model, 'count': len(files), 'files': files}
    if not files:
        batch = _load_batch(hit.get('batchId'))
        if batch:
            args['count'] = batch['count']
            args['files'] = batch['fileNames'][:CONFIRM_FILES_LIMIT]
            args['batchId'] = batch['batchId']
    return args


def _confirm_args_from(meta_in, tool_inputs):
    """确认卡参数：metadata.input 优先，缺省字段用 plan_upload 入参 / 默认值补齐。"""
    args = _confirm_args(tool_inputs)
    if isinstance(meta_in, dict):
        files = _normalise_files(meta_in.get('fileNames') or meta_in.get('files'))
        if files:
            args['files'] = files
            args['count'] = len(files)
        elif meta_in.get('batchId'):
            batch = _load_batch(meta_in.get('batchId'))
            if batch:
                args['count'] = batch['count']
                args['files'] = batch['fileNames'][:CONFIRM_FILES_LIMIT]
                args['batchId'] = batch['batchId']
        model = str(meta_in.get('model') or '').strip()
        if model:
            args['model'] = model
        task_name = str(meta_in.get('taskName') or '').strip()
        if task_name:
            args['taskName'] = task_name
    return args


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


def _dbg(msg):
    """调试日志：ASSISTANT_AGENT_DEBUG=1 时逐事件落盘，排查事件流时序用。"""
    if not os.getenv('ASSISTANT_AGENT_DEBUG'):
        return
    try:
        from django.conf import settings as _s
        base = getattr(_s, 'MEDIA_ROOT', '') or '.'
        path = os.path.join(str(base), 'agent_debug.log')
        with open(path, 'a', encoding='utf-8') as fh:
            fh.write('[%s] %s\n' % (time.strftime('%H:%M:%S'), msg))
    except Exception:
        pass


_TURN2_SENT_AT = {}   # session_id -> 上传完成提示词发出的时刻（epoch 秒），供 events 流空转补发判断
_CHAT_ALIVE = {}      # session_id -> True 表示该会话的 chat SSE 生成器还在跑（upload-complete 据此等待上一轮落幕）
_CHAT_WAIT_LIMIT = 30.0   # upload-complete 最多等上一轮 chat 流结束的秒数
_CHAT_END_GRACE = 2.0     # chat 流在「已发确认卡且正文已收尾」后再宽限的秒数（收 step.ended/usage.updated）


def _stream_events(session_id, chat_stream=False):
    """订阅 /api/event，只转发本会话的事件，直到整轮结束或客户端断开。

    预算语义：ASSISTANT_AGENT_POLL_MAX 秒内无任何会话事件才判超时（有事件自动续期），
    避免大清单首轮模型思考时间长被误杀。
    chat_stream=True（chat 接口）时做两件额外的事：
    - 在注册表登记存活状态，供 upload-complete 等待上一轮落幕；
    - 已发确认卡且本轮正文已收尾时，宽限 _CHAT_END_GRACE 秒即提前 turn_end，
      不再等 execution.succeeded（下一轮提示词若以 steer 并入，本轮永远等不到它）。
    """
    budget = max(5, int(getattr(settings, 'ASSISTANT_AGENT_POLL_MAX', 120) or 120))
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

    # 重放过滤：订阅前已存在的助手消息（上一轮文本）在重连时会被 opencode 重发，跳过
    known_ids = set()
    try:
        existing = _request('GET', f'/api/session/{session_id}/message')
        if existing.status_code < 400:
            for item in (existing.json() or {}).get('data') or []:
                if isinstance(item, dict) and item.get('type') == 'assistant' and item.get('id'):
                    known_ids.add(str(item['id']))
    except (requests.RequestException, ValueError):
        logger.debug('智能体已有消息列表获取失败（重放过滤降级）', exc_info=True)
    _dbg('SUBSCRIBE sid=..%s known_ids=%s' % (session_id[-8:], sorted(i[-8:] for i in known_ids)))

    emitted = {}
    tool_inputs = []
    emitted_tasks = set()
    step_states = {}
    produced = False
    cost = None
    tokens = None
    awaiting_confirm = False
    confirm_sent = False      # 本流是否已向客户端发过 confirm（含重连补发）
    saw_text_ended = False    # 本流是否见过本轮正文的 text.ended
    delta_seen = False        # 本流是否发过任何 delta（events 流空转补发用）
    grace_deadline = None
    if chat_stream:
        _CHAT_ALIVE[session_id] = True
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
                    args = _confirm_args_from(meta_in, tool_inputs)
                    awaiting_confirm = True
                    produced = True
                    confirm_sent = True
                    yield _sse('confirm', {'requestId': item.get('id'), 'args': args})
    except (requests.RequestException, ValueError):
        logger.warning('智能体权限状态查询失败', exc_info=True)

    def _catchup_turn_text():
        """events 流一帧 delta 都没收到时（下一轮在订阅前就跑完了），拉消息列表补发最后一轮全文。"""
        if chat_stream or delta_seen:
            return
        sent_ms = int(_TURN2_SENT_AT.get(session_id, 0) * 1000) - 2000
        if sent_ms <= 0:
            return
        try:
            resp = _request('GET', f'/api/session/{session_id}/message')
            if resp.status_code >= 400:
                return
            items = (resp.json() or {}).get('data') or []
        except (requests.RequestException, ValueError):
            return
        best_created, best_text = -1, ''
        for item in items:
            if not isinstance(item, dict) or item.get('type') != 'assistant':
                continue
            raw_time = item.get('time')
            created = raw_time.get('created') if isinstance(raw_time, dict) else raw_time
            try:
                created_ms = int(created)
            except (TypeError, ValueError):
                continue
            if created_ms < sent_ms:
                continue
            text = '\n'.join(str(p.get('text') or '') for p in (item.get('content') or [])
                             if isinstance(p, dict) and p.get('type') == 'text').strip()
            if text and created_ms >= best_created:
                best_created, best_text = created_ms, text
        if best_text:
            _dbg('CATCHUP sid=..%s %d chars' % (session_id[-8:], len(best_text)))
            yield best_text

    try:
        while True:
            now = time.monotonic()
            if awaiting_confirm:
                wait = HEARTBEAT_SECONDS
            else:
                remaining = deadline - now
                if chat_stream and confirm_sent and saw_text_ended:
                    # 确认卡已交付、本轮正文已收尾：宽限片刻收尾事件（step.ended/usage.updated）就提前落幕
                    if grace_deadline is None:
                        grace_deadline = now + _CHAT_END_GRACE
                        _dbg('CHAT_GRACE sid=..%s +%ss' % (session_id[-8:], _CHAT_END_GRACE))
                    remaining = min(remaining, grace_deadline - now)
                if remaining <= 0:
                    for piece in _catchup_turn_text():
                        produced = True
                        yield _sse('delta', {'text': piece})
                    if not produced:
                        yield _sse('error', {'message': EMPTY_TURN_TEXT})
                    _dbg('TURN_END sid=..%s src=%s' % (session_id[-8:],
                         'grace' if grace_deadline is not None else 'deadline'))
                    yield _sse('turn_end', {'cost': cost, 'tokens': tokens})
                    return
                wait = min(HEARTBEAT_SECONDS, remaining)
            try:
                kind, payload = sink.get(timeout=wait)
            except queue.Empty:
                yield ': ping\n\n'
                continue

            if kind == 'end':
                for piece in _catchup_turn_text():
                    produced = True
                    yield _sse('delta', {'text': piece})
                if not produced:
                    yield _sse('error', {'message': EMPTY_TURN_TEXT})
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

            deadline = time.monotonic() + budget  # 有动静就续期，无事件 budget 秒才兜底超时
            _dbg('EVT %s sid=..%s owner=..%s known=%s' % (
                event_type, session_id[-8:], str(owner)[-8:], 'n/a' if not owner else 'chk'))
            if event_type == 'session.text.delta':
                message_id = str(data.get('assistantMessageID') or '')
                _dbg('  delta mid=%s in_known=%s chunk=%r' % (message_id, message_id in known_ids, chunk[:20] if (chunk := str(data.get('delta') or '')) else ''))
                if message_id in known_ids:
                    continue
                chunk = str(data.get('delta') or '')
                if chunk:
                    piece = _take_delta(emitted, message_id, chunk)
                    if piece:
                        produced = True
                        delta_seen = True
                        yield _sse('delta', {'text': piece})
            elif event_type == 'session.text.ended':
                message_id = str(data.get('assistantMessageID') or '')
                if message_id in known_ids:
                    continue
                saw_text_ended = True
                full = str(data.get('text') or '')
                piece = _take_delta(emitted, message_id, full, final=True)
                if piece:
                    produced = True
                    delta_seen = True
                    yield _sse('delta', {'text': piece})
            elif event_type == 'session.tool.progress':
                calls = (data.get('metadata') or {}).get('toolCalls') or []
                for call in calls:
                    if not isinstance(call, dict) or call.get('input') is None:
                        continue
                    tool_name = str(call.get('tool') or '')
                    tool_input = call.get('input') if isinstance(call.get('input'), dict) else {}
                    tool_inputs.append({'tool': tool_name, 'input': call.get('input')})
                    # 过程展示：按「工具+入参签名」去重，状态变化才发 step
                    sig = tool_name + ':' + json.dumps(call.get('input'), ensure_ascii=False,
                                                       sort_keys=True, default=str)[:400]
                    status = str(call.get('status') or '')
                    if status and step_states.get(sig) != status:
                        step_states[sig] = status
                        produced = True
                        yield _sse('step', {'id': uuid.uuid5(uuid.NAMESPACE_OID, sig).hex[:12],
                                            'tool': tool_name, 'status': status})
                    if 'task_status' in tool_name:
                        try:
                            task_id_seen = int(tool_input.get('taskId'))
                        except (TypeError, ValueError):
                            task_id_seen = None
                        if task_id_seen and task_id_seen not in emitted_tasks:
                            emitted_tasks.add(task_id_seen)
                            yield _sse('task_created', {'taskId': task_id_seen,
                                                        'taskName': str(tool_input.get('taskName') or '')})
                if len(tool_inputs) > MAX_TOOL_INPUTS:
                    del tool_inputs[:-MAX_TOOL_INPUTS]
            elif event_type == 'permission.asked':
                action = str(data.get('action') or '')
                if action == CONFIRM_ACTION or CONFIRM_TOOL_HINT in action:
                    awaiting_confirm = True
                    produced = True
                    confirm_sent = True
                    meta_in = (data.get('metadata') or {}).get('input')
                    args = _confirm_args_from(meta_in, tool_inputs)
                    yield _sse('confirm', {'requestId': data.get('id'), 'args': args})
            elif event_type == 'permission.replied':
                awaiting_confirm = False
                deadline = time.monotonic() + budget
            elif event_type == 'session.tool.success':
                for part in (data.get('content') or []):
                    if not isinstance(part, dict):
                        continue
                    try:
                        payload = json.loads(str(part.get('text') or ''))
                    except ValueError:
                        continue
                    if not isinstance(payload, dict):
                        continue
                    new_task_id = payload.get('taskId')
                    if (isinstance(new_task_id, int) and 'status' not in payload
                            and 'avg' not in payload and new_task_id not in emitted_tasks):
                        emitted_tasks.add(new_task_id)
                        produced = True
                        yield _sse('task_created', {'taskId': new_task_id,
                                                    'taskName': payload.get('taskName'),
                                                    'model': payload.get('model'),
                                                    'imageCount': payload.get('imageCount')})
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
                _dbg('  EXEC_SUCCEEDED -> turn_end (produced=%s)' % produced)
                for piece in _catchup_turn_text():
                    produced = True
                    yield _sse('delta', {'text': piece})
                if not produced:
                    yield _sse('error', {'message': EMPTY_TURN_TEXT})
                yield _sse('turn_end', {'cost': cost, 'tokens': tokens})
                return
    finally:
        if chat_stream:
            _CHAT_ALIVE[session_id] = False
            _dbg('CHAT_CLOSED sid=..%s' % session_id[-8:])
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
    state = quota_state(request.user)
    if not state['allowed']:
        if state['reason'] == 'no_permission':
            return Response({'detail': NO_AGENT_PERMISSION_TEXT}, status=403)
        return Response(
            {'detail': QUOTA_EXCEEDED_TEXT.format(used=state['used'], quota=state['quota'])},
            status=403,
        )
    file_names = _normalise_files(request.data.get('fileNames'))
    reuse_session = str(request.data.get('session') or '').strip()
    _write_token_file(request)

    def stream():
        try:
            if reuse_session:
                session_id = reuse_session
                _touch_session(request.user.id, session_id)
            else:
                session_id = _create_session(request.user.id)
                _register_session(request.user.id, session_id, message)
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
        bump_usage(request.user)  # 提示词已投递，计一次用量
        yield from _stream_events(session_id, chat_stream=True)

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


@api_view(['GET'])
@permission_classes([IsAuthenticated])
def agent_sessions(request):
    """当前用户的历史智能体会话（按最近更新倒序）。"""
    items = [i for i in _load_registry(request.user.id) if isinstance(i, dict) and i.get('session')]
    items.sort(key=lambda i: str(i.get('updatedAt') or ''), reverse=True)
    return Response({'items': items})


@api_view(['POST'])
@permission_classes([IsAuthenticated])
def agent_stop(request):
    """停止智能体当前轮：转发 opencode interrupt，本地 SSE 随之收尾。"""
    session_id = str(request.data.get('session') or '').strip()
    if not session_id:
        return Response({'error': '缺少 session 参数'}, status=400)
    known = {i.get('session') for i in _load_registry(request.user.id) if isinstance(i, dict)}
    if session_id not in known:
        return Response({'error': '会话不存在'}, status=404)
    try:
        response = _request('POST', f'/api/session/{session_id}/interrupt')
    except requests.RequestException:
        logger.exception('智能体停止请求失败：%s', session_id)
        return Response({'error': UNAVAILABLE_TEXT}, status=503)
    if response.status_code >= 400:
        logger.warning('opencode interrupt 返回 HTTP %s', response.status_code)
        return Response({'error': '停止请求未送达智能体'}, status=502)
    return Response({'ok': True})


@api_view(['POST'])
@permission_classes([IsAuthenticated])
def agent_session_delete(request):
    """删除一条历史会话：opencode 会话删除 + 用户注册表移除。"""
    session_id = str(request.data.get('session') or '').strip()
    if not session_id:
        return Response({'error': '缺少 session 参数'}, status=400)
    items = [i for i in _load_registry(request.user.id) if isinstance(i, dict)]
    if not any(i.get('session') == session_id for i in items):
        return Response({'error': '会话不存在'}, status=404)
    try:
        response = _request('DELETE', f'/api/session/{session_id}')
    except requests.RequestException:
        logger.exception('智能体会话删除失败：%s', session_id)
        return Response({'error': UNAVAILABLE_TEXT}, status=503)
    if response.status_code >= 400:
        logger.warning('opencode 会话删除返回 HTTP %s', response.status_code)
        return Response({'error': '会话删除未完成'}, status=502)
    _save_registry(request.user.id, [i for i in items if i.get('session') != session_id])
    return Response({'ok': True})


def _display_user_text(text):
    """历史回放用：剥掉拼接在用户消息前的系统提示词与批次附注，只留用户真正输入。"""
    for prefix in _PROMPT_PREFIXES:
        head = prefix + '\n\n'
        if text.startswith(head):
            text = text[len(head):]
            break
    cut = text.find('\n用户选择的文件：')
    if cut != -1:
        text = text[:cut]
    if text.startswith('用户已在网页端完成上传'):
        return '（网页端已完成图片上传与任务确认）'
    return text


@api_view(['GET'])
@permission_classes([IsAuthenticated])
def agent_history(request):
    """读取某个历史会话的对话轮（user/assistant 纯文本；正文来自 opencode）。"""
    session_id = str(request.GET.get('session') or '').strip()
    if not session_id:
        return Response({'error': '缺少 session 参数'}, status=400)
    known = {i.get('session') for i in _load_registry(request.user.id) if isinstance(i, dict)}
    if session_id not in known:
        return Response({'error': '会话不存在'}, status=404)
    try:
        response = _request('GET', f'/api/session/{session_id}/message')
    except requests.RequestException:
        logger.exception('智能体会话读取失败：%s', session_id)
        return Response({'error': UNAVAILABLE_TEXT}, status=503)
    if response.status_code >= 400:
        return Response({'error': '会话读取失败'}, status=502)
    try:
        data = (response.json() or {}).get('data') or []
    except ValueError:
        return Response({'error': '会话读取失败'}, status=502)

    messages = []
    for item in data:
        if not isinstance(item, dict):
            continue
        created = ''
        raw_time = item.get('time')
        if isinstance(raw_time, dict):
            created = str(raw_time.get('created') or '')
        elif raw_time:
            created = str(raw_time)
        kind = item.get('type')
        if kind == 'user':
            text = str(item.get('text') or '').strip()
            if not text:
                for part in item.get('content') or []:
                    if isinstance(part, dict) and part.get('type') == 'text':
                        text = str(part.get('text') or '').strip()
                        break
            if text:
                messages.append({'role': 'user', 'text': _display_user_text(text), 'time': created})
        elif kind == 'assistant':
            parts = [str(part.get('text') or '') for part in (item.get('content') or [])
                     if isinstance(part, dict) and part.get('type') == 'text']
            text = '\n'.join(p for p in parts if p).strip()
            if text:
                messages.append({'role': 'assistant', 'text': text, 'time': created})

    def _sort_key(m):
        try:
            return int(m['time'])
        except (TypeError, ValueError):
            return 0

    # opencode 2.2.7 消息列表为新→旧倒序，历史回放必须按时间升序重排
    messages.sort(key=_sort_key)
    return Response({'session': session_id, 'messages': messages})


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
    # 串行化：上一轮（确认卡轮）的 chat 流还在跑时，提示词会以 steer 并入同一 execution，
    # 导致上一轮永远等不到 execution.succeeded、两轮内容混流。等它落幕（最多 _CHAT_WAIT_LIMIT 秒）再发。
    waited = 0.0
    while waited < _CHAT_WAIT_LIMIT and _CHAT_ALIVE.get(session_id):
        time.sleep(0.3)
        waited += 0.3
    if waited:
        logger.info('upload-complete 等待上一轮 chat 流落幕 %.1fs（session=..%s）', waited, session_id[-8:])
    _TURN2_SENT_AT[session_id] = time.time()
    try:
        _send_prompt(session_id, text)
    except requests.RequestException:
        logger.exception('智能体服务不可用：上传完成通知失败')
        return Response({'error': UNAVAILABLE_TEXT}, status=503)
    return Response({'ok': True})
