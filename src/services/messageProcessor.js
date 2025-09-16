const { getPrismaClient } = require('../config/database');
const { CacheService, SessionService } = require('../config/redis');
const WhatsAppService = require('./whatsappService');
const NLPService = require('./nlpService');
const TicketService = require('./ticketService');
const KnowledgeBaseService = require('./knowledgeBaseService');
const logger = require('../utils/logger');
const { v4: uuidv4 } = require('uuid');

class MessageProcessor {
  constructor() {
    this.whatsappService = new WhatsAppService();
    this.nlpService = new NLPService();
    this.ticketService = new TicketService();
    this.knowledgeBaseService = new KnowledgeBaseService();
    this.cacheService = new CacheService();
    this.sessionService = new SessionService();
    this.prisma = null;
    
    // Configuration
    this.maxConversationDuration = parseInt(process.env.MAX_CONVERSATION_DURATION) || 3600; // 1 heure
    this.confidenceThreshold = parseFloat(process.env.NLP_CONFIDENCE_THRESHOLD) || 0.7;
    this.defaultLanguage = process.env.DEFAULT_LANGUAGE || 'fr';
    this.supportedLanguages = (process.env.SUPPORTED_LANGUAGES || 'fr,en').split(',');
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
    if (this.shouldTransferToHuman(text, user.language)) {
      return await this.initiateHumanHandoff(user, session, text);
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
      return await this.handleIntent(nlpResult, user, session, text);
    } else {
      // Rechercher dans la base de connaissances
      const kbResult = await this.knowledgeBaseService.search(text, user.language);
      
      if (kbResult && kbResult.confidence > 0.6) {
        return {
          type: 'text',
          content: kbResult.answer
        };
      }
      
      // Fallback: proposer des options ou transfert
      return await this.getFallbackResponse(user, session, text);
    }
  }

  // Traiter un message interactif (boutons/listes)
  async processInteractiveMessage(messageData, user, session) {
    const content = messageData.content;
    
    // Traiter selon le type d'interaction
    if (content.buttonId) {
      return await this.handleButtonClick(content.buttonId, content.buttonTitle, user, session);
    } else if (content.listId) {
      return await this.handleListSelection(content.listId, content.listTitle, user, session);
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
    switch (mediaType) {
      case 'image':
        return {
          type: 'text',
          content: this.getLocalizedMessage('media.image_received', user.language)
        };
      case 'audio':
        return {
          type: 'text',
          content: this.getLocalizedMessage('media.audio_received', user.language)
        };
      case 'video':
        return {
          type: 'text',
          content: this.getLocalizedMessage('media.video_received', user.language)
        };
      case 'document':
        return {
          type: 'text',
          content: this.getLocalizedMessage('media.document_received', user.language)
        };
      default:
        return await this.getDefaultResponse(user.language);
    }
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
      content: this.getLocalizedMessage('location.received', user.language, {
        name: location.name || 'Position',
        address: location.address || 'Adresse non disponible'
      })
    };
  }

  // Gérer les intents détectés
  async handleIntent(nlpResult, user, session, originalText) {
    const { intent, entities, confidence } = nlpResult;
    
    switch (intent) {
      case 'greeting':
        return await this.handleGreeting(user, session);
      
      case 'help':
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
      
      default:
        return await this.getFallbackResponse(user, session, originalText);
    }
  }

  // Gérer les salutations
  async handleGreeting(user, session) {
    const timeOfDay = this.getTimeOfDay();
    const greeting = this.getLocalizedMessage(`greeting.${timeOfDay}`, user.language, {
      name: user.name || 'cher client'
    });

    return {
      type: 'interactive',
      content: {
        text: greeting,
        buttons: [
          {
            id: 'help',
            title: this.getLocalizedMessage('buttons.help', user.language)
          },
          {
            id: 'faq',
            title: this.getLocalizedMessage('buttons.faq', user.language)
          },
          {
            id: 'contact_agent',
            title: this.getLocalizedMessage('buttons.contact_agent', user.language)
          }
        ]
      }
    };
  }

