import fs from 'fs';
import path from 'path';
import zlib from 'zlib';
import sql from 'mssql';
import * as XLSXNs from 'xlsx';

const XLSX: typeof XLSXNs = (XLSXNs as any).default || XLSXNs;

export interface CsvData {
    columns: string[];
    rows: (string | null)[][];
}

/**
 * Replica la lógica de backend/scripts/excel_csv.py:
 * Convierte un archivo Excel (.xlsx / .xls) a CSV con codificación utf-8-sig
 * manteniendo los ceros a la izquierda en documentos (DNI / RUC).
 */
export const convertirExcelACsv = (rutaExcel: string): string => {
    if (!fs.existsSync(rutaExcel)) {
        throw new Error(`El archivo Excel no existe: ${rutaExcel}`);
    }

    const parsed = path.parse(rutaExcel);
    const rutaCsv = path.join(parsed.dir, `${parsed.name}.csv`);

    try {
        const workbook = XLSX.readFile(rutaExcel);
        const firstSheetName = workbook.SheetNames[0];
        if (!firstSheetName) {
            throw new Error('El archivo Excel no contiene hojas válidas.');
        }

        const worksheet = workbook.Sheets[firstSheetName];
        const range = XLSX.utils.decode_range(worksheet['!ref'] || 'A1');

        for (let R = range.s.r; R <= range.e.r; ++R) {
            for (let C = range.s.c; C <= range.e.c; ++C) {
                const addr = XLSX.utils.encode_cell({ r: R, c: C });
                const cell = worksheet[addr];
                if (!cell) continue;

                if (cell.t === 'n') {
                    // Si tiene formato con ceros a la izquierda (ej. DNI "00000000"), preservar el texto formateado
                    if (cell.w && /^0\d+$/.test(cell.w.trim())) {
                        cell.w = cell.w.trim();
                    } else if (cell.v !== undefined) {
                        cell.w = String(cell.v);
                    }
                } else if (cell.w !== undefined || cell.v !== undefined) {
                    const strVal = String(cell.w ?? cell.v ?? '').replace(/\r?\n/g, ' ');
                    cell.w = strVal;
                    if (cell.t === 's') {
                        cell.v = strVal;
                    }
                }
            }
        }

        const csvContent = XLSX.utils.sheet_to_csv(worksheet, {
            FS: ',',
            RS: '\n',
            blankrows: false
        });

        // Escribir con BOM UTF-8 (equivalente a encoding='utf-8-sig' en pandas)
        fs.writeFileSync(rutaCsv, '\uFEFF' + csvContent, 'utf8');
        console.log('Archivo convertido');
        return rutaCsv;
    } catch (error) {
        console.error('Ocurrió un error al convertir el archivo:', error);
        throw new Error('Ocurrió un error al convertir el archivo Excel a CSV.');
    }
};

/**
 * Extrae la sentencia SQL asignada a QUERY_CRUCE dentro de un script en backend/scripts.
 */
export const loadQueryFromScript = (scriptFileName: string, fallbackQuery: string): string => {
    try {
        const scriptPath = path.join(__dirname, '../../scripts', scriptFileName);
        if (fs.existsSync(scriptPath)) {
            const content = fs.readFileSync(scriptPath, 'utf-8');
            const match = content.match(/QUERY_CRUCE\s*=\s*"""([\s\S]*?)"""/);
            if (match && match[1]?.trim()) {
                return match[1].trim();
            }
        }
    } catch (err) {
        console.warn(`No se pudo leer QUERY_CRUCE desde ${scriptFileName}, usando query por defecto:`, err);
    }
    return fallbackQuery.trim();
};

/**
 * Parsea una línea CSV respetando comillas dobles.
 */
function parseCsvLine(line: string, delimiter: string): string[] {
    const result: string[] = [];
    let current = '';
    let inQuotes = false;

    for (let i = 0; i < line.length; i++) {
        const char = line[i];
        if (char === '"') {
            if (inQuotes && line[i + 1] === '"') {
                current += '"';
                i++;
            } else {
                inQuotes = !inQuotes;
            }
        } else if (char === delimiter && !inQuotes) {
            result.push(current);
            current = '';
        } else {
            current += char;
        }
    }
    result.push(current);
    return result;
}

/**
 * Detecta la codificación del archivo (UTF-8 con/sin BOM o Latin1) y el delimitador (',', ';', '\t', '|'),
 * manteniendo todos los valores como string para no perder ceros a la izquierda en los DNI.
 * Si se indica `applyPoCleaning = true`, aplica en una sola pasada la limpieza de PO
 * (eliminación de TEXTO01..20 y filtrado de 'SIN OFERTA') almacenando filas compactas por índice
 * en lugar de objetos por fila para minimizar drásticamente el consumo de memoria RAM.
 */
