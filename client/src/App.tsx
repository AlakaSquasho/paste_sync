import { BrowserRouter, Routes, Route, useNavigate } from 'react-router-dom';
import { Toaster } from 'react-hot-toast';
import AuthGuard from './components/AuthGuard';
import LoginPage from './components/LoginPage';
import ClipboardSection from './components/ClipboardSection';
import FileSection from './components/FileSection';
import { useState, useCallback } from 'react';
import { useTheme, Theme } from './hooks/useTheme';
import { SunIcon, MoonIcon, ComputerDesktopIcon, ArrowPathIcon } from '@heroicons/react/24/outline';
import { useTranslation } from 'react-i18next'; // 引入 useTranslation

function Dashboard() {
  const navigate = useNavigate();
  const [activeTab, setActiveTab] = useState<'clipboard' | 'files'>('clipboard');
  const { theme, setTheme } = useTheme();
  const [refreshKey, setRefreshKey] = useState(0);
  const { t, i18n } = useTranslation(); // 初始化 useTranslation

  const handleLogout = () => {
    localStorage.removeItem('token');
    navigate('/login');
  };

  const handleRefresh = useCallback(() => {
    setRefreshKey(prevKey => prevKey + 1);
  }, []);

  // 添加语言切换功能
  const changeLanguage = (lng: string) => {
    i18n.changeLanguage(lng);
  };

  const themeIcons = {
    light: <SunIcon className="h-5 w-5" />,
    dark: <MoonIcon className="h-5 w-5" />,
    system: <ComputerDesktopIcon className="h-5 w-5" />,
  };

  const nextTheme: Record<Theme, Theme> = {
    light: 'dark',
    dark: 'system',
    system: 'light',
  };

  return (
    <div className="min-h-screen bg-gray-100 transition-colors duration-200 dark:bg-gray-900">
      <nav className="bg-white shadow-sm transition-colors duration-200 dark:bg-gray-800 dark:border-gray-700">
        <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
          <div className="flex h-16 justify-between">
            <div className="flex">
              <div className="flex flex-shrink-0 items-center">
                <h1 className="text-xl font-bold text-indigo-600 dark:text-indigo-400">{t('app_name')}</h1>
              </div>
              <div className="hidden sm:ml-6 sm:flex sm:space-x-8">
                <button
                  onClick={() => setActiveTab('clipboard')}
                  className={`${
                    activeTab === 'clipboard'
                      ? 'border-indigo-500 text-gray-900 dark:text-white dark:border-indigo-400'
                      : 'border-transparent text-gray-500 hover:border-gray-300 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200'
                  } inline-flex items-center border-b-2 px-1 pt-1 text-sm font-medium transition-colors`}
                >
                  {t('dashboard.clipboard_tab')}
                </button>
                <button
                  onClick={() => setActiveTab('files')}
                  className={`${
                    activeTab === 'files'
                      ? 'border-indigo-500 text-gray-900 dark:text-white dark:border-indigo-400'
                      : 'border-transparent text-gray-500 hover:border-gray-300 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200'
                  } inline-flex items-center border-b-2 px-1 pt-1 text-sm font-medium transition-colors`}
                >
                  {t('dashboard.files_tab')}
                </button>
              </div>
            </div>
            <div className="flex items-center space-x-4">
              {/* Language Switcher */}
              <select
                onChange={(e) => changeLanguage(e.target.value)}
                value={i18n.language}
                className="rounded-md border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-800 text-gray-900 dark:text-white text-sm focus:ring-indigo-500 focus:border-indigo-500"
              >
                <option value="en">English</option>
                <option value="zh">中文</option>
              </select>

              <button
                onClick={handleRefresh}
                className="p-2 rounded-full text-gray-500 hover:bg-gray-100 dark:text-gray-400 dark:hover:bg-gray-700 transition-colors"
                title={t('dashboard.refresh_button')}
              >
                <ArrowPathIcon className="h-5 w-5" />
              </button>
              <button
                onClick={() => setTheme(nextTheme[theme])}
                className="p-2 rounded-full text-gray-500 hover:bg-gray-100 dark:text-gray-400 dark:hover:bg-gray-700 transition-colors"
                title={`${t('dashboard.theme_mode.' + theme)} mode`}
              >
                {themeIcons[theme]}
              </button>
              <button
                onClick={handleLogout}
                className="rounded-md bg-white px-3 py-2 text-sm font-semibold text-gray-900 shadow-sm ring-1 ring-inset ring-gray-300 hover:bg-gray-50 dark:bg-gray-700 dark:text-white dark:ring-gray-600 dark:hover:bg-gray-600 transition-colors"
              >
                {t('dashboard.logout_button')}
              </button>
            </div>
          </div>
        </div>
      </nav>

      <div className="py-10">
        <main>
          <div className="mx-auto max-w-7xl sm:px-6 lg:px-8">
            {activeTab === 'clipboard' ? <ClipboardSection refreshKey={refreshKey} /> : <FileSection refreshKey={refreshKey} />}
          </div>
        </main>
      </div>
    </div>
  );
}

export default function App() {
  useTheme(); // Initialize theme logic at root level
  return (
    <BrowserRouter>
      <Toaster position="top-right" />
      <Routes>
        <Route path="/login" element={<LoginPage />} />
        <Route
          path="/"
          element={
            <AuthGuard>
              <Dashboard />
            </AuthGuard>
          }
        />
      </Routes>
    </BrowserRouter>
  );
}
