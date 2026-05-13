import { useState, useEffect } from 'react';
import ApiKeyModal from './components/ApiKeyModal';
import { encryptApiKey, decryptApiKey } from './utils/crypto';
import { splitPdfIntoChunks } from './utils/pdfProcessor';
import { processPdfChunksWithGemini } from './utils/gemini';
import { generateCsv, downloadCsv } from './utils/csv';

const STORAGE_KEY = 'app_gemini_token';

function App() {
  const [apiKey, setApiKey] = useState<string | null>(null);
  const [showModal, setShowModal] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);
  const [progress, setProgress] = useState({ current: 0, total: 0 });
  const [status, setStatus] = useState<string>('');
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const savedKey = localStorage.getItem(STORAGE_KEY);
    if (savedKey) {
      const decrypted = decryptApiKey(savedKey);
      if (decrypted) {
        setApiKey(decrypted);
      } else {
        setShowModal(true);
      }
    } else {
      setShowModal(true);
    }
  }, []);

  const handleSaveApiKey = (key: string) => {
    const encrypted = encryptApiKey(key);
    localStorage.setItem(STORAGE_KEY, encrypted);
    setApiKey(key);
    setShowModal(false);
  };

  const handleCancelModal = () => {
    setShowModal(false);
  };

  const handleOpenModal = () => {
    setShowModal(true);
  };

  const [isDragging, setIsDragging] = useState(false);

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
    if (file && file.type === 'application/pdf') {
      const mockEvent = {
        target: {
          files: [file]
        }
      } as unknown as React.ChangeEvent<HTMLInputElement>;
      handleFileUpload(mockEvent);
    }
  };

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !apiKey) return;

    try {
      setIsProcessing(true);
      setError(null);
      setStatus('Preparando PDF e dividindo em lotes...');
      
      const pdfChunks = await splitPdfIntoChunks(file);
      
      setStatus(`Enviando ${pdfChunks.length} lotes para o Gemini...`);
      const records = await processPdfChunksWithGemini(
        apiKey,
        pdfChunks,
        (current, total) => {
          setProgress({ current, total });
          setStatus(`Processando lote ${current} de ${total}...`);
        }
      );

      setStatus('Gerando CSV...');
      const csv = generateCsv(records);
      downloadCsv(csv);
      
      setStatus('Concluído! O arquivo CSV foi baixado.');
    } catch (err: any) {
      console.error(err);
      setError(`Erro: ${err.message || 'Ocorreu um erro inesperado'}`);
    } finally {
      setIsProcessing(false);
      setProgress({ current: 0, total: 0 });
    }
  };

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-900 text-gray-900 dark:text-gray-100 p-4 md:p-8">
      <div className="max-w-4xl mx-auto">
        <header className="mb-8 flex justify-between items-center">
          <div>
            <h1 className="text-3xl font-bold text-blue-600 dark:text-blue-400">Timecard2CSV</h1>
            <p className="text-gray-600 dark:text-gray-400">Extraia batimentos de ponto de PDFs usando IA</p>
          </div>
          {apiKey && (
            <button
              onClick={handleOpenModal}
              className="text-sm text-red-500 hover:text-red-600 underline"
            >
              Alterar API Key
            </button>
          )}
        </header>

        {showModal && (
          <ApiKeyModal 
            onSave={handleSaveApiKey} 
            onCancel={handleCancelModal}
            isClosable={!!apiKey}
          />
        )}

        {!showModal && apiKey && (
          <main className="bg-white dark:bg-gray-800 rounded-lg shadow-md p-6">
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
                onChange={handleFileUpload}
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
                <li>Cada página é convertida em imagem.</li>
                <li>As imagens são enviadas em lotes para a API do Google Gemini.</li>
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
