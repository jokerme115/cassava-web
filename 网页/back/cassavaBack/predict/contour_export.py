"""Reference-style PPD figures rendered from the exact selected saved masks."""
import math
from io import BytesIO
from pathlib import Path
import cv2
import numpy as np
from PIL import Image, ImageOps, ImageDraw, ImageFont, ImageColor
from .storage_utils import read_storage_bytes
from .measurement import measurement_masks, segment_measurements, saved_rotation

DEFAULT_STYLE = {
    'cassava_color': '#34d9cf', 'rotten_color': '#ff5b7f',
    'cassava_line_width': 2, 'rotten_line_width': 2,
    'cassava_fill': False, 'rotten_fill': False,
    'cassava_opacity': 0.2, 'rotten_opacity': 0.35,
    'font_size': 36, 'show_ppd': True, 'show_filename': False,
    'columns': 3, 'padding': 20, 'panel_width': 600, 'collage': False,
    'stages': ['prediction'], 'stage_layout': 'rows',
}


def export_style(raw=None):
    if raw is None:
        raw = {}
    if not isinstance(raw, dict):
        raise ValueError('无效导出模板')
    result = dict(DEFAULT_STYLE)
    for key, value in raw.items():
        if key not in result:
            raise ValueError(f'未知导出设置：{key}')
        if key == 'stages':
            if not isinstance(value, list) or not value or any(stage not in ('original', 'yolo', 'prediction') for stage in value) or len(set(value)) != len(value):
                raise ValueError('至少选择一种内容，且不能重复')
        elif key == 'stage_layout':
            if value not in ('rows', 'columns'):
                raise ValueError('无效内容排列')
        elif key.endswith('_color'):
            try:
                ImageColor.getrgb(value)
            except (TypeError, ValueError) as exc:
                raise ValueError('无效颜色') from exc
        elif key in ('cassava_fill', 'rotten_fill', 'show_ppd', 'show_filename', 'collage'):
            if not isinstance(value, bool):
                raise ValueError(f'{key}必须为布尔值')
        elif key.endswith('_opacity'):
            if not isinstance(value, (int, float)) or not 0 <= value <= 1:
                raise ValueError('透明度必须在0到1之间')
        else:
            bounds = {'cassava_line_width': (0, 20), 'rotten_line_width': (0, 20), 'font_size': (12, 96),
                      'columns': (1, 8), 'padding': (0, 120), 'panel_width': (128, 2048)}
            lo, hi = bounds[key]
            if not isinstance(value, int) or not lo <= value <= hi:
                raise ValueError(f'{key}必须为{lo}到{hi}的整数')
        result[key] = value
    return result


def font(size):
    for filename in [Path('C:/Windows/Fonts/arialbd.ttf'), Path('/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf')]:
        if filename.is_file():
            return ImageFont.truetype(str(filename), size)
    return ImageFont.load_default(size=size)


def export_rotation(image, correction=None):
    angle = saved_rotation(correction)
    width, height = image.size
    if angle % 180:
        width, height = height, width
    return (angle + (90 if height > width else 0)) % 360


