"""结果中心「PPD 助手」：检索增强对话。

原则：模型只负责说话，检索负责说真话——所有数字来自后端检索到的真实记录，
模型拿不到检索结果时只能反问，不许现编数值（2026-11-11 需求文档）。

接口：POST /api/assistant/chat/（Token 鉴权，text/event-stream 流式返回）
SSE 事件：
  {"type":"status","text":"正在检索结果中心记录…"}
  {"type":"evidence","cards":[...],"scopeNote":"…","notFound":[...]}
  {"type":"delta","text":"片段"}                     # 多次，顺序拼接为完整回答
  {"type":"followup","text":"还需要看这张的复检状态吗？"}
  {"type":"done","source":"llm|template"}
  {"type":"error","text":"助手服务暂时不可用，请查看结果中心记录列表。"}

降级链路：大模型失败/超时 → 纯查表模板回答（source=template）；
模板也失败 → error 事件（前端显示兜底文案）。
"""
import json
import logging
import re

import requests
from django.conf import settings
from django.utils import timezone
from django.db.models import Q
from rest_framework.decorators import api_view, authentication_classes, permission_classes, renderer_classes
from rest_framework.permissions import IsAuthenticated
from rest_framework.renderers import BaseRenderer, JSONRenderer
from rest_framework.response import Response

from .authentication import ExpiringTokenAuthentication
from .measurement import measurement_info, latest_correction
from .models import PredictionResult

logger = logging.getLogger(__name__)

# 与前端 modelLabels.ts 的 SHORT 表保持一致（卡片/注入用短名）
_MODEL_SHORT = {
    'pbt_c512': 'PBT · 512 ×5',
    'pbt_c384': 'PBT · 384 ×5',
    'hrnet_w48': 'HRNet-W48',
    'mask2former_swin_t': 'Mask2Former',
    'm6_best': 'M6',
    'resnet101': '有监督模型',
    'ensemble': '投票模型',
}

FILE_RE = re.compile(r'[\w ()\[\]（）\-·]+\.(?:jpg|jpeg|png|bmp|tif|tiff|webp)', re.I)
PCT_RE = re.compile(r'(\d+(?:\.\d+)?)\s*%')

RECENT_LIMIT = 50
MAX_NAMED = 8

SYSTEM_PROMPT = (
    '你是木薯采后品质筛查平台的「PPD 助手」，面向评审专家回答关于 PPD（采后生理性劣变）预测结果的问题。\n'
    '\n'
    '规则（必须遵守）：\n'
    '1. 所有数值（PPD、像素数、百分比、日期、文件名、模型名）只能引用 <检索结果> 中出现的记录，'
    '禁止编造、推算或修改任何数值。\n'
    '2. <检索结果> 为空或未包含用户所问记录时：不要猜测，列出当前可查的记录让用户选择，'
    '或说明该数据不在结果中心实时记录内。\n'
    '3. 回答结构：先一句直接结论，再给口径说明（"有效切面内劣变像素数 ÷ 有效切面像素数 × 100%，面积加权"），'
    '不超过 4 行。\n'
    '4. 涉及业务判断（如复核建议）时，必须落在"以人工复核为准"，不得替用户下验收结论。\n'
    '5. 用简体中文，语气专业克制，不用感叹号，不出现"作为AI"等自我介绍。\n'
    '6. 待复核的记录必须如实标注"待复核"，不得说成"已确认"。\n'
)

FOLLOWUP_TEXT = '还需要看这张的复检状态吗？'
UNAVAILABLE_TEXT = '助手服务暂时不可用，请查看结果中心记录列表。'
ARCHIVAL_TEXT = ('该数值来自历史工程测试归档，不在结果中心当前记录内，无法实时核对。'
                 '历史归档请参见项目记录。')
ADVICE_TEXT = ('反光和切痕会影响边界判定。建议：先对照原图与预测轮廓，边界看不清时复拍再复核，'
               '并把处理结论写入复核记录。数值接近业务阈值时，一律以人工复核为准。')
FORMULA_TEXT = '该数值按面积加权口径计算：有效切面内的劣变像素数 ÷ 有效切面像素数 × 100%。'


def _model_label(record):
    name = record.single_model_type or record.model_type or ''
    return _MODEL_SHORT.get(name, name or '--')


