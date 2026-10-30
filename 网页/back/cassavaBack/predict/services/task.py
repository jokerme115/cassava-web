"""TaskService —— 批次6 从 services.py 拆出。"""

from ..deeplab_service import describe_prediction_failure
from ..deeplab_service import prediction_provenance
from .base import BaseService
from .prediction import PredictionService
from django.utils import timezone

import logging

logger = logging.getLogger(__name__)

class TaskService(BaseService):
    """
    任务服务类，处理后台任务相关的业务逻辑
    """
    
    @staticmethod
    def create_task(user, task_name, task_type, extra_params=None):
        """
        创建新任务
        
        Args:
            user: 用户对象
            task_name: 任务名称
            task_type: 任务类型
            extra_params: 额外参数
            
        Returns:
            ProcessingTask对象
        """
        from datetime import datetime
        
        ProcessingTask = TaskService.get_model('ProcessingTask')
        
        task = ProcessingTask.objects.create(
            name=f"{task_name}_{datetime.now().strftime('%Y%m%d%H%M%S')}",
            type=task_type,
            status="pending" if task_type == "prediction" else "running",
            progress=0,
            owner=user if user and user.is_authenticated else None,
            **(extra_params or {})
        )
        
        return task
    
    @staticmethod
    def update_task_status(task_id, status, progress=None, error=None):
        """
        更新任务状态
        
        Args:
            task_id: 任务ID
            status: 新状态
            progress: 进度百分比
            error: 错误信息
            
        Returns:
            bool: 是否更新成功
        """
        ProcessingTask = TaskService.get_model('ProcessingTask')
        try:
            task = ProcessingTask.objects.get(id=task_id)
            task.status = status
            if progress is not None:
                task.progress = progress
            if error:
                task.error = error
            task.save()
            return True
        except ProcessingTask.DoesNotExist:
            return False
    
    @staticmethod
    def get_user_tasks(user, limit=None):
        """
        获取用户的任务列表
        
        Args:
            user: 用户对象
            limit: 返回数量限制
            
        Returns:
            ProcessingTask查询集
        """
        ProcessingTask = TaskService.get_model('ProcessingTask')
        queryset = ProcessingTask.objects.filter(owner_id=user.id).order_by('-created_time')
        if limit:
            return queryset[:limit]
        return queryset
    
    @staticmethod
    def get_tasks():
        ProcessingTask = TaskService.get_model('ProcessingTask')
        return ProcessingTask.objects.all().order_by('-created_time')
    
    @staticmethod
    def cancel_task(task):
        if task.status in {'pending', 'running'}:
            if task.type == 'upload':
                from ..models import ImportJob
                ImportJob.objects.filter(task=task, state__in=['uploading', 'queued', 'running']).update(state='cancelled')
            task.status = 'cancelled'
            task.save()
            return {'success': True}
        return {'success': False, 'message': '任务当前状态不可取消'}
    
    @staticmethod
    def delete_task(task):
        task.delete()

    @staticmethod
    def execute_prediction_task(task_id, params=None):
        """
        执行预测任务（后台运行）
        """
        from django.db import close_old_connections, transaction
        
        ProcessingTask = TaskService.get_model('ProcessingTask')
        CassavaImage = TaskService.get_model('CassavaImage')
        
        close_old_connections()

        try:
            with transaction.atomic():
                claimed = ProcessingTask.objects.filter(
                    id=task_id,
                    status='pending',
                ).update(status='running', progress=0, error=None)
                task = ProcessingTask.objects.get(id=task_id)
                if not claimed:
                    if task.status == 'cancelled':
                        return {"cancelled": True}
                    return {"skipped": True, "status": task.status}
        except ProcessingTask.DoesNotExist:
            return {"error": "任务不存在"}
            
        try:
            task.refresh_from_db(fields=['status'])
            if task.status == 'cancelled':
                return {"cancelled": True}

            params = {
                'single_model_type': task.single_model_type or 'resnet101',
                'confidence': task.threshold if task.threshold is not None else 0.5,
                'min_area': task.min_size if task.min_size is not None else 100,
                'algorithm': task.algorithm,
                'overlap': task.overlap if task.overlap is not None else 0.2,
                **dict(params or task.parameters or {}),
            }
            
            resolved = PredictionService._parse_prediction_params(params)
            task.parameters = {**(task.parameters or {}), '_execution': {
                'protocol': 'cassava-web-20261018', 'model': resolved['single_model_type'],
                'parameters': resolved, 'weights': prediction_provenance(resolved['single_model_type']),
                'started_at': timezone.now().isoformat(),
            }}
            task.save(update_fields=['parameters', 'updated_time'])

            image_ids = []
            if task.image_ids:
                image_ids = list(task.image_ids)
            elif task.folder_ids:
                image_ids = list(
                    CassavaImage.objects.filter(folder_id__in=task.folder_ids).values_list('id', flat=True)
                )

            if not image_ids:
                task.status = 'failed'
                task.error = "没有待处理的图片"
                task.save()
                return {"error": "没有待处理的图片"}

            def stop_check():
                task.refresh_from_db(fields=['status'])
                return task.status == 'cancelled'

            def progress_callback(processed_count, total_count):
                progress = int((processed_count / total_count) * 100) if total_count else 0
                task.progress = progress
                task.save(update_fields=['progress', 'updated_time'])

            execution = PredictionService.run_predictions_for_images(
                image_ids=image_ids,
                params=params,
                owner=task.owner if getattr(task, 'owner_id', None) else None,
                processing_task=task,
                stop_check=stop_check,
                progress_callback=progress_callback
            )

            if execution.get('cancelled'):
                return {"cancelled": True, "processed": execution.get('processed_count', 0)}

            if not execution.get('results'):
                task.status = 'failed'
                task.error = '; '.join(
                    error.get('message', '预测失败') for error in execution.get('errors', [])[:3]
                ) or '预测失败'
                task.save()
                return {"error": task.error}

            task.status = 'completed'
            task.progress = 100
            # 部分图片失败时仍算完成，但把失败数量和原因写进 error，便于前端提示“部分成功”
            failure_count = len(execution.get('errors', []))
            if failure_count:
                preview = '；'.join(
                    str(error.get('message', '预测失败')) for error in execution.get('errors', [])[:3]
                )
                task.error = f"{failure_count} 张图片未生成结果：{preview}"
            else:
                task.error = None
            task.save()
            return {
                "success": True,
                "processed": execution.get('processed_count', 0),
                "result_count": len(execution.get('results', [])),
                "failed_count": failure_count,
                "errors": execution.get('errors', []),
            }
            
        except Exception as e:
            failure_text = describe_prediction_failure(e)
            try:
                task.status = 'failed'
                task.error = failure_text
                execution_meta = dict((task.parameters or {}).get('_execution') or {})
                execution_meta.update({
                    'error_code': e.__class__.__name__,
                    'error_detail': str(e)[:500],
                    'failed_at': timezone.now().isoformat(),
                })
                task.parameters = {**(task.parameters or {}), '_execution': execution_meta}
                task.save(update_fields=['status', 'error', 'parameters', 'updated_time'])
            except Exception:
                pass
            logger.error(f"任务执行失败: {e}", exc_info=True)
            return {"error": failure_text}
