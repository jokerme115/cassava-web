# -*- coding: utf-8 -*-
"""PPD 领域知识库（轻量关键词检索）。

条目来源与出处见 KNOWLEDGE_BASE 注释；检索只做关键词打分，不联网。
数字口径一律以结果中心实时记录为准，本模块只回答领域性问题。
"""
from __future__ import annotations

import io
import json
import os
import re

# 五类：机理 / 表型与阈值 / 易混淆情形 / 影响因素 / 测量边界
# 条目存 predict/ppd_knowledge.json（由素材整理脚本生成，含出处与关键词）；
# 素材未覆盖的条目答案里带【素材未覆盖，需用户确认】标记，回答时如实转述。
_KB_FILE = os.path.join(os.path.dirname(__file__), 'ppd_knowledge.json')


def _load():
    try:
        with io.open(_KB_FILE, encoding='utf-8') as f:
            data = json.load(f)
        return data if isinstance(data, list) else []
    except Exception:
        return []


KNOWLEDGE_BASE = _load()


def _tokenize(text):
    return set(re.findall(r'[a-z0-9]+|[\u4e00-\u9fff]', (text or '').lower()))


GENERIC_KEYWORDS = {'ppd', 'ppd助手', '复核', '记录', '结果'}


def search_knowledge(message, top_n=3):
    """按关键词重叠打分返回 top_n 条命中的知识条目（每条含 id/section/question/answer/source）。"""
    if not KNOWLEDGE_BASE or not message:
        return []
    msg_chars = _tokenize(message)
    msg_lower = message.lower()
    scored = []
    for entry in KNOWLEDGE_BASE:
        kws = entry.get('keywords') or []
        # 裸 "PPD" 等泛词不计分：几乎所有消息都含它，会造成纯记录查询误命中
        hit = sum(1 for k in kws if k and k.lower() not in GENERIC_KEYWORDS
                  and k.lower() in msg_lower)
        if not hit:
            continue
        # 问题正文与消息的字符重叠作为次级信号
        overlap = len(msg_chars & _tokenize(entry.get('question', '')))
        scored.append((hit * 10 + min(overlap, 10), entry))
    scored.sort(key=lambda x: -x[0])
    return [dict(id=e['id'], section=e['section'], question=e['question'],
                 answer=e['answer'], source=e['source'])
            for _, e in scored[:top_n]]


def format_injection(items):
    """注入系统提示词的 <领域知识> 块（JSON）。"""
    import json
    return json.dumps({
        '说明': '以下为平台内置领域知识库条目，回答领域性问题时可引用，需注明出处',
        '领域知识': items,
    }, ensure_ascii=False)
