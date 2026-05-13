**Role and Objective:**
You are an expert frontend developer. Build a client-side web application hosted on GitHub Pages that extracts timesheet data from PDFs using the Google Generative AI SDK. Use React, Vite, and Tailwind CSS. The app must be fully client-side with no backend. 

**Phase 1: Project Setup & Dependencies**
1. Initialize a React project using Vite.
2. Install Tailwind CSS and configure it.
3. Install dependencies: 
   - `@google/generative-ai` (for the Gemini API)
   - `pdfjs-dist` (for PDF rendering)
   - `crypto-js` (for AES encryption of the API key)
4. Define a static, hardcoded encryption secret (e.g., `VITE_ENCRYPTION_SECRET="your_static_secret"`) in your `.env` file to be used by the frontend.

**Phase 2: Authentication UI & Storage**
1. Create a component to prompt the user for their Google Gemini API Key.
2. When the user submits the key, use `crypto-js` (AES) and your static secret to encrypt the API key string.
3. Store the *encrypted* string in `localStorage` under a static key name like `app_gemini_token`.
4. On app load, check if `app_gemini_token` exists. If it does, decrypt it using `crypto-js` and the static secret. If decryption succeeds, hold the plaintext key in the React state/memory and bypass the input screen.
5. If necessary, provide a clear visual link for the user to get their key: `https://aistudio.google.com/app/apikey`.

**Phase 3: PDF Processing (pdf.js)**
1. Create an upload input restricted to `.pdf`.
2. When a file is selected, use `pdfjs-dist` to load the document.
3. Create a utility function to iterate through the PDF pages. Render each page to an off-screen HTML `<canvas>` at a readable scale (e.g., 1.5 or 2.0).
4. Convert each canvas to a Base64 JPEG string (`canvas.toDataURL('image/jpeg')`). Strip the `data:image/jpeg;base64,` prefix.

**Phase 4: AI Integration & Batching**
1. Implement a batching mechanism. Split the Base64 images into chunks of 5 pages per batch to optimize memory and API payload limits.
2. For each batch, send a request to the `@google/generative-ai` SDK using the model `gemini-3.1-pro-preview`.
3. Use the following prompt for the AI:
   "
   Extraia os registros de ponto destas imagens. 
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
   "
4. **Rate Limiting & Retry:** Implement an exponential backoff function wrapping the API call. If a `429 Too Many Requests` error occurs, wait (e.g., 2s, 4s, 8s) and retry. 
5. Parse the returned JSON string safely. Handle potential JSON formatting errors natively without crashing the loop. Accumulate the parsed objects into a master array.
6. Display a progress bar or counter in the UI (e.g., "Processing batch 2 of 5...").

**Phase 5: CSV Generation & Download**
1. Once all batches are processed, map the master JSON array to the specific CSV structure.
2. Ensure every row has exactly 13 columns (Date + 12 time slots). If a day has fewer than 12 time slots, pad the rest with empty strings.
3. **CSV Headers:** `Data;Entrada1;Saída1;Entrada2;Saída2;Entrada3;Saída3;Entrada4;Saída4;Entrada5;Saída5;Entrada6;Saída6`
4. Create a Blob from the final CSV string (`type: 'text/csv;charset=utf-8;'`).
5. Create a hidden `<a>` tag, set the `href` to the Blob URL, trigger a click to download `cartao_de_ponto.csv`, and clean up the DOM.

**Constraints:**
- Write clean, modular, and modern React code (Hooks).
- Ensure `pdfjs-dist` worker is correctly configured for Vite.
- Do not use any server-side code.
