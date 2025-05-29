// server.js
import express from "express";
import mongoose from "mongoose";
import cors from "cors";
import dotenv from "dotenv";
import fetch from 'node-fetch';
import session from 'express-session';
import passport from 'passport';
import { Strategy as DiscordStrategy } from 'passport-discord';
import path from 'path';
import { fileURLToPath } from 'url';

// Configuração para __dirname em ES Modules
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

dotenv.config();

// --- CONFIGURAÇÃO DO APP E VARIÁVEIS ---
const app = express();
const PORT = process.env.PORT || 3000;

const frontendUrl = process.env.FRONTEND_URL || `http://localhost:${PORT}`; // Para CORS, se necessário no futuro

app.use(cors({
  origin: frontendUrl, // Ajuste se o frontend estiver em um domínio totalmente separado
  credentials: true
}));

// --- SESSÃO E AUTENTICAÇÃO (PASSPORT) ---
if (!process.env.SESSION_SECRET) {
  console.error("ERRO: SESSION_SECRET não definida no .env. A aplicação não pode iniciar com segurança.");
  process.exit(1);
}
app.use(session({
  secret: process.env.SESSION_SECRET,
  resave: false,
  saveUninitialized: false,
  cookie: {
    maxAge: 1000 * 60 * 60 * 24 * 7 // 7 dias de sessão
    // secure: process.env.NODE_ENV === 'production', // Use true em produção com HTTPS
    // httpOnly: true,
    // sameSite: 'lax' // ou 'strict'
  }
  // Para produção, considere usar um session store persistente como connect-mongo
}));

app.use(passport.initialize());
app.use(passport.session());

passport.serializeUser((user, done) => {
  // 'user' aqui é o 'profile' retornado pela DiscordStrategy
  done(null, user); // Salva o perfil completo do Discord na sessão
});

passport.deserializeUser(async (user, done) => {
  // 'user' aqui é o perfil completo que foi salvo na sessão
  // Não precisamos buscar na API do Discord novamente a cada request se já temos o perfil
  done(null, user);
});


if (!process.env.DISCORD_CLIENT_ID || !process.env.DISCORD_CLIENT_SECRET || !process.env.CALLBACK_URL) {
  console.error("ERRO: Variáveis de ambiente para OAuth2 do Discord (CLIENT_ID, CLIENT_SECRET, CALLBACK_URL) não estão completamente definidas.");
  // Considere não iniciar o app ou desabilitar as rotas de auth
}

passport.use(new DiscordStrategy({
  clientID: process.env.DISCORD_CLIENT_ID,
  clientSecret: process.env.DISCORD_CLIENT_SECRET,
  callbackURL: process.env.CALLBACK_URL,
  scope: ['identify', 'email', 'guilds'] // Escopos comuns: identify (obrigatório), email, guilds
}, (accessToken, refreshToken, profile, done) => {
  // 'profile' contém os dados do usuário do Discord.
  // profile.id, profile.username, profile.discriminator, profile.avatar, profile.email, profile.guilds etc.
  // Você poderia verificar/salvar/atualizar o usuário no seu DB aqui se necessário.
  // Por exemplo, para associar o login do Discord a um usuário interno do seu sistema.
  // Para este tracker, o perfil do Discord na sessão é suficiente por enquanto.
  return done(null, profile); // Passa o perfil para serializeUser
}));

// --- CONEXÃO COM MONGODB ---
if (!process.env.MONGO_URI) {
  console.error("ERRO: MONGO_URI não definida no .env. A aplicação não pode iniciar.");
  process.exit(1);
}
mongoose.connect(process.env.MONGO_URI, { dbName: "discordAvatares" })
  .then(() => console.log("✅ MongoDB conectado com sucesso!"))
  .catch((err) => {
    console.error("❌ Erro ao conectar ao MongoDB:", err);
    process.exit(1);
  });

// --- SCHEMAS E MODELOS ---
const avatarSchema = new mongoose.Schema({
  userId: { type: String, index: true, unique: true, required: true },
  usernames: { type: [String], default: [] },
  avatars: { type: [String], default: [] },
  lastJoinCall: { channelId: String, timestamp: Date },
  lastLeaveCall: { channelId: String, timestamp: Date },
}, { timestamps: true });
const AvatarModel = mongoose.model("Avatar", avatarSchema);

// --- MIDDLEWARE DE AUTENTICAÇÃO ---
const isAuth = (req, res, next) => {
  if (req.isAuthenticated()) { // passport adiciona isAuthenticated() ao objeto req
    return next();
  }
  res.status(401).json({ error: "Não autorizado. Por favor, faça login." });
};

// --- ROTAS DE AUTENTICAÇÃO ---
app.get('/auth/discord', passport.authenticate('discord')); // Inicia o fluxo OAuth2

app.get('/auth/discord/callback', passport.authenticate('discord', {
  failureRedirect: '/?error=authfailed' // Redireciona para a pág. de login com erro
}), (req, res) => {
  // Sucesso na autenticação
  res.redirect('/dashboard.html'); // Redireciona para a dashboard
});

