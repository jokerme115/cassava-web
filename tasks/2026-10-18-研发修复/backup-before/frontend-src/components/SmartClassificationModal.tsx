import React, { useMemo, useState, useEffect, useCallback } from 'react';
import { Modal, List, TreeSelect } from 'antd';
import { useTranslation } from 'react-i18next';
import { FileText, Folder, AlertCircle } from 'lucide-react';

interface SmartClassificationModalProps {
  visible: boolean;
  files: File[];
  folders: any[];
  onCancel: () => void;
  onConfirm: (fileData: Array<{ file: File, folderId?: string }>) => void;
}

interface FileData {
  file: File;
  folderId?: string;
  suggestedFolder?: string;
}

export const SmartClassificationModal: React.FC<SmartClassificationModalProps> = ({
  visible,
  files,
  folders,
  onCancel,
  onConfirm
}) => {
  const { t } = useTranslation();
  const [fileDataList, setFileDataList] = useState<FileData[]>([]);

  const childrenByParentId = useMemo(() => {
    const map = new Map<string | null, any[]>();
    for (const f of folders) {
      const pid =
        f.parent === null || f.parent === undefined || f.parent === ''
          ? null
          : String(f.parent);
      const arr = map.get(pid) ?? [];
      arr.push(f);
      map.set(pid, arr);
    }
    for (const arr of map.values()) {
      arr.sort((a, b) => String(a.name).localeCompare(String(b.name)));
    }
    return map;
  }, [folders]);

  const folderTreeSelectData = useMemo(() => {
    const build = (parentId: string | null): any[] => {
      const items = childrenByParentId.get(parentId) ?? [];
      return items.map((f: any) => {
        const id = String(f.id);
        return {
          title: f.name,
          value: id,
          key: id,
          children: build(id),
        };
      });
    };
    return build(null);
  }, [childrenByParentId]);

  const analyzeFiles = useCallback(() => {
    const analyzed = files.map(file => {
      const name = file.name.toLowerCase();
      let folderId: string | undefined = undefined;

      // Folder suggestion based on exact folder name match in filename
      const matchedFolder = folders.find(f => name.includes(f.name.toLowerCase()));
      if (matchedFolder) {
        folderId = matchedFolder.id;
      }

      return {
        file,
        folderId,
        suggestedFolder: folderId
      };
    });
    setFileDataList(analyzed);
  }, [files, folders]);

  useEffect(() => {
    if (visible && files.length > 0) analyzeFiles();
  }, [analyzeFiles, files.length, visible]);

  const handleFolderChange = (index: number, folderId?: string) => {
    const newList = [...fileDataList];
    newList[index].folderId = folderId;
    setFileDataList(newList);
  };

  const handleConfirm = () => {
    onConfirm(fileDataList.map(item => ({
      file: item.file,
      folderId: item.folderId
    })));
  };

  return (
    <Modal
      title={
        <div className="flex items-center space-x-2">
          <Folder className="w-5 h-5 text-blue-500" />
          <span>{t('smart_classification.title')}</span>
        </div>
      }
      open={visible}
      onCancel={onCancel}
      onOk={handleConfirm}
      width={800}
      okText={t('common.confirm_upload')}
      cancelText={t('common.cancel')}
      className="rounded-xl"
    >
      <div className="mb-4 bg-blue-50 p-3 rounded-lg flex items-start">
        <AlertCircle className="w-5 h-5 text-blue-500 mr-2 mt-0.5" />
        <div className="text-sm text-blue-700">
          {t('smart_classification.description')}
        </div>
      </div>

      <List
        dataSource={fileDataList}
        renderItem={(item, index) => (
          <List.Item className="bg-white p-4 rounded-lg border border-gray-100 mb-3 shadow-sm hover:shadow-md transition-shadow">
            <div className="w-full">
              <div className="flex items-center justify-between mb-3">
                <div className="flex items-center space-x-3">
                  <div className="w-10 h-10 bg-gray-100 rounded-lg flex items-center justify-center">
                    <FileText className="w-6 h-6 text-gray-500" />
                  </div>
                  <div>
                    <div className="font-medium text-gray-900 truncate max-w-xs" title={item.file.name}>
                      {item.file.name}
                    </div>
                    <div className="text-xs text-gray-500">
                      {(item.file.size / 1024 / 1024).toFixed(2)} MB
                    </div>
                  </div>
                </div>
              </div>

              <div className="grid grid-cols-1 gap-4">
                <div>
                  <div className="text-xs text-gray-500 mb-1 flex items-center">
                    <Folder className="w-3 h-3 mr-1" />
                    {t('images.folder')}
                  </div>
                  <TreeSelect
                    style={{ width: '100%' }}
                    value={item.folderId}
                    onChange={(val) => handleFolderChange(index, val ? String(val) : undefined)}
                    placeholder={t('images.choose_folder')}
                    allowClear
                    treeData={folderTreeSelectData}
                    treeDefaultExpandAll
                  />
                </div>
              </div>
            </div>
          </List.Item>
        )}
        className="max-h-[500px] overflow-y-auto"
      />
    </Modal>
  );
};