def record_payload(record):
    """一条结果记录的可注入/可展示形态（卡片与检索结果共用同一来源）。"""
    info = measurement_info(record)
    corr = latest_correction(record)
    task = record.processing_task
    image_name = record.original_image.name if record.original_image else (
        record.segmentation.name if record.segmentation else f'记录{record.pk}')
    task_time = task.created_time if task and task.created_time else record.prediction_time
    if timezone.is_aware(task_time):
        task_time = timezone.localtime(task_time)
    return {
        'fileName': image_name,
        'ppd': None if info['final_ppd'] is None else round(float(info['final_ppd']), 2),
        'reviewed': info['review_status'] == 'reviewed',
        'reviewStatusText': '已复核' if info['review_status'] == 'reviewed' else '待复核',
        'model': _model_label(record),
        'modelType': record.model_type,
        'singleModelType': record.single_model_type,
        'isEnsemble': record.is_ensemble,
        'confidenceThreshold': record.confidence_threshold,
        'taskName': task.name if task else None,
        'taskTime': task_time.strftime('%Y-%m-%d %H:%M:%S'),
        'predictionTime': record.prediction_time.strftime('%Y-%m-%d %H:%M:%S'),
        'errorCode': record.error_code or None,
        'measurementSource': info['measurement_source'],
        'correctionVersion': info['correction_version'],
        'cassavaPixels': corr.cassava_pixels if corr else None,
        'rottenPixels': corr.rotten_pixels if corr else None,
        'width': corr.width if corr else None,
        'height': corr.height if corr else None,
    }


def base_queryset(user=None):
    """与结果中心列表同一可见性口径：本人图片/任务的记录，超管看全部。"""
    qs = (PredictionResult.objects
          .select_related('original_image', 'processing_task', 'segmentation')
          .prefetch_related('corrections')
          .order_by('-prediction_time'))
    if user and not user.is_superuser:
        qs = qs.filter(Q(original_image__owner=user) | Q(processing_task__owner=user))
    return qs


def retrieve(message, last_file=None, user=None):
    """按用户输入检索结果中心记录。

    返回 (records_payload, cards, scope_note, not_found)。
    cards = 依据卡片要展示的记录子集；records_payload 注入系统提示词。
    """
    filenames = [m.group().strip() for m in FILE_RE.finditer(message)]
    matched, not_found, scope = [], [], 'recent'
    if filenames:
        scope = 'named'
        seen = set()
        for fn in filenames:
            stem = fn.rsplit('.', 1)[0].strip()
            hit = list(base_queryset(user).filter(
                Q(original_image__name__iexact=fn) | Q(original_image__name__icontains=stem)
            )[:3])
            if hit:
                for item in hit:
                    if item.pk not in seen:
                        seen.add(item.pk)
                        matched.append(item)
            else:
                not_found.append(fn)
        matched = matched[:MAX_NAMED]
    elif last_file:
        scope = 'named'
        stem = str(last_file).rsplit('.', 1)[0].strip()
        matched = list(base_queryset(user).filter(
            Q(original_image__name__iexact=last_file) | Q(original_image__name__icontains=stem)
        )[:1])
        if not matched:
            not_found.append(str(last_file))

    percentages = [float(x) for x in PCT_RE.findall(message)]
    if not matched and percentages:
        # 提到具体数值（如"10.42%"）但没指名文件：按数值近似匹配
        target = percentages[0]
        candidates = list(base_queryset(user)[:200])
        matched = [c for c in candidates if c.ppd_value is not None
                   and abs(float(c.ppd_value) - target) < 0.02][:MAX_NAMED]

    if not matched and scope == 'recent':
        matched = list(base_queryset(user)[:RECENT_LIMIT])

    payloads = [record_payload(r) for r in matched]
    if scope == 'named' and not not_found:
        cards = payloads[:3]
    elif not_found and not payloads:
        cards = []
    else:
        cards = payloads[:3]

    if scope == 'named':
        scope_note = (f'命中 {len(payloads)} 条记录' + (f'（未命中：{"、".join(not_found)}）' if not_found else ''))
    else:
        scope_note = f'结果中心当前共 {len(payloads)} 条记录'
    return payloads, cards, scope_note, not_found


def _fmt_ppd(payload):
    if payload['ppd'] is None:
        return '—'
    return f"{payload['ppd']:.2f}%"


def _dedupe_by_name(payloads):
    """同名文件多条记录时只保留第一条（用于"请选择一张"清单，避免重复刷屏）。"""
    seen = set()
    out = []
    for p in payloads:
        name = p['fileName'] or ''
        if name in seen:
            continue
        seen.add(name)
        out.append(p)
    return out


def record_list_line(payloads):
    return '、'.join(f"{p['fileName']}（{_fmt_ppd(p)}）" for p in payloads)


