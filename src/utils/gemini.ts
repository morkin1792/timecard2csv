import { GoogleGenerativeAI } from '@google/generative-ai';
import type { Part } from '@google/generative-ai';

const TARGET_MODEL = 'gemini-3-flash-preview'; 
const FALLBACK_MODEL = 'gemini-3.1-pro-preview';

export interface TimecardRecord {
  data: string;
  entradas_saidas: string[];
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const fetchWithRetry = async (
  fn: () => Promise<any>,
  retries = 5,
  delay = 2000
): Promise<any> => {
  try {
    return await fn();
  } catch (error: any) {
    const status = error.status || (error.message?.match(/(\d{3})/) || [])[1];
    const isRetryable = status === '429' || status === '503' || status === 503 || status === 429;
    
    if (retries > 0 && isRetryable) {
      console.warn(`Gemini API error ${status}. Retrying in ${delay}ms... (${retries} attempts left)`);
      await sleep(delay);
      return fetchWithRetry(fn, retries - 1, delay * 2);
    }
    throw error;
  }
};

export const processPdfChunksWithGemini = async (
  apiKey: string,
  pdfChunks: string[],
  onProgress: (current: number, total: number) => void
): Promise<TimecardRecord[]> => {
  const genAI = new GoogleGenerativeAI(apiKey);
  let modelName = TARGET_MODEL;
  let model = genAI.getGenerativeModel({ model: modelName });

  const totalChunks = pdfChunks.length;
  let allRecords: TimecardRecord[] = [];

  for (let i = 0; i < totalChunks; i++) {
    onProgress(i + 1, totalChunks);
    const pdfBase64 = pdfChunks[i];

    const prompt = `
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

    const pdfPart: Part = {
      inlineData: {
        data: pdfBase64,
        mimeType: 'application/pdf',
      },
    };

    try {
      const result = await fetchWithRetry(() =>
        model.generateContent([prompt, pdfPart])
      );
      const response = await result.response;
      const text = response.text();
      const jsonMatch = text.match(/\[[\s\S]*\]/);
      const jsonStr = jsonMatch ? jsonMatch[0] : text;
      const records: TimecardRecord[] = JSON.parse(jsonStr);
      allRecords = [...allRecords, ...records];
    } catch (e: any) {
      if (modelName !== FALLBACK_MODEL) {
        console.warn(`Target model ${modelName} failed. Trying fallback model ${FALLBACK_MODEL}...`);
        modelName = FALLBACK_MODEL;
        model = genAI.getGenerativeModel({ model: modelName });
        
        try {
          const result = await fetchWithRetry(() =>
            model.generateContent([prompt, pdfPart])
          );
          const response = await result.response;
          const text = response.text();
          const jsonMatch = text.match(/\[[\s\S]*\]/);
          const jsonStr = jsonMatch ? jsonMatch[0] : text;
          const records: TimecardRecord[] = JSON.parse(jsonStr);
          allRecords = [...allRecords, ...records];
          continue; 
        } catch (fallbackError) {
          console.error('Fallback model also failed:', fallbackError);
          throw fallbackError;
        }
      }
      console.error('Error processing chunk:', e);
      throw e;
    }
  }

  return allRecords;
};
