from django.db import migrations, models


class Migration(migrations.Migration):
    dependencies = [('predict', '0043_login_session_expiry')]
    operations = [migrations.AddField(model_name='userprofile', name='preferences', field=models.JSONField(default=dict, blank=True, verbose_name='工作区偏好'))]