def panels(prediction, correction, style, annotated=True, require_segments=False):
    if not prediction.original_image:
        raise ValueError('缺少原图')
    image = ImageOps.exif_transpose(Image.open(BytesIO(read_storage_bytes(prediction.original_image.oss_key)))).convert('RGB')
    angle = export_rotation(image, correction)
    cassava, rotten, cp, rp, ppd = measurement_masks(prediction, correction)
    if image.size != (cassava.shape[1], cassava.shape[0]):
        raise ValueError('原图与掩码尺寸不一致')
    segments = segment_measurements(prediction, cassava, rotten)
    if not segments and require_segments:
        raise ValueError('该结果缺少 YOLO 子图坐标，无法生成子图排版')
    if not segments:
        segments = [{'bbox': [0, 0, image.width, image.height], 'ppd_percent': ppd if cp else None}]
    output = []
    for segment in segments:
        x1, y1, x2, y2 = segment['bbox']
        crop = image.crop((x1, y1, x2, y2)).convert('RGBA')
        masks = {'cassava': cassava[y1:y2, x1:x2], 'rotten': rotten[y1:y2, x1:x2]}
        for layer, mask in masks.items():
            if annotated and style[layer + '_fill']:
                color = ImageColor.getrgb(style[layer + '_color'])
                rgba = np.zeros((*mask.shape, 4), dtype=np.uint8)
                rgba[mask] = [*color, round(255 * style[layer + '_opacity'])]
                crop = Image.alpha_composite(crop, Image.fromarray(rgba))
        width = style['panel_width']
        scale = width / max(crop.width, crop.height)
        resized = crop.resize((max(1, round(crop.width * scale)), max(1, round(crop.height * scale))), Image.Resampling.LANCZOS).convert('RGB')
        panel = Image.new('RGB', (width, width), 'black')
        offset = ((width - resized.width) // 2, (width - resized.height) // 2)
        panel.paste(resized, offset)
        draw = ImageDraw.Draw(panel)
        for layer, mask in masks.items():
            thickness = style[layer + '_line_width']
            if not annotated or not thickness:
                continue
            contours, _ = cv2.findContours(mask.astype(np.uint8), cv2.RETR_TREE, cv2.CHAIN_APPROX_SIMPLE)
            for contour in contours:
                points = [(float(point[0][0]) * scale + offset[0], float(point[0][1]) * scale + offset[1]) for point in contour]
                if len(points) > 1:
                    draw.line(points + [points[0]], fill=style[layer + '_color'], width=thickness, joint='curve')
                elif points:
                    x, y = points[0]; radius = max(1, thickness / 2)
                    draw.ellipse((x-radius, y-radius, x+radius, y+radius), fill=style[layer + '_color'])
        panel = panel.rotate(-angle, expand=False)
        output.append((panel, segment['ppd_percent'], prediction.original_image.name))
    return output


def compose(output, style):
    if not output:
        raise ValueError('没有可成图的切面')
    width, gap = style['panel_width'], style['padding']
    columns = min(style['columns'], len(output)); rows = math.ceil(len(output) / columns)
    footer = (style['font_size'] + 24 if style['show_ppd'] else 0) + (28 if style['show_filename'] else 0)
    size = (columns * width + (columns + 1) * gap, rows * (width + footer) + (rows + 1) * gap)
    if size[0] * size[1] > 64_000_000:
        raise ValueError('拼图超过6400万像素，请减少切面数量或降低导出尺寸')
    canvas = Image.new('RGB', size, 'white'); draw = ImageDraw.Draw(canvas)
    for index, (image, value, name) in enumerate(output):
        x = gap + (index % columns) * (width + gap)
        y = gap + (index // columns) * (width + footer + gap)
        canvas.paste(image, (x, y))
        if style['show_ppd']:
            text = f'PPD = {value:.2f}%' if value is not None else 'PPD = --'
            draw.text((x + width/2, y + width + 10), text, font=font(style['font_size']), fill='#182b3a', anchor='mt')
        if style['show_filename']:
            draw.text((x + width/2, y + width + footer - 24), name, font=font(16), fill='#384b45', anchor='mt')
    buffer = BytesIO(); canvas.save(buffer, format='PNG')
    return buffer.getvalue()


def figure_png(prediction, correction=None, style=None):
    style = export_style(style)
    blocks = []
    for stage in style['stages']:
        if stage == 'original':
            if not prediction.original_image:
                raise ValueError('缺少原图')
            original = ImageOps.exif_transpose(Image.open(BytesIO(read_storage_bytes(prediction.original_image.oss_key)))).convert('RGB')
            original = original.rotate(-export_rotation(original, correction), expand=True)
            blocks.append(ImageOps.contain(original, (style['panel_width'], style['panel_width']), Image.Resampling.LANCZOS))
        else:
            stage_style = {**style, 'show_ppd': style['show_ppd'] and stage == 'prediction'}
            raw = compose(panels(prediction, correction, style, annotated=stage == 'prediction', require_segments=stage == 'yolo'), stage_style)
            blocks.append(Image.open(BytesIO(raw)).convert('RGB'))
    if len(blocks) == 1:
        buffer = BytesIO(); blocks[0].save(buffer, format='PNG'); return buffer.getvalue()
    return compose_blocks(blocks, style['stage_layout'], style['padding'])


def compose_blocks(blocks, layout='rows', gap=20):
    horizontal = layout == 'columns'
    width = sum(b.width for b in blocks) + gap * (len(blocks) + 1) if horizontal else max(b.width for b in blocks) + gap * 2
    height = max(b.height for b in blocks) + gap * 2 if horizontal else sum(b.height for b in blocks) + gap * (len(blocks) + 1)
    if width * height > 64_000_000:
        raise ValueError('组合图超过6400万像素，请减少内容或降低导出尺寸')
    canvas = Image.new('RGB', (width, height), 'white')
    cursor = gap
    for block in blocks:
        x, y = (cursor, (height - block.height) // 2) if horizontal else ((width - block.width) // 2, cursor)
        canvas.paste(block, (x, y))
        cursor += (block.width if horizontal else block.height) + gap
    buffer = BytesIO(); canvas.save(buffer, format='PNG'); return buffer.getvalue()
