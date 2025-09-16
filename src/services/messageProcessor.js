const { getPrismaClient } = require('../config/database');
const { CacheService, SessionService } = require('../config/redis');
const WhatsAppService = require('./whatsappService');
const NLPService = require('./nlpService');
const TicketService = require('./ticketService');
const KnowledgeBaseService = require('./knowledgeBaseService');
const MessageLocalizationService = require('./messageLocalizationService');
const MessageFormatter = require('./messageFormatter');
const TicketMessageHandler = require('./ticketMessageHandler');
const IntentHandler = require('./intentHandler');
const logger = require('../utils/logger');
const { v4: uuidv4 } = require('uuid');

class MessageProcessor {
  constructor() {
    // Core services
    this.whatsappService = new WhatsAppService();
    this.nlpService = new NLPService();
    this.ticketService = new TicketService();
    this.knowledgeBaseService = new KnowledgeBaseService();
    this.cacheService = new CacheService();
    this.sessionService = new SessionService();
    this.prisma = null;
    
    // New specialized services
    this.localizationService = new MessageLocalizationService();
    this.messageFormatter = new MessageFormatter();
    this.ticketMessageHandler = new TicketMessageHandler(
      this.ticketService,
      this.localizationService,
      this.messageFormatter
    );
    this.intentHandler = new IntentHandler(
      this.localizationService,
      this.messageFormatter,
      this.ticketMessageHandler,
      this.knowledgeBaseService,
      this.nlpService
    );
    
    // Configuration
    this.maxConversationDuration = parseInt(process.env.MAX_CONVERSATION_DURATION) || 3600; // 1 heure
    this.confidenceThreshold = parseFloat(process.env.NLP_CONFIDENCE_THRESHOLD) || 0.5; // Industry standard: 50%
    this.knowledgeBaseThreshold = parseFloat(process.env.KB_CONFIDENCE_THRESHOLD) || 0.4; // Lower threshold for KB
    this.defaultLanguage = this.localizationService.getDefaultLanguage();
    this.supportedLanguages = this.localizationService.getSupportedLanguages();
  }

  // Initialiser le processeur
  async initialize() {
    if (!this.prisma) {
      this.prisma = getPrismaClient();
    }
  }

  // Traiter un message entrant
  async processIncomingMessage(messageData) {
    try {
      await this.initialize();
      
      const startTime = Date.now();
      logger.logWhatsApp('Processing Message', {
        messageId: messageData.messageId,
        from: messageData.from,
        type: messageData.messageType
      });

      // 1. Obtenir ou créer l'utilisateur
      const user = await this.getOrCreateUser(messageData.contact);
      
      // 2. Obtenir ou créer la conversation
      const conversation = await this.getOrCreateConversation(user.id);
      
      // 3. Sauvegarder le message
      const savedMessage = await this.saveMessage(messageData, conversation.id);
      
      // 4. Obtenir le contexte de session
      const session = await this.sessionService.getSession(user.id) || {
        conversationId: conversation.id,
        language: user.language,
        context: {},
        lastActivity: Date.now()
      };

      // 5. Traiter selon le type de message
      let response;
      switch (messageData.messageType) {
        case 'text':
          response = await this.processTextMessage(messageData, user, session);
          break;
        case 'interactive':
          response = await this.processInteractiveMessage(messageData, user, session);
          break;
        case 'image':
        case 'audio':
        case 'video':
        case 'document':
          response = await this.processMediaMessage(messageData, user, session);
          break;
        case 'location':
          response = await this.processLocationMessage(messageData, user, session);
          break;
        default:
          response = await this.getDefaultResponse(user.language);
      }

      // 6. Envoyer la réponse
      if (response) {
        await this.sendResponse(user.phoneNumber, response, user.language);
      }

      // 7. Mettre à jour la session
      session.lastActivity = Date.now();
      await this.sessionService.setSession(user.id, session);

      // 8. Logger les performances
      const processingTime = Date.now() - startTime;
      logger.logPerformance('Message Processing', processingTime, {
        messageId: messageData.messageId,
        userId: user.id,
        messageType: messageData.messageType
      });

    } catch (error) {
      logger.error('Erreur traitement message:', error);
      
      // Envoyer un message d'erreur générique
      try {
        const errorMessage = this.getErrorMessage(this.defaultLanguage);
        await this.whatsappService.sendTextMessage(messageData.from, errorMessage);
      } catch (sendError) {
        logger.error('Erreur envoi message d\'erreur:', sendError);
      }
    }
  }

