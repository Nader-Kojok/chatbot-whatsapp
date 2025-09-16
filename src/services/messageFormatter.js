class MessageFormatter {
  constructor() {
    // Configuration des emojis pour les statuts
    this.statusEmojis = {
      'OPEN': '🔴',
      'IN_PROGRESS': '🟡',
      'WAITING_CUSTOMER': '🔵',
      'RESOLVED': '🟢',
      'CLOSED': '⚫'
    };

    // Configuration des emojis pour les priorités
    this.priorityEmojis = {
      'LOW': '🟢',
      'NORMAL': '🟡',
      'HIGH': '🟠',
      'URGENT': '🔴'
    };
  }

  // Obtenir l'emoji pour le statut
  getStatusEmoji(status) {
    return this.statusEmojis[status] || '❓';
  }

  // Obtenir l'emoji pour la priorité
  getPriorityEmoji(priority) {
    return this.priorityEmojis[priority] || '⚪';
  }

  // Formater une date selon la langue
  formatDate(date, language) {
    const options = {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    };
    
    const locale = language === 'fr' ? 'fr-FR' : 'en-US';
    return new Date(date).toLocaleDateString(locale, options);
  }

  // Formater une liste de tickets
  formatTicketList(tickets, language, localizationService) {
    if (!tickets || tickets.length === 0) {
      return localizationService.getLocalizedMessage('ticket.no_tickets', language);
    }

    let ticketList = localizationService.getLocalizedMessage('ticket.status_header', language) + '\n\n';
    
    tickets.forEach((ticket, index) => {
      const statusEmoji = this.getStatusEmoji(ticket.status);
      const priorityEmoji = this.getPriorityEmoji(ticket.priority);
      
      ticketList += `${statusEmoji} *Ticket #${ticket.id}*\n`;
      ticketList += `📋 ${ticket.title}\n`;
      ticketList += `${priorityEmoji} ${localizationService.getLocalizedMessage('ticket.priority', language)}: ${ticket.priority}\n`;
      ticketList += `📅 ${localizationService.getLocalizedMessage('ticket.created', language)}: ${this.formatDate(ticket.createdAt, language)}\n`;
      
      if (index < tickets.length - 1) {
        ticketList += '\n---\n\n';
      }
    });

    return ticketList;
  }

  // Formater un message de confirmation de ticket
  formatTicketConfirmation(ticket, language, localizationService) {
    return localizationService.getLocalizedMessage('ticket.created_success', language, {
      ticketId: ticket.id,
      title: ticket.title,
      priority: ticket.priority
    });
  }

  // Formater un message de localisation
  formatLocationMessage(location, language, localizationService) {
    return localizationService.getLocalizedMessage('location.received', language, {
      name: location.name || 'Position',
      address: location.address || (language === 'fr' ? 'Adresse non disponible' : 'Address not available')
    });
  }

  // Formater un message de média
  formatMediaMessage(mediaType, language, localizationService) {
    const mediaKey = `media.${mediaType}_received`;
    return localizationService.getLocalizedMessage(mediaKey, language);
  }

  // Tronquer un texte avec ellipses
  truncateText(text, maxLength = 100) {
    if (!text || text.length <= maxLength) {
      return text;
    }
    return text.substring(0, maxLength - 3) + '...';
  }

  // Nettoyer et formater un texte
  cleanText(text) {
    if (!text) return '';
    return text.trim().replace(/\s+/g, ' ');
  }

  // Formater un temps d'activité
  formatUptime(seconds) {
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

  // Formater la taille de mémoire
  formatMemorySize(bytes) {
    const mb = Math.round(bytes / 1024 / 1024);
    return `${mb} MB`;
  }

  // Capitaliser la première lettre
  capitalize(text) {
    if (!text) return '';
    return text.charAt(0).toUpperCase() + text.slice(1).toLowerCase();
  }

  // Formater un numéro de téléphone (masquer partiellement)
  formatPhoneNumber(phoneNumber, mask = true) {
    if (!phoneNumber) return '';
    
    if (!mask) return phoneNumber;
    
    // Masquer les chiffres du milieu
    if (phoneNumber.length > 6) {
      const start = phoneNumber.substring(0, 3);
      const end = phoneNumber.substring(phoneNumber.length - 3);
      return `${start}***${end}`;
    }
    
    return phoneNumber;
  }
}

module.exports = MessageFormatter;