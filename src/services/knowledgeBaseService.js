const { getPrismaClient } = require('../config/database');
const { CacheService } = require('../config/redis');
const NLPService = require('./nlpService');
const logger = require('../utils/logger');
const { ValidationError, NotFoundError } = require('../middleware/errorMiddleware');

class KnowledgeBaseService {
  constructor() {
    this.prisma = null;
    this.cacheService = new CacheService();
    this.nlpService = new NLPService();
    this.cacheTTL = 3600; // 1 heure
    this.searchCacheTTL = 1800; // 30 minutes
    
    // Seuil de similarité pour les recherches
    this.similarityThreshold = 0.6;
    
    // Catégories par défaut
    this.defaultCategories = {
      fr: [
        'général',
        'technique',
        'facturation',
        'commandes',
        'livraison',
        'retours',
        'compte',
        'sécurité'
      ],
      en: [
        'general',
        'technical',
        'billing',
        'orders',
        'shipping',
        'returns',
        'account',
        'security'
      ]
    };
  }

  // Initialiser le service
  async initialize() {
    if (!this.prisma) {
      this.prisma = getPrismaClient();
    }
  }

  // Rechercher dans la base de connaissances
  async search(query, language = 'fr', limit = 5) {
    try {
      await this.initialize();
      
      if (!query || query.trim().length === 0) {
        throw new ValidationError('La requête de recherche est requise');
      }

      const normalizedQuery = query.trim().toLowerCase();
      const cacheKey = `kb:search:${this.hashText(normalizedQuery)}:${language}:${limit}`;
      
      // Vérifier le cache
      let results = await this.cacheService.get(cacheKey);
      if (results) {
        logger.debug('Knowledge Base Search Cache Hit', {
          query: normalizedQuery.substring(0, 50),
          language,
          resultsCount: results.length
        });
        return results[0] || null; // Retourner le meilleur résultat
      }

      const startTime = Date.now();
      
      // Recherche par mots-clés d'abord (plus rapide)
      const keywordResults = await this.searchByKeywords(normalizedQuery, language, limit);
      
      // Si on a des résultats avec une bonne correspondance, les utiliser
      if (keywordResults.length > 0 && keywordResults[0].confidence > 0.8) {
        await this.cacheService.set(cacheKey, keywordResults, this.searchCacheTTL);
        
        const processingTime = Date.now() - startTime;
        logger.info('Knowledge Base Keyword Search', {
          query: normalizedQuery.substring(0, 50),
          language,
          resultsCount: keywordResults.length,
          bestConfidence: keywordResults[0].confidence,
          processingTime: `${processingTime}ms`
        });
        
        return keywordResults[0];
      }
      
      // Sinon, utiliser la recherche sémantique avec NLP
      const semanticResults = await this.searchSemantic(normalizedQuery, language, limit);
      
      // Combiner et trier les résultats
      const allResults = [...keywordResults, ...semanticResults]
        .sort((a, b) => b.confidence - a.confidence)
        .slice(0, limit);
      
      await this.cacheService.set(cacheKey, allResults, this.searchCacheTTL);
      
      const processingTime = Date.now() - startTime;
      logger.info('Knowledge Base Full Search', {
        query: normalizedQuery.substring(0, 50),
        language,
        keywordResults: keywordResults.length,
        semanticResults: semanticResults.length,
        totalResults: allResults.length,
        bestConfidence: allResults[0]?.confidence || 0,
        processingTime: `${processingTime}ms`
      });
      
      return allResults[0] || null;
      
    } catch (error) {
      logger.error('Erreur recherche base de connaissances:', error);
      return null;
    }
  }

