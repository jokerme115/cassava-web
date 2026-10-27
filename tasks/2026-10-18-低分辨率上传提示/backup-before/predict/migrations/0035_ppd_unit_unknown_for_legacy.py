from django.db import migrations, models


def mark_legacy_units_unknown(apps, schema_editor):
    PredictionResult = apps.get_model('predict', 'PredictionResult')
    PredictionResult.objects.filter(
        cassava_mask_key__isnull=True,
        rotten_mask_key__isnull=True,
    ).update(ppd_unit='unknown')


class Migration(migrations.Migration):
    dependencies = [
        ('predict', '0034_processingtask_parameters_and_pending'),
    ]

    operations = [
        migrations.AlterField(
            model_name='predictionresult',
            name='ppd_unit',
            field=models.CharField(default='unknown', max_length=20, verbose_name='PPD单位'),
        ),
        migrations.RunPython(mark_legacy_units_unknown, migrations.RunPython.noop),
    ]
