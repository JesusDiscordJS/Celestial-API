// server.js (PARA SUA API NO RENDER)
import express from "express";
import mongoose from "mongoose";
import cors from "cors";
import dotenv from "dotenv";
import fetch from 'node-fetch';
import session from 'express-session';
import passport from 'passport';
import { Strategy as DiscordStrategy } from 'passport-discord';

dotenv.config(); // Carrega variáveis de ambiente do .env

// --- VERIFICAÇÕES CRÍTICAS DE VARIÁVEIS DE AMBIENTE ---
if (!process.env.MONGO_URI) {
  console.error("ERRO CRÍTICO: MONGO_URI não definida no .env. A aplicação não pode iniciar.");
  process.exit(1);
}
if (!process.env.DISCORD_BOT_TOKEN) {
    console.warn("AVISO: DISCORD_BOT_TOKEN não definido no .env. A busca de usuários ao vivo no Discord pode não funcionar.");
    // Não sair, pois a API pode funcionar para usuários já no DB
}
if (!process.env.DISCORD_CLIENT_ID || !process.env.DISCORD_CLIENT_SECRET || !process.env.CALLBACK_URL) {
  console.error("ERRO CRÍTICO: Variáveis de ambiente para OAuth2 do Discord (DISCORD_CLIENT_ID, DISCORD_CLIENT_SECRET, CALLBACK_URL) não estão completamente definidas. A aplicação não pode iniciar.");
  process.exit(1);
}
if (!process.env.SESSION_SECRET) {
  console.error("ERRO CRÍTICO: SESSION_SECRET não definida no .env. A aplicação não pode iniciar.");
  process.exit(1);
}
if (!process.env.FRONTEND_LOGIN_URL || !process.env.FRONTEND_DASHBOARD_URL) {
  console.error("ERRO CRÍTICO: FRONTEND_LOGIN_URL ou FRONTEND_DASHBOARD_URL não definidas no .env. Os redirecionamentos de autenticação falharão. Verifique as variáveis de ambiente no Render.");
  process.exit(1);
}
if (!process.env.FRONTEND_CORS_ORIGIN) {
  console.warn("AVISO: FRONTEND_CORS_ORIGIN não definido no .env. CORS pode não funcionar corretamente, impedindo o frontend de acessar a API.");
}
// --- FIM DAS VERIFICAÇÕES ---

const app = express();
const PORT = process.env.PORT || 3000;

// Configuração de CORS
app.use(cors({
  origin: process.env.FRONTEND_CORS_ORIGIN, // Ex: https://jesusdiscordjs.github.io
  credentials: true
}));

app.set('trust proxy', 1); // Essencial para secure cookies atrás de um proxy como o do Render

app.use(session({
  secret: process.env.SESSION_SECRET,
  resave: false,
  saveUninitialized: false,
  cookie: {
    maxAge: 1000 * 60 * 60 * 24 * 7, // 7 dias
    secure: true, // Requer HTTPS. Essencial para SameSite=None. Render fornece HTTPS.
    httpOnly: true,
    sameSite: 'none' // Necessário para cookies de sessão cross-site
  }
}));

app.use(passport.initialize());
app.use(passport.session());

passport.serializeUser((user, done) => {
  done(null, user);
});

passport.deserializeUser((user, done) => {
  done(null, user);
});

passport.use(new DiscordStrategy({
  clientID: process.env.DISCORD_CLIENT_ID,
  clientSecret: process.env.DISCORD_CLIENT_SECRET,
  callbackURL: process.env.CALLBACK_URL, // Ex: https://sua-api.onrender.com/auth/discord/callback
  scope: ['identify', 'email', 'guilds']
}, (accessToken, refreshToken, profile, done) => {
  return done(null, profile);
}));

mongoose.connect(process.env.MONGO_URI, { dbName: "discordAvatares" })
  .then(() => console.log("✅ MongoDB conectado com sucesso!"))
  .catch((err) => {
    console.error("❌ Erro ao conectar ao MongoDB:", err);
    process.exit(1);
  });

const avatarSchema = new mongoose.Schema({
  userId: { type: String, index: true, unique: true, required: true },
  usernames: { type: [String], default: [] },
  avatars: { type: [String], default: [] },
  lastJoinCall: { channelId: String, timestamp: Date },
  lastLeaveCall: { channelId: String, timestamp: Date },
}, { timestamps: true });
const AvatarModel = mongoose.model("Avatar", avatarSchema);

const isAuth = (req, res, next) => {
  if (req.isAuthenticated()) {
    return next();
  }
  res.status(401).json({ error: "Não autorizado. Por favor, faça login." });
};

