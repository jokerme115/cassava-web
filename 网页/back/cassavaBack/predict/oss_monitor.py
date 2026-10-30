"""
Low-risk OSS monitoring helpers for the cassava project.

The default report scans only managed prefixes instead of listing the entire
bucket. Use include_other=True only for occasional diagnostics.
"""

from __future__ import annotations

import os
from collections import OrderedDict, defaultdict
from datetime import datetime

import oss2
from django.conf import settings

from .storage_utils import collect_database_storage_keys

OSS_ACCESS_KEY_ID = os.getenv("OSS_ACCESS_KEY_ID", getattr(settings, "OSS_ACCESS_KEY_ID", ""))
OSS_ACCESS_KEY_SECRET = os.getenv("OSS_ACCESS_KEY_SECRET", getattr(settings, "OSS_ACCESS_KEY_SECRET", ""))
OSS_ENDPOINT = os.getenv("OSS_ENDPOINT", getattr(settings, "OSS_ENDPOINT", ""))
OSS_BUCKET = os.getenv("OSS_BUCKET", getattr(settings, "OSS_BUCKET", ""))

STANDARD_STORAGE_PRICE = float(os.getenv("OSS_STANDARD_STORAGE_PRICE", getattr(settings, "OSS_STANDARD_STORAGE_PRICE", 0.12)))
IA_STORAGE_PRICE = float(os.getenv("OSS_IA_STORAGE_PRICE", getattr(settings, "OSS_IA_STORAGE_PRICE", 0.08)))
ARCHIVE_STORAGE_PRICE = float(os.getenv("OSS_ARCHIVE_STORAGE_PRICE", getattr(settings, "OSS_ARCHIVE_STORAGE_PRICE", 0.03)))

MANAGED_PREFIXES = OrderedDict(
    [
        ("images/", "原始图片和历史嵌套预览"),
        ("previews/", "预览图"),
        ("segmentations/", "分割结果"),
        ("predictions/", "预测结果"),
    ]
)


def _check_configured() -> bool:
    return all([OSS_ACCESS_KEY_ID, OSS_ACCESS_KEY_SECRET, OSS_ENDPOINT, OSS_BUCKET])


def _get_bucket():
    if not _check_configured():
        raise ValueError("OSS configuration is incomplete.")
    auth = oss2.Auth(OSS_ACCESS_KEY_ID, OSS_ACCESS_KEY_SECRET)
    return oss2.Bucket(auth, OSS_ENDPOINT, OSS_BUCKET)


def get_bucket_stats():
    try:
        bucket = _get_bucket()
        info = bucket.get_bucket_info()
        return {
            "name": info.name,
            "location": info.location,
            "storage_class": info.storage_class,
            "creation_date": info.creation_date,
        }
    except Exception as exc:
        print(f"获取 Bucket 信息失败: {exc}")
        return None


def _prefix_stats(bucket, prefix: str) -> dict:
    size = 0
    count = 0
    for obj in oss2.ObjectIterator(bucket, prefix=prefix):
        size += obj.size
        count += 1
    return {
        "count": count,
        "size": size,
        "size_mb": size / (1024 * 1024),
        "size_gb": size / (1024 * 1024 * 1024),
    }


def analyze_storage_by_prefix(include_other: bool = False):
    try:
        bucket = _get_bucket()
        stats = OrderedDict()
        total_size = 0
        total_count = 0

        print("\n" + "=" * 70)
        print("OSS 存储分布分析")
        print("=" * 70)

        for prefix, name in MANAGED_PREFIXES.items():
            prefix_stat = _prefix_stats(bucket, prefix)
            prefix_stat["name"] = name
            stats[prefix] = prefix_stat
            total_size += prefix_stat["size"]
            total_count += prefix_stat["count"]
            print(f"\n{name} ({prefix})")
            print(f"  文件数量: {prefix_stat['count']:,}")
            print(f"  存储大小: {prefix_stat['size_mb']:.2f} MB ({prefix_stat['size_gb']:.4f} GB)")

        if include_other:
            tracked_prefixes = tuple(MANAGED_PREFIXES.keys())
            other_size = 0
            other_count = 0
            for obj in oss2.ObjectIterator(bucket):
                if obj.key.startswith(tracked_prefixes):
                    continue
                other_size += obj.size
                other_count += 1

            stats["other"] = {
                "name": "其他文件",
                "count": other_count,
                "size": other_size,
                "size_mb": other_size / (1024 * 1024),
                "size_gb": other_size / (1024 * 1024 * 1024),
            }
            total_size += other_size
            total_count += other_count
            print("\n其他文件")
            print(f"  文件数量: {other_count:,}")
            print(f"  存储大小: {other_size / (1024 * 1024):.2f} MB")
        else:
            print("\n未扫描其他前缀。")
            print("如需全桶诊断，可调用 analyze_storage_by_prefix(include_other=True)。")

        print("\n" + "-" * 70)
        print("总计")
        print(f"  已扫描文件数: {total_count:,}")
        print(f"  已扫描存储量: {total_size / (1024 * 1024):.2f} MB ({total_size / (1024 * 1024 * 1024):.4f} GB)")
        print("=" * 70)

        return stats
    except Exception as exc:
        print(f"按前缀分析失败: {exc}")
        return None


