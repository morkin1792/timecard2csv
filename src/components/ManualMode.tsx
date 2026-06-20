import { useEffect, useState } from 'react';
import { splitPdfIntoChunks } from '../utils/pdfProcessor';
import { parseManualAnswer } from '../utils/gemini';
import type { TimecardRecord } from '../utils/gemini';
import { computeFileId } from '../utils/hash';
import { generateCsv, downloadCsv, csvNameFromPdf } from '../utils/csv';
import {
  loadManualSession,
  saveManualSession,
  clearManualSession,
} from '../utils/storage';
import CopyButton from './CopyButton';

// Asks Gemini to answer inside a single ```json code block (so the web UI shows
// its native "copy" button) and to echo back the uploaded file's name, which we
// cross-check against the current part to catch answers pasted into the wrong slot.
const MANUAL_PROMPT = `Você é um extrator de cartão de ponto. Analise o arquivo PDF anexado e extraia os registros de ponto.

Responda APENAS com um único bloco de código JSON (\`\`\`json ... \`\`\`), sem nenhum texto antes ou depois, exatamente neste formato:

\`\`\`json
{
  "arquivo": "NOME-EXATO-DO-ARQUIVO-ANEXADO.pdf",
  "registros": [
    { "data": "DD/MM/YYYY", "entradas_saidas": ["08:10", "12:15", "13:50", "20:10"] }
  ]
}
\`\`\`

Regras:
- Em "arquivo", coloque exatamente o nome do arquivo PDF enviado nesta mensagem.
- Caso o dia não tenha batimentos, use uma lista vazia em "entradas_saidas".
- Ignore totais, banco de horas, cabeçalhos e assinaturas.
- Garanta que as datas estejam no formato DD/MM/YYYY.`;

// Short, stable part name: P-<12 hex content id>-part-<n>.pdf
const partFileName = (fileId: string, part: number) => `P-${fileId}-part-${part}.pdf`;

type ArquivoCheck = { status: 'ok' | 'unverifiable' } | { status: 'mismatch'; message: string };

// Cross-checks the filename Gemini reported against the current part: BOTH the
// content hash and the part number must match, and a mismatch in either is
// alerted. An absent or unrecognizable name is left "unverifiable" so it never
// blocks a correct paste. OS auto-rename suffixes like " (1)" are ignored.
const verifyArquivo = (arquivo: string | undefined, fileId: string, part: number): ArquivoCheck => {
  if (!arquivo) return { status: 'unverifiable' };
  const norm = arquivo
    .toLowerCase()
    .replace(/\.pdf$/, '')
    .replace(/\s*\(\d+\)\s*$/, '') // strip duplicate-download suffix, e.g. " (1)"
    .trim();

  const match = norm.match(/p-([0-9a-f]{12})-part-(\d+)/);
  if (!match) return { status: 'unverifiable' };

  const idWrong = !!fileId && match[1] !== fileId.toLowerCase();
  const partWrong = Number(match[2]) !== part;

  if (idWrong && partWrong) {
    return {
      status: 'mismatch',
      message: `Este JSON parece ser de OUTRO arquivo e de outra parte (parte ${match[2]}). Verifique o PDF anexado e a parte antes de colar.`,
    };
  }
  if (idWrong) {
    return {
      status: 'mismatch',
      message: 'Este JSON parece ser de OUTRO arquivo. Verifique se você anexou o PDF correto desta sessão.',
    };
  }
  if (partWrong) {
    return {
      status: 'mismatch',
      message: `Este JSON parece ser da parte ${match[2]}, mas você está na parte ${part}. Cole a resposta correspondente a esta parte.`,
    };
  }
  return { status: 'ok' };
};

