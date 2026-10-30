from django.db import migrations


def purge_legacy_tokens(apps, schema_editor):
    """清理历史 DRF Token 行。

    登录令牌已改为 predict.LoginSession（支持手机与电脑同时在线），
    authtoken_token 表里的旧行不再被任何认证逻辑读取，属于残留凭据，直接删除。
    副作用：升级后所有在线端需要重新登录；令牌本身 30 分钟无操作即过期，影响很小。
    """
    LegacyToken = apps.get_model('authtoken', 'Token')
    deleted, _ = LegacyToken.objects.all().delete()
    if deleted:
        print(f'  已清理 {deleted} 条历史 authtoken 记录')


class Migration(migrations.Migration):

    dependencies = [
        ('predict', '0038_loginsession'),
        ('authtoken', '0003_tokenproxy'),
    ]

    operations = [
        migrations.RunPython(purge_legacy_tokens, migrations.RunPython.noop),
    ]
