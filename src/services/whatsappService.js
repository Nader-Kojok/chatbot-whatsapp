const axios = require('axios');
const crypto = require('crypto');
const logger = require('../utils/logger');
const { WhatsAppError } = require('../middleware/errorMiddleware');

class WhatsAppService {
  constructor() {
    this.accessToken = process.env.WHATSAPP_TOKEN;
    this.phoneNumberId = process.env.WHATSAPP_PHONE_NUMBER_ID;
    this.businessAccountId = process.env.WHATSAPP_BUSINESS_ACCOUNT_ID;
    this.webhookVerifyToken = process.env.WHATSAPP_WEBHOOK_VERIFY_TOKEN;
    this.apiVersion = process.env.WHATSAPP_API_VERSION || 'v18.0';
    this.baseURL = `https://graph.facebook.com/${this.apiVersion}`;
    
    // Configuration axios
    this.client = axios.create({
      baseURL: this.baseURL,
      timeout: 10000,
      headers: {
        'Authorization': `Bearer ${this.accessToken}`,
        'Content-Type': 'application/json'
      }
    });

    // Intercepteur pour logger les requêtes
    this.client.interceptors.request.use(
      (config) => {
        logger.debug('WhatsApp API Request', {
          method: config.method,
          url: config.url,
          data: config.data
        });
        return config;
      },
      (error) => {
        logger.error('WhatsApp API Request Error', error);
        return Promise.reject(error);
      }
    );

    // Intercepteur pour logger les réponses
    this.client.interceptors.response.use(
      (response) => {
        logger.debug('WhatsApp API Response', {
          status: response.status,
          data: response.data
        });
        return response;
      },
      (error) => {
        const whatsappError = this.handleAPIError(error);
        logger.error('WhatsApp API Response Error', whatsappError);
        return Promise.reject(whatsappError);
      }
    );
  }

  // Gérer les erreurs de l'API WhatsApp
  handleAPIError(error) {
    if (error.response) {
      const { status, data } = error.response;
      const errorCode = data?.error?.code;
      const errorMessage = data?.error?.message || 'Erreur API WhatsApp';
      
      return new WhatsAppError(errorMessage, status, errorCode);
    } else if (error.request) {
      return new WhatsAppError('Pas de réponse de l\'API WhatsApp', 503);
    } else {
      return new WhatsAppError(`Erreur de configuration: ${error.message}`, 500);
    }
  }

  // Vérifier la signature du webhook
  verifyWebhookSignature(payload, signature) {
    try {
      const expectedSignature = crypto
        .createHmac('sha256', process.env.WHATSAPP_APP_SECRET)
        .update(payload)
        .digest('hex');
      
      const signatureHash = signature.replace('sha256=', '');
      
      return crypto.timingSafeEqual(
        Buffer.from(expectedSignature, 'hex'),
        Buffer.from(signatureHash, 'hex')
      );
    } catch (error) {
      logger.error('Erreur de vérification de signature webhook:', error);
      return false;
    }
  }

  // Vérifier le token de vérification du webhook
  verifyWebhookToken(token) {
    return token === this.webhookVerifyToken;
  }

  // Envoyer un message texte
  async sendTextMessage(to, message, previewUrl = false) {
    try {
      const payload = {
        messaging_product: 'whatsapp',
        to: to,
        type: 'text',
        text: {
          body: message,
          preview_url: previewUrl
        }
      };

      const response = await this.client.post(`/${this.phoneNumberId}/messages`, payload);
      
      logger.logWhatsApp('Message Sent', {
        to,
        messageId: response.data.messages[0].id,
        type: 'text'
      });

      return response.data;
    } catch (error) {
      logger.error('Erreur envoi message texte:', error);
      throw error;
    }
  }

  // Envoyer un message avec boutons interactifs
  async sendInteractiveMessage(to, bodyText, buttons, headerText = null, footerText = null) {
    try {
      const interactive = {
        type: 'button',
        body: { text: bodyText },
        action: {
          buttons: buttons.map((button, index) => ({
            type: 'reply',
            reply: {
              id: button.id || `btn_${index}`,
              title: button.title
            }
          }))
        }
      };

      if (headerText) {
        interactive.header = { type: 'text', text: headerText };
      }

      if (footerText) {
        interactive.footer = { text: footerText };
      }

      const payload = {
        messaging_product: 'whatsapp',
        to: to,
        type: 'interactive',
        interactive
      };

      const response = await this.client.post(`/${this.phoneNumberId}/messages`, payload);
      
      logger.logWhatsApp('Interactive Message Sent', {
        to,
        messageId: response.data.messages[0].id,
        type: 'interactive',
        buttonsCount: buttons.length
      });

      return response.data;
    } catch (error) {
      logger.error('Erreur envoi message interactif:', error);
      throw error;
    }
  }

