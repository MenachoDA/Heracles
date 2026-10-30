import { ProcessingStrategy, OutputMetadata } from './ProcessingStrategy';
import {
    loadQueryFromScript,
    readCsvFile,
    uploadTableToSql,
    executeEnrichmentQuery,
    exportToExcel,
    dropTableSql,
    getFileSize
} from '../utils/fileUtils';
import { getDbPool } from '../server';
import path from 'path';

const FALLBACK_CSF_QUERY = `
SELECT DISTINCT
    A.*,
    D.AMATERNO,
    D.APATERNO,
    D.NOMBRES,
    D.Edad,
    D.DEPARTAMENTO,
    D.PROVINCIA,
    D.DISTRITO,
    C.VALIDO1,
    C.CEL1,
    C.CLARO1,
    C.ENTEL1,
    C.ENTEL2,
    C.CLARO2,
    C.VALIDO2,
    C.VALIDO3
    FROM BASECSF A
    LEFT JOIN WO_BI_CELULARES C WITH (NOLOCK)
    ON A.DOC_IDENTIDAD = C.DNI
    LEFT JOIN DT_RENIEC D WITH (NOLOCK)
    ON A.DOC_IDENTIDAD = D.DNI
`;

export class CSFStrategy implements ProcessingStrategy {
    public async execute(inputFilePath: string, originalName: string): Promise<OutputMetadata> {
        console.log('INICIANDO PROCESO DE ENRIQUECIMIENTO');

        if (!originalName.toLowerCase().endsWith('.csv')) {
            throw new Error('El archivo debe tener extensión .csv');
        }

        // 1. Leer archivo CSV
        const csvData = readCsvFile(inputFilePath);

        // 2. Obtener conexión a SQL Server configurada en server.ts
        const pool = await getDbPool();

        // 3. Cargar query desde backend/scripts/enriquecimiento.py
        const queryCruce = loadQueryFromScript('enriquecimiento.py', FALLBACK_CSF_QUERY);

        // Regla: ENRIQUECIDO_[nombre_original sin extension].xlsx
        const baseName = path.parse(originalName).name;
        const logicalOutputName = `ENRIQUECIDO_${baseName}.xlsx`;
        const physicalOutputName = `${Date.now()}_${logicalOutputName}`;
        const outputPath = path.join(__dirname, '../../outputs', physicalOutputName);

        // 4. Subir tabla BASECSF, ejecutar query de cruce, exportar a Excel y eliminar tabla temporal
        await uploadTableToSql(pool, 'BASECSF', csvData);

        try {
            const enrichedRows = await executeEnrichmentQuery(pool, queryCruce);
            exportToExcel(enrichedRows, outputPath, 'BASE');

            const size = getFileSize(outputPath);
            console.log('¡PROCESO DE ENRIQUECIMIENTO FINALIZADO CON ÉXITO!');

            return {
                name: logicalOutputName,
                size: size,
                rows: enrichedRows.length.toLocaleString('en-US'),
                downloadId: physicalOutputName
            };
        } finally {
            try {
                await dropTableSql(pool, 'BASECSF');
            } catch (dropErr) {
                console.error('Error al eliminar la tabla BASECSF de SQL Server:', dropErr);
            }
        }
    }
}
