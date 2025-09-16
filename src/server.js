const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
require('dotenv').config();

const logger = require('./utils/logger');
const { errorHandler, notFound } = require('./middleware/errorMiddleware');
const webhookRoutes = require('./routes/webhook');
const apiRoutes = require('./routes/api');
const { connectRedis } = require('./config/redis');
const { initializeDatabase } = require('./config/database');

const app = express();
const PORT = process.env.PORT || 3000;

// Configuration de sécurité
app.use(helmet());
app.use(cors({
  origin: process.env.ALLOWED_ORIGINS?.split(',') || ['http://localhost:3000'],
  credentials: true
}));

// Rate limiting
const limiter = rateLimit({
  windowMs: parseInt(process.env.RATE_LIMIT_WINDOW_MS) || 15 * 60 * 1000, // 15 minutes
  max: parseInt(process.env.RATE_LIMIT_MAX_REQUESTS) || 100,
  message: {
    error: 'Trop de requêtes, veuillez réessayer plus tard.',
    retryAfter: Math.ceil((parseInt(process.env.RATE_LIMIT_WINDOW_MS) || 900000) / 1000)
  },
  standardHeaders: true,
  legacyHeaders: false
});

app.use('/api/', limiter);

// Middleware de parsing
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// Middleware de logging
app.use((req, res, next) => {
  logger.info(`${req.method} ${req.path}`, {
    ip: req.ip,
    userAgent: req.get('User-Agent'),
    timestamp: new Date().toISOString()
  });
  next();
});

// Routes principales
app.use('/webhook', webhookRoutes);
app.use('/api', apiRoutes);

// Route de santé
app.get('/health', (req, res) => {
  res.status(200).json({
    status: 'OK',
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
    environment: process.env.NODE_ENV,
    version: process.env.npm_package_version || '1.0.0'
  });
});

// Route racine
app.get('/', (req, res) => {
  res.json({
    message: 'Agent WhatsApp Intelligent - API Server',
    version: '1.0.0',
    status: 'running',
    documentation: '/api/docs'
  });
});

// Middleware de gestion d'erreurs
app.use(notFound);
app.use(errorHandler);

// Fonction d'initialisation
async function initializeServer() {
  try {
    // Initialiser la base de données
    await initializeDatabase();
    logger.info('Base de données initialisée avec succès');

    // Connecter Redis
    await connectRedis();
    logger.info('Redis connecté avec succès');

    // Démarrer le serveur
    const server = app.listen(PORT, '0.0.0.0', () => {
      logger.info(`🚀 Serveur démarré sur le port ${PORT}`);
      logger.info(`🌍 Environnement: ${process.env.NODE_ENV}`);
      logger.info(`📱 WhatsApp Webhook: http://0.0.0.0:${PORT}/webhook`);
      logger.info(`🔗 API: http://0.0.0.0:${PORT}/api`);
    });

    // Gestion gracieuse de l'arrêt
    const gracefulShutdown = (signal) => {
      logger.info(`Signal ${signal} reçu, arrêt gracieux du serveur...`);
      server.close(() => {
        logger.info('Serveur HTTP fermé');
        process.exit(0);
      });
    };

    process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
    process.on('SIGINT', () => gracefulShutdown('SIGINT'));

    return server;
  } catch (error) {
    logger.error('Erreur lors de l\'initialisation du serveur:', error);
    process.exit(1);
  }
}

// Démarrer le serveur si ce fichier est exécuté directement
if (require.main === module) {
  initializeServer();
}

module.exports = { app, initializeServer };