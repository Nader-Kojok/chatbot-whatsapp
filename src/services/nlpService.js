const OpenAI = require('openai');
const { CacheService } = require('../config/redis');
const logger = require('../utils/logger');
const { OpenAIError } = require('../middleware/errorMiddleware');

class NLPService {
  constructor() {
    if (!process.env.OPENROUTER_API_KEY) {
      throw new Error('OPENROUTER_API_KEY environment variable is required');
    }
    
    this.openai = new OpenAI({
      baseURL: 'https://openrouter.ai/api/v1',
      apiKey: process.env.OPENROUTER_API_KEY,
      defaultHeaders: {
        'HTTP-Referer': process.env.OPENROUTER_SITE_URL || 'https://localhost:3000',
        'X-Title': process.env.OPENROUTER_SITE_NAME || 'WhatsApp Agent'
      }
    });
    
    this.cacheService = new CacheService();
    this.model = process.env.OPENROUTER_MODEL || 'openai/gpt-3.5-turbo';
    this.maxTokens = parseInt(process.env.OPENROUTER_MAX_TOKENS) || 1000;
    this.temperature = parseFloat(process.env.OPENROUTER_TEMPERATURE) || 0.7;
    this.confidenceThreshold = parseFloat(process.env.NLP_CONFIDENCE_THRESHOLD) || 0.7;
    
    // Cache TTL pour les analyses NLP (30 minutes)
    this.cacheTTL = 1800;
    
    // Intents supportés
    this.supportedIntents = [
      'greeting',
      'help',
      'create_ticket',
      'check_ticket_status',
      'faq',
      'contact_agent',
      'goodbye',
      'complaint',
      'compliment',
      'product_inquiry',
      'order_status',
      'refund_request',
      'technical_support',
      'billing_inquiry'
    ];
    
    // Langues supportées
    this.supportedLanguages = ['fr', 'en'];
  }

  // Analyser l'intent d'un message
  async analyzeIntent(text, language = 'fr') {
    try {
      // Vérifier le cache d'abord
      const cacheKey = `nlp:intent:${this.hashText(text)}:${language}`;
      const cachedResult = await this.cacheService.get(cacheKey);
      
      if (cachedResult) {
        logger.logNLP('Intent Analysis Cache Hit', {
          text: text.substring(0, 50),
          language,
          intent: cachedResult.intent
        });
        return cachedResult;
      }

      const startTime = Date.now();
      
      // Construire le prompt pour l'analyse d'intent
      const prompt = this.buildIntentAnalysisPrompt(text, language);
      
      const fullPrompt = `${prompt.system}\n\nTexte à analyser: "${prompt.user}"\n\nRéponds uniquement avec un JSON valide.`;
      
      const response = await this.openai.chat.completions.create({
        model: this.model,
        messages: [
          {
            role: 'user',
            content: fullPrompt
          }
        ],
        max_tokens: 500,
        temperature: 0.3
      });

      const responseText = response.choices[0].message.content;
      const result = JSON.parse(responseText.replace(/```json|```/g, '').trim());
      
      // Valider et normaliser le résultat
      const normalizedResult = this.normalizeIntentResult(result, text, language);
      
      // Mettre en cache
      await this.cacheService.set(cacheKey, normalizedResult, this.cacheTTL);
      
      const processingTime = Date.now() - startTime;
      logger.logNLP('Intent Analysis Completed', {
        text: text.substring(0, 50),
        language,
        intent: normalizedResult.intent,
        confidence: normalizedResult.confidence,
        processingTime: `${processingTime}ms`,
        tokensUsed: response.usage?.total_tokens
      });

      return normalizedResult;
      
    } catch (error) {
      logger.error('Erreur analyse intent NLP:', error);
      
      if (error.code === 'insufficient_quota' || error.code === 'rate_limit_exceeded') {
        throw new OpenAIError('Service IA temporairement indisponible', 503);
      }
      
      // Fallback: analyse basique par mots-clés
      return this.fallbackIntentAnalysis(text, language);
    }
  }

