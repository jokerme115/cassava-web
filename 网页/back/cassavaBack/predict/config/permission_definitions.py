# 权限定义配置
# 此文件作为权限配置的"Single Source of Truth"
# 支持版本控制和热更新

CATEGORIES = {
    'image': '图像管理',
    'prediction': '预测结果',
    'task': '任务管理',
    'folder': '文件夹管理',
    'system': '系统管理',
    'security': '安全管理'
}

# 权限定义
# 格式: {codename: {name, category, description}}
PERMISSIONS = {
    # 图像管理
    'view_image': {'name': '查看图像', 'category': CATEGORIES['image'], 'description': '允许查看图像列表和详细信息'},
    'upload_image': {'name': '上传图像', 'category': CATEGORIES['image'], 'description': '允许上传新图像'},
    'delete_image': {'name': '删除图像', 'category': CATEGORIES['image'], 'description': '允许删除图像'},
    'edit_image': {'name': '编辑图像信息', 'category': CATEGORIES['image'], 'description': '允许编辑图像信息'},

    # 文件夹管理
    'view_folder': {'name': '查看文件夹', 'category': CATEGORIES['folder'], 'description': '允许查看文件夹列表和详细信息'},
    'create_folder': {'name': '创建文件夹', 'category': CATEGORIES['folder'], 'description': '允许创建新文件夹'},
    'delete_folder': {'name': '删除文件夹', 'category': CATEGORIES['folder'], 'description': '允许删除文件夹'},
    'edit_folder': {'name': '编辑文件夹', 'category': CATEGORIES['folder'], 'description': '允许编辑文件夹信息'},

    # 分割结果
    'view_segmentation': {'name': '查看分割结果', 'category': CATEGORIES['prediction'], 'description': '允许查看分割结果'},
    'delete_segmentation': {'name': '删除分割结果', 'category': CATEGORIES['prediction'], 'description': '允许删除分割结果'},

    # 任务管理
    'view_task': {'name': '查看任务', 'category': CATEGORIES['task'], 'description': '允许查看任务列表和详细信息'},
    'create_task': {'name': '创建任务', 'category': CATEGORIES['task'], 'description': '允许创建新任务'},
    'cancel_task': {'name': '取消任务', 'category': CATEGORIES['task'], 'description': '允许取消正在运行的任务'},
    'delete_task': {'name': '删除任务', 'category': CATEGORIES['task'], 'description': '允许删除任务'},

    # 预测结果
    'view_prediction': {'name': '查看预测结果', 'category': CATEGORIES['prediction'], 'description': '允许查看预测结果列表和详细信息'},
    'delete_prediction': {'name': '删除预测结果', 'category': CATEGORIES['prediction'], 'description': '允许删除预测结果'},
    'create_prediction': {'name': '创建预测任务', 'category': CATEGORIES['prediction'], 'description': '允许创建新的预测任务'},
    'export_prediction': {'name': '导出预测结果', 'category': CATEGORIES['prediction'], 'description': '允许导出预测结果'},

    # 系统管理
    'manage_user': {'name': '管理系统用户', 'category': CATEGORIES['system'], 'description': '允许管理系统用户'},
    'manage_role': {'name': '管理系统角色', 'category': CATEGORIES['system'], 'description': '允许管理系统角色'},
    'manage_permission': {'name': '管理系统权限', 'category': CATEGORIES['system'], 'description': '允许管理系统权限'},
    
    # 细粒度权限管理
    'add_permission': {'name': '添加权限', 'category': CATEGORIES['system'], 'description': '允许添加新权限'},
    'change_permission': {'name': '修改权限', 'category': CATEGORIES['system'], 'description': '允许修改权限'},
    'delete_permission': {'name': '删除权限', 'category': CATEGORIES['system'], 'description': '允许删除权限'},

    # 细粒度角色管理
    'add_role': {'name': '添加角色', 'category': CATEGORIES['system'], 'description': '允许添加新角色'},
    'change_role': {'name': '修改角色', 'category': CATEGORIES['system'], 'description': '允许修改角色'},
    'delete_role': {'name': '删除角色', 'category': CATEGORIES['system'], 'description': '允许删除角色'},
    'assign_role_permissions': {'name': '分配角色权限', 'category': CATEGORIES['system'], 'description': '允许为角色分配权限'},

    # 细粒度用户管理
    'add_user': {'name': '添加用户', 'category': CATEGORIES['system'], 'description': '允许添加新用户'},
    'change_user': {'name': '修改用户', 'category': CATEGORIES['system'], 'description': '允许修改用户'},
    'delete_user': {'name': '删除用户', 'category': CATEGORIES['system'], 'description': '允许删除用户'},
    'assign_user_roles': {'name': '分配用户角色', 'category': CATEGORIES['system'], 'description': '允许为用户分配角色'},
    
    # 审计日志
    'view_audit_log': {'name': '查看审计日志', 'category': CATEGORIES['system'], 'description': '允许查看审计日志'},
    
    # 视图集权限
    'view_permission': {'name': '查看权限', 'category': CATEGORIES['system'], 'description': '允许查看权限列表和详细信息'},
    'view_role': {'name': '查看角色', 'category': CATEGORIES['system'], 'description': '允许查看角色列表和详细信息'},
    'view_user': {'name': '查看用户', 'category': CATEGORIES['system'], 'description': '允许查看用户列表和详细信息'},
    'view_userrole': {'name': '查看用户角色', 'category': CATEGORIES['system'], 'description': '允许查看用户角色关联列表和详细信息'},
    'view_userpermission': {'name': '查看用户权限', 'category': CATEGORIES['system'], 'description': '允许查看用户权限关联列表和详细信息'},
}

# 默认角色定义
# 格式: {role_name: {permissions: [codenames], description}}
ROLES = {
    '管理员': {
        'permissions': [k for k in PERMISSIONS.keys() if k != 'add_user'],
        'description': '系统管理员，拥有除用户创建外的所有权限'
    },
    '普通用户': {
        'permissions': [
            'view_image', 'upload_image', 'view_folder', 'view_task', 
            'view_prediction', 'view_segmentation'
        ],
        'description': '普通用户，拥有基本查看和上传权限'
    },
    '高级用户': {
        'permissions': [
            'view_image', 'upload_image', 'delete_image', 'edit_image',
            'view_folder', 'create_folder', 'edit_folder',
            'view_task', 'create_task', 'cancel_task',
            'view_prediction', 'view_segmentation'
        ],
        'description': '高级用户，拥有更多操作权限'
    }
}
