import { ProcessingStrategy, OutputMetadata } from './ProcessingStrategy';
import {
    loadQueryFromScript,
    readCsvFile,
    cleanPoData,
    uploadTableToSql,
    executeEnrichmentQuery,
    exportToExcel,
    dropTableSql,
    getFileSize
} from '../utils/fileUtils';
import { getDbPool } from '../server';
import path from 'path';

const FALLBACK_PO_QUERY = `
SELECT DISTINCT 
    A.*,
    D.AMATERNO,
    D.APATERNO,
    D.NOMBRES,
    d.Edad,
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
FROM BASEPO A 

LEFT JOIN WO_BI_CELULARES C WITH (NOLOCK)
ON A.DOC=C.DNI
LEFT JOIN DT_RENIEC D WITH (NOLOCK)
ON  A.DOC=D.DNI
`;

export class POStrategy implements ProcessingStrategy {
    public async execute(inputFilePath: string, originalName: string): Promise<OutputMetadata> {
        console.log('INICIANDO PROCESO: PEGADO DE OFERTA');

        if (!originalName.toLowerCase().endsWith('.csv')) {
            throw new Error('El archivo debe tener extensión .csv');
        }

        // 1. Leer archivo CSV y aplicar limpieza (TEXTO01..20 y filtro 'Sin Oferta')
        const rawCsv = readCsvFile(inputFilePath);
        const cleanedData = cleanPoData(rawCsv);

        // 2. Obtener conexión a SQL Server configurada en server.ts
        const pool = await getDbPool();

        // 3. Cargar query desde backend/scripts/pegado_oferta.py
        const queryCruce = loadQueryFromScript('pegado_oferta.py', FALLBACK_PO_QUERY);

        const outputFileName = `BASE_PO_${Date.now()}.xlsx`;
        const outputPath = path.join(__dirname, '../../outputs', outputFileName);

        // 4. Subir tabla BASEPO, ejecutar query de cruce, exportar a Excel y eliminar tabla temporal
        await uploadTableToSql(pool, 'BASEPO', cleanedData);

        try {
            const enrichedRows = await executeEnrichmentQuery(pool, queryCruce);
            exportToExcel(enrichedRows, outputPath, 'BASE');

            const size = getFileSize(outputPath);
            console.log('¡PROCESO DE PEGADO DE OFERTA FINALIZADO CON ÉXITO!');

            return {
                name: 'BASE_PO.xlsx',
                size: size,
                rows: enrichedRows.length.toLocaleString('en-US'),
                downloadId: outputFileName
            };
        } finally {
            try {
                await dropTableSql(pool, 'BASEPO');
            } catch (dropErr) {
                console.error('Error al eliminar la tabla BASEPO de SQL Server:', dropErr);
            }
        }
    }
}
