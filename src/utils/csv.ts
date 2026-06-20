import type { TimecardRecord } from './gemini';

export const generateCsv = (records: TimecardRecord[]): string => {
  const headers = [
    'Data',
    'Entrada1', 'Saída1',
    'Entrada2', 'Saída2',
    'Entrada3', 'Saída3',
    'Entrada4', 'Saída4',
    'Entrada5', 'Saída5',
    'Entrada6', 'Saída6'
  ];

  // Helper to parse DD/MM/YYYY to a sortable date
  const parseDate = (dateStr: string) => {
    const [day, month, year] = dateStr.split('/').map(Number);
    return new Date(year, month - 1, day).getTime();
  };

  // Sort records chronologically
  const sortedRecords = [...records].sort((a, b) => parseDate(a.data) - parseDate(b.data));

  const rows = sortedRecords.map((record) => {
    const row = [record.data];
    // Add up to 12 slots, pad with empty strings
    for (let i = 0; i < 12; i++) {
      row.push(record.entradas_saidas[i] || '');
    }
    return row.join(';');
  });

  return [headers.join(';'), ...rows].join('\n');
};

// Derives the CSV filename from the source PDF name: same name, .csv extension.
export const csvNameFromPdf = (pdfName: string): string => {
  const base = pdfName.replace(/\.pdf$/i, '').trim();
  return `${base || 'cartao_de_ponto'}.csv`;
};

export const downloadCsv = (csvContent: string, fileName = 'cartao_de_ponto.csv') => {
  const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.setAttribute('href', url);
  link.setAttribute('download', fileName);
  link.style.visibility = 'hidden';
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
};
