import { useState, useEffect } from 'react';
import ApiKeyModal from './components/ApiKeyModal';
import ManualMode from './components/ManualMode';
import { encryptApiKey, decryptApiKey } from './utils/crypto';
import { splitPdfIntoChunks } from './utils/pdfProcessor';
import { processPdfChunksWithGemini } from './utils/gemini';
import type { TimecardRecord } from './utils/gemini';
import { generateCsv, downloadCsv, csvNameFromPdf } from './utils/csv';
import { loadApiSession, saveApiSession, clearApiSession } from './utils/storage';
import type { ApiSession } from './utils/storage';

const STORAGE_KEY = 'app_gemini_token';

type Mode = 'api' | 'manual';

function App() {
  const [mode, setMode] = useState<Mode>('api');
  const [apiKey, setApiKey] = useState<string | null>(null);

  // Decrypt any saved key on load (async: the key lives in IndexedDB).
  useEffect(() => {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (!saved) return;
    let active = true;
    decryptApiKey(saved).then((key) => {
      if (active && key) setApiKey(key);
    });
    return () => {
      active = false;
    };
  }, []);
  const [showModal, setShowModal] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);
  const [progress, setProgress] = useState({ current: 0, total: 0 });
  const [status, setStatus] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [modelNotice, setModelNotice] = useState<string | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  // Offer to recover an interrupted API run (loaded once via lazy initial state).
  const [resume, setResume] = useState<ApiSession | null>(() => {
    const s = loadApiSession();
    return s && s.records.length > 0 && s.nextIndex < s.totalChunks ? s : null;
  });

  const handleSaveApiKey = async (key: string) => {
    setApiKey(key);
    setShowModal(false);
    try {
      localStorage.setItem(STORAGE_KEY, await encryptApiKey(key));
    } catch (e) {
      // Persisting failed (e.g. storage disabled); the key still works this session.
      console.error('Failed to persist API key:', e);
    }
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(true);
  };

  const handleDragLeave = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);
    const file = e.dataTransfer.files?.[0];
    if (file && file.type === 'application/pdf') processPdf(file);
  };

  const processPdf = async (file: File, resumeFrom?: ApiSession) => {
    if (!apiKey) {
      setShowModal(true);
      return;
    }
    try {
      setIsProcessing(true);
      setError(null);
      setModelNotice(null);
      setResume(null);
      setStatus('Preparando PDF e dividindo em lotes...');

      const pdfChunks = await splitPdfIntoChunks(file);

      let startIndex = 0;
      let initialRecords: TimecardRecord[] = [];
      if (resumeFrom) {
        if (resumeFrom.totalChunks === pdfChunks.length) {
          startIndex = resumeFrom.nextIndex;
          initialRecords = resumeFrom.records;
        } else {
          setError('PDF diferente do processamento interrompido — iniciando do começo.');
        }
      }

      setStatus(`Enviando ${pdfChunks.length} lotes para o Gemini...`);
      const records = await processPdfChunksWithGemini(
        apiKey,
        pdfChunks,
        {
          onProgress: (current, total) => {
            setProgress({ current, total });
            setStatus(`Processando lote ${current} de ${total}...`);
          },
          onRetryCountdown: (secondsRemaining, reason) => {
            setStatus(`${reason} Tentando novamente em ${secondsRemaining}s...`);
          },
          onModelDowngrade: (from, to) => {
            setModelNotice(`Limite gratuito do modelo "${from}" atingido. Continuando com "${to}".`);
          },
          onChunkComplete: (nextIndex, recordsSoFar) => {
            saveApiSession({
              fileName: file.name,
              totalChunks: pdfChunks.length,
              nextIndex,
              records: recordsSoFar,
              updatedAt: Date.now(),
            });
          },
        },
        { startIndex, initialRecords }
      );

      setStatus('Gerando CSV...');
      downloadCsv(generateCsv(records), csvNameFromPdf(file.name));
      clearApiSession();
      setStatus('Concluído! O arquivo CSV foi baixado.');
    } catch (err: unknown) {
      console.error(err);
      const message = err instanceof Error ? err.message : 'Ocorreu um erro inesperado';
      setError(`Erro: ${message}`);
    } finally {
      setIsProcessing(false);
      setProgress({ current: 0, total: 0 });
    }
  };

  const tabClass = (active: boolean) =>
    `flex-1 py-2 px-4 rounded-md text-sm font-semibold transition-colors ${
      active
        ? 'bg-blue-600 text-white shadow'
        : 'bg-white dark:bg-gray-800 text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700'
    }`;

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-900 text-gray-900 dark:text-gray-100 p-4 md:p-8">
      <div className="max-w-4xl mx-auto">
        <header className="mb-6 flex justify-between items-center">
          <div>
            <h1 className="text-3xl font-bold text-blue-600 dark:text-blue-400">Timecard2CSV</h1>
            <p className="text-gray-600 dark:text-gray-400">Extraia batimentos de ponto de PDFs usando IA</p>
          </div>
          {mode === 'api' && apiKey && (
            <button
              onClick={() => setShowModal(true)}
              className="text-sm text-red-500 hover:text-red-600 underline"
            >
              Alterar API Key
            </button>
          )}
        </header>

        {/* Mode tabs — Manual is always available, even without an API key */}
        <div className="flex gap-2 mb-6 p-1 bg-gray-100 dark:bg-gray-800 rounded-lg">
          <button onClick={() => setMode('api')} className={tabClass(mode === 'api')}>
            Modo API (automático)
          </button>
          <button onClick={() => setMode('manual')} className={tabClass(mode === 'manual')}>
            Modo Manual (sem chave)
          </button>
        </div>

        {showModal && (
          <ApiKeyModal onSave={handleSaveApiKey} onCancel={() => setShowModal(false)} isClosable />
        )}

        {mode === 'manual' ? (
          <ManualMode />
        ) : !apiKey ? (
          <main className="bg-white dark:bg-gray-800 rounded-lg shadow-md p-6 text-center">
            <h2 className="text-xl font-semibold mb-2">Configure sua chave Gemini gratuita</h2>
            <p className="text-gray-600 dark:text-gray-300 mb-4 text-sm">
              O modo automático processa o PDF inteiro para você usando a API do Gemini.
            </p>
            <button
              onClick={() => setShowModal(true)}
              className="bg-blue-600 hover:bg-blue-700 text-white font-bold py-2 px-6 rounded transition-colors"
            >
              Configurar chave
            </button>
            <p className="mt-4 text-sm text-gray-500 dark:text-gray-400">
              Sem chave? Use o{' '}
              <button onClick={() => setMode('manual')} className="text-blue-500 hover:text-blue-600 underline">
                Modo Manual
              </button>{' '}
              — funciona com o Gemini grátis no navegador.
            </p>
          </main>
        ) : (
          <main className="bg-white dark:bg-gray-800 rounded-lg shadow-md p-6">
            {resume && (
              <div className="mb-4 p-4 bg-blue-50 dark:bg-blue-900/30 border border-blue-300 dark:border-blue-700 rounded">
                <p className="text-sm mb-3">
                  Processamento interrompido de <strong>{resume.fileName}</strong> encontrado
                  ({resume.nextIndex} de {resume.totalChunks} lotes concluídos). Selecione o mesmo
                  PDF para retomar de onde parou.
                </p>
                <div className="flex flex-wrap gap-2">
                  <label className="cursor-pointer py-1.5 px-4 rounded text-sm font-bold bg-blue-600 hover:bg-blue-700 text-white transition-colors">
                    Retomar (selecione o mesmo PDF)
                    <input
                      type="file"
                      accept=".pdf"
                      className="hidden"
                      onChange={(e) => {
                        const file = e.target.files?.[0];
                        if (file) processPdf(file, resume);
                        e.target.value = '';
                      }}
                    />
                  </label>
                  <button
                    onClick={() => {
                      clearApiSession();
                      setResume(null);
                    }}
                    className="py-1.5 px-4 rounded text-sm font-medium text-red-500 hover:text-red-600 underline"
                  >
                    Descartar
                  </button>
                </div>
              </div>
            )}

            <h2 className="text-xl font-semibold mb-4">Selecione o Cartão de Ponto (PDF)</h2>

            <div
              className={`border-2 border-dashed rounded-lg p-12 text-center relative transition-colors ${
                isDragging
                  ? 'border-blue-500 bg-blue-50 dark:bg-blue-900/20'
                  : 'border-gray-300 dark:border-gray-600'
              }`}
              onDragOver={handleDragOver}
              onDragLeave={handleDragLeave}
              onDrop={handleDrop}
            >
              <input
                type="file"
                accept=".pdf"
                className="hidden"
                id="file-upload"
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (file) processPdf(file);
                  e.target.value = '';
                }}
                disabled={isProcessing}
              />
              {!isProcessing ? (
                <>
                  <label
                    htmlFor="file-upload"
                    className="cursor-pointer bg-blue-600 hover:bg-blue-700 text-white font-bold py-2 px-6 rounded transition-colors inline-block"
                  >
                    Upload PDF
                  </label>
                  <p className="mt-2 text-sm text-gray-500 dark:text-gray-400">Arraste e solte seu arquivo PDF aqui</p>
                </>
              ) : (
                <div className="space-y-4">
                  <div className="flex items-center justify-center">
                    <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600"></div>
                  </div>
                  <p className="font-medium">{status}</p>
                  {progress.total > 0 && (
                    <div className="w-full bg-gray-200 dark:bg-gray-700 rounded-full h-2.5 max-w-xs mx-auto">
                      <div
                        className="bg-blue-600 h-2.5 rounded-full transition-all duration-500"
                        style={{ width: `${(progress.current / progress.total) * 100}%` }}
                      ></div>
                    </div>
                  )}
                </div>
              )}
            </div>

            {modelNotice && (
              <div className="mt-4 p-4 bg-yellow-100 border border-yellow-400 text-yellow-800 rounded">
                {modelNotice}
              </div>
            )}

            {error && (
              <div className="mt-4 p-4 bg-red-100 border border-red-400 text-red-700 rounded">
                {error}
              </div>
            )}

            {!isProcessing && status.startsWith('Concluído') && (
              <div className="mt-4 p-4 bg-green-100 border border-green-400 text-green-700 rounded">
                {status}
              </div>
            )}

            <div className="mt-8 text-sm text-gray-500 dark:text-gray-400">
              <h3 className="font-semibold mb-2">Como funciona:</h3>
              <ol className="list-decimal ml-5 space-y-1">
                <li>O PDF é processado localmente no seu navegador.</li>
                <li>O documento é dividido em lotes de páginas.</li>
                <li>Os lotes são enviados à API do Google Gemini.</li>
                <li>A IA extrai as datas e horários de entrada/saída.</li>
                <li>Um arquivo CSV é gerado e baixado automaticamente.</li>
              </ol>
            </div>
          </main>
        )}
      </div>
    </div>
  );
}

export default App;