  // Recherche par mots-clés
  async searchByKeywords(query, language, limit) {
    try {
      const queryWords = query.split(' ').filter(word => word.length > 2);
      
      if (queryWords.length === 0) {
        return [];
      }

      // Recherche dans les questions et mots-clés
      const entries = await this.prisma.knowledgeBase.findMany({
        where: {
          AND: [
            { language },
            { isActive: true },
            {
              OR: [
                {
                  question: {
                    contains: query,
                    mode: 'insensitive'
                  }
                },
                {
                  keywords: {
                    hasSome: queryWords
                  }
                }
              ]
            }
          ]
        },
        orderBy: { usageCount: 'desc' },
        take: limit * 2 // Prendre plus pour pouvoir calculer la pertinence
      });

      // Calculer la pertinence pour chaque entrée
      const results = entries.map(entry => {
        const confidence = this.calculateKeywordConfidence(query, queryWords, entry);
        return {
          id: entry.id,
          question: entry.question,
          answer: entry.answer,
          category: entry.category,
          confidence,
          source: 'keyword'
        };
      })
      .filter(result => result.confidence > 0.3)
      .sort((a, b) => b.confidence - a.confidence)
      .slice(0, limit);

      return results;
      
    } catch (error) {
      logger.error('Erreur recherche par mots-clés:', error);
      return [];
    }
  }

  // Recherche sémantique avec NLP
  async searchSemantic(query, language, limit) {
    try {
      // Analyser l'intent de la requête
      const nlpResult = await this.nlpService.analyzeIntent(query, language);
      
      // Rechercher des entrées liées à l'intent
      const entries = await this.prisma.knowledgeBase.findMany({
        where: {
          language,
          isActive: true
        },
        orderBy: { usageCount: 'desc' },
        take: 20 // Prendre plus d'entrées pour l'analyse sémantique
      });

      // Utiliser l'IA pour évaluer la pertinence sémantique
      const semanticScores = await this.evaluateSemanticRelevance(query, entries, language);
      
      const results = entries
        .map((entry, index) => ({
          id: entry.id,
          question: entry.question,
          answer: entry.answer,
          category: entry.category,
          confidence: semanticScores[index] || 0,
          source: 'semantic'
        }))
        .filter(result => result.confidence > this.similarityThreshold)
        .sort((a, b) => b.confidence - a.confidence)
        .slice(0, limit);

      return results;
      
    } catch (error) {
      logger.error('Erreur recherche sémantique:', error);
      return [];
    }
  }

  // Calculer la confiance pour la recherche par mots-clés
  calculateKeywordConfidence(query, queryWords, entry) {
    let score = 0;
    const maxScore = queryWords.length + 2; // +2 pour la correspondance exacte et la catégorie
    
    // Correspondance exacte dans la question
    if (entry.question.toLowerCase().includes(query)) {
      score += 2;
    }
    
    // Correspondance des mots-clés
    const matchingKeywords = queryWords.filter(word => 
      entry.keywords.some(keyword => keyword.toLowerCase().includes(word))
    );
    score += matchingKeywords.length;
    
    // Correspondance des mots dans la question
    const questionWords = entry.question.toLowerCase().split(' ');
    const matchingWords = queryWords.filter(word => 
      questionWords.some(qWord => qWord.includes(word))
    );
    score += matchingWords.length * 0.5;
    
    // Bonus pour l'usage fréquent
    if (entry.usageCount > 10) {
      score += 0.2;
    }
    
    return Math.min(score / maxScore, 1);
  }

  // Évaluer la pertinence sémantique avec l'IA
  async evaluateSemanticRelevance(query, entries, language) {
    try {
      if (entries.length === 0) {
        return [];
      }

      // Construire le prompt pour l'évaluation
      const prompt = this.buildRelevanceEvaluationPrompt(query, entries, language);
      
      const fullPrompt = `${prompt.system}\n\n${prompt.user}\n\nRéponds uniquement avec un JSON valide.`;
      
      const response = await this.nlpService.model.generateContent({
        contents: [{ role: 'user', parts: [{ text: fullPrompt }] }],
        generationConfig: {
          maxOutputTokens: 500,
          temperature: 0.1
        }
      });

      const responseText = response.response.text();
      const result = JSON.parse(responseText.replace(/```json|```/g, '').trim());
      return result.scores || [];
      
    } catch (error) {
      logger.error('Erreur évaluation pertinence sémantique:', error);
      return entries.map(() => 0);
    }
  }