const downloadBase64Pdf = (base64: string, fileName: string) => {
  const chars = atob(base64);
  const bytes = new Uint8Array(chars.length);
  for (let i = 0; i < chars.length; i++) bytes[i] = chars.charCodeAt(i);
  const blob = new Blob([bytes], { type: 'application/pdf' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = fileName;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
};

const FilePicker = ({
  onFile,
  isLoading,
  label = 'Selecionar PDF',
}: {
  onFile: (file: File) => void;
  isLoading: boolean;
  label?: string;
}) => (
  <label className="cursor-pointer bg-blue-600 hover:bg-blue-700 text-white font-bold py-2 px-6 rounded transition-colors inline-block">
    {isLoading ? 'Lendo PDF...' : label}
    <input
      type="file"
      accept=".pdf"
      className="hidden"
      disabled={isLoading}
      onChange={(e) => {
        const file = e.target.files?.[0];
        if (file) onFile(file);
        e.target.value = ''; // allow re-selecting the same file
      }}
    />
  </label>
);

const ManualMode = () => {
  // Restore any autosaved session once, via lazy initial state (no setState-in-effect).
  const [restored] = useState(loadManualSession);
  const [fileName, setFileName] = useState(restored?.fileName ?? '');
  const [fileId, setFileId] = useState(restored?.fileId ?? '');
  const [totalParts, setTotalParts] = useState(restored?.totalParts ?? 0);
  const [currentIndex, setCurrentIndex] = useState(restored?.currentIndex ?? 0);
  const [results, setResults] = useState<(TimecardRecord[] | null)[]>(
    restored?.results ?? []
  );
  // PDF chunks are NOT persisted (too large); they require the file in memory.
  const [chunks, setChunks] = useState<string[]>([]);
  const [pasteText, setPasteText] = useState(() => {
    const r = restored?.results?.[restored.currentIndex];
    return r ? JSON.stringify(r, null, 2) : '';
  });
  const [pasteError, setPasteError] = useState<string | null>(null);
  const [isSplitting, setIsSplitting] = useState(false);
  const [doneMessage, setDoneMessage] = useState<string | null>(null);

  // Autosave progress whenever it changes (write-only side effect).
  useEffect(() => {
    if (totalParts > 0) {
      saveManualSession({ fileName, fileId, totalParts, currentIndex, results, updatedAt: Date.now() });
    }
  }, [fileName, fileId, totalParts, currentIndex, results]);

  const filledCount = results.filter((r) => r !== null).length;
  const allFilled = totalParts > 0 && filledCount === totalParts;
  const hasChunks = chunks.length === totalParts && totalParts > 0;
  // Current part has a complete, valid array — required to move forward.
  const currentValid = totalParts > 0 && results[currentIndex] != null;

  const goToPart = (index: number, source = results) => {
    setCurrentIndex(index);
    const existing = source[index];
    setPasteText(existing ? JSON.stringify(existing, null, 2) : '');
    setPasteError(null);
  };

  const handleFile = async (file: File) => {
    setIsSplitting(true);
    setPasteError(null);
    setDoneMessage(null);
    try {
      const [newChunks, id] = await Promise.all([splitPdfIntoChunks(file), computeFileId(file)]);
      setChunks(newChunks);
      setFileId(id);

      // Match by content id (robust to renamed/duplicated downloads), falling
      // back to part count for sessions saved before ids existed.
      const matchesRestored =
        !!restored &&
        restored.totalParts === newChunks.length &&
        (restored.fileId ? restored.fileId === id : restored.fileName === file.name);

      setFileName(file.name);
      setTotalParts(newChunks.length);

      if (matchesRestored) {
        // Same document as the autosaved session: keep the part the user is
        // currently on (they may have navigated since reopening) and the live
        // results — don't snap back to the index saved at close time.
        goToPart(currentIndex);
      } else {
        const fresh = new Array<TimecardRecord[] | null>(newChunks.length).fill(null);
        setResults(fresh);
        goToPart(0, fresh);
      }
    } catch {
      setPasteError('Não foi possível ler o PDF. Verifique o arquivo e tente novamente.');
    } finally {
      setIsSplitting(false);
    }
  };

  const setResultAt = (index: number, value: TimecardRecord[] | null) => {
    setResults((prev) => {
      const next = [...prev];
      next[index] = value;
      return next;
    });
  };

  // Auto-saves the moment a valid JSON array is pasted. Incomplete/invalid text —
  // usually a copy made before Gemini finished generating — is flagged and leaves
  // the part "unfilled", which blocks advancing until a complete array is pasted.
  const handlePaste = (value: string) => {
    setPasteText(value);
    if (value.trim() === '') {
      setResultAt(currentIndex, null);
      setPasteError(null);
      return;
    }
    let answer;
    try {
      answer = parseManualAnswer(value);
    } catch {
      setResultAt(currentIndex, null);
      setPasteError(
        'JSON incompleto ou inválido. Isso costuma acontecer quando o texto é copiado antes de o Gemini terminar de gerar a resposta. Aguarde o Gemini concluir e copie o bloco JSON completo novamente.'
      );
      return;
    }

    // Cross-check the filename Gemini reported against the current part.
    const check = verifyArquivo(answer.arquivo, fileId, currentIndex + 1);
    if (check.status === 'mismatch') {
      setResultAt(currentIndex, null);
      setPasteError(check.message);
      return;
    }

    setResultAt(currentIndex, answer.registros);
    setPasteError(null);
  };

  const handleGenerateCsv = () => {
    if (!allFilled) return; // complete CSV only — button is disabled until then
    const flat = results.flatMap((r) => r ?? []);
    downloadCsv(generateCsv(flat), csvNameFromPdf(fileName));
    setDoneMessage('CSV gerado e baixado com todas as partes!');
  };

  const handleReset = () => {
    clearManualSession();
    setFileName('');
    setFileId('');
    setTotalParts(0);
    setCurrentIndex(0);
    setResults([]);
    setChunks([]);
    setPasteText('');
    setPasteError(null);
    setDoneMessage(null);
  };

  // --- Empty state: nothing started yet -------------------------------------
  if (totalParts === 0) {
    return (
      <main className="bg-white dark:bg-gray-800 rounded-lg shadow-md p-6">
        <h2 className="text-xl font-semibold mb-2">Modo Manual — sem chave de API</h2>
        <p className="text-gray-600 dark:text-gray-300 mb-4 text-sm">
          Funciona com o Gemini grátis no navegador. Você baixa o PDF em partes, envia cada
          parte no{' '}
          <a
            href="https://gemini.google.com"
            target="_blank"
            rel="noopener noreferrer"
            className="text-blue-500 hover:text-blue-600 underline"
          >
            gemini.google.com
          </a>{' '}
          com o prompt fornecido, e cola a resposta de volta aqui. Seu progresso é salvo
          automaticamente no navegador.
        </p>
        <FilePicker onFile={handleFile} isLoading={isSplitting} label="Selecionar Cartão de Ponto (PDF)" />
      </main>
    );
  }

  // --- Working state: part-by-part workflow ---------------------------------
  return (
    <main className="bg-white dark:bg-gray-800 rounded-lg shadow-md p-6 space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <h2 className="text-xl font-semibold">
          Parte {currentIndex + 1} de {totalParts}
        </h2>
        <div className="flex items-center gap-3">
          <span className="text-sm text-gray-500 dark:text-gray-400">
            {filledCount}/{totalParts} preenchidas
          </span>
          <button onClick={handleReset} className="text-sm text-red-500 hover:text-red-600 underline">
            Recomeçar
          </button>
        </div>
      </div>

      {/* Part navigator */}
      <div className="flex flex-wrap gap-1.5">
        {results.map((r, i) => {
          // Can't jump forward past an invalid/incomplete current part.
          const blocked = !currentValid && i > currentIndex;
          return (
            <button
              key={i}
              onClick={() => goToPart(i)}
              disabled={blocked}
              title={
                blocked
                  ? 'Cole um JSON válido na parte atual para avançar'
                  : `Parte ${i + 1}${r ? ' (preenchida)' : ''}`
              }
              className={`h-8 w-8 rounded text-xs font-medium border transition-colors disabled:cursor-not-allowed ${
                blocked ? 'border-dashed opacity-70' : ''
              } ${
                i === currentIndex
                  ? 'border-blue-600 ring-2 ring-blue-400'
                  : 'border-gray-300 dark:border-gray-600'
              } ${
                r
                  ? 'bg-green-100 dark:bg-green-900/40 text-green-700 dark:text-green-300'
                  : 'bg-gray-50 dark:bg-gray-700 text-gray-600 dark:text-gray-300'
              }`}
            >
              {i + 1}
            </button>
          );
        })}
      </div>

      {/* Step 1 — download this part */}
      <section>
        <h3 className="font-semibold mb-2">1. Baixe esta parte</h3>
        {hasChunks ? (
          <button
            onClick={() =>
              downloadBase64Pdf(
                chunks[currentIndex],
                partFileName(fileId, currentIndex + 1)
              )
            }
            className="bg-blue-600 hover:bg-blue-700 text-white font-bold py-2 px-6 rounded transition-colors"
          >
            Baixar parte {currentIndex + 1} (PDF)
          </button>
        ) : (
          <div className="text-sm text-gray-600 dark:text-gray-300 space-y-2">
            <p>
              Sessão restaurada. Para baixar as partes, selecione novamente o mesmo PDF
              (suas respostas já preenchidas foram mantidas):
            </p>
            <FilePicker onFile={handleFile} isLoading={isSplitting} label="Selecionar o mesmo PDF" />
          </div>
        )}
      </section>

      {/* Step 2 — copy prompt + send on Gemini */}
      <section>
        <h3 className="font-semibold mb-2">2. Copie o prompt e envie no Gemini</h3>
        <p className="text-sm text-gray-600 dark:text-gray-300 mb-2">
          Abra o{' '}
          <a
            href="https://gemini.google.com"
            target="_blank"
            rel="noopener noreferrer"
            className="text-blue-500 hover:text-blue-600 underline"
          >
            gemini.google.com
          </a>{' '}
          e inicie uma <strong>conversa temporária</strong> (mantém seus dados de ponto fora do
          histórico). Anexe o PDF baixado, cole o prompt abaixo e envie.
        </p>
        <CopyButton text={MANUAL_PROMPT} label="Copiar prompt" />
        <pre className="mt-2 max-h-40 overflow-auto rounded bg-gray-100 dark:bg-gray-900 p-3 text-xs whitespace-pre-wrap text-gray-700 dark:text-gray-300">
          {MANUAL_PROMPT}
        </pre>
      </section>

      {/* Step 3 — paste the result back */}
      <section>
        <h3 className="font-semibold mb-2">3. Cole aqui o JSON retornado</h3>
        <p className="text-sm text-gray-600 dark:text-gray-300 mb-2">
          O Gemini responde com um bloco de código JSON (com botão de copiar). Cole o
          conteúdo abaixo — ele é salvo automaticamente quando o JSON está completo.
        </p>
        <textarea
          value={pasteText}
          onChange={(e) => handlePaste(e.target.value)}
          rows={6}
          placeholder='[ { "data": "01/06/2026", "entradas_saidas": ["08:00", "12:00"] } ]'
          className={`w-full font-mono text-sm px-3 py-2 border rounded-md dark:bg-gray-700 dark:text-white focus:outline-none focus:ring-blue-500 focus:border-blue-500 ${
            pasteError ? 'border-red-500' : 'border-gray-300 dark:border-gray-600'
          }`}
        />
        {pasteError ? (
          <div className="mt-2 p-3 bg-red-100 border border-red-400 text-red-700 rounded text-sm">
            {pasteError}
          </div>
        ) : currentValid ? (
          <p className="mt-2 text-sm text-green-600 dark:text-green-400">
            ✓ Parte {currentIndex + 1} salva automaticamente.
          </p>
        ) : null}

        <div className="mt-3 flex flex-wrap items-center gap-2">
          <button
            onClick={() => goToPart(Math.max(0, currentIndex - 1))}
            disabled={currentIndex === 0}
            className="py-2 px-4 rounded font-medium bg-gray-200 dark:bg-gray-700 hover:bg-gray-300 dark:hover:bg-gray-600 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
          >
            ← Anterior
          </button>
          <button
            onClick={() => goToPart(Math.min(totalParts - 1, currentIndex + 1))}
            disabled={!currentValid || currentIndex === totalParts - 1}
            className="py-2 px-4 rounded font-medium bg-gray-200 dark:bg-gray-700 hover:bg-gray-300 dark:hover:bg-gray-600 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
          >
            Próxima →
          </button>
          {!currentValid && currentIndex < totalParts - 1 && (
            <span className="text-xs text-gray-500 dark:text-gray-400">
              Cole um JSON válido para avançar.
            </span>
          )}
        </div>
      </section>

      {/* Generate CSV */}
      <section className="border-t border-gray-200 dark:border-gray-700 pt-4">
        <button
          onClick={handleGenerateCsv}
          disabled={!allFilled}
          className="py-2 px-6 rounded font-bold bg-blue-600 hover:bg-blue-700 text-white disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
        >
          Gerar CSV ({filledCount}/{totalParts} partes)
        </button>
        {!allFilled && (
          <p className="mt-2 text-sm text-gray-500 dark:text-gray-400">
            Preencha todas as {totalParts} partes para gerar o CSV.
          </p>
        )}
        {doneMessage && (
          <div className="mt-3 p-3 bg-green-100 border border-green-400 text-green-700 rounded text-sm">
            {doneMessage}
          </div>
        )}
      </section>
    </main>
  );
};

export default ManualMode;
