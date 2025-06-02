// server.js (Backend API - Completo com Discord OAuth2, JWT, Painel Admin e proteção de rotas)
require('dotenv').config();

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
const COLLECTION_NAME = "users";
const PORT = process.env.PORT || 3000;

const DISCORD_CLIENT_ID = process.env.DISCORD_CLIENT_ID;
const DISCORD_CLIENT_SECRET = process.env.DISCORD_CLIENT_SECRET;
const DISCORD_REDIRECT_URI = process.env.DISCORD_REDIRECT_URI; // URI de callback da API
const JWT_SECRET = process.env.JWT_SECRET;

const CORS_ALLOWED_ORIGIN = process.env.CORS_ALLOWED_ORIGIN; // Ex: https://jesusdiscordjs.github.io
const FRONTEND_DASHBOARD_REDIRECT_URL = process.env.FRONTEND_DASHBOARD_REDIRECT_URL; // Ex: https://jesusdiscordjs.github.io/Celestial/dashboard.html

const ADMIN_DISCORD_IDS = (process.env.ADMIN_DISCORD_IDS || "").split(',').map(id => id.trim()).filter(id => id);
const PREMIUM_DISCORD_IDS = (process.env.PREMIUM_DISCORD_IDS || "").split(',').map(id => id.trim()).filter(id => id);

const app = express();

// --- Validação Crítica de Variáveis de Ambiente ---
if (!MONGO_URI || !DB_NAME || !CORS_ALLOWED_ORIGIN || !FRONTEND_DASHBOARD_REDIRECT_URL || !JWT_SECRET || !DISCORD_CLIENT_ID || !DISCORD_CLIENT_SECRET || !DISCORD_REDIRECT_URI) {
    console.error("FATAL ERROR: Uma ou mais variáveis de ambiente CRÍTICAS não estão definidas!");
    console.log({
        MONGO_URI_DEFINED: !!MONGO_URI,
        DB_NAME_DEFINED: !!DB_NAME,
        CORS_ALLOWED_ORIGIN_DEFINED: !!CORS_ALLOWED_ORIGIN,
        FRONTEND_DASHBOARD_REDIRECT_URL_DEFINED: !!FRONTEND_DASHBOARD_REDIRECT_URL,
        JWT_SECRET_DEFINED: !!JWT_SECRET,
        DISCORD_CLIENT_ID_DEFINED: !!DISCORD_CLIENT_ID,
        DISCORD_CLIENT_SECRET_DEFINED: !!DISCORD_CLIENT_SECRET,
        DISCORD_REDIRECT_URI_DEFINED: !!DISCORD_REDIRECT_URI
    });
    process.exit(1); // Impede o servidor de iniciar sem essas configurações cruciais
}

// --- Middlewares ---
app.use(cors({
    origin: CORS_ALLOWED_ORIGIN,
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
            const parsedDate = new Date(value.$date);
            return !isNaN(parsedDate.getTime()) ? parsedDate.getTime() : value.$date;
        }
    } else if (value instanceof Date) {
        return value.getTime();
    }
    return value; // Fallback
}