  // Détecter la langue d'un texte
  async detectLanguage(text) {
    try {
      // Vérifier le cache
      const cacheKey = `nlp:lang:${this.hashText(text)}`;
      const cachedResult = await this.cacheService.get(cacheKey);
      
      if (cachedResult) {
        return cachedResult;
      }

      // Détection simple par mots-clés pour les cas évidents
      const quickDetection = this.quickLanguageDetection(text);
      if (quickDetection) {
        await this.cacheService.set(cacheKey, quickDetection, this.cacheTTL);
        return quickDetection;
      }

      // Utiliser OpenRouter pour les cas complexes
      const prompt = 'Détecte la langue du texte suivant. Réponds uniquement avec le code de langue (fr, en, es, etc.). Si incertain, réponds "unknown".';
      const fullPrompt = `${prompt}\n\nTexte: "${text}"`;
      
      const response = await this.openai.chat.completions.create({
        model: this.model,
        messages: [
          {
            role: 'user',
            content: fullPrompt
          }
        ],
        max_tokens: 10,
        temperature: 0.1
      });

      const detectedLanguage = response.choices[0].message.content.trim().toLowerCase();
      
      // Valider que c'est une langue supportée
      const finalLanguage = this.supportedLanguages.includes(detectedLanguage) ? detectedLanguage : null;
      
      await this.cacheService.set(cacheKey, finalLanguage, this.cacheTTL);
      
      logger.logNLP('Language Detection', {
        text: text.substring(0, 50),
        detectedLanguage: finalLanguage
      });

      return finalLanguage;
      
    } catch (error) {
      logger.error('Erreur détection langue:', error);
      return null; // Retourner null en cas d'erreur
    }
  }

  // Analyser le sentiment d'un message
  async analyzeSentiment(text, language = 'fr') {
    try {
      const cacheKey = `nlp:sentiment:${this.hashText(text)}:${language}`;
      const cachedResult = await this.cacheService.get(cacheKey);
      
      if (cachedResult) {
        return cachedResult;
      }

      const prompt = language === 'fr' 
        ? 'Analyse le sentiment de ce texte. Réponds avec un JSON contenant "sentiment" (positive, negative, neutral) et "score" (0-1).'
        : 'Analyze the sentiment of this text. Respond with JSON containing "sentiment" (positive, negative, neutral) and "score" (0-1).';

      const fullPrompt = `${prompt}\n\nTexte: "${text}"\n\nRéponds uniquement avec un JSON valide.`;

      const response = await this.openai.chat.completions.create({
        model: this.model,
        messages: [
          {
            role: 'user',
            content: fullPrompt
          }
        ],
        max_tokens: 100,
        temperature: 0.3
      });

      const responseText = response.choices[0].message.content;
      const result = JSON.parse(responseText.replace(/```json|```/g, '').trim());
      
      await this.cacheService.set(cacheKey, result, this.cacheTTL);
      
      logger.logNLP('Sentiment Analysis', {
        text: text.substring(0, 50),
        sentiment: result.sentiment,
        score: result.score
      });

      return result;
      
    } catch (error) {
      logger.error('Erreur analyse sentiment:', error);
      return { sentiment: 'neutral', score: 0.5 };
    }
  }

  // Extraire les entités d'un texte
  async extractEntities(text, language = 'fr') {
    try {
      const cacheKey = `nlp:entities:${this.hashText(text)}:${language}`;
      const cachedResult = await this.cacheService.get(cacheKey);
      
      if (cachedResult) {
        return cachedResult;
      }

      const prompt = this.buildEntityExtractionPrompt(language);
      const fullPrompt = `${prompt}\n\nTexte: "${text}"\n\nRéponds uniquement avec un JSON valide.`;

      const response = await this.openai.chat.completions.create({
        model: this.model,
        messages: [
          {
            role: 'user',
            content: fullPrompt
          }
        ],
        max_tokens: 300,
        temperature: 0.2
      });

      const responseText = response.choices[0].message.content;
      const result = JSON.parse(responseText.replace(/```json|```/g, '').trim());
      
      await this.cacheService.set(cacheKey, result, this.cacheTTL);
      
      logger.logNLP('Entity Extraction', {
        text: text.substring(0, 50),
        entitiesFound: Object.keys(result.entities || {}).length
      });

      return result.entities || {};
      
    } catch (error) {
      logger.error('Erreur extraction entités:', error);
      return {};
    }
  }

