import { PDFDocument } from 'pdf-lib';

/**
 * Splits a PDF file into chunks of a specified number of pages.
 * Returns an array of Base64 strings, each being a valid PDF.
 */
export const splitPdfIntoChunks = async (file: File, pagesPerChunk = 5): Promise<string[]> => {
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
