import schedule from 'node-schedule';
import { processReminders } from './services/reminderService.js';
import logger from './services/logger.js';

export function startScheduler(): void {
  // Ejecutar cada minuto (para probar)
  schedule.scheduleJob('* * * * *', async () => {
    logger.info('Iniciando procesamiento de recordatorios...');
    try {
      await processReminders();
      logger.info('Procesamiento de recordatorios completado');
    } catch (error) {
      logger.error('Error procesando recordatorios:', { error });
    }
  });
} 