  // Générer une réponse contextuelle
  async generateResponse(intent, entities, context, language = 'fr') {
    try {
      const cacheKey = `nlp:response:${intent}:${this.hashText(JSON.stringify({ entities, context }))}:${language}`;
      const cachedResult = await this.cacheService.get(cacheKey);
      
      if (cachedResult) {
        return cachedResult;
      }

      const prompt = this.buildResponseGenerationPrompt(intent, entities, context, language);
      const fullPrompt = `${prompt.system}\n\n${prompt.user}`;

      const response = await this.openai.chat.completions.create({
        model: this.model,
        messages: [
          {
            role: 'user',
            content: fullPrompt
          }
        ],
        max_tokens: this.maxTokens,
        temperature: this.temperature
      });

      const generatedResponse = response.choices[0].message.content.trim();
      
      await this.cacheService.set(cacheKey, generatedResponse, this.cacheTTL);
      
      logger.logNLP('Response Generation', {
        intent,
        language,
        responseLength: generatedResponse.length
      });

      return generatedResponse;
      
    } catch (error) {
      logger.error('Erreur génération réponse:', error);
      throw new OpenAIError('Impossible de générer une réponse');
    }
  }

  // Construire le prompt pour l'analyse d'intent
  buildIntentAnalysisPrompt(text, language) {
    const systemPrompt = language === 'fr' 
      ? `Tu es un assistant IA spécialisé dans l'analyse d'intentions pour un service client WhatsApp.
        
        Analyse le message suivant et détermine l'intention principale parmi ces catégories :
        - greeting: salutations, bonjour, bonsoir
        - help: demande d'aide générale
        - create_ticket: créer un ticket, signaler un problème
        - check_ticket_status: vérifier le statut d'un ticket
        - faq: questions fréquentes, informations générales
        - contact_agent: parler à un humain, agent
        - goodbye: au revoir, fin de conversation
        - complaint: plainte, mécontentement
        - compliment: compliment, satisfaction
        - product_inquiry: questions sur les produits
        - order_status: statut de commande
        - refund_request: demande de remboursement
        - technical_support: support technique
        - billing_inquiry: questions de facturation
        
        Réponds avec un JSON contenant :
        - "intent": l'intention détectée
        - "confidence": score de confiance (0-1)
        - "entities": objets extraits du texte
        - "sentiment": sentiment général (positive, negative, neutral)`
      : `You are an AI assistant specialized in intent analysis for WhatsApp customer service.
        
        Analyze the following message and determine the main intent from these categories:
        - greeting: greetings, hello, good morning
        - help: general help request
        - create_ticket: create ticket, report problem
        - check_ticket_status: check ticket status
        - faq: frequently asked questions, general information
        - contact_agent: talk to human, agent
        - goodbye: goodbye, end conversation
        - complaint: complaint, dissatisfaction
        - compliment: compliment, satisfaction
        - product_inquiry: product questions
        - order_status: order status
        - refund_request: refund request
        - technical_support: technical support
        - billing_inquiry: billing questions
        
        Respond with JSON containing:
        - "intent": detected intent
        - "confidence": confidence score (0-1)
        - "entities": extracted objects from text
        - "sentiment": general sentiment (positive, negative, neutral)`;

    return {
      system: systemPrompt,
      user: text
    };
  }

  // Construire le prompt pour l'extraction d'entités
  buildEntityExtractionPrompt(language) {
    return language === 'fr'
      ? `Extrait les entités importantes de ce texte. Cherche :
        - numéros (commandes, tickets, téléphone)
        - dates et heures
        - noms de produits
        - montants d'argent
        - emails
        - noms de personnes
        
        Réponds avec un JSON {"entities": {"type": "valeur"}}`
      : `Extract important entities from this text. Look for:
        - numbers (orders, tickets, phone)
        - dates and times
        - product names
        - money amounts
        - emails
        - person names
        
        Respond with JSON {"entities": {"type": "value"}}`;
  }

