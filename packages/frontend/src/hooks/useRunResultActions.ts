import { useState } from 'react';
import toast from 'react-hot-toast';
import { api } from '../lib/api';
import { useCreateIndividualRun } from './useRuns';

// Shared re-run / asset-download logic for a run's results — used by both the
// Reports run-history accordion and the Suite Dashboard's run detail page so
// neither has to duplicate the download/retry plumbing.
export function useRunResultActions(projectId: string | undefined, runId: string, environment: string | undefined) {
  const [retryingIds, setRetryingIds] = useState<Set<string>>(new Set());
  const individualRun = useCreateIndividualRun(projectId ?? '');

  async function handleRerunTC(testCaseId: string) {
    if (!environment) return;
    setRetryingIds((prev) => new Set(prev).add(testCaseId));
    try {
      await individualRun.mutateAsync({ testCaseId, environment });
      toast.success('Test case queued for re-run');
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { error?: string } } })?.response?.data?.error ?? 'Failed to re-run test case';
      toast.error(msg);
    } finally {
      setRetryingIds((prev) => { const next = new Set(prev); next.delete(testCaseId); return next; });
    }
  }

  async function openRfHtml(resultId: string, type: 'rf-report' | 'rf-log', filename: string) {
    try {
      const response = await api.get(
        `/projects/${projectId}/reports/runs/${runId}/results/${resultId}/${type}`,
        { responseType: 'blob' },
      );
      const url = URL.createObjectURL(response.data as Blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = filename;
      a.style.display = 'none';
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (err) {
      const axErr = err as { response?: { data?: unknown; status?: number }; message?: string };
      let msg = axErr?.message ?? 'Download failed';
      if (axErr?.response?.data instanceof Blob) {
        try {
          const text = await (axErr.response.data as Blob).text();
          const json = JSON.parse(text) as { error?: string };
          if (json.error) msg = json.error;
        } catch { /* keep default msg */ }
      }
      toast.error(`RF report download failed: ${msg}`);
    }
  }

  async function downloadAsset(resultId: string, type: 'screenshot' | 'trace' | 'video', filename: string, videoIndex?: number) {
    try {
      const requestUrl = type === 'video' && videoIndex !== undefined
        ? `/projects/${projectId}/reports/runs/${runId}/results/${resultId}/${type}?index=${videoIndex}`
        : `/projects/${projectId}/reports/runs/${runId}/results/${resultId}/${type}`;
      const response = await api.get(requestUrl, { responseType: 'blob' });
      const url = URL.createObjectURL(response.data as Blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = filename;
      a.style.display = 'none';
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (err) {
      const axErr = err as { response?: { data?: unknown; status?: number }; message?: string };
      let msg = axErr?.message ?? 'Download failed';
      if (axErr?.response?.data instanceof Blob) {
        try {
          const text = await (axErr.response.data as Blob).text();
          const json = JSON.parse(text) as { error?: string };
          if (json.error) msg = json.error;
        } catch { /* keep default msg */ }
      }
      toast.error(`${type} download failed: ${msg}`);
    }
  }

  return { retryingIds, handleRerunTC, downloadAsset, openRfHtml };
}
