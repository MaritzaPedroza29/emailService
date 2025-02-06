import * as dotenv from 'dotenv';
import nodemailer, { SentMessageInfo } from 'nodemailer';
import logger from './logger.js';
import { readFileSync } from 'fs';

// Ruta completa al archivo .ev
const envPath = './.env';

try {
    // Intentar leer el archivo directame./nte
    const envContent = readFileSync(envPath, 'utf8');

    // Cargar .env con ruta absoluta
    const result = dotenv.config({ 
        path: envPath,
        debug: true
    });

    // Si no hay variables, las configuramos manualmente
    if (!process.env.EMAIL_USER || !process.env.EMAIL_PASSWORD) {
        const envVars = envContent.split('\n').reduce((acc: any, line) => {
            const [key, value] = line.split('=');
            if (key && value) {
                acc[key.trim()] = value.trim();
            }
            return acc;
        }, {});

        process.env.EMAIL_USER = envVars.EMAIL_USER;
        process.env.EMAIL_PASSWORD = envVars.EMAIL_PASSWORD;
    }

} catch (error) {
    console.error('Error al leer/procesar el archivo .env:', error);
    process.exit(1);
}

// Verificar las variables de entorno después de todo el proceso
const EMAIL_USER = process.env.EMAIL_USER || '';
const EMAIL_PASSWORD = process.env.EMAIL_PASSWORD || '';

// if (!EMAIL_USER || !EMAIL_PASSWORD) {
//     const errorMsg = `Configuración de email incompleta después de todo el proceso de carga`;
//     logger.error(errorMsg, {
//         envPath,
//         loadedVars: {
//             hasUser: !!process.env.EMAIL_USER,
//             hasPassword: !!process.env.EMAIL_PASSWORD
//         }
//     });
//     throw new Error(errorMsg);
// }

// Configuración del transporter
const transporter = nodemailer.createTransport({
    service: 'gmail',
    auth: {
        user: EMAIL_USER,
        pass: EMAIL_PASSWORD
    },
});


export async function sendEmail(to: string, reminder: string): Promise<boolean> {
    try {
        const info: SentMessageInfo = await transporter.sendMail({
            from: {
                name: 'Sistema de Recordatorios',
                address: EMAIL_USER as string
            },
            to,
            subject: 'Recordatorio Programado',
            text: reminder,
            html: `
                <div style="font-family: Arial, sans-serif; padding: 20px;">
                    <h2>Recordatorio</h2>
                    <p>${reminder}</p>
                    <hr>
                    <p style="color: #666; font-size: 12px;">
                        Este es un mensaje automático del Sistema de Recordatorios
                    </p>
                </div>
            `
        });

        return true;
    } catch (error) {
        const nodeError = error as NodemailerError;
        logger.error('Error al enviar email:', {
            error: {
                code: nodeError.code,
                message: nodeError.message
            },
            to,
            emailUser: EMAIL_USER
        });
        return false;
    }
}

interface NodemailerError extends Error {
    code?: string;
    command?: string;
} 