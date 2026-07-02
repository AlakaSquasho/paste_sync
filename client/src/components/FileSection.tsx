import { useState, useEffect, useCallback, useRef, Fragment, useMemo } from 'react';
import { useDropzone, FileRejection } from 'react-dropzone';
import toast from 'react-hot-toast';
import { formatDistanceToNow } from 'date-fns';
import axios from 'axios';
import api from '../api';
import { useTranslation } from 'react-i18next';

interface FileMetadata {
  id: string;
  originalName: string;
  size: number;
  createdAt: string;
  mimetype?: string | null;
}

export interface FileTransferSummary {
  activeCount: number;
  uploadCount: number;
  downloadCount: number;
  loadedBytes: number;
  totalBytes: number;
  percent: number;
}

interface FileSectionProps {
  refreshKey: number;
  onTransferSummaryChange?: (summary: FileTransferSummary | null) => void;
}

interface FileUploadConfig {
  maxUploadSizeMb: number;
  maxUploadSizeBytes: number;
}

type TransferStatus = 'queued' | 'running' | 'success' | 'error' | 'cancelled';

interface BaseTransfer {
  id: string;
  name: string;
  size: number;
  loadedBytes: number;
  status: TransferStatus;
  errorMessage?: string;
}

interface UploadTransfer extends BaseTransfer {
  kind: 'upload';
  file: File;
}

interface DownloadTransfer extends BaseTransfer {
  kind: 'download';
  fileId: string;
}

const DEFAULT_FILE_UPLOAD_CONFIG: FileUploadConfig = {
  maxUploadSizeMb: 200,
  maxUploadSizeBytes: 200 * 1024 * 1024,
};

const isTransferActive = (status: TransferStatus) => status === 'queued' || status === 'running';

const formatBytes = (bytes: number) => {
  if (bytes < 1024) return `${bytes} B`;
  const units = ['KB', 'MB', 'GB', 'TB'];
  let value = bytes;
  let unitIndex = -1;

  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024;
    unitIndex += 1;
  }

  return `${value.toFixed(value >= 10 || unitIndex === 0 ? 0 : 1)} ${units[unitIndex]}`;
};

const getTransferPercent = (transfer: BaseTransfer) => {
  if (transfer.size <= 0) return 0;
  return Math.max(0, Math.min(100, (transfer.loadedBytes / transfer.size) * 100));
};

