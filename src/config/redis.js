const redis = require('redis');
const axios = require('axios');
const logger = require('../utils/logger');

let redisClient;
let useUpstash = false;

// Configuration du client Redis
function createRedisClient() {
  // Vérifier si on utilise Upstash
  if (process.env.UPSTASH_REDIS_REST_URL && process.env.UPSTASH_REDIS_REST_TOKEN) {
    useUpstash = true;
    logger.info('Utilisation d\'Upstash Redis REST API');
    return createUpstashClient();
  }
  
  // Configuration Redis standard
  const config = {
    url: process.env.REDIS_URL || 'redis://localhost:6379',
    password: process.env.REDIS_PASSWORD || undefined,
    database: parseInt(process.env.REDIS_DB) || 0,
    retryDelayOnFailover: 100,
    enableReadyCheck: true,
    maxRetriesPerRequest: 3,
    lazyConnect: true,
    keepAlive: 30000,
    connectTimeout: 10000,
    commandTimeout: 5000
  };

  return redis.createClient(config);
}

// Client Upstash REST API
function createUpstashClient() {
  const baseURL = process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN;
  
  return {
    isUpstash: true,
    baseURL,
    token,
    isOpen: true,
    
    async connect() {
      // Pas besoin de connexion avec REST API
      return Promise.resolve();
    },
    
    async quit() {
      // Pas besoin de fermeture avec REST API
      return Promise.resolve();
    },
    
    async ping() {
      return await this.executeCommand(['PING']);
    },
    
    async get(key) {
      const result = await this.executeCommand(['GET', key]);
      return result;
    },
    
    async set(key, value) {
      return await this.executeCommand(['SET', key, value]);
    },
    
    async setEx(key, seconds, value) {
      return await this.executeCommand(['SETEX', key, seconds, value]);
    },
    
    async del(key) {
      if (Array.isArray(key)) {
        return await this.executeCommand(['DEL', ...key]);
      }
      return await this.executeCommand(['DEL', key]);
    },
    
    async exists(key) {
      return await this.executeCommand(['EXISTS', key]);
    },
    
    async expire(key, seconds) {
      return await this.executeCommand(['EXPIRE', key, seconds]);
    },
    
    async ttl(key) {
      return await this.executeCommand(['TTL', key]);
    },
    
    async keys(pattern) {
      return await this.executeCommand(['KEYS', pattern]);
    },
    
    async incr(key) {
      return await this.executeCommand(['INCR', key]);
    },
    
    async executeCommand(command) {
      try {
        const response = await axios.post(
          `${this.baseURL}/pipeline`,
          [command],
          {
            headers: {
              'Authorization': `Bearer ${this.token}`,
              'Content-Type': 'application/json'
            },
            timeout: 5000
          }
        );
        
        const result = response.data[0];
        if (result.error) {
          throw new Error(result.error);
        }
        
        return result.result;
      } catch (error) {
        logger.error('Erreur Upstash Redis:', error.message);
        throw error;
      }
    }
  };
}

// Initialiser la connexion Redis
async function connectRedis() {
  try {
    if (!redisClient) {
      redisClient = createRedisClient();

      // Gestionnaires d'événements pour Redis standard uniquement
      if (!redisClient.isUpstash) {
        redisClient.on('connect', () => {
          logger.info('Connexion à Redis en cours...');
        });

        redisClient.on('ready', () => {
          logger.info('Redis connecté et prêt');
        });

        redisClient.on('error', (error) => {
          logger.error('Erreur Redis:', error);
        });

        redisClient.on('end', () => {
          logger.info('Connexion Redis fermée');
        });

        redisClient.on('reconnecting', () => {
          logger.info('Reconnexion à Redis...');
        });
      }
    }

    // Connecter si pas déjà connecté
    if (!redisClient.isOpen) {
      await redisClient.connect();
    }

    // Tester la connexion
    const pingResult = await redisClient.ping();
    if (redisClient.isUpstash) {
      logger.info('Test de connexion Upstash Redis réussi:', pingResult);
    } else {
      logger.info('Test de connexion Redis réussi');
    }

    return redisClient;
  } catch (error) {
    logger.error('Erreur lors de la connexion à Redis:', error);
    throw error;
  }
}

// Fermer la connexion Redis
async function disconnectRedis() {
  try {
    if (redisClient && redisClient.isOpen) {
      await redisClient.quit();
      logger.info('Connexion Redis fermée proprement');
    }
  } catch (error) {
    logger.error('Erreur lors de la fermeture de Redis:', error);
    throw error;
  }
}

// Obtenir le client Redis
function getRedisClient() {
  if (!redisClient || !redisClient.isOpen) {
    throw new Error('Redis non connecté. Appelez connectRedis() d\'abord.');
  }
  return redisClient;
}

// Fonctions utilitaires pour le cache
class CacheService {
  constructor() {
    this.defaultTTL = 3600; // 1 heure par défaut
  }

