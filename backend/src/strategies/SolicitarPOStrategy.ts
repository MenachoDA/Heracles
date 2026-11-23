import { ProcessingStrategy, OutputMetadata } from './ProcessingStrategy';

export class SolicitarPOStrategy implements ProcessingStrategy {
    private validateFileNameAndDate(originalName: string): void {
        const fileName = originalName.trim();

        if (!fileName.toLowerCase().endsWith('.csv')) {
            throw new Error('El archivo debe ser de formato CSV (.csv).');
        }

        const match = fileName.match(/^(\d{4})(\d{2})(\d{2})Usftp665\.csv$/i);
        if (!match || !fileName.slice(8).startsWith('Usftp665.')) {
            throw new Error(
                'El nombre del archivo debe tener la estructura [AAAA][MM][DD]Usftp665.csv (por ejemplo: 20261123Usftp665.csv).'
            );
        }

        const year = parseInt(match[1], 10);
        const month = parseInt(match[2], 10);
        const day = parseInt(match[3], 10);

        const fileDate = new Date(year, month - 1, day);
        if (
            fileDate.getFullYear() !== year ||
            fileDate.getMonth() !== month - 1 ||
            fileDate.getDate() !== day
        ) {
            throw new Error(
                `La fecha indicada en el archivo (${match[1]}-${match[2]}-${match[3]}) no es una fecha calendario válida.`
            );
        }

        const now = new Date();
        const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());

        if (fileDate.getTime() < today.getTime()) {
            throw new Error(
                `La fecha del archivo (${match[1]}-${match[2]}-${match[3]}) no puede ser anterior a la fecha actual.`
            );
        }
    }

    public async execute(_inputFilePath: string, originalName: string): Promise<OutputMetadata> {
        console.log('INICIANDO PROCESO: SOLICITAR PO');
        this.validateFileNameAndDate(originalName);

        // Acción pendiente: aquí se ejecutará el script correspondiente a Solicitar PO.
        return {
            name: originalName,
            size: 0,
            rows: 0,
            downloadId: ''
        };
    }
}
