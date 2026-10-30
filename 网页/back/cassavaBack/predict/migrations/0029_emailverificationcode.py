from django.db import migrations, models


class Migration(migrations.Migration):
    dependencies = [
        ('predict', '0028_systemsetting_allow_registration_and_more'),
    ]

    operations = [
        migrations.CreateModel(
            name='EmailVerificationCode',
            fields=[
                ('id', models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name='ID')),
                ('email', models.EmailField(db_index=True, max_length=254, verbose_name='邮箱')),
                ('code', models.CharField(max_length=20, verbose_name='验证码')),
                ('purpose', models.CharField(choices=[('register', '注册'), ('login', '登录'), ('reset', '重置密码')], default='register', max_length=20, verbose_name='用途')),
                ('created_at', models.DateTimeField(auto_now_add=True, verbose_name='创建时间')),
                ('expires_at', models.DateTimeField(verbose_name='过期时间')),
                ('used_at', models.DateTimeField(blank=True, null=True, verbose_name='使用时间')),
                ('ip_address', models.GenericIPAddressField(blank=True, null=True, verbose_name='IP地址')),
            ],
            options={
                'verbose_name': '邮箱验证码',
                'verbose_name_plural': '邮箱验证码',
            },
        ),
        migrations.AddIndex(
            model_name='emailverificationcode',
            index=models.Index(fields=['email', 'purpose', 'created_at'], name='predict_ema_email_4f96bb_idx'),
        ),
    ]
