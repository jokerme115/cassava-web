"""Permission-scoped CSV/XLSX and portable measurement packages; no extra runtime dependencies."""
import csv
import json
import tempfile
from io import BytesIO, StringIO
from pathlib import PurePosixPath
from xml.sax.saxutils import escape
from zipfile import ZipFile, ZIP_DEFLATED

from django.http import FileResponse
from django.utils import timezone

from .model_registry import LABELS
from .measurement import latest_correction, measurement_info, measurement_masks, overlay_png, segment_measurements
from .storage_utils import read_storage_bytes


HEADERS = ['结果ID', '任务ID', '图片ID', '图片名称', '文件夹', '模型', '模型PPD(%)', '最终PPD(%)',
           '单位', '结果来源', '校正版本', '复核状态', '木薯面积(px)', '病变面积(px)', '预测时间',
           '校正者', '校正时间', '校正备注', '预测参数', '数据状态', '有监督模型 PPD(%)', '半监督模型 PPD(%)', '模型一致率(非准确率%)', '投票明细']
SEGMENT_HEADERS = ['结果ID', '切面', '校正版本', '木薯面积(px)', '病变面积(px)', 'PPD(%)', '原图坐标']


def safe_cell(value):
    value = '' if value is None else str(value)
    return "'" + value if value.lstrip().startswith(('=', '+', '-', '@')) else value


def csv_bytes(rows):
    stream = StringIO(newline='')
    writer = csv.writer(stream)
    writer.writerows([[safe_cell(cell) for cell in row] for row in rows])
    return ('\ufeff' + stream.getvalue()).encode('utf-8')


def xlsx_bytes(sheets):
    """Inline strings avoid formulas and preserve Chinese; numeric fields stay numeric."""
    stream = BytesIO()
    with ZipFile(stream, 'w', ZIP_DEFLATED) as archive:
        types = ['<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>',
                 '<Default Extension="xml" ContentType="application/xml"/>',
                 '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>']
        for i in range(1, len(sheets) + 1):
            types.append(f'<Override PartName="/xl/worksheets/sheet{i}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>')
        archive.writestr('[Content_Types].xml', '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' + ''.join(types) + '</Types>')
        archive.writestr('_rels/.rels', '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>')
        names, rels = [], []
        for i, (name, rows) in enumerate(sheets, 1):
            names.append(f'<sheet name="{escape(name)}" sheetId="{i}" r:id="rId{i}"/>')
            rels.append(f'<Relationship Id="rId{i}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet{i}.xml"/>')
            body = []
            for index, row in enumerate(rows, 1):
                cells = []
                for value in row:
                    if isinstance(value, (int, float)):
                        cells.append(f'<c><v>{value}</v></c>')
                    else:
                        text = ''.join(c for c in str(value if value is not None else '') if ord(c) >= 32 or c in '\n\r\t')
                        cells.append(f'<c t="inlineStr"><is><t xml:space="preserve">{escape(text)}</t></is></c>')
                body.append(f'<row r="{index}">' + ''.join(cells) + '</row>')
            archive.writestr(f'xl/worksheets/sheet{i}.xml', '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" state="frozen"/></sheetView></sheetViews><sheetData>' + ''.join(body) + '</sheetData></worksheet>')
        archive.writestr('xl/workbook.xml', '<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>' + ''.join(names) + '</sheets></workbook>')
        archive.writestr('xl/_rels/workbook.xml.rels', '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' + ''.join(rels) + '</Relationships>')
    return stream.getvalue()


