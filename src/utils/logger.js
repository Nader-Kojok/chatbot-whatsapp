const winston = require('winston');
const path = require('path');
const fs = require('fs');

// Créer le dossier de logs s'il n'existe pas
const logDir = path.join(process.cwd(), 'logs');
if (!fs.existsSync(logDir)) {
  fs.mkdirSync(logDir, { recursive: true });
}

// Configuration des niveaux de log personnalisés
const logLevels = {
  error: 0,
  warn: 1,
  info: 2,
  http: 3,
  debug: 4
};

// Couleurs pour les niveaux de log
const logColors = {
  error: 'red',
  warn: 'yellow',
  info: 'green',
  http: 'magenta',
  debug: 'blue'
};

winston.addColors(logColors);

// Format personnalisé pour les logs
const logFormat = winston.format.combine(
  winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
  winston.format.errors({ stack: true }),
  winston.format.json(),
  winston.format.prettyPrint()
);

// Format pour la console (développement)
const consoleFormat = winston.format.combine(
  winston.format.colorize({ all: true }),
  winston.format.timestamp({ format: 'HH:mm:ss' }),
  winston.format.printf(({ timestamp, level, message, ...meta }) => {
    let log = `${timestamp} [${level}]: ${message}`;
    
    // Ajouter les métadonnées si présentes
    if (Object.keys(meta).length > 0) {
      log += ` ${JSON.stringify(meta, null, 2)}`;
    }
    
    return log;
  })
);

// Configuration des transports
const transports = [];

// Transport console (toujours actif en développement)
if (process.env.NODE_ENV !== 'production') {
  transports.push(
    new winston.transports.Console({
      level: 'debug',
      format: consoleFormat
    })
  );
}

// Transport fichier pour tous les logs
transports.push(
  new winston.transports.File({
    filename: path.join(logDir, 'app.log'),
    level: process.env.LOG_LEVEL || 'info',
    format: logFormat,
    maxsize: 5242880, // 5MB
    maxFiles: 5,
    tailable: true
  })
);

// Transport fichier pour les erreurs uniquement
transports.push(
  new winston.transports.File({
    filename: path.join(logDir, 'error.log'),
    level: 'error',
    format: logFormat,
    maxsize: 5242880, // 5MB
    maxFiles: 5,
    tailable: true
  })
);

// Transport fichier pour les requêtes HTTP
transports.push(
  new winston.transports.File({
    filename: path.join(logDir, 'http.log'),
    level: 'http',
    format: logFormat,
    maxsize: 5242880, // 5MB
    maxFiles: 3,
    tailable: true
  })
);

// Créer l'instance du logger
const logger = winston.createLogger({
  levels: logLevels,
  format: logFormat,
  transports,
  exitOnError: false,
  silent: process.env.NODE_ENV === 'test'
});

// Ajouter la console en production si nécessaire
if (process.env.NODE_ENV === 'production' && process.env.ENABLE_CONSOLE_LOGS === 'true') {
  logger.add(
    new winston.transports.Console({
      level: 'warn',
      format: consoleFormat
    })
  );
}

// Fonction utilitaire pour logger les requêtes HTTP
logger.logRequest = (req, res, responseTime) => {
  const logData = {
    method: req.method,
    url: req.originalUrl,
    statusCode: res.statusCode,
    responseTime: `${responseTime}ms`,
    ip: req.ip,
    userAgent: req.get('User-Agent'),
    contentLength: res.get('Content-Length') || 0
  };

  if (res.statusCode >= 400) {
    logger.warn('HTTP Request Error', logData);
  } else {
    logger.http('HTTP Request', logData);
  }
};

// Fonction utilitaire pour logger les erreurs avec contexte
logger.logError = (error, context = {}) => {
  const errorData = {
    message: error.message,
    stack: error.stack,
    name: error.name,
    code: error.code,
    ...context
  };

  logger.error('Application Error', errorData);
};

// Fonction utilitaire pour logger les événements WhatsApp
logger.logWhatsApp = (event, data = {}) => {
  logger.info(`WhatsApp Event: ${event}`, {
    event,
    timestamp: new Date().toISOString(),
    ...data
  });
};

// Fonction utilitaire pour logger les événements NLP
logger.logNLP = (action, data = {}) => {
  logger.info(`NLP Action: ${action}`, {
    action,
    timestamp: new Date().toISOString(),
    ...data
  });
};

// Fonction utilitaire pour logger les événements de tickets
logger.logTicket = (action, ticketId, data = {}) => {
  logger.info(`Ticket Action: ${action}`, {
    action,
    ticketId,
    timestamp: new Date().toISOString(),
    ...data
  });
};

// Fonction utilitaire pour logger les performances
logger.logPerformance = (operation, duration, data = {}) => {
  const logData = {
    operation,
    duration: `${duration}ms`,
    timestamp: new Date().toISOString(),
    ...data
  };

  if (duration > 1000) {
    logger.warn('Slow Operation', logData);
  } else {
    logger.debug('Performance', logData);
  }
};

// Fonction utilitaire pour logger les événements de sécurité
logger.logSecurity = (event, data = {}) => {
  logger.warn(`Security Event: ${event}`, {
    event,
    timestamp: new Date().toISOString(),
    ...data
  });
};

// Middleware Express pour logger automatiquement les requêtes
logger.requestMiddleware = () => {
  return (req, res, next) => {
    const start = Date.now();
    
    // Capturer la fin de la réponse
    const originalSend = res.send;
    res.send = function(data) {
      const responseTime = Date.now() - start;
      logger.logRequest(req, res, responseTime);
      return originalSend.call(this, data);
    };
    
    next();
  };
};

// Gestionnaire d'exceptions non capturées
process.on('uncaughtException', (error) => {
  logger.error('Uncaught Exception', {
    message: error.message,
    stack: error.stack,
    timestamp: new Date().toISOString()
  });
  
  // Donner le temps au logger d'écrire avant de quitter
  setTimeout(() => {
    process.exit(1);
  }, 1000);
});

// Gestionnaire de promesses rejetées
process.on('unhandledRejection', (reason, promise) => {
  logger.error('Unhandled Rejection', {
    reason: reason?.message || reason,
    stack: reason?.stack,
    promise: promise.toString(),
    timestamp: new Date().toISOString()
  });
});

module.exports = logger;