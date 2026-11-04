import { Request, Response } from 'express';
import { POStrategy } from '../strategies/POStrategy';
import { CSFStrategy } from '../strategies/CSFStrategy';
import { ProcessingStrategy } from '../strategies/ProcessingStrategy';
import { BNStrategy } from '../strategies/BNStrategy';
import { convertirExcelACsv } from '../utils/fileUtils';
import path from 'path';
import fs from 'fs';

export class ProcessController {
    public async processFile(req: Request, res: Response): Promise<void> {
        try {
            if (!req.file) {
                res.status(400).json({ error: 'No se subió ningún archivo.' });
                return;
            }

            const { type } = req.body;
            let strategy: ProcessingStrategy;

            if (type === 'po') {
                strategy = new POStrategy();
            } else if (type === 'csf') {
                strategy = new CSFStrategy();
            } else if (type === 'bn') {
                strategy = new BNStrategy();

            } else {
                res.status(400).json({ error: 'Tipo de procesamiento no válido.' });
                return;
            }

            let inputFilePath = req.file.path;
            let originalName = req.file.originalname;
            const ext = path.extname(originalName).toLowerCase();

            if (ext === '.xlsx' || ext === '.xls') {
                inputFilePath = convertirExcelACsv(inputFilePath);
                originalName = `${path.parse(originalName).name}.csv`;
            }

            const result = await strategy.execute(inputFilePath, originalName);

            res.json({
                success: true,
                metadata: result
            });
        } catch (error: any) {
            console.error("Error en procesamiento:", error);
            res.status(500).json({ error: error.message || 'Error interno del servidor.' });
        }
    }

    public downloadFile(req: Request, res: Response): void {
        const { filename } = req.params;
        const filePath = path.join(__dirname, '../../outputs', filename);

        if (fs.existsSync(filePath)) {
            res.download(filePath);
        } else {
            res.status(404).json({ error: 'Archivo no encontrado.' });
        }
    }
}