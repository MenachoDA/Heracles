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

/**
 * Valida que el archivo para "Solicitar PO":
 * 1. Sea un archivo .csv
 * 2. Tenga la estructura [AAAA][MM][DD]Usftp665.csv
 * 3. La fecha [AAAA][MM][DD] sea válida y NO sea anterior a la fecha actual
 */
const validateSolicitarPoFile = (file: File): string | null => {
    const fileName = file.name.trim();

    if (!fileName.toLowerCase().endsWith('.csv')) {
        return 'El archivo debe ser de formato CSV (.csv).';
    }

    const match = fileName.match(/^(\d{4})(\d{2})(\d{2})Usftp665\.csv$/i);
    if (!match || !fileName.slice(8).startsWith('Usftp665.')) {
        return 'El nombre del archivo debe tener la estructura [AAAA][MM][DD]Usftp665.csv (por ejemplo: 20261123Usftp665.csv).';
    }

    const year = parseInt(match[1], 10);
    const month = parseInt(match[2], 10);
    const day = parseInt(match[3], 10);

    const fileDate = new Date(year, month - 1, day);
    if (
        fileDate.getFullYear() !== year ||
        fileDate.getMonth() !== month - 1 ||
        fileDate.getDate() !== day
    ) {
        return `La fecha indicada en el archivo (${match[1]}-${match[2]}-${match[3]}) no es una fecha calendario válida.`;
    }

    const now = new Date();
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());

    if (fileDate.getTime() < today.getTime()) {
        return `La fecha del archivo (${match[1]}-${match[2]}-${match[3]}) no puede ser anterior a la fecha actual.`;
    }

    return null;
};

const EnrichmentView: React.FC<EnrichmentViewProps> = ({ type, isActive, onProcessSuccess }) => {
    const [inputFile, setInputFile] = useState<InputFileMeta | null>(null);
    const [outputFile, setOutputFile] = useState<OutputMetadata | null>(null);
    const [status, setStatus] = useState<'idle' | 'loading' | 'error'>('idle');
    const [errorMsg, setErrorMsg] = useState<string>('');

    // Estados para el panel "Solicitar PO" (ubicado al costado izquierdo en la vista PO)
    const [solicitarFile, setSolicitarFile] = useState<InputFileMeta | null>(null);
    const [solicitarErrorMsg, setSolicitarErrorMsg] = useState<string>('');

    const { title, actionLabel } = VIEW_CONFIG[type];

    const handleSolicitarFileSelected = async (file: File) => {
        setSolicitarErrorMsg('');

        const validationError = validateSolicitarPoFile(file);
        if (validationError) {
            setSolicitarFile(null);
            setSolicitarErrorMsg(validationError);
            return;
        }

        setSolicitarFile({
            file,
            name: file.name,
            size: file.size,
            rows: 'Calculando...',
            extension: 'csv',
        });

        const rows = await countCsvRows(file);
        setSolicitarFile((prev) => (prev ? { ...prev, rows } : null));
    };

    const handleSolicitarFileRejected = (message: string) => {
        setSolicitarFile(null);
        setSolicitarErrorMsg(message);
    };

    const handleSolicitarProcess = () => {
        if (!solicitarFile) return;

        const validationError = validateSolicitarPoFile(solicitarFile.file);
        if (validationError) {
            setSolicitarErrorMsg(validationError);
            return;
        }

        // Acción en blanco por el momento: aquí se ejecutará el script de Solicitar PO
    };

    const handleSolicitarReset = () => {
        setSolicitarFile(null);
        setSolicitarErrorMsg('');
    };

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

    const renderEnrichmentPanel = () => (
        <div className="w-full flex flex-col items-center">
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
        </div>
    );

    const renderSolicitarPoPanel = () => (
        <div className="w-full flex flex-col items-center">
            <header className="w-full max-w-2xl mb-6 text-center">
                <h1 className="text-3xl font-bold text-gray-800">Solicitar PO</h1>
            </header>

            {!solicitarFile && (
                <DropZone
                    onFileSelected={handleSolicitarFileSelected}
                    onFileRejected={handleSolicitarFileRejected}
                    csvOnly
                    subtitle="Archivo CSV con formato [AAAA][MM][DD]Usftp665.csv"
                />
            )}

            {solicitarErrorMsg && (
                <div className="w-full max-w-xl mt-4 mx-auto p-4 bg-red-100 text-red-700 border border-red-200 rounded-lg text-center font-medium shadow-sm">
                    {solicitarErrorMsg}
                </div>
            )}

            {solicitarFile && (
                <div className="w-full mt-6 space-y-8 animate-fade-in-up">
                    <FileCard
                        title="Archivo Original (Input)"
                        name={solicitarFile.name}
                        size={solicitarFile.size}
                        rows={solicitarFile.rows}
                        extension={solicitarFile.extension}
                        type="input"
                    />

                    <div className="flex flex-col items-center gap-3">
                        <button
                            type="button"
                            onClick={handleSolicitarProcess}
                            className="bg-brand-yellow text-black font-semibold py-3 px-8 rounded-lg shadow-sm transition-all hover:scale-105 hover:shadow-lg active:scale-95"
                        >
                            Solicitar PO
                        </button>
                        <button
                            type="button"
                            onClick={handleSolicitarReset}
                            className="text-sm text-gray-400 hover:text-gray-700 transition-colors underline"
                        >
                            Cambiar archivo
                        </button>
                    </div>
                </div>
            )}
        </div>
    );

    return (
        <section className={isActive ? 'w-full flex flex-col items-center' : 'hidden'}>
            {type === 'po' ? (
                <div className="w-full max-w-7xl grid grid-cols-1 lg:grid-cols-2 gap-8 items-start">
                    {renderSolicitarPoPanel()}
                    {renderEnrichmentPanel()}
                </div>
            ) : (
                renderEnrichmentPanel()
            )}
        </section>
    );
};

export default EnrichmentView;