def export_response(queryset, file_type, style=None, version='latest'):
    from .contour_export import export_style, figure_png, panels, compose
    from .measurement import selected_correction
    from django.db import transaction
    style = export_style(style)
    # Corrections are append-only. Materialize every version before streaming any artifact.
    with transaction.atomic():
        snapshots = [(prediction, selected_correction(prediction, version)) for prediction in queryset]
    collage_panels = []
    rows, segment_rows, manifest = [HEADERS], [SEGMENT_HEADERS], []
    package = tempfile.SpooledTemporaryFile(max_size=16 * 1024 * 1024, mode='w+b') if file_type == 'zip' else None
    archive = ZipFile(package, 'w', ZIP_DEFLATED) if package else None
    try:
        for prediction, correction in snapshots:
            info = measurement_info(prediction, correction)
            item = {'result_id': prediction.id, **info, 'files': {}, 'errors': []}
            pixels, segments = (None, None), []
            try:
                cassava, rotten, cp, rp, _ = measurement_masks(prediction, correction)
                pixels = cp, rp
                segments = segment_measurements(prediction, cassava, rotten)
            except (OSError, ValueError, TypeError) as exc:
                item['errors'].append(f'掩码或切面信息不可用: {exc}')
            task = prediction.processing_task
            params = task.parameters if task else {}
            model_ppd = prediction.ppd_value * (100 if prediction.ppd_unit == 'ratio' else 1) if prediction.ppd_unit in ('ratio', 'percent') else None
            rows.append([prediction.id, prediction.processing_task_id, prediction.original_image_id,
                         prediction.original_image.name if prediction.original_image else '',
                         prediction.original_image.folder.name if prediction.original_image and prediction.original_image.folder else '',
                         LABELS.get(prediction.single_model_type, prediction.single_model_type), model_ppd, info['final_ppd'], '%', info['measurement_source'],
                         info['correction_version'], info['review_status'], *pixels, prediction.prediction_time.isoformat(),
                         info['corrected_by'], info['corrected_at'], info['correction_note'],
                         json.dumps(params, ensure_ascii=False), info['measurement_status'],
                         *[next((m.get('ppd_percent') for m in (prediction.ensemble_details or {}).get('members', []) if m.get('model') == name), None) for name in ('resnet101', 'm6_best')],
                         (prediction.ensemble_details or {}).get('agreement_percent'),
                         json.dumps(prediction.ensemble_details or {}, ensure_ascii=False)])
            for segment in segments:
                segment_rows.append([prediction.id, segment['segment'], info['correction_version'],
                                     segment['cassava_pixels'], segment['rotten_pixels'], segment['ppd_percent'],
                                     json.dumps(segment['bbox'])])
            item['segments'] = segments
            item['parameters'] = params
            item['model'] = prediction.single_model_type
            item['ensemble_details'] = prediction.ensemble_details or {}
            item['model_ppd'] = model_ppd
            if archive:
                prefix = f'results/{prediction.id}'
                source = correction or prediction
                files = {'model_cassava_mask.png': prediction.cassava_mask_key,
                         'model_rotten_mask.png': prediction.rotten_mask_key,
                         'final_cassava_mask.png': source.cassava_mask_key,
                         'final_rotten_mask.png': source.rotten_mask_key}
                for key in ('disagreement', 'member_resnet101', 'member_m6_best'):
                    if (prediction.vis_images or {}).get(key):
                        files[key + '.png'] = prediction.vis_images[key]
                if prediction.original_image and prediction.original_image.oss_key:
                    ext = PurePosixPath(prediction.original_image.oss_key).suffix or '.bin'
                    files['original' + ext] = prediction.original_image.oss_key
                for name, key in files.items():
                    try:
                        archive.writestr(f'{prefix}/{name}', read_storage_bytes(key))
                        item['files'][name] = f'{prefix}/{name}'
                    except (OSError, ValueError, TypeError) as exc:
                        item['errors'].append(f'{name}: {exc}')
                try:
                    archive.writestr(f'{prefix}/final_overlay.png', overlay_png(prediction, correction))
                    item['files']['final_overlay.png'] = f'{prefix}/final_overlay.png'
                    archive.writestr(f'{prefix}/PPD_contours.png', figure_png(prediction, correction, style))
                    item['files']['PPD_contours.png'] = f'{prefix}/PPD_contours.png'
                    if style['collage']:
                        collage_panels.extend(panels(prediction, correction, style))
                except (OSError, ValueError, TypeError) as exc:
                    item['errors'].append(f'final_overlay.png: {exc}')
            manifest.append(item)
        if len(rows) == 1:
            raise ValueError('没有符合条件的可导出结果')
        sheets = [('结果总表', rows), ('切面明细', segment_rows)]
        if archive:
            if collage_panels:
                archive.writestr('PPD_collage.png', compose(collage_panels, style))
            archive.writestr('results.csv', csv_bytes(rows))
            archive.writestr('segments.csv', csv_bytes(segment_rows))
            archive.writestr('results.xlsx', xlsx_bytes(sheets))
            archive.writestr('manifest.json', json.dumps({'schema_version': 1, 'count': len(manifest),
                'generated_at': timezone.now().isoformat(), 'style': style, 'version_selection': version, 'results': manifest}, ensure_ascii=False, indent=2))
            archive.writestr('说明.txt', 'PPD=木薯范围内病变像素/木薯像素×100%。总值使用原图掩码计算，不对重叠切面重复计数。\n每条结果的模型、修订版本和复检状态见manifest.json及数值表。历史任务参数可能不代表实际执行模型，以结果模型字段为准。\n历史切面坐标缺失时不生成推测值；资源缺失会记录在manifest.json的errors中。\n')
            archive.close()
            archive = None
            package.seek(0)
            payload = package
            mime = 'application/zip'
        else:
            payload = BytesIO(xlsx_bytes(sheets) if file_type == 'xlsx' else csv_bytes(rows))
            mime = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' if file_type == 'xlsx' else 'text/csv; charset=utf-8'
        response = FileResponse(payload, as_attachment=True,
                                filename=f'cassava_results_{timezone.now():%Y%m%d_%H%M%S}.{file_type}', content_type=mime)
        response['X-Export-Count'] = str(len(rows) - 1)
        response['X-Export-Warnings'] = str(sum(bool(item['errors']) for item in manifest))
        return response
    except Exception:
        if archive:
            archive.close()
        if package:
            package.close()
        raise