app.get('/auth/logout', (req, res, next) => {
  req.logout((err) => {
    if (err) { return next(err); }
    req.session.destroy((err) => {
      if (err) {
        return next(err);
      }
      res.clearCookie('connect.sid'); // Nome padrão do cookie da sessão do express-session
      res.redirect('/'); // Redireciona para a página de login
    });
  });
});

// Rota para o frontend verificar se está logado e obter dados do usuário
app.get('/api/me', isAuth, (req, res) => {
  // req.user é o perfil do Discord populado pelo Passport
  res.json({
    id: req.user.id,
    username: req.user.username,
    avatar: req.user.avatar,
    discriminator: req.user.discriminator // Se ainda usar, senão pode remover
  });
});

// --- ROTA DA API DO TRACKER (Protegida) ---
app.get("/api/avatars/:id", isAuth, async (req, res) => {
  try {
    const requestedUserId = req.params.id;
    if (!/^\d{17,19}$/.test(requestedUserId)) {
        return res.status(400).json({ error: "Formato de ID de usuário inválido." });
    }
    let userFromDb = await AvatarModel.findOne({ userId: requestedUserId });

    if (!userFromDb) {
      console.log(`Usuário ${requestedUserId} não encontrado no DB. Buscando no Discord...`);
      if (!process.env.DISCORD_BOT_TOKEN) {
        console.warn("AVISO: DISCORD_BOT_TOKEN não está configurado.");
        return res.status(404).json({ error: "Usuário não encontrado no banco de dados local e busca ao vivo desabilitada (sem token de bot)." });
      }
      const discordApiUrl = `https://discord.com/api/v10/users/${requestedUserId}`;
      const discordResponse = await fetch(discordApiUrl, {
        method: 'GET',
        headers: { 'Authorization': `Bot ${process.env.DISCORD_BOT_TOKEN}`, 'User-Agent': 'CelestialUserTrackerAPI/1.0' }
      });

      if (!discordResponse.ok) {
        if (discordResponse.status === 404) return res.status(404).json({ error: "Usuário não encontrado no banco de dados local nem no Discord." });
        const errorText = await discordResponse.text();
        console.error(`Erro ao buscar usuário ${requestedUserId} do Discord: ${discordResponse.status} - ${discordResponse.statusText}. Detalhes: ${errorText}`);
        return res.status(discordResponse.status).json({ error: `Erro ao consultar a API do Discord: ${discordResponse.statusText}` });
      }
      const discordUserData = await discordResponse.json();
      const newUserRecordData = {
        userId: discordUserData.id,
        usernames: [discordUserData.username],
        avatars: [],
        lastJoinCall: null,
        lastLeaveCall: null,
      };
      if (discordUserData.avatar) {
        newUserRecordData.avatars.push(`https://cdn.discordapp.com/avatars/${discordUserData.id}/${discordUserData.avatar}.${discordUserData.avatar.startsWith("a_") ? "gif" : "png"}?size=1024`);
      }
      try {
        userFromDb = await AvatarModel.create(newUserRecordData);
        console.log(`Usuário ${requestedUserId} (não estava no DB) foi buscado do Discord e salvo.`);
      } catch (dbError) {
        console.error(`Erro ao salvar o novo usuário ${requestedUserId} no DB:`, dbError);
        return res.status(500).json({ error: "Usuário encontrado no Discord, mas falha ao salvar no banco de dados local." });
      }
    }
    res.json({
      userId: userFromDb.userId,
      usernames: userFromDb.usernames || [],
      avatars: userFromDb.avatars || [],
      lastJoinCall: userFromDb.lastJoinCall,
      lastLeaveCall: userFromDb.lastLeaveCall,
      createdAt: userFromDb.createdAt,
      updatedAt: userFromDb.updatedAt,
    });
  } catch (err) {
    console.error(`Erro GERAL na rota /api/avatars/${req.params.id}:`, err);
    if (!res.headersSent) { // Evita erro se já enviou resposta (ex: por !discordResponse.ok)
      res.status(500).json({ error: "Erro interno desconhecido no servidor." });
    }
  }
});

// --- ROTAS PARA SERVIR ARQUIVOS DO FRONTEND ---
app.use(express.static(path.join(__dirname, 'public')));

app.get('/', (req, res) => {
  if (req.isAuthenticated()) {
    res.redirect('/dashboard.html');
  } else {
    res.sendFile(path.join(__dirname, 'public', 'index.html')); // Página de Login
  }
});

// Redireciona para dashboard se tentar acessar /dashboard.html sem estar logado e a rota raiz falhar
app.get('/dashboard.html', isAuth, (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'dashboard.html'));
});


// --- TRATAMENTO DE ERROS E INICIAR SERVIDOR ---
app.use((req, res, next) => {
  res.status(404).sendFile(path.join(__dirname, 'public', '404.html')); // Crie um 404.html se quiser
});
app.use((err, req, res, next) => {
  console.error("Erro não tratado:", err.stack || err);
  res.status(500).json({ error: 'Ocorreu um erro inesperado no servidor.' });
});

app.listen(PORT, () => {
  console.log(`🔊 Servidor API rodando na porta ${PORT}`);
});
