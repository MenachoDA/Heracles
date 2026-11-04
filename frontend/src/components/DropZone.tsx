import React, { useCallback } from 'react';
import { useDropzone } from 'react-dropzone';
import { FolderUp } from 'lucide-react';

interface DropZoneProps {
    onFileSelected: (file: File) => void;
}

const DropZone: React.FC<DropZoneProps> = ({ onFileSelected }) => {
    const onDrop = useCallback((acceptedFiles: File[]) => {
        if (acceptedFiles.length > 0) {
            onFileSelected(acceptedFiles[0]);
        }
    }, [onFileSelected]);

    const { getRootProps, getInputProps, isDragActive, isDragReject } = useDropzone({
        onDrop,
        accept: {
            'text/csv': ['.csv'],
            'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': ['.xlsx'],
            'application/vnd.ms-excel': ['.xls']
        },
        maxFiles: 1
    });

    return (
        <div
            {...getRootProps()}
            className={`w-full max-w-2xl mt-20 mx-auto border-4 border-dashed rounded-3xl p-16 flex flex-col items-center justify-center cursor-pointer transition-colors bg-white
                ${isDragActive ? 'border-brand-blue bg-blue-50' : 'border-transparent'}
                ${isDragReject ? 'border-red-500 bg-red-50' : ''}`}
            style={{ minHeight: '350px', boxShadow: isDragActive ? 'none' : '0 4px 6px -1px rgb(0 0 0 / 0.05), 0 2px 4px -2px rgb(0 0 0 / 0.1)' }}
        >
            <input {...getInputProps()} />
            <FolderUp size={120} strokeWidth={1} className="text-blue-200 mb-6" />
            <h2 className="text-2xl font-bold text-brand-blue text-center">
                {isDragActive ? 'Suelta el archivo aquí' : 'Arrastrar o seleccionar un archivo'}
            </h2>
            <p className="text-gray-400 mt-3 text-sm">Archivos CSV o Excel (.csv, .xlsx, .xls)</p>
            {isDragReject && <p className="text-red-500 mt-2 font-medium">Formato no válido. Debe ser CSV o Excel (.csv, .xlsx, .xls).</p>}
        </div>
    );
};

export default DropZone;