function convertUserDocument(doc) {
    if (!doc) return doc;
    const newDoc = { ...doc };

    if (newDoc._id && typeof newDoc._id.toString === 'function') {
        newDoc._id = newDoc._id.toString();
    }
    if (newDoc.user_id) {
        newDoc.user_id = convertBsonTypeToString(newDoc.user_id);
    }

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

    if (newDoc.history && Array.isArray(newDoc.history)) {
        newDoc.history = newDoc.history.map(histEntry => {
            const newHistEntry = { ...histEntry };
            if (newHistEntry.changed_at) {
                newHistEntry.changed_at = convertBsonDateToTimestamp(newHistEntry.changed_at);
            }
            const serverChangeKey = newHistEntry.changes && newHistEntry.changes.server_joined ? 'server_joined' : (newHistEntry.changes && newHistEntry.changes.server ? 'server' : null);
            if (serverChangeKey && newHistEntry.changes[serverChangeKey]) {
                const serverChangeData = { ...newHistEntry.changes[serverChangeKey] };
                if (serverChangeData.guild_id) {
                    serverChangeData.guild_id = convertBsonTypeToString(serverChangeData.guild_id);
                }
                if (serverChangeData.first_seen) {
                    serverChangeData.first_seen = convertBsonDateToTimestamp(serverChangeData.first_seen);
                }
                if (serverChangeData.first_message_at) {
                    serverChangeData.first_message_at = convertBsonDateToTimestamp(serverChangeData.first_message_at);
                }
                newHistEntry.changes[serverChangeKey] = serverChangeData;
            }
            return newHistEntry;
        });
    }

    if (newDoc.first_seen_overall_at) {
        newDoc.first_seen_overall_at = convertBsonDateToTimestamp(newDoc.first_seen_overall_at);
    }
    if (newDoc.last_seen_overall_at) {
        newDoc.last_seen_overall_at = convertBsonDateToTimestamp(newDoc.last_seen_overall_at);
    }

    if (newDoc.recent_messages && Array.isArray(newDoc.recent_messages)) {
        newDoc.recent_messages = newDoc.recent_messages.map(msg => {
            const newMsg = { ...msg };
            if (newMsg.guild_id) newMsg.guild_id = convertBsonTypeToString(newMsg.guild_id);
            if (newMsg.message_id) newMsg.message_id = convertBsonTypeToString(newMsg.message_id);
            if (newMsg.timestamp) newMsg.timestamp = convertBsonDateToTimestamp(newMsg.timestamp);
            return newMsg;
        });
    }
    if (newDoc.message_image_history && Array.isArray(newDoc.message_image_history)) {
        newDoc.message_image_history = newDoc.message_image_history.map(imgEntry => {
            const newImgEntry = { ...imgEntry };
            if (newImgEntry.guild_id) newImgEntry.guild_id = convertBsonTypeToString(newImgEntry.guild_id);
            if (newImgEntry.message_id) newImgEntry.message_id = convertBsonTypeToString(newImgEntry.message_id);
            if (newImgEntry.timestamp) newImgEntry.timestamp = convertBsonDateToTimestamp(newImgEntry.timestamp);
            return newImgEntry;
        });
    }

    // --- MODIFIED: Add processing for 'instagram' field ---
    if (newDoc.instagram && Array.isArray(newDoc.instagram)) {
        newDoc.instagram = newDoc.instagram.map(instaEntry => {
            const newInstaEntry = { ...instaEntry }; // Shallow copy each entry
            if (newInstaEntry.timestamp) {
                newInstaEntry.timestamp = convertBsonDateToTimestamp(newInstaEntry.timestamp);
            }
            // Assuming IDs like postedByUserId, messageId, guildId, channelId are already strings
            // as saved by the bot. If conversion were needed:
            // if (newInstaEntry.postedByUserId) newInstaEntry.postedByUserId = convertBsonTypeToString(newInstaEntry.postedByUserId);
            // if (newInstaEntry.messageId) newInstaEntry.messageId = convertBsonTypeToString(newInstaEntry.messageId);
            // if (newInstaEntry.guildId) newInstaEntry.guildId = convertBsonTypeToString(newInstaEntry.guildId);
            // if (newInstaEntry.channelId) newInstaEntry.channelId = convertBsonTypeToString(newInstaEntry.channelId);
            return newInstaEntry;
        });
    }
    // --- END MODIFICATION ---

    return newDoc;
}

// --- Rotas de Autenticação com Discord ---
app.get('/auth/discord', (req, res) => {
    const scopes = ['identify', 'email'].join(' ');
    const discordAuthUrl = `https://discord.com/api/oauth2/authorize?client_id=${DISCORD_CLIENT_ID}&redirect_uri=${encodeURIComponent(DISCORD_REDIRECT_URI)}&response_type=code&scope=${encodeURIComponent(scopes)}`;
    res.redirect(discordAuthUrl);
});

