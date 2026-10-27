import React from 'react';
import { 
  Image, 
  Brain, 
  Activity, 
  BarChart3, 
  Wifi,
  Menu,
  X
} from 'lucide-react';
import { useTranslation } from 'react-i18next';

interface AppSidebarProps {
  activeSection: string;
  onSectionChange: (section: string) => void;
  collapsed: boolean;
  onToggle: () => void;
}

const AppSidebar: React.FC<AppSidebarProps> = ({
  activeSection,
  onSectionChange,
  collapsed,
  onToggle
}) => {
  const { t } = useTranslation();
  const menuItems = [
    { id: 'images', label: t('navigation.images'), icon: Image },
    { id: 'prediction', label: t('navigation.prediction'), icon: Brain },
    { id: 'tasks', label: t('navigation.tasks'), icon: Activity },
    { id: 'results', label: t('navigation.results'), icon: BarChart3 },
    { id: 'connection', label: t('navigation.connection'), icon: Wifi },
  ];

  return (
    <>
      {/* Mobile Overlay */}
      {!collapsed && (
        <div 
          className="fixed inset-0 bg-black bg-opacity-50 z-40 lg:hidden"
          onClick={onToggle}
        />
      )}
      
      {/* Sidebar */}
      <div className={`
        fixed left-0 top-0 h-full bg-white shadow-lg transition-transform duration-300 z-50
        ${collapsed ? '-translate-x-full' : 'translate-x-0'}
        lg:relative lg:translate-x-0 lg:shadow-none lg:border-r lg:border-gray-200
        ${collapsed ? 'lg:w-16' : 'lg:w-64'}
        w-64
      `}>
        {/* Header */}
        <div className="h-16 flex items-center justify-between px-4 border-b border-gray-200">
          {!collapsed && (
            <div className="flex items-center space-x-2 min-w-0">
              <div className="w-8 h-8 bg-gradient-to-br from-green-500 to-green-600 rounded-lg flex items-center justify-center flex-shrink-0">
                <Image className="w-4 h-4 text-white" />
              </div>
              <span className="font-semibold text-gray-800 truncate">{t('system.title')}</span>
            </div>
          )}
          <button
            onClick={onToggle}
            className="p-2 hover:bg-gray-100 rounded-lg transition-colors lg:hidden"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Navigation */}
        <nav className="mt-4 px-2">
          {menuItems.map((item) => {
            const Icon = item.icon;
            const isActive = activeSection === item.id;
            
            return (
              <button
                key={item.id}
                onClick={() => {
                  onSectionChange(item.id);
                  // Auto collapse on mobile after selection
                  if (window.innerWidth < 1024) {
                    onToggle();
                  }
                }}
                className={`
                  w-full flex items-center px-3 py-2 rounded-lg transition-all duration-200 mb-1
                  ${isActive 
                    ? 'bg-green-50 text-green-700 border-r-2 border-green-500' 
                    : 'text-gray-600 hover:bg-gray-50 hover:text-gray-900'
                  }
                `}
              >
                <Icon className={`w-5 h-5 ${collapsed ? 'mx-auto' : 'mr-3 flex-shrink-0'}`} />
                {!collapsed && (
                  <span className="font-medium truncate">{item.label}</span>
                )}
              </button>
            );
          })}
        </nav>

        {/* Collapse Toggle (Desktop only) */}
        <div className="absolute bottom-4 left-2 right-2 hidden lg:block">
          <button
            onClick={onToggle}
            className="w-full p-2 text-gray-500 hover:text-gray-700 hover:bg-gray-50 rounded-lg transition-colors flex items-center justify-center"
          >
            <Menu className="w-5 h-5" />
          </button>
        </div>
      </div>
    </>
  );
};

export default AppSidebar;
