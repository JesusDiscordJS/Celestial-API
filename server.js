// server.js (Backend API - Completo com Discord OAuth2 e JWT)
require('dotenv').config(); // Carrega variáveis do .env no início

const express = require('express');
const { MongoClient, Long } = require('mongodb');
const cors = require('cors');
const jwt = require('jsonwebtoken');
const axios = require('axios');
const cookieParser = require('cookie-parser');
const querystring = require('querystring');

// --- Configuração ---
const MONGO_URI = process.env.MONGO_URI;
const DB_NAME = process.env.DB_NAME;
const COLLECTION_NAME = "users"; // Coleção de dados dos usuários rastreados
const PORT = process.env.PORT || 3000;

// Configurações do Discord OAuth2 e JWT (do .env)
const DISCORD_CLIENT_ID = process.env.DISCORD_CLIENT_ID;
const DISCORD_CLIENT_SECRET = process.env.DISCORD_CLIENT_SECRET;
const DISCORD_REDIRECT_URI = process.env.DISCORD_REDIRECT_URI;
const JWT_SECRET = process.env.JWT_SECRET;
const FRONTEND_URL = process.env.FRONTEND_URL;

// Listas de IDs para controle de acesso (do .env)
const ADMIN_DISCORD_IDS = (process.env.ADMIN_DISCORD_IDS || "").split(',').map(id => id.trim()).filter(id => id);
const PREMIUM_DISCORD_IDS = (process.env.PREMIUM_DISCORD_IDS || "").split(',').map(id => id.trim()).filter(id => id);

// --- Inicialização do App Express ---
const app = express();

// --- Middlewares ---
app.use(cors({
    origin: FRONTEND_URL, // Permite requisições apenas do seu frontend
    credentials: true
}));
app.use(express.json());
app.use(cookieParser());

// --- Conexão com o MongoDB ---
let db;
let usersCollection;

MongoClient.connect(MONGO_URI)
    .then(client => {
        console.log('✅ Conectado com sucesso ao MongoDB!');
        db = client.db(DB_NAME);
        usersCollection = db.collection(COLLECTION_NAME);
    })
    .catch(error => {
        console.error('❌ Erro ao conectar ao MongoDB:', error);
        process.exit(1);
    });

// --- Funções Auxiliares de Conversão de Tipos BSON ---
function convertBsonTypeToString(value) {
    if (!value && typeof value !== 'number') return value; // Permite 0 mas não null/undefined
    if (value && value.$numberLong && typeof value.$numberLong === 'string') {
        return value.$numberLong;
    } else if (value && typeof value === 'object' && value._bsontype === 'Long' && typeof value.toString === 'function') {
        return value.toString();
    } else if (typeof value === 'number' || typeof value === 'string') {
        return value.toString();
    }
    return value; // Fallback
}

function convertBsonDateToTimestamp(value) {
    if (!value) return value;
    if (value && typeof value === 'object' && value.$date) {
        if (value.$date.$numberLong && typeof value.$date.$numberLong === 'string') {
            return parseInt(value.$date.$numberLong, 10);
        } else if (typeof value.$date === 'string') {
            return new Date(value.$date).getTime();
        }
    } else if (value instanceof Date) { // Se já for um objeto Date do driver MongoDB
        return value.getTime();
    }
    return value; // Fallback
}

