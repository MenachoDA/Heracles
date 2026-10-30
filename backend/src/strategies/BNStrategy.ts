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

const FALLBACK_BN_QUERY = `
SELECT DISTINCT
    A.*,
	BC.RAZON_SOCIAL,
	D.AMATERNO,
	D.APATERNO,
	D.NOMBRES,	
	d.Edad,
	CONVERT(VARCHAR(10), d.FEC_NACIMIENTO, 103) AS FEC_NACIMIENTO,
	d.FECNAC,
	C.VALIDO1,
	C.CEL1,
	C.CLARO1,
	C.CLARO2,
	C.ENTEL1,
	C.ENTEL2,	
	C.VALIDO2,
	C.VALIDO3,
	CASE 
        WHEN BC.Clasificacion = 'A+' THEN K.Color_DXP_Filtro_A_Mas
        WHEN BC.Clasificacion = 'A Top' THEN K.Color_DXP_Filtro_A_Top
        WHEN BC.Clasificacion = 'A' THEN K.Color_DXP_Filtro_A
        WHEN BC.Clasificacion IN ('B', 'C', 'D', 'E', 'NO APLICA') THEN K.Color_DXP_Filtro_B
        ELSE 'Sin Clasificación' 
		END AS Color_Asignado_RCC,
	k.Flag_NoContactar,
	K.Producto
FROM alvarobaseenri A 
LEFT JOIN  Base_Convenio_Filtros BC 
ON A.RUC=BC.RUC

LEFT JOIN  RCC_DATOS_N K
ON A.DOCUMENTO=K.doc_identidad

LEFT JOIN WO_BI_CELULARES C
ON A.DOCUMENTO=C.DNI

LEFT JOIN DT_RENIEC D
ON A.DOCUMENTO=D.DNI
`;

export class BNStrategy implements ProcessingStrategy {
    public async execute(inputFilePath: string, originalName: string): Promise<OutputMetadata> {
        console.log('INICIANDO PROCESO DE ENRIQUECIMIENTO BANCA');

        if (!originalName.toLowerCase().endsWith('.csv')) {
            throw new Error('El archivo debe tener extensión .csv');
        }

        // 1. Leer archivo CSV
        const csvData = readCsvFile(inputFilePath);

        // 2. Obtener conexión a SQL Server configurada en server.ts
        const pool = await getDbPool();

        // 3. Cargar query desde backend/scripts/enriquecimiento_banca.py
        const queryCruce = loadQueryFromScript('enriquecimiento_banca.py', FALLBACK_BN_QUERY);

        // 4. Definir cómo se llamará el archivo resultante
        const baseName = path.parse(originalName).name;
        const logicalOutputName = `ENRIQUECIDO_${baseName}.xlsx`; // Nombre que verá el usuario
        const physicalOutputName = `${Date.now()}_${logicalOutputName}`; // Nombre real en el disco para evitar sobreescrituras
        const outputPath = path.join(__dirname, '../../outputs', physicalOutputName);

        // 5. Subir tabla alvarobaseenri, ejecutar query de cruce, exportar a Excel y eliminar tabla temporal
        await uploadTableToSql(pool, 'alvarobaseenri', csvData);

        try {
            const enrichedRows = await executeEnrichmentQuery(pool, queryCruce);
            exportToExcel(enrichedRows, outputPath, 'BASE');

            const size = getFileSize(outputPath);
            console.log('¡PROCESO DE ENRIQUECIMIENTO BANCA FINALIZADO CON ÉXITO!');

            return {
                name: logicalOutputName,
                size: size,
                rows: enrichedRows.length.toLocaleString('en-US'),
                downloadId: physicalOutputName
            };
        } finally {
            try {
                await dropTableSql(pool, 'alvarobaseenri');
            } catch (dropErr) {
                console.error('Error al eliminar la tabla alvarobaseenri de SQL Server:', dropErr);
            }
        }
    }
}