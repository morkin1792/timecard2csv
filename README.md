# Timecard2CSV

Timecard2CSV is a fully client-side web application designed to automate the extraction of timesheet data from PDF documents and convert them into a structured CSV format.

## How it works

The tool leverages the power of Google's Gemini AI to analyze PDF pages (converted to images) and accurately identify date and time entries. 

**Key Features:**
- **Privacy First:** All processing happens in your browser. Your PDFs never leave your machine except to be processed by the Gemini API.
- **AI-Powered Extraction:** Handles various PDF layouts by using vision-capable AI models.
- **Secure Key Storage:** Your Gemini API key is stored in your browser's local storage, encrypted with a static secret.
- **Easy Export:** Generates a standardized CSV file ready for import into spreadsheet software.

## Getting Started

### Prerequisites

- [Node.js](https://nodejs.org/) (latest LTS recommended)
- [npm](https://www.npmjs.com/) (usually comes with Node.js)
- A Google Gemini API Key. You can get one at [AI Studio](https://aistudio.google.com/app/apikey).

### Setup

1. **Clone the repository:**
   ```bash
   git clone <repository-url>
   cd timecard2csv
   ```

2. **Install dependencies:**
   ```bash
   npm install
   ```

3. **Configure environment variables:**
   Create a `.env` file in the root directory and add an encryption secret:
   ```env
   VITE_ENCRYPTION_SECRET=your_random_secret_here
   ```

### Running the Application

To start the development server:

```bash
npm run dev
```

The application will be available at `http://localhost:5173`.

### Building for Production

To create an optimized production build:

```bash
npm run build
```

The output will be in the `dist/` directory, ready to be hosted on services like GitHub Pages.
