import express from 'express';
import db from './database.js';
import path from 'path';
import { fileURLToPath } from 'url';
import { calculateNextSendDate } from './services/reminderService.js';
import { startScheduler } from './scheduler.js';
import logger from './services/logger.js';
import 'dotenv/config';
import { sendEmail } from './services/emailService.js';
import session from 'express-session';
import bcrypt from 'bcrypt';

// Definir interfaces para TypeScript
interface User {
    id: number;
    name: string;
    email: string;
    password: string;
}

interface SessionUser {
    id: number;
    email: string;
    name?: string;
}

// Definir interfaces para los errores
interface CustomError extends Error {
    message: string;
}

// Definir interfaces
interface Reminder {
    id: number;
    user_id: number;
    email: string;
    reminder: string;
    frequency: 'daily' | 'weekly' | 'monthly';
    last_sent: string | null;
    next_send: string;
    created_at: string;
    active: boolean;
    status: number;
}

// Extender la interfaz SessionData
declare module 'express-session' {
    interface SessionData {
        user?: SessionUser;
    }
}

const app = express();
const PORT = 3000;

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Iniciar el scheduler antes de configurar las rutas
startScheduler();

app.use(express.urlencoded({ extended: true }));
app.use(express.json());

// Configuración de sesiones mejorada
app.use(session({
    secret: 'tu_secreto_aqui', // Cambia esto por una clave secreta segura
    resave: false,
    saveUninitialized: false,
    cookie: {
        secure: process.env.NODE_ENV === 'production', // true en producción
        maxAge: 30 * 24 * 60 * 60 * 1000, // 30 días en milisegundos
        httpOnly: true,
    },
    rolling: true // Renueva el tiempo de expiración en cada request
}));

// Middleware para verificar la autenticación
const requireAuth = (req: express.Request, res: express.Response, next: express.NextFunction) => {
    logger.info('Checking authentication:', { 
        sessionExists: !!req.session,
        userExists: !!req.session?.user,
        userId: req.session?.user?.id
    });

    if (!req.session || !req.session.user) {
        logger.warn('Authentication failed: No session or user');
        return res.status(401).json({ message: 'No autorizado' });
    }
    next();
};

// Ruta principal redirige al login si no hay sesión
app.get('/', (req: express.Request, res: express.Response) => {
    if (!req.session.user) {
        res.redirect('/login');
    } else {
        // Renovar la sesión
        req.session.touch();
        res.sendFile(path.join(__dirname, 'views', 'form.html'));
    }
});

// Ruta de login
app.get('/login', (req, res) => {
    // Si ya está autenticado, redirige a la página principal
    if (req.session?.user) {
        res.redirect('/');
    } else {
        res.sendFile(path.join(__dirname, 'views', 'login.html'));
    }
});

// Ruta para el formulario de registro
app.get('/register', (req, res) => {
    res.sendFile(path.join(__dirname, 'views', 'register.html'));
});

// Endpoint para procesar el registro
app.post('/register', async (req, res) => {
    const { name, email, password } = req.body;

    if (!name || !email || !password) {
        return res.status(400).json({ message: 'Todos los campos son requeridos' });
    }

    try {
        db.get('SELECT id FROM users WHERE email = ?', [email], async (err, existingUser) => {
            if (err) {
                logger.error('Error checking existing user:', err);
                return res.status(500).json({ message: 'Error interno del servidor' });
            }

            if (existingUser) {
                return res.status(400).json({ message: 'El email ya está registrado' });
            }

            try {
                const hashedPassword = await bcrypt.hash(password, 10);

                db.run(
                    'INSERT INTO users (name, email, password) VALUES (?, ?, ?)',
                    [name, email, hashedPassword],
                    function(err) {
                        if (err) {
                            logger.error('Error creating user:', err);
                            return res.status(500).json({ 
                                message: 'Error al crear usuario',
                                error: err instanceof Error ? err.message : 'Unknown error'
                            });
                        }

                        logger.info('User created successfully:', { id: this.lastID });
                        res.json({ 
                            success: true,
                            message: 'Usuario creado exitosamente'
                        });
                    }
                );
            } catch (hashError) {
                logger.error('Error hashing password:', hashError);
                return res.status(500).json({ message: 'Error al procesar la contraseña' });
            }
        });
    } catch (error) {
        logger.error('Error in register:', error);
        res.status(500).json({ 
            message: 'Error interno del servidor',
            error: error instanceof Error ? error.message : 'Unknown error'
        });
    }
});

