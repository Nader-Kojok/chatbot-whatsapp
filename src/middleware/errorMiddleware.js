const logger = require('../utils/logger');

// Middleware pour gérer les routes non trouvées
const notFound = (req, res, next) => {
  const error = new Error(`Route non trouvée - ${req.originalUrl}`);
  error.statusCode = 404;
  
  logger.logSecurity('Route Not Found', {
    method: req.method,
    url: req.originalUrl,
    ip: req.ip,
    userAgent: req.get('User-Agent')
  });
  
  next(error);
};

// Middleware de gestion globale des erreurs
const errorHandler = (err, req, res, next) => {
  let error = { ...err };
  error.message = err.message;
  error.statusCode = err.statusCode || 500;

  // Log de l'erreur avec contexte
  const errorContext = {
    method: req.method,
    url: req.originalUrl,
    ip: req.ip,
    userAgent: req.get('User-Agent'),
    body: req.body,
    params: req.params,
    query: req.query
  };

  logger.logError(error, errorContext);

  // Gestion spécifique des types d'erreurs
  
  // Erreur de validation Joi
  if (err.isJoi) {
    const message = err.details.map(detail => detail.message).join(', ');
    error = {
      message: `Erreur de validation: ${message}`,
      statusCode: 400,
      type: 'ValidationError'
    };
  }

  // Erreur Prisma - Contrainte unique
  if (err.code === 'P2002') {
    const field = err.meta?.target?.[0] || 'champ';
    error = {
      message: `Cette valeur existe déjà pour le ${field}`,
      statusCode: 409,
      type: 'ConflictError'
    };
  }

  // Erreur Prisma - Enregistrement non trouvé
  if (err.code === 'P2025') {
    error = {
      message: 'Ressource non trouvée',
      statusCode: 404,
      type: 'NotFoundError'
    };
  }

  // Erreur Prisma - Connexion à la base de données
  if (err.code === 'P1001') {
    error = {
      message: 'Erreur de connexion à la base de données',
      statusCode: 503,
      type: 'DatabaseError'
    };
  }

  // Erreur JWT
  if (err.name === 'JsonWebTokenError') {
    error = {
      message: 'Token invalide',
      statusCode: 401,
      type: 'AuthenticationError'
    };
  }

  // Erreur JWT expiré
  if (err.name === 'TokenExpiredError') {
    error = {
      message: 'Token expiré',
      statusCode: 401,
      type: 'AuthenticationError'
    };
  }

  // Erreur de syntaxe JSON
  if (err instanceof SyntaxError && err.status === 400 && 'body' in err) {
    error = {
      message: 'Format JSON invalide',
      statusCode: 400,
      type: 'SyntaxError'
    };
  }

  // Erreur de limite de taille
  if (err.type === 'entity.too.large') {
    error = {
      message: 'Fichier trop volumineux',
      statusCode: 413,
      type: 'PayloadTooLargeError'
    };
  }

  // Erreur de rate limiting
  if (err.statusCode === 429) {
    error = {
      message: 'Trop de requêtes, veuillez réessayer plus tard',
      statusCode: 429,
      type: 'RateLimitError',
      retryAfter: err.retryAfter
    };
  }

  // Erreur WhatsApp API
  if (err.isWhatsAppError) {
    error = {
      message: `Erreur WhatsApp: ${err.message}`,
      statusCode: err.statusCode || 500,
      type: 'WhatsAppError',
      whatsappCode: err.whatsappCode
    };
  }

  // Erreur OpenAI API
  if (err.isOpenAIError) {
    error = {
      message: 'Erreur du service d\'intelligence artificielle',
      statusCode: 503,
      type: 'AIServiceError'
    };
  }

  // Construire la réponse d'erreur
  const response = {
    success: false,
    error: {
      message: error.message,
      type: error.type || 'InternalServerError',
      statusCode: error.statusCode
    },
    timestamp: new Date().toISOString(),
    path: req.originalUrl,
    method: req.method
  };

  // Ajouter des détails supplémentaires en développement
  if (process.env.NODE_ENV === 'development') {
    response.error.stack = err.stack;
    response.error.details = error.details || err.details;
  }

  // Ajouter retryAfter pour les erreurs de rate limiting
  if (error.retryAfter) {
    response.error.retryAfter = error.retryAfter;
    res.set('Retry-After', error.retryAfter);
  }

  // Ajouter des headers de sécurité
  res.set({
    'X-Content-Type-Options': 'nosniff',
    'X-Frame-Options': 'DENY',
    'X-XSS-Protection': '1; mode=block'
  });

  res.status(error.statusCode).json(response);
};

// Middleware pour capturer les erreurs asynchrones
const asyncHandler = (fn) => {
  return (req, res, next) => {
    Promise.resolve(fn(req, res, next)).catch(next);
  };
};

// Classe d'erreur personnalisée
class AppError extends Error {
  constructor(message, statusCode, type = 'AppError') {
    super(message);
    this.statusCode = statusCode;
    this.type = type;
    this.isOperational = true;

    Error.captureStackTrace(this, this.constructor);
  }
}

// Classes d'erreurs spécifiques
class ValidationError extends AppError {
  constructor(message, details = null) {
    super(message, 400, 'ValidationError');
    this.details = details;
  }
}

class AuthenticationError extends AppError {
  constructor(message = 'Non authentifié') {
    super(message, 401, 'AuthenticationError');
  }
}

class AuthorizationError extends AppError {
  constructor(message = 'Non autorisé') {
    super(message, 403, 'AuthorizationError');
  }
}

class NotFoundError extends AppError {
  constructor(message = 'Ressource non trouvée') {
    super(message, 404, 'NotFoundError');
  }
}

class ConflictError extends AppError {
  constructor(message = 'Conflit de ressource') {
    super(message, 409, 'ConflictError');
  }
}

class WhatsAppError extends AppError {
  constructor(message, statusCode = 500, whatsappCode = null) {
    super(message, statusCode, 'WhatsAppError');
    this.isWhatsAppError = true;
    this.whatsappCode = whatsappCode;
  }
}

class OpenAIError extends AppError {
  constructor(message = 'Erreur du service IA', statusCode = 503) {
    super(message, statusCode, 'AIServiceError');
    this.isOpenAIError = true;
  }
}

// Fonction utilitaire pour créer des erreurs de validation
const createValidationError = (field, value, constraint) => {
  return new ValidationError(
    `Le champ '${field}' avec la valeur '${value}' ne respecte pas la contrainte: ${constraint}`
  );
};

// Fonction utilitaire pour gérer les erreurs Prisma
const handlePrismaError = (error) => {
  switch (error.code) {
    case 'P2002':
      const field = error.meta?.target?.[0] || 'champ';
      return new ConflictError(`Cette valeur existe déjà pour le ${field}`);
    
    case 'P2025':
      return new NotFoundError('Ressource non trouvée');
    
    case 'P1001':
      return new AppError('Erreur de connexion à la base de données', 503, 'DatabaseError');
    
    default:
      return new AppError('Erreur de base de données', 500, 'DatabaseError');
  }
};

module.exports = {
  notFound,
  errorHandler,
  asyncHandler,
  AppError,
  ValidationError,
  AuthenticationError,
  AuthorizationError,
  NotFoundError,
  ConflictError,
  WhatsAppError,
  OpenAIError,
  createValidationError,
  handlePrismaError
};