  // Traiter un message texte
  async processTextMessage(messageData, user, session) {
    const text = messageData.content.text;
    
    // Détecter la langue si nécessaire
    const detectedLanguage = await this.nlpService.detectLanguage(text);
    if (detectedLanguage && this.supportedLanguages.includes(detectedLanguage) && detectedLanguage !== user.language) {
      await this.updateUserLanguage(user.id, detectedLanguage);
      user.language = detectedLanguage;
    }

    // Vérifier les mots-clés de transfert vers agent humain
    if (this.intentHandler.shouldTransferToHuman(text, user.language)) {
      return await this.intentHandler.initiateHumanHandoff(user, session, text);
    }

    // Analyser l'intent avec NLP
    const nlpResult = await this.nlpService.analyzeIntent(text, user.language);
    
    logger.logNLP('Intent Analysis', {
      text: text.substring(0, 100),
      intent: nlpResult.intent,
      confidence: nlpResult.confidence,
      entities: nlpResult.entities,
      language: user.language
    });

    // Traiter selon l'intent détecté
    if (nlpResult.confidence >= this.confidenceThreshold) {
      return await this.intentHandler.handleIntent(nlpResult, user, session, text);
    } else {
      // Rechercher dans la base de connaissances
      const kbResult = await this.knowledgeBaseService.search(text, user.language);
      
      if (kbResult && kbResult.confidence > this.knowledgeBaseThreshold) {
        return {
          type: 'text',
          content: kbResult.answer
        };
      }
      
      // Try to generate a helpful response using AI before falling back to menu
      try {
        const aiResponse = await this.intentHandler.generateAIResponse(text, user.language);
        if (aiResponse && aiResponse.length > 10) {
          return {
            type: 'text',
            content: aiResponse
          };
        }
      } catch (error) {
        logger.error('Error generating AI response:', error);
      }
      
      // Final fallback: proposer des options ou transfert
      return await this.intentHandler.getFallbackResponse(user, session, text);
    }
  }

  // Traiter un message interactif (boutons/listes)
  async processInteractiveMessage(messageData, user, session) {
    const content = messageData.content;
    
    // Traiter selon le type d'interaction
    if (content.buttonId) {
      return await this.intentHandler.handleButtonClick(content.buttonId, content.buttonTitle, user, session);
    } else if (content.listId) {
      return await this.intentHandler.handleListSelection(content.listId, content.listTitle, user, session);
    }
    
    return await this.getDefaultResponse(user.language);
  }

  // Traiter un message média
  async processMediaMessage(messageData, user, session) {
    const mediaType = messageData.messageType;
    const caption = messageData.content.caption;
    
    logger.logWhatsApp('Media Message Received', {
      mediaType,
      hasCaption: !!caption,
      userId: user.id
    });

    // Si il y a une légende, la traiter comme un message texte
    if (caption) {
      const textMessageData = {
        ...messageData,
        messageType: 'text',
        content: { text: caption }
      };
      return await this.processTextMessage(textMessageData, user, session);
    }

    // Réponse selon le type de média
    return {
      type: 'text',
      content: this.messageFormatter.formatMediaMessage(mediaType, user.language, this.localizationService)
    };
  }

  // Traiter un message de localisation
  async processLocationMessage(messageData, user, session) {
    const location = messageData.content;
    
    logger.logWhatsApp('Location Message Received', {
      latitude: location.latitude,
      longitude: location.longitude,
      userId: user.id
    });

    return {
      type: 'text',
      content: this.messageFormatter.formatLocationMessage(location, user.language, this.localizationService)
    };
  }

