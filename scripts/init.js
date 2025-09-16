#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');
const readline = require('readline');

// Configuration des couleurs pour les logs
const colors = {
  reset: '\x1b[0m',
  bright: '\x1b[1m',
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  magenta: '\x1b[35m',
  cyan: '\x1b[36m'
};

const log = {
  info: (msg) => console.log(`${colors.blue}ℹ${colors.reset} ${msg}`),
  success: (msg) => console.log(`${colors.green}✓${colors.reset} ${msg}`),
  warning: (msg) => console.log(`${colors.yellow}⚠${colors.reset} ${msg}`),
  error: (msg) => console.log(`${colors.red}✗${colors.reset} ${msg}`),
  title: (msg) => console.log(`\n${colors.bright}${colors.cyan}${msg}${colors.reset}\n`)
};

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout
});

function question(prompt) {
  return new Promise((resolve) => {
    rl.question(prompt, resolve);
  });
}

function execCommand(command, description) {
  try {
    log.info(`${description}...`);
    execSync(command, { stdio: 'inherit' });
    log.success(`${description} terminé`);
  } catch (error) {
    log.error(`Erreur lors de ${description.toLowerCase()}: ${error.message}`);
    process.exit(1);
  }
}

function checkPrerequisites() {
  log.title('🔍 Vérification des prérequis');
  
  const requirements = [
    { command: 'node --version', name: 'Node.js', minVersion: '18.0.0' },
    { command: 'npm --version', name: 'npm' },
    { command: 'git --version', name: 'Git' }
  ];

  for (const req of requirements) {
    try {
      const version = execSync(req.command, { encoding: 'utf8' }).trim();
      log.success(`${req.name}: ${version}`);
    } catch (error) {
      log.error(`${req.name} n'est pas installé ou accessible`);
      process.exit(1);
    }
  }
}

function createEnvFile() {
  log.title('📝 Configuration du fichier .env');
  
  const envExamplePath = path.join(process.cwd(), '.env.example');
  const envPath = path.join(process.cwd(), '.env');
  
  if (fs.existsSync(envPath)) {
    log.warning('Le fichier .env existe déjà');
    return;
  }
  
  if (!fs.existsSync(envExamplePath)) {
    log.error('Le fichier .env.example est introuvable');
    return;
  }
  
  fs.copyFileSync(envExamplePath, envPath);
  log.success('Fichier .env créé à partir de .env.example');
  log.warning('⚠️  N\'oubliez pas de configurer vos variables d\'environnement dans le fichier .env');
}

async function configureEnvironment() {
  log.title('⚙️  Configuration de l\'environnement');
  
  const envPath = path.join(process.cwd(), '.env');
  let envContent = fs.readFileSync(envPath, 'utf8');
  
  log.info('Configuration des variables essentielles...');
  
  // Configuration de base
  const port = await question('Port du serveur (3000): ') || '3000';
  envContent = envContent.replace(/PORT=.*/g, `PORT=${port}`);
  
  const nodeEnv = await question('Environnement (development/production) [development]: ') || 'development';
  envContent = envContent.replace(/NODE_ENV=.*/g, `NODE_ENV=${nodeEnv}`);
  
  // Base de données
  log.info('\n📊 Configuration de la base de données PostgreSQL:');
  const dbHost = await question('Host PostgreSQL (localhost): ') || 'localhost';
  const dbPort = await question('Port PostgreSQL (5432): ') || '5432';
  const dbName = await question('Nom de la base de données (whatsapp_agent): ') || 'whatsapp_agent';
  const dbUser = await question('Utilisateur PostgreSQL (postgres): ') || 'postgres';
  const dbPassword = await question('Mot de passe PostgreSQL: ');
  
  const databaseUrl = `postgresql://${dbUser}:${dbPassword}@${dbHost}:${dbPort}/${dbName}?schema=public`;
  envContent = envContent.replace(/DATABASE_URL=.*/g, `DATABASE_URL="${databaseUrl}"`);
  
  // Redis
  log.info('\n🔴 Configuration de Redis:');
  const redisHost = await question('Host Redis (localhost): ') || 'localhost';
  const redisPort = await question('Port Redis (6379): ') || '6379';
  const redisPassword = await question('Mot de passe Redis (optionnel): ');
  
  let redisUrl = `redis://${redisHost}:${redisPort}`;
  if (redisPassword) {
    redisUrl = `redis://:${redisPassword}@${redisHost}:${redisPort}`;
  }
  envContent = envContent.replace(/REDIS_URL=.*/g, `REDIS_URL=${redisUrl}`);
  
  // OpenRouter
  log.info('\n🤖 Configuration OpenRouter:');
  const openrouterKey = await question('Clé API OpenRouter: ');
  if (openrouterKey) {
    envContent = envContent.replace(/OPENROUTER_API_KEY=.*/g, `OPENROUTER_API_KEY=${openrouterKey}`);
  }
  
  // WhatsApp
  log.info('\n📱 Configuration WhatsApp Business API:');
  log.warning('Vous pouvez configurer ces valeurs plus tard dans le fichier .env');
  const whatsappToken = await question('Token WhatsApp (optionnel): ');
  if (whatsappToken) {
    envContent = envContent.replace(/WHATSAPP_TOKEN=.*/g, `WHATSAPP_TOKEN=${whatsappToken}`);
  }
  
  // JWT Secret
  const jwtSecret = require('crypto').randomBytes(64).toString('hex');
  envContent = envContent.replace(/JWT_SECRET=.*/g, `JWT_SECRET=${jwtSecret}`);
  
  fs.writeFileSync(envPath, envContent);
  log.success('Configuration sauvegardée dans .env');
}

