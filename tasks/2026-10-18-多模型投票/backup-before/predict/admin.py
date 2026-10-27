from django.contrib import admin
from .models import CassavaImage, Folder

# 注册模型以在Django管理界面中可见
admin.site.register(CassavaImage)
admin.site.register(Folder)