  // Gérer les intents détectés
  async handleIntent(nlpResult, user, session, originalText) {
    const { intent, entities, confidence } = nlpResult;
    
    switch (intent) {
      case 'greeting':
        return await this.handleGreeting(user, session);
      
      case 'help':
        // For simple help requests, provide direct information
        if (originalText.toLowerCase().includes('qui tu es') || originalText.toLowerCase().includes('qui es-tu') || 
            originalText.toLowerCase().includes('who are you') || originalText.toLowerCase().includes('what are you')) {
          return {
            type: 'text',
            content: this.localizationService.getLocalizedMessage('bot.introduction', user.language)
          };
        }
        return await this.handleHelp(user, session);
      
      case 'create_ticket':
        return await this.handleCreateTicket(user, session, entities, originalText);
      
      case 'check_ticket_status':
        return await this.handleCheckTicketStatus(user, session, entities);
      
      case 'faq':
        return await this.handleFAQ(user, session, entities, originalText);
      
      case 'contact_agent':
        return await this.initiateHumanHandoff(user, session, originalText);
      
      case 'goodbye':
        return await this.handleGoodbye(user, session);
      
      // Handle questions about the bot's capabilities
      case 'product_inquiry':
        if (originalText.toLowerCase().includes('que peux-tu faire') || originalText.toLowerCase().includes('tes capacités') ||
            originalText.toLowerCase().includes('what can you do') || originalText.toLowerCase().includes('capabilities')) {
          return {
            type: 'text',
            content: this.localizationService.getLocalizedMessage('bot.capabilities', user.language)
          };
        }
        return await this.getFallbackResponse(user, session, originalText);
      
      default:
        return await this.getFallbackResponse(user, session, originalText);
    }
  }

  // Gérer les salutations
  async handleGreeting(user, session) {
    const timeOfDay = this.getTimeOfDay();
    const greeting = this.localizationService.getLocalizedMessage(`greeting.${timeOfDay}`, user.language, {
      name: user.name || 'cher client'
    });

    return {
      type: 'interactive',
      content: {
        text: greeting,
        buttons: [
          {
            id: 'help',
            title: this.localizationService.getLocalizedMessage('buttons.help', user.language)
          },
          {
            id: 'faq',
            title: this.localizationService.getLocalizedMessage('buttons.faq', user.language)
          },
          {
            id: 'contact_agent',
            title: this.localizationService.getLocalizedMessage('buttons.contact_agent', user.language)
          }
        ]
      }
    };
  }

  // Gérer les demandes d'aide
  async handleHelp(user, session) {
    const helpSections = [
      {
        title: this.localizationService.getLocalizedMessage('help.tickets.title', user.language),
        rows: [
          {
            id: 'create_ticket',
            title: this.localizationService.getLocalizedMessage('help.tickets.create', user.language),
            description: this.localizationService.getLocalizedMessage('help.tickets.create_desc', user.language)
          },
          {
            id: 'check_ticket',
            title: this.localizationService.getLocalizedMessage('help.tickets.check', user.language),
            description: this.localizationService.getLocalizedMessage('help.tickets.check_desc', user.language)
          }
        ]
      },
      {
        title: this.localizationService.getLocalizedMessage('help.support.title', user.language),
        rows: [
          {
            id: 'faq',
            title: this.localizationService.getLocalizedMessage('help.support.faq', user.language),
            description: this.localizationService.getLocalizedMessage('help.support.faq_desc', user.language)
          },
          {
            id: 'contact_agent',
            title: this.localizationService.getLocalizedMessage('help.support.agent', user.language),
            description: this.localizationService.getLocalizedMessage('help.support.agent_desc', user.language)
          }
        ]
      }
    ];

    return {
      type: 'list',
      content: {
        text: this.localizationService.getLocalizedMessage('help.main_text', user.language),
        buttonText: this.localizationService.getLocalizedMessage('help.button_text', user.language),
        sections: helpSections
      }
    };
  }

  // Obtenir ou créer un utilisateur
  async getOrCreateUser(contact) {
    try {
      let user = await this.prisma.user.findUnique({
        where: { phoneNumber: contact.phoneNumber }
      });

      if (!user) {
        user = await this.prisma.user.create({
          data: {
            phoneNumber: contact.phoneNumber,
            name: contact.name,
            language: this.defaultLanguage,
            status: 'ACTIVE'
          }
        });
        
        logger.logWhatsApp('New User Created', {
          userId: user.id,
          phoneNumber: contact.phoneNumber,
          name: contact.name
        });
      } else if (contact.name && contact.name !== user.name) {
        // Mettre à jour le nom si différent
        user = await this.prisma.user.update({
          where: { id: user.id },
          data: { name: contact.name }
        });
      }

      return user;
    } catch (error) {
      logger.error('Erreur création/récupération utilisateur:', error);
      throw error;
    }
  }