def get_database_storage_summary():
    try:
        from .models import CassavaImage, PredictionResult, SegmentationResult

        tracked_keys = collect_database_storage_keys()
        summary = {
            "images": CassavaImage.objects.count(),
            "images_with_preview": CassavaImage.objects.exclude(preview_oss_key__isnull=True).exclude(preview_oss_key="").count(),
            "segmentations": SegmentationResult.objects.count(),
            "predictions": PredictionResult.objects.count(),
            "tracked_keys": len(tracked_keys),
        }

        print("\n数据库侧摘要")
        print(f"  图片记录: {summary['images']:,}")
        print(f"  含预览图图片: {summary['images_with_preview']:,}")
        print(f"  分割结果记录: {summary['segmentations']:,}")
        print(f"  预测结果记录: {summary['predictions']:,}")
        print(f"  数据库跟踪到的唯一存储 key: {summary['tracked_keys']:,}")
        return summary
    except Exception as exc:
        print(f"数据库侧摘要生成失败: {exc}")
        return None


def estimate_monthly_cost(size_gb: float):
    standard_cost = size_gb * STANDARD_STORAGE_PRICE
    ia_cost = size_gb * IA_STORAGE_PRICE
    archive_cost = size_gb * ARCHIVE_STORAGE_PRICE

    print("\n成本估算")
    print("  以下价格为估算值，请以当前地域实际账单为准。")
    print(f"  标准存储: ¥{standard_cost:.2f}")
    print(f"  低频访问: ¥{ia_cost:.2f}")
    print(f"  归档存储: ¥{archive_cost:.2f}")

    return {
        "standard": standard_cost,
        "ia": ia_cost,
        "archive": archive_cost,
    }


def analyze_file_size_distribution(prefixes: tuple[str, ...] | None = None):
    try:
        bucket = _get_bucket()
        ranges = [
            (0, 100 * 1024, "< 100KB"),
            (100 * 1024, 500 * 1024, "100KB - 500KB"),
            (500 * 1024, 1024 * 1024, "500KB - 1MB"),
            (1024 * 1024, 5 * 1024 * 1024, "1MB - 5MB"),
            (5 * 1024 * 1024, 10 * 1024 * 1024, "5MB - 10MB"),
            (10 * 1024 * 1024, float("inf"), "> 10MB"),
        ]
        distribution = defaultdict(lambda: {"count": 0, "size": 0})
        scan_prefixes = prefixes or tuple(MANAGED_PREFIXES.keys())

        for prefix in scan_prefixes:
            for obj in oss2.ObjectIterator(bucket, prefix=prefix):
                for min_size, max_size, label in ranges:
                    if min_size <= obj.size < max_size:
                        distribution[label]["count"] += 1
                        distribution[label]["size"] += obj.size
                        break

        print("\n文件大小分布")
        for _, _, label in ranges:
            if distribution[label]["count"] > 0:
                size_mb = distribution[label]["size"] / (1024 * 1024)
                print(f"  {label}: {distribution[label]['count']:,} 个文件, 共 {size_mb:.2f} MB")
        return distribution
    except Exception as exc:
        print(f"文件大小分布分析失败: {exc}")
        return None


def check_cost_alert(threshold_gb: float = 100, include_other: bool = False):
    stats = analyze_storage_by_prefix(include_other=include_other)
    if not stats:
        return False

    total_size = sum(item["size"] for item in stats.values())
    total_gb = total_size / (1024 * 1024 * 1024)

    print(f"\n存储告警检查 (阈值: {threshold_gb} GB)")
    print(f"  已扫描前缀存储量: {total_gb:.2f} GB")
    if total_gb > threshold_gb:
        print("  警告: 已超过阈值")
        return True

    print("  存储量未超过阈值")
    return False


def generate_report(include_other: bool = False):
    print("\n" + "=" * 70)
    print("OSS 存储监控报告")
    print(f"生成时间: {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}")
    print("=" * 70)

    print("\n1. Bucket 基本信息")
    bucket_stats = get_bucket_stats()
    if bucket_stats:
        for key, value in bucket_stats.items():
            print(f"  {key}: {value}")

    print("\n2. 数据库侧摘要")
    get_database_storage_summary()

    print("\n3. OSS 前缀统计")
    storage_stats = analyze_storage_by_prefix(include_other=include_other)

    print("\n4. 文件大小分布")
    analyze_file_size_distribution()

    if storage_stats:
        total_size = sum(item["size"] for item in storage_stats.values())
        total_gb = total_size / (1024 * 1024 * 1024)
        print("\n5. 成本估算")
        estimate_monthly_cost(total_gb)

    print("\n6. 监控建议")
    print("  - 日常巡检优先使用本报告的受控前缀扫描模式")
    print("  - 大桶盘点建议启用 OSS 存储空间清单")
    print("  - include_other=True 会触发全桶扫描，仅建议偶尔执行")
