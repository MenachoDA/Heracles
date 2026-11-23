import React, { useCallback } from 'react';
import { useDropzone, type FileRejection, type Accept } from 'react-dropzone';
import { FolderUp } from 'lucide-react';

interface DropZoneProps {
    onFileSelected: (file: File) => void;
    csvOnly?: boolean;
    subtitle?: string;
    onFileRejected?: (message: string) => void;
}

const DropZone: React.FC<DropZoneProps> = ({
    onFileSelected,
    csvOnly = false,
    subtitle,
    onFileRejected
}) => {
    const onDrop = useCallback(
        (acceptedFiles: File[], fileRejections: FileRejection[]) => {
            if (fileRejections.length > 0) {
                if (onFileRejected) {
                    onFileRejected(
                        csvOnly
                            ? 'Formato no válido. El archivo debe ser únicamente CSV (.csv).'
                            : 'Formato no válido. Debe ser CSV o Excel (.csv, .xlsx, .xls).'
                    );
                }
                return;
            }
            if (acceptedFiles.length > 0) {
                onFileSelected(acceptedFiles[0]);
            }
        },
        [onFileSelected, onFileRejected, csvOnly]
    );

    const acceptConfig: Accept = csvOnly
        ? {
              'text/csv': ['.csv']
          }
        : {
              'text/csv': ['.csv'],
              'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': ['.xlsx'],
              'application/vnd.ms-excel': ['.xls']
          };

    const { getRootProps, getInputProps, isDragActive, isDragReject } = useDropzone({
        onDrop,
        accept: acceptConfig,
        maxFiles: 1
    });

    return (
        <div
            {...getRootProps()}
            className={`w-full max-w-2xl mt-4 mx-auto border-4 border-dashed rounded-3xl p-12 flex flex-col items-center justify-center cursor-pointer transition-colors bg-white
                ${isDragActive ? 'border-brand-blue bg-blue-50' : 'border-transparent'}
                ${isDragReject ? 'border-red-500 bg-red-50' : ''}`}
            style={{ minHeight: '350px', boxShadow: isDragActive ? 'none' : '0 4px 6px -1px rgb(0 0 0 / 0.05), 0 2px 4px -2px rgb(0 0 0 / 0.1)' }}
        >
            <input {...getInputProps()} />
            <FolderUp size={120} strokeWidth={1} className="text-blue-200 mb-6" />
            <h2 className="text-2xl font-bold text-brand-blue text-center">
                {isDragActive ? 'Suelta el archivo aquí' : 'Arrastrar o seleccionar un archivo'}
            </h2>
            <p className="text-gray-400 mt-3 text-sm text-center">
                {subtitle || (csvOnly ? 'Archivos CSV (.csv)' : 'Archivos CSV o Excel (.csv, .xlsx, .xls)')}
            </p>
            {isDragReject && (
                <p className="text-red-500 mt-2 font-medium text-center">
                    {csvOnly
                        ? 'Formato no válido. Debe ser un archivo CSV (.csv).'
                        : 'Formato no válido. Debe ser CSV o Excel (.csv, .xlsx, .xls).'}
                </p>
            )}
        </div>
    );
};

export default DropZone;