export const readCsvFile = (filePath: string, applyPoCleaning = false): CsvData => {
    console.log(`Leyendo archivo en: ${filePath}`);
    const buffer = fs.readFileSync(filePath);

    // Detectar si es UTF-8 válido o Latin1 (por ejemplo, 'Campaña' con byte 0xF1 en latin1/cp1252)
    let text = buffer.toString('utf8');
    let encodingUsed = 'utf-8';
    if (text.charCodeAt(0) === 0xfeff) {
        text = text.slice(1);
        encodingUsed = 'utf-8-sig';
    } else if (text.includes('\uFFFD')) {
        text = buffer.toString('latin1');
        encodingUsed = 'latin1';
    }

    // Encontrar la primera línea no vacía sin duplicar todo el archivo en un arreglo gigante de líneas
    let pos = 0;
    const len = text.length;
    let firstLine = '';

    while (pos < len) {
        let nextNL = text.indexOf('\n', pos);
        if (nextNL === -1) nextNL = len;
        let line = text.slice(pos, nextNL);
        if (line.endsWith('\r')) line = line.slice(0, -1);
        pos = nextNL + 1;
        if (line.trim().length > 0) {
            firstLine = line;
            break;
        }
    }

    if (!firstLine) {
        throw new Error('El archivo CSV está vacío.');
    }

    const delimiters = [',', ';', '\t', '|'];
    let selectedDelimiter = ',';

    for (const sep of delimiters) {
        const sampleCols = parseCsvLine(firstLine, sep);
        if (sampleCols.length > 1) {
            selectedDelimiter = sep;
            break;
        }
    }

    const rawHeaders = parseCsvLine(firstLine, selectedDelimiter).map((h) => h.trim());
    const initialCols = rawHeaders.filter((h) => h.length > 0).length;

    const textTargets = new Set<string>();
    if (applyPoCleaning) {
        for (let i = 1; i <= 20; i++) {
            textTargets.add(`TEXTO${String(i).padStart(2, '0')}`);
            textTargets.add(`TEXTO${i}`);
        }
    }

    const keptIndices: number[] = [];
    const keptColumns: string[] = [];
    const droppedTextCols: string[] = [];

    for (let c = 0; c < rawHeaders.length; c++) {
        const h = rawHeaders[c];
        if (!h) continue;
        const colName = applyPoCleaning ? h.toUpperCase() : h;
        if (applyPoCleaning && textTargets.has(colName)) {
            droppedTextCols.push(colName);
            continue;
        }
        keptIndices.push(c);
        keptColumns.push(colName);
    }

    const campanaIdxInKept = applyPoCleaning
        ? keptColumns.findIndex((c) => ['CAMPAÑA', 'CAMPANA', 'CAMPAÑA_OFERTA'].includes(c))
        : -1;

    const rows: (string | null)[][] = [];
    let totalRawRows = 0;
    let sinOfertaCount = 0;

    while (pos < len) {
        let nextNL = text.indexOf('\n', pos);
        if (nextNL === -1) nextNL = len;
        let line = text.slice(pos, nextNL);
        if (line.endsWith('\r')) line = line.slice(0, -1);
        pos = nextNL + 1;

        if (line.trim().length === 0) continue;
        totalRawRows++;

        const values = parseCsvLine(line, selectedDelimiter);
        const rowArr = new Array<string | null>(keptIndices.length);

        for (let k = 0; k < keptIndices.length; k++) {
            const c = keptIndices[k];
            const rawVal = values[c] !== undefined ? values[c].trim() : '';
            if (
                rawVal === '' ||
                (applyPoCleaning && (rawVal === 'nan' || rawVal === '<NA>' || rawVal === 'None'))
            ) {
                rowArr[k] = null;
            } else {
                rowArr[k] = rawVal;
            }
        }

        if (campanaIdxInKept !== -1) {
            const campanaVal = (rowArr[campanaIdxInKept] ?? '').toUpperCase();
            if (campanaVal === 'SIN OFERTA') {
                sinOfertaCount++;
                continue;
            }
        }

        rows.push(rowArr);
    }

    console.log(
        `Archivo cargado exitosamente (Codificación: ${encodingUsed}, Separador: '${selectedDelimiter}', Filas: ${totalRawRows.toLocaleString()}, Columnas: ${initialCols})`
    );

    if (applyPoCleaning) {
        if (droppedTextCols.length > 0) {
            console.log(`Columnas de texto eliminadas (${droppedTextCols.length}): ${droppedTextCols.join(', ')}`);
        }
        if (campanaIdxInKept !== -1) {
            console.log(`Registros con 'Sin Oferta' eliminados: ${sinOfertaCount.toLocaleString()}`);
        }
        console.log(
            `Datos transformados: ${rows.length.toLocaleString()} filas (antes: ${totalRawRows.toLocaleString()}), ${keptColumns.length} columnas (antes: ${initialCols})`
        );
    }

    return {
        columns: keptColumns,
        rows
    };
};

/**
 * Replica la función Limpieza(df) de backend/scripts/pegado_oferta.py si no se aplicó durante readCsvFile.
 */
export const cleanPoData = (data: CsvData): CsvData => {
    const initialRows = data.rows.length;
    const initialCols = data.columns.length;

    const upperColumns = data.columns.map((c) => c.trim().toUpperCase());

    const textTargets = new Set<string>();
    for (let i = 1; i <= 20; i++) {
        textTargets.add(`TEXTO${String(i).padStart(2, '0')}`);
        textTargets.add(`TEXTO${i}`);
    }

    const keptIndices: number[] = [];
    const keptColumns: string[] = [];
    const droppedTextCols: string[] = [];

    for (let i = 0; i < upperColumns.length; i++) {
        const col = upperColumns[i];
        if (textTargets.has(col)) {
            droppedTextCols.push(col);
        } else {
            keptIndices.push(i);
            keptColumns.push(col);
        }
    }

    if (droppedTextCols.length > 0) {
        console.log(`Columnas de texto eliminadas (${droppedTextCols.length}): ${droppedTextCols.join(', ')}`);
    }

    const campanaIdx = keptColumns.findIndex((c) =>
        ['CAMPAÑA', 'CAMPANA', 'CAMPAÑA_OFERTA'].includes(c)
    );

    let sinOfertaCount = 0;
    const cleanedRows: (string | null)[][] = [];

    for (let r = 0; r < data.rows.length; r++) {
        const rawRow = data.rows[r];
        const normalizedRow = new Array<string | null>(keptIndices.length);

        for (let k = 0; k < keptIndices.length; k++) {
            let val = rawRow[keptIndices[k]] ?? null;
            if (val !== null) {
                val = String(val).trim();
                if (val === '' || val === 'nan' || val === '<NA>' || val === 'None') {
                    val = null;
                }
            }
            normalizedRow[k] = val;
        }

        if (campanaIdx !== -1) {
            const campanaVal = (normalizedRow[campanaIdx] ?? '').toUpperCase();
            if (campanaVal === 'SIN OFERTA') {
                sinOfertaCount++;
                continue;
            }
        }

        cleanedRows.push(normalizedRow);
    }

    if (campanaIdx !== -1) {
        console.log(`Registros con 'Sin Oferta' eliminados: ${sinOfertaCount.toLocaleString()}`);
    }

    console.log(
        `Datos transformados: ${cleanedRows.length.toLocaleString()} filas (antes: ${initialRows.toLocaleString()}), ${keptColumns.length} columnas (antes: ${initialCols})`
    );

    return {
        columns: keptColumns,
        rows: cleanedRows
    };
};

