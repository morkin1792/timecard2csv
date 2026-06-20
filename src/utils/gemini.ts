import { GoogleGenerativeAI } from '@google/generative-ai';
import type { Part } from '@google/generative-ai';

// Models ordered by capability. The first is the default; the second is the
// single-level downgrade used only when the free-tier quota for the current
// model is exhausted (HTTP 429 / RESOURCE_EXHAUSTED).
// NOTE: confirm these IDs against the current AI Studio model list if they ever
// stop resolving — they are the only Gemini-specific strings in the app.
const MODELS = ['gemini-3.5-flash', 'gemini-3-flash'] as const;

// Backoff schedule (in seconds) for transient "server unavailable" errors
// (HTTP 500/503). The spec is "at least 10s": wait 10s, then 30s, then 30s.
const UNAVAILABLE_RETRY_DELAYS_SEC = [10, 30, 30];

export interface TimecardRecord {
  data: string;
  entradas_saidas: string[];
}

export interface ProcessCallbacks {
  /** Called once per chunk as it starts processing. */
  onProgress: (current: number, total: number) => void;
  /** Called every second while waiting to retry a 500/503, for a live countdown. */
  onRetryCountdown?: (secondsRemaining: number, reason: string) => void;
  /** Called when the free-tier limit forces a one-level model downgrade. */
  onModelDowngrade?: (from: string, to: string) => void;
  /**
   * Called after each chunk finishes, with the next chunk index to resume from
   * and all records gathered so far. Used to autosave progress so an interrupted
   * run can be resumed instead of restarted.
   */
  onChunkComplete?: (nextIndex: number, recordsSoFar: TimecardRecord[]) => void;
}

export interface ProcessOptions {
  /** Skip chunks before this index (for resuming an interrupted run). */
  startIndex?: number;
  /** Records already gathered from a previous (interrupted) run. */
  initialRecords?: TimecardRecord[];
}

const PROMPT = `
Extraia os registros de ponto deste documento PDF.
Retorne APENAS um array JSON estrito no seguinte formato, sem formatação markdown (sem blocos \`\`\`json):
[
  {
    "data": "DD/MM/YYYY",
    "entradas_saidas": ["08:10", "12:15", "13:50", "20:10"]
  }
]
Caso o dia não tenha batimentos, retorne uma lista vazia em entradas_saidas.
Ignore totais, banco de horas, cabeçalhos e assinaturas.
Garanta que as datas estejam no formato DD/MM/YYYY.
`.trim();

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** Sleeps for `seconds`, invoking `onTick` once per remaining second. */
const countdown = async (seconds: number, onTick: (secondsRemaining: number) => void) => {
  for (let s = seconds; s > 0; s--) {
    onTick(s);
    await sleep(1000);
  }
};

const errorText = (error: unknown): string =>
  String((error as { message?: unknown })?.message ?? '');

const hasStatus = (error: unknown, code: number): boolean => {
  const e = error as { status?: unknown; code?: unknown; response?: { status?: unknown } };
  const status = e?.status ?? e?.response?.status ?? e?.code;
  if (status === code || status === String(code)) return true;
  // The SDK often only carries the code inside the message, e.g. "[503 ...]".
  return new RegExp(`(^|[^0-9])${code}([^0-9]|$)`).test(errorText(error));
};

// Free-tier quota for the current model is exhausted.
const isRateLimited = (error: unknown): boolean =>
  hasStatus(error, 429) || /RESOURCE_EXHAUSTED|quota|rate limit/i.test(errorText(error));

// Transient server-side problem; safe to retry after a wait.
const isServerUnavailable = (error: unknown): boolean =>
  hasStatus(error, 500) ||
  hasStatus(error, 503) ||
  /unavailable|overloaded|internal error|try again/i.test(errorText(error));

/**
 * Extracts the JSON record array from arbitrary model output. Tolerates
 * markdown code fences (```json ... ```) and surrounding prose by grabbing the
 * first `[ ... ]` block. Shared by the API mode and the manual paste-back flow.
 */
export const parseRecordsFromText = (text: string): TimecardRecord[] => {
  const jsonMatch = text.match(/\[[\s\S]*\]/);
  const jsonStr = jsonMatch ? jsonMatch[0] : text;
  return JSON.parse(jsonStr) as TimecardRecord[];
};

