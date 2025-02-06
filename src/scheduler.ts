import schedule from 'node-schedule';
import { processReminders } from './services/reminderService.js';
import logger from './services/logger.js';

export function startScheduler(): void {
  // Ejecutar cada minuto (para probar)
  schedule.scheduleJob('* * * * *', async () => {
    try {
      await processReminders();
    } catch (error) {
      logger.error('Error procesando recordatorios:', { error });
    }
  });
} 