const { getPrismaClient } = require('../config/database');
const { CacheService } = require('../config/redis');
const logger = require('../utils/logger');
const { v4: uuidv4 } = require('uuid');
const { NotFoundError, ValidationError } = require('../middleware/errorMiddleware');

class TicketService {
  constructor() {
    this.prisma = null;
    this.cacheService = new CacheService();
    this.cacheTTL = 300; // 5 minutes
    
    // Configuration des priorités automatiques
    this.urgentKeywords = {
      fr: ['urgent', 'critique', 'bloqué', 'panne', 'ne fonctionne pas', 'cassé', 'erreur critique'],
      en: ['urgent', 'critical', 'blocked', 'down', 'not working', 'broken', 'critical error']
    };
    
    this.highPriorityKeywords = {
      fr: ['important', 'rapidement', 'vite', 'problème', 'bug', 'dysfonctionnement'],
      en: ['important', 'quickly', 'fast', 'problem', 'bug', 'malfunction']
    };
  }

  // Initialiser le service
  async initialize() {
    if (!this.prisma) {
      this.prisma = getPrismaClient();
    }
  }

  // Créer un nouveau ticket
  async createTicket(userId, title, description, category = null, language = 'fr') {
    try {
      await this.initialize();
      
      // Valider les données
      if (!title || title.trim().length === 0) {
        throw new ValidationError('Le titre du ticket est requis');
      }
      
      if (!description || description.trim().length === 0) {
        throw new ValidationError('La description du ticket est requise');
      }

      // Déterminer la priorité automatiquement
      const priority = this.determinePriority(title + ' ' + description, language);
      
      // Déterminer la catégorie si non fournie
      if (!category) {
        category = this.determineCategory(title + ' ' + description, language);
      }

      // Créer le ticket
      const ticket = await this.prisma.ticket.create({
        data: {
          userId,
          title: title.trim(),
          description: description.trim(),
          category,
          priority,
          status: 'OPEN'
        },
        include: {
          user: {
            select: {
              phoneNumber: true,
              name: true,
              language: true
            }
          }
        }
      });

      // Invalider le cache des tickets de l'utilisateur
      await this.cacheService.del(`tickets:user:${userId}`);
      
      logger.logTicket('Ticket Created', ticket.id, {
        userId,
        title: title.substring(0, 50),
        priority,
        category
      });

      // Assigner automatiquement si configuré
      if (process.env.TICKET_AUTO_ASSIGN === 'true') {
        await this.autoAssignTicket(ticket.id);
      }

      return ticket;
      
    } catch (error) {
      logger.error('Erreur création ticket:', error);
      throw error;
    }
  }

  // Obtenir un ticket par ID
  async getTicketById(ticketId, userId = null) {
    try {
      await this.initialize();
      
      const cacheKey = `ticket:${ticketId}`;
      let ticket = await this.cacheService.get(cacheKey);
      
      if (!ticket) {
        const whereClause = { id: ticketId };
        if (userId) {
          whereClause.userId = userId;
        }
        
        ticket = await this.prisma.ticket.findUnique({
          where: whereClause,
          include: {
            user: {
              select: {
                phoneNumber: true,
                name: true,
                language: true
              }
            }
          }
        });
        
        if (!ticket) {
          throw new NotFoundError('Ticket non trouvé');
        }
        
        await this.cacheService.set(cacheKey, ticket, this.cacheTTL);
      }
      
      return ticket;
      
    } catch (error) {
      logger.error('Erreur récupération ticket:', error);
      throw error;
    }
  }

  // Obtenir les tickets d'un utilisateur
  async getUserTickets(userId, status = null, limit = 10, offset = 0) {
    try {
      await this.initialize();
      
      const cacheKey = `tickets:user:${userId}:${status || 'all'}:${limit}:${offset}`;
      let tickets = await this.cacheService.get(cacheKey);
      
      if (!tickets) {
        const whereClause = { userId };
        if (status) {
          whereClause.status = status;
        }
        
        tickets = await this.prisma.ticket.findMany({
          where: whereClause,
          orderBy: { createdAt: 'desc' },
          take: limit,
          skip: offset,
          include: {
            user: {
              select: {
                phoneNumber: true,
                name: true,
                language: true
              }
            }
          }
        });
        
        await this.cacheService.set(cacheKey, tickets, this.cacheTTL);
      }
      
      return tickets;
      
    } catch (error) {
      logger.error('Erreur récupération tickets utilisateur:', error);
      throw error;
    }
  }