  // Envoyer un message avec liste de sélection
  async sendListMessage(to, bodyText, buttonText, sections, headerText = null, footerText = null) {
    try {
      const interactive = {
        type: 'list',
        body: { text: bodyText },
        action: {
          button: buttonText,
          sections: sections.map(section => ({
            title: section.title,
            rows: section.rows.map(row => ({
              id: row.id,
              title: row.title,
              description: row.description || ''
            }))
          }))
        }
      };

      if (headerText) {
        interactive.header = { type: 'text', text: headerText };
      }

      if (footerText) {
        interactive.footer = { text: footerText };
      }

      const payload = {
        messaging_product: 'whatsapp',
        to: to,
        type: 'interactive',
        interactive
      };

      const response = await this.client.post(`/${this.phoneNumberId}/messages`, payload);
      
      logger.logWhatsApp('List Message Sent', {
        to,
        messageId: response.data.messages[0].id,
        type: 'list',
        sectionsCount: sections.length
      });

      return response.data;
    } catch (error) {
      logger.error('Erreur envoi message liste:', error);
      throw error;
    }
  }

  // Envoyer un message template
  async sendTemplateMessage(to, templateName, languageCode = 'fr', components = []) {
    try {
      const payload = {
        messaging_product: 'whatsapp',
        to: to,
        type: 'template',
        template: {
          name: templateName,
          language: { code: languageCode },
          components: components
        }
      };

      const response = await this.client.post(`/${this.phoneNumberId}/messages`, payload);
      
      logger.logWhatsApp('Template Message Sent', {
        to,
        messageId: response.data.messages[0].id,
        templateName,
        languageCode
      });

      return response.data;
    } catch (error) {
      logger.error('Erreur envoi message template:', error);
      throw error;
    }
  }

  // Marquer un message comme lu
  async markMessageAsRead(messageId) {
    try {
      const payload = {
        messaging_product: 'whatsapp',
        status: 'read',
        message_id: messageId
      };

      const response = await this.client.post(`/${this.phoneNumberId}/messages`, payload);
      
      logger.logWhatsApp('Message Marked as Read', {
        messageId
      });

      return response.data;
    } catch (error) {
      logger.error('Erreur marquage message lu:', error);
      throw error;
    }
  }

  // Obtenir les informations d'un média
  async getMediaInfo(mediaId) {
    try {
      const response = await this.client.get(`/${mediaId}`);
      return response.data;
    } catch (error) {
      logger.error('Erreur récupération info média:', error);
      throw error;
    }
  }

  // Télécharger un média
  async downloadMedia(mediaUrl) {
    try {
      const response = await axios.get(mediaUrl, {
        headers: {
          'Authorization': `Bearer ${this.accessToken}`
        },
        responseType: 'stream'
      });
      
      return response.data;
    } catch (error) {
      logger.error('Erreur téléchargement média:', error);
      throw error;
    }
  }

  // Obtenir le profil d'un utilisateur
  async getUserProfile(phoneNumber) {
    try {
      const response = await this.client.get(`/${phoneNumber}/profile`, {
        params: {
          fields: 'name'
        }
      });
      
      return response.data;
    } catch (error) {
      logger.error('Erreur récupération profil utilisateur:', error);
      throw error;
    }
  }

  // Vérifier la santé de l'API WhatsApp
  async checkAPIHealth() {
    try {
      const start = Date.now();
      await this.client.get(`/${this.phoneNumberId}`);
      const duration = Date.now() - start;
      
      return {
        status: 'healthy',
        responseTime: `${duration}ms`,
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

  // Parser un message entrant
  parseIncomingMessage(webhookData) {
    try {
      const entry = webhookData.entry?.[0];
      const changes = entry?.changes?.[0];
      const value = changes?.value;
      
      if (!value) {
        return null;
      }

      // Messages
      if (value.messages) {
        const message = value.messages[0];
        const contact = value.contacts?.[0];
        
        return {
          type: 'message',
          messageId: message.id,
          from: message.from,
          timestamp: parseInt(message.timestamp),
          messageType: message.type,
          content: this.extractMessageContent(message),
          contact: {
            name: contact?.profile?.name || null,
            phoneNumber: contact?.wa_id || message.from
          }
        };
      }

      // Statuts de message
      if (value.statuses) {
        const status = value.statuses[0];
        
        return {
          type: 'status',
          messageId: status.id,
          recipientId: status.recipient_id,
          status: status.status,
          timestamp: parseInt(status.timestamp)
        };
      }

      return null;
    } catch (error) {
      logger.error('Erreur parsing message entrant:', error);
      throw error;
    }
  }

  // Extraire le contenu d'un message selon son type
  extractMessageContent(message) {
    switch (message.type) {
      case 'text':
        return {
          text: message.text.body
        };
      
      case 'interactive':
        if (message.interactive.type === 'button_reply') {
          return {
            buttonId: message.interactive.button_reply.id,
            buttonTitle: message.interactive.button_reply.title
          };
        } else if (message.interactive.type === 'list_reply') {
          return {
            listId: message.interactive.list_reply.id,
            listTitle: message.interactive.list_reply.title,
            listDescription: message.interactive.list_reply.description
          };
        }
        break;
      
      case 'image':
      case 'audio':
      case 'video':
      case 'document':
        return {
          mediaId: message[message.type].id,
          mimeType: message[message.type].mime_type,
          caption: message[message.type].caption || null
        };
      
      case 'location':
        return {
          latitude: message.location.latitude,
          longitude: message.location.longitude,
          name: message.location.name || null,
          address: message.location.address || null
        };
      
      default:
        return {
          raw: message
        };
    }
  }
}

module.exports = WhatsAppService;