/**
 * Elimina la tabla temporal de SQL Server si existe.
 */
export const dropTableSql = async (pool: sql.ConnectionPool, tableName: string): Promise<void> => {
    console.log(`Eliminando la tabla '${tableName}' de SQL Server...`);
    await pool.request().query(`DROP TABLE IF EXISTS ${tableName}`);
    console.log(`Tabla '${tableName}' eliminada exitosamente.`);
};

/**
 * Sube las filas a SQL Server creando la tabla temporal y haciendo inserción por lotes (chunksize = 2000).
 */
export const uploadTableToSql = async (
    pool: sql.ConnectionPool,
    tableName: string,
    data: CsvData
): Promise<void> => {
    console.log(`Subiendo ${data.rows.length.toLocaleString()} registros a la tabla '${tableName}' en SQL Server...`);

    await pool.request().query(`DROP TABLE IF EXISTS ${tableName}`);

    // Crear tabla explícitamente con columnas NVARCHAR(255) (igual que String(255) en pegado_oferta.py)
    const colDefs = data.columns.map((col) => `[${col.replace(/\]/g, ']]')}] NVARCHAR(255) NULL`).join(', ');
    await pool.request().query(`CREATE TABLE ${tableName} (${colDefs})`);

    const chunkSize = 2000;
    for (let i = 0; i < data.rows.length; i += chunkSize) {
        const chunk = data.rows.slice(i, i + chunkSize);
        const table = new sql.Table(tableName);
        table.create = false;

        for (const col of data.columns) {
            table.columns.add(col, sql.NVarChar(255), { nullable: true });
        }

        for (const row of chunk) {
            const rowValues = new Array<string | null>(data.columns.length);
            for (let c = 0; c < data.columns.length; c++) {
                const val = row[c];
                if (val === undefined || val === null || val === '') {
                    rowValues[c] = null;
                } else {
                    rowValues[c] = String(val).slice(0, 255);
                }
            }
            table.rows.add(...rowValues);
        }

        await pool.request().bulk(table);
    }

    // Liberar las filas en memoria tras finalizar la subida a SQL Server
    data.rows.length = 0;

    console.log(`Carga completa en la tabla '${tableName}'.`);
};

function escapeXml(str: string): string {
    // Escapar caracteres XML especiales y limpiar caracteres de control inválidos en XML 1.0
    return str
        .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F]/g, '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&apos;');
}

function getExcelColumnName(colIndex: number): string {
    let dividend = colIndex + 1;
    let columnName = '';
    while (dividend > 0) {
        const modulo = (dividend - 1) % 26;
        columnName = String.fromCharCode(65 + modulo) + columnName;
        dividend = Math.floor((dividend - modulo) / 26);
    }
    return columnName;
}

function formatCellValue(val: any): string {
    if (val === null || val === undefined) {
        return '';
    }
    if (val instanceof Date) {
        const day = String(val.getUTCDate()).padStart(2, '0');
        const month = String(val.getUTCMonth() + 1).padStart(2, '0');
        const year = val.getUTCFullYear();
        return `${day}/${month}/${year}`;
    }
    return String(val);
}

const CRC32_TABLE = (() => {
    const table = new Uint32Array(256);
    for (let i = 0; i < 256; i++) {
        let c = i;
        for (let k = 0; k < 8; k++) {
            c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
        }
        table[i] = c >>> 0;
    }
    return table;
})();

function crc32Update(crc: number, buf: Buffer): number {
    let c = (crc ^ 0xffffffff) >>> 0;
    for (let i = 0; i < buf.length; i++) {
        c = CRC32_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
    }
    return (c ^ 0xffffffff) >>> 0;
}

interface ZipEntryRecord {
    nameBuf: Buffer;
    crc32: number;
    compressedSize: number;
    uncompressedSize: number;
    localHeaderOffset: number;
    compressionMethod: number;
}

/**
 * Escritor ZIP por streaming sin mantener el archivo completo en RAM.
 * Soporta entradas estáticas en memoria y entradas comprimidas por stream (DeflateRaw)
 * con reservas de Local File Header actualizadas al finalizar cada entrada, de modo
 * que tanto Excel como lectores basados en offsets locales (ej. getXlsxRowCountFast) funcionen al 100%.
 */
class StreamingZipWriter {
    private fd: number;
    private offset = 0;
    private entries: ZipEntryRecord[] = [];

    constructor(outputPath: string) {
        this.fd = fs.openSync(outputPath, 'w');
    }

    private writeBufferAt(buf: Buffer, pos?: number): void {
        if (pos !== undefined) {
            fs.writeSync(this.fd, buf, 0, buf.length, pos);
        } else {
            fs.writeSync(this.fd, buf, 0, buf.length, this.offset);
            this.offset += buf.length;
        }
    }