// --- ROTAS DE AUTENTICAÇÃO ---
app.get('/auth/discord', passport.authenticate('discord'));

app.get('/auth/discord/callback', passport.authenticate('discord', {
  // Garanta que FRONTEND_LOGIN_URL está definida e é uma URL absoluta
  failureRedirect: `${process.env.FRONTEND_LOGIN_URL}?error=auth_failed`
}), (req, res) => {
  // Garanta que FRONTEND_DASHBOARD_URL está definida e é uma URL absoluta
  // O '|| \'\'' foi removido pois agora temos uma verificação no início que garante que a variável existe.
  res.redirect(process.env.FRONTEND_DASHBOARD_URL);
});

app.get('/auth/logout', (req, res, next) => {
  req.logout((err) => {
    if (err) { return next(err); }
    req.session.destroy((err) => {
      if (err) return next(err);
      res.clearCookie('connect.sid', { path: '/', sameSite: 'none', secure: true });
      // Garanta que FRONTEND_LOGIN_URL está definida
      res.status(200).json({ message: "Logout bem-sucedido", redirectTo: process.env.FRONTEND_LOGIN_URL });
    });
  });
});

app.get('/api/me', isAuth, (req, res) => {
  res.json({
    id: req.user.id,
    username: req.user.username,
    avatar: req.user.avatar,
    discriminator: req.user.discriminator
  });
});

// --- ROTA DA API DO TRACKER (Protegida) ---
app.get("/api/avatars/:id", isAuth, async (req, res) => {
  try {
    const requestedUserId = req.params.id;
    if (!/^\d{17,19}$/.test(requestedUserId)) {
        return res.status(400).json({ error: "Formato de ID inválido." });
    }
    let userFromDb = await AvatarModel.findOne({ userId: requestedUserId });
    if (!userFromDb) {
      if (!process.env.DISCORD_BOT_TOKEN) { // Verifica se o token do bot existe para busca ao vivo
        return res.status(404).json({ error: "Usuário não encontrado no banco de dados e a busca ao vivo no Discord está desabilitada (token do bot não configurado)." });
      }
      const discordApiUrl = `https://discord.com/api/v10/users/${requestedUserId}`;
      const discordResponse = await fetch(discordApiUrl, {
        method: 'GET',
        headers: { 'Authorization': `Bot ${process.env.DISCORD_BOT_TOKEN}`, 'User-Agent': 'CelestialUserTrackerAPI/1.0' }
      });
      if (!discordResponse.ok) {
        if (discordResponse.status === 404) return res.status(404).json({ error: "Usuário não encontrado no DB nem no Discord." });
        const errorText = await discordResponse.text();
        console.error(`Erro Discord API ao buscar usuário ${requestedUserId}: ${discordResponse.status} - ${errorText}`);
        return res.status(discordResponse.status).json({ error: `Erro ao consultar API do Discord: ${discordResponse.statusText || 'Erro desconhecido'}` });
      }
      const discordUserData = await discordResponse.json();
      const newUserRecordData = { userId: discordUserData.id, usernames: [discordUserData.username], avatars: [], lastJoinCall: null, lastLeaveCall: null };
      if (discordUserData.avatar) {
        newUserRecordData.avatars.push(`https://cdn.discordapp.com/avatars/${discordUserData.id}/${discordUserData.avatar}.${discordUserData.avatar.startsWith("a_") ? "gif" : "png"}?size=1024`);
      }
      userFromDb = await AvatarModel.create(newUserRecordData);
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
    if (!res.headersSent) {
      res.status(500).json({ error: "Erro interno ao processar a requisição do avatar." });
    }
  }
});

// --- ROTA RAIZ DA API ---
app.get('/', (req, res) => {
  res.json({ message: "🚀 API Celestial User Tracker está online e configurada para frontend separado!" });
});

// --- TRATAMENTO DE ERROS ---
// Handler para rotas não encontradas (404)
app.use((req, res, next) => {
  res.status(404).json({ error: "Endpoint da API não encontrado." });
});

// Handler para erros gerais (500)
app.use((err, req, res, next) => {
  console.error("Erro não tratado no servidor:", err.stack || err);
  // Evita enviar nova resposta se uma já foi enviada (ex: por um erro dentro de um stream)
  if (!res.headersSent) {
    res.status(500).json({ error: 'Ocorreu um erro inesperado na API.' });
  }
});

app.listen(PORT, () => {
  console.log(`🔊 Servidor API rodando na porta ${PORT}`);
});
