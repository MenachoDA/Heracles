import { Router } from 'express';
import multer from 'multer';
import { ProcessController } from '../controllers/ProcessController';
import path from 'path';

const router = Router();

const storage = multer.diskStorage({
    destination: (req, file, cb) => {
        cb(null, path.join(__dirname, '../../uploads'));
    },
    filename: (req, file, cb) => {
        // Mantenemos el nombre original pero le añadimos un timestamp para evitar colisiones
        cb(null, `${Date.now()}_${file.originalname}`);
    }
});

const upload = multer({ storage });
const processController = new ProcessController();

router.post('/process', upload.single('file'), processController.processFile.bind(processController));
router.get('/download/:filename', processController.downloadFile.bind(processController));

export default router;