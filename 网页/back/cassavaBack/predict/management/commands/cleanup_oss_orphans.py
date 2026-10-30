from django.core.management.base import BaseCommand

from predict.oss_service import _get_bucket, check_oss_configured
from predict.storage_utils import collect_database_storage_keys, delete_storage_keys

import oss2


DEFAULT_PREFIXES = ("images/", "previews/", "segmentations/", "predictions/")


class Command(BaseCommand):
    help = "Find and optionally delete OSS objects that are no longer referenced in the database."

    def add_arguments(self, parser):
        parser.add_argument(
            "--apply",
            action="store_true",
            help="Actually delete orphaned objects. Default is dry-run.",
        )
        parser.add_argument(
            "--prefix",
            action="append",
            dest="prefixes",
            help="Restrict scanning to one or more prefixes. Can be used multiple times.",
        )
        parser.add_argument(
            "--show-sample",
            type=int,
            default=20,
            help="How many orphan keys to print in dry-run mode.",
        )

    def handle(self, *args, **options):
        if not check_oss_configured():
            self.stderr.write(self.style.ERROR("OSS 未配置，无法执行清理。"))
            return

        prefixes = tuple(options["prefixes"] or DEFAULT_PREFIXES)
        show_sample = max(int(options["show_sample"]), 0)
        tracked_keys = collect_database_storage_keys()
        bucket = _get_bucket()

        self.stdout.write(f"扫描前缀: {', '.join(prefixes)}")
        self.stdout.write(f"数据库跟踪 key 数量: {len(tracked_keys):,}")

        orphan_keys: list[str] = []
        for prefix in prefixes:
            prefix_orphans = 0
            prefix_total = 0
            for obj in oss2.ObjectIterator(bucket, prefix=prefix):
                if obj.key.endswith("/"):
                    continue
                prefix_total += 1
                if obj.key not in tracked_keys:
                    orphan_keys.append(obj.key)
                    prefix_orphans += 1
            self.stdout.write(f"{prefix}: 扫描 {prefix_total:,} 个对象, 发现孤儿文件 {prefix_orphans:,} 个")

        unique_orphans = list(dict.fromkeys(orphan_keys))
        self.stdout.write(f"总孤儿文件数: {len(unique_orphans):,}")

        if not options["apply"]:
            if show_sample:
                self.stdout.write("示例孤儿 key:")
                for key in unique_orphans[:show_sample]:
                    self.stdout.write(f"  - {key}")
            self.stdout.write(self.style.WARNING("当前为 dry-run，未执行删除。需要实际删除请加 --apply。"))
            return

        deleted = delete_storage_keys(unique_orphans)
        self.stdout.write(self.style.SUCCESS(f"实际删除完成，共删除 {len(deleted):,} 个对象。"))
