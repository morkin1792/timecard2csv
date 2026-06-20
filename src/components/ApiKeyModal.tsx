import React, { useState } from 'react';

interface ApiKeyModalProps {
  onSave: (apiKey: string) => void;
  onCancel?: () => void;
  isClosable?: boolean;
}

const ApiKeyModal: React.FC<ApiKeyModalProps> = ({ onSave, onCancel, isClosable }) => {
  const [apiKey, setApiKey] = useState('');
  const [error, setError] = useState<string | null>(null);

  const validateApiKey = (key: string) => {
    // A pasted key should never contain whitespace; this catches the most
    // common paste errors. Beyond that we keep validation loose on purpose:
    // the Gemini API is the real source of truth for whether a key works.
    if (!key || /\s/.test(key)) return false;

    // Legacy Google/AI Studio keys: "AIza" + 35 chars (39 total). The older
    // "AIzaSy" prefix is just one variant of this broader Google key format.
    const legacyFormat = /^AIza[A-Za-z0-9_-]{35}$/;

    // New AI Studio "Authentication Key" format (rolled out 2026): an "AQ."
    // prefix. Google has not published its exact length/charset and it is
    // still changing, so we only sanity-check the prefix plus a minimum
    // length rather than pinning down an exact shape (which is what made the
    // old regex reject valid keys in the first place).
    const newFormat = /^AQ\.[A-Za-z0-9_\-.]{8,}$/;

    return legacyFormat.test(key) || newFormat.test(key);
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const trimmedKey = apiKey.trim();
    
    if (!trimmedKey) {
      setError('A chave de API não pode estar vazia.');
      return;
    }

    if (!validateApiKey(trimmedKey)) {
      setError('Formato de chave de API inválido. Uma chave válida começa com "AIza" ou "AQ.".');
      return;
    }

    setError(null);
    onSave(trimmedKey);
  };

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="bg-white dark:bg-gray-800 rounded-lg shadow-xl p-6 w-full max-w-md">
        <h2 className="text-xl font-bold mb-4 text-gray-900 dark:text-white">Configuração da API Gemini</h2>
        <p className="mb-4 text-sm text-gray-600 dark:text-gray-300">
          Para processar os cartões de ponto, você precisa de uma chave de API do Google Gemini.
          Sua chave será criptografada e salva localmente no seu navegador.
        </p>
        <form onSubmit={handleSubmit}>
          <div className="mb-4">
            <label htmlFor="apiKey" className="block text-sm font-medium text-gray-700 dark:text-gray-200 mb-1">
              Chave de API
            </label>
            <input
              type="password"
              id="apiKey"
              value={apiKey}
              onChange={(e) => {
                setApiKey(e.target.value);
                if (error) setError(null);
              }}
              className={`w-full px-3 py-2 border rounded-md shadow-sm focus:outline-none focus:ring-blue-500 focus:border-blue-500 dark:bg-gray-700 dark:text-white ${
                error ? 'border-red-500' : 'border-gray-300 dark:border-gray-600'
              }`}
              placeholder="Digite sua API Key aqui"
              required
            />
            {error && <p className="mt-1 text-xs text-red-500">{error}</p>}
          </div>
          <div className="flex flex-col gap-2">
            <button
              type="submit"
              className="w-full bg-blue-600 hover:bg-blue-700 text-white font-bold py-2 px-4 rounded transition-colors"
            >
              Salvar Chave
            </button>
            {isClosable && onCancel && (
              <button
                type="button"
                onClick={onCancel}
                className="w-full bg-gray-200 dark:bg-gray-700 hover:bg-gray-300 dark:hover:bg-gray-600 text-gray-800 dark:text-gray-200 font-bold py-2 px-4 rounded transition-colors"
              >
                Cancelar
              </button>
            )}
            <a
              href="https://aistudio.google.com/app/apikey"
              target="_blank"
              rel="noopener noreferrer"
              className="text-center text-sm text-blue-500 hover:text-blue-600"
            >
              Obter chave de API gratuita
            </a>
          </div>
        </form>
      </div>
    </div>
  );
};

export default ApiKeyModal;
