from django.db import migrations, models


class Migration(migrations.Migration):
    dependencies = [
        ('predict', '0033_predictionresult_confidence_map_key'),
    ]

    operations = [
        migrations.AddField(
            model_name='processingtask',
            name='parameters',
            field=models.JSONField(blank=True, default=dict, verbose_name='任务完整参数'),
        ),
        migrations.AlterField(
            model_name='processingtask',
            name='status',
            field=models.CharField(
                choices=[
                    ('pending', '等待中'),
                    ('running', '运行中'),
                    ('completed', '已完成'),
                    ('failed', '失败'),
                    ('cancelled', '已取消'),
                ],
                default='pending',
                max_length=50,
                verbose_name='任务状态',
            ),
        ),
    ]
