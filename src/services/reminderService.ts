import { addDays, addWeeks, addMonths } from 'date-fns';
import db from '../database.js';
import { sendEmail } from './emailService.js';
import logger from './logger.js';

interface Reminder {
  id: number;
  email: string;
  reminder: string;
  frequency: string;
  next_send: string;
}

export function calculateNextSendDate(frequency: string, from: Date = new Date()): Date {
  switch (frequency) {
    case 'daily':
      return addDays(from, 1);
    case 'weekly':
      return addWeeks(from, 1);
    case 'monthly':
      return addMonths(from, 1);
    default:
      return addDays(from, 1);
  }
}

export async function processReminders(): Promise<void> {
  logger.info('Iniciando procesamiento de recordatorios');
  
  return new Promise((resolve, reject) => {
    db.all(
      `SELECT * FROM reminders 
       WHERE active = 1 
       AND next_send <= datetime('now')`,
      [],
      async (err, rows: Reminder[]) => {
        if (err) {
          logger.error('Error al consultar recordatorios', { error: err });
          reject(err);
          return;
        }

        logger.info(`Encontrados ${rows.length} recordatorios para procesar`);

        for (const reminder of rows) {
          logger.info('Procesando recordatorio', { 
            id: reminder.id, 
            email: reminder.email 
          });

          const emailSent = await sendEmail(reminder.email, reminder.reminder);
          
          if (emailSent) {
            const nextSendDate = calculateNextSendDate(reminder.frequency);
            logger.info('Email enviado exitosamente, actualizando próxima fecha', {
              id: reminder.id,
              nextSendDate
            });
            
            db.run(
              `UPDATE reminders 
               SET last_sent = datetime('now'),
               next_send = ?
               WHERE id = ?`,
              [nextSendDate.toISOString(), reminder.id],
              (err) => {
                if (err) {
                  logger.error('Error actualizando recordatorio', {
                    id: reminder.id,
                    error: err
                  });
                }
              }
            );
          } else {
            logger.error('Error enviando email', {
              id: reminder.id,
              email: reminder.email
            });
          }
        }
        
        logger.info('Procesamiento de recordatorios completado');
        resolve();
      }
    );
  });
} 