def template_answer(message, payloads, scope_note, not_found, last_file=None, history=None):
    """纯查表模板回答（大模型不可用时的降级，也是兜底链路的最后一环）。"""
    text_lower = message.lower()
    records = payloads or []

    # 追问"是/否"：上一轮回答过某条记录，给出复检状态
    if last_file and message.strip() in ('是', '好的', '需要', '要看', '看一下', '麻烦看下'):
        target = next((p for p in records if p['fileName'] == last_file), None)
        if target:
            return (f"{target['fileName']} 的复检状态：{target['reviewStatusText']}。"
                    f"模型 {_model_label(target) if False else target['model']}，"
                    f"任务时间 {target['taskTime']}。复核结论以人工复核记录为准。")
        return f'未在结果中心找到 {last_file} 的记录，无法核对复检状态。'

    # 意图 4：复核建议（固定文案，无需检索）
    if any(k in message for k in ('反光', '切痕', '边界', '怎么用', '复核建议', '怎么判断')):
        return ADVICE_TEXT

    # 意图 6：历史归档试探
    if ('m6' in text_lower or '7.58' in message) and not any(
            p['fileName'] and 'm6' in p['fileName'].lower() for p in records):
        return ARCHIVAL_TEXT

    # 意图 2：解释计算口径
    if any(k in message for k in ('怎么算', '怎么来的', '如何计算', '怎么计算', '口径', '公式')):
        named = [p for p in records if any(k and k in (p['fileName'] or '') for k in
                                          [m.group().strip() for m in FILE_RE.finditer(message)])] or records[:1]
        if named:
            p = named[0]
            if p['cassavaPixels']:
                detail = (f"{p['fileName']}：劣变像素 {p['rottenPixels']} ÷ 有效切面像素 "
                          f"{p['cassavaPixels']} × 100% ≈ {_fmt_ppd(p)}")
            else:
                detail = f"{p['fileName']}：当前 PPD {_fmt_ppd(p)}（像素明细以人工修订记录为准）"
            return (FORMULA_TEXT + '\n' + detail +
                    '。预测与复核状态可逐像素人工修订，修订记录留存于结果中心。')
        return FORMULA_TEXT + '结果中心当前没有可对应的记录。'

    # 意图 3：批量摘要
    if any(k in message for k in ('哪些', '平均', '最高', '几条', '多少条', '汇总', '没复核', '未复核', '待复核')):
        if not records:
            return '结果中心当前没有可核对的记录。'
        unreviewed = [p for p in records if not p['reviewed']]
        highest = max((p for p in records if p['ppd'] is not None),
                      key=lambda p: p['ppd'], default=None)
        lines = [f'{scope_note}：']
        for p in records:
            lines.append(f"- {p['fileName']} — PPD {_fmt_ppd(p)}，{p['reviewStatusText']}")
        text = '\n'.join(lines)
        if unreviewed and highest and highest['fileName'] in [p['fileName'] for p in unreviewed]:
            text += (f"\n建议优先复核数值较大、接近业务阈值的 {highest['fileName']}"
                     f"（{_fmt_ppd(highest)}）。")
        text += '复核结论以人工复核为准。'
        return text

    # 意图 1：指名查单条
    filenames = [m.group().strip() for m in FILE_RE.finditer(message)]
    if filenames:
        hits = [p for p in records if p['fileName'] and p['fileName'] in filenames]
        if hits:
            out = []
            for p in hits:
                out.append(f"{p['fileName']} 的 PPD 预测值为 {_fmt_ppd(p)}，"
                           f"当前状态：{p['reviewStatusText']}。")
                out.append(f"模型：{p['model']} · 任务时间 {p['taskTime']}。")
            return '\n'.join(out)
        if not_found:
            if any(p['fileName'] for p in records):
                uniq = _dedupe_by_name(records)
                return (f"结果中心未找到 {'、'.join(not_found)} 的实时记录。"
                        f"当前可查：{record_list_line(uniq)}。")
            return f"结果中心未找到 {'、'.join(not_found)} 的实时记录，无法实时核对。"
        return ARCHIVAL_TEXT if ('m6' in text_lower or '7.58' in message) else (
            '结果中心没有与该问题对应的实时记录。')

    # 意图 5：信息不足 → 反问兜底
    if records:
        uniq = _dedupe_by_name(records)
        shown = uniq[:8]
        suffix = f" 等 {len(uniq)} 张图片" if len(uniq) > 8 else ""
        return (f'您想查哪一张？结果中心当前有 {len(records)} 条记录'
                f'（涉及 {len(uniq)} 张图片）：{record_list_line(shown)}{suffix}。')
    return '结果中心当前没有记录可核对。'


def _sse(data):
    return f'data: {json.dumps(data, ensure_ascii=False)}\n\n'


def _llm_url():
    base = (settings.ASSISTANT_LLM_BASE_URL or '').rstrip('/')
    if base.endswith('/chat/completions'):
        return base
    return base + '/chat/completions'