  // Gérer les demandes d'aide
  async handleHelp(user, session) {
    const helpSections = [
      {
        title: this.getLocalizedMessage('help.tickets.title', user.language),
        rows: [
          {
            id: 'create_ticket',
            title: this.getLocalizedMessage('help.tickets.create', user.language),
            description: this.getLocalizedMessage('help.tickets.create_desc', user.language)
          },
          {
            id: 'check_ticket',
            title: this.getLocalizedMessage('help.tickets.check', user.language),
            description: this.getLocalizedMessage('help.tickets.check_desc', user.language)
          }
        ]
      },
      {
        title: this.getLocalizedMessage('help.support.title', user.language),
        rows: [
          {
            id: 'faq',
            title: this.getLocalizedMessage('help.support.faq', user.language),
            description: this.getLocalizedMessage('help.support.faq_desc', user.language)
          },
          {
            id: 'contact_agent',
            title: this.getLocalizedMessage('help.support.agent', user.language),
            description: this.getLocalizedMessage('help.support.agent_desc', user.language)
          }
        ]
      }
    ];

    return {
      type: 'list',
      content: {
        text: this.getLocalizedMessage('help.main_text', user.language),
        buttonText: this.getLocalizedMessage('help.button_text', user.language),
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
            this.getLocalizedMessage('error.unknown_response_type', language)
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
  shouldTransferToHuman(text, language) {
    const keywords = process.env.AUTO_HANDOFF_KEYWORDS?.split(',') || ['agent', 'humain', 'personne', 'help', 'aide'];
    const lowerText = text.toLowerCase();
    return keywords.some(keyword => lowerText.includes(keyword.toLowerCase()));
  }

  getTimeOfDay() {
    const hour = new Date().getHours();
    if (hour < 12) return 'morning';
    if (hour < 18) return 'afternoon';
    return 'evening';
  }

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

  getLocalizedMessage(key, language, params = {}) {
    // Ici on devrait implémenter un système de localisation complet
    // Pour l'instant, on retourne des messages basiques
    const messages = {
      fr: {
        'greeting.morning': `Bonjour ${params.name || 'cher client'} ! Comment puis-je vous aider aujourd'hui ?`,
        'greeting.afternoon': `Bon après-midi ${params.name || 'cher client'} ! Comment puis-je vous aider ?`,
        'greeting.evening': `Bonsoir ${params.name || 'cher client'} ! Comment puis-je vous aider ce soir ?`,
        'buttons.help': 'Aide',
        'buttons.faq': 'FAQ',
        'buttons.contact_agent': 'Contacter un agent',
        'help.main_text': 'Voici comment je peux vous aider :',
        'help.button_text': 'Choisir une option',
        'faq.main_text': 'Voici les questions fréquemment posées. Que souhaitez-vous savoir ?',
        'faq.products': 'Nos produits',
        'faq.support': 'Support technique',
        'handoff.initiated': 'Je vous mets en relation avec un agent humain. Veuillez patienter...',
        'error.general': 'Désolé, une erreur s\'est produite. Veuillez réessayer.',
        'fallback.message': 'Je n\'ai pas bien compris votre demande. Pouvez-vous reformuler ou choisir une option ci-dessous ?'
      },
      en: {
        'greeting.morning': `Good morning ${params.name || 'dear customer'}! How can I help you today?`,
        'greeting.afternoon': `Good afternoon ${params.name || 'dear customer'}! How can I help you?`,
        'greeting.evening': `Good evening ${params.name || 'dear customer'}! How can I help you tonight?`,
        'buttons.help': 'Help',
        'buttons.faq': 'FAQ',
        'buttons.contact_agent': 'Contact agent',
        'help.main_text': 'Here\'s how I can help you:',
        'help.button_text': 'Choose an option',
        'faq.main_text': 'Here are frequently asked questions. What would you like to know?',
        'faq.products': 'Our products',
        'faq.support': 'Technical support',
        'handoff.initiated': 'I\'m connecting you with a human agent. Please wait...',
        'error.general': 'Sorry, an error occurred. Please try again.',
        'fallback.message': 'I didn\'t understand your request. Could you rephrase or choose an option below?'
      }
    };

    return messages[language]?.[key] || messages[this.defaultLanguage]?.[key] || key;
  }

  getErrorMessage(language) {
    return this.getLocalizedMessage('error.general', language);
  }

  async getDefaultResponse(language) {
    return {
      type: 'text',
      content: this.getLocalizedMessage('fallback.message', language)
    };
  }

  async getFallbackResponse(user, session, text) {
    return {
      type: 'interactive',
      content: {
        text: this.getLocalizedMessage('fallback.message', user.language),
        buttons: [
          {
            id: 'help',
            title: this.getLocalizedMessage('buttons.help', user.language)
          },
          {
            id: 'faq',
            title: this.getLocalizedMessage('buttons.faq', user.language)
          },
          {
            id: 'contact_agent',
            title: this.getLocalizedMessage('buttons.contact_agent', user.language)
          }
        ]
      }
    };
  }

  // Placeholder pour les autres méthodes
  async handleButtonClick(buttonId, buttonTitle, user, session) {
    logger.logWhatsApp('Button Click Received', {
      buttonId,
      buttonTitle,
      userId: user.id
    });

    // Traiter selon l'ID du bouton
    switch (buttonId) {
      case 'help':
      case 'aide':
        return await this.handleHelp(user, session);
      
      case 'faq':
        return await this.handleFAQ(user, session, [], buttonTitle);
      
      case 'contact_agent':
      case 'contacter_agent':
        return await this.initiateHumanHandoff(user, session, buttonTitle);
      
      case 'greeting':
      case 'salutation':
        return await this.handleGreeting(user, session);
      
      default:
        // Traiter le titre du bouton comme un message texte
        const textMessageData = {
          ...session,
          messageType: 'text',
          content: { text: buttonTitle }
        };
        return await this.processTextMessage(textMessageData, user, session);
    }
  }

  async handleListSelection(listId, listTitle, user, session) {
    // À implémenter
    return await this.getDefaultResponse(user.language);
  }

  async handleCreateTicket(user, session, entities, originalText) {
    // À implémenter avec TicketService
    return await this.getDefaultResponse(user.language);
  }

  async handleCheckTicketStatus(user, session, entities) {
    // À implémenter avec TicketService
    return await this.getDefaultResponse(user.language);
  }

  async handleFAQ(user, session, entities, originalText) {
    logger.logWhatsApp('FAQ Request', {
      userId: user.id,
      originalText: originalText?.substring(0, 100)
    });

    // Rechercher dans la base de connaissances
    if (originalText) {
      const kbResult = await this.knowledgeBaseService.search(originalText, user.language);
      
      if (kbResult && kbResult.confidence > 0.5) {
        return {
          type: 'text',
          content: kbResult.answer
        };
      }
    }

    // Réponse FAQ générale avec options
    return {
      type: 'interactive',
      content: {
        text: this.getLocalizedMessage('faq.main_text', user.language),
        buttons: [
          {
            id: 'faq_products',
            title: this.getLocalizedMessage('faq.products', user.language)
          },
          {
            id: 'faq_support',
            title: this.getLocalizedMessage('faq.support', user.language)
          },
          {
            id: 'contact_agent',
            title: this.getLocalizedMessage('buttons.contact_agent', user.language)
          }
        ]
      }
    };
  }

  async initiateHumanHandoff(user, session, originalText) {
    // À implémenter
    return {
      type: 'text',
      content: this.getLocalizedMessage('handoff.initiated', user.language)
    };
  }

  async handleGoodbye(user, session) {
    return {
      type: 'text',
      content: this.getLocalizedMessage('goodbye.message', user.language)
    };
  }
}

module.exports = MessageProcessor;