app.get('/auth/discord/callback', async (req, res) => {
    const code = req.query.code;
    if (!code) {
        const targetUrl = new URL(FRONTEND_DASHBOARD_REDIRECT_URL);
        targetUrl.searchParams.set('error', 'discord_auth_denied');
        return res.redirect(targetUrl.toString());
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
        
        const appTokenPayload = {
            discordId: discordId,
            username: discordUser.username,
            avatar: discordUser.avatar ? `https://cdn.discordapp.com/avatars/${discordId}/${discordUser.avatar}.png` : `https://cdn.discordapp.com/embed/avatars/${parseInt(discordUser.discriminator, 10) % 5}.png`,
            role: userRole,
        };
        const appToken = jwt.sign(appTokenPayload, JWT_SECRET, { expiresIn: '7d' });

        const targetUrl = new URL(FRONTEND_DASHBOARD_REDIRECT_URL);
        targetUrl.searchParams.set('token', appToken);
        res.redirect(targetUrl.toString());

    } catch (error) {
        console.error('Erro no callback do Discord OAuth2:', error.response ? error.response.data : error.message);
        const targetUrl = new URL(FRONTEND_DASHBOARD_REDIRECT_URL);
        targetUrl.searchParams.set('error', 'discord_callback_error');
        res.redirect(targetUrl.toString());
    }
});

// --- Middleware de Autenticação ---
const requireAuth = (req, res, next) => {
    const authHeader = req.headers.authorization;
    if (authHeader && authHeader.startsWith('Bearer ')) {
        const token = authHeader.substring(7, authHeader.length);
        jwt.verify(token, JWT_SECRET, (err, decodedToken) => {
            if (err) {
                console.warn('Falha na verificação do JWT:', err.message);
                return res.status(401).json({ error: 'Token inválido ou expirado. Faça login novamente.' });
            }
            req.user = decodedToken;
            next();
        });
    } else {
        res.status(401).json({ error: 'Token de autenticação não fornecido.' });
    }
};

// --- Middleware de Verificação de Função (Role) ---
const checkRole = (requiredRole) => {
    return (req, res, next) => {
        if (!req.user || req.user.role !== requiredRole) {
            return res.status(403).json({ error: 'Acesso proibido: Função inadequada para este recurso.' });
        }
        next();
    };
};

// --- Rota para obter dados do usuário logado ---
app.get('/auth/me', requireAuth, (req, res) => {
    res.json({
        discordId: req.user.discordId,
        username: req.user.username,
        avatar: req.user.avatar,
        role: req.user.role
    });
});

// --- Rotas da API ---
app.get('/', (req, res) => {
    res.json({ message: "Bem-vindo à API do Celestial Tracker. Use /auth/discord para login." });
});

app.get('/users', requireAuth, async (req, res) => {
    if (!usersCollection) return res.status(503).json({ error: "Serviço indisponível: MongoDB não conectado." });
    try {
        const usersArray = await usersCollection.find().toArray();
        const simplifiedUsers = usersArray.map(user => convertUserDocument(user));
        res.json(simplifiedUsers);
    } catch (error) {
        console.error("Erro ao buscar usuários:", error);
        res.status(500).json({ error: "Erro interno ao buscar usuários.", details: error.message });
    }
});

app.get('/users/:userIdStr', requireAuth, async (req, res) => {
    if (!usersCollection) return res.status(503).json({ error: "Serviço indisponível: MongoDB não conectado." });
    const userIdStr = req.params.userIdStr;
    try {
        const userIdQuery = Long.fromString(userIdStr);
        let user = await usersCollection.findOne({ user_id: userIdQuery });
        if (user) {
            res.json(convertUserDocument(user)); // convertUserDocument will now also process 'instagram'
        } else {
            res.status(404).json({ error: `Usuário com ID (tracker) '${userIdStr}' não encontrado.` });
        }
    } catch (error) {
        console.error(`Erro ao buscar usuário ${userIdStr}:`, error);
        if (error.message && (error.message.includes("is not a valid string representation of a Long") || error.message.toLowerCase().includes("out of range") || error.message.toLowerCase().includes("non-hex character"))) {
             return res.status(400).json({ error: `ID de usuário (tracker) inválido na URL: '${userIdStr}'.` });
        }
        res.status(500).json({ error: "Erro interno ao buscar usuário.", details: error.message });
    }
});