  // Mettre à jour le statut d'un ticket
  async updateTicketStatus(ticketId, newStatus, resolution = null, agentId = null) {
    try {
      await this.initialize();
      
      const validStatuses = ['OPEN', 'IN_PROGRESS', 'WAITING_CUSTOMER', 'RESOLVED', 'CLOSED'];
      if (!validStatuses.includes(newStatus)) {
        throw new ValidationError(`Statut invalide: ${newStatus}`);
      }

      const updateData = {
        status: newStatus,
        updatedAt: new Date()
      };

      if (resolution) {
        updateData.resolution = resolution;
      }

      if (agentId) {
        updateData.assignedAgent = agentId;
      }

      if (newStatus === 'RESOLVED' || newStatus === 'CLOSED') {
        updateData.resolvedAt = new Date();
      }

      const ticket = await this.prisma.ticket.update({
        where: { id: ticketId },
        data: updateData,
        include: {
          user: {
            select: {
              phoneNumber: true,
              name: true,
              language: true
            }
          }
        }
      });

      // Invalider les caches
      await this.cacheService.del(`ticket:${ticketId}`);
      await this.cacheService.del(`tickets:user:${ticket.userId}`);
      
      logger.logTicket('Ticket Status Updated', ticketId, {
        oldStatus: 'unknown', // On pourrait stocker l'ancien statut
        newStatus,
        agentId,
        resolution: resolution ? 'provided' : 'none'
      });

      return ticket;
      
    } catch (error) {
      logger.error('Erreur mise à jour statut ticket:', error);
      throw error;
    }
  }

  // Assigner un ticket à un agent
  async assignTicket(ticketId, agentId) {
    try {
      await this.initialize();
      
      const ticket = await this.prisma.ticket.update({
        where: { id: ticketId },
        data: {
          assignedAgent: agentId,
          status: 'IN_PROGRESS',
          updatedAt: new Date()
        },
        include: {
          user: {
            select: {
              phoneNumber: true,
              name: true,
              language: true
            }
          }
        }
      });

      // Invalider les caches
      await this.cacheService.del(`ticket:${ticketId}`);
      await this.cacheService.del(`tickets:user:${ticket.userId}`);
      
      logger.logTicket('Ticket Assigned', ticketId, {
        agentId,
        userId: ticket.userId
      });

      return ticket;
      
    } catch (error) {
      logger.error('Erreur assignation ticket:', error);
      throw error;
    }
  }

  // Rechercher des tickets
  async searchTickets(query, filters = {}, limit = 20, offset = 0) {
    try {
      await this.initialize();
      
      const whereClause = {};
      
      // Recherche textuelle
      if (query && query.trim().length > 0) {
        whereClause.OR = [
          { title: { contains: query, mode: 'insensitive' } },
          { description: { contains: query, mode: 'insensitive' } },
          { resolution: { contains: query, mode: 'insensitive' } }
        ];
      }
      
      // Filtres
      if (filters.status) {
        whereClause.status = filters.status;
      }
      
      if (filters.priority) {
        whereClause.priority = filters.priority;
      }
      
      if (filters.category) {
        whereClause.category = filters.category;
      }
      
      if (filters.assignedAgent) {
        whereClause.assignedAgent = filters.assignedAgent;
      }
      
      if (filters.userId) {
        whereClause.userId = filters.userId;
      }
      
      if (filters.dateFrom) {
        whereClause.createdAt = {
          ...whereClause.createdAt,
          gte: new Date(filters.dateFrom)
        };
      }
      
      if (filters.dateTo) {
        whereClause.createdAt = {
          ...whereClause.createdAt,
          lte: new Date(filters.dateTo)
        };
      }

      const tickets = await this.prisma.ticket.findMany({
        where: whereClause,
        orderBy: { createdAt: 'desc' },
        take: limit,
        skip: offset,
        include: {
          user: {
            select: {
              phoneNumber: true,
              name: true,
              language: true
            }
          }
        }
      });
      
      const total = await this.prisma.ticket.count({ where: whereClause });
      
      return {
        tickets,
        total,
        limit,
        offset,
        hasMore: offset + limit < total
      };
      
    } catch (error) {
      logger.error('Erreur recherche tickets:', error);
      throw error;
    }
  }

  // Obtenir les statistiques des tickets
  async getTicketStats(userId = null, dateFrom = null, dateTo = null) {
    try {
      await this.initialize();
      
      const cacheKey = `ticket:stats:${userId || 'all'}:${dateFrom || ''}:${dateTo || ''}`;
      let stats = await this.cacheService.get(cacheKey);
      
      if (!stats) {
        const whereClause = {};
        
        if (userId) {
          whereClause.userId = userId;
        }
        
        if (dateFrom || dateTo) {
          whereClause.createdAt = {};
          if (dateFrom) whereClause.createdAt.gte = new Date(dateFrom);
          if (dateTo) whereClause.createdAt.lte = new Date(dateTo);
        }

        const [total, byStatus, byPriority, byCategory] = await Promise.all([
          this.prisma.ticket.count({ where: whereClause }),
          this.prisma.ticket.groupBy({
            by: ['status'],
            where: whereClause,
            _count: { status: true }
          }),
          this.prisma.ticket.groupBy({
            by: ['priority'],
            where: whereClause,
            _count: { priority: true }
          }),
          this.prisma.ticket.groupBy({
            by: ['category'],
            where: whereClause,
            _count: { category: true }
          })
        ]);

        stats = {
          total,
          byStatus: byStatus.reduce((acc, item) => {
            acc[item.status] = item._count.status;
            return acc;
          }, {}),
          byPriority: byPriority.reduce((acc, item) => {
            acc[item.priority] = item._count.priority;
            return acc;
          }, {}),
          byCategory: byCategory.reduce((acc, item) => {
            acc[item.category || 'uncategorized'] = item._count.category;
            return acc;
          }, {})
        };
        
        await this.cacheService.set(cacheKey, stats, this.cacheTTL);
      }
      
      return stats;
      
    } catch (error) {
      logger.error('Erreur récupération statistiques tickets:', error);
      throw error;
    }
  }

