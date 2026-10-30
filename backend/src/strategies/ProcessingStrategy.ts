export interface OutputMetadata {
    name: string;
    size: number;
    rows: number | string;
    downloadId: string;
}

export interface ProcessingStrategy {
    execute(inputFilePath: string, originalName: string): Promise<OutputMetadata>;
}