# Utiliser l'image Node.js officielle
FROM node:18-alpine

# Définir le répertoire de travail
WORKDIR /app

# Installer les dépendances système nécessaires
RUN apk add --no-cache \
    python3 \
    make \
    g++ \
    openssl \
    openssl-dev \
    && rm -rf /var/cache/apk/*

# Définir les variables d'environnement pour OpenSSL
ENV OPENSSL_CONF=/dev/null

# Copier les fichiers de dépendances
COPY package*.json ./
COPY prisma ./prisma/

# Installer les dépendances
RUN npm ci --only=production

# Générer le client Prisma
RUN npx prisma generate

# Copier le code source
COPY src ./src/
COPY test-server.js ./

# Créer un utilisateur non-root
RUN addgroup -g 1001 -S nodejs
RUN adduser -S nodejs -u 1001

# Créer le dossier de logs et donner les permissions
RUN mkdir -p /app/logs && chown -R nodejs:nodejs /app

# Changer vers l'utilisateur non-root
USER nodejs

# Exposer le port
EXPOSE 3000

# Définir les variables d'environnement par défaut
ENV NODE_ENV=production
ENV PORT=3000

# Commande de santé
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
    CMD node -e "require('http').get('http://localhost:3000/health', (res) => { process.exit(res.statusCode === 200 ? 0 : 1) })"

# Commande de démarrage
CMD ["npm", "start"]