  // Déterminer la priorité automatiquement
  determinePriority(text, language = 'fr') {
    const lowerText = text.toLowerCase();
    
    // Vérifier les mots-clés urgents
    const urgentWords = this.urgentKeywords[language] || this.urgentKeywords.fr;
    if (urgentWords.some(word => lowerText.includes(word))) {
      return 'URGENT';
    }
    
    // Vérifier les mots-clés haute priorité
    const highPriorityWords = this.highPriorityKeywords[language] || this.highPriorityKeywords.fr;
    if (highPriorityWords.some(word => lowerText.includes(word))) {
      return 'HIGH';
    }
    
    return 'NORMAL';
  }

  // Déterminer la catégorie automatiquement
  determineCategory(text, language = 'fr') {
    const lowerText = text.toLowerCase();
    
    const categoryKeywords = {
      fr: {
        'technique': ['bug', 'erreur', 'ne fonctionne pas', 'plantage', 'lent', 'connexion'],
        'facturation': ['facture', 'paiement', 'prix', 'coût', 'remboursement', 'abonnement'],
        'commande': ['commande', 'livraison', 'expédition', 'reçu', 'produit'],
        'compte': ['compte', 'profil', 'mot de passe', 'connexion', 'accès'],
        'général': ['information', 'question', 'aide', 'comment']
      },
      en: {
        'technical': ['bug', 'error', 'not working', 'crash', 'slow', 'connection'],
        'billing': ['invoice', 'payment', 'price', 'cost', 'refund', 'subscription'],
        'order': ['order', 'delivery', 'shipping', 'received', 'product'],
        'account': ['account', 'profile', 'password', 'login', 'access'],
        'general': ['information', 'question', 'help', 'how']
      }
    };
    
    const keywords = categoryKeywords[language] || categoryKeywords.fr;
    
    for (const [category, words] of Object.entries(keywords)) {
      if (words.some(word => lowerText.includes(word))) {
        return category;
      }
    }
    
    return 'général';
  }

  // Assignation automatique des tickets
  async autoAssignTicket(ticketId) {
    try {
      // Ici on pourrait implémenter une logique d'assignation automatique
      // basée sur la charge de travail des agents, leurs compétences, etc.
      
      // Pour l'instant, on log juste l'événement
      logger.logTicket('Auto Assignment Attempted', ticketId, {
        result: 'not_implemented'
      });
      
    } catch (error) {
      logger.error('Erreur assignation automatique:', error);
    }
  }

  // Vérifier les tickets qui nécessitent une escalade
  async checkTicketsForEscalation() {
    try {
      await this.initialize();
      
      const escalationTimeout = parseInt(process.env.TICKET_ESCALATION_TIMEOUT) || 1800; // 30 minutes
      const cutoffTime = new Date(Date.now() - escalationTimeout * 1000);
      
      const ticketsToEscalate = await this.prisma.ticket.findMany({
        where: {
          status: 'OPEN',
          priority: { in: ['HIGH', 'URGENT'] },
          createdAt: { lt: cutoffTime },
          assignedAgent: null
        },
        include: {
          user: {
            select: {
              phoneNumber: true,
              name: true,
              language: true
            }
          }
        }
      });
      
      for (const ticket of ticketsToEscalate) {
        logger.logTicket('Ticket Escalation Required', ticket.id, {
          priority: ticket.priority,
          ageMinutes: Math.floor((Date.now() - ticket.createdAt.getTime()) / 60000)
        });
        
        // Ici on pourrait envoyer des notifications aux superviseurs
      }
      
      return ticketsToEscalate;
      
    } catch (error) {
      logger.error('Erreur vérification escalade tickets:', error);
      return [];
    }
  }

  // Fermer automatiquement les tickets résolus anciens
  async autoCloseResolvedTickets() {
    try {
      await this.initialize();
      
      const autoCloseDelay = 7 * 24 * 60 * 60 * 1000; // 7 jours
      const cutoffTime = new Date(Date.now() - autoCloseDelay);
      
      const result = await this.prisma.ticket.updateMany({
        where: {
          status: 'RESOLVED',
          resolvedAt: { lt: cutoffTime }
        },
        data: {
          status: 'CLOSED',
          updatedAt: new Date()
        }
      });
      
      if (result.count > 0) {
        logger.info(`${result.count} tickets fermés automatiquement`);
      }
      
      return result.count;
      
    } catch (error) {
      logger.error('Erreur fermeture automatique tickets:', error);
      return 0;
    }
  }
}

module.exports = TicketService;