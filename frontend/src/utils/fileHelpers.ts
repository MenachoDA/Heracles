export const formatBytes = (bytes: number, decimals = 2) => {
    if (!+bytes) return '0 Bytes';
    const k = 1024;
    const dm = decimals < 0 ? 0 : decimals;
    const sizes = ['Bytes', 'KB', 'MB', 'GB', 'TB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return `${parseFloat((bytes / Math.pow(k, i)).toFixed(dm))} ${sizes[i]}`;
};

// Función rápida para estimar/contar líneas leyendo el CSV por chunks
export const countCsvRows = async (file: File): Promise<number> => {
    return new Promise((resolve) => {
        let count = 0;
        const chunkSize = 1024 * 1024; // 1MB chunks
        let offset = 0;
        const reader = new FileReader();

        reader.onload = (e) => {
            if (e.target?.result) {
                const text = e.target.result as string;
                for (let i = 0; i < text.length; i++) {
                    if (text[i] === '\n') count++;
                }
            }
            offset += chunkSize;
            if (offset < file.size) {
                readNextChunk();
            } else {
                resolve(count > 0 ? count - 1 : 0); // restamos 1 por la cabecera
            }
        };

        const readNextChunk = () => {
            const slice = file.slice(offset, offset + chunkSize);
            reader.readAsText(slice);
        };

        readNextChunk();
    });
};