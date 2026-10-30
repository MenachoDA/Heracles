import express from 'express';
import cors from 'cors';
import fs from 'fs';
import path from 'path';
import dotenv from 'dotenv';
import sql from 'mssql';
import apiRoutes from './routes/api';

// Cargar variables de entorno
dotenv.config({ path: path.join(__dirname, '../.env') });

// Handlers globales para blindar el proceso de Node.js contra caídas no controladas
process.on('unhandledRejection', (reason) => {
    console.error('Unhandled Rejection interceptado de forma segura:', reason);
});

process.on('uncaughtException', (err) => {
    console.error('Uncaught Exception interceptado de forma segura:', err);
});

const app = express();
const PORT = process.env.PORT || 3001;
const USE_DB = process.env.USE_DB !== 'false'; // Por defecto true salvo que se indique USE_DB=false

// CONFIGURACIÓN DE LA BASE DE DATOS SQL SERVER DESDE .ENV (con fallback a credenciales de scripts)
export const dbConfig: sql.config = {
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    server: process.env.DB_SERVER || '',
    database: process.env.DB_NAME,
    connectionTimeout: 30000,
    requestTimeout: 300000,
    options: {
        encrypt: process.env.DB_ENCRYPT === 'true',
        trustServerCertificate: process.env.DB_TRUST_CERT !== 'false'
    }
};

export let poolPromise: Promise<sql.ConnectionPool | null> | null = null;

if (USE_DB) {
    // Crear el pool de conexión a la BD
    poolPromise = new sql.ConnectionPool(dbConfig)
        .connect()
        .then((pool) => {
            console.log('Conectado a SQL Server exitosamente.');
            return pool;
        })
        .catch((err) => {
            console.error('Error al conectar a SQL Server al iniciar:', err.message || err);
            return null;
        });
} else {
    console.log('Modo local: Ejecutando sin conexión a base de datos.');
}

/**
 * Obtiene el pool activo de SQL Server o intenta reconectar si aún no estaba disponible.
 */
export async function getDbPool(): Promise<sql.ConnectionPool> {
    if (!USE_DB) {
        throw new Error('La conexión a la base de datos está deshabilitada (USE_DB=false).');
    }

    if (poolPromise) {
        const existingPool = await poolPromise;
        if (existingPool && existingPool.connected) {
            return existingPool;
        }
    }

    console.log('Intentando conectar a SQL Server...');
    poolPromise = new sql.ConnectionPool(dbConfig)
        .connect()
        .then((pool) => {
            console.log('Conectado a SQL Server exitosamente.');
            return pool;
        })
        .catch((err) => {
            poolPromise = null;
            throw new Error(`Error al conectar a SQL Server (${dbConfig.server} / ${dbConfig.database}): ${err.message || err}`);
        });

    const pool = await poolPromise;
    if (!pool) {
        throw new Error('No se pudo establecer la conexión con SQL Server.');
    }
    return pool;
}

// Middlewares
app.use(cors());
app.use(express.json());

// Crear directorios necesarios
const dirs = ['uploads', 'outputs'];
dirs.forEach((dir) => {
    const dirPath = path.join(__dirname, '..', dir);
    if (!fs.existsSync(dirPath)) {
        fs.mkdirSync(dirPath, { recursive: true });
    }
});

// Rutas API
app.use('/api', apiRoutes);

// Servir frontend compilado si existe (igual que en server.js)
const frontendDistPath = path.join(__dirname, '../../frontend/dist');
if (fs.existsSync(frontendDistPath)) {
    app.use(express.static(frontendDistPath));
    app.get('*', (req, res) => {
        res.sendFile(path.join(frontendDistPath, 'index.html'));
    });
}

app.listen(PORT, () => {
    console.log(`Servidor backend corriendo en http://localhost:${PORT}`);
});
