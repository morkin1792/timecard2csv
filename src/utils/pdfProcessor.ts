import { PDFDocument } from 'pdf-lib';

/**
 * Splits a PDF file into chunks of a specified number of pages.
 * Returns an array of Base64 strings, each being a valid PDF.
 *
 * Default chunk size is tuned for the Gemini free tier, where requests-per-minute
 * (RPM ~20) is the binding limit, not tokens-per-minute (TPM ~250K). Larger chunks
 * mean fewer requests: at ~300 tokens/PDF page, 10 pages is ~3K tokens/request — far
 * under TPM — while a 100-page doc drops from 20 requests to 10, comfortably under RPM.
 * It can be pushed higher (~15-20) if extraction accuracy holds for your layout.
 */
export const splitPdfIntoChunks = async (file: File, pagesPerChunk = 10): Promise<string[]> => {
  const arrayBuffer = await file.arrayBuffer();
  const pdfDoc = await PDFDocument.load(arrayBuffer);
  const totalPages = pdfDoc.getPageCount();
  const chunks: string[] = [];

  for (let i = 0; i < totalPages; i += pagesPerChunk) {
    // Create a new PDF document for each chunk
    const chunkDoc = await PDFDocument.create();
    
    // Calculate the range of pages for this chunk
    const end = Math.min(i + pagesPerChunk, totalPages);
    const pagesToCopy = Array.from({ length: end - i }, (_, index) => i + index);
    
    // Copy pages from the original PDF
    const copiedPages = await chunkDoc.copyPages(pdfDoc, pagesToCopy);
    copiedPages.forEach((page) => chunkDoc.addPage(page));
    
    // Save the chunk as a Base64 string
    const chunkBase64 = await chunkDoc.saveAsBase64();
    chunks.push(chunkBase64);
  }

  return chunks;
};
