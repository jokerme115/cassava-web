import { message } from '../utils/feedback';
import React, { useState, useEffect } from 'react';
import { Modal, Select, DatePicker, Radio } from 'antd';
import { sharesApi, permissionsApi } from '../services/api';
import { useTranslation } from 'react-i18next';
import { User } from 'lucide-react';

interface ShareModalProps {
  visible: boolean;
  onCancel: () => void;
  resourceType: 'image' | 'folder';
  resourceIds: string[];
  onSuccess: () => void;
}

const ShareModal: React.FC<ShareModalProps> = ({ visible, onCancel, resourceType, resourceIds, onSuccess }) => {
  const { t } = useTranslation();
  const [users, setUsers] = useState<any[]>([]);
  const [selectedUser, setSelectedUser] = useState<string>('');
  const [permission, setPermission] = useState<'view' | 'edit' | 'manage'>('view');
  const [expiresAt, setExpiresAt] = useState<any>(null);
  const [loading, setLoading] = useState(false);
  const [searching, setSearching] = useState(false);

  useEffect(() => {
    if (visible) {
      setUsers([]);
      setSelectedUser('');
      setPermission('view');
      setExpiresAt(null);
    }
  }, [visible]);

  const handleSearch = async (value: string) => {
    if (!value) {
      setUsers([]);
      return;
    }
    setSearching(true);
    try {
      const results = await permissionsApi.searchShareUsers(value);
      setUsers(results);
    } catch (error) {
      console.error(error);
    } finally {
      setSearching(false);
    }
  };

  const handleShare = async () => {
    if (!selectedUser) {
      message.error(t('shares.select_user_required'));
      return;
    }

    setLoading(true);
    try {
      const promises = resourceIds.map(id => 
        sharesApi.share({
          resource_type: resourceType,
          resource_id: id,
          shared_with_username: selectedUser,
          permission,
          expires_at: expiresAt ? expiresAt.format('YYYY-MM-DD HH:mm:ss') : undefined
        })
      );
      
      await Promise.all(promises);
      message.success(t('shares.share_success'));
      onSuccess();
      onCancel();
    } catch (error: any) {
      const data = error?.response?.data;
      const isTimeout =
        error?.code === 'ECONNABORTED' ||
        (typeof error?.message === 'string' && error.message.toLowerCase().includes('timeout'));
      const serverMsg =
        (typeof data?.message === 'string' && data.message) ||
        (typeof data?.error === 'string' && data.error) ||
        (typeof data?.detail === 'string' && data.detail) ||
        (typeof data?.detail === 'object' && data.detail && JSON.stringify(data.detail)) ||
        (typeof error?.message === 'string' && error.message);
      message.error((isTimeout ? '请求超时，请检查后端服务或网络连接' : serverMsg) || t('shares.share_failed'));
    } finally {
      setLoading(false);
    }
  };

  return (
    <Modal
      title={t('shares.share_resource')}
      open={visible}
      onCancel={onCancel}
      onOk={handleShare}
      confirmLoading={loading}
    >
      <div className="space-y-4">
        <div>
          <label className="block text-sm font-medium text-ink-secondary mb-1">{t('shares.select_user')}</label>
          <Select
            showSearch
            value={selectedUser || undefined}
            placeholder={t('shares.search_user_placeholder')}
            defaultActiveFirstOption={false}
            showArrow={false}
            filterOption={false}
            onSearch={handleSearch}
            onChange={setSelectedUser}
            notFoundContent={null}
            loading={searching}
            style={{ width: '100%' }}
          >
            {users.map((user: any) => (
              <Select.Option key={user.username} value={user.username}>
                <div className="flex items-center">
                  <User className="w-4 h-4 mr-2" />
                  <span>{user.first_name} {user.last_name} ({user.username})</span>
                </div>
              </Select.Option>
            ))}
          </Select>
        </div>

        <div>
          <label className="block text-sm font-medium text-ink-secondary mb-1">{t('shares.permission')}</label>
          <Radio.Group value={permission} onChange={e => setPermission(e.target.value)}>
            <Radio value="view">{t('shares.perm_view')}</Radio>
            <Radio value="edit">{t('shares.perm_edit')}</Radio>
            <Radio value="manage">{t('shares.perm_manage')}</Radio>
          </Radio.Group>
        </div>

        <div>
          <label className="block text-sm font-medium text-ink-secondary mb-1">{t('shares.expires_at')}</label>
          <DatePicker 
            style={{ width: '100%' }} 
            value={expiresAt}
            onChange={setExpiresAt}
            placeholder={t('shares.expires_at_placeholder')}
            showTime
          />
        </div>
      </div>
    </Modal>
  );
};

export default ShareModal;
