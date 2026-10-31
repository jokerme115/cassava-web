from django.db import migrations, models


class Migration(migrations.Migration):
    dependencies = [('predict', '0042_import_task_purge')]
    operations = [migrations.AddField(
        model_name='loginsession', name='expires_at',
        field=models.DateTimeField(null=True, blank=True, verbose_name='记住登录到期时间'),
    )]