  // Construire le prompt pour l'évaluation de pertinence
  buildRelevanceEvaluationPrompt(query, entries, language) {
    const systemPrompt = language === 'fr'
      ? `Tu es un expert en recherche d'information. Évalue la pertinence de chaque question par rapport à la requête utilisateur.
        
        Donne un score de 0 à 1 pour chaque question :
        - 1.0 : Parfaitement pertinent
        - 0.8-0.9 : Très pertinent
        - 0.6-0.7 : Moyennement pertinent
        - 0.3-0.5 : Peu pertinent
        - 0.0-0.2 : Non pertinent
        
        Réponds avec un JSON {"scores": [score1, score2, ...]}`
      : `You are an information retrieval expert. Evaluate the relevance of each question to the user query.
        
        Give a score from 0 to 1 for each question:
        - 1.0: Perfectly relevant
        - 0.8-0.9: Very relevant
        - 0.6-0.7: Moderately relevant
        - 0.3-0.5: Slightly relevant
        - 0.0-0.2: Not relevant
        
        Respond with JSON {"scores": [score1, score2, ...]}`;

    const userPrompt = `Requête: "${query}"\n\nQuestions à évaluer:\n` +
      entries.map((entry, index) => `${index + 1}. ${entry.question}`).join('\n');

    return {
      system: systemPrompt,
      user: userPrompt
    };
  }

  // Ajouter une nouvelle entrée à la base de connaissances
  async addEntry(question, answer, category, language = 'fr', keywords = []) {
    try {
      await this.initialize();
      
      if (!question || !answer) {
        throw new ValidationError('La question et la réponse sont requises');
      }

      // Générer des mots-clés automatiquement si non fournis
      if (keywords.length === 0) {
        keywords = await this.generateKeywords(question + ' ' + answer, language);
      }

      const entry = await this.prisma.knowledgeBase.create({
        data: {
          question: question.trim(),
          answer: answer.trim(),
          category: category || 'général',
          language,
          keywords,
          usageCount: 0,
          isActive: true
        }
      });

      // Invalider le cache de recherche
      await this.cacheService.deletePattern('kb:search:*');
      
      logger.info('Knowledge Base Entry Added', {
        id: entry.id,
        question: question.substring(0, 50),
        category,
        language,
        keywordsCount: keywords.length
      });

      return entry;
      
    } catch (error) {
      logger.error('Erreur ajout entrée base de connaissances:', error);
      throw error;
    }
  }

  // Mettre à jour une entrée
  async updateEntry(id, updates) {
    try {
      await this.initialize();
      
      const entry = await this.prisma.knowledgeBase.update({
        where: { id },
        data: {
          ...updates,
          updatedAt: new Date()
        }
      });

      // Invalider les caches
      await this.cacheService.deletePattern('kb:search:*');
      await this.cacheService.del(`kb:entry:${id}`);
      
      logger.info('Knowledge Base Entry Updated', {
        id,
        updatedFields: Object.keys(updates)
      });

      return entry;
      
    } catch (error) {
      logger.error('Erreur mise à jour entrée:', error);
      throw error;
    }
  }

  // Supprimer une entrée
  async deleteEntry(id) {
    try {
      await this.initialize();
      
      await this.prisma.knowledgeBase.delete({
        where: { id }
      });

      // Invalider les caches
      await this.cacheService.deletePattern('kb:search:*');
      await this.cacheService.del(`kb:entry:${id}`);
      
      logger.info('Knowledge Base Entry Deleted', { id });
      
    } catch (error) {
      logger.error('Erreur suppression entrée:', error);
      throw error;
    }
  }

