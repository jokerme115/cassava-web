from django.db import migrations, models


class Migration(migrations.Migration):
    dependencies = [
        ('predict', '0031_predictioncorrection_and_masks'),
    ]

    operations = [
        migrations.AlterField(
            model_name='predictioncorrection',
            name='id',
            field=models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name='ID'),
        ),
    ]
