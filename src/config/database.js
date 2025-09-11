const { PrismaClient } = require('@prisma/client');
const logger = require('../utils/logger');

// Instance Prisma globale
let prisma;

// Configuration Prisma avec gestion d'erreurs
function createPrismaClient() {
  return new PrismaClient({
    log: [
      {
        emit: 'event',
        level: 'query',
      },
      {
        emit: 'event',
        level: 'error',
      },
      {
        emit: 'event',
        level: 'info',
      },
      {
        emit: 'event',
        level: 'warn',
      },
    ],
    errorFormat: 'pretty',
  });
}

// Initialiser la connexion à la base de données
async function initializeDatabase() {
  try {
    if (!prisma) {
      prisma = createPrismaClient();

      // Événements de logging
      prisma.$on('query', (e) => {
        if (process.env.NODE_ENV === 'development') {
          logger.debug('Query:', {
            query: e.query,
            params: e.params,
            duration: `${e.duration}ms`,
            timestamp: e.timestamp
          });
        }
      });

      prisma.$on('error', (e) => {
        logger.error('Database Error:', {
          message: e.message,
          target: e.target,
          timestamp: e.timestamp
        });
      });

      prisma.$on('info', (e) => {
        logger.info('Database Info:', {
          message: e.message,
          target: e.target,
          timestamp: e.timestamp
        });
      });

      prisma.$on('warn', (e) => {
        logger.warn('Database Warning:', {
          message: e.message,
          target: e.target,
          timestamp: e.timestamp
        });
      });
    }

    // Tester la connexion
    await prisma.$connect();
    logger.info('Connexion à la base de données établie');

    // Vérifier la santé de la base de données
    await prisma.$queryRaw`SELECT 1`;
    logger.info('Test de santé de la base de données réussi');

    return prisma;
  } catch (error) {
    logger.error('Erreur lors de l\'initialisation de la base de données:', error);
    throw error;
  }
}

// Fermer la connexion à la base de données
async function disconnectDatabase() {
  try {
    if (prisma) {
      await prisma.$disconnect();
      logger.info('Connexion à la base de données fermée');
    }
  } catch (error) {
    logger.error('Erreur lors de la fermeture de la base de données:', error);
    throw error;
  }
}

// Obtenir l'instance Prisma
function getPrismaClient() {
  if (!prisma) {
    throw new Error('Base de données non initialisée. Appelez initializeDatabase() d\'abord.');
  }
  return prisma;
}

// Fonction utilitaire pour les transactions
async function executeTransaction(callback) {
  const client = getPrismaClient();
  try {
    return await client.$transaction(callback);
  } catch (error) {
    logger.error('Erreur lors de la transaction:', error);
    throw error;
  }
}

// Fonction de santé de la base de données
async function checkDatabaseHealth() {
  try {
    const client = getPrismaClient();
    const start = Date.now();
    await client.$queryRaw`SELECT 1`;
    const duration = Date.now() - start;
    
    return {
      status: 'healthy',
      responseTime: `${duration}ms`,
      timestamp: new Date().toISOString()
    };
  } catch (error) {
    logger.error('Vérification de santé de la base de données échouée:', error);
    return {
      status: 'unhealthy',
      error: error.message,
      timestamp: new Date().toISOString()
    };
  }
}

// Fonction de nettoyage des anciennes données
async function cleanupOldData() {
  try {
    const client = getPrismaClient();
    const daysToKeep = parseInt(process.env.CLEANUP_OLD_MESSAGES_DAYS) || 90;
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - daysToKeep);

    // Supprimer les anciens messages
    const deletedMessages = await client.message.deleteMany({
      where: {
        timestamp: {
          lt: cutoffDate
        }
      }
    });

    // Supprimer les anciennes conversations terminées
    const deletedConversations = await client.conversation.deleteMany({
      where: {
        status: 'ENDED',
        endedAt: {
          lt: cutoffDate
        }
      }
    });

    // Supprimer les anciens logs d'activité
    const deletedLogs = await client.activityLog.deleteMany({
      where: {
        timestamp: {
          lt: cutoffDate
        }
      }
    });

    logger.info('Nettoyage des anciennes données terminé', {
      messagesDeleted: deletedMessages.count,
      conversationsDeleted: deletedConversations.count,
      logsDeleted: deletedLogs.count,
      cutoffDate: cutoffDate.toISOString()
    });

    return {
      messagesDeleted: deletedMessages.count,
      conversationsDeleted: deletedConversations.count,
      logsDeleted: deletedLogs.count
    };
  } catch (error) {
    logger.error('Erreur lors du nettoyage des anciennes données:', error);
    throw error;
  }
}

module.exports = {
  initializeDatabase,
  disconnectDatabase,
  getPrismaClient,
  executeTransaction,
  checkDatabaseHealth,
  cleanupOldData
};