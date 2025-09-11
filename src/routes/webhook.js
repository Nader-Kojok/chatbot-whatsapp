const express = require('express');
const crypto = require('crypto');
const { asyncHandler } = require('../middleware/errorMiddleware');
const WhatsAppService = require('../services/whatsappService');
const MessageProcessor = require('../services/messageProcessor');
const logger = require('../utils/logger');

const router = express.Router();
const whatsappService = new WhatsAppService();
const messageProcessor = new MessageProcessor();

// Middleware pour vérifier la signature du webhook (sauf pour la vérification)
const verifyWebhookSignature = (req, res, next) => {
  // Skip verification for GET requests (webhook verification)
  if (req.method === 'GET') {
    return next();
  }

  const signature = req.get('X-Hub-Signature-256');
  
  if (!signature) {
    logger.logSecurity('Missing webhook signature', {
      ip: req.ip,
      userAgent: req.get('User-Agent')
    });
    return res.status(401).json({ error: 'Signature manquante' });
  }

  const payload = JSON.stringify(req.body);
  const isValid = whatsappService.verifyWebhookSignature(payload, signature);
  
  if (!isValid) {
    logger.logSecurity('Invalid webhook signature', {
      signature,
      ip: req.ip,
      userAgent: req.get('User-Agent')
    });
    return res.status(401).json({ error: 'Signature invalide' });
  }

  next();
};

// GET /webhook - Vérification du webhook par Facebook
router.get('/', asyncHandler(async (req, res) => {
  const mode = req.query['hub.mode'];
  const token = req.query['hub.verify_token'];
  const challenge = req.query['hub.challenge'];

  logger.logWhatsApp('Webhook Verification Request', {
    mode,
    token: token ? '***' : 'missing',
    challenge: challenge ? '***' : 'missing',
    ip: req.ip
  });

  // Vérifier que c'est une requête de vérification
  if (mode !== 'subscribe') {
    logger.logSecurity('Invalid webhook verification mode', {
      mode,
      ip: req.ip
    });
    return res.status(400).json({ error: 'Mode invalide' });
  }

  // Vérifier le token
  if (!whatsappService.verifyWebhookToken(token)) {
    logger.logSecurity('Invalid webhook verification token', {
      token: token ? '***' : 'missing',
      ip: req.ip
    });
    return res.status(403).json({ error: 'Token invalide' });
  }

  logger.logWhatsApp('Webhook Verified Successfully', {
    ip: req.ip
  });

  // Retourner le challenge pour confirmer la vérification
  res.status(200).send(challenge);
}));

// POST /webhook - Réception des événements WhatsApp
router.post('/', verifyWebhookSignature, asyncHandler(async (req, res) => {
  const webhookData = req.body;

  logger.logWhatsApp('Webhook Event Received', {
    object: webhookData.object,
    entryCount: webhookData.entry?.length || 0,
    ip: req.ip
  });

  // Vérifier que c'est un événement WhatsApp
  if (webhookData.object !== 'whatsapp_business_account') {
    logger.logSecurity('Invalid webhook object type', {
      object: webhookData.object,
      ip: req.ip
    });
    return res.status(400).json({ error: 'Type d\'objet invalide' });
  }

  // Traiter chaque entrée du webhook
  const processingPromises = [];
  
  for (const entry of webhookData.entry || []) {
    for (const change of entry.changes || []) {
      if (change.field === 'messages') {
        // Traiter les messages de manière asynchrone
        const promise = processWebhookChange(change.value)
          .catch(error => {
            logger.error('Erreur traitement webhook change:', error);
          });
        
        processingPromises.push(promise);
      }
    }
  }

  // Répondre immédiatement à Facebook (requis)
  res.status(200).json({ status: 'received' });

  // Attendre que tous les traitements se terminent (en arrière-plan)
  try {
    await Promise.allSettled(processingPromises);
    logger.debug('Tous les événements webhook traités');
  } catch (error) {
    logger.error('Erreur lors du traitement des événements webhook:', error);
  }
}));

