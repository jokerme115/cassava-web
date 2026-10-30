import logging

from django.conf import settings
from django.db import connection


logger = logging.getLogger(__name__)
_BOOTSTRAPPED = False


def _table_exists(cursor, table_name: str) -> bool:
    row = cursor.execute(
        f"SELECT name FROM sqlite_master WHERE type='table' AND name = '{table_name}'"
    ).fetchone()
    return bool(row)


def _column_names(cursor, table_name: str) -> set[str]:
    return {
        row[1]
        for row in cursor.execute(f"PRAGMA table_info('{table_name}')").fetchall()
    }


def _ensure_column(cursor, table_name: str, column_name: str, ddl: str) -> bool:
    existing = _column_names(cursor, table_name)
    if column_name in existing:
        return False

    cursor.execute(f"ALTER TABLE {table_name} ADD COLUMN {ddl}")
    logger.info("Desktop DB patched: %s.%s", table_name, column_name)
    return True


def _check_legacy_char_pk(cursor) -> list[str]:
    """检查所有表是否有 char(32) 类型的 id 列（老库特征）。"""
    legacy_tables = []
    rows = cursor.execute(
        "SELECT name FROM sqlite_master WHERE type='table' AND name LIKE 'predict_%'"
    ).fetchall()
    for (table_name,) in rows:
        cols = cursor.execute(f"PRAGMA table_info('{table_name}')").fetchall()
        for col in cols:
            # col: (cid, name, type, notnull, dflt_value, pk)
            if col[1] == 'id' and col[2] and 'char' in col[2].lower():
                legacy_tables.append(table_name)
                break
    return legacy_tables


