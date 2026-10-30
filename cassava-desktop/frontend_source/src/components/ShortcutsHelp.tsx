import React from 'react';
import { useTranslation } from 'react-i18next';
import { X, Keyboard } from 'lucide-react';
import { KEYBOARD_SHORTCUTS } from '../hooks/useKeyboardShortcuts';

interface ShortcutsHelpProps {
  isOpen: boolean;
  onClose: () => void;
}

const ShortcutsHelp: React.FC<ShortcutsHelpProps> = ({ isOpen, onClose }) => {
  const { t } = useTranslation();

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div
        className="absolute inset-0 bg-black/50 backdrop-blur-sm"
        onClick={onClose}
      />
      <div className="relative z-10 w-full max-w-md rounded-[32px] border border-white/80 bg-white/95 p-6 shadow-[0_32px_120px_rgba(15,23,42,0.25)] dark:border-slate-700/80 dark:bg-slate-800/95 dark:shadow-[0_32px_120px_rgba(0,0,0,0.5)]">
        <div className="mb-6 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-2xl bg-slate-100 text-slate-700 dark:bg-slate-700 dark:text-slate-300">
              <Keyboard className="h-5 w-5" />
            </div>
            <h2 className="text-xl font-semibold text-slate-900 dark:text-white">
              {t('shortcuts.keyboardShortcuts')}
            </h2>
          </div>
          <button
            onClick={onClose}
            className="flex h-8 w-8 items-center justify-center rounded-full text-slate-500 transition hover:bg-slate-100 hover:text-slate-700 dark:text-slate-400 dark:hover:bg-slate-700 dark:hover:text-slate-200"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="space-y-2">
          {KEYBOARD_SHORTCUTS.map((shortcut) => (
            <div
              key={shortcut.key}
              className="flex items-center justify-between rounded-xl bg-slate-50 px-4 py-3 dark:bg-slate-700/50"
            >
              <span className="text-sm text-slate-600 dark:text-slate-400">
                {shortcut.action}
              </span>
              <kbd className="rounded-lg bg-white px-2 py-1 text-xs font-medium text-slate-700 shadow-sm ring-1 ring-slate-200 dark:bg-slate-600 dark:text-slate-200 dark:ring-slate-600">
                {shortcut.key}
              </kbd>
            </div>
          ))}
        </div>

        <p className="mt-4 text-center text-xs text-slate-500 dark:text-slate-400">
          {t('shortcuts.pressEscToClose')}
        </p>
      </div>
    </div>
  );
};

export default ShortcutsHelp;