    public addStaticEntry(name: string, content: string | Buffer): void {
        const nameBuf = Buffer.from(name, 'utf8');
        const rawBuf = typeof content === 'string' ? Buffer.from(content, 'utf8') : content;
        const crc = crc32Update(0, rawBuf);
        const compressedBuf = zlib.deflateRawSync(rawBuf);

        const localHeaderOffset = this.offset;
        const header = Buffer.alloc(30);
        header.writeUInt32LE(0x04034b50, 0); // Local file header signature
        header.writeUInt16LE(20, 4); // Version needed to extract (2.0)
        header.writeUInt16LE(0, 6); // General purpose bit flag
        header.writeUInt16LE(8, 8); // Compression method: 8 (Deflate)
        header.writeUInt16LE(0, 10); // Last mod file time
        header.writeUInt16LE(0, 12); // Last mod file date
        header.writeUInt32LE(crc, 14); // CRC-32
        header.writeUInt32LE(compressedBuf.length, 18); // Compressed size
        header.writeUInt32LE(rawBuf.length, 22); // Uncompressed size
        header.writeUInt16LE(nameBuf.length, 26); // File name length
        header.writeUInt16LE(0, 28); // Extra field length

        this.writeBufferAt(header);
        this.writeBufferAt(nameBuf);
        this.writeBufferAt(compressedBuf);

        this.entries.push({
            nameBuf,
            crc32: crc,
            compressedSize: compressedBuf.length,
            uncompressedSize: rawBuf.length,
            localHeaderOffset,
            compressionMethod: 8
        });
    }

    public async addDeflatedStreamEntry(
        name: string,
        produceChunks: (pushChunk: (str: string) => Promise<void>) => Promise<void>
    ): Promise<void> {
        const nameBuf = Buffer.from(name, 'utf8');
        const localHeaderOffset = this.offset;

        // Escribir cabecera local con CRC y tamaños provisionales en 0 (se parchean al terminar el stream)
        const header = Buffer.alloc(30);
        header.writeUInt32LE(0x04034b50, 0);
        header.writeUInt16LE(20, 4);
        header.writeUInt16LE(0, 6);
        header.writeUInt16LE(8, 8); // Deflate
        header.writeUInt16LE(0, 10);
        header.writeUInt16LE(0, 12);
        header.writeUInt32LE(0, 14); // CRC placeholder
        header.writeUInt32LE(0, 18); // Compressed size placeholder
        header.writeUInt32LE(0, 22); // Uncompressed size placeholder
        header.writeUInt16LE(nameBuf.length, 26);
        header.writeUInt16LE(0, 28);

        this.writeBufferAt(header);
        this.writeBufferAt(nameBuf);

        let crc = 0;
        let uncompressedSize = 0;
        let compressedSize = 0;

        const deflate = zlib.createDeflateRaw({ level: zlib.constants.Z_DEFAULT_COMPRESSION });

        deflate.on('data', (chunk: Buffer) => {
            this.writeBufferAt(chunk);
            compressedSize += chunk.length;
        });

        const deflateDone = new Promise<void>((resolve, reject) => {
            deflate.on('end', () => resolve());
            deflate.on('error', (err) => reject(err));
        });

        const pushChunk = async (str: string): Promise<void> => {
            const buf = Buffer.from(str, 'utf8');
            crc = crc32Update(crc, buf);
            uncompressedSize += buf.length;
            if (!deflate.write(buf)) {
                await new Promise<void>((resolve) => deflate.once('drain', resolve));
            }
        };

        await produceChunks(pushChunk);
        deflate.end();
        await deflateDone;

        // Parchear CRC-32 y tamaños en el Local File Header
        const patch = Buffer.alloc(12);
        patch.writeUInt32LE(crc, 0);
        patch.writeUInt32LE(compressedSize, 4);
        patch.writeUInt32LE(uncompressedSize >>> 0, 8);
        this.writeBufferAt(patch, localHeaderOffset + 14);

        this.entries.push({
            nameBuf,
            crc32: crc,
            compressedSize,
            uncompressedSize: uncompressedSize >>> 0,
            localHeaderOffset,
            compressionMethod: 8
        });
    }

    public close(): void {
        try {
            const cdStartOffset = this.offset;
            for (const entry of this.entries) {
                const cdHeader = Buffer.alloc(46);
                cdHeader.writeUInt32LE(0x02014b50, 0); // Central directory file header signature
                cdHeader.writeUInt16LE(20, 4); // Version made by
                cdHeader.writeUInt16LE(20, 6); // Version needed to extract
                cdHeader.writeUInt16LE(0, 8); // General purpose bit flag
                cdHeader.writeUInt16LE(entry.compressionMethod, 10); // Compression method
                cdHeader.writeUInt16LE(0, 12); // Last mod file time
                cdHeader.writeUInt16LE(0, 14); // Last mod file date
                cdHeader.writeUInt32LE(entry.crc32, 16); // CRC-32
                cdHeader.writeUInt32LE(entry.compressedSize, 20); // Compressed size
                cdHeader.writeUInt32LE(entry.uncompressedSize, 24); // Uncompressed size
                cdHeader.writeUInt16LE(entry.nameBuf.length, 28); // File name length
                cdHeader.writeUInt16LE(0, 30); // Extra field length
                cdHeader.writeUInt16LE(0, 32); // File comment length
                cdHeader.writeUInt16LE(0, 34); // Disk number start
                cdHeader.writeUInt16LE(0, 36); // Internal file attributes
                cdHeader.writeUInt32LE(0, 38); // External file attributes
                cdHeader.writeUInt32LE(entry.localHeaderOffset, 42); // Relative offset of local header

                this.writeBufferAt(cdHeader);
                this.writeBufferAt(entry.nameBuf);
            }

            const cdSize = this.offset - cdStartOffset;
            const eocd = Buffer.alloc(22);
            eocd.writeUInt32LE(0x06054b50, 0); // End of central directory signature
            eocd.writeUInt16LE(0, 4); // Number of this disk
            eocd.writeUInt16LE(0, 6); // Disk where central directory starts
            eocd.writeUInt16LE(this.entries.length, 8); // Number of central directory records on this disk
            eocd.writeUInt16LE(this.entries.length, 10); // Total number of central directory records
            eocd.writeUInt32LE(cdSize, 12); // Size of central directory
            eocd.writeUInt32LE(cdStartOffset, 16); // Offset of start of central directory
            eocd.writeUInt16LE(0, 20); // Comment length

            this.writeBufferAt(eocd);
        } finally {
            fs.closeSync(this.fd);
        }
    }
}