// --- Função Auxiliar para Converter Documentos MongoDB para JSON Simples ---
function convertUserDocument(doc) {
    if (!doc) return doc;
    const newDoc = { ...doc }; // Shallow copy

    // _id (ObjectId)
    if (newDoc._id && typeof newDoc._id.toString === 'function') {
        newDoc._id = newDoc._id.toString();
    }

    // user_id (Long)
    if (newDoc.user_id) {
        newDoc.user_id = convertBsonTypeToString(newDoc.user_id);
    }

    // servers array
    if (newDoc.servers && Array.isArray(newDoc.servers)) {
        newDoc.servers = newDoc.servers.map(server => {
            const newServer = { ...server };
            if (newServer.guild_id) {
                newServer.guild_id = convertBsonTypeToString(newServer.guild_id);
            }
            if (newServer.first_message_at) {
                newServer.first_message_at = convertBsonDateToTimestamp(newServer.first_message_at);
            }
            if (newServer.last_message_at) {
                newServer.last_message_at = convertBsonDateToTimestamp(newServer.last_message_at);
            }
            return newServer;
        });
    }

    // history array
    if (newDoc.history && Array.isArray(newDoc.history)) {
        newDoc.history = newDoc.history.map(histEntry => {
            const newHistEntry = { ...histEntry };
            if (newHistEntry.changed_at) {
                newHistEntry.changed_at = convertBsonDateToTimestamp(newHistEntry.changed_at);
            }
            // Conversão para campos dentro de 'changes', se necessário (ex: server_joined)
            const serverChangeKey = newHistEntry.changes && newHistEntry.changes.server_joined ? 'server_joined' : (newHistEntry.changes && newHistEntry.changes.server ? 'server' : null);
            if (serverChangeKey && newHistEntry.changes[serverChangeKey]) {
                const serverChangeData = { ...newHistEntry.changes[serverChangeKey] };
                if (serverChangeData.guild_id) {
                    serverChangeData.guild_id = convertBsonTypeToString(serverChangeData.guild_id);
                }
                if (serverChangeData.first_seen) { // Assumindo que pode ser uma data
                    serverChangeData.first_seen = convertBsonDateToTimestamp(serverChangeData.first_seen);
                }
                if (serverChangeData.first_message_at) { // Consistência
                    serverChangeData.first_message_at = convertBsonDateToTimestamp(serverChangeData.first_message_at);
                }
                newHistEntry.changes[serverChangeKey] = serverChangeData;
            }
            return newHistEntry;
        });
    }

    // Datas principais do documento
    if (newDoc.first_seen_overall_at) {
        newDoc.first_seen_overall_at = convertBsonDateToTimestamp(newDoc.first_seen_overall_at);
    }
    if (newDoc.last_seen_overall_at) {
        newDoc.last_seen_overall_at = convertBsonDateToTimestamp(newDoc.last_seen_overall_at);
    }

    // recent_messages array
    if (newDoc.recent_messages && Array.isArray(newDoc.recent_messages)) {
        newDoc.recent_messages = newDoc.recent_messages.map(msg => {
            const newMsg = { ...msg };
            if (newMsg.guild_id) newMsg.guild_id = convertBsonTypeToString(newMsg.guild_id);
            if (newMsg.message_id) newMsg.message_id = convertBsonTypeToString(newMsg.message_id);
            if (newMsg.timestamp) newMsg.timestamp = convertBsonDateToTimestamp(newMsg.timestamp);
            // image_url é string, não precisa de conversão especial de tipo BSON
            return newMsg;
        });
    }

    // message_image_history array (NOVO)
    if (newDoc.message_image_history && Array.isArray(newDoc.message_image_history)) {
        newDoc.message_image_history = newDoc.message_image_history.map(imgEntry => {
            const newImgEntry = { ...imgEntry };
            if (newImgEntry.guild_id) newImgEntry.guild_id = convertBsonTypeToString(newImgEntry.guild_id);
            if (newImgEntry.message_id) newImgEntry.message_id = convertBsonTypeToString(newImgEntry.message_id);
            if (newImgEntry.timestamp) newImgEntry.timestamp = convertBsonDateToTimestamp(newImgEntry.timestamp);
            // imgEntry.url e content_snippet são strings
            return newImgEntry;
        });
    }

    return newDoc;
}

// --- Rotas de Autenticação com Discord ---
app.get('/auth/discord', (req, res) => {
    const scopes = ['identify', 'email', 'guilds'].join(' '); // Adicione 'guilds' se precisar verificar em quais servers o user está
    const discordAuthUrl = `https://discord.com/api/oauth2/authorize?client_id=${DISCORD_CLIENT_ID}&redirect_uri=${encodeURIComponent(DISCORD_REDIRECT_URI)}&response_type=code&scope=${encodeURIComponent(scopes)}`;
    res.redirect(discordAuthUrl);
});

