from django.db import migrations, models


class Migration(migrations.Migration):
    dependencies = [
        ('predict', '0032_alter_predictioncorrection_id'),
    ]

    operations = [
        migrations.AddField(
            model_name='predictionresult',
            name='confidence_map_key',
            field=models.CharField(blank=True, max_length=255, null=True, verbose_name='腐烂置信度图路径'),
        ),
    ]