/**
 * Ejecuta la query de cruce (RENIEC y Celulares) en SQL Server en modo STREAMING y exporta
 * directamente los resultados a un archivo Excel (.xlsx) a medida que llegan las filas,
 * sin almacenar las 300,000+ filas ni el árbol DOM de SheetJS en la memoria RAM de Node.js.
 */
export const executeEnrichmentAndExportToExcel = async (
    pool: sql.ConnectionPool,
    query: string,
    outputExcelPath: string,
    sheetName = 'BASE',
    expectedRowCount = 0
): Promise<number> => {
    console.log('Ejecutando consulta SQL para cruce con RENIEC y Celulares...');

    const zip = new StreamingZipWriter(outputExcelPath);
    let totalRows = 0;

    try {
        // 1. Archivos XML estáticos del paquete OpenXML (.xlsx)
        zip.addStaticEntry(
            '_rels/.rels',
            '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n' +
                '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
                '<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/>' +
                '<Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/extended-properties" Target="docProps/app.xml"/>' +
                '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>' +
                '</Relationships>'
        );

        zip.addStaticEntry(
            'docProps/core.xml',
            '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n' +
                '<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" ' +
                'xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" ' +
                'xmlns:dcmitype="http://purl.org/dc/dcmitype/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"/>'
        );

        zip.addStaticEntry(
            'docProps/app.xml',
            '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n' +
                '<Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties" ' +
                'xmlns:vt="http://schemas.openxmlformats.org/officeDocument/2006/docPropsVTypes">' +
                '<Application>Heracles</Application>' +
                '<HeadingPairs><vt:vector size="2" baseType="variant"><vt:variant><vt:lpstr>Worksheets</vt:lpstr></vt:variant><vt:variant><vt:i4>1</vt:i4></vt:variant></vt:vector></HeadingPairs>' +
                `<TitlesOfParts><vt:vector size="1" baseType="lpstr"><vt:lpstr>${escapeXml(sheetName)}</vt:lpstr></vt:vector></TitlesOfParts>` +
                '</Properties>'
        );

        zip.addStaticEntry(
            'xl/_rels/workbook.xml.rels',
            '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n' +
                '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
                '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/>' +
                '<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>' +
                '</Relationships>'
        );

        zip.addStaticEntry(
            'xl/workbook.xml',
            '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n' +
                '<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" ' +
                'xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">' +
                '<workbookPr codeName="ThisWorkbook"/>' +
                `<sheets><sheet name="${escapeXml(sheetName)}" sheetId="1" r:id="rId1"/></sheets>` +
                '</workbook>'
        );

        zip.addStaticEntry(
            'xl/styles.xml',
            '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n' +
                '<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">' +
                '<fonts count="1"><font><sz val="11"/><name val="Calibri"/><family val="2"/></font></fonts>' +
                '<fills count="2"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill></fills>' +
                '<borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders>' +
                '<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>' +
                '<cellXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/></cellXfs>' +
                '<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>' +
                '</styleSheet>'
        );

        // 2. Generar xl/worksheets/sheet1.xml directamente desde el stream de SQL Server
        // Nota: El archivo xl/worksheets/sheet1.xml se escribe antes de [Content_Types].xml
        // para que su entrada en el Central Directory quede en los últimos 64KB y getXlsxRowCountFast lo lea al instante.
        await zip.addDeflatedStreamEntry('xl/worksheets/sheet1.xml', async (pushChunk) => {
            await new Promise<void>((resolve, reject) => {
                const req = pool.request();
                req.stream = true;

                let columns: string[] = [];
                let colLetters: string[] = [];
                let headerWritten = false;
                let xmlBuffer = '';
                let chain = Promise.resolve();
                let isPaused = false;
                let isSettled = false;

                const safeReject = (err: Error) => {
                    if (isSettled) return;
                    isSettled = true;
                    try {
                        req.cancel();
                    } catch {
                        // Ignorar
                    }
                    reject(err);
                };

                const queueWrite = (str: string, forceFlush = false) => {
                    if (isSettled) return;
                    xmlBuffer += str;
                    if (xmlBuffer.length >= 256 * 1024 || forceFlush) {
                        const toWrite = xmlBuffer;
                        xmlBuffer = '';
                        if (!isPaused && !forceFlush) {
                            isPaused = true;
                            req.pause();
                        }
                        chain = chain
                            .then(() => {
                                if (isSettled) return;
                                return pushChunk(toWrite);
                            })
                            .then(() => {
                                if (isPaused && !forceFlush && !isSettled) {
                                    isPaused = false;
                                    req.resume();
                                }
                            })
                            .catch((err) => {
                                safeReject(err);
                            });
                    }
                };

                const ensureHeaderWritten = (expectedRowCount = 0) => {
                    if (headerWritten) return;
                    headerWritten = true;
                    colLetters = columns.map((_, idx) => getExcelColumnName(idx));
                    const lastColLetter = colLetters.length > 0 ? colLetters[colLetters.length - 1] : 'A';
                    const dimLastRow = Math.max(1, expectedRowCount + 1);
                    let headXml =
                        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n' +
                        '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" ' +
                        'xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">' +
                        `<dimension ref="A1:${lastColLetter}${dimLastRow}"/>` +
                        '<sheetViews><sheetView workbookViewId="0"/></sheetViews>' +
                        '<sheetData>';

                    if (columns.length > 0) {
                        headXml += '<row r="1">';
                        for (let c = 0; c < columns.length; c++) {
                            headXml += `<c r="${colLetters[c]}1" t="str"><v>${escapeXml(columns[c])}</v></c>`;
                        }
                        headXml += '</row>';
                    }
                    queueWrite(headXml);
                };

                req.on('recordset', (cols: Record<string, any>) => {
                    columns = Object.keys(cols);
                });

                req.on('row', (row: Record<string, any>) => {
                    if (columns.length === 0) {
                        columns = Object.keys(row);
                    }
                    ensureHeaderWritten(expectedRowCount);
                    totalRows++;
                    const excelRowNum = totalRows + 1;

                    let rowXml = `<row r="${excelRowNum}">`;
                    for (let c = 0; c < columns.length; c++) {
                        const rawVal = row[columns[c]];
                        if (rawVal === null || rawVal === undefined || rawVal === '') {
                            continue;
                        }
                        const strVal = formatCellValue(rawVal);
                        if (strVal === '') continue;
                        rowXml += `<c r="${colLetters[c]}${excelRowNum}" t="str"><v>${escapeXml(strVal)}</v></c>`;
                    }
                    rowXml += '</row>';
                    queueWrite(rowXml);
                });

                req.on('error', (err: Error) => {
                    safeReject(err);
                });

                req.on('done', () => {
                    ensureHeaderWritten(expectedRowCount);
                    const lastColLetter = colLetters.length > 0 ? colLetters[colLetters.length - 1] : 'A';
                    const lastRowNum = totalRows + 1;
                    const tailXml =
                        `</sheetData>` +
                        `<ignoredErrors><ignoredError numberStoredAsText="1" sqref="A1:${lastColLetter}${lastRowNum}"/></ignoredErrors>` +
                        `</worksheet>`;
                    queueWrite(tailXml, true);
                    chain
                        .then(() => {
                            if (!isSettled) {
                                isSettled = true;
                                resolve();
                            }
                        })
                        .catch((err) => safeReject(err));
                });

                req.query(query);
            });
        });

        zip.addStaticEntry(
            '[Content_Types].xml',
            '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n' +
                '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
                '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
                '<Default Extension="xml" ContentType="application/xml"/>' +
                '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>' +
                '<Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>' +
                '<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>' +
                '<Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/>' +
                '<Override PartName="/docProps/app.xml" ContentType="application/vnd.openxmlformats-officedocument.extended-properties+xml"/>' +
                '</Types>'
        );

        zip.close();

        // Guardar en caché el conteo de filas del archivo recién generado para el Dashboard
        try {
            const stat = fs.statSync(outputExcelPath);
            const fname = path.basename(outputExcelPath);
            const processType: 'po' | 'csf' = fname.startsWith('BASE_PO') ? 'po' : 'csf';
            fileMetadataCache.set(outputExcelPath, {
                mtimeMs: stat.mtimeMs,
                size: stat.size,
                rows: totalRows,
                processType
            });
        } catch {
            // Ignorar si falla actualización de caché
        }

        console.log(`Consulta ejecutada exitosamente. Registros obtenidos: ${totalRows.toLocaleString()}`);
        console.log(`Archivo generado exitosamente: ${outputExcelPath} (${totalRows.toLocaleString()} registros)`);
        return totalRows;
    } catch (err) {
        try {
            zip.close();
        } catch {
            // Ignorar error al cerrar en caso de fallo
        }
        if (fs.existsSync(outputExcelPath)) {
            try {
                fs.unlinkSync(outputExcelPath);
            } catch {
                // Ignorar
            }
        }
        throw err;
    }
};

