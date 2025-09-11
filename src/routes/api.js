const express = require('express');
const { asyncHandler } = require('../middleware/errorMiddleware');
const { checkDatabaseHealth } = require('../config/database');
const { checkRedisHealth } = require('../config/redis');
const WhatsAppService = require('../services/whatsappService');
const logger = require('../utils/logger');

const router = express.Router();
const whatsappService = new WhatsAppService();

// GET /api/health - Vérification de santé globale
router.get('/health', asyncHandler(async (req, res) => {
  const checks = await Promise.allSettled([
    checkDatabaseHealth(),
    checkRedisHealth(),
    whatsappService.checkAPIHealth()
  ]);

  const [dbHealth, redisHealth, whatsappHealth] = checks.map(result => 
    result.status === 'fulfilled' ? result.value : { 
      status: 'unhealthy', 
      error: result.reason?.message || 'Unknown error' 
    }
  );

  const overallStatus = [
    dbHealth.status,
    redisHealth.status,
    whatsappHealth.status
  ].every(status => status === 'healthy') ? 'healthy' : 'unhealthy';

  const healthReport = {
    status: overallStatus,
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
    environment: process.env.NODE_ENV,
    version: process.env.npm_package_version || '1.0.0',
    services: {
      database: dbHealth,
      redis: redisHealth,
      whatsapp: whatsappHealth
    },
    system: {
      nodeVersion: process.version,
      platform: process.platform,
      memory: {
        used: Math.round(process.memoryUsage().heapUsed / 1024 / 1024),
        total: Math.round(process.memoryUsage().heapTotal / 1024 / 1024)
      }
    }
  };

  const statusCode = overallStatus === 'healthy' ? 200 : 503;
  res.status(statusCode).json(healthReport);
}));

// GET /api/status - Statut simplifié
router.get('/status', (req, res) => {
  res.json({
    status: 'running',
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
    environment: process.env.NODE_ENV
  });
});

// GET /api/info - Informations sur l'application
router.get('/info', (req, res) => {
  res.json({
    name: 'Agent WhatsApp Intelligent',
    version: process.env.npm_package_version || '1.0.0',
    description: 'Agent WhatsApp intelligent pour service client avec NLP avancé',
    environment: process.env.NODE_ENV,
    features: [
      'Réponses automatiques 24h/24 et 7j/7',
      'Interface interactive avec boutons',
      'Traitement du langage naturel (NLP)',
      'Support multilingue (français et anglais)',
      'Gestion complète des tickets',
      'Transfert vers agents humains',
      'Notifications automatiques',
      'Base de connaissances intégrée'
    ],
    endpoints: {
      webhook: '/webhook',
      health: '/api/health',
      status: '/api/status',
      docs: '/api/docs'
    },
    timestamp: new Date().toISOString()
  });
});

// GET /api/docs - Documentation de l'API
router.get('/docs', (req, res) => {
  const docs = {
    title: 'Agent WhatsApp Intelligent - API Documentation',
    version: '1.0.0',
    baseUrl: process.env.API_BASE_URL || 'http://localhost:3000',
    endpoints: {
      webhook: {
        'GET /webhook': {
          description: 'Vérification du webhook WhatsApp',
          parameters: {
            'hub.mode': 'Mode de vérification (subscribe)',
            'hub.verify_token': 'Token de vérification',
            'hub.challenge': 'Challenge à retourner'
          }
        },
        'POST /webhook': {
          description: 'Réception des événements WhatsApp',
          headers: {
            'X-Hub-Signature-256': 'Signature de sécurité'
          },
          body: 'Données de l\'événement WhatsApp'
        },
        'GET /webhook/health': {
          description: 'Vérification de santé du webhook'
        },
        'GET /webhook/info': {
          description: 'Informations sur la configuration du webhook'
        }
      },
      api: {
        'GET /api/health': {
          description: 'Vérification de santé globale de l\'application'
        },
        'GET /api/status': {
          description: 'Statut simplifié de l\'application'
        },
        'GET /api/info': {
          description: 'Informations générales sur l\'application'
        },
        'GET /api/docs': {
          description: 'Documentation de l\'API'
        }
      }
    },
    authentication: {
      webhook: 'Signature HMAC SHA-256 avec secret d\'application',
      api: 'Aucune authentification requise pour les endpoints publics'
    },
    rateLimit: {
      window: '15 minutes',
      maxRequests: 100,
      scope: 'Par adresse IP'
    },
    errors: {
      format: {
        success: false,
        error: {
          message: 'Description de l\'erreur',
          type: 'Type d\'erreur',
          statusCode: 'Code de statut HTTP'
        },
        timestamp: 'Horodatage ISO 8601',
        path: 'Chemin de la requête',
        method: 'Méthode HTTP'
      },
      codes: {
        400: 'Requête invalide',
        401: 'Non authentifié',
        403: 'Non autorisé',
        404: 'Ressource non trouvée',
        409: 'Conflit de ressource',
        429: 'Trop de requêtes',
        500: 'Erreur interne du serveur',
        503: 'Service indisponible'
      }
    },
    examples: {
      webhookVerification: {
        request: 'GET /webhook?hub.mode=subscribe&hub.verify_token=YOUR_TOKEN&hub.challenge=CHALLENGE',
        response: 'CHALLENGE'
      },
      healthCheck: {
        request: 'GET /api/health',
        response: {
          status: 'healthy',
          timestamp: '2024-01-01T12:00:00.000Z',
          services: {
            database: { status: 'healthy' },
            redis: { status: 'healthy' },
            whatsapp: { status: 'healthy' }
          }
        }
      }
    }
  };

  res.json(docs);
});

// GET /api/metrics - Métriques de base (si monitoring activé)
router.get('/metrics', asyncHandler(async (req, res) => {
  const metrics = {
    timestamp: new Date().toISOString(),
    uptime: {
      seconds: process.uptime(),
      formatted: formatUptime(process.uptime())
    },
    memory: {
      usage: process.memoryUsage(),
      formatted: {
        heapUsed: `${Math.round(process.memoryUsage().heapUsed / 1024 / 1024)} MB`,
        heapTotal: `${Math.round(process.memoryUsage().heapTotal / 1024 / 1024)} MB`,
        external: `${Math.round(process.memoryUsage().external / 1024 / 1024)} MB`
      }
    },
    cpu: {
      usage: process.cpuUsage()
    },
    environment: {
      nodeVersion: process.version,
      platform: process.platform,
      arch: process.arch,
      pid: process.pid
    }
  };

  res.json(metrics);
}));

// Fonction utilitaire pour formater l'uptime
function formatUptime(seconds) {
  const days = Math.floor(seconds / 86400);
  const hours = Math.floor((seconds % 86400) / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const secs = Math.floor(seconds % 60);

  const parts = [];
  if (days > 0) parts.push(`${days}j`);
  if (hours > 0) parts.push(`${hours}h`);
  if (minutes > 0) parts.push(`${minutes}m`);
  if (secs > 0) parts.push(`${secs}s`);

  return parts.join(' ') || '0s';
}

// Middleware de gestion d'erreurs spécifique aux routes API
router.use((error, req, res, next) => {
  logger.error('Erreur API:', error);
  
  res.status(error.statusCode || 500).json({
    success: false,
    error: {
      message: error.message || 'Erreur interne du serveur',
      type: error.type || 'InternalServerError',
      statusCode: error.statusCode || 500
    },
    timestamp: new Date().toISOString(),
    path: req.originalUrl,
    method: req.method
  });
});

module.exports = router;