app.get('/auth/discord/callback', async (req, res) => {
    const code = req.query.code;
    if (!code) {
        return res.redirect(`${FRONTEND_URL}/dashboard.html?error=discord_auth_denied_or_failed`);
    }

    try {
        const tokenResponse = await axios.post('https://discord.com/api/oauth2/token',
            querystring.stringify({
                client_id: DISCORD_CLIENT_ID,
                client_secret: DISCORD_CLIENT_SECRET,
                grant_type: 'authorization_code',
                code: code,
                redirect_uri: DISCORD_REDIRECT_URI,
            }), {
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        });

        const accessToken = tokenResponse.data.access_token;

        const userResponse = await axios.get('https://discord.com/api/users/@me', {
            headers: { Authorization: `Bearer ${accessToken}` },
        });

        const discordUser = userResponse.data;
        const discordId = discordUser.id;

        let userRole = 'free';
        if (ADMIN_DISCORD_IDS.includes(discordId)) {
            userRole = 'admin';
        } else if (PREMIUM_DISCORD_IDS.includes(discordId)) {
            userRole = 'premium';
        }
        
        // Opcional: Atualizar/criar registro do usuário no seu DB com dados do Discord
        // Ex: await usersCollection.updateOne({ discord_id_field: discordId }, { $set: { discord_username: discordUser.username, last_discord_login: new Date() } }, { upsert: true });
        // Nota: A sua coleção 'users' atual usa 'user_id' que parece ser um Long gerado pelo seu bot.
        // Você precisaria decidir como associar o login Discord a esses registros existentes ou criar um novo campo 'discord_id_field'.

        const appTokenPayload = {
            discordId: discordId,
            username: discordUser.username,
            avatar: discordUser.avatar ? `https://cdn.discordapp.com/avatars/${discordId}/${discordUser.avatar}.png` : null,
            role: userRole,
        };

        const appToken = jwt.sign(appTokenPayload, JWT_SECRET, { expiresIn: '7d' });

        res.redirect(`${FRONTEND_URL}/dashboard.html?token=${appToken}`);

    } catch (error) {
        console.error('Erro no callback do Discord OAuth2:', error.response ? error.response.data : error.message);
        res.redirect(`${FRONTEND_URL}/dashboard.html?error=discord_callback_error`);
    }
});

// --- Middleware de Autenticação (será usado nas próximas etapas) ---
// const requireAuth = (req, res, next) => {
//     const authHeader = req.headers.authorization;
//     if (authHeader && authHeader.startsWith('Bearer ')) {
//         const token = authHeader.substring(7, authHeader.length);
//         jwt.verify(token, JWT_SECRET, (err, decodedToken) => {
//             if (err) {
//                 return res.status(401).json({ error: 'Token inválido ou expirado.' });
//             }
//             req.user = decodedToken; // Adiciona dados do usuário decodificados à requisição
//             next();
//         });
//     } else {
//         res.status(401).json({ error: 'Token de autenticação não fornecido.' });
//     }
// };

// const checkRole = (roles) => {
//     return (req, res, next) => {
//         if (!req.user || !roles.includes(req.user.role)) {
//             return res.status(403).json({ error: 'Acesso proibido para esta função.' });
//         }
//         next();
//     };
// };

// --- Rotas da API Existentes ---
app.get('/', (req, res) => {
    res.json({ message: "Bem-vindo à API do Celestial Tracker. Use /auth/discord para login." });
});

// Exemplo: Rota para buscar dados do usuário logado (protegida)
// app.get('/auth/me', requireAuth, (req, res) => {
//     // req.user foi adicionado pelo middleware requireAuth
//     res.json({ user: req.user });
// });