/**
 * Ejecuta la query de cruce (RENIEC y Celulares) en SQL Server.
 */
export const executeEnrichmentQuery = async (
    pool: sql.ConnectionPool,
    query: string
): Promise<Record<string, any>[]> => {
    console.log('Ejecutando consulta SQL para cruce con RENIEC y Celulares...');
    const result = await pool.request().query(query);
    const rows = result.recordset || [];
    console.log(`Consulta ejecutada exitosamente. Registros obtenidos: ${rows.length.toLocaleString()}`);
    return rows;
};

/**
 * Exporta los registros obtenidos a un archivo Excel (.xlsx) con hoja 'BASE',
 * convirtiendo valores nulos en celdas vacías y manteniendo los textos (DNI/teléfonos) sin perder ceros.
 */
export const exportToExcel = (
    records: Record<string, any>[],
    outputExcelPath: string,
    sheetName = 'BASE'
): void => {
    const sanitizedRecords = records.map((row) => {
        const cleanRow: Record<string, string> = {};
        for (const [key, val] of Object.entries(row)) {
            if (val === null || val === undefined) {
                cleanRow[key] = '';
            } else if (val instanceof Date) {
                const day = String(val.getUTCDate()).padStart(2, '0');
                const month = String(val.getUTCMonth() + 1).padStart(2, '0');
                const year = val.getUTCFullYear();
                cleanRow[key] = `${day}/${month}/${year}`;
            } else {
                cleanRow[key] = String(val);
            }
        }
        return cleanRow;
    });

    const worksheet = XLSX.utils.json_to_sheet(sanitizedRecords);
    // Forzar tipo texto ('s') en todas las celdas de datos para preservar ceros a la izquierda (ej. DNI)
    const range = XLSX.utils.decode_range(worksheet['!ref'] || 'A1');
    for (let R = range.s.r + 1; R <= range.e.r; ++R) {
        for (let C = range.s.c; C <= range.e.c; ++C) {
            const addr = XLSX.utils.encode_cell({ r: R, c: C });
            const cell = worksheet[addr];
            if (cell && cell.v !== undefined && cell.v !== '') {
                cell.t = 's';
                cell.v = String(cell.v);
            }
        }
    }

    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, sheetName);
    XLSX.writeFile(workbook, outputExcelPath);

    console.log(`Archivo generado exitosamente: ${outputExcelPath} (${records.length.toLocaleString()} registros)`);
};

