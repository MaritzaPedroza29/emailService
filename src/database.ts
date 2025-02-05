import sqlite3 from 'sqlite3';
import path from 'path';
import { fileURLToPath } from 'url';
import logger from './services/logger.js';
import bcrypt from 'bcrypt';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Crear la base de datos en un archivo físico
const dbPath = path.join(__dirname, '..', 'data', 'reminders.db');

// Definir interfaces
interface User {
    id: number;
    email: string;
    password: string;
    name?: string;
}

// Asegurar que sqlite3 muestra los errores
const db = new sqlite3.Database(dbPath, (err) => {
  if (err) {
    logger.error('Error al conectar con la base de datos:', { error: err });
  } else {
    logger.info('Conexión exitosa con la base de datos');
  }
});

// Función para ejecutar queries de forma segura
const runQuery = (query: string): Promise<void> => {
    return new Promise((resolve, reject) => {
        db.run(query, (err) => {
            if (err) {
                logger.error('Query error:', { query, error: err });
                reject(err);
            } else {
                resolve();
            }
        });
    });
};

// Función para inicializar la base de datos
async function initializeDatabase() {
    try {
        // 1. Crear tabla de usuarios si no existe
        await runQuery(`
            CREATE TABLE IF NOT EXISTS users (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                name TEXT,
                email TEXT UNIQUE NOT NULL,
                password TEXT NOT NULL,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP
            )
        `);

        // 2. Respaldar datos existentes solo si la tabla `reminders` existe y tiene datos
        await runQuery(`
            CREATE TABLE IF NOT EXISTS reminders_backup AS 
            SELECT 
                id, email, reminder, frequency, last_sent, next_send, 
                created_at, COALESCE(active, 1) as active, user_id
            FROM reminders
            WHERE EXISTS (SELECT 1 FROM sqlite_master WHERE type='table' AND name='reminders')
        `);

        // 3. Verificar si hay datos en `reminders_backup`
        const backupCount = await new Promise<number>((resolve, reject) => {
            db.get('SELECT COUNT(*) as count FROM reminders_backup', [], (err, row) => {
                if (err) {
                    reject(err);
                } else {
                    const count = (row as { count: number }).count ?? 0;
                    resolve(count);
                }
            });
        });
        
        // 4. Eliminar tabla `reminders` solo si hay respaldo
        if (backupCount > 0) {
            await runQuery(`DROP TABLE IF EXISTS reminders`);
        } else {
            logger.warn('No se eliminó la tabla reminders porque no había datos de respaldo.');
        }

        // 5. Crear nueva tabla con la estructura corregida
        await runQuery(`
            CREATE TABLE reminders (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                user_id INTEGER NOT NULL,
                email TEXT NOT NULL,
                reminder TEXT NOT NULL,
                frequency TEXT NOT NULL,
                last_sent DATETIME,
                next_send DATETIME NOT NULL,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                active BOOLEAN DEFAULT 1,
                status INTEGER DEFAULT 0,
                FOREIGN KEY (user_id) REFERENCES users(id)
            )
        `);

        // 6. Asegurar que existe un usuario por defecto
        const user = await new Promise<User | undefined>((resolve) => {
            db.get('SELECT id FROM users LIMIT 1', [], (err, row) => {
                resolve(row as User | undefined);
            });
        });

        if (!user) {
            await runQuery(`
                INSERT INTO users (email, password, name) 
                VALUES ('admin@example.com', '${await bcrypt.hash('defaultpass', 10)}', 'Admin')
            `);
        }

        // 7. Obtener ID del primer usuario
        const firstUser = await new Promise<User | undefined>((resolve, reject) => {
            db.get('SELECT id FROM users ORDER BY id LIMIT 1', [], (err, row) => {
                if (err) reject(err);
                else resolve(row as User);
            });
        });

        // 8. Restaurar datos desde `reminders_backup` si existen
        if (backupCount > 0 && firstUser) {
            await runQuery(`
                INSERT INTO reminders (
                    email, reminder, frequency, last_sent, next_send, 
                    created_at, active, user_id
                )
                SELECT 
                    email, reminder, frequency, last_sent, next_send, 
                    created_at, active, user_id
                FROM reminders_backup
            `);
            logger.info('Datos de recordatorios restaurados exitosamente.');
        } else {
            logger.warn('No se restauraron datos de recordatorios porque no había respaldo disponible.');
        }

        // 9. Eliminar `reminders_backup` solo después de restaurar los datos correctamente
        await runQuery(`DROP TABLE IF EXISTS reminders_backup`);

        logger.info('Database initialization completed successfully');
    } catch (error) {
        logger.error('Error in database initialization:', error);
        throw error;
    }
}

// Ejecutar la inicialización
initializeDatabase().catch(error => {
    logger.error('Failed to initialize database:', error);
    process.exit(1);
});

export default db;