  // Construire le prompt pour la génération de réponse
  buildResponseGenerationPrompt(intent, entities, context, language) {
    const systemPrompt = language === 'fr'
      ? `Tu es un assistant client professionnel et bienveillant pour WhatsApp.
        
        Génère une réponse appropriée pour l'intention "${intent}".
        Utilise un ton amical mais professionnel.
        Sois concis et utile.
        Propose des actions concrètes quand c'est pertinent.`
      : `You are a professional and helpful customer assistant for WhatsApp.
        
        Generate an appropriate response for the intent "${intent}".
        Use a friendly but professional tone.
        Be concise and helpful.
        Suggest concrete actions when relevant.`;

    const userPrompt = `Intent: ${intent}
Entities: ${JSON.stringify(entities)}
Context: ${JSON.stringify(context)}`;

    return {
      system: systemPrompt,
      user: userPrompt
    };
  }

  // Normaliser le résultat d'analyse d'intent
  normalizeIntentResult(result, originalText, language) {
    return {
      intent: this.supportedIntents.includes(result.intent) ? result.intent : 'unknown',
      confidence: Math.max(0, Math.min(1, parseFloat(result.confidence) || 0)),
      entities: result.entities || {},
      sentiment: result.sentiment || 'neutral',
      originalText: originalText.substring(0, 200), // Limiter pour le cache
      language,
      timestamp: new Date().toISOString()
    };
  }

  // Analyse d'intent de fallback basée sur des mots-clés
  fallbackIntentAnalysis(text, language) {
    const lowerText = text.toLowerCase();
    
    const keywordMap = {
      greeting: ['bonjour', 'bonsoir', 'salut', 'hello', 'hi', 'good morning', 'good evening'],
      help: ['aide', 'aider', 'help', 'assistance', 'support'],
      create_ticket: ['problème', 'bug', 'erreur', 'problem', 'issue', 'error'],
      contact_agent: ['agent', 'humain', 'personne', 'human', 'person', 'representative'],
      goodbye: ['au revoir', 'bye', 'goodbye', 'merci', 'thank you'],
      complaint: ['mécontent', 'insatisfait', 'nul', 'mauvais', 'unhappy', 'bad', 'terrible']
    };

    for (const [intent, keywords] of Object.entries(keywordMap)) {
      for (const keyword of keywords) {
        if (lowerText.includes(keyword)) {
          return {
            intent,
            confidence: 0.6, // Confiance modérée pour le fallback
            entities: {},
            sentiment: 'neutral',
            originalText: text.substring(0, 200),
            language,
            timestamp: new Date().toISOString(),
            fallback: true
          };
        }
      }
    }

    return {
      intent: 'unknown',
      confidence: 0.1,
      entities: {},
      sentiment: 'neutral',
      originalText: text.substring(0, 200),
      language,
      timestamp: new Date().toISOString(),
      fallback: true
    };
  }

  // Détection rapide de langue par mots-clés
  quickLanguageDetection(text) {
    const lowerText = text.toLowerCase();
    
    const frenchWords = ['bonjour', 'merci', 'problème', 'aide', 'comment', 'pourquoi', 'quand'];
    const englishWords = ['hello', 'thank', 'problem', 'help', 'how', 'why', 'when'];
    
    const frenchCount = frenchWords.filter(word => lowerText.includes(word)).length;
    const englishCount = englishWords.filter(word => lowerText.includes(word)).length;
    
    if (frenchCount > englishCount && frenchCount > 0) return 'fr';
    if (englishCount > frenchCount && englishCount > 0) return 'en';
    
    return null;
  }

  // Créer un hash simple pour le cache
  hashText(text) {
    let hash = 0;
    for (let i = 0; i < text.length; i++) {
      const char = text.charCodeAt(i);
      hash = ((hash << 5) - hash) + char;
      hash = hash & hash; // Convert to 32-bit integer
    }
    return Math.abs(hash).toString(36);
  }

  // Vérifier la santé du service NLP
  async checkHealth() {
    try {
      const start = Date.now();
      
      // Test simple avec OpenRouter
      await this.openai.chat.completions.create({
        model: this.model,
        messages: [
          {
            role: 'user',
            content: 'Test'
          }
        ],
        max_tokens: 5
      });
      
      const duration = Date.now() - start;
      
      return {
        status: 'healthy',
        responseTime: `${duration}ms`,
        model: this.model,
        timestamp: new Date().toISOString()
      };
    } catch (error) {
      return {
        status: 'unhealthy',
        error: error.message,
        timestamp: new Date().toISOString()
      };
    }
  }
}

module.exports = NLPService;