function installDependencies() {
  log.title('📦 Installation des dépendances');
  execCommand('npm install', 'Installation des dépendances npm');
}

function setupDatabase() {
  log.title('🗄️  Configuration de la base de données');
  
  try {
    execCommand('npx prisma generate', 'Génération du client Prisma');
    execCommand('npx prisma migrate dev --name init', 'Exécution des migrations');
    log.success('Base de données configurée avec succès');
  } catch (error) {
    log.warning('Erreur lors de la configuration de la base de données');
    log.info('Vous pouvez configurer la base de données manuellement plus tard avec:');
    log.info('  npx prisma generate');
    log.info('  npx prisma migrate dev');
  }
}

function createDirectories() {
  log.title('📁 Création des dossiers nécessaires');
  
  const directories = ['logs', 'uploads', 'backups'];
  
  for (const dir of directories) {
    const dirPath = path.join(process.cwd(), dir);
    if (!fs.existsSync(dirPath)) {
      fs.mkdirSync(dirPath, { recursive: true });
      log.success(`Dossier ${dir} créé`);
    } else {
      log.info(`Dossier ${dir} existe déjà`);
    }
  }
}

function createGitignore() {
  log.title('📋 Configuration Git');
  
  const gitignorePath = path.join(process.cwd(), '.gitignore');
  
  if (fs.existsSync(gitignorePath)) {
    log.info('.gitignore existe déjà');
    return;
  }
  
  const gitignoreContent = `# Dependencies
node_modules/
npm-debug.log*
yarn-debug.log*
yarn-error.log*

# Environment variables
.env
.env.local
.env.development.local
.env.test.local
.env.production.local

# Logs
logs/
*.log

# Runtime data
pids
*.pid
*.seed
*.pid.lock

# Coverage directory used by tools like istanbul
coverage/

# nyc test coverage
.nyc_output

# Dependency directories
node_modules/
jspm_packages/

# Optional npm cache directory
.npm

# Optional REPL history
.node_repl_history

# Output of 'npm pack'
*.tgz

# Yarn Integrity file
.yarn-integrity

# dotenv environment variables file
.env

# IDE files
.vscode/
.idea/
*.swp
*.swo
*~

# OS generated files
.DS_Store
.DS_Store?
._*
.Spotlight-V100
.Trashes
ehthumbs.db
Thumbs.db

# Uploads
uploads/

# Backups
backups/

# Prisma
prisma/migrations/

# Docker
.dockerignore
`;
  
  fs.writeFileSync(gitignorePath, gitignoreContent);
  log.success('.gitignore créé');
}

function showNextSteps() {
  log.title('🎉 Installation terminée!');
  
  console.log(`${colors.bright}Prochaines étapes:${colors.reset}\n`);
  
  console.log(`1. ${colors.cyan}Configurer WhatsApp Business API:${colors.reset}`);
  console.log('   - Créez une application Facebook Developer');
  console.log('   - Configurez le webhook: http://votre-domaine.com/webhook');
  console.log('   - Ajoutez les tokens dans le fichier .env\n');
  
  console.log(`2. ${colors.cyan}Démarrer l\'application:${colors.reset}`);
  console.log('   npm run dev     # Mode développement');
  console.log('   npm start       # Mode production\n');
  
  console.log(`3. ${colors.cyan}Tester l\'application:${colors.reset}`);
  console.log('   curl http://localhost:3000/api/health\n');
  
  console.log(`4. ${colors.cyan}Outils utiles:${colors.reset}`);
  console.log('   npm run db:studio    # Interface Prisma');
  console.log('   docker-compose up    # Démarrage avec Docker');
  console.log('   npm run lint         # Vérification du code\n');
  
  console.log(`${colors.yellow}📚 Documentation complète: README.md${colors.reset}`);
  console.log(`${colors.yellow}🔧 Configuration: .env${colors.reset}`);
  console.log(`${colors.yellow}🏗️  Architecture: ARCHITECTURE.md${colors.reset}\n`);
}

async function main() {
  console.log(`${colors.bright}${colors.magenta}`);
  console.log('╔══════════════════════════════════════════════════════════════╗');
  console.log('║                                                              ║');
  console.log('║            🤖 Agent WhatsApp Intelligent                     ║');
  console.log('║                                                              ║');
  console.log('║              Script d\'initialisation                        ║');
  console.log('║                                                              ║');
  console.log('╚══════════════════════════════════════════════════════════════╝');
  console.log(colors.reset);
  
  try {
    checkPrerequisites();
    createEnvFile();
    
    const shouldConfigure = await question('\nVoulez-vous configurer l\'environnement maintenant? (y/N): ');
    if (shouldConfigure.toLowerCase() === 'y' || shouldConfigure.toLowerCase() === 'yes') {
      await configureEnvironment();
    }
    
    installDependencies();
    createDirectories();
    createGitignore();
    
    const shouldSetupDb = await question('\nVoulez-vous configurer la base de données maintenant? (y/N): ');
    if (shouldSetupDb.toLowerCase() === 'y' || shouldSetupDb.toLowerCase() === 'yes') {
      setupDatabase();
    }
    
    showNextSteps();
    
  } catch (error) {
    log.error(`Erreur lors de l'initialisation: ${error.message}`);
    process.exit(1);
  } finally {
    rl.close();
  }
}

if (require.main === module) {
  main();
}

module.exports = {
  checkPrerequisites,
  createEnvFile,
  installDependencies,
  setupDatabase,
  createDirectories
};