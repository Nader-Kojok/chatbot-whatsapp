# Agent WhatsApp Intelligent

Un agent WhatsApp intelligent pour le service client avec traitement du langage naturel (NLP) avancé, gestion des tickets, et interface interactive.

## 🚀 Fonctionnalités

### Fonctionnalités principales
- ✅ Système de réponses automatiques 24h/24 et 7j/7
- ✅ Interface interactive avec menus à boutons et options rapides
- ✅ Traitement du langage naturel (NLP) avancé avec OpenAI GPT-4
- ✅ Support multilingue (français et anglais)
- ✅ Détection automatique de la langue

### Fonctionnalités de support client
- ✅ Gestion complète des tickets (création, suivi, statuts)
- ✅ Mécanisme de transfert vers un agent humain
- ✅ Base de connaissances intégrée avec recherche intelligente
- ✅ Système de cache Redis pour les performances
- ✅ Logging complet et monitoring

### Architecture technique
- **Backend**: Node.js + Express.js
- **Base de données**: PostgreSQL avec Prisma ORM
- **Cache**: Redis
- **IA/NLP**: OpenRouter (Multi-model AI API)
- **API**: WhatsApp Business API
- **Monitoring**: Winston + logs structurés

## 📋 Prérequis

- Node.js 18+ et npm
- PostgreSQL 13+
- Redis 6+
- Compte WhatsApp Business API
- Clé API OpenAI
- Docker et Docker Compose (optionnel)

## 🛠️ Installation

### 1. Cloner le projet

```bash
git clone <repository-url>
cd whatsapp-webhook
```

### 2. Installer les dépendances

```bash
npm install
```

### 3. Configuration de l'environnement

Copiez le fichier d'exemple et configurez vos variables :

```bash
cp .env.example .env
```

Éditez le fichier `.env` avec vos configurations :

```env
# Configuration du serveur
PORT=3000
NODE_ENV=development
API_BASE_URL=http://localhost:3000

# WhatsApp Business API
WHATSAPP_TOKEN=your_whatsapp_access_token
WHATSAPP_PHONE_NUMBER_ID=your_phone_number_id
WHATSAPP_BUSINESS_ACCOUNT_ID=your_business_account_id
WHATSAPP_WEBHOOK_VERIFY_TOKEN=your_webhook_verify_token

# Base de données
DATABASE_URL="postgresql://username:password@localhost:5432/whatsapp_agent"

# Redis
REDIS_URL=redis://localhost:6379

# Google AI
GOOGLE_AI_API_KEY=your_google_ai_api_key
GOOGLE_AI_MODEL=gemini-1.5-flash

# JWT
JWT_SECRET=your_super_secret_jwt_key_here
```

### 4. Configuration de la base de données

```bash
# Générer le client Prisma
npm run db:generate

# Exécuter les migrations
npm run db:migrate

# (Optionnel) Ouvrir Prisma Studio
npm run db:studio
```

### 5. Démarrage de l'application

#### Développement
```bash
npm run dev
```

#### Production
```bash
npm start
```

## 🐳 Installation avec Docker

### Développement avec Docker Compose

```bash
# Démarrer tous les services
docker-compose up -d

# Voir les logs
docker-compose logs -f app

# Arrêter les services
docker-compose down
```

### Avec les outils de gestion (Adminer + Redis Commander)

```bash
# Démarrer avec les outils
docker-compose --profile tools up -d

# Accéder à Adminer (PostgreSQL): http://localhost:8080
# Accéder à Redis Commander: http://localhost:8081
```

## 📱 Configuration WhatsApp Business API

### 1. Créer une application Facebook