// Fonction pour traiter un changement de webhook
async function processWebhookChange(value) {
  try {
    // Messages entrants
    if (value.messages) {
      for (const message of value.messages) {
        const contact = value.contacts?.find(c => c.wa_id === message.from);
        
        const parsedMessage = {
          type: 'message',
          messageId: message.id,
          from: message.from,
          timestamp: parseInt(message.timestamp),
          messageType: message.type,
          content: whatsappService.extractMessageContent(message),
          contact: {
            name: contact?.profile?.name || null,
            phoneNumber: contact?.wa_id || message.from
          }
        };

        logger.logWhatsApp('Processing Incoming Message', {
          messageId: message.id,
          from: message.from,
          type: message.type
        });

        // Marquer le message comme lu
        await whatsappService.markMessageAsRead(message.id);

        // Traiter le message avec le processeur de messages
        await messageProcessor.processIncomingMessage(parsedMessage);
      }
    }

    // Statuts de messages
    if (value.statuses) {
      for (const status of value.statuses) {
        logger.logWhatsApp('Message Status Update', {
          messageId: status.id,
          recipientId: status.recipient_id,
          status: status.status,
          timestamp: status.timestamp
        });

        // Traiter le statut du message
        await messageProcessor.processMessageStatus({
          type: 'status',
          messageId: status.id,
          recipientId: status.recipient_id,
          status: status.status,
          timestamp: parseInt(status.timestamp),
          errors: status.errors || null
        });
      }
    }

    // Erreurs
    if (value.errors) {
      for (const error of value.errors) {
        logger.error('WhatsApp Webhook Error', {
          code: error.code,
          title: error.title,
          message: error.message,
          errorData: error.error_data
        });
      }
    }
  } catch (error) {
    logger.error('Erreur lors du traitement du changement webhook:', error);
    throw error;
  }
}

// GET /webhook/health - Vérification de santé du webhook
router.get('/health', asyncHandler(async (req, res) => {
  const whatsappHealth = await whatsappService.checkAPIHealth();
  
  res.json({
    webhook: {
      status: 'healthy',
      timestamp: new Date().toISOString()
    },
    whatsappAPI: whatsappHealth
  });
}));

// GET /webhook/info - Informations sur la configuration du webhook
router.get('/info', asyncHandler(async (req, res) => {
  res.json({
    phoneNumberId: process.env.WHATSAPP_PHONE_NUMBER_ID,
    businessAccountId: process.env.WHATSAPP_BUSINESS_ACCOUNT_ID,
    apiVersion: process.env.WHATSAPP_API_VERSION || 'v18.0',
    webhookUrl: `${process.env.API_BASE_URL}/webhook`,
    verifyToken: process.env.WHATSAPP_WEBHOOK_VERIFY_TOKEN ? '***' : 'not_set',
    timestamp: new Date().toISOString()
  });
}));

// POST /webhook/test - Endpoint de test pour simuler des messages
router.post('/test', asyncHandler(async (req, res) => {
  if (process.env.NODE_ENV === 'production') {
    return res.status(404).json({ error: 'Endpoint non disponible en production' });
  }

  const { phoneNumber, message, type = 'text' } = req.body;

  if (!phoneNumber || !message) {
    return res.status(400).json({ 
      error: 'phoneNumber et message sont requis' 
    });
  }

  // Simuler un message entrant
  const testMessage = {
    type: 'message',
    messageId: `test_${Date.now()}`,
    from: phoneNumber,
    timestamp: Date.now(),
    messageType: type,
    content: { text: message },
    contact: {
      name: 'Test User',
      phoneNumber: phoneNumber
    }
  };

  logger.logWhatsApp('Processing Test Message', testMessage);

  try {
    await messageProcessor.processIncomingMessage(testMessage);
    
    res.json({
      success: true,
      message: 'Message de test traité avec succès',
      testMessage
    });
  } catch (error) {
    logger.error('Erreur traitement message de test:', error);
    res.status(500).json({
      success: false,
      error: 'Erreur lors du traitement du message de test',
      details: error.message
    });
  }
}));

module.exports = router;