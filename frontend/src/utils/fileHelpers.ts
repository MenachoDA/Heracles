export const formatBytes = (bytes: number, decimals = 2) => {
    if (!+bytes) return '0 Bytes';
    const k = 1024;
    const dm = decimals < 0 ? 0 : decimals;
    const sizes = ['Bytes', 'KB', 'MB', 'GB', 'TB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return `${parseFloat((bytes / Math.pow(k, i)).toFixed(dm))} ${sizes[i]}`;
};

const countXlsxRows = async (file: File): Promise<number | string> => {
    try {
        const arrayBuffer = await file.arrayBuffer();
        const bytes = new Uint8Array(arrayBuffer);
        const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);

        let eocdOffset = -1;
        for (let i = bytes.length - 22; i >= Math.max(0, bytes.length - 65557); i--) {
            if (view.getUint32(i, true) === 0x06054b50) {
                eocdOffset = i;
                break;
            }
        }
        if (eocdOffset === -1) return '-';

        const cdEntries = view.getUint16(eocdOffset + 10, true);
        let cdOffset = view.getUint32(eocdOffset + 16, true);

        for (let e = 0; e < cdEntries && cdOffset + 46 <= bytes.length; e++) {
            if (view.getUint32(cdOffset, true) !== 0x02014b50) break;
            const compression = view.getUint16(cdOffset + 10, true);
            const compressedSize = view.getUint32(cdOffset + 20, true);
            const nameLen = view.getUint16(cdOffset + 28, true);
            const extraLen = view.getUint16(cdOffset + 30, true);
            const commentLen = view.getUint16(cdOffset + 32, true);
            const localHeaderOffset = view.getUint32(cdOffset + 42, true);
            const name = new TextDecoder().decode(bytes.subarray(cdOffset + 46, cdOffset + 46 + nameLen));

            if (name === 'xl/worksheets/sheet1.xml') {
                const localNameLen = view.getUint16(localHeaderOffset + 26, true);
                const localExtraLen = view.getUint16(localHeaderOffset + 28, true);
                const dataStart = localHeaderOffset + 30 + localNameLen + localExtraLen;
                const compressed = bytes.subarray(dataStart, dataStart + compressedSize);
                let xmlText = '';

                if (compression === 0) {
                    xmlText = new TextDecoder().decode(compressed);
                } else if (compression === 8 && typeof DecompressionStream !== 'undefined') {
                    const ds = new DecompressionStream('deflate-raw');
                    const writer = ds.writable.getWriter();
                    writer.write(compressed);
                    writer.close();
                    xmlText = await new Response(ds.readable).text();
                }

                const matches = xmlText.match(/<row\b/g);
                if (matches && matches.length > 0) {
                    return (matches.length - 1).toLocaleString('en-US');
                }
                return 0;
            }
            cdOffset += 46 + nameLen + extraLen + commentLen;
        }
    } catch {
        // Fallback en caso de no poder leer la estructura interna del xlsx
    }
    return '-';
};

// Función rápida para estimar/contar líneas leyendo el CSV o Excel
export const countCsvRows = async (file: File): Promise<number | string> => {
    const ext = file.name.split('.').pop()?.toLowerCase();
    if (ext === 'xlsx') {
        return countXlsxRows(file);
    }
    if (ext === 'xls') {
        return '-';
    }

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