  // Définir une valeur dans le cache
  async set(key, value, ttl = this.defaultTTL) {
    try {
      const client = getRedisClient();
      const serializedValue = JSON.stringify(value);
      await client.setEx(key, ttl, serializedValue);
      logger.debug(`Cache SET: ${key} (TTL: ${ttl}s)`);
    } catch (error) {
      logger.error(`Erreur cache SET ${key}:`, error);
      throw error;
    }
  }

  // Obtenir une valeur du cache
  async get(key) {
    try {
      const client = getRedisClient();
      const value = await client.get(key);
      if (value) {
        logger.debug(`Cache HIT: ${key}`);
        return JSON.parse(value);
      }
      logger.debug(`Cache MISS: ${key}`);
      return null;
    } catch (error) {
      logger.error(`Erreur cache GET ${key}:`, error);
      return null; // Retourner null en cas d'erreur pour ne pas bloquer l'application
    }
  }

  // Supprimer une clé du cache
  async del(key) {
    try {
      const client = getRedisClient();
      const result = await client.del(key);
      logger.debug(`Cache DEL: ${key} (${result} clé(s) supprimée(s))`);
      return result;
    } catch (error) {
      logger.error(`Erreur cache DEL ${key}:`, error);
      throw error;
    }
  }

  // Vérifier si une clé existe
  async exists(key) {
    try {
      const client = getRedisClient();
      const result = await client.exists(key);
      return result === 1;
    } catch (error) {
      logger.error(`Erreur cache EXISTS ${key}:`, error);
      return false;
    }
  }

  // Définir le TTL d'une clé existante
  async expire(key, ttl) {
    try {
      const client = getRedisClient();
      const result = await client.expire(key, ttl);
      logger.debug(`Cache EXPIRE: ${key} (TTL: ${ttl}s)`);
      return result === 1;
    } catch (error) {
      logger.error(`Erreur cache EXPIRE ${key}:`, error);
      throw error;
    }
  }

  // Obtenir le TTL d'une clé
  async ttl(key) {
    try {
      const client = getRedisClient();
      return await client.ttl(key);
    } catch (error) {
      logger.error(`Erreur cache TTL ${key}:`, error);
      return -1;
    }
  }

  // Supprimer toutes les clés correspondant à un pattern
  async deletePattern(pattern) {
    try {
      const client = getRedisClient();
      const keys = await client.keys(pattern);
      if (keys.length > 0) {
        const result = await client.del(keys);
        logger.debug(`Cache DEL PATTERN: ${pattern} (${result} clé(s) supprimée(s))`);
        return result;
      }
      return 0;
    } catch (error) {
      logger.error(`Erreur cache DELETE PATTERN ${pattern}:`, error);
      throw error;
    }
  }

  // Incrémenter une valeur numérique
  async incr(key, ttl = this.defaultTTL) {
    try {
      const client = getRedisClient();
      const result = await client.incr(key);
      if (result === 1) {
        // Première fois, définir le TTL
        await client.expire(key, ttl);
      }
      return result;
    } catch (error) {
      logger.error(`Erreur cache INCR ${key}:`, error);
      throw error;
    }
  }
}

// Fonctions spécifiques pour les sessions de conversation
class SessionService {
  constructor() {
    this.sessionPrefix = 'session:';
    this.sessionTTL = 3600; // 1 heure
  }

  // Créer ou mettre à jour une session
  async setSession(userId, sessionData) {
    const cache = new CacheService();
    const key = `${this.sessionPrefix}${userId}`;
    await cache.set(key, sessionData, this.sessionTTL);
  }

  // Obtenir une session
  async getSession(userId) {
    const cache = new CacheService();
    const key = `${this.sessionPrefix}${userId}`;
    return await cache.get(key);
  }

  // Supprimer une session
  async deleteSession(userId) {
    const cache = new CacheService();
    const key = `${this.sessionPrefix}${userId}`;
    return await cache.del(key);
  }

  // Étendre la durée de vie d'une session
  async extendSession(userId, ttl = this.sessionTTL) {
    const cache = new CacheService();
    const key = `${this.sessionPrefix}${userId}`;
    return await cache.expire(key, ttl);
  }
}

// Vérifier la santé de Redis
async function checkRedisHealth() {
  try {
    const client = getRedisClient();
    const start = Date.now();
    await client.ping();
    const duration = Date.now() - start;
    
    return {
      status: 'healthy',
      responseTime: `${duration}ms`,
      timestamp: new Date().toISOString()
    };
  } catch (error) {
    logger.error('Vérification de santé Redis échouée:', error);
    return {
      status: 'unhealthy',
      error: error.message,
      timestamp: new Date().toISOString()
    };
  }
}

module.exports = {
  connectRedis,
  disconnectRedis,
  getRedisClient,
  CacheService,
  SessionService,
  checkRedisHealth
};