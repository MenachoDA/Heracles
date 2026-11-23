import fs from 'fs';
import path from 'path';
import zlib from 'zlib';
import sql from 'mssql';
import * as XLSXNs from 'xlsx';

const XLSX: typeof XLSXNs = (XLSXNs as any).default || XLSXNs;

export interface CsvData {
    columns: string[];
    rows: Record<string, string | null>[];
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
 */
export const readCsvFile = (filePath: string): CsvData => {
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

    const lines = text.split(/\r?\n/).filter((l) => l.trim().length > 0);
    if (lines.length === 0) {
        throw new Error('El archivo CSV está vacío.');
    }

    const delimiters = [',', ';', '\t', '|'];
    let selectedDelimiter = ',';

    for (const sep of delimiters) {
        const sampleCols = parseCsvLine(lines[0], sep);
        if (sampleCols.length > 1) {
            selectedDelimiter = sep;
            break;
        }
    }

    const rawHeaders = parseCsvLine(lines[0], selectedDelimiter).map((h) => h.trim());
    const rows: Record<string, string | null>[] = [];

    for (let i = 1; i < lines.length; i++) {
        const values = parseCsvLine(lines[i], selectedDelimiter);
        const rowObj: Record<string, string | null> = {};

        for (let c = 0; c < rawHeaders.length; c++) {
            const colName = rawHeaders[c];
            if (!colName) continue;
            const rawVal = values[c] !== undefined ? values[c].trim() : '';
            rowObj[colName] = rawVal === '' ? null : rawVal;
        }
        rows.push(rowObj);
    }

    console.log(
        `Archivo cargado exitosamente (Codificación: ${encodingUsed}, Separador: '${selectedDelimiter}', Filas: ${rows.length.toLocaleString()}, Columnas: ${rawHeaders.length})`
    );

    return {
        columns: rawHeaders.filter((h) => h.length > 0),
        rows
    };
};

/**
 * Replica la función Limpieza(df) de backend/scripts/pegado_oferta.py:
 * 1. Estandariza nombres de columnas a mayúsculas y sin espacios.
 * 2. Limpia la columna DOC ('nan', '<NA>', '', 'None' -> null).
 * 3. Elimina columnas TEXTO01..TEXTO20 y TEXTO1..TEXTO20.
 * 4. Filtra registros donde CAMPAÑA / CAMPANA / CAMPAÑA_OFERTA sea 'SIN OFERTA'.
 */
export const cleanPoData = (data: CsvData): CsvData => {
    const initialRows = data.rows.length;
    const initialCols = data.columns.length;

    // 1. Estandarizar nombres de columnas (mayúsculas y sin espacios)
    const upperColumns = data.columns.map((c) => c.trim().toUpperCase());

    // 2. Identificar y eliminar columnas de texto (TEXTO01..TEXTO20 y TEXTO1..TEXTO20)
    const textTargets = new Set<string>();
    for (let i = 1; i <= 20; i++) {
        textTargets.add(`TEXTO${String(i).padStart(2, '0')}`);
        textTargets.add(`TEXTO${i}`);
    }

    const droppedTextCols = upperColumns.filter((col) => textTargets.has(col));
    const keptColumns = upperColumns.filter((col) => !textTargets.has(col));

    if (droppedTextCols.length > 0) {
        console.log(`Columnas de texto eliminadas (${droppedTextCols.length}): ${droppedTextCols.join(', ')}`);
    }

    // Identificar columna de campaña
    const campanaCol = keptColumns.find((c) =>
        ['CAMPAÑA', 'CAMPANA', 'CAMPAÑA_OFERTA'].includes(c)
    );

    let sinOfertaCount = 0;
    const cleanedRows: Record<string, string | null>[] = [];

    for (const rawRow of data.rows) {
        const normalizedRow: Record<string, string | null> = {};

        for (const origCol of data.columns) {
            const upperCol = origCol.trim().toUpperCase();
            if (textTargets.has(upperCol)) continue;

            let val = rawRow[origCol] ?? null;
            if (val !== null) {
                val = String(val).trim();
                if (val === '' || val === 'nan' || val === '<NA>' || val === 'None') {
                    val = null;
                }
            }
            normalizedRow[upperCol] = val;
        }

        // 4. Filtrar registros 'Sin Oferta'
        if (campanaCol) {
            const campanaVal = (normalizedRow[campanaCol] ?? '').trim().toUpperCase();
            if (campanaVal === 'SIN OFERTA') {
                sinOfertaCount++;
                continue;
            }
        }

        cleanedRows.push(normalizedRow);
    }

    if (campanaCol) {
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
            const rowValues = data.columns.map((col) => {
                const val = row[col];
                if (val === undefined || val === null || val === '') return null;
                return String(val).slice(0, 255);
            });
            table.rows.add(...rowValues);
        }

        await pool.request().bulk(table);
    }

    console.log(`Carga completa en la tabla '${tableName}'.`);
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
                    xmlHead.match(/<dimension\s+ref="[A-Z]+(\d+)"/);
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
