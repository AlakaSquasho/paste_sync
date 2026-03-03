import { useState, useEffect, useCallback } from 'react';
import { useDropzone } from 'react-dropzone';
import toast from 'react-hot-toast';
import { formatDistanceToNow } from 'date-fns';
import api from '../api';
import { useTranslation } from 'react-i18next'; // 引入 useTranslation

interface FileMetadata {
  id: string;
  originalName: string;
  size: number;
  createdAt: string;
}

interface FileSectionProps {
  refreshKey: number;
}

export default function FileSection({ refreshKey }: FileSectionProps) {
  const [files, setFiles] = useState<FileMetadata[]>([]);
  const [isUploading, setIsUploading] = useState(false);
  const { t } = useTranslation(); // 初始化 useTranslation

  useEffect(() => {
    fetchFiles();
  }, [refreshKey]); // Depend on refreshKey

  const fetchFiles = async () => {
    try {
      const { data } = await api.get('/files');
      setFiles(data);
    } catch (error) {
      toast.error(t('file_section.error_fetch_list'));
    }
  };

  const onDrop = useCallback(async (acceptedFiles: File[]) => {
    setIsUploading(true);
    try {
      for (const file of acceptedFiles) {
        const formData = new FormData();
        formData.append('file', file);
        await api.post('/files/upload', formData, {
          headers: { 'Content-Type': 'multipart/form-data' },
        });
      }
      toast.success(t('file_section.success_upload'));
      fetchFiles();
    } catch (error) {
      toast.error(t('file_section.error_upload'));
    } finally {
      setIsUploading(false);
    }
  }, [t]); // Add t to dependency array for useCallback

  const { getRootProps, getInputProps, isDragActive } = useDropzone({ onDrop });

  const handleDownload = async (file: FileMetadata) => {
    try {
      const response = await api.get(`/files/${file.id}`, { responseType: 'blob' });
      const url = window.URL.createObjectURL(new Blob([response.data]));
      const link = document.createElement('a');
      link.href = url;
      link.setAttribute('download', file.originalName);
      document.body.appendChild(link);
      link.click();
      link.remove();
      toast.success(t('file_section.success_download'));
    } catch (error) {
      toast.error(t('file_section.error_download'));
    }
  };

  const handleDelete = async (id: string) => {
    if (!confirm(t('file_section.confirm_delete'))) return;
    try {
      await api.delete(`/files/${id}`);
      toast.success(t('file_section.success_delete'));
      setFiles(files.filter((f) => f.id !== id));
    } catch (error) {
      toast.error(t('file_section.error_delete'));
    }
  };

  return (
    <div className="mt-8">
      <div
        {...getRootProps()}
        className={`border-2 border-dashed rounded-lg p-6 text-center cursor-pointer transition-colors duration-200 sm:p-12 ${
          isDragActive
            ? 'border-indigo-500 bg-indigo-50 dark:bg-indigo-900/20'
            : 'border-gray-300 hover:border-gray-400 dark:border-gray-700 dark:hover:border-gray-600'
        }`}
      >
        <input {...getInputProps()} />
        {isUploading ? (
          <p className="text-indigo-600 dark:text-indigo-400 font-medium">{t('file_section.uploading_text')}</p>
        ) : (
          <div>
            <p className="text-gray-600 dark:text-gray-300">{t('file_section.drag_drop_text')}</p>
            <p className="text-sm text-gray-400 dark:text-gray-500 mt-2">{t('file_section.file_type_hint')}</p>
          </div>
        )}
      </div>

      <div className="mt-8">
        <div className="space-y-3 sm:hidden">
          {files.length === 0 && (
            <div className="rounded-lg border border-dashed border-gray-200 p-6 text-center text-sm text-gray-500 dark:border-gray-700 dark:text-gray-400">
              {t('file_section.no_files_uploaded')}
            </div>
          )}
          {files.map((file) => (
            <div key={file.id} className="rounded-lg bg-white p-4 shadow-sm ring-1 ring-black/5 dark:bg-gray-800 dark:ring-white/10">
              <div className="text-sm font-semibold text-gray-900 dark:text-gray-100">{file.originalName}</div>
              <div className="mt-1 text-xs text-gray-500 dark:text-gray-400">
                {(file.size / 1024 / 1024).toFixed(2)} MB · {formatDistanceToNow(new Date(file.createdAt))} ago
              </div>
              <div className="mt-3 grid grid-cols-2 gap-3">
                <button
                  onClick={() => handleDownload(file)}
                  className="w-full rounded-md border border-indigo-200 px-3 py-2 text-sm font-semibold text-indigo-700 transition-colors hover:bg-indigo-50 dark:border-indigo-500/40 dark:text-indigo-300 dark:hover:bg-indigo-500/10"
                >
                  {t('file_section.download_button')}
                </button>
                <button
                  onClick={() => handleDelete(file.id)}
                  className="w-full rounded-md border border-red-200 px-3 py-2 text-sm font-semibold text-red-700 transition-colors hover:bg-red-50 dark:border-red-500/40 dark:text-red-300 dark:hover:bg-red-500/10"
                >
                  {t('file_section.delete_button')}
                </button>
              </div>
            </div>
          ))}
        </div>
        <div className="hidden sm:block">
          <div className="-mx-4 -my-2 overflow-x-auto sm:-mx-6 lg:-mx-8">
            <div className="inline-block min-w-full py-2 align-middle sm:px-6 lg:px-8">
              <div className="overflow-hidden shadow ring-1 ring-black ring-opacity-5 sm:rounded-lg dark:ring-white/10">
                <table className="min-w-full divide-y divide-gray-300 dark:divide-gray-700">
                  <thead className="bg-gray-50 dark:bg-gray-800/50">
                    <tr>
                      <th scope="col" className="py-3.5 pl-4 pr-3 text-left text-sm font-semibold text-gray-900 dark:text-white sm:pl-6">
                        {t('file_section.table_header_name')}
                      </th>
                      <th scope="col" className="px-3 py-3.5 text-left text-sm font-semibold text-gray-900 dark:text-white">
                        {t('file_section.table_header_size')}
                      </th>
                      <th scope="col" className="px-3 py-3.5 text-left text-sm font-semibold text-gray-900 dark:text-white">
                        {t('file_section.table_header_uploaded')}
                      </th>
                      <th scope="col" className="relative py-3.5 pl-3 pr-4 sm:pr-6">
                        <span className="sr-only">Actions</span>
                      </th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-200 bg-white dark:divide-gray-700 dark:bg-gray-800">
                    {files.length === 0 && (
                      <tr>
                        <td colSpan={4} className="py-4 text-center text-sm text-gray-500 dark:text-gray-400">
                          {t('file_section.no_files_uploaded')}
                        </td>
                      </tr>
                    )}
                    {files.map((file) => (
                      <tr key={file.id} className="hover:bg-gray-50 dark:hover:bg-gray-700/50 transition-colors">
                        <td className="whitespace-nowrap py-4 pl-4 pr-3 text-sm font-medium text-gray-900 dark:text-gray-200 sm:pl-6">
                          {file.originalName}
                        </td>
                        <td className="whitespace-nowrap px-3 py-4 text-sm text-gray-500 dark:text-gray-400">
                          {(file.size / 1024 / 1024).toFixed(2)} MB
                        </td>
                        <td className="whitespace-nowrap px-3 py-4 text-sm text-gray-500 dark:text-gray-400">
                          {formatDistanceToNow(new Date(file.createdAt))} ago
                        </td>
                        <td className="relative whitespace-nowrap py-4 pl-3 pr-4 text-right text-sm font-medium sm:pr-6">
                          <button
                            onClick={() => handleDownload(file)}
                            className="text-indigo-600 hover:text-indigo-900 dark:text-indigo-400 dark:hover:text-indigo-300 mr-4"
                          >
                            {t('file_section.download_button')}
                          </button>
                          <button
                            onClick={() => handleDelete(file.id)}
                            className="text-red-600 hover:text-red-900 dark:text-red-400 dark:hover:text-red-300"
                          >
                            {t('file_section.delete_button')}
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

