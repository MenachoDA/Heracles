import fs from 'fs';
import path from 'path';
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