// Endpoint para procesar el login
app.post('/login', async (req, res) => {
    const { email, password } = req.body;

    logger.info('Login attempt:', { email });

    try {
        db.get<User>('SELECT * FROM users WHERE email = ?', [email], async (err, user: User | undefined) => {
            if (err) {
                logger.error('Database error during login:', err);
                return res.status(500).json({ message: 'Error interno del servidor' });
            }

            if (!user) {
                logger.warn('Login failed: User not found', { email });
                return res.status(401).json({ message: 'Credenciales inválidas' });
            }

            const validPassword = await bcrypt.compare(password, user.password);
            if (!validPassword) {
                logger.warn('Login failed: Invalid password', { email });
                return res.status(401).json({ message: 'Credenciales inválidas' });
            }

            // Establecer la sesión
            req.session.user = {
                id: user.id,
                email: user.email,
                name: user.name
            };

            logger.info('Login successful:', { 
                userId: user.id,
                email: user.email,
                sessionId: req.session.id
            });

            res.json({ success: true });
        });
    } catch (error) {
        logger.error('Error in login:', error);
        res.status(500).json({ message: 'Error interno del servidor' });
    }
});

// Endpoint para autenticación con Google
app.post('/auth/google', async (req, res) => {
    const { credential } = req.body;
    try {
        // Aquí iría la verificación del token de Google
        // Por ahora, simulamos una autenticación exitosa con datos completos
        req.session.user = { 
            id: 1, // Deberías obtener o generar un ID real
            email: 'usuario@gmail.com',
            name: 'Usuario de Google'
        };
        res.json({ success: true });
    } catch (error) {
        logger.error('Error en autenticación con Google:', { error });
        res.status(401).json({ 
            success: false, 
            message: 'Error en autenticación con Google' 
        });
    }
});

// Ruta para cerrar sesión
app.get('/logout', (req: express.Request, res: express.Response) => {
    req.session.destroy((err) => {
        if (err) {
            logger.error('Error al cerrar sesión:', { error: err });
            return res.status(500).json({ success: false, message: 'Error al cerrar sesión' });
        }
        res.redirect('/login');
    });
});

app.post('/add-reminder', (req, res) => {
  try {
    const { email, reminder, frequency } = req.body;
    logger.info('Nuevo recordatorio recibido', { email, frequency });

    // Validaciones básicas
    if (!email || !reminder || !frequency) {
      logger.warn('Datos incompletos en la solicitud', req.body);
      return res.status(400).json({
        error: 'Todos los campos son requeridos'
      });
    }

    // Validar formato de email
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) {
      return res.status(400).json({
        error: 'Formato de email inválido'
      });
    }

    // Validar frecuencia
    const validFrequencies = ['daily', 'weekly', 'monthly'];
    if (!validFrequencies.includes(frequency)) {
      return res.status(400).json({
        error: 'Frecuencia inválida'
      });
    }

    const nextSendDate = calculateNextSendDate(frequency);

    db.run(
      `INSERT INTO reminders (email, reminder, frequency, next_send) 
       VALUES (?, ?, ?, ?)`,
      [email, reminder, frequency, nextSendDate.toISOString()],
      function(err) {
        if (err) {
          logger.error('Error guardando recordatorio', { error: err });
          return res.status(500).json({
            error: 'Error al guardar el recordatorio',
            details: err instanceof Error ? err.message : 'Error desconocido'
          });
        }
        logger.info('Recordatorio guardado exitosamente', { 
          id: this.lastID,
          email,
          frequency 
        });
        
        logger.info('Enviando email de confirmación', { email, reminder });

        sendEmail(
        email,
        `Tu recordatorio "${reminder}" ha sido configurado exitosamente.`
        ).then(() => {
        logger.info('Email enviado con éxito', { email });
        res.json({ success: true });
        }).catch(emailError => {
        logger.error('Error enviando email de confirmación', { emailError });

        db.run('DELETE FROM reminders WHERE id = ?', [this.lastID], (deleteErr) => {
            if (deleteErr) {
            logger.error('Error eliminando registro después de fallo en email', { deleteErr });
            }
        });

          res.status(500).json({
            error: 'Error al enviar el email de confirmación',
            details: emailError instanceof Error ? emailError.message : 'Error desconocido'
          });
        });
      }
    );
  } catch (error: unknown) {
    logger.error('Error inesperado', { error });
    res.status(500).json({
      error: 'Error interno del servidor',
      details: error instanceof Error ? error.message : 'Error desconocido'
    });
  }
});

// Proteger rutas que requieren autenticación
app.get('/list', requireAuth, (req, res) => {
    res.sendFile(path.join(__dirname, 'views', 'list.html'));
});

