import type { TimecardRecord } from './gemini';

// Lightweight, best-effort session persistence in localStorage. We deliberately
// store only the small extracted results + progress (never the multi-MB PDF
// chunks), so we stay well under the ~5MB localStorage budget. The PDF itself is
// re-derived deterministically when the user re-selects the same file.

const MANUAL_KEY = 'timecard2csv_manual_session';
const API_KEY = 'timecard2csv_api_session';

/** Manual mode: results pasted back per part, plus where the user left off. */
export interface ManualSession {
  fileName: string;
  /** Content-derived id used to name parts and verify pasted answers. */
  fileId: string;
  totalParts: number;
  currentIndex: number;
  results: (TimecardRecord[] | null)[];
  updatedAt: number;
}

/** API mode: records accumulated so far and the next chunk to process. */
export interface ApiSession {
  fileName: string;
  totalChunks: number;
  nextIndex: number;
  records: TimecardRecord[];
  updatedAt: number;
}

const read = <T>(key: string): T | null => {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : null;
  } catch {
    return null;
  }
};

const write = (key: string, value: unknown) => {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch (e) {
    // Storage can be full or disabled (private mode); autosave is best-effort.
    console.warn('Failed to persist session:', e);
  }
};

export const loadManualSession = () => read<ManualSession>(MANUAL_KEY);
export const saveManualSession = (s: ManualSession) => write(MANUAL_KEY, s);
export const clearManualSession = () => localStorage.removeItem(MANUAL_KEY);

export const loadApiSession = () => read<ApiSession>(API_KEY);
export const saveApiSession = (s: ApiSession) => write(API_KEY, s);
export const clearApiSession = () => localStorage.removeItem(API_KEY);
