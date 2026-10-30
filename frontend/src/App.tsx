import React, { useState } from 'react';
import TopBar from './components/TopBar';
import DropZone from './components/DropZone';
import FileCard from './components/FileCard';
import { countCsvRows } from './utils/fileHelpers';
import { processFileService, type OutputMetadata, getDownloadUrl } from './services/apiService';
import { Loader2 } from 'lucide-react';

interface InputFileMeta {
  file: File;
  name: string;
  size: number;
  rows: number | string;
  extension: string;
}

const App: React.FC = () => {
  const [inputFile, setInputFile] = useState<InputFileMeta | null>(null);
  const [outputFile, setOutputFile] = useState<OutputMetadata | null>(null);
  const [status, setStatus] = useState<'idle' | 'loading' | 'error'>('idle');
  const [errorMsg, setErrorMsg] = useState<string>('');

  const handleFileSelected = async (file: File) => {
    setOutputFile(null);
    setErrorMsg('');
    setStatus('idle');

    setInputFile({
      file,
      name: file.name,
      size: file.size,
      rows: 'Calculando...',
      extension: file.name.split('.').pop() || 'csv'
    });

    const rows = await countCsvRows(file);

    setInputFile(prev => prev ? { ...prev, rows } : null);
  };

  const handleProcess = async (type: 'po' | 'csf' | 'bn') => {
    if (!inputFile) return;

    setStatus('loading');
    setErrorMsg('');
    setOutputFile(null);

    try {
      const result = await processFileService(inputFile.file, type);
      setOutputFile(result);
      setStatus('idle');
    } catch (error: any) {
      setStatus('error');
      setErrorMsg(error.response?.data?.error || 'Error de conexión con el servidor. Verifica que esté en ejecución.');
    }
  };

  const handleDownload = () => {
    if (outputFile) {
      const url = getDownloadUrl(outputFile.downloadId);
      window.location.href = url;
    }
  };

  return (
    <div className="min-h-screen flex flex-col">
      <TopBar
        onAction={handleProcess}
        isDisabled={!inputFile || status === 'loading'}
      />

      <main className="flex-1 p-8 flex flex-col items-center">
        {!inputFile && (
          <DropZone onFileSelected={handleFileSelected} />
        )}

        {inputFile && (
          <div className="w-full mt-10 space-y-8 animate-fade-in-up">
            <FileCard
              title="Archivo Original (Input)"
              name={inputFile.name}
              size={inputFile.size}
              rows={inputFile.rows}
              extension={inputFile.extension}
              type="input"
            />

            {status === 'loading' && (
              <div className="flex flex-col items-center justify-center py-10 space-y-4">
                <Loader2 className="animate-spin text-brand-blue" size={48} />
                <p className="text-gray-600 font-medium">Ejecutando proceso de enriquecimiento en base de datos...</p>
              </div>
            )}

            {status === 'error' && (
              <div className="max-w-xl mx-auto p-4 bg-red-100 text-red-700 border border-red-200 rounded-lg text-center font-medium shadow-sm">
                {errorMsg}
              </div>
            )}

            {outputFile && status === 'idle' && (
              <div className="flex flex-col items-center space-y-3">
                <FileCard
                  title="Resultado Generado (Click para Descargar)"
                  name={outputFile.name}
                  size={outputFile.size}
                  rows={outputFile.rows}
                  extension="xlsx"
                  type="output"
                  onClick={handleDownload}
                />
                <button
                  onClick={() => { setInputFile(null); setOutputFile(null); }}
                  className="text-sm text-gray-400 hover:text-gray-700 transition-colors underline"
                >
                  Procesar otro archivo
                </button>
              </div>
            )}
          </div>
        )}
      </main>
    </div>
  );
};

export default App;