// Endpoint para obtener recordatorios
app.get('/reminders', requireAuth, (req, res) => {
    if (!req.session.user) {
        logger.error('No user in session when fetching reminders');
        return res.status(401).json({ message: 'No autorizado' });
    }

    const userId = req.session.user.id;
    
    logger.info('Fetching reminders for user:', { userId });

    const query = `
        SELECT 
            id, user_id, email, reminder, frequency,
            last_sent, next_send, created_at, active, status
        FROM reminders 
        WHERE user_id = ? 
        ORDER BY created_at DESC
    `;

    db.all(query, [userId], (err, rows) => {
        if (err) {
            logger.error('Error fetching reminders:', err);
            return res.status(500).json({ error: 'Error al obtener recordatorios' });
        }

        logger.info('Reminders fetched successfully:', { 
            userId,
            count: rows?.length || 0
        });

        res.json(rows || []);
    });
});

// Endpoint para crear recordatorio
app.post('/reminders', requireAuth, async (req, res) => {
    console.log('Iniciando creación de recordatorio');
    logger.info('POST /reminders - Request received:', {
        body: req.body,
        session: req.session
    });

    try {
        // Verificar sesión
        if (!req.session.user) {
            logger.error('No user in session');
            return res.status(401).json({ message: 'No autorizado' });
        }

        const userId = req.session.user.id;
        const { email, reminder, frequency } = req.body;

        logger.info('Datos recibidos:', {
            userId,
            email,
            reminder,
            frequency,
            sessionUser: req.session.user
        });

        // Validar campos
        if (!email || !reminder || !frequency) {
            logger.warn('Campos faltantes:', { email, reminder, frequency });
            return res.status(400).json({ 
                error: 'Todos los campos son requeridos',
                received: { email, reminder, frequency }
            });
        }

        // Validar frecuencia
        const validFrequencies = ['daily', 'weekly', 'monthly'];
        if (!validFrequencies.includes(frequency)) {
            logger.warn('Frecuencia inválida:', frequency);
            return res.status(400).json({ 
                error: 'Frecuencia inválida',
                validFrequencies
            });
        }

        // Calcular next_send
        const nextSendDate = new Date();
        switch (frequency) {
            case 'daily':
                nextSendDate.setDate(nextSendDate.getDate() + 1);
                break;
            case 'weekly':
                nextSendDate.setDate(nextSendDate.getDate() + 7);
                break;
            case 'monthly':
                nextSendDate.setMonth(nextSendDate.getMonth() + 1);
                break;
        }

        logger.info('Intentando insertar recordatorio:', {
            userId,
            email,
            nextSendDate
        });

        // Insertar recordatorio
        const insertResult = await new Promise<number>((resolve, reject) => {
            const query = `
                INSERT INTO reminders (
                    user_id, email, reminder, frequency, next_send, active, status
                ) VALUES (?, ?, ?, ?, ?, 1, 0)
            `;
            const params = [userId, email, reminder, frequency, nextSendDate.toISOString()];

            logger.info('Ejecutando query:', { query, params });

            db.run(query, params, function(err) {
                if (err) {
                    logger.error('Error en inserción:', err);
                    reject(err);
                } else {
                    logger.info('Inserción exitosa:', { lastID: this.lastID });
                    resolve(this.lastID);
                }
            });
        });

        logger.info('Recordatorio insertado:', { id: insertResult });

        // Enviar el primer correo inmediatamente
        try {
            logger.info('Intentando enviar correo inicial');
            await sendEmail(email, reminder);
            logger.info('Correo inicial enviado exitosamente');

            // Actualizar last_sent
            await new Promise<void>((resolve, reject) => {
                const updateQuery = `
                    UPDATE reminders 
                    SET last_sent = datetime('now')
                    WHERE id = ?
                `;
                
                logger.info('Actualizando last_sent:', { id: insertResult });
                
                db.run(updateQuery, [insertResult], (err) => {
                    if (err) {
                        logger.error('Error actualizando last_sent:', err);
                        reject(err);
                    } else {
                        logger.info('last_sent actualizado exitosamente');
                        resolve();
                    }
                });
            });

            res.json({ 
                success: true,
                id: insertResult,
                message: 'Recordatorio creado y enviado exitosamente'
            });
        } catch (emailError) {
            logger.error('Error enviando correo inicial:', emailError);
            
            res.json({ 
                success: true,
                id: insertResult,
                message: 'Recordatorio creado exitosamente, pero hubo un error al enviar el primer correo',
                emailError: emailError instanceof Error ? emailError.message : 'Unknown error'
            });
        }

    } catch (error) {
        logger.error('Error general en create reminder:', error);
        res.status(500).json({ 
            error: 'Error interno del servidor',
            details: error instanceof Error ? error.message : 'Unknown error'
        });
    }
});

