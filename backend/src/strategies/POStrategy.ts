import { ProcessingStrategy, OutputMetadata } from './ProcessingStrategy';
import {
    loadQueryFromScript,
    readCsvFile,
    uploadTableToSql,
    executeEnrichmentAndExportToExcel,
    dropTableSql,
    getFileSize
} from '../utils/fileUtils';
import { getDbPool } from '../server';
import path from 'path';

const FALLBACK_PO_QUERY = `
WITH NumerosDesglosados AS (
    SELECT 
        A.DOC,
        V.Tel,
        ROW_NUMBER() OVER (PARTITION BY A.DOC ORDER BY (SELECT NULL)) AS rn
    FROM BASEPO A
    LEFT JOIN WO_BI_CELULARES C WITH (NOLOCK) ON A.DOC = C.DNI
    OUTER APPLY (
        SELECT DISTINCT Tel 
        FROM (VALUES 
            (C.VALIDO1), (C.CEL1), (C.CLARO1), 
            (C.ENTEL1), (C.ENTEL2), (C.CLARO2), 
            (C.VALIDO2), (C.VALIDO3)
        ) AS T(Tel)
        WHERE Tel LIKE '9________' AND LEN(Tel) = 9
    ) V
),

NumerosPivoteados AS (
    SELECT 
        DOC,
        MAX(CASE WHEN rn = 1 THEN Tel END) AS CEL1,
        MAX(CASE WHEN rn = 2 THEN Tel END) AS CEL2,
        MAX(CASE WHEN rn = 3 THEN Tel END) AS CEL3,
        MAX(CASE WHEN rn = 4 THEN Tel END) AS CEL4
    FROM NumerosDesglosados
    GROUP BY DOC
)

SELECT 
    A.*,
    D.AMATERNO,
    D.APATERNO,
    D.NOMBRES,
    d.Edad,
    D.DEPARTAMENTO,
    D.PROVINCIA,
    D.DISTRITO,
    P.CEL1,
    P.CEL2,
    P.CEL3,
    P.CEL4
--INTO #TEMP1
FROM BASEPO A
LEFT JOIN NumerosPivoteados P ON A.DOC = P.DOC
LEFT JOIN DT_RENIEC D WITH (NOLOCK)
ON  A.DOC=D.DNI;
`;

export class POStrategy implements ProcessingStrategy {
    public async execute(inputFilePath: string, originalName: string): Promise<OutputMetadata> {
        console.log('INICIANDO PROCESO: PEGADO DE OFERTA');

        if (!originalName.toLowerCase().endsWith('.csv')) {
            throw new Error('El archivo debe tener extensión .csv');
        }

        // 1. Leer archivo CSV y aplicar limpieza en una sola pasada (TEXTO01..20 y filtro 'Sin Oferta')
        const cleanedData = readCsvFile(inputFilePath, true);
        const expectedRowCount = cleanedData.rows.length;

        // 2. Obtener conexión a SQL Server configurada en server.ts
        const pool = await getDbPool();

        // 3. Cargar query desde backend/scripts/pegado_oferta.py
        const queryCruce = loadQueryFromScript('pegado_oferta.py', FALLBACK_PO_QUERY);

        const outputFileName = `BASE_PO_${Date.now()}.xlsx`;
        const outputPath = path.join(__dirname, '../../outputs', outputFileName);

        // 4. Subir tabla BASEPO, ejecutar query de cruce en modo streaming hacia Excel y eliminar tabla temporal
        await uploadTableToSql(pool, 'BASEPO', cleanedData);

        try {
            const totalRows = await executeEnrichmentAndExportToExcel(
                pool,
                queryCruce,
                outputPath,
                'BASE',
                expectedRowCount
            );

            const size = getFileSize(outputPath);
            console.log('¡PROCESO DE PEGADO DE OFERTA FINALIZADO CON ÉXITO!');

            return {
                name: 'BASE_PO.xlsx',
                size: size,
                rows: totalRows.toLocaleString('en-US'),
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