export interface ManualAnswer {
  registros: TimecardRecord[];
  /** Name of the uploaded file as reported by Gemini, when available. */
  arquivo?: string;
}

/**
 * Parses the manual-mode answer. Prefers our wrapped object format
 * `{ "arquivo": "...", "registros": [...] }` but also accepts a bare records
 * array. Throws on incomplete/invalid JSON (which is how we detect a copy made
 * before Gemini finished generating).
 */
export const parseManualAnswer = (text: string): ManualAnswer => {
  const firstObj = text.indexOf('{');
  const firstArr = text.indexOf('[');
  // The top-level shape is whichever bracket appears first (records inside an
  // array also contain `{`, so we can't just look for any `{`).
  const isObject = firstObj !== -1 && (firstArr === -1 || firstObj < firstArr);

  if (isObject) {
    const match = text.match(/\{[\s\S]*\}/);
    const obj = JSON.parse(match ? match[0] : text) as { registros?: unknown; arquivo?: unknown };
    if (!Array.isArray(obj.registros)) throw new Error('missing "registros" array');
    return {
      registros: obj.registros as TimecardRecord[],
      arquivo: typeof obj.arquivo === 'string' ? obj.arquivo : undefined,
    };
  }

  const match = text.match(/\[[\s\S]*\]/);
  const arr = JSON.parse(match ? match[0] : text);
  if (!Array.isArray(arr)) throw new Error('not an array');
  return { registros: arr as TimecardRecord[] };
};

export const processPdfChunksWithGemini = async (
  apiKey: string,
  pdfChunks: string[],
  callbacks: ProcessCallbacks,
  options: ProcessOptions = {}
): Promise<TimecardRecord[]> => {
  const { startIndex = 0, initialRecords = [] } = options;
  const genAI = new GoogleGenerativeAI(apiKey);
  const totalChunks = pdfChunks.length;
  const allRecords: TimecardRecord[] = [...initialRecords];

  // Persists across chunks: once we downgrade, we stay downgraded so we don't
  // keep hitting (and waiting on) the exhausted model for every remaining chunk.
  let modelIndex = 0;

  for (let i = startIndex; i < totalChunks; i++) {
    callbacks.onProgress(i + 1, totalChunks);

    const pdfPart: Part = {
      inlineData: { data: pdfChunks[i], mimeType: 'application/pdf' },
    };

    let unavailableAttempt = 0;

    // Retry loop for this single chunk.
    while (true) {
      const modelName = MODELS[modelIndex];
      const model = genAI.getGenerativeModel({ model: modelName });

      try {
        const result = await model.generateContent([PROMPT, pdfPart]);
        const text = (await result.response).text();
        allRecords.push(...parseRecordsFromText(text));
        callbacks.onChunkComplete?.(i + 1, [...allRecords]);
        break; // chunk done
      } catch (error: unknown) {
        // Free-tier limit reached: downgrade exactly one level, then retry now.
        if (isRateLimited(error) && modelIndex < MODELS.length - 1) {
          const from = MODELS[modelIndex];
          modelIndex += 1;
          console.warn(`Free-tier limit hit on ${from}. Downgrading to ${MODELS[modelIndex]}.`);
          callbacks.onModelDowngrade?.(from, MODELS[modelIndex]);
          continue;
        }

        // Server temporarily unavailable: wait (10s, 30s, 30s) with a countdown.
        if (isServerUnavailable(error) && unavailableAttempt < UNAVAILABLE_RETRY_DELAYS_SEC.length) {
          const waitSec = UNAVAILABLE_RETRY_DELAYS_SEC[unavailableAttempt];
          unavailableAttempt += 1;
          console.warn(`Server unavailable. Waiting ${waitSec}s before retry...`);
          await countdown(waitSec, (secondsRemaining) =>
            callbacks.onRetryCountdown?.(
              secondsRemaining,
              'Servidor da IA temporariamente indisponível (erro 500/503).'
            )
          );
          continue;
        }

        console.error('Error processing chunk:', error);
        throw error;
      }
    }
  }

  return allRecords;
};
