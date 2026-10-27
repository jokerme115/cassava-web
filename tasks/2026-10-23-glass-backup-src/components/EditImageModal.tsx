import React, { useState, useRef } from 'react';
import { X, Save, Undo, Redo, Edit } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Image } from '../types';

interface EditImageModalProps {
  image: Image;
  onClose: () => void;
  onSave: (id: string, data: any) => Promise<void>;
}

interface EditorState {
  name: string;
  description: string;
  captureTime: string;
}

export const EditImageModal: React.FC<EditImageModalProps> = ({ image, onClose, onSave }) => {
  const { t } = useTranslation();
  const [name, setName] = useState(image.name);
  const [description, setDescription] = useState(image.description || '');
  const [captureTime, setCaptureTime] = useState(image.capture_time || '');
  const [loading, setLoading] = useState(false);

  // Undo/Redo History
  const [history, setHistory] = useState<EditorState[]>([]);
  const [future, setFuture] = useState<EditorState[]>([]);
  
  // Ref to track value on focus
  // Removed duplicate declaration of focusValueRef

  const getCurrentState = (): EditorState => ({
    name,
    description,
    captureTime
  });

  const handleUndo = () => {
    if (history.length === 0) return;
    const previous = history[history.length - 1];
    const newHistory = history.slice(0, history.length - 1);
    
    // Save current to future
    setFuture(prev => [getCurrentState(), ...prev]);
    
    // Apply previous
    setName(previous.name);
    setDescription(previous.description);
    setCaptureTime(previous.captureTime);
    
    setHistory(newHistory);
  };

  const handleRedo = () => {
    if (future.length === 0) return;
    const next = future[0];
    const newFuture = future.slice(1);
    
    // Save current to history
    setHistory(prev => [...prev, getCurrentState()]);
    
    // Apply next
    setName(next.name);
    setDescription(next.description);
    setCaptureTime(next.captureTime);
    
    setFuture(newFuture);
  };

  // Ref to track value on focus
  const focusValueRef = useRef<string>('');

  const tempStateRef = useRef<EditorState | null>(null);

  const onInputFocus = () => {
    tempStateRef.current = getCurrentState();
  };

  const onInputBlur = (newValue: string, oldValue: string) => {
    if (newValue !== oldValue && tempStateRef.current) {
      setHistory(prev => [...prev, tempStateRef.current!]);
      setFuture([]);
      tempStateRef.current = null;
    }
  };

  const handleSave = async () => {
    setLoading(true);
    try {
      await onSave(image.id, {
        name,
        description,
        capture_time: captureTime || null
      });
      onClose();
    } catch (error) {
      console.error('Failed to save image', error);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center p-4 z-50 backdrop-blur-sm">
      <div className="glass-panel-strong rounded-xl shadow-2xl w-full max-w-lg overflow-hidden animate-fade-in-up">
        <div className="p-6 border-b border-gray-100 flex justify-between items-center bg-gradient-to-r from-green-50 to-blue-50">
          <h3 className="text-xl font-bold text-gray-800 flex items-center">
            <Edit className="w-5 h-5 mr-2 text-green-600" />
            {t('images.edit_image')}
          </h3>
          <div className="flex items-center space-x-2">
            <button 
              onClick={handleUndo} 
              disabled={history.length === 0}
              className="p-2 hover:bg-white/50 rounded-full transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
              title={t('common.undo')}
            >
              <Undo className="w-5 h-5 text-gray-600" />
            </button>
            <button 
              onClick={handleRedo} 
              disabled={future.length === 0}
              className="p-2 hover:bg-white/50 rounded-full transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
              title={t('common.redo')}
            >
              <Redo className="w-5 h-5 text-gray-600" />
            </button>
            <div className="w-px h-6 bg-gray-300 mx-2"></div>
            <button onClick={onClose} className="p-2 hover:bg-white/50 rounded-full transition-colors">
              <X className="w-5 h-5 text-gray-500" />
            </button>
          </div>
        </div>
        
        <div className="p-6 space-y-6 max-h-[70vh] overflow-y-auto">
            {/* Image Preview */}
            <div className="flex justify-center">
                <img
                  src={image.image_url || image.preview_url || image.url}
                  alt={image.name}
                  className="h-48 object-contain rounded-lg shadow-md"
                />
            </div>

          {/* Name */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">{t('images.name')}</label>
            <input
              type="text"
              value={name}
              onFocus={(e) => {
                onInputFocus();
                focusValueRef.current = e.target.value;
              }}
              onBlur={(e) => onInputBlur(e.target.value, focusValueRef.current)}
              onChange={(e) => setName(e.target.value)}
              className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-green-500 focus:border-transparent transition-all"
            />
          </div>

          {/* Description */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">{t('images.description')}</label>
            <textarea
              value={description}
              onFocus={(e) => {
                onInputFocus();
                focusValueRef.current = e.target.value;
              }}
              onBlur={(e) => onInputBlur(e.target.value, focusValueRef.current)}
              onChange={(e) => setDescription(e.target.value)}
              rows={3}
              className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-green-500 focus:border-transparent transition-all"
            />
          </div>

          {/* Capture Time */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">{t('images.capture_time')}</label>
            <input
              type="datetime-local"
              value={captureTime ? new Date(captureTime).toISOString().slice(0, 16) : ''}
              onFocus={(e) => {
                onInputFocus();
                focusValueRef.current = e.target.value;
              }}
              onBlur={(e) => onInputBlur(e.target.value, focusValueRef.current)}
              onChange={(e) => setCaptureTime(e.target.value)}
              className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-green-500 focus:border-transparent transition-all"
            />
          </div>
        </div>

        <div className="p-6 border-t border-gray-100 bg-gray-50 flex justify-end space-x-3">
          <button
            onClick={onClose}
            className="px-4 py-2 text-gray-700 bg-white border border-gray-300 rounded-lg hover:bg-gray-50 transition-all shadow-sm"
          >
            {t('common.cancel')}
          </button>
          <button
            onClick={handleSave}
            disabled={loading}
            className="px-4 py-2 text-white bg-gradient-to-r from-green-500 to-green-600 rounded-lg hover:from-green-600 hover:to-green-700 transition-all shadow-md flex items-center disabled:opacity-50"
          >
            <Save className="w-4 h-4 mr-2" />
            {loading ? t('common.saving') : t('common.save')}
          </button>
        </div>
      </div>
    </div>
  );
};
