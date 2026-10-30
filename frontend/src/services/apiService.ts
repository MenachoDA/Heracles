import axios from 'axios';

const API_URL = 'http://localhost:3001/api';

export interface OutputMetadata {
    name: string;
    size: number;
    rows: number | string;
    downloadId: string;
}

export const processFileService = async (file: File, type: 'po' | 'csf' | 'bn'): Promise<OutputMetadata> => {
    const formData = new FormData();
    formData.append('file', file);
    formData.append('type', type);

    const response = await axios.post(`${API_URL}/process`, formData, {
        headers: { 'Content-Type': 'multipart/form-data' }
    });

    return response.data.metadata;
};

export const getDownloadUrl = (downloadId: string) => {
    return `${API_URL}/download/${downloadId}`;
};