  // Obtenir ou créer une conversation
  async getOrCreateConversation(userId) {
    try {
      // Chercher une conversation active
      let conversation = await this.prisma.conversation.findFirst({
        where: {
          userId,
          status: 'ACTIVE'
        },
        orderBy: { startedAt: 'desc' }
      });

      // Vérifier si la conversation n'est pas trop ancienne
      if (conversation) {
        const now = new Date();
        const conversationAge = now - conversation.startedAt;
        
        if (conversationAge > this.maxConversationDuration * 1000) {
          // Fermer l'ancienne conversation
          await this.prisma.conversation.update({
            where: { id: conversation.id },
            data: {
              status: 'ENDED',
              endedAt: now
            }
          });
          conversation = null;
        }
      }

      // Créer une nouvelle conversation si nécessaire
      if (!conversation) {
        conversation = await this.prisma.conversation.create({
          data: {
            userId,
            status: 'ACTIVE',
            context: {}
          }
        });
        
        logger.logWhatsApp('New Conversation Created', {
          conversationId: conversation.id,
          userId
        });
      }

      return conversation;
    } catch (error) {
      logger.error('Erreur création/récupération conversation:', error);
      throw error;
    }
  }

  // Sauvegarder un message
  async saveMessage(messageData, conversationId) {
    try {
      const message = await this.prisma.message.create({
        data: {
          conversationId,
          content: JSON.stringify(messageData.content),
          type: messageData.messageType.toUpperCase(),
          direction: 'INCOMING',
          metadata: {
            whatsappMessageId: messageData.messageId,
            timestamp: messageData.timestamp
          },
          processed: false
        }
      });

      // Marquer comme traité
      await this.prisma.message.update({
        where: { id: message.id },
        data: { processed: true }
      });

      return message;
    } catch (error) {
      logger.error('Erreur sauvegarde message:', error);
      throw error;
    }
  }

  // Envoyer une réponse
  async sendResponse(phoneNumber, response, language) {
    try {
      let result;
      
      switch (response.type) {
        case 'text':
          result = await this.whatsappService.sendTextMessage(phoneNumber, response.content);
          break;
        
        case 'interactive':
          result = await this.whatsappService.sendInteractiveMessage(
            phoneNumber,
            response.content.text,
            response.content.buttons,
            response.content.header,
            response.content.footer
          );
          break;
        
        case 'list':
          result = await this.whatsappService.sendListMessage(
            phoneNumber,
            response.content.text,
            response.content.buttonText,
            response.content.sections,
            response.content.header,
            response.content.footer
          );
          break;
        
        default:
          result = await this.whatsappService.sendTextMessage(
            phoneNumber,
            this.localizationService.getLocalizedMessage('error.unknown_response_type', language)
          );
      }

      return result;
    } catch (error) {
      logger.error('Erreur envoi réponse:', error);
      throw error;
    }
  }

  // Traiter les statuts de messages
  async processMessageStatus(statusData) {
    try {
      logger.logWhatsApp('Message Status Update', statusData);
      
      // Ici on pourrait mettre à jour le statut des messages dans la DB
      // et déclencher des notifications si nécessaire
      
    } catch (error) {
      logger.error('Erreur traitement statut message:', error);
    }
  }

  // Fonctions utilitaires
  async updateUserLanguage(userId, language) {
    try {
      await this.prisma.user.update({
        where: { id: userId },
        data: { language }
      });
    } catch (error) {
      logger.error('Erreur mise à jour langue utilisateur:', error);
    }
  }

  getErrorMessage(language) {
    return this.localizationService.getErrorMessage(language);
  }

  async getDefaultResponse(language) {
    return {
      type: 'text',
      content: this.localizationService.getFallbackMessage(language)
    };
  }

  // Obtenir le moment de la journée
  getTimeOfDay() {
    const hour = new Date().getHours();
    if (hour < 12) {
      return 'morning';
    } else if (hour < 18) {
      return 'afternoon';
    } else {
      return 'evening';
    }
  }

}

module.exports = MessageProcessor;