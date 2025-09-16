const logger = require('../utils/logger');

class TicketMessageHandler {
  constructor(ticketService, localizationService, messageFormatter) {
    this.ticketService = ticketService;
    this.localizationService = localizationService;
    this.messageFormatter = messageFormatter;
  }

  // Gérer la création d'un ticket
  async handleCreateTicket(user, session, entities, originalText) {
    try {
      // Extraire le titre et la description du message
      const ticketInfo = this.extractTicketInfo(originalText, user.language);
      
      if (!ticketInfo.title || !ticketInfo.description) {
        // Demander plus d'informations si nécessaire
        return {
          type: 'text',
          content: this.localizationService.getLocalizedMessage('ticket.need_more_info', user.language)
        };
      }

      // Créer le ticket
      const ticket = await this.ticketService.createTicket(
        user.id,
        ticketInfo.title,
        ticketInfo.description,
        ticketInfo.category,
        user.language
      );

      logger.logTicket('Ticket Created via WhatsApp', ticket.id, {
        userId: user.id,
        phoneNumber: user.phoneNumber
      });

      // Retourner la confirmation
      return {
        type: 'text',
        content: this.messageFormatter.formatTicketConfirmation(ticket, user.language, this.localizationService)
      };
      
    } catch (error) {
      logger.error('Erreur création ticket:', error);
      return {
        type: 'text',
        content: this.localizationService.getLocalizedMessage('ticket.creation_error', user.language)
      };
    }
  }

  // Gérer la vérification du statut des tickets
  async handleCheckTicketStatus(user, session, entities) {
    try {
      // Récupérer les tickets de l'utilisateur
      const tickets = await this.ticketService.getUserTickets(user.id, null, 5);
      
      if (tickets.length === 0) {
        return {
          type: 'text',
          content: this.localizationService.getLocalizedMessage('ticket.no_tickets', user.language)
        };
      }

      // Formater la liste des tickets
      const ticketList = this.messageFormatter.formatTicketList(tickets, user.language, this.localizationService);

      return {
        type: 'text',
        content: ticketList
      };
      
    } catch (error) {
      logger.error('Erreur vérification statut tickets:', error);
      return {
        type: 'text',
        content: this.localizationService.getLocalizedMessage('ticket.status_error', user.language)
      };
    }
  }

  // Extraire les informations du ticket depuis le message
  extractTicketInfo(text, language) {
    const cleanText = this.messageFormatter.cleanText(text);
    
    // Mots-clés pour identifier une demande de création de ticket
    const ticketKeywords = {
      fr: ['créer un ticket', 'nouveau ticket', 'ouvrir un ticket', 'problème', 'bug', 'aide'],
      en: ['create ticket', 'new ticket', 'open ticket', 'problem', 'bug', 'help']
    };
    
    // Supprimer les mots-clés de déclenchement pour extraire le contenu
    let content = cleanText;
    const keywords = ticketKeywords[language] || ticketKeywords.fr;
    
    keywords.forEach(keyword => {
      const regex = new RegExp(keyword, 'gi');
      content = content.replace(regex, '').trim();
    });
    
    // Si le contenu est trop court, considérer tout le message comme description
    if (content.length < 10) {
      content = cleanText;
    }
    
    // Extraire titre et description
    let title, description;
    
    // Si le message contient des séparateurs, diviser
    if (content.includes(':') || content.includes('-') || content.includes('\n')) {
      const parts = content.split(/[:\n-]/).map(p => p.trim()).filter(p => p.length > 0);
      if (parts.length >= 2) {
        title = this.messageFormatter.truncateText(parts[0], 100); // Limiter le titre
        description = parts.slice(1).join(' ');
      } else {
        title = this.generateTitleFromText(content, language);
        description = content;
      }
    } else {
      // Générer un titre à partir du contenu
      title = this.generateTitleFromText(content, language);
      description = content;
    }
    
    return {
      title: title || (language === 'fr' ? 'Demande d\'assistance' : 'Support Request'),
      description: description || content,
      category: null // Sera déterminé automatiquement par TicketService
    };
  }
  
  // Générer un titre à partir du texte
  generateTitleFromText(text, language) {
    if (!text) {
      return language === 'fr' ? 'Demande d\'assistance' : 'Support Request';
    }

    const words = text.split(' ').slice(0, 8); // Prendre les 8 premiers mots
    let title = words.join(' ');
    
    if (title.length > 50) {
      title = title.substring(0, 47) + '...';
    }
    
    return title || (language === 'fr' ? 'Demande d\'assistance' : 'Support Request');
  }

  // Vérifier si un message contient une demande de création de ticket
  isTicketCreationRequest(text, language) {
    const ticketKeywords = {
      fr: ['créer un ticket', 'nouveau ticket', 'ouvrir un ticket', 'créer ticket', 'ticket'],
      en: ['create ticket', 'new ticket', 'open ticket', 'ticket']
    };
    
    const keywords = ticketKeywords[language] || ticketKeywords.fr;
    const lowerText = text.toLowerCase();
    
    return keywords.some(keyword => lowerText.includes(keyword.toLowerCase()));
  }

  // Vérifier si un message contient une demande de vérification de statut
  isTicketStatusRequest(text, language) {
    const statusKeywords = {
      fr: ['statut ticket', 'état ticket', 'vérifier ticket', 'mes tickets', 'ticket status'],
      en: ['ticket status', 'check ticket', 'my tickets', 'ticket state']
    };
    
    const keywords = statusKeywords[language] || statusKeywords.fr;
    const lowerText = text.toLowerCase();
    
    return keywords.some(keyword => lowerText.includes(keyword.toLowerCase()));
  }

  // Analyser le contenu d'un message pour détecter l'intent ticket
  analyzeTicketIntent(text, language) {
    const lowerText = text.toLowerCase();
    
    if (this.isTicketCreationRequest(text, language)) {
      return {
        intent: 'create_ticket',
        confidence: 0.8,
        entities: this.extractTicketInfo(text, language)
      };
    }
    
    if (this.isTicketStatusRequest(text, language)) {
      return {
        intent: 'check_ticket_status',
        confidence: 0.8,
        entities: {}
      };
    }
    
    return null;
  }

  // Valider les informations d'un ticket
  validateTicketInfo(ticketInfo) {
    const errors = [];
    
    if (!ticketInfo.title || ticketInfo.title.trim().length === 0) {
      errors.push('Title is required');
    }
    
    if (!ticketInfo.description || ticketInfo.description.trim().length === 0) {
      errors.push('Description is required');
    }
    
    if (ticketInfo.title && ticketInfo.title.length > 200) {
      errors.push('Title is too long (max 200 characters)');
    }
    
    if (ticketInfo.description && ticketInfo.description.length > 2000) {
      errors.push('Description is too long (max 2000 characters)');
    }
    
    return {
      isValid: errors.length === 0,
      errors
    };
  }
}

module.exports = TicketMessageHandler;