export const getFileSize = (filePath: string): number => {
    const stats = fs.statSync(filePath);
    return stats.size;
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
    date: string; // YYYY-MM-DD
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

const fileMetadataCache = new Map<string, { mtimeMs: number; size: number; rows: number; processType: 'po' | 'csf' }>();

function formatLocalDate(ms: number): string {
    const d = new Date(ms);
    const year = d.getFullYear();
    const month = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
}

function extractTimestampFromName(filename: string, fallbackMs: number): number {
    const m = filename.match(/(\d{13})/);
    if (m) {
        const ts = parseInt(m[1], 10);
        if (ts > 1500000000000 && ts < 2500000000000) {
            return ts;
        }
    }
    return fallbackMs;
}

/**
 * Extrae rápidamente la cantidad de registros de un archivo .xlsx leyendo el tag <dimension ref="..." />
 * de xl/worksheets/sheet1.xml directamente desde el contenedor ZIP sin cargar todo el archivo en memoria.
 */
export function getXlsxRowCountFast(filePath: string): number {
    const fd = fs.openSync(filePath, 'r');
    try {
        const stat = fs.fstatSync(fd);
        const tailSize = Math.min(65536, stat.size);
        const tailBuf = Buffer.alloc(tailSize);
        fs.readSync(fd, tailBuf, 0, tailSize, stat.size - tailSize);

        const target = Buffer.from('xl/worksheets/sheet1.xml');
        let idx = 0;
        while ((idx = tailBuf.indexOf(target, idx)) !== -1) {
            if (idx >= 46 && tailBuf.readUInt32LE(idx - 46) === 0x02014b50) {
                const cdOffset = idx - 46;
                const compressionMethod = tailBuf.readUInt16LE(cdOffset + 10);
                const localHeaderOffset = tailBuf.readUInt32LE(cdOffset + 42);

                const lhBuf = Buffer.alloc(1024);
                fs.readSync(fd, lhBuf, 0, 1024, localHeaderOffset);
                const fnameLen = lhBuf.readUInt16LE(26);
                const extraLen = lhBuf.readUInt16LE(28);
                const dataOffset = localHeaderOffset + 30 + fnameLen + extraLen;

                const chunk = Buffer.alloc(4096);
                const bytesRead = fs.readSync(fd, chunk, 0, 4096, dataOffset);

                let xmlHead = '';
                if (compressionMethod === 0) {
                    xmlHead = chunk.subarray(0, bytesRead).toString('utf8');
                } else if (compressionMethod === 8) {
                    const inflated = zlib.inflateRawSync(chunk.subarray(0, bytesRead), {
                        finishFlush: zlib.constants.Z_SYNC_FLUSH
                    });
                    xmlHead = inflated.toString('utf8');
                }
                const m =
                    xmlHead.match(/<dimension\s+ref="[A-Z]+\d+:[A-Z]+(\d+)"/) ||
                    xmlHead.match(/<dimension\s+ref="[A-Z]+(\d+)"/) ||
                    xmlHead.match(/sqref="[A-Z]+\d+:[A-Z]+(\d+)"/);
                if (m) {
                    return Math.max(0, parseInt(m[1], 10) - 1);
                }
            }
            idx += target.length;
        }
    } catch (err) {
        console.warn(`No se pudo extraer dimension rápida de ${filePath}:`, err);
    } finally {
        fs.closeSync(fd);
    }
    return 0;
}

/**
 * Cuenta rápidamente las filas de un archivo CSV y detecta si corresponde a PO o CSF según sus cabeceras.
 */
export function getCsvInfoFast(filePath: string): { rows: number; processType: 'po' | 'csf' } {
    const buf = fs.readFileSync(filePath);
    let lines = 0;
    let firstNewline = -1;
    for (let i = 0; i < buf.length; i++) {
        if (buf[i] === 10) {
            if (firstNewline === -1) firstNewline = i;
            lines++;
        }
    }
    if (buf.length > 0 && buf[buf.length - 1] !== 10) {
        lines++;
    }

    const headerEnd = firstNewline !== -1 ? firstNewline : Math.min(512, buf.length);
    const header = buf.subarray(0, headerEnd).toString('utf8').toUpperCase();
    const processType: 'po' | 'csf' = header.includes('DOC_IDENTIDAD') ? 'csf' : 'po';

    return {
        rows: Math.max(0, lines - 1),
        processType
    };
}

function getCachedFileInfo(filePath: string, defaultProcessType: 'po' | 'csf'): { rows: number; processType: 'po' | 'csf' } {
    const stat = fs.statSync(filePath);
    const cached = fileMetadataCache.get(filePath);
    if (cached && cached.mtimeMs === stat.mtimeMs && cached.size === stat.size) {
        return { rows: cached.rows, processType: cached.processType };
    }

    const ext = path.extname(filePath).toLowerCase();
    let rows = 0;
    let processType = defaultProcessType;

    if (ext === '.csv') {
        const info = getCsvInfoFast(filePath);
        rows = info.rows;
        processType = info.processType;
    } else if (ext === '.xlsx' || ext === '.xls') {
        rows = getXlsxRowCountFast(filePath);
    }

    fileMetadataCache.set(filePath, {
        mtimeMs: stat.mtimeMs,
        size: stat.size,
        rows,
        processType
    });

    return { rows, processType };
}

/**
 * Lee los metadatos de los archivos en las carpetas uploads y outputs para alimentar el Dashboard.
 */
export const getDashboardStats = (): DashboardStatsResponse => {
    const uploadsDir = path.join(__dirname, '../../uploads');
    const outputsDir = path.join(__dirname, '../../outputs');

    const files: DashboardFileMetadata[] = [];
    let rawUploadsFilesOnDisk = 0;

    // 1. Procesar carpeta uploads (agrupando pares .xlsx/.csv generados por convertirExcelACsv)
    if (fs.existsSync(uploadsDir)) {
        const uploadGroups = new Map<string, { [ext: string]: string }>();

        for (const f of fs.readdirSync(uploadsDir)) {
            if (f.startsWith('.')) continue;
            const ext = path.extname(f).toLowerCase();
            if (ext !== '.csv' && ext !== '.xlsx' && ext !== '.xls') continue;
            rawUploadsFilesOnDisk++;
            const base = path.parse(f).name;
            if (!uploadGroups.has(base)) {
                uploadGroups.set(base, {});
            }
            uploadGroups.get(base)![ext] = f;
        }

        for (const [, group] of uploadGroups.entries()) {
            const primaryFile = group['.xlsx'] || group['.xls'] || group['.csv'];
            if (!primaryFile) continue;

            const primaryPath = path.join(uploadsDir, primaryFile);
            const stat = fs.statSync(primaryPath);
            const timestamp = extractTimestampFromName(primaryFile, stat.mtimeMs);

            let rows = 0;
            let processType: 'po' | 'csf' = 'csf';

            if (group['.csv']) {
                const csvInfo = getCachedFileInfo(path.join(uploadsDir, group['.csv']), 'csf');
                rows = csvInfo.rows;
                processType = csvInfo.processType;
            } else {
                const excelInfo = getCachedFileInfo(primaryPath, 'csf');
                rows = excelInfo.rows;
                processType = excelInfo.processType;
            }

            files.push({
                id: `uploads_${primaryFile}`,
                name: primaryFile.replace(/^\d{13}_/, ''),
                rawName: primaryFile,
                source: 'uploads',
                processType,
                rows,
                size: stat.size,
                timestamp,
                date: formatLocalDate(timestamp)
            });
        }
    }

    // 2. Procesar carpeta outputs
    if (fs.existsSync(outputsDir)) {
        for (const f of fs.readdirSync(outputsDir)) {
            if (f.startsWith('.')) continue;
            const ext = path.extname(f).toLowerCase();
            if (ext !== '.xlsx' && ext !== '.csv' && ext !== '.xls') continue;

            const fullPath = path.join(outputsDir, f);
            const stat = fs.statSync(fullPath);
            const timestamp = extractTimestampFromName(f, stat.mtimeMs);
            const defaultType: 'po' | 'csf' = f.startsWith('BASE_PO') ? 'po' : 'csf';
            const info = getCachedFileInfo(fullPath, defaultType);
            const processType: 'po' | 'csf' = f.startsWith('BASE_PO') ? 'po' : info.processType;

            files.push({
                id: `outputs_${f}`,
                name: f.replace(/^\d{13}_/, ''),
                rawName: f,
                source: 'outputs',
                processType,
                rows: info.rows,
                size: stat.size,
                timestamp,
                date: formatLocalDate(timestamp)
            });
        }
    }

    // Ordenar archivos del más reciente al más antiguo
    files.sort((a, b) => b.timestamp - a.timestamp);

    // 3. Construir línea de tiempo por día y resumen global
    const timelineMap = new Map<string, DailyTimelinePoint>();

    let uploadsFiles = 0;
    let outputsFiles = 0;
    let poUploadsFiles = 0;
    let poOutputsFiles = 0;
    let csfUploadsFiles = 0;
    let csfOutputsFiles = 0;

    let uploadsRecords = 0;
    let outputsRecords = 0;
    let poUploadsRecords = 0;
    let poOutputsRecords = 0;
    let csfUploadsRecords = 0;
    let csfOutputsRecords = 0;

    for (const item of files) {
        if (!timelineMap.has(item.date)) {
            timelineMap.set(item.date, {
                date: item.date,
                uploadsFiles: 0,
                outputsFiles: 0,
                totalFiles: 0,
                poFiles: 0,
                csfFiles: 0,
                uploadsRecords: 0,
                outputsRecords: 0,
                totalRecords: 0,
                poRecords: 0,
                csfRecords: 0
            });
        }

        const dayPoint = timelineMap.get(item.date)!;
        dayPoint.totalFiles += 1;
        dayPoint.totalRecords += item.rows;

        if (item.source === 'uploads') {
            uploadsFiles += 1;
            uploadsRecords += item.rows;
            dayPoint.uploadsFiles += 1;
            dayPoint.uploadsRecords += item.rows;

            if (item.processType === 'po') {
                poUploadsFiles += 1;
                poUploadsRecords += item.rows;
            } else {
                csfUploadsFiles += 1;
                csfUploadsRecords += item.rows;
            }
        } else {
            outputsFiles += 1;
            outputsRecords += item.rows;
            dayPoint.outputsFiles += 1;
            dayPoint.outputsRecords += item.rows;

            if (item.processType === 'po') {
                poOutputsFiles += 1;
                poOutputsRecords += item.rows;
            } else {
                csfOutputsFiles += 1;
                csfOutputsRecords += item.rows;
            }
        }

        if (item.processType === 'po') {
            dayPoint.poFiles += 1;
            dayPoint.poRecords += item.rows;
        } else {
            dayPoint.csfFiles += 1;
            dayPoint.csfRecords += item.rows;
        }
    }

    const timeline = Array.from(timelineMap.values()).sort((a, b) => a.date.localeCompare(b.date));

    return {
        summary: {
            totalFiles: uploadsFiles + outputsFiles,
            uploadsFiles,
            outputsFiles,
            rawUploadsFilesOnDisk,
            poFiles: poUploadsFiles + poOutputsFiles,
            csfFiles: csfUploadsFiles + csfOutputsFiles,
            poUploadsFiles,
            poOutputsFiles,
            csfUploadsFiles,
            csfOutputsFiles,
            totalRecords: uploadsRecords + outputsRecords,
            uploadsRecords,
            outputsRecords,
            poRecords: poUploadsRecords + poOutputsRecords,
            csfRecords: csfUploadsRecords + csfOutputsRecords,
            poUploadsRecords,
            poOutputsRecords,
            csfUploadsRecords,
            csfOutputsRecords
        },
        timeline,
        files,
        updatedAt: new Date().toISOString()
    };
};
