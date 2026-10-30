from django.db import migrations, models
import django.db.models.deletion


class Migration(migrations.Migration):
    dependencies = [
        ('predict', '0030_rename_predict_ema_email_4f96bb_idx_predict_ema_email_3869e4_idx'),
    ]

    operations = [
        migrations.AddField(
            model_name='predictionresult',
            name='cassava_mask_key',
            field=models.CharField(blank=True, max_length=255, null=True, verbose_name='木薯主体掩码路径'),
        ),
        migrations.AddField(
            model_name='predictionresult',
            name='ppd_unit',
            field=models.CharField(default='percent', max_length=20, verbose_name='PPD单位'),
        ),
        migrations.AddField(
            model_name='predictionresult',
            name='rotten_mask_key',
            field=models.CharField(blank=True, max_length=255, null=True, verbose_name='腐烂区域掩码路径'),
        ),
        migrations.CreateModel(
            name='PredictionCorrection',
            fields=[
                ('id', models.AutoField(auto_created=True, primary_key=True, serialize=False, verbose_name='ID')),
                ('created_at', models.DateTimeField(auto_now_add=True, verbose_name='创建时间')),
                ('updated_at', models.DateTimeField(auto_now=True, verbose_name='更新时间')),
                ('version', models.PositiveIntegerField(verbose_name='校正版本')),
                ('cassava_mask_key', models.CharField(max_length=255, verbose_name='木薯主体掩码路径')),
                ('rotten_mask_key', models.CharField(max_length=255, verbose_name='腐烂区域掩码路径')),
                ('width', models.PositiveIntegerField(verbose_name='掩码宽度')),
                ('height', models.PositiveIntegerField(verbose_name='掩码高度')),
                ('cassava_pixels', models.PositiveIntegerField(default=0, verbose_name='木薯像素面积')),
                ('rotten_pixels', models.PositiveIntegerField(default=0, verbose_name='腐烂像素面积')),
                ('ppd_percent', models.FloatField(default=0, verbose_name='校正后PPD百分比')),
                ('edit_data', models.JSONField(blank=True, default=dict, verbose_name='编辑操作数据')),
                ('note', models.TextField(blank=True, verbose_name='校正备注')),
                ('owner', models.ForeignKey(blank=True, null=True, on_delete=django.db.models.deletion.CASCADE, related_name='%(class)s_owned', to='auth.user', verbose_name='所有者')),
                ('prediction', models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, related_name='corrections', to='predict.predictionresult', verbose_name='原始预测结果')),
            ],
            options={
                'verbose_name': '预测人工校正版本',
                'verbose_name_plural': '预测人工校正版本',
                'ordering': ['-version'],
            },
        ),
        migrations.AddConstraint(
            model_name='predictioncorrection',
            constraint=models.UniqueConstraint(fields=('prediction', 'version'), name='unique_prediction_correction_version'),
        ),
    ]