app.get('/users/:userIdStr/history/nicknames', requireAuth, async (req, res) => {
    if (!usersCollection) return res.status(503).json({ error: "Serviço indisponível: MongoDB não conectado." });
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
            res.status(404).json({ error: `Usuário com ID (tracker) '${userIdStr}' não encontrado para histórico de nomes.` });
        }
    } catch (error) {
        console.error(`Erro ao buscar histórico de nomes para ${userIdStr}:`, error);
        if (error.message && (error.message.includes("is not a valid string representation of a Long") || error.message.toLowerCase().includes("out of range") || error.message.toLowerCase().includes("non-hex character"))) {
            return res.status(400).json({ error: `ID de usuário (tracker) inválido na URL: '${userIdStr}'.` });
        }
        res.status(500).json({ error: "Erro interno ao buscar histórico de nomes.", details: error.message });
    }
});

// --- NEW: Rota para obter dados do 'instagram' de um usuário ---
app.get('/users/:userIdStr/instagram', requireAuth, async (req, res) => {
    if (!usersCollection) return res.status(503).json({ error: "Serviço indisponível: MongoDB não conectado." });
    const userIdStr = req.params.userIdStr;
    try {
        const userIdQuery = Long.fromString(userIdStr);
        // Projeta apenas os campos user_id e instagram para eficiência
        const projection = { projection: { _id: 0, user_id: 1, instagram: 1 } };
        const userFromDb = await usersCollection.findOne({ user_id: userIdQuery }, projection);

        if (userFromDb) {
            let instagramData = [];
            if (userFromDb.instagram && Array.isArray(userFromDb.instagram)) {
                // Processa cada entrada do array 'instagram' para converter timestamps
                instagramData = userFromDb.instagram.map(instaEntry => {
                    const newInstaEntry = { ...instaEntry };
                    if (newInstaEntry.timestamp) {
                        newInstaEntry.timestamp = convertBsonDateToTimestamp(newInstaEntry.timestamp);
                    }
                    // Outros IDs dentro de instaEntry (postedByUserId, messageId, etc.)
                    // são esperados como strings, conforme salvos pelo bot.
                    return newInstaEntry;
                });
            }
            res.json({
                user_id: convertBsonTypeToString(userFromDb.user_id), // Converte user_id para string
                instagram: instagramData // Retorna o array processado
            });
        } else {
            res.status(404).json({ error: `Usuário com ID (tracker) '${userIdStr}' não encontrado para dados do Instagram.` });
        }
    } catch (error) {
        console.error(`Erro ao buscar dados do Instagram para ${userIdStr}:`, error);
        if (error.message && (error.message.includes("is not a valid string representation of a Long") || error.message.toLowerCase().includes("out of range") || error.message.toLowerCase().includes("non-hex character"))) {
            return res.status(400).json({ error: `ID de usuário (tracker) inválido na URL: '${userIdStr}'.` });
        }
        res.status(500).json({ error: "Erro interno ao buscar dados do Instagram.", details: error.message });
    }
});
// --- END NEW ROUTE ---


// --- Rotas do Painel Admin ---
app.get('/admin/stats', requireAuth, checkRole('admin'), async (req, res) => {
    if (!usersCollection) return res.status(503).json({ error: "Serviço indisponível" });
    try {
        const totalTrackedUsers = await usersCollection.countDocuments();
        const imageStats = await usersCollection.aggregate([
            { $match: { message_image_history: { $exists: true, $ne: [] } } },
            { $project: { numImages: { $size: "$message_image_history" } } },
            { $group: { _id: null, totalMessageImages: { $sum: "$numImages" } } }
        ]).toArray();
        const totalMessageImages = imageStats.length > 0 ? imageStats[0].totalMessageImages : 0;

        // --- MODIFIED: Adicionar contagem de imagens do 'instagram' ---
        const instagramImageStats = await usersCollection.aggregate([
            { $match: { instagram: { $exists: true, $ne: [] } } }, // Usuários que possuem o campo instagram não vazio
            { $project: { numInstagramImages: { $size: "$instagram" } } }, // Conta o número de entradas no array instagram
            { $group: { _id: null, totalInstagramImages: { $sum: "$numInstagramImages" } } } // Soma total
        ]).toArray();
        const totalInstagramImages = instagramImageStats.length > 0 ? instagramImageStats[0].totalInstagramImages : 0;
        // --- END MODIFICATION ---

        res.json({ totalTrackedUsers, totalMessageImages, totalInstagramImages }); // Adicionado totalInstagramImages
    } catch (error) {
        console.error("Erro em /admin/stats:", error);
        res.status(500).json({ error: "Erro interno ao buscar estatísticas.", details: error.message });
    }
});