// Mantener solo la función de envío de recordatorios
async function sendReminders() {
    try {
        const reminders = await new Promise<Reminder[]>((resolve, reject) => {
            db.all(
                `SELECT * FROM reminders 
                 WHERE datetime(next_send) <= datetime('now')`,
                [],
                (err, rows) => {
                    if (err) reject(err);
                    else resolve(rows as Reminder[]);
                }
            );
        });

        for (const reminder of reminders) {
            try {
                await sendEmail(reminder.email, reminder.reminder);
                logger.info(`Reminder sent to ${reminder.email}`);

                // Actualizar next_send basado en la frecuencia
                const nextSendDate = new Date();
                switch (reminder.frequency) {
                    case 'daily':
                        nextSendDate.setDate(nextSendDate.getDate() + 1);
                        break;
                    case 'weekly':
                        nextSendDate.setDate(nextSendDate.getDate() + 7);
                        break;
                    case 'monthly':
                        nextSendDate.setMonth(nextSendDate.getMonth() + 1);
                        break;
                }

                await new Promise<void>((resolve, reject) => {
                    db.run(
                        `UPDATE reminders 
                         SET last_sent = datetime('now'), 
                             next_send = datetime(?)
                         WHERE id = ?`,
                        [nextSendDate.toISOString(), reminder.id],
                        (err) => {
                            if (err) reject(err);
                            else resolve();
                        }
                    );
                });
            } catch (error) {
                logger.error(`Error sending reminder to ${reminder.email}:`, error);
            }
        }
    } catch (error) {
        logger.error('Error in sendReminders:', error);
    }
}

// Mantener el intervalo de envío de recordatorios
setInterval(sendReminders, 60 * 1000); // Cada minuto

app.get('/test-email', async (req, res) => {
  try {
    const result = await sendEmail(
      'est_em_pedraza@fesc.edu.co',
      'Este es un correo de prueba'
    );
    res.json({ success: result });
  } catch (error: any) {
    res.status(500).json({ 
      error: error?.message || 'Error desconocido' 
    });
  }
});

// Endpoint para eliminar recordatorio
app.delete('/reminders/:id', (req, res) => {
    const { id } = req.params;
    
    db.run('DELETE FROM reminders WHERE id = ?', [id], function(err) {
        if (err) {
            logger.error('Error eliminando recordatorio', { error: err });
            return res.status(500).json({
                error: 'Error al eliminar el recordatorio',
                details: err instanceof Error ? err.message : 'Error desconocido'
            });
        }
        res.json({ success: true });
    });
});

// Ruta para mostrar el formulario de edición
app.get('/edit-reminder/:id', requireAuth, (req, res) => {
    res.sendFile(path.join(__dirname, 'views', 'edit-form.html'));
});

// Endpoint para obtener un recordatorio específico
app.get('/reminders/:id', requireAuth, async (req, res) => {
    try {
        const reminder = await new Promise((resolve, reject) => {
            db.get(
                'SELECT * FROM reminders WHERE id = ? AND user_id = ?',
                [req.params.id, req.session.user?.id],
                (err, row) => {
                    if (err) reject(err);
                    else resolve(row);
                }
            );
        });

        if (!reminder) {
            return res.status(404).json({ error: 'Recordatorio no encontrado' });
        }

        res.json(reminder);
    } catch (error) {
        logger.error('Error getting reminder:', error);
        res.status(500).json({ error: 'Error interno del servidor' });
    }
});

// Ruta para actualizar un recordatorio
app.put('/reminders/:id', requireAuth, async (req, res) => {
    try {
        const { email, reminder, frequency } = req.body;
        
        // Validar campos
        if (!email || !reminder || !frequency) {
            return res.status(400).json({ error: 'Todos los campos son requeridos' });
        }

        // Calcular next_send basado en la frecuencia
        const nextSendDate = new Date();
        switch (frequency) {
            case 'daily':
                nextSendDate.setDate(nextSendDate.getDate() + 1);
                break;
            case 'weekly':
                nextSendDate.setDate(nextSendDate.getDate() + 7);
                break;
            case 'monthly':
                nextSendDate.setMonth(nextSendDate.getMonth() + 1);
                break;
            default:
                return res.status(400).json({ error: 'Frecuencia inválida' });
        }

        await new Promise<void>((resolve, reject) => {
            db.run(
                `UPDATE reminders 
                 SET email = ?, reminder = ?, frequency = ?, next_send = datetime(?)
                 WHERE id = ? AND user_id = ?`,
                [
                    email,
                    reminder,
                    frequency,
                    nextSendDate.toISOString(),
                    req.params.id,
                    req.session.user?.id
                ],
                (err) => {
                    if (err) reject(err);
                    else resolve();
                }
            );
        });

        res.json({ success: true, message: 'Recordatorio actualizado correctamente' });
    } catch (error) {
        logger.error('Error updating reminder:', error);
        res.status(500).json({ error: 'Error interno del servidor' });
    }
});

app.listen(PORT, () => {
  logger.info(`Servidor iniciado en http://localhost:${PORT}`);
}); 