1. Allez sur [Facebook Developers](https://developers.facebook.com/)
2. Créez une nouvelle application
3. Ajoutez le produit "WhatsApp Business API"

### 2. Configurer le webhook

1. Dans la console Facebook, allez dans WhatsApp > Configuration
2. Configurez l'URL du webhook : `https://votre-domaine.com/webhook`
3. Token de vérification : utilisez la valeur de `WHATSAPP_WEBHOOK_VERIFY_TOKEN`
4. Abonnez-vous aux événements : `messages`

### 3. Obtenir les tokens

- **Access Token** : Généré dans la console Facebook
- **Phone Number ID** : ID du numéro de téléphone WhatsApp
- **Business Account ID** : ID du compte WhatsApp Business

## 🔧 Configuration OpenRouter

1. Créez un compte sur [OpenRouter](https://openrouter.ai/)
2. Générez une clé API dans votre dashboard
3. Ajoutez la clé dans votre fichier `.env` comme `OPENROUTER_API_KEY`
4. OpenRouter donne accès à plus de 400 modèles IA (OpenAI, Anthropic, Google, Meta, etc.)

## 📊 Utilisation

### Endpoints principaux

- **Webhook WhatsApp** : `POST /webhook`
- **Vérification webhook** : `GET /webhook`
- **Santé de l'application** : `GET /api/health`
- **Informations** : `GET /api/info`
- **Documentation** : `GET /api/docs`

### Test de l'application

```bash
# Vérifier la santé
curl http://localhost:3000/api/health

# Tester un message (développement uniquement)
curl -X POST http://localhost:3000/webhook/test \
  -H "Content-Type: application/json" \
  -d '{
    "phoneNumber": "+33123456789",
    "message": "Bonjour, j'ai besoin d'aide",
    "type": "text"
  }'
```

### Fonctionnalités disponibles par message

#### Commandes utilisateur
- **"Bonjour"** → Menu de bienvenue avec boutons
- **"Aide"** → Menu d'aide avec options
- **"Agent"** → Transfert vers un agent humain
- **"Ticket"** → Création d'un ticket de support
- **"FAQ"** → Recherche dans la base de connaissances

#### Gestion automatique
- Détection de la langue (français/anglais)
- Analyse de sentiment
- Classification des intentions
- Recherche dans la base de connaissances
- Création automatique de tickets
- Escalade selon la priorité

## 🗄️ Base de données

### Modèles principaux

- **User** : Utilisateurs WhatsApp
- **Conversation** : Sessions de chat
- **Message** : Historique des messages
- **Ticket** : Tickets de support
- **KnowledgeBase** : Base de connaissances/FAQ
- **Agent** : Agents humains
- **Intent** : Intentions NLP

### Commandes Prisma utiles

```bash
# Réinitialiser la base de données
npx prisma migrate reset

# Créer une nouvelle migration
npx prisma migrate dev --name nom_migration

# Déployer en production
npx prisma migrate deploy

# Voir les données
npx prisma studio
```

## 📝 Logs et Monitoring

### Fichiers de logs

- `logs/app.log` : Logs généraux
- `logs/error.log` : Erreurs uniquement
- `logs/http.log` : Requêtes HTTP

### Niveaux de log

- **error** : Erreurs critiques
- **warn** : Avertissements
- **info** : Informations générales
- **http** : Requêtes HTTP
- **debug** : Débogage (développement)

### Monitoring

```bash
# Suivre les logs en temps réel
tail -f logs/app.log

# Voir les erreurs
tail -f logs/error.log

# Statistiques de santé
curl http://localhost:3000/api/health
```

## 🚀 Déploiement

### Variables d'environnement de production

```env
NODE_ENV=production
PORT=3000
API_BASE_URL=https://votre-domaine.com

# Sécurité
JWT_SECRET=un_secret_très_sécurisé_et_long
WHATSAPP_APP_SECRET=votre_app_secret_facebook

# Performance
RATE_LIMIT_MAX_REQUESTS=1000
OPENAI_MAX_TOKENS=500

# Monitoring
SENTRY_DSN=votre_sentry_dsn
LOG_LEVEL=info
```

### Déploiement avec Docker

```bash
# Build de l'image
docker build -t whatsapp-agent .

# Lancement
docker run -d \
  --name whatsapp-agent \
  -p 3000:3000 \
  --env-file .env \
  whatsapp-agent
```

### Déploiement sur Railway/Render

1. Connectez votre repository GitHub
2. Configurez les variables d'environnement
3. Déployez automatiquement

## 🧪 Tests

```bash
# Lancer les tests
npm test

# Tests en mode watch
npm run test:watch

# Linting
npm run lint
npm run lint:fix
```

## 📚 Documentation API

Accédez à la documentation complète de l'API :

```
GET http://localhost:3000/api/docs
```

## 🔒 Sécurité

### Mesures implémentées

- ✅ Validation des signatures webhook WhatsApp
- ✅ Rate limiting par IP
- ✅ Validation des données d'entrée avec Joi
- ✅ Headers de sécurité avec Helmet
- ✅ Logs de sécurité pour les tentatives suspectes
- ✅ Chiffrement des données sensibles
- ✅ Utilisateur non-root dans Docker

### Bonnes pratiques

- Utilisez HTTPS en production
- Changez régulièrement les secrets
- Surveillez les logs de sécurité
- Limitez les permissions de base de données
- Sauvegardez régulièrement les données

## 🐛 Dépannage

### Problèmes courants

#### Erreur de connexion à la base de données
```bash
# Vérifier que PostgreSQL fonctionne
pg_isready -h localhost -p 5432

# Tester la connexion
npx prisma db pull
```

#### Erreur Redis
```bash
# Vérifier que Redis fonctionne
redis-cli ping

# Voir les logs Redis
docker-compose logs redis
```

#### Erreur WhatsApp API
```bash
# Vérifier les tokens
curl -H "Authorization: Bearer $WHATSAPP_TOKEN" \
  "https://graph.facebook.com/v18.0/$WHATSAPP_PHONE_NUMBER_ID"
```

#### Erreur Google AI
```bash
# Tester la clé API (remplacez YOUR_API_KEY par votre clé)
curl -H "x-goog-api-key: $GOOGLE_AI_API_KEY" \
  "https://generativelanguage.googleapis.com/v1/models"
```

### Logs de débogage

```bash
# Activer les logs de débogage
export LOG_LEVEL=debug
npm run dev

# Voir les requêtes Prisma
export DEBUG="prisma:query"
npm run dev
```

## 🤝 Contribution

1. Fork le projet
2. Créez une branche feature (`git checkout -b feature/nouvelle-fonctionnalite`)
3. Committez vos changements (`git commit -am 'Ajouter nouvelle fonctionnalité'`)
4. Push vers la branche (`git push origin feature/nouvelle-fonctionnalite`)
5. Créez une Pull Request

## 📄 Licence

Ce projet est sous licence MIT. Voir le fichier `LICENSE` pour plus de détails.

## 📞 Support

Pour toute question ou problème :

- 📧 Email : support@votre-domaine.com
- 📱 WhatsApp : +33 X XX XX XX XX
- 🐛 Issues : [GitHub Issues](https://github.com/votre-repo/issues)

## 🔄 Roadmap

### Version 1.1 (À venir)
- [ ] Interface d'administration web
- [ ] Intégration CRM (Salesforce, HubSpot)
- [ ] Analytics avancées
- [ ] Support vocal (transcription)

### Version 1.2 (Futur)
- [ ] Multi-canal (SMS, Email, Telegram)
- [ ] IA personnalisée par entreprise
- [ ] API publique
- [ ] White-label

---

**Développé avec ❤️ pour améliorer l'expérience client**