app.get('/admin/roles/config', requireAuth, checkRole('admin'), (req, res) => {
    res.json({ adminIds: ADMIN_DISCORD_IDS, premiumIds: PREMIUM_DISCORD_IDS });
});

app.get('/admin/users/filter', requireAuth, checkRole('admin'), async (req, res) => {
    if (!usersCollection) return res.status(503).json({ error: "Serviço indisponível" });
    try {
        const { hasMessageImages, hasAvatarHistory, usernameContains, discordId, hasInstagramPosts } = req.query; // --- MODIFIED: Added hasInstagramPosts ---
        let mongoQuery = {};
        const queryParts = [];

        if (hasMessageImages === 'true') {
            queryParts.push({ message_image_history: { $exists: true, $not: { $size: 0 } } });
        }
        if (hasAvatarHistory === 'true') {
            queryParts.push({ avatar_url_history: { $exists: true, $not: { $size: 0 } } });
        }
        if (usernameContains) {
            const regex = { $regex: usernameContains, $options: 'i' };
            queryParts.push({ $or: [{ current_username_global: regex }, { username_global_history: regex }] });
        }
        if (discordId) {
            try {
                queryParts.push({ user_id: Long.fromString(discordId) });
            } catch (e) {
                return res.status(400).json({ error: "Formato de ID (para user_id do tracker) inválido."});
            }
        }
        // --- MODIFIED: Add filter for Instagram posts ---
        if (hasInstagramPosts === 'true') {
            queryParts.push({ instagram: { $exists: true, $not: { $size: 0 } } });
        }
        // --- END MODIFICATION ---

        if (queryParts.length > 0) {
            mongoQuery = { $and: queryParts };
        } else {
            // No filters, potentially return all or empty
        }

        console.log("[Admin Filter] Query MongoDB:", JSON.stringify(mongoQuery));
        const users = await usersCollection.find(mongoQuery).limit(100).sort({last_seen_overall_at: -1}).toArray();
        res.json(users.map(user => convertUserDocument(user))); // convertUserDocument will handle 'instagram' formatting

    } catch (error) {
        console.error("Erro em /admin/users/filter:", error);
        res.status(500).json({ error: "Erro interno ao filtrar usuários.", details: error.message });
    }
});


// --- Iniciar o Servidor ---
app.listen(PORT, () => {
    console.log(`🚀 Servidor API rodando na porta ${PORT} (http://localhost:${PORT})`);
    if (process.env.RENDER_EXTERNAL_URL) console.log(`🔗 Deploy no Render: ${process.env.RENDER_EXTERNAL_URL}`);
    console.log(`🔒 CORS permitido para origem: ${CORS_ALLOWED_ORIGIN}`);
    console.log(`↪️  Frontend Redirect Dashboard URL: ${FRONTEND_DASHBOARD_REDIRECT_URL}`);
    console.log(`🔑 Admin IDs: ${ADMIN_DISCORD_IDS.join(', ') || 'Nenhum configurado'}`);
    console.log(`⭐ Premium IDs: ${PREMIUM_DISCORD_IDS.join(', ') || 'Nenhum configurado'}`);
    console.log(`🔗 Discord API Redirect URI (callback da API): ${DISCORD_REDIRECT_URI}`);
});
