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

export interface DashboardFileMetadata {
    id: string;
    name: string;
    rawName: string;
    source: 'uploads' | 'outputs';
    processType: 'po' | 'csf';
    rows: number;
    size: number;
    timestamp: number;
    date: string;
}

export interface DailyTimelinePoint {
    date: string;
    uploadsFiles: number;
    outputsFiles: number;
    totalFiles: number;
    poFiles: number;
    csfFiles: number;
    uploadsRecords: number;
    outputsRecords: number;
    totalRecords: number;
    poRecords: number;
    csfRecords: number;
}

export interface DashboardStatsResponse {
    summary: {
        totalFiles: number;
        uploadsFiles: number;
        outputsFiles: number;
        rawUploadsFilesOnDisk: number;
        poFiles: number;
        csfFiles: number;
        poUploadsFiles: number;
        poOutputsFiles: number;
        csfUploadsFiles: number;
        csfOutputsFiles: number;
        totalRecords: number;
        uploadsRecords: number;
        outputsRecords: number;
        poRecords: number;
        csfRecords: number;
        poUploadsRecords: number;
        poOutputsRecords: number;
        csfUploadsRecords: number;
        csfOutputsRecords: number;
    };
    timeline: DailyTimelinePoint[];
    files: DashboardFileMetadata[];
    updatedAt: string;
}

export const getDashboardStatsService = async (): Promise<DashboardStatsResponse> => {
    const response = await axios.get<DashboardStatsResponse>(`${API_URL}/dashboard`);
    return response.data;
};