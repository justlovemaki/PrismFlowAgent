import React from 'react';
import { NavLink, useNavigate } from 'react-router-dom';
import { useTheme } from '../../context/ThemeContext';
import { useAuth } from '../../context/AuthContext';

interface SidebarProps {
  onMobileClose?: () => void;
}

const Sidebar: React.FC<SidebarProps> = ({ onMobileClose }) => {
  const { theme, toggleTheme } = useTheme();
  const { logout } = useAuth();
  const navigate = useNavigate();

  const handleLogout = () => {
    logout();
    navigate('/login');
    if (onMobileClose) onMobileClose();
  };

  const handleNavClick = () => {
    if (onMobileClose) onMobileClose();
  };

  const navItems = [
    { name: '仪表盘', icon: 'dashboard', path: '/' },
    { name: '内容筛选', icon: 'filter_list', path: '/selection' },
    { name: '生成预览', icon: 'auto_awesome', path: '/generation' },
    { name: '智能体', icon: 'smart_toy', path: '/agents' },
    { name: '历史存档', icon: 'history', path: '/history' },
    { name: '插件管理', icon: 'extension', path: '/plugins' },
    { name: '任务管理', icon: 'schedule', path: '/tasks' },
    { name: '系统设置', icon: 'settings', path: '/settings' },
  ];

  return (
    <aside className="w-64 flex-shrink-0 border-r border-slate-200 dark:border-white/5 bg-white dark:bg-background-dark flex flex-col h-screen transition-colors">
      <div className="p-6 pb-2">
        <div className="flex items-center gap-3 mb-8">
          <div className="flex items-center justify-center w-10 h-10 rounded-xl bg-gradient-to-br from-primary to-blue-600 text-white shadow-lg shadow-primary/20">
            <span className="material-symbols-outlined text-2xl">auto_awesome</span>
          </div>
          <div className="flex flex-col">
            <h1 className="text-slate-900 dark:text-white text-base font-bold leading-tight tracking-tight">流光 PrismFlowAgent</h1>
            <p className="text-slate-500 dark:text-slate-400 text-xs font-normal">高效生产，流光溢彩</p>
          </div>
        </div>

        <nav className="flex flex-col gap-2">
          {navItems.map((item) => (
            <NavLink
              key={item.path}
              to={item.path}
              onClick={handleNavClick}
              className={({ isActive }) =>
                `flex items-center gap-3 px-3 py-2.5 rounded-lg transition-colors group ${
                  isActive
                    ? 'bg-primary/10 dark:bg-surface-dark-lighter text-primary dark:text-white shadow-sm border border-primary/20 dark:border-border-dark/50'
                    : 'text-slate-600 dark:text-text-secondary hover:text-primary dark:hover:text-white hover:bg-slate-100 dark:hover:bg-surface-dark/50'
                }`
              }
            >
              <span className={`material-symbols-outlined group-hover:text-primary transition-colors`}>
                {item.icon}
              </span>
              <span className="text-sm font-medium">{item.name}</span>
            </NavLink>
          ))}
        </nav>
      </div>

      <div className="mt-auto p-6 border-t border-slate-200 dark:border-white/5">
        <button 
          onClick={toggleTheme}
          className="flex items-center gap-3 p-2 w-full rounded-lg hover:bg-slate-100 dark:hover:bg-white/5 cursor-pointer transition-colors text-slate-600 dark:text-text-secondary hover:text-primary dark:hover:text-white mb-2"
        >
          <span className="material-symbols-outlined">
            {theme === 'dark' ? 'light_mode' : 'dark_mode'}
          </span>
          <span className="text-sm font-medium">{theme === 'dark' ? '切换浅色' : '切换深色'}</span>
        </button>

        <button 
          onClick={handleLogout}
          className="flex items-center gap-3 p-2 w-full rounded-lg hover:bg-red-50 dark:hover:bg-red-500/10 cursor-pointer transition-colors text-slate-600 dark:text-text-secondary hover:text-red-600 dark:hover:text-red-400"
        >
          <span className="material-symbols-outlined">
            logout
          </span>
          <span className="text-sm font-medium">退出登录</span>
        </button>
      </div>
    </aside>
  );
};

export default Sidebar;
