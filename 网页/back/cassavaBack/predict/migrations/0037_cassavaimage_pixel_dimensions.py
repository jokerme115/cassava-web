from django.db import migrations, models


class Migration(migrations.Migration):
    dependencies = [('predict', '0036_predictionresult_ensemble_details')]
    operations = [
        migrations.AddField(model_name='cassavaimage', name='pixel_width',
            field=models.PositiveIntegerField(null=True, blank=True, verbose_name='原图像素宽度')),
        migrations.AddField(model_name='cassavaimage', name='pixel_height',
            field=models.PositiveIntegerField(null=True, blank=True, verbose_name='原图像素高度')),
    ]
