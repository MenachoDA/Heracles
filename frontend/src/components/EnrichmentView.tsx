import React, { useState } from 'react';
import { Loader2 } from 'lucide-react';
import DropZone from './DropZone';
import FileCard from './FileCard';
import { countCsvRows } from '../utils/fileHelpers';
import { processFileService, type OutputMetadata, getDownloadUrl } from '../services/apiService';
import type { EnrichmentViewType } from './Sidebar';

interface InputFileMeta {
    file: File;
    name: string;
    size: number;
    rows: number | string;
    extension: string;
}

interface ViewConfig {
    title: string;
    actionLabel: string;
}

const VIEW_CONFIG: Record<EnrichmentViewType, ViewConfig> = {
    po: {
        title: 'Enriquecimiento PO',
        actionLabel: 'Enriquecer PO',
    },
    csf: {
        title: 'Enriquecimiento CSF',
        actionLabel: 'Enriquecer CSF',
    },
};

interface EnrichmentViewProps {
    type: EnrichmentViewType;
    isActive: boolean;
    onProcessSuccess?: () => void;
}

const EnrichmentView: React.FC<EnrichmentViewProps> = ({ type, isActive, onProcessSuccess }) => {
    const [inputFile, setInputFile] = useState<InputFileMeta | null>(null);
    const [outputFile, setOutputFile] = useState<OutputMetadata | null>(null);
    const [status, setStatus] = useState<'idle' | 'loading' | 'error'>('idle');
    const [errorMsg, setErrorMsg] = useState<string>('');

    const { title, actionLabel } = VIEW_CONFIG[type];

    const handleFileSelected = async (file: File) => {
        setOutputFile(null);
        setErrorMsg('');
        setStatus('idle');

        setInputFile({
            file,
            name: file.name,
            size: file.size,
            rows: 'Calculando...',
            extension: file.name.split('.').pop() || 'csv',
        });

        const rows = await countCsvRows(file);

        setInputFile((prev) => (prev ? { ...prev, rows } : null));
    };

    const handleProcess = async () => {
        if (!inputFile) return;

        setStatus('loading');
        setErrorMsg('');
        setOutputFile(null);

        try {
            const result = await processFileService(inputFile.file, type);
            setOutputFile(result);
            setStatus('idle');
            onProcessSuccess?.();
        } catch (error: unknown) {
            setStatus('error');
            const axiosError = error as { response?: { data?: { error?: string } } };
            setErrorMsg(
                axiosError.response?.data?.error ||
                    'Error de conexión con el servidor. Verifica que esté en ejecución.'
            );
        }
    };

    const handleDownload = () => {
        if (outputFile) {
            window.location.href = getDownloadUrl(outputFile.downloadId);
        }
    };

    const handleReset = () => {
        setInputFile(null);
        setOutputFile(null);
        setErrorMsg('');
        setStatus('idle');
    };

    return (
        <section className={isActive ? 'w-full flex flex-col items-center' : 'hidden'}>
            <header className="w-full max-w-2xl mb-6 text-center">
                <h1 className="text-3xl font-bold text-gray-800">{title}</h1>
            </header>

            {!inputFile && <DropZone onFileSelected={handleFileSelected} />}

            {inputFile && (
                <div className="w-full mt-6 space-y-8 animate-fade-in-up">
                    <FileCard
                        title="Archivo Original (Input)"
                        name={inputFile.name}
                        size={inputFile.size}
                        rows={inputFile.rows}
                        extension={inputFile.extension}
                        type="input"
                    />

                    {!outputFile && status !== 'loading' && (
                        <div className="flex flex-col items-center gap-3">
                            <button
                                type="button"
                                onClick={handleProcess}
                                className="bg-brand-yellow text-black font-semibold py-3 px-8 rounded-lg shadow-sm transition-all hover:scale-105 hover:shadow-lg active:scale-95"
                            >
                                {actionLabel}
                            </button>
                            <button
                                type="button"
                                onClick={handleReset}
                                className="text-sm text-gray-400 hover:text-gray-700 transition-colors underline"
                            >
                                Cambiar archivo
                            </button>
                        </div>
                    )}

                    {status === 'loading' && (
                        <div className="flex flex-col items-center justify-center py-10 space-y-4">
                            <Loader2 className="animate-spin text-brand-blue" size={48} />
                            <p className="text-gray-600 font-medium">
                                Ejecutando proceso de enriquecimiento en base de datos...
                            </p>
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
                                type="button"
                                onClick={handleReset}
                                className="text-sm text-gray-400 hover:text-gray-700 transition-colors underline"
                            >
                                Procesar otro archivo
                            </button>
                        </div>
                    )}
                </div>
            )}
        </section>
    );
};

export default EnrichmentView;
