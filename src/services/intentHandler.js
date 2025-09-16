const logger = require('../utils/logger');

class IntentHandler {
  constructor(localizationService, messageFormatter, ticketMessageHandler, knowledgeBaseService, nlpService) {
    this.localizationService = localizationService;
    this.messageFormatter = messageFormatter;
    this.ticketMessageHandler = ticketMessageHandler;
    this.knowledgeBaseService = knowledgeBaseService;
    this.nlpService = nlpService;
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
        // Try to generate AI response for help requests
        try {
          const aiResponse = await this.generateAIResponse(originalText, user.language);
          if (aiResponse && aiResponse.length > 10) {
            return {
              type: 'text',
              content: aiResponse
            };
          }
        } catch (error) {
          logger.error('Error generating AI response for help:', error);
        }
        return await this.handleHelp(user, session);
      
      case 'create_ticket':
        return await this.ticketMessageHandler.handleCreateTicket(user, session, entities, originalText);
      
      case 'check_ticket_status':
        return await this.ticketMessageHandler.handleCheckTicketStatus(user, session, entities);
      
      case 'faq':
        return await this.handleFAQ(user, session, entities, originalText);
      
      case 'contact_agent':
        return await this.initiateHumanHandoff(user, session, originalText);
      
      case 'goodbye':
        return await this.handleGoodbye(user, session);
      
      case 'technical_support':
        // Try to generate AI response for technical support
        try {
          const aiResponse = await this.generateAIResponse(originalText, user.language);
          if (aiResponse && aiResponse.length > 10) {
            return {
              type: 'text',
              content: aiResponse
            };
          }
        } catch (error) {
          logger.error('Error generating AI response for technical support:', error);
        }
        return await this.getFallbackResponse(user, session, originalText);
      
      // Handle questions about the bot's capabilities
      case 'product_inquiry':
        if (originalText.toLowerCase().includes('que peux-tu faire') || originalText.toLowerCase().includes('tes capacités') ||
            originalText.toLowerCase().includes('what can you do') || originalText.toLowerCase().includes('capabilities')) {
          return {
            type: 'text',
            content: this.localizationService.getLocalizedMessage('bot.capabilities', user.language)
          };
        }
        // Try to generate AI response for product inquiries
        try {
          const aiResponse = await this.generateAIResponse(originalText, user.language);
          if (aiResponse && aiResponse.length > 10) {
            return {
              type: 'text',
              content: aiResponse
            };
          }
        } catch (error) {
          logger.error('Error generating AI response for product inquiry:', error);
        }
        return await this.getFallbackResponse(user, session, originalText);
      
      default:
        // Try to generate AI response for unrecognized intents
        try {
          const aiResponse = await this.generateAIResponse(originalText, user.language);
          if (aiResponse && aiResponse.length > 10) {
            return {
              type: 'text',
              content: aiResponse
            };
          }
        } catch (error) {
          logger.error('Error generating AI response for default case:', error);
        }
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

  // Gérer les FAQ
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
        text: this.localizationService.getLocalizedMessage('faq.main_text', user.language),
        buttons: [
          {
            id: 'faq_products',
            title: this.localizationService.getLocalizedMessage('faq.products', user.language)
          },
          {
            id: 'faq_support',
            title: this.localizationService.getLocalizedMessage('faq.support', user.language)
          },
          {
            id: 'contact_agent',
            title: this.localizationService.getLocalizedMessage('buttons.contact_agent', user.language)
          }
        ]
      }
    };
  }

  // Initier un transfert vers un agent humain
  async initiateHumanHandoff(user, session, originalText) {
    // Marquer la session pour transfert
    session.context.pendingHandoff = true;
    session.context.handoffReason = originalText;
    session.context.handoffTimestamp = Date.now();
    
    logger.logWhatsApp('Human Handoff Initiated', {
      userId: user.id,
      reason: originalText?.substring(0, 100)
    });
    
    return {
      type: 'text',
      content: this.localizationService.getLocalizedMessage('handoff.initiated', user.language)
    };
  }

  // Gérer les au revoir
  async handleGoodbye(user, session) {
    // Marquer la session comme terminée
    session.status = 'ENDED';
    session.context.endedAt = Date.now();
    
    return {
      type: 'text',
      content: this.localizationService.getLocalizedMessage('goodbye.message', user.language)
    };
  }

  // Gérer les clics de boutons
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
      
      case 'create_ticket':
        // Demander à l'utilisateur de décrire son problème
        return {
          type: 'text',
          content: this.localizationService.getLocalizedMessage('ticket.need_more_info', user.language)
        };
      
      case 'check_ticket':
        return await this.ticketMessageHandler.handleCheckTicketStatus(user, session, {});
      
      default:
        // Traiter le titre du bouton comme un message texte
        return await this.handleTextInput(buttonTitle, user, session);
    }
  }

  // Gérer les sélections de liste
  async handleListSelection(listId, listTitle, user, session) {
    logger.logWhatsApp('List Selection Received', {
      listId,
      listTitle,
      userId: user.id
    });

    // Traiter la sélection comme un clic de bouton
    return await this.handleButtonClick(listId, listTitle, user, session);
  }

  // Gérer une entrée de texte générique
  async handleTextInput(text, user, session) {
    // Vérifier d'abord si c'est une demande de ticket
    const ticketIntent = this.ticketMessageHandler.analyzeTicketIntent(text, user.language);
    if (ticketIntent && ticketIntent.confidence > 0.7) {
      if (ticketIntent.intent === 'create_ticket') {
        return await this.ticketMessageHandler.handleCreateTicket(user, session, ticketIntent.entities, text);
      } else if (ticketIntent.intent === 'check_ticket_status') {
        return await this.ticketMessageHandler.handleCheckTicketStatus(user, session, ticketIntent.entities);
      }
    }

    // Essayer de générer une réponse IA
    try {
      const aiResponse = await this.generateAIResponse(text, user.language);
      if (aiResponse && aiResponse.length > 10) {
        return {
          type: 'text',
          content: aiResponse
        };
      }
    } catch (error) {
      logger.error('Error generating AI response:', error);
    }

    // Fallback vers le menu d'options
    return await this.getFallbackResponse(user, session, text);
  }

  // Obtenir une réponse de fallback
  async getFallbackResponse(user, session, text) {
    const fallbackText = this.localizationService.getFallbackConversationalMessage(user.language);
    
    return {
      type: 'interactive',
      content: {
        text: fallbackText,
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

  // Générer une réponse IA
  async generateAIResponse(text, language) {
    try {
      const prompt = language === 'fr' 
        ? `Tu es un assistant client professionnel et bienveillant. Réponds à cette question de manière utile et concise en français. Si tu ne peux pas répondre précisément, propose des alternatives ou suggère de contacter un agent humain. Question: "${text}"`
        : `You are a professional and helpful customer assistant. Answer this question in a useful and concise way in English. If you cannot answer precisely, suggest alternatives or recommend contacting a human agent. Question: "${text}"`;

      const response = await this.nlpService.openai.chat.completions.create({
        model: this.nlpService.model,
        messages: [
          {
            role: 'user',
            content: prompt
          }
        ],
        max_tokens: 200,
        temperature: 0.7
      });

      const aiResponse = response.choices[0].message.content.trim();
      
      // Filter out responses that are too generic or unhelpful
      // Only filter if the response is very short or contains multiple unhelpful phrases
      const veryUnhelpfulPhrases = [
        'je ne peux pas vous aider', 'i cannot help you', 
        'je ne sais pas du tout', 'i have no idea',
        'je ne comprends pas votre question', 'i don\'t understand your question'
      ];
      
      const isVeryUnhelpful = veryUnhelpfulPhrases.some(phrase => 
        aiResponse.toLowerCase().includes(phrase.toLowerCase())
      );
      
      // Only filter if response is very short (less than 15 chars) or very unhelpful
      if (isVeryUnhelpful || aiResponse.length < 15) {
        return null; // Let it fall back to menu
      }
      
      return aiResponse;
    } catch (error) {
      logger.error('Error generating AI response:', error);
      return null;
    }
  }

  // Obtenir l'heure de la journée
  getTimeOfDay() {
    const hour = new Date().getHours();
    if (hour < 12) return 'morning';
    if (hour < 18) return 'afternoon';
    return 'evening';
  }

  // Vérifier si un transfert vers un humain est nécessaire
  shouldTransferToHuman(text, language) {
    const keywords = process.env.AUTO_HANDOFF_KEYWORDS?.split(',') || ['agent', 'humain', 'personne', 'help', 'aide'];
    const lowerText = text.toLowerCase();
    return keywords.some(keyword => lowerText.includes(keyword.toLowerCase()));
  }
}

module.exports = IntentHandler;