const logger = require('../utils/logger');

class MessageLocalizationService {
  constructor() {
    this.defaultLanguage = process.env.DEFAULT_LANGUAGE || 'fr';
    this.supportedLanguages = (process.env.SUPPORTED_LANGUAGES || 'fr,en').split(',');
  }

  // Obtenir un message localisé
  getLocalizedMessage(key, language, params = {}) {
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
        'help.tickets.title': 'Gestion des tickets',
        'help.tickets.create': 'Créer un ticket',
        'help.tickets.create_desc': 'Signaler un problème ou faire une demande',
        'help.tickets.check': 'Vérifier un ticket',
        'help.tickets.check_desc': 'Suivre l\'état de votre demande',
        'help.support.title': 'Support client',
        'help.support.faq': 'Questions fréquentes',
        'help.support.faq_desc': 'Réponses aux questions courantes',
        'help.support.agent': 'Parler à un agent',
        'help.support.agent_desc': 'Être mis en relation avec un humain',
        'faq.main_text': 'Voici les questions fréquemment posées. Que souhaitez-vous savoir ?',
        'faq.products': 'Nos produits',
        'faq.support': 'Support technique',
        'handoff.initiated': 'Je vous mets en relation avec un agent humain. Veuillez patienter...',
        'error.general': 'Désolé, une erreur s\'est produite. Veuillez réessayer.',
        'error.unknown_response_type': 'Type de réponse non reconnu.',
        'error.ai_unavailable': 'Le service IA est temporairement indisponible.',
        'fallback.message': 'Je n\'ai pas bien compris votre demande. Pouvez-vous reformuler ou choisir une option ci-dessous ?',
        'bot.introduction': 'Je suis votre assistant virtuel. Je peux vous aider avec vos questions, créer des tickets de support, et vous mettre en relation avec nos agents si nécessaire.',
        'bot.capabilities': 'Je peux vous aider à :\n• Répondre à vos questions\n• Créer des tickets de support\n• Vous connecter avec un agent humain\n• Fournir des informations sur nos services',
        'goodbye.message': 'Merci d\'avoir utilisé notre service. N\'hésitez pas à revenir si vous avez d\'autres questions. Bonne journée !',
        'ticket.need_more_info': 'Pour créer votre ticket, j\'ai besoin de plus d\'informations. Pouvez-vous décrire votre problème en détail ?',
        'ticket.created_success': `✅ Votre ticket #${params.ticketId} a été créé avec succès !\n\n📋 **Titre:** ${params.title}\n🔥 **Priorité:** ${params.priority}\n\nNous traiterons votre demande dans les plus brefs délais. Vous pouvez vérifier le statut en tapant "statut ticket".`,
        'ticket.creation_error': 'Désolé, une erreur s\'est produite lors de la création de votre ticket. Veuillez réessayer ou contacter un agent.',
        'ticket.no_tickets': 'Vous n\'avez aucun ticket en cours. Tapez "créer un ticket" pour signaler un problème.',
        'ticket.status_header': '📋 **Vos tickets de support**',
        'ticket.priority': 'Priorité',
        'ticket.created': 'Créé le',
        'ticket.status_error': 'Impossible de récupérer le statut de vos tickets. Veuillez réessayer plus tard.',
        'media.image_received': 'Image reçue. Comment puis-je vous aider avec cette image ?',
        'media.audio_received': 'Message audio reçu. Pouvez-vous reformuler par écrit ?',
        'media.video_received': 'Vidéo reçue. Comment puis-je vous aider ?',
        'media.document_received': 'Document reçu. Comment puis-je vous aider avec ce document ?',
        'location.received': `📍 Position reçue: ${params.name}\n📍 Adresse: ${params.address}`
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
        'help.tickets.title': 'Ticket Management',
        'help.tickets.create': 'Create a ticket',
        'help.tickets.create_desc': 'Report an issue or make a request',
        'help.tickets.check': 'Check a ticket',
        'help.tickets.check_desc': 'Track the status of your request',
        'help.support.title': 'Customer Support',
        'help.support.faq': 'Frequently Asked Questions',
        'help.support.faq_desc': 'Answers to common questions',
        'help.support.agent': 'Talk to an agent',
        'help.support.agent_desc': 'Connect with a human representative',
        'faq.main_text': 'Here are frequently asked questions. What would you like to know?',
        'faq.products': 'Our products',
        'faq.support': 'Technical support',
        'handoff.initiated': 'I\'m connecting you with a human agent. Please wait...',
        'error.general': 'Sorry, an error occurred. Please try again.',
        'error.unknown_response_type': 'Unknown response type.',
        'error.ai_unavailable': 'AI service is temporarily unavailable.',
        'fallback.message': 'I didn\'t understand your request. Could you rephrase or choose an option below?',
        'bot.introduction': 'I am your virtual assistant. I can help you with your questions, create support tickets, and connect you with our agents when needed.',
        'bot.capabilities': 'I can help you with:\n• Answering your questions\n• Creating support tickets\n• Connecting you with human agents\n• Providing information about our services',
        'goodbye.message': 'Thank you for using our service. Feel free to come back if you have any other questions. Have a great day!',
        'ticket.need_more_info': 'To create your ticket, I need more information. Can you describe your problem in detail?',
        'ticket.created_success': `✅ Your ticket #${params.ticketId} has been created successfully!\n\n📋 **Title:** ${params.title}\n🔥 **Priority:** ${params.priority}\n\nWe will process your request as soon as possible. You can check the status by typing "ticket status".`,
        'ticket.creation_error': 'Sorry, an error occurred while creating your ticket. Please try again or contact an agent.',
        'ticket.no_tickets': 'You have no tickets in progress. Type "create ticket" to report a problem.',
        'ticket.status_header': '📋 **Your support tickets**',
        'ticket.priority': 'Priority',
        'ticket.created': 'Created on',
        'ticket.status_error': 'Unable to retrieve your ticket status. Please try again later.',
        'media.image_received': 'Image received. How can I help you with this image?',
        'media.audio_received': 'Audio message received. Could you please rephrase in text?',
        'media.video_received': 'Video received. How can I help you?',
        'media.document_received': 'Document received. How can I help you with this document?',
        'location.received': `📍 Location received: ${params.name}\n📍 Address: ${params.address}`
      }
    };

    return messages[language]?.[key] || messages[this.defaultLanguage]?.[key] || key;
  }

  // Obtenir un message d'erreur
  getErrorMessage(language) {
    return this.getLocalizedMessage('error.general', language);
  }

  // Obtenir un message de fallback
  getFallbackMessage(language) {
    return this.getLocalizedMessage('fallback.message', language);
  }

  // Obtenir un message de fallback conversationnel
  getFallbackConversationalMessage(language) {
    return language === 'fr' 
      ? `Je comprends que vous cherchez de l'aide, mais je n'ai pas pu saisir exactement votre demande. Voici quelques suggestions :\n\n• Essayez de reformuler votre question plus simplement\n• Utilisez des mots-clés comme "aide", "problème", ou "information"\n• Ou choisissez une option ci-dessous pour que je puisse mieux vous aider`
      : `I understand you're looking for help, but I couldn't quite grasp your request. Here are some suggestions:\n\n• Try rephrasing your question more simply\n• Use keywords like "help", "problem", or "information"\n• Or choose an option below so I can better assist you`;
  }

  // Vérifier si une langue est supportée
  isLanguageSupported(language) {
    return this.supportedLanguages.includes(language);
  }

  // Obtenir la langue par défaut
  getDefaultLanguage() {
    return this.defaultLanguage;
  }

  // Obtenir toutes les langues supportées
  getSupportedLanguages() {
    return this.supportedLanguages;
  }
}

module.exports = MessageLocalizationService;