app.get('/users', /* requireAuth, */ async (req, res) => { // Adicionar requireAuth quando o frontend estiver pronto
    if (!usersCollection) {
        return res.status(503).json({ error: "Serviço indisponível: MongoDB não conectado." });
    }
    try {
        const usersArray = await usersCollection.find().toArray();
        const simplifiedUsers = usersArray.map(user => convertUserDocument(user));
        res.json(simplifiedUsers);
    } catch (error) {
        console.error("Erro ao buscar usuários:", error);
        res.status(500).json({ error: "Erro interno ao buscar usuários.", details: error.message });
    }
});

app.get('/users/:userIdStr', /* requireAuth, */ async (req, res) => { // Adicionar requireAuth
    if (!usersCollection) {
        return res.status(503).json({ error: "Serviço indisponível: MongoDB não conectado." });
    }
    const userIdStr = req.params.userIdStr;
    try {
        // A busca aqui é pelo user_id do seu sistema, não pelo discordId diretamente,
        // a menos que você altere a lógica para buscar pelo discordId após o login.
        const userIdQuery = Long.fromString(userIdStr);
        let user = await usersCollection.findOne({ user_id: userIdQuery });

        if (user) {
            const simplifiedUser = convertUserDocument(user);
            res.json(simplifiedUser);
        } else {
            res.status(404).json({ error: `Usuário com ID '${userIdStr}' não encontrado.` });
        }
    } catch (error) {
        console.error(`Erro ao buscar usuário ${userIdStr}:`, error);
        if (error.message && (error.message.includes("is not a valid string representation of a Long") || error.message.toLowerCase().includes("out of range") || error.message.toLowerCase().includes("non-hex character"))) {
             return res.status(400).json({ error: `ID de usuário inválido na URL: '${userIdStr}'.` });
        }
        res.status(500).json({ error: "Erro interno ao buscar usuário.", details: error.message });
    }
});

app.get('/users/:userIdStr/history/nicknames', /* requireAuth, */ async (req, res) => { // Adicionar requireAuth
    if (!usersCollection) {
        return res.status(503).json({ error: "Serviço indisponível: MongoDB não conectado." });
    }
    const userIdStr = req.params.userIdStr;
    try {
        const userIdQuery = Long.fromString(userIdStr);
        const projection = { projection: { _id: 0, user_id: 1, current_username_global: 1, username_global_history: 1 } };
        const userFromDb = await usersCollection.findOne({ user_id: userIdQuery }, projection);

        if (userFromDb) {
            res.json({
                user_id: convertBsonTypeToString(userFromDb.user_id),
                current_username_global: userFromDb.current_username_global,
                username_global_history: userFromDb.username_global_history || []
            });
        } else {
            res.status(404).json({ error: `Usuário com ID '${userIdStr}' não encontrado.` });
        }
    } catch (error) {
        console.error(`Erro ao buscar histórico de nomes para ${userIdStr}:`, error);
        if (error.message && (error.message.includes("is not a valid string representation of a Long") || error.message.toLowerCase().includes("out of range") || error.message.toLowerCase().includes("non-hex character"))) {
            return res.status(400).json({ error: `ID de usuário inválido na URL: '${userIdStr}'.` });
        }
        res.status(500).json({ error: "Erro interno ao buscar histórico de nomes.", details: error.message });
    }
});


// --- Iniciar o Servidor ---
app.listen(PORT, () => {
    console.log(`🚀 Servidor Node.js da API rodando na porta ${PORT}`);
    console.log(`🔗 Acessível localmente em: http://localhost:${PORT}`);
    if (process.env.RENDER_EXTERNAL_URL) {
        console.log(`🔗 Deploy no Render acessível em: ${process.env.RENDER_EXTERNAL_URL}`);
    }
    console.log(`🔑 Admin Discord IDs: ${ADMIN_DISCORD_IDS.join(', ') || 'Nenhum configurado'}`);
    console.log(`⭐ Premium Discord IDs: ${PREMIUM_DISCORD_IDS.join(', ') || 'Nenhum configurado'}`);
    console.log(`🔗 Frontend URL para redirecionamento: ${FRONTEND_URL}`);
    console.log(`🔗 Discord Redirect URI configurada: ${DISCORD_REDIRECT_URI}`);
});