  // Obtenir une entrée par ID
  async getEntry(id) {
    try {
      await this.initialize();
      
      const cacheKey = `kb:entry:${id}`;
      let entry = await this.cacheService.get(cacheKey);
      
      if (!entry) {
        entry = await this.prisma.knowledgeBase.findUnique({
          where: { id }
        });
        
        if (!entry) {
          throw new NotFoundError('Entrée non trouvée');
        }
        
        await this.cacheService.set(cacheKey, entry, this.cacheTTL);
      }
      
      return entry;
      
    } catch (error) {
      logger.error('Erreur récupération entrée:', error);
      throw error;
    }
  }

  // Lister les entrées avec pagination
  async listEntries(filters = {}, limit = 20, offset = 0) {
    try {
      await this.initialize();
      
      const whereClause = {};
      
      if (filters.language) {
        whereClause.language = filters.language;
      }
      
      if (filters.category) {
        whereClause.category = filters.category;
      }
      
      if (filters.isActive !== undefined) {
        whereClause.isActive = filters.isActive;
      }
      
      if (filters.search) {
        whereClause.OR = [
          { question: { contains: filters.search, mode: 'insensitive' } },
          { answer: { contains: filters.search, mode: 'insensitive' } }
        ];
      }

      const [entries, total] = await Promise.all([
        this.prisma.knowledgeBase.findMany({
          where: whereClause,
          orderBy: { updatedAt: 'desc' },
          take: limit,
          skip: offset
        }),
        this.prisma.knowledgeBase.count({ where: whereClause })
      ]);
      
      return {
        entries,
        total,
        limit,
        offset,
        hasMore: offset + limit < total
      };
      
    } catch (error) {
      logger.error('Erreur listage entrées:', error);
      throw error;
    }
  }

  // Incrémenter le compteur d'usage
  async incrementUsage(id) {
    try {
      await this.initialize();
      
      await this.prisma.knowledgeBase.update({
        where: { id },
        data: {
          usageCount: {
            increment: 1
          }
        }
      });
      
      // Invalider le cache de l'entrée
      await this.cacheService.del(`kb:entry:${id}`);
      
    } catch (error) {
      logger.error('Erreur incrémentation usage:', error);
    }
  }

  // Générer des mots-clés automatiquement
  async generateKeywords(text, language) {
    try {
      const prompt = language === 'fr'
        ? `Extrait 5-10 mots-clés importants de ce texte pour faciliter la recherche. Réponds avec un JSON {"keywords": ["mot1", "mot2", ...]}`
        : `Extract 5-10 important keywords from this text to facilitate search. Respond with JSON {"keywords": ["word1", "word2", ...]}`;

      const fullPrompt = `${prompt}\n\nTexte: "${text}"\n\nRéponds uniquement avec un JSON valide.`;

      const response = await this.nlpService.model.generateContent({
        contents: [{ role: 'user', parts: [{ text: fullPrompt }] }],
        generationConfig: {
          maxOutputTokens: 200,
          temperature: 0.3
        }
      });

      const responseText = response.response.text();
      const result = JSON.parse(responseText.replace(/```json|```/g, '').trim());
      return result.keywords || [];
      
    } catch (error) {
      logger.error('Erreur génération mots-clés:', error);
      return [];
    }
  }