def bootstrap_desktop_db() -> None:
    global _BOOTSTRAPPED
    if _BOOTSTRAPPED or not getattr(settings, "DESKTOP_MODE", False):
        return
    if connection.vendor != "sqlite":
        _BOOTSTRAPPED = True
        return

    # P0-2 + schema patches: 所有数据库操作在一个 cursor 内完成
    with connection.cursor() as cursor:
        # P0-2: 启动时自检 char(32) 老库
        legacy_tables = _check_legacy_char_pk(cursor)
        if legacy_tables:
            logger.warning(
                "[Desktop DB] 兼容警告: 检测到老库 char(32) id 列: %s\n"
                "  兼容模式已启用，id 将由应用层自动生成，不会出现 NOT NULL 错误。\n"
                "  如需彻底修复，建议重新建库或迁移到默认自增 id。",
                legacy_tables
            )
        else:
            logger.info("[Desktop DB] 数据库兼容性检查通过，无老库 char(32) id 列。")

        # schema 补丁（原有逻辑，保持不变）
        if _table_exists(cursor, "predict_cassavaimage"):
            changed = False
            changed |= _ensure_column(cursor, "predict_cassavaimage", "oss_key", "oss_key varchar(500) DEFAULT ''")
            changed |= _ensure_column(cursor, "predict_cassavaimage", "image", "image varchar(500) DEFAULT ''")
            changed |= _ensure_column(cursor, "predict_cassavaimage", "status", "status varchar(20) DEFAULT 'pending'")
            changed |= _ensure_column(cursor, "predict_cassavaimage", "capture_time", "capture_time datetime NULL")
            changed |= _ensure_column(cursor, "predict_cassavaimage", "width", "width integer NULL")
            changed |= _ensure_column(cursor, "predict_cassavaimage", "height", "height integer NULL")
            changed |= _ensure_column(cursor, "predict_cassavaimage", "days", "days integer DEFAULT 0")
            changed |= _ensure_column(cursor, "predict_cassavaimage", "type", "type varchar(100) DEFAULT 'image'")
            changed |= _ensure_column(cursor, "predict_cassavaimage", "description", "description TEXT DEFAULT ''")
            if changed:
                cursor.execute(
                    "UPDATE predict_cassavaimage SET image = COALESCE(NULLIF(image, ''), oss_key) "
                    "WHERE image IS NULL OR image = ''"
                )
                cursor.execute(
                    "UPDATE predict_cassavaimage SET oss_key = COALESCE(NULLIF(oss_key, ''), image, '') "
                    "WHERE oss_key IS NULL OR oss_key = ''"
                )

        if _table_exists(cursor, "predict_processingtask"):
            changed = False
            changed |= _ensure_column(cursor, "predict_processingtask", "task_type", "task_type varchar(20) DEFAULT 'prediction'")
            changed |= _ensure_column(cursor, "predict_processingtask", "parameters", "parameters TEXT DEFAULT '{}'")
            changed |= _ensure_column(cursor, "predict_processingtask", "total_images", "total_images integer DEFAULT 0")
            changed |= _ensure_column(cursor, "predict_processingtask", "processed_images", "processed_images integer DEFAULT 0")
            changed |= _ensure_column(cursor, "predict_processingtask", "failed_images", "failed_images integer DEFAULT 0")
            changed |= _ensure_column(cursor, "predict_processingtask", "result_summary", "result_summary TEXT DEFAULT '{}'")
            changed |= _ensure_column(cursor, "predict_processingtask", "error_message", "error_message TEXT DEFAULT ''")
            changed |= _ensure_column(cursor, "predict_processingtask", "started_at", "started_at datetime NULL")
            changed |= _ensure_column(cursor, "predict_processingtask", "completed_at", "completed_at datetime NULL")
            if changed:
                cursor.execute(
                    "UPDATE predict_processingtask SET task_type = COALESCE(NULLIF(task_type, ''), type) "
                    "WHERE task_type IS NULL OR task_type = ''"
                )
                cursor.execute(
                    "UPDATE predict_processingtask SET error_message = COALESCE(NULLIF(error_message, ''), error, '') "
                    "WHERE error_message IS NULL OR error_message = ''"
                )

        if _table_exists(cursor, "predict_systemsetting"):
            changed = False
            systemsetting_columns = _column_names(cursor, "predict_systemsetting")
            changed |= _ensure_column(cursor, "predict_systemsetting", "max_display_images", "max_display_images integer DEFAULT 200")
            changed |= _ensure_column(cursor, "predict_systemsetting", "max_display_results", "max_display_results integer DEFAULT 100")
            changed |= _ensure_column(cursor, "predict_systemsetting", "site_title", "site_title varchar(200) DEFAULT 'CassavaSeg'")
            changed |= _ensure_column(cursor, "predict_systemsetting", "site_announcement", "site_announcement TEXT DEFAULT ''")
            changed |= _ensure_column(cursor, "predict_systemsetting", "announcement_level", "announcement_level varchar(20) DEFAULT 'info'")
            changed |= _ensure_column(cursor, "predict_systemsetting", "enable_guest_access", "enable_guest_access bool DEFAULT 0")
            changed |= _ensure_column(cursor, "predict_systemsetting", "allow_registration", "allow_registration bool DEFAULT 0")
            changed |= _ensure_column(cursor, "predict_systemsetting", "maintenance_mode", "maintenance_mode bool DEFAULT 0")
            changed |= _ensure_column(cursor, "predict_systemsetting", "upload_size_limit_mb", "upload_size_limit_mb integer DEFAULT 50")
            changed |= _ensure_column(cursor, "predict_systemsetting", "guest_data_retention_days", "guest_data_retention_days integer DEFAULT 7")
            changed |= _ensure_column(cursor, "predict_systemsetting", "audit_log_retention_days", "audit_log_retention_days integer DEFAULT 30")
            changed |= _ensure_column(cursor, "predict_systemsetting", "updated_at", "updated_at datetime NULL")
            changed |= _ensure_column(cursor, "predict_systemsetting", "updated_by_id", "updated_by_id integer NULL")

            for column_name in ("enable_guest_access", "allow_registration", "maintenance_mode"):
                if column_name in _column_names(cursor, "predict_systemsetting"):
                    cursor.execute(f"UPDATE predict_systemsetting SET {column_name} = 0")

            if changed:
                cursor.execute(
                    "UPDATE predict_systemsetting "
                    "SET max_display_images = COALESCE(max_display_images, 200), "
                    "max_display_results = COALESCE(max_display_results, 100), "
                    "site_title = COALESCE(site_title, 'CassavaSeg'), "
                    "site_announcement = COALESCE(site_announcement, ''), "
                    "announcement_level = COALESCE(announcement_level, 'info'), "
                    "upload_size_limit_mb = COALESCE(upload_size_limit_mb, 50), "
                    "guest_data_retention_days = COALESCE(guest_data_retention_days, 7), "
                    "audit_log_retention_days = COALESCE(audit_log_retention_days, 30)"
                )

            has_id1 = cursor.execute(
                "SELECT 1 FROM predict_systemsetting WHERE id = 1 LIMIT 1"
            ).fetchone()
            if not has_id1:
                if {"key", "value", "description"}.issubset(systemsetting_columns):
                    cursor.execute(
                        "INSERT INTO predict_systemsetting ("
                        "id, key, value, description, updated_at, "
                        "max_display_images, max_display_results, site_title, site_announcement, "
                        "announcement_level, enable_guest_access, allow_registration, maintenance_mode, "
                        "upload_size_limit_mb, guest_data_retention_days, audit_log_retention_days"
                        ") VALUES ("
                        "1, 'desktop', '{}', 'desktop setting', CURRENT_TIMESTAMP, "
                        "200, 100, 'CassavaSeg', '', "
                        "'info', 0, 0, 0, "
                        "50, 7, 30"
                        ")"
                    )
                else:
                    cursor.execute(
                        "INSERT INTO predict_systemsetting ("
                        "id, updated_at, "
                        "max_display_images, max_display_results, site_title, site_announcement, "
                        "announcement_level, enable_guest_access, allow_registration, maintenance_mode, "
                        "upload_size_limit_mb, guest_data_retention_days, audit_log_retention_days"
                        ") VALUES ("
                        "1, CURRENT_TIMESTAMP, "
                        "200, 100, 'CassavaSeg', '', "
                        "'info', 0, 0, 0, "
                        "50, 7, 30"
                        ")"
                    )

    # P0-4: 启动时输出离线合规报告（纯环境变量检查，不需要数据库 cursor）
    import os
    offline_vars = [
        ('HF_HUB_OFFLINE', 'HuggingFace Hub 下载'),
        ('HF_HUB_DISABLE_TELEMETRY', 'HuggingFace 遥测'),
        ('TRANSFORMERS_OFFLINE', 'Transformers 远程加载'),
        ('DISABLE_TELEMETRY', '通用遥测'),
        ('DESKTOP_OFFLINE_MODE', '桌面离线模式'),
    ]
    all_offline = True
    report_lines = ["[Offline] 离线合规报告:"]
    for var, desc in offline_vars:
        val = os.getenv(var, '')
        status = '✅' if val and val != '0' else '❌'
        if not val or val == '0':
            all_offline = False
        report_lines.append(f"  {status} {desc} ({var}={val or '未设置'})")
    if all_offline:
        report_lines.append("  ✅ 全部外网依赖已禁用，离线模式正常")
    else:
        report_lines.append("  ⚠️ 存在未禁用的外网依赖，请检查环境变量")
    report_str = "\n".join(report_lines)
    if all_offline:
        logger.info(report_str)
    else:
        logger.warning(report_str)

    _BOOTSTRAPPED = True
