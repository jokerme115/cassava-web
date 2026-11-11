import hashlib
import json
import re
from rest_framework.exceptions import ValidationError


def preferences_etag(value):
    return hashlib.sha256(json.dumps(value, sort_keys=True, separators=(',', ':'), ensure_ascii=False).encode()).hexdigest()


def validate_preferences(value):
    if not isinstance(value, dict):
        raise ValidationError('偏好设置必须为对象')
    choices = {'language': ['zh', 'en'], 'editorTheme': ['light', 'dark'], 'listView': ['grid', 'list'],
               'listSort': ['date', 'name', 'size', 'capture_time', 'folder'], 'listOrder': ['asc', 'desc'],
               'listGroup': ['none', 'year', 'month', 'day'], 'listPageSize': [24, 48, 96, 120], 'importMode': ['new', 'existing']}
    ranges = {'brushSize': (1, 120), 'vertexSize': (1, 4), 'cassavaOpacity': (0, 1), 'rottenOpacity': (0, 1)}
    booleans = {'preserveHierarchy', 'editorResetZoom', 'editorDimOutside', 'editorShowCassava', 'editorShowRotten', 'autoAdvanceReview'}
    strings = {'defaultExportTemplate', 'defaultPredictionPreset', 'taskNamePrefix'}
    allowed = set(choices) | set(ranges) | booleans | strings | {'exportTemplates', 'predictionPresets'}
    if set(value) - allowed:
        raise ValidationError('包含不支持的偏好设置')
    for key, options in choices.items():
        if key in value and (isinstance(value[key], bool) or value[key] not in options):
            raise ValidationError(f'{key} 无效')
    for key, (low, high) in ranges.items():
        number(value.get(key), low, high, key, optional=True)
    for key in booleans:
        if key in value and not isinstance(value[key], bool):
            raise ValidationError(f'{key} 必须是布尔值')
    for key in strings:
        if key in value and (not isinstance(value[key], str) or len(value[key]) > (40 if key == 'taskNamePrefix' else 100)):
            raise ValidationError(f'{key} 无效')
    for key in ['exportTemplates', 'predictionPresets']:
        if key not in value:
            continue
        items = value[key]
        if not isinstance(items, list) or len(items) > 50:
            raise ValidationError('每类最多保存 50 个预设')
        names = set()
        ids = set()
        for item in items:
            if not isinstance(item, dict) or not isinstance(item.get('name'), str) or not item['name'].strip() or len(item['name']) > 100:
                raise ValidationError('预设名称无效')
            if item['name'] in names:
                raise ValidationError('预设名称不能重复')
            names.add(item['name'])
            number(item.get('version'), 1, 1000000, '预设版本')
            if key == 'exportTemplates':
                validate_style(item.get('style'))
            else:
                if not isinstance(item.get('id'), str) or not item['id'] or len(item['id']) > 100 or item['id'] in ids:
                    raise ValidationError('预测预设编号无效或重复')
                ids.add(item['id'])
                if item.get('mode') not in ['single', 'ensemble'] or not isinstance(item.get('model'), str) or len(item['model']) > 100:
                    raise ValidationError('模型配置无效')
                validate_parameters(item.get('parameters', {}))
    return value


def number(value, low, high, name, optional=False):
    if value is None and optional:
        return
    if isinstance(value, bool) or not isinstance(value, (int, float)) or not low <= value <= high:
        raise ValidationError(f'{name} 必须在 {low}–{high} 之间')


def validate_style(style):
    if not isinstance(style, dict):
        raise ValidationError('导出样式无效')
    limits = {'cassava_line_width': (0, 20), 'rotten_line_width': (0, 20), 'cassava_opacity': (0, 1), 'rotten_opacity': (0, 1),
              'font_size': (12, 96), 'columns': (1, 8), 'padding': (0, 120), 'panel_width': (128, 2048)}
    bools = {'cassava_fill', 'rotten_fill', 'show_ppd', 'show_filename', 'collage'}
    if set(style) - set(limits) - bools - {'cassava_color', 'rotten_color', 'stages', 'stage_layout'}:
        raise ValidationError('包含未知样式字段')
    from .contour_export import export_style
    try:
        export_style({key: style[key] for key in ('stages', 'stage_layout') if key in style})
    except (ValueError, TypeError) as exc:
        raise ValidationError(str(exc)) from exc
    for key, (low, high) in limits.items():
        number(style.get(key), low, high, key)
    for key in bools:
        if not isinstance(style.get(key), bool):
            raise ValidationError(f'{key} 必须是布尔值')
    for key in ['cassava_color', 'rotten_color']:
        if not re.fullmatch(r'#[0-9a-fA-F]{6}', str(style.get(key, ''))):
            raise ValidationError('颜色格式应为 #RRGGBB')


def validate_parameters(parameters):
    if not isinstance(parameters, dict):
        raise ValidationError('预测参数无效')
    limits = {'confidenceThreshold': (0, 1), 'minArea': (0, 1000000), 'morphKernelSize': (1, 31), 'morphIterations': (0, 10),
              'overlayOpacity': (0, 1), 'stage1Confidence': (0, 1), 'stage2Confidence': (0, 1), 'roiPadding': (0, 2),
              'fallbackRoiPadding': (0, 2), 'expectedCount': (0, 100), 'stageBoxIou': (0, 1)}
    for key, value in parameters.items():
        if key in limits:
            number(value, *limits[key], key)
        elif key in ['usePostProcessing', 'useTTA']:
            if not isinstance(value, bool):
                raise ValidationError('预测开关必须是布尔值')
        elif key in ['patchSize', 'stride']:
            if not isinstance(value, list) or len(value) != 2:
                raise ValidationError('分块参数必须为两个数')
            for part in value:
                number(part, 1, 4096, key)
        else:
            raise ValidationError(f'不支持的预测参数：{key}')