def _llm_stream(message, history, records_payload):
    """逐段 yield delta 事件；成功返回完整文本，失败返回 None。"""
    retrieval_block = json.dumps({
        '说明': '以下为结果中心实时检索到的记录，未列出的数据不可引用',
        '检索结果': records_payload,
    }, ensure_ascii=False)
    messages = [{'role': 'system', 'content': SYSTEM_PROMPT + '\n<检索结果>\n' + retrieval_block + '\n</检索结果>'}]
    for item in (history or [])[-8:]:
        role = item.get('role')
        content = item.get('content')
        if role in ('user', 'assistant') and isinstance(content, str) and content.strip():
            messages.append({'role': role, 'content': content[:2000]})
    messages.append({'role': 'user', 'content': message})

    body = {
        'model': settings.ASSISTANT_LLM_MODEL,
        'messages': messages,
        'stream': True,
        'temperature': 0.3,
        'max_tokens': 600,
    }
    headers = {'Authorization': f'Bearer {settings.ASSISTANT_LLM_API_KEY}',
               'Content-Type': 'application/json'}
    buffer = ''
    with requests.post(_llm_url(), json=body, headers=headers, stream=True,
                       timeout=(10, settings.ASSISTANT_LLM_TIMEOUT)) as resp:
        resp.raise_for_status()
        for raw in resp.iter_lines(decode_unicode=True):
            if not raw or not raw.startswith('data:'):
                continue
            chunk_text = raw[5:].strip()
            if chunk_text == '[DONE]':
                break
            try:
                chunk = json.loads(chunk_text)
            except (ValueError, TypeError):
                continue
            choices = chunk.get('choices') or []
            if not choices:
                continue
            piece = (choices[0].get('delta') or {}).get('content')
            if piece:
                buffer += piece
                yield _sse({'type': 'delta', 'text': piece})
    if buffer.strip():
        return buffer
    return None


def build_followup(payloads, not_found, scope):
    if not_found and not payloads:
        return None
    if scope == 'named' and payloads:
        unreviewed = [p for p in payloads if not p['reviewed']]
        if unreviewed:
            return {'text': FOLLOWUP_TEXT}
    return None


class EventStreamRenderer(BaseRenderer):
    """允许 Accept: text/event-stream 通过 DRF 内容协商（SSE 专用）。"""
    media_type = 'text/event-stream'
    format = 'text'

    def render(self, data, accepted_media_type=None, renderer_context=None):
        return data


@api_view(['POST'])
@renderer_classes([EventStreamRenderer, JSONRenderer])
@authentication_classes([ExpiringTokenAuthentication])
@permission_classes([IsAuthenticated])
def assistant_chat(request):
    message = str(request.data.get('message') or '').strip()
    if not message:
        return Response({'error': '消息不能为空'}, status=400)
    history = request.data.get('history') if isinstance(request.data.get('history'), list) else []
    last_file = str(request.data.get('lastFileName') or '') or None

    def stream():
        try:
            yield _sse({'type': 'status', 'text': '正在检索结果中心记录…'})
            payloads, cards, scope_note, not_found = retrieve(message, last_file, request.user)
            scope = 'named' if (not_found or any(
                p['fileName'] and p['fileName'] in [m.group().strip() for m in FILE_RE.finditer(message)]
                for p in payloads) or last_file) else 'recent'
            yield _sse({'type': 'evidence', 'cards': cards, 'scopeNote': scope_note,
                        'notFound': not_found})
            text, source, emitted = None, 'template', False
            if settings.ASSISTANT_LLM_ENABLED and settings.ASSISTANT_LLM_API_KEY:
                try:
                    stream_gen = _llm_stream(message, history, payloads)
                    iterator = iter(stream_gen)
                    while True:
                        try:
                            event = next(iterator)
                        except StopIteration as stop:
                            text = stop.value
                            break
                        emitted = True
                        yield event
                    source = 'llm'
                except Exception:
                    logger.exception('PPD 助手大模型调用失败，降级模板回答')
                    text = None
                    source = 'template'
                    if emitted:
                        # 已流出部分内容：不再整段重发模板，避免重复
                        yield _sse({'type': 'done', 'source': 'template'})
                        return
            if not text:
                text = template_answer(message, payloads, scope_note, not_found,
                                       last_file=last_file, history=history)
                yield _sse({'type': 'delta', 'text': text})
            followup = build_followup(payloads, not_found, scope)
            if followup:
                yield _sse({'type': 'followup', **followup})
            yield _sse({'type': 'done', 'source': source})
        except Exception:
            logger.exception('PPD 助手处理失败')
            yield _sse({'type': 'error', 'text': UNAVAILABLE_TEXT})

    from django.http import StreamingHttpResponse
    response = StreamingHttpResponse(stream(), content_type='text/event-stream; charset=utf-8')
    response['Cache-Control'] = 'no-cache'
    response['X-Accel-Buffering'] = 'no'
    return response
