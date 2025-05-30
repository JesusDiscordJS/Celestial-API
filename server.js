// server.js
import express from "express";
import mongoose from "mongoose";
import cors from "cors";
import dotenv from "dotenv";
import fetch from 'node-fetch';
import session from 'express-session';
import passport from 'passport';
import { Strategy as DiscordStrategy } from 'passport-discord';

dotenv.config();

// --- VERIFICAÇÕES CRÍTICAS DE VARIÁVEIS DE AMBIENTE ---
if (!process.env.MONGO_URI) {
  console.error("ERRO CRÍTICO: MONGO_URI não definida no .env. A aplicação não pode iniciar.");
  process.exit(1);
}
if (!process.env.DISCORD_BOT_TOKEN) {
    console.warn("AVISO: DISCORD_BOT_TOKEN não definido no .env. A busca de usuários ao vivo no Discord pode não funcionar ou ser limitada.");
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

app.use(cors({
  origin: process.env.FRONTEND_CORS_ORIGIN,
  credentials: true
}));

app.set('trust proxy', 1);

app.use(session({
  secret: process.env.SESSION_SECRET,
  resave: false,
  saveUninitialized: false,
  cookie: {
    maxAge: 1000 * 60 * 60 * 24 * 7, // 7 dias
    secure: true,
    httpOnly: true,
    sameSite: 'none'
  }
}));

app.use(passport.initialize());
app.use(passport.session());

passport.serializeUser((userData, done) => {
  done(null, userData);
});

passport.deserializeUser((userData, done) => {
  done(null, userData);
});

passport.use(new DiscordStrategy({
  clientID: process.env.DISCORD_CLIENT_ID,
  clientSecret: process.env.DISCORD_CLIENT_SECRET,
  callbackURL: process.env.CALLBACK_URL,
  scope: ['identify', 'email', 'guilds', 'relationships.read']
}, (accessToken, refreshToken, profile, done) => {
  return done(null, { accessToken, profile });
}));

// --- CONEXÃO COM MONGODB E DEFINIÇÃO DE ESQUEMA ---
// Conectando ao banco de dados usado pelo bot Python
mongoose.connect(process.env.MONGO_URI, { dbName: "tracker_db" }) // ATENÇÃO: dbName deve ser 'tracker_db'
  .then(() => console.log("✅ MongoDB conectado com sucesso ao banco 'tracker_db'!"))
  .catch((err) => {
    console.error("❌ Erro ao conectar ao MongoDB:", err);
    process.exit(1);
  });

// Esquema para informações de servidor (subdocumento)
const serverInfoSchema = new mongoose.Schema({
  guild_id: String,
  guild_name: String,
  first_seen: Date
}, { _id: false });

// Esquema para as alterações dentro de uma entrada de histórico (subdocumento)
const historyChangeSchema = new mongoose.Schema({
  username_global: String,
  avatar_url: String,
  banner_url: String,
  nickname_added: String,
  server_joined: serverInfoSchema
}, { _id: false });

// Esquema para uma entrada no histórico (subdocumento)
const historyEntrySchema = new mongoose.Schema({
  changed_at: Date,
  changes: historyChangeSchema
}, { _id: false });

// Esquema principal do usuário, alinhado com o bot Python
const userTrackerSchema = new mongoose.Schema({
  user_id: { type: String, index: true, unique: true, required: true }, // Consistente com o bot
  username_global: String,
  avatar_urls: { type: [String], default: [] },
  banner_urls: { type: [String], default: [] },
  nicknames: { type: [String], default: [] },
  servers: { type: [serverInfoSchema], default: [] },
  history: { type: [historyEntrySchema], default: [] }
}, { timestamps: true }); // timestamps: true adiciona createdAt e updatedAt

// O modelo agora se refere à coleção "users" (nome da coleção usado pelo bot Python)
const UserTrackerModel = mongoose.model("UserTracker", userTrackerSchema, "users");

// --- MIDDLEWARE DE AUTENTICAÇÃO ---
const isAuth = (req, res, next) => {
  if (req.isAuthenticated()) {
    return next();
  }
  res.status(401).json({ error: "Não autorizado. Por favor, faça login." });
};

// --- ROTAS DE AUTENTICAÇÃO ---
app.get('/auth/discord', passport.authenticate('discord'));

app.get('/auth/discord/callback', passport.authenticate('discord', {
  failureRedirect: `${process.env.FRONTEND_LOGIN_URL}?error=auth_failed`
}), (req, res) => {
  res.redirect(process.env.FRONTEND_DASHBOARD_URL);
});

app.get('/auth/logout', (req, res, next) => {
  req.logout((err) => {
    if (err) { return next(err); }
    req.session.destroy((err) => {
      if (err) return next(err);
      res.clearCookie('connect.sid', { path: '/', sameSite: 'none', secure: true });
      res.status(200).json({ message: "Logout bem-sucedido", redirectTo: process.env.FRONTEND_LOGIN_URL });
    });
  });
});

app.get('/api/me', isAuth, (req, res) => {
  if (!req.user || !req.user.profile) {
    return res.status(500).json({ error: "Dados de usuário incompletos na sessão." });
  }
  const profile = req.user.profile;
  res.json({
    id: profile.id,
    username: profile.username,
    avatar: profile.avatar,
    discriminator: profile.discriminator,
    global_name: profile.global_name // Adicionado para novos usernames
  });
});

app.get('/api/me/friends', isAuth, async (req, res) => {
  if (!req.user || !req.user.accessToken) {
    return res.status(401).json({ error: "Access token não encontrado. Por favor, refaça o login." });
  }
  try {
    const discordApiUrl = `https://discord.com/api/v10/users/@me/relationships`;
    const response = await fetch(discordApiUrl, {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${req.user.accessToken}`,
        'User-Agent': 'CelestialUserTrackerAPI/1.0 (Friends Feature)'
      }
    });
    if (!response.ok) {
      const errorData = await response.json().catch(() => ({ message: response.statusText }));
      console.error(`Erro ao buscar amigos do Discord para usuário ${req.user.profile.id}: ${response.status}`, errorData);
      return res.status(response.status).json({ error: `Erro ao buscar amigos do Discord: ${errorData.message || response.statusText}` });
    }
    const relationships = await response.json();
    const friends = relationships
      .filter(rel => rel.type === 1)
      .map(friendRel => ({
        id: friendRel.id,
        username: friendRel.user.username,
        discriminator: friendRel.user.discriminator,
        avatar: friendRel.user.avatar,
        global_name: friendRel.user.global_name // Adicionado para novos usernames
      }));
    res.json(friends);
  } catch (error) {
    console.error(`Erro interno ao buscar amigos para ${req.user.profile.id}:`, error);
    res.status(500).json({ error: "Erro interno ao processar a lista de amigos." });
  }
});

// --- ROTA DA API DO TRACKER (MODIFICADA) ---
app.get("/api/avatars/:id", isAuth, async (req, res) => {
  try {
    const requestedUserId = req.params.id;
    // IDs do Discord são numéricos e geralmente têm entre 17 e 19 dígitos (pode ser 20 em casos raros no futuro)
    if (!/^\d{17,20}$/.test(requestedUserId)) {
        return res.status(400).json({ error: "Formato de ID de usuário inválido." });
    }

    // Busca no MongoDB usando o novo modelo e o campo 'user_id'
    let userFromDb = await UserTrackerModel.findOne({ user_id: requestedUserId });

    if (!userFromDb) {
      // Se o usuário não for encontrado no DB, tenta buscar na API do Discord (fallback)
      if (!process.env.DISCORD_BOT_TOKEN) {
        return res.status(404).json({
          error: "Usuário não encontrado no banco de dados. A busca ao vivo no Discord está desabilitada (token do bot não configurado)."
        });
      }

      console.log(`Usuário ${requestedUserId} não encontrado no DB. Buscando na API do Discord...`);
      const discordApiUrl = `https://discord.com/api/v10/users/${requestedUserId}`;
      const discordResponse = await fetch(discordApiUrl, {
        method: 'GET',
        headers: {
          'Authorization': `Bot ${process.env.DISCORD_BOT_TOKEN}`,
          'User-Agent': 'CelestialUserTrackerAPI/1.0 (FallbackUserFetch)'
        }
      });

      if (!discordResponse.ok) {
        if (discordResponse.status === 404) {
          return res.status(404).json({ error: "Usuário não encontrado no DB nem via API do Discord." });
        }
        const errorText = await discordResponse.text().catch(() => `Status ${discordResponse.status}`);
        console.error(`Erro ao buscar usuário ${requestedUserId} na API do Discord: ${discordResponse.status} - ${errorText}`);
        return res.status(discordResponse.status).json({
          error: `Erro ao consultar API do Discord: ${discordResponse.statusText || 'Erro desconhecido'}`
        });
      }

      const discordUserData = await discordResponse.json();
      const globalUsername = discordUserData.global_name || discordUserData.username; // Prioriza global_name
      const fullUsername = discordUserData.discriminator && discordUserData.discriminator !== "0"
        ? `${discordUserData.username}#${discordUserData.discriminator}`
        : globalUsername; // Username que o bot python geralmente salva como str(member)

      const newUserRecordData = {
        user_id: discordUserData.id,
        username_global: fullUsername,
        avatar_urls: [],
        banner_urls: [],
        nicknames: [],
        servers: [], // O bot Python populará isso com mais detalhes
        history: [{ // Adiciona uma entrada inicial ao histórico
            changed_at: new Date(),
            changes: {
                username_global: fullUsername,
                ...(discordUserData.avatar && { avatar_url: `https://cdn.discordapp.com/avatars/${discordUserData.id}/${discordUserData.avatar}.${discordUserData.avatar.startsWith("a_") ? "gif" : "png"}?size=1024` })
            }
        }]
      };

      if (discordUserData.avatar) {
        newUserRecordData.avatar_urls.push(
          `https://cdn.discordapp.com/avatars/${discordUserData.id}/${discordUserData.avatar}.${discordUserData.avatar.startsWith("a_") ? "gif" : "png"}?size=1024`
        );
      }
      if (discordUserData.banner) { // Banner de perfil global do usuário
        newUserRecordData.banner_urls.push(
          `https://cdn.discordapp.com/banners/${discordUserData.id}/${discordUserData.banner}.${discordUserData.banner.startsWith("a_") ? "gif" : "png"}?size=1024`
        );
      }

      console.log(`Criando novo registro para ${requestedUserId} no DB a partir dos dados da API do Discord.`);
      userFromDb = await UserTrackerModel.create(newUserRecordData);
      console.log(`Novo registro para ${requestedUserId} criado com sucesso.`);
    }

    // Retorna os dados completos do usuário conforme o novo esquema
    res.json({
      user_id: userFromDb.user_id,
      username_global: userFromDb.username_global,
      avatar_urls: userFromDb.avatar_urls || [],
      banner_urls: userFromDb.banner_urls || [],
      nicknames: userFromDb.nicknames || [],
      servers: userFromDb.servers || [],
      history: userFromDb.history || [],
      createdAt: userFromDb.createdAt,
      updatedAt: userFromDb.updatedAt
    });

  } catch (err) {
    console.error(`Erro GERAL na rota /api/avatars/${req.params.id}:`, err);
    if (!res.headersSent) {
      res.status(500).json({ error: "Erro interno ao processar a requisição do usuário." });
    }
  }
});

// --- ROTA RAIZ DA API ---
app.get('/', (req, res) => {
  res.json({ message: "🚀 API Celestial User Tracker está online e configurada para frontend separado!" });
});

// --- TRATAMENTO DE ERROS ---
app.use((req, res, next) => {
  res.status(404).json({ error: "Endpoint da API não encontrado." });
});
app.use((err, req, res, next) => {
  console.error("Erro não tratado no servidor:", err.stack || err);
  if (!res.headersSent) {
    res.status(500).json({ error: 'Ocorreu um erro inesperado na API.' });
  }
});

app.listen(PORT, () => {
  console.log(`🔊 Servidor API rodando na porta ${PORT}`);
});
