from django.core.management.base import BaseCommand
from django.core.files.base import ContentFile
from django.core.files.storage import default_storage

from predict.models import CassavaImage
from predict.oss_service import check_oss_configured, get_file_from_oss, upload_file_to_oss
from predict.storage_utils import build_preview_storage_key, normalize_storage_key


def is_legacy_preview_key(value: str | None) -> bool:
    key = normalize_storage_key(value)
    if not key:
        return False
    return key.startswith("images/previews/") or "/previews/" in key


class Command(BaseCommand):
    help = "Migrate legacy preview keys from images/.../previews/... to previews/..."

    def add_arguments(self, parser):
        parser.add_argument(
            "--apply",
            action="store_true",
            help="Actually migrate files. Default is dry-run.",
        )
        parser.add_argument(
            "--limit",
            type=int,
            default=0,
            help="Only process the first N matched records. 0 means no limit.",
        )
        parser.add_argument(
            "--show-sample",
            type=int,
            default=20,
            help="How many planned migrations to print in dry-run mode.",
        )

    def handle(self, *args, **options):
        queryset = CassavaImage.objects.exclude(preview_oss_key__isnull=True).exclude(preview_oss_key="")
        images = [image for image in queryset.iterator() if is_legacy_preview_key(image.preview_oss_key)]

        limit = max(int(options["limit"]), 0)
        if limit:
            images = images[:limit]

        self.stdout.write(f"发现旧版预览图记录: {len(images)}")
        if not images:
            return

        if not options["apply"]:
            sample_size = max(int(options["show_sample"]), 0)
            for image in images[:sample_size]:
                new_key = build_preview_storage_key(folder=image.folder)
                self.stdout.write(f"{image.id}: {image.preview_oss_key} -> {new_key}")
            self.stdout.write(self.style.WARNING("当前为 dry-run，未执行迁移。需要实际迁移请加 --apply。"))
            return

        use_oss = check_oss_configured()
        migrated = 0
        skipped = 0
        failed = 0

        for image in images:
            old_key = normalize_storage_key(image.preview_oss_key)
            new_key = build_preview_storage_key(folder=image.folder)

            try:
                if use_oss:
                    content = get_file_from_oss(old_key)
                else:
                    if not default_storage.exists(old_key):
                        content = None
                    else:
                        with default_storage.open(old_key, "rb") as handle:
                            content = handle.read()

                if not content:
                    skipped += 1
                    self.stdout.write(self.style.WARNING(f"跳过 {image.id}: 旧预览图不存在 {old_key}"))
                    continue

                if use_oss:
                    result = upload_file_to_oss(new_key, content)
                    if result.get("status_code") != 200:
                        failed += 1
                        self.stdout.write(self.style.ERROR(f"迁移失败 {image.id}: 上传新预览图失败 {result}"))
                        continue
                else:
                    default_storage.save(new_key, ContentFile(content))

                image.preview_oss_key = new_key
                image.save(update_fields=["preview_oss_key"])

                try:
                    if use_oss:
                        from predict.storage_utils import delete_storage_keys

                        delete_storage_keys(old_key)
                    else:
                        default_storage.delete(old_key)
                except Exception:
                    pass

                migrated += 1
                self.stdout.write(self.style.SUCCESS(f"已迁移 {image.id}: {old_key} -> {new_key}"))
            except Exception as exc:
                failed += 1
                self.stdout.write(self.style.ERROR(f"迁移失败 {image.id}: {exc}"))

        self.stdout.write(
            self.style.SUCCESS(
                f"迁移完成: 成功 {migrated}, 跳过 {skipped}, 失败 {failed}"
            )
        )
