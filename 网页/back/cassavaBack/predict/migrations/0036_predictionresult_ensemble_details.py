from django.db import migrations, models


class Migration(migrations.Migration):
    dependencies = [('predict', '0035_ppd_unit_unknown_for_legacy')]
    operations = [migrations.AddField(
        model_name='predictionresult', name='ensemble_details',
        field=models.JSONField(default=dict, blank=True, verbose_name='多模型投票明细'),
    )]
