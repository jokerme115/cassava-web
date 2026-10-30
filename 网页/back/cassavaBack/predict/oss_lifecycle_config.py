"""
OSS lifecycle helper for the cassava project.

This script keeps non-cassava lifecycle rules untouched and only manages the
rules declared in MANAGED_RULE_IDS.

Usage:
python manage.py shell
>>> exec(open('predict/oss_lifecycle_config.py', encoding='utf-8').read())
>>> setup_lifecycle_rules()
"""

from __future__ import annotations

import os

import oss2
from django.conf import settings

OSS_ACCESS_KEY_ID = os.getenv("OSS_ACCESS_KEY_ID", getattr(settings, "OSS_ACCESS_KEY_ID", ""))
OSS_ACCESS_KEY_SECRET = os.getenv("OSS_ACCESS_KEY_SECRET", getattr(settings, "OSS_ACCESS_KEY_SECRET", ""))
OSS_ENDPOINT = os.getenv("OSS_ENDPOINT", getattr(settings, "OSS_ENDPOINT", ""))
OSS_BUCKET = os.getenv("OSS_BUCKET", getattr(settings, "OSS_BUCKET", ""))

MANAGED_RULE_IDS = {
    "cassava-original-images-ia",
    "cassava-previews-retention",
    "cassava-segmentations-retention",
    "cassava-predictions-retention",
}


def _check_configured() -> bool:
    return all([OSS_ACCESS_KEY_ID, OSS_ACCESS_KEY_SECRET, OSS_ENDPOINT, OSS_BUCKET])


def _get_bucket():
    if not _check_configured():
        raise ValueError("OSS configuration is incomplete.")
    auth = oss2.Auth(OSS_ACCESS_KEY_ID, OSS_ACCESS_KEY_SECRET)
    return oss2.Bucket(auth, OSS_ENDPOINT, OSS_BUCKET)


def build_managed_rules():
    models = oss2.models

    return [
        models.LifecycleRule(
            id="cassava-original-images-ia",
            prefix="images/",
            status=models.LifecycleRule.ENABLED,
            storage_transitions=[
                models.StorageTransition(days=45, storage_class=oss2.BUCKET_STORAGE_CLASS_IA),
            ],
        ),
        models.LifecycleRule(
            id="cassava-previews-retention",
            prefix="previews/",
            status=models.LifecycleRule.ENABLED,
            storage_transitions=[
                models.StorageTransition(days=30, storage_class=oss2.BUCKET_STORAGE_CLASS_IA),
            ],
            expiration=models.LifecycleExpiration(days=90),
        ),
        models.LifecycleRule(
            id="cassava-segmentations-retention",
            prefix="segmentations/",
            status=models.LifecycleRule.ENABLED,
            storage_transitions=[
                models.StorageTransition(days=30, storage_class=oss2.BUCKET_STORAGE_CLASS_IA),
            ],
            expiration=models.LifecycleExpiration(days=90),
        ),
        models.LifecycleRule(
            id="cassava-predictions-retention",
            prefix="predictions/",
            status=models.LifecycleRule.ENABLED,
            storage_transitions=[
                models.StorageTransition(days=30, storage_class=oss2.BUCKET_STORAGE_CLASS_IA),
            ],
            expiration=models.LifecycleExpiration(days=90),
        ),
    ]


def _list_rules():
    bucket = _get_bucket()
    try:
        lifecycle = bucket.get_bucket_lifecycle()
    except oss2.exceptions.NoSuchLifecycle:
        return []
    return list(getattr(lifecycle, "rules", []) or [])


def get_lifecycle_rules():
    try:
        rules = _list_rules()
        if not rules:
            print("当前未配置生命周期规则。")
            return []

        print("\n当前生命周期规则:")
        for rule in rules:
            print(f"- ID: {rule.id}")
            print(f"  Prefix: {rule.prefix}")
            print(f"  Status: {rule.status}")
            transitions = getattr(rule, "storage_transitions", None) or getattr(rule, "transitions", None) or []
            for transition in transitions:
                print(f"  Transition: {transition.days} days -> {transition.storage_class}")
            expiration = getattr(rule, "expiration", None)
            if expiration and getattr(expiration, "days", None) is not None:
                print(f"  Expiration: delete after {expiration.days} days")
        return rules
    except Exception as exc:
        print(f"查询生命周期规则失败: {exc}")
        return []


def setup_lifecycle_rules():
    if not _check_configured():
        print("OSS配置不完整，请检查环境变量或 settings.py。")
        return False

    try:
        bucket = _get_bucket()
        existing_rules = [rule for rule in _list_rules() if getattr(rule, "id", "") not in MANAGED_RULE_IDS]
        managed_rules = build_managed_rules()
        merged_rules = existing_rules + managed_rules

        bucket.put_bucket_lifecycle(oss2.models.BucketLifecycle(merged_rules))

        print("已更新 OSS 生命周期规则。")
        print("说明:")
        print("- images/: 45天后转 IA")
        print("- previews/: 30天后转 IA, 90天后删除")
        print("- segmentations/: 30天后转 IA, 90天后删除")
        print("- predictions/: 30天后转 IA, 90天后删除")
        print("- 未由本脚本管理的其他生命周期规则会保留")
        print("- 旧版 images/{folder}/previews/* 不会被单独命中，建议后续迁移或清理")
        return True
    except Exception as exc:
        print(f"配置生命周期规则失败: {exc}")
        return False


def delete_managed_lifecycle_rules():
    if not _check_configured():
        print("OSS配置不完整，请检查环境变量或 settings.py。")
        return False

    try:
        bucket = _get_bucket()
        preserved_rules = [rule for rule in _list_rules() if getattr(rule, "id", "") not in MANAGED_RULE_IDS]
        if preserved_rules:
            bucket.put_bucket_lifecycle(oss2.models.BucketLifecycle(preserved_rules))
        else:
            bucket.delete_bucket_lifecycle()
        print("已删除本脚本管理的生命周期规则。")
        return True
    except oss2.exceptions.NoSuchLifecycle:
        print("当前没有生命周期规则可删除。")
        return True
    except Exception as exc:
        print(f"删除生命周期规则失败: {exc}")
        return False


if __name__ == "__main__":
    print("=" * 60)
    print("Cassava OSS lifecycle configuration")
    print("=" * 60)
    get_lifecycle_rules()
