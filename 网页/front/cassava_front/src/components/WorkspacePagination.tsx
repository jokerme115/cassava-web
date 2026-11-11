import { Pagination } from 'antd';

interface Props {
  page: number;
  pageSize: number;
  total: number;
  onChange: (page: number, pageSize: number) => void;
}

export default function WorkspacePagination({ page, pageSize, total, onChange }: Props) {
  return <footer className="workspace-pagination" aria-label="列表分页">
    <span className="shrink-0 text-xs tabular-nums text-muted">共 {total} 项</span>
    <Pagination current={page} pageSize={pageSize} total={total} onChange={onChange}
      size="small" responsive showLessItems showSizeChanger pageSizeOptions={[24, 48, 96, 120]} />
  </footer>;
}
