import React from 'react';
import { FileSpreadsheet, Download, FileText } from 'lucide-react';
import { formatBytes } from '../utils/fileHelpers';

interface FileCardProps {
    title: string;
    name: string;
    size: number;
    rows: number | string;
    extension: string;
    type: 'input' | 'output';
    onClick?: () => void;
}

const FileCard: React.FC<FileCardProps> = ({ title, name, size, rows, extension, type, onClick }) => {
    return (
        <div
            onClick={onClick}
            className={`w-full max-w-xl mx-auto p-6 rounded-2xl shadow-md border border-gray-100 flex items-center gap-6
            ${type === 'output' ? 'bg-green-50 cursor-pointer hover:bg-green-100 hover:shadow-lg transition-all border-green-200' : 'bg-white'}`}
        >
            <div className={`p-4 rounded-xl ${type === 'output' ? 'bg-green-500 text-white' : 'bg-brand-blue text-white'}`}>
                {type === 'output' ? <Download size={40} /> : <FileText size={40} />}
            </div>
            <div className="flex-1 overflow-hidden">
                <p className="text-sm font-semibold text-gray-500 mb-1">{title}</p>
                <h3 className="text-lg font-bold text-gray-800 truncate" title={name}>{name}</h3>
                <div className="flex items-center gap-4 mt-2 text-sm text-gray-600">
                    <span className="flex items-center gap-1"><FileSpreadsheet size={16} /> {formatBytes(size)}</span>
                    <span className="font-medium">•</span>
                    <span>{rows} Registros</span>
                    <span className="font-medium">•</span>
                    <span className="uppercase">{extension}</span>
                </div>
            </div>
        </div>
    );
};

export default FileCard;