  // Obtenir les statistiques de la base de connaissances
  async getStats(language = null) {
    try {
      await this.initialize();
      
      const cacheKey = `kb:stats:${language || 'all'}`;
      let stats = await this.cacheService.get(cacheKey);
      
      if (!stats) {
        const whereClause = language ? { language } : {};
        
        const [total, active, byCategory, byLanguage, topUsed] = await Promise.all([
          this.prisma.knowledgeBase.count({ where: whereClause }),
          this.prisma.knowledgeBase.count({ where: { ...whereClause, isActive: true } }),
          this.prisma.knowledgeBase.groupBy({
            by: ['category'],
            where: whereClause,
            _count: { category: true }
          }),
          this.prisma.knowledgeBase.groupBy({
            by: ['language'],
            where: whereClause,
            _count: { language: true }
          }),
          this.prisma.knowledgeBase.findMany({
            where: whereClause,
            orderBy: { usageCount: 'desc' },
            take: 10,
            select: {
              id: true,
              question: true,
              usageCount: true,
              category: true
            }
          })
        ]);

        stats = {
          total,
          active,
          inactive: total - active,
          byCategory: byCategory.reduce((acc, item) => {
            acc[item.category] = item._count.category;
            return acc;
          }, {}),
          byLanguage: byLanguage.reduce((acc, item) => {
            acc[item.language] = item._count.language;
            return acc;
          }, {}),
          topUsed
        };
        
        await this.cacheService.set(cacheKey, stats, this.cacheTTL);
      }
      
      return stats;
      
    } catch (error) {
      logger.error('Erreur récupération statistiques:', error);
      throw error;
    }
  }

  // Initialiser la base de connaissances avec des données par défaut
  async initializeDefaultEntries(language = 'fr') {
    try {
      await this.initialize();
      
      const existingCount = await this.prisma.knowledgeBase.count({
        where: { language }
      });
      
      if (existingCount > 0) {
        logger.info(`Base de connaissances déjà initialisée pour ${language}`);
        return;
      }

      const defaultEntries = this.getDefaultEntries(language);
      
      for (const entry of defaultEntries) {
        await this.addEntry(
          entry.question,
          entry.answer,
          entry.category,
          language,
          entry.keywords
        );
      }
      
      logger.info(`${defaultEntries.length} entrées par défaut ajoutées pour ${language}`);
      
    } catch (error) {
      logger.error('Erreur initialisation entrées par défaut:', error);
    }
  }

  // Obtenir les entrées par défaut
  getDefaultEntries(language) {
    const entries = {
      fr: [
        {
          question: "Comment puis-je vous contacter ?",
          answer: "Vous pouvez nous contacter via ce chat WhatsApp 24h/24 et 7j/7. Pour parler à un agent humain, tapez 'agent' ou utilisez le bouton correspondant.",
          category: "général",
          keywords: ["contact", "joindre", "parler", "agent", "humain"]
        },
        {
          question: "Quels sont vos horaires d'ouverture ?",
          answer: "Notre service client automatisé est disponible 24h/24 et 7j/7. Nos agents humains sont disponibles du lundi au vendredi de 9h à 18h.",
          category: "général",
          keywords: ["horaires", "ouverture", "disponible", "heures"]
        },
        {
          question: "Comment créer un ticket de support ?",
          answer: "Pour créer un ticket, décrivez simplement votre problème dans ce chat. Je créerai automatiquement un ticket et vous donnerai un numéro de suivi.",
          category: "technique",
          keywords: ["ticket", "support", "problème", "aide"]
        }
      ],
      en: [
        {
          question: "How can I contact you?",
          answer: "You can contact us through this WhatsApp chat 24/7. To speak with a human agent, type 'agent' or use the corresponding button.",
          category: "general",
          keywords: ["contact", "reach", "speak", "agent", "human"]
        },
        {
          question: "What are your opening hours?",
          answer: "Our automated customer service is available 24/7. Our human agents are available Monday to Friday from 9 AM to 6 PM.",
          category: "general",
          keywords: ["hours", "opening", "available", "time"]
        },
        {
          question: "How do I create a support ticket?",
          answer: "To create a ticket, simply describe your problem in this chat. I will automatically create a ticket and give you a tracking number.",
          category: "technical",
          keywords: ["ticket", "support", "problem", "help"]
        }
      ]
    };
    
    return entries[language] || entries.fr;
  }

  // Fonction utilitaire pour créer un hash
  hashText(text) {
    let hash = 0;
    for (let i = 0; i < text.length; i++) {
      const char = text.charCodeAt(i);
      hash = ((hash << 5) - hash) + char;
      hash = hash & hash;
    }
    return Math.abs(hash).toString(36);
  }
}

module.exports = KnowledgeBaseService;