export default function FileSection({ refreshKey, onTransferSummaryChange }: FileSectionProps) {
  const [files, setFiles] = useState<FileMetadata[]>([]);
  const [uploadConfig, setUploadConfig] = useState<FileUploadConfig>(DEFAULT_FILE_UPLOAD_CONFIG);
  const [previewUrls, setPreviewUrls] = useState<Record<string, string>>({});
  const [previewLoading, setPreviewLoading] = useState<Record<string, boolean>>({});
  const [uploadTransfers, setUploadTransfers] = useState<UploadTransfer[]>([]);
  const [downloadTransfers, setDownloadTransfers] = useState<Record<string, DownloadTransfer>>({});
  const { t } = useTranslation();
  const previewUrlsRef = useRef(previewUrls);
  const uploadTransfersRef = useRef(uploadTransfers);
  const downloadTransfersRef = useRef(downloadTransfers);
  const controllersRef = useRef<Record<string, AbortController>>({});
  const cleanupTimersRef = useRef<Record<string, number>>({});
  const uploadProcessorRunningRef = useRef(false);
  const transferIdCounterRef = useRef(0);
  const processUploadQueueRef = useRef<() => Promise<void>>(async () => {});

  useEffect(() => {
    previewUrlsRef.current = previewUrls;
  }, [previewUrls]);

  useEffect(() => {
    uploadTransfersRef.current = uploadTransfers;
  }, [uploadTransfers]);

  useEffect(() => {
    downloadTransfersRef.current = downloadTransfers;
  }, [downloadTransfers]);

  const clearCleanupTimer = useCallback((key: string) => {
    const timerId = cleanupTimersRef.current[key];
    if (timerId !== undefined) {
      window.clearTimeout(timerId);
      delete cleanupTimersRef.current[key];
    }
  }, []);

  const scheduleUploadTransferCleanup = useCallback((transferId: string, delayMs: number) => {
    const timerKey = `upload:${transferId}`;
    clearCleanupTimer(timerKey);
    cleanupTimersRef.current[timerKey] = window.setTimeout(() => {
      setUploadTransfers((prev) => prev.filter((transfer) => transfer.id !== transferId));
      delete cleanupTimersRef.current[timerKey];
    }, delayMs);
  }, [clearCleanupTimer]);

  const scheduleDownloadTransferCleanup = useCallback((fileId: string, delayMs: number) => {
    const timerKey = `download:${fileId}`;
    clearCleanupTimer(timerKey);
    cleanupTimersRef.current[timerKey] = window.setTimeout(() => {
      setDownloadTransfers((prev) => {
        const next = { ...prev };
        delete next[fileId];
        return next;
      });
      delete cleanupTimersRef.current[timerKey];
    }, delayMs);
  }, [clearCleanupTimer]);

  useEffect(() => {
    return () => {
      Object.values(previewUrlsRef.current).forEach((url) => {
        URL.revokeObjectURL(url);
      });
      Object.values(controllersRef.current).forEach((controller) => controller.abort());
      Object.values(cleanupTimersRef.current).forEach((timerId) => window.clearTimeout(timerId));
    };
  }, []);

  const fetchFiles = useCallback(async () => {
    try {
      const { data } = await api.get<FileMetadata[]>('/files');
      setFiles(data);
    } catch {
      toast.error(t('file_section.error_fetch_list'));
    }
  }, [t]);

  useEffect(() => {
    void fetchFiles();
  }, [fetchFiles, refreshKey]);

  useEffect(() => {
    const fileIds = new Set(files.map((file) => file.id));
    setPreviewUrls((prev) => {
      let changed = false;
      const next = { ...prev };
      Object.entries(prev).forEach(([id, url]) => {
        if (!fileIds.has(id)) {
          URL.revokeObjectURL(url);
          delete next[id];
          changed = true;
        }
      });
      return changed ? next : prev;
    });

    setPreviewLoading((prev) => {
      let changed = false;
      const next = { ...prev };
      Object.keys(prev).forEach((id) => {
        if (!fileIds.has(id)) {
          delete next[id];
          changed = true;
        }
      });
      return changed ? next : prev;
    });
  }, [files]);

  const fetchUploadConfig = useCallback(async () => {
    try {
      const { data } = await api.get<FileUploadConfig>('/files/config');
      setUploadConfig(data);
    } catch {
      setUploadConfig(DEFAULT_FILE_UPLOAD_CONFIG);
    }
  }, []);

  useEffect(() => {
    void fetchUploadConfig();
  }, [fetchUploadConfig]);

  const isImageFile = useCallback((file: FileMetadata) => file.mimetype?.startsWith('image/'), []);

  const revokePreviewUrl = useCallback((fileId: string) => {
    setPreviewUrls((prev) => {
      const url = prev[fileId];
      if (!url) return prev;
      URL.revokeObjectURL(url);
      const { [fileId]: _removed, ...rest } = prev;
      return rest;
    });
  }, []);

  const createTransferId = useCallback((prefix: string) => {
    transferIdCounterRef.current += 1;
    return `${prefix}-${Date.now()}-${transferIdCounterRef.current}`;
  }, []);

  const processUploadQueue = useCallback(async () => {
    if (uploadProcessorRunningRef.current) return;

    uploadProcessorRunningRef.current = true;
    let uploadedAny = false;

    try {
      while (true) {
        const nextTransfer = uploadTransfersRef.current.find((transfer) => transfer.status === 'queued');
        if (!nextTransfer) break;

        const controller = new AbortController();
        controllersRef.current[nextTransfer.id] = controller;
        clearCleanupTimer(`upload:${nextTransfer.id}`);

        setUploadTransfers((prev) =>
          prev.map((transfer) =>
            transfer.id === nextTransfer.id
              ? { ...transfer, status: 'running', loadedBytes: 0, errorMessage: undefined }
              : transfer
          )
        );

        const formData = new FormData();
        formData.append('file', nextTransfer.file);

        try {
          await api.post('/files/upload', formData, {
            signal: controller.signal,
            onUploadProgress: (event) => {
              const loadedBytes = Math.min(event.loaded, nextTransfer.size);
              setUploadTransfers((prev) =>
                prev.map((transfer) =>
                  transfer.id === nextTransfer.id
                    ? { ...transfer, loadedBytes }
                    : transfer
                )
              );
            },
          });

          uploadedAny = true;
          delete controllersRef.current[nextTransfer.id];
          setUploadTransfers((prev) =>
            prev.map((transfer) =>
              transfer.id === nextTransfer.id
                ? { ...transfer, status: 'success', loadedBytes: transfer.size }
                : transfer
            )
          );
          scheduleUploadTransferCleanup(nextTransfer.id, 600);
        } catch (error) {
          delete controllersRef.current[nextTransfer.id];

          if (axios.isCancel(error) || (error as { code?: string })?.code === 'ERR_CANCELED') {
            setUploadTransfers((prev) =>
              prev.map((transfer) =>
                transfer.id === nextTransfer.id
                  ? { ...transfer, status: 'cancelled' }
                  : transfer
              )
            );
            scheduleUploadTransferCleanup(nextTransfer.id, 1800);
            continue;
          }

          const errorMessage =
            (error as { response?: { data?: { error?: string } } })?.response?.data?.error ||
            (error as Error)?.message ||
            t('file_section.error_upload');

          setUploadTransfers((prev) =>
            prev.map((transfer) =>
              transfer.id === nextTransfer.id
                ? { ...transfer, status: 'error', errorMessage }
                : transfer
            )
          );
          scheduleUploadTransferCleanup(nextTransfer.id, 4000);
          toast.error(errorMessage);
        }
      }
    } finally {
      uploadProcessorRunningRef.current = false;
      if (uploadedAny) {
        await fetchFiles();
        toast.success(t('file_section.success_upload'));
      }
      if (uploadTransfersRef.current.some((transfer) => transfer.status === 'queued')) {
        void processUploadQueueRef.current();
      }
    }
  }, [clearCleanupTimer, fetchFiles, scheduleUploadTransferCleanup, t]);

  useEffect(() => {
    processUploadQueueRef.current = processUploadQueue;
  }, [processUploadQueue]);

  useEffect(() => {
    if (!uploadProcessorRunningRef.current && uploadTransfers.some((transfer) => transfer.status === 'queued')) {
      void processUploadQueueRef.current();
    }
  }, [uploadTransfers]);

  const onDrop = useCallback((acceptedFiles: File[]) => {
    if (acceptedFiles.length === 0) return;

    const queuedTransfers = acceptedFiles.map<UploadTransfer>((file) => ({
      id: createTransferId('upload'),
      kind: 'upload',
      file,
      name: file.name,
      size: file.size,
      loadedBytes: 0,
      status: 'queued',
    }));

    setUploadTransfers((prev) => [...queuedTransfers, ...prev]);
  }, [createTransferId]);

  const onDropRejected = useCallback((fileRejections: FileRejection[]) => {
    const oversizedFile = fileRejections.find(({ errors }) =>
      errors.some((error) => error.code === 'file-too-large')
    );

    if (oversizedFile) {
      toast.error(
        t('file_section.error_file_too_large', {
          fileName: oversizedFile.file.name,
          maxSize: `${uploadConfig.maxUploadSizeMb}MB`,
        })
      );
      return;
    }

    toast.error(t('file_section.error_upload'));
  }, [t, uploadConfig.maxUploadSizeMb]);

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop,
    onDropRejected,
    maxSize: uploadConfig.maxUploadSizeBytes,
  });

  const handleCancelUpload = useCallback((transferId: string) => {
    clearCleanupTimer(`upload:${transferId}`);
    const transfer = uploadTransfersRef.current.find((item) => item.id === transferId);
    if (!transfer) return;

    if (transfer.status === 'queued') {
      setUploadTransfers((prev) => prev.filter((item) => item.id !== transferId));
      return;
    }

    if (transfer.status === 'running') {
      controllersRef.current[transferId]?.abort();
    }
  }, [clearCleanupTimer]);

  const handleCancelDownload = useCallback((fileId: string) => {
    const transfer = downloadTransfersRef.current[fileId];
    if (!transfer || transfer.status !== 'running') return;
    clearCleanupTimer(`download:${fileId}`);
    controllersRef.current[transfer.id]?.abort();
  }, [clearCleanupTimer]);

  const handleDownload = useCallback(async (file: FileMetadata) => {
    const currentTransfer = downloadTransfersRef.current[file.id];
    if (currentTransfer && isTransferActive(currentTransfer.status)) return;

    const transferId = createTransferId(`download-${file.id}`);
    const controller = new AbortController();
    controllersRef.current[transferId] = controller;
    clearCleanupTimer(`download:${file.id}`);

    setDownloadTransfers((prev) => ({
      ...prev,
      [file.id]: {
        id: transferId,
        kind: 'download',
        fileId: file.id,
        name: file.originalName,
        size: file.size,
        loadedBytes: 0,
        status: 'running',
      },
    }));

    try {
      const response = await api.get<Blob>(`/files/${file.id}`, {
        responseType: 'blob',
        signal: controller.signal,
        onDownloadProgress: (event) => {
          const loadedBytes = Math.min(event.loaded, file.size);
          setDownloadTransfers((prev) => {
            const transfer = prev[file.id];
            if (!transfer || transfer.id !== transferId) return prev;
            return {
              ...prev,
              [file.id]: {
                ...transfer,
                loadedBytes,
              },
            };
          });
        },
      });

      delete controllersRef.current[transferId];
      setDownloadTransfers((prev) => {
        const transfer = prev[file.id];
        if (!transfer || transfer.id !== transferId) return prev;
        return {
          ...prev,
          [file.id]: {
            ...transfer,
            status: 'success',
            loadedBytes: transfer.size,
          },
        };
      });

      const url = window.URL.createObjectURL(response.data);
      const link = document.createElement('a');
      link.href = url;
      link.setAttribute('download', file.originalName);
      document.body.appendChild(link);
      link.click();
      link.remove();
      window.setTimeout(() => URL.revokeObjectURL(url), 1000);

      toast.success(t('file_section.success_download'));
      scheduleDownloadTransferCleanup(file.id, 1800);
    } catch (error) {
      delete controllersRef.current[transferId];

      if (axios.isCancel(error) || (error as { code?: string })?.code === 'ERR_CANCELED') {
        setDownloadTransfers((prev) => {
          const transfer = prev[file.id];
          if (!transfer || transfer.id !== transferId) return prev;
          return {
            ...prev,
            [file.id]: {
              ...transfer,
              status: 'cancelled',
            },
          };
        });
        scheduleDownloadTransferCleanup(file.id, 1800);
        return;
      }

      setDownloadTransfers((prev) => {
        const transfer = prev[file.id];
        if (!transfer || transfer.id !== transferId) return prev;
        return {
          ...prev,
          [file.id]: {
            ...transfer,
            status: 'error',
            errorMessage: t('file_section.error_download'),
          },
        };
      });
      scheduleDownloadTransferCleanup(file.id, 4000);
      toast.error(t('file_section.error_download'));
    }
  }, [clearCleanupTimer, createTransferId, scheduleDownloadTransferCleanup, t]);

  const handlePreview = async (file: FileMetadata) => {
    if (!isImageFile(file)) return;

    const existingPreview = previewUrls[file.id];
    if (existingPreview) {
      revokePreviewUrl(file.id);
      return;
    }

    if (previewLoading[file.id]) return;

    setPreviewLoading((prev) => ({ ...prev, [file.id]: true }));
    try {
      const response = await api.get(`/files/${file.id}`, { responseType: 'blob' });
      const url = window.URL.createObjectURL(new Blob([response.data]));
      setPreviewUrls((prev) => {
        const previousUrl = prev[file.id];
        if (previousUrl) {
          URL.revokeObjectURL(previousUrl);
        }
        return { ...prev, [file.id]: url };
      });
    } catch {
      toast.error(t('file_section.error_preview'));
    } finally {
      setPreviewLoading((prev) => ({ ...prev, [file.id]: false }));
    }
  };

  const handleDelete = async (id: string) => {
    const activeDownload = downloadTransfersRef.current[id];
    if (activeDownload && isTransferActive(activeDownload.status)) return;
    if (!confirm(t('file_section.confirm_delete'))) return;

    try {
      await api.delete(`/files/${id}`);
      toast.success(t('file_section.success_delete'));
      setFiles((prev) => prev.filter((file) => file.id !== id));
      revokePreviewUrl(id);
    } catch {
      toast.error(t('file_section.error_delete'));
    }
  };

  const activeTransfers = useMemo(() => {
    const activeUploads = uploadTransfers.filter((transfer) => isTransferActive(transfer.status));
    const activeDownloads = Object.values(downloadTransfers).filter((transfer) => isTransferActive(transfer.status));
    return [...activeUploads, ...activeDownloads];
  }, [downloadTransfers, uploadTransfers]);

  const activeUploadCount = activeTransfers.filter((transfer) => transfer.kind === 'upload').length;
  const isUploading = activeUploadCount > 0;

  const transferSummary = useMemo<FileTransferSummary | null>(() => {
    if (activeTransfers.length === 0) return null;
    const loadedBytes = activeTransfers.reduce((sum, transfer) => sum + transfer.loadedBytes, 0);
    const totalBytes = activeTransfers.reduce((sum, transfer) => sum + transfer.size, 0);
    const uploadCount = activeTransfers.filter((transfer) => transfer.kind === 'upload').length;
    const downloadCount = activeTransfers.length - uploadCount;

    return {
      activeCount: activeTransfers.length,
      uploadCount,
      downloadCount,
      loadedBytes,
      totalBytes,
      percent: totalBytes > 0 ? Math.round((loadedBytes / totalBytes) * 100) : 0,
    };
  }, [activeTransfers]);

  useEffect(() => {
    onTransferSummaryChange?.(transferSummary);
  }, [onTransferSummaryChange, transferSummary]);

  const getTransferStatusLabel = useCallback((transfer: BaseTransfer & { kind: 'upload' | 'download' }) => {
    if (transfer.status === 'queued') return t('file_section.transfer_status_queued');
    if (transfer.status === 'running') {
      return transfer.kind === 'upload'
        ? t('file_section.transfer_status_uploading')
        : t('file_section.transfer_status_downloading');
    }
    if (transfer.status === 'cancelled') return t('file_section.transfer_status_cancelled');
    if (transfer.status === 'error') return t('file_section.transfer_status_failed');
    return t('file_section.transfer_status_completed');
  }, [t]);

  const renderTransferProgress = useCallback((transfer: BaseTransfer & { kind: 'upload' | 'download' }) => {
    const percent = getTransferPercent(transfer);
    const isRunning = transfer.status === 'running';
    const isCancelled = transfer.status === 'cancelled';
    const isError = transfer.status === 'error';

    return (
      <div className="mt-3 rounded-lg border border-ink/10 bg-ink/5 p-3 dark:border-white/10 dark:bg-white/5">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="text-xs font-semibold text-ink dark:text-gray-100">{getTransferStatusLabel(transfer)}</div>
          <div className="text-xs text-coal dark:text-gray-400">
            {t('file_section.transfer_progress_bytes', {
              loaded: formatBytes(transfer.loadedBytes),
              total: formatBytes(transfer.size),
            })}
          </div>
        </div>
        <div
          className="mt-2 h-2 overflow-hidden rounded-full bg-ink/10 dark:bg-white/10"
          role="progressbar"
          aria-valuenow={Math.round(percent)}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-label={getTransferStatusLabel(transfer)}
        >
          <div
            className={`h-full rounded-full transition-all duration-200 ${
              isError
                ? 'bg-red-500'
                : isCancelled
                ? 'bg-amber-400'
                : isRunning
                ? 'bg-accent'
                : 'bg-emerald-500'
            }`}
            style={{ width: `${percent}%` }}
          />
        </div>
      </div>
    );
  }, [getTransferStatusLabel, t]);

  return (
    <div className="mt-8">
      <div
        {...getRootProps()}
        className={`cursor-pointer rounded-xl border-2 border-dashed p-6 text-center transition-colors duration-200 sm:p-12 ${
          isDragActive
            ? 'border-accent bg-accent/10 dark:bg-accent/10'
            : 'border-ink/20 bg-white/80 hover:border-ink/40 dark:border-white/10 dark:bg-night/60 dark:hover:border-white/30'
        }`}
      >
        <input {...getInputProps()} />
        <div>
          <p className="text-sm font-medium text-coal dark:text-gray-200">{t('file_section.drag_drop_text')}</p>
          <p className="mt-2 text-xs text-coal/70 dark:text-gray-400">{t('file_section.file_type_hint')}</p>
          {isUploading && (
            <p className="mt-3 text-sm font-semibold text-accent">{t('file_section.uploading_text')}</p>
          )}
        </div>
      </div>

      {transferSummary && (
        <div className="mt-4 rounded-xl border border-ink/10 bg-white/90 p-4 shadow-soft dark:border-white/10 dark:bg-night/70">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <div className="text-sm font-semibold text-ink dark:text-white">{t('file_section.transfer_summary_title')}</div>
              <div className="mt-1 text-xs text-coal dark:text-gray-400">
                {t('file_section.transfer_summary_counts', {
                  uploads: transferSummary.uploadCount,
                  downloads: transferSummary.downloadCount,
                })}
              </div>
            </div>
            <div className="text-right text-sm font-semibold text-ink dark:text-white">{transferSummary.percent}%</div>
          </div>
          <div
            className="mt-3 h-2.5 overflow-hidden rounded-full bg-ink/10 dark:bg-white/10"
            role="progressbar"
            aria-valuenow={transferSummary.percent}
            aria-valuemin={0}
            aria-valuemax={100}
            aria-label={t('file_section.transfer_summary_title')}
          >
            <div className="h-full rounded-full bg-accent transition-all duration-200" style={{ width: `${transferSummary.percent}%` }} />
          </div>
          <div className="mt-2 text-xs text-coal dark:text-gray-400">
            {t('file_section.transfer_progress_bytes', {
              loaded: formatBytes(transferSummary.loadedBytes),
              total: formatBytes(transferSummary.totalBytes),
            })}
          </div>
        </div>
      )}

      <div className="mt-8">
        <div className="space-y-3 sm:hidden">
          {uploadTransfers.map((transfer) => (
            <div key={transfer.id} className="rounded-xl border border-ink/10 bg-white/90 p-4 shadow-soft dark:border-white/10 dark:bg-night/70">
              <div className="text-sm font-semibold text-ink dark:text-gray-100">{transfer.name}</div>
              <div className="mt-1 text-xs text-coal dark:text-gray-400">
                {formatBytes(transfer.size)} · {t('file_section.transfer_pending')}
              </div>
              {renderTransferProgress(transfer)}
              {isTransferActive(transfer.status) && (
                <button
                  onClick={(event) => {
                    event.stopPropagation();
                    handleCancelUpload(transfer.id);
                  }}
                  className="mt-3 w-full cursor-pointer rounded-md border border-red-200 px-3 py-2 text-sm font-semibold text-red-700 transition-colors hover:bg-red-50 focus:outline-none focus:ring-2 focus:ring-red-300 dark:border-red-500/40 dark:text-red-300 dark:hover:bg-red-500/10"
                >
                  {t('file_section.cancel_button')}
                </button>
              )}
            </div>
          ))}

          {files.length === 0 && uploadTransfers.length === 0 && (
            <div className="rounded-xl border border-dashed border-ink/10 bg-white/80 p-6 text-center text-sm text-coal dark:border-white/10 dark:bg-night/60 dark:text-gray-300">
              {t('file_section.no_files_uploaded')}
            </div>
          )}

          {files.map((file) => {
            const previewUrl = previewUrls[file.id];
            const isImage = isImageFile(file);
            const isPreviewLoading = !!previewLoading[file.id];
            const downloadTransfer = downloadTransfers[file.id];
            const isDownloadActive = !!downloadTransfer && isTransferActive(downloadTransfer.status);
            const previewLabel = previewUrl
              ? t('file_section.hide_preview_button')
              : isPreviewLoading
              ? t('file_section.preview_loading')
              : t('file_section.preview_button');

            return (
              <div key={file.id} className="rounded-xl border border-ink/10 bg-white/90 p-4 shadow-soft dark:border-white/10 dark:bg-night/70">
                <div className="text-sm font-semibold text-ink dark:text-gray-100">{file.originalName}</div>
                <div className="mt-1 text-xs text-coal dark:text-gray-400">
                  {(file.size / 1024 / 1024).toFixed(2)} MB · {formatDistanceToNow(new Date(file.createdAt))} ago
                </div>
                <div className={`mt-3 grid gap-3 ${isImage ? 'grid-cols-3' : 'grid-cols-2'}`}>
                  {isImage && (
                    <button
                      onClick={(event) => {
                        event.stopPropagation();
                        void handlePreview(file);
                      }}
                      disabled={isPreviewLoading || isDownloadActive}
                      className="w-full cursor-pointer rounded-md border border-ink/10 bg-white/80 px-3 py-2 text-sm font-semibold text-ink transition-colors hover:bg-ink/5 disabled:cursor-not-allowed disabled:opacity-60 dark:border-white/10 dark:bg-night/60 dark:text-gray-200 dark:hover:bg-white/10"
                    >
                      {previewLabel}
                    </button>
                  )}
                  <button
                    onClick={(event) => {
                      event.stopPropagation();
                      if (isDownloadActive) {
                        handleCancelDownload(file.id);
                        return;
                      }
                      void handleDownload(file);
                    }}
                    className={`w-full cursor-pointer rounded-md border px-3 py-2 text-sm font-semibold transition-colors dark:bg-night/60 ${
                      isDownloadActive
                        ? 'border-red-200 text-red-700 hover:bg-red-50 dark:border-red-500/40 dark:text-red-300 dark:hover:bg-red-500/10'
                        : 'border-ink/10 bg-white/80 text-ink hover:bg-ink/5 dark:border-white/10 dark:text-gray-200 dark:hover:bg-white/10'
                    }`}
                  >
                    {isDownloadActive ? t('file_section.cancel_button') : t('file_section.download_button')}
                  </button>
                  <button
                    onClick={(event) => {
                      event.stopPropagation();
                      void handleDelete(file.id);
                    }}
                    disabled={isDownloadActive}
                    className="w-full cursor-pointer rounded-md border border-red-200 px-3 py-2 text-sm font-semibold text-red-700 transition-colors hover:bg-red-50 disabled:cursor-not-allowed disabled:opacity-60 dark:border-red-500/40 dark:text-red-300 dark:hover:bg-red-500/10"
                  >
                    {t('file_section.delete_button')}
                  </button>
                </div>
                {downloadTransfer && renderTransferProgress(downloadTransfer)}
                {previewUrl && (
                  <div className="mt-4 overflow-hidden rounded-lg border border-ink/10 bg-white/80 dark:border-white/10 dark:bg-night/60">
                    <img
                      src={previewUrl}
                      alt={file.originalName}
                      className="h-48 w-full object-contain"
                    />
                  </div>
                )}
              </div>
            );
          })}
        </div>

        <div className="hidden sm:block">
          <div className="-mx-4 -my-2 overflow-x-auto sm:-mx-6 lg:-mx-8">
            <div className="inline-block min-w-full py-2 align-middle sm:px-6 lg:px-8">
              <div className="overflow-hidden rounded-xl border border-ink/10 bg-white/90 shadow-soft dark:border-white/10 dark:bg-night/70">
                <table className="min-w-full divide-y divide-ink/10 dark:divide-white/10">
                  <thead className="bg-ink/5 dark:bg-white/5">
                    <tr>
                      <th scope="col" className="py-3.5 pl-4 pr-3 text-left text-sm font-semibold text-ink dark:text-white sm:pl-6">
                        {t('file_section.table_header_name')}
                      </th>
                      <th scope="col" className="px-3 py-3.5 text-left text-sm font-semibold text-ink dark:text-white">
                        {t('file_section.table_header_size')}
                      </th>
                      <th scope="col" className="px-3 py-3.5 text-left text-sm font-semibold text-ink dark:text-white">
                        {t('file_section.table_header_uploaded')}
                      </th>
                      <th scope="col" className="relative py-3.5 pl-3 pr-4 sm:pr-6">
                        <span className="sr-only">Actions</span>
                      </th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-ink/10 bg-white/90 dark:divide-white/10 dark:bg-night/60">
                    {uploadTransfers.map((transfer) => (
                      <Fragment key={transfer.id}>
                        <tr className="bg-accent/5 transition-colors dark:bg-accent/5">
                          <td className="whitespace-nowrap py-4 pl-4 pr-3 text-sm font-medium text-ink dark:text-gray-200 sm:pl-6">
                            {transfer.name}
                          </td>
                          <td className="whitespace-nowrap px-3 py-4 text-sm text-coal dark:text-gray-400">
                            {formatBytes(transfer.size)}
                          </td>
                          <td className="whitespace-nowrap px-3 py-4 text-sm text-coal dark:text-gray-400">
                            {t('file_section.transfer_pending')}
                          </td>
                          <td className="relative whitespace-nowrap py-4 pl-3 pr-4 text-right text-sm font-medium sm:pr-6">
                            {isTransferActive(transfer.status) && (
                              <button
                                onClick={(event) => {
                                  event.stopPropagation();
                                  handleCancelUpload(transfer.id);
                                }}
                                className="cursor-pointer text-red-600 hover:text-red-900 dark:text-red-400 dark:hover:text-red-300"
                              >
                                {t('file_section.cancel_button')}
                              </button>
                            )}
                          </td>
                        </tr>
                        <tr className="bg-accent/5 dark:bg-accent/5">
                          <td colSpan={4} className="px-6 pb-4 pt-0">
                            {renderTransferProgress(transfer)}
                          </td>
                        </tr>
                      </Fragment>
                    ))}

                    {files.length === 0 && uploadTransfers.length === 0 && (
                      <tr>
                        <td colSpan={4} className="py-4 text-center text-sm text-coal dark:text-gray-400">
                          {t('file_section.no_files_uploaded')}
                        </td>
                      </tr>
                    )}

                    {files.map((file) => {
                      const previewUrl = previewUrls[file.id];
                      const isImage = isImageFile(file);
                      const isPreviewLoading = !!previewLoading[file.id];
                      const downloadTransfer = downloadTransfers[file.id];
                      const isDownloadActive = !!downloadTransfer && isTransferActive(downloadTransfer.status);
                      const previewLabel = previewUrl
                        ? t('file_section.hide_preview_button')
                        : isPreviewLoading
                        ? t('file_section.preview_loading')
                        : t('file_section.preview_button');

                      return (
                        <Fragment key={file.id}>
                          <tr className="transition-colors hover:bg-ink/5 dark:hover:bg-white/5">
                            <td className="whitespace-nowrap py-4 pl-4 pr-3 text-sm font-medium text-ink dark:text-gray-200 sm:pl-6">
                              {file.originalName}
                            </td>
                            <td className="whitespace-nowrap px-3 py-4 text-sm text-coal dark:text-gray-400">
                              {(file.size / 1024 / 1024).toFixed(2)} MB
                            </td>
                            <td className="whitespace-nowrap px-3 py-4 text-sm text-coal dark:text-gray-400">
                              {formatDistanceToNow(new Date(file.createdAt))} ago
                            </td>
                            <td className="relative whitespace-nowrap py-4 pl-3 pr-4 text-right text-sm font-medium sm:pr-6">
                              {isImage && (
                                <button
                                  onClick={(event) => {
                                    event.stopPropagation();
                                    void handlePreview(file);
                                  }}
                                  disabled={isPreviewLoading || isDownloadActive}
                                  className="mr-4 cursor-pointer text-ink hover:text-coal disabled:cursor-not-allowed disabled:opacity-60 dark:text-gray-200 dark:hover:text-white"
                                >
                                  {previewLabel}
                                </button>
                              )}
                              <button
                                onClick={(event) => {
                                  event.stopPropagation();
                                  if (isDownloadActive) {
                                    handleCancelDownload(file.id);
                                    return;
                                  }
                                  void handleDownload(file);
                                }}
                                className={`mr-4 cursor-pointer ${
                                  isDownloadActive
                                    ? 'text-red-600 hover:text-red-900 dark:text-red-400 dark:hover:text-red-300'
                                    : 'text-ink hover:text-coal dark:text-gray-200 dark:hover:text-white'
                                }`}
                              >
                                {isDownloadActive ? t('file_section.cancel_button') : t('file_section.download_button')}
                              </button>
                              <button
                                onClick={(event) => {
                                  event.stopPropagation();
                                  void handleDelete(file.id);
                                }}
                                disabled={isDownloadActive}
                                className="cursor-pointer text-red-600 hover:text-red-900 disabled:cursor-not-allowed disabled:opacity-60 dark:text-red-400 dark:hover:text-red-300"
                              >
                                {t('file_section.delete_button')}
                              </button>
                            </td>
                          </tr>
                          {downloadTransfer && (
                            <tr>
                              <td colSpan={4} className="px-6 pb-4 pt-0">
                                {renderTransferProgress(downloadTransfer)}
                              </td>
                            </tr>
                          )}
                          {previewUrl && (
                            <tr>
                              <td colSpan={4} className="px-6 pb-4">
                                <div className="overflow-hidden rounded-lg border border-ink/10 bg-white/80 dark:border-white/10 dark:bg-night/60">
                                  <img
                                    src={previewUrl}
                                    alt={file.originalName}
                                    className="h-56 w-full object-contain"
                                  />
                                </div>
                              </td>
                            </tr>
                          )}
                        </Fragment>
                      );
                    })}
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
