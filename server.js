// server.js (Backend API - Parte 1: OAuth2 e JWT)
require('dotenv').config(); // Carrega variáveis do .env no início
const express = require('express');
const { MongoClient, Long } = require('mongodb');
const cors = require('cors');
const jwt = require('jsonwebtoken');
const axios = require('axios'); // Para chamadas HTTP à API do Discord
const cookieParser = require('cookie-parser'); // Para cookies, se necessário
const querystring = require('querystring'); // Para construir query strings

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
    origin: FRONTEND_URL, // Permite requisições apenas do seu frontend em produção
    credentials: true // Se você for usar cookies para algo (opcional com JWT no header)
}));
app.use(express.json());
app.use(cookieParser()); // Para ler cookies

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

// --- Funções Auxiliares de Conversão de Documento (MANTIDAS DA SUA VERSÃO ANTERIOR) ---
// (Sua função convertUserDocument, convertBsonTypeToString, convertBsonDateToTimestamp, etc. permanecem aqui)
// COLE AQUI SUAS FUNÇÕES: convertUserDocument, convertBsonTypeToString, convertBsonDateToTimestamp
// ... (Vou omiti-las aqui para economizar espaço, mas elas devem estar presentes)
// Certifique-se que elas estão corretas e completas.
function convertBsonTypeToString(value) {
    if (!value) return value;
    if (value.$numberLong && typeof value.$numberLong === 'string') {
        return value.$numberLong;
    } else if (typeof value === 'object' && value._bsontype === 'Long' && typeof value.toString === 'function') {
        return value.toString();
    } else if (typeof value === 'number' || typeof value === 'string') {
        return value.toString();
    }
    return value;
}

function convertBsonDateToTimestamp(value) {
    if (!value) return value;
    if (typeof value === 'object' && value.$date) {
        if (value.$date.$numberLong && typeof value.$date.$numberLong === 'string') {
            return parseInt(value.$date.$numberLong, 10);
        } else if (typeof value.$date === 'string') {
            return new Date(value.$date).getTime();
        }
    } else if (value instanceof Date) {
        return value.getTime();
    }
    return value;
}

function convertUserDocument(doc) {
    if (!doc) return doc;
    const newDoc = { ...doc };

    if (newDoc._id) newDoc._id = newDoc._id.toString();
    if (newDoc.user_id) newDoc.user_id = convertBsonTypeToString(newDoc.user_id);

    if (newDoc.servers && Array.isArray(newDoc.servers)) {
        newDoc.servers = newDoc.servers.map(server => {
            const newServer = { ...server };
            if (newServer.guild_id) newServer.guild_id = convertBsonTypeToString(newServer.guild_id);
            if (newServer.first_message_at) newServer.first_message_at = convertBsonDateToTimestamp(newServer.first_message_at);
            if (newServer.last_message_at) newServer.last_message_at = convertBsonDateToTimestamp(newServer.last_message_at);
            return newServer;
        });
    }
    if (newDoc.history && Array.isArray(newDoc.history)) {
        newDoc.history = newDoc.history.map(histEntry => {
            const newHistEntry = { ...histEntry };
            if (newHistEntry.changed_at) newHistEntry.changed_at = convertBsonDateToTimestamp(newHistEntry.changed_at);
            return newHistEntry;
        });
    }
    if (newDoc.first_seen_overall_at) newDoc.first_seen_overall_at = convertBsonDateToTimestamp(newDoc.first_seen_overall_at);
    if (newDoc.last_seen_overall_at) newDoc.last_seen_overall_at = convertBsonDateToTimestamp(newDoc.last_seen_overall_at);

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
    return newDoc;
}


// --- Rotas de Autenticação com Discord (NOVAS) ---

// 1. Rota para iniciar o login com Discord: redireciona para o Discord
app.get('/auth/discord', (req, res) => {
    const discordAuthUrl = `https://discord.com/api/oauth2/authorize?client_id=${DISCORD_CLIENT_ID}&redirect_uri=${encodeURIComponent(DISCORD_REDIRECT_URI)}&response_type=code&scope=${encodeURIComponent('identify email guilds')}`;
    // Adicionei 'guilds' ao escopo se você quiser, por exemplo, verificar se o usuário está em um servidor específico. 'identify' e 'email' são comuns.
    res.redirect(discordAuthUrl);
});

// 2. Rota de Callback: Discord redireciona para cá após o usuário autorizar
app.get('/auth/discord/callback', async (req, res) => {
    const code = req.query.code;

    if (!code) {
        // Se o usuário negar ou houver erro, redirecionar para uma página de erro no frontend
        return res.redirect(`${FRONTEND_URL}/dashboard.html?error=discord_auth_failed`);
    }

    try {
        // Trocar o código por um access token do Discord
        const tokenResponse = await axios.post('https://discord.com/api/oauth2/token',
            querystring.stringify({
                client_id: DISCORD_CLIENT_ID,
                client_secret: DISCORD_CLIENT_SECRET,
                grant_type: 'authorization_code',
                code: code,
                redirect_uri: DISCORD_REDIRECT_URI,
            }), {
            headers: {
                'Content-Type': 'application/x-www-form-urlencoded',
            },
        });

        const accessToken = tokenResponse.data.access_token;

        // Usar o access token para obter informações do usuário do Discord
        const userResponse = await axios.get('https://discord.com/api/users/@me', {
            headers: {
                Authorization: `Bearer ${accessToken}`,
            },
        });

        const discordUser = userResponse.data; // Contém id, username, avatar, email, etc.
        const discordId = discordUser.id;

        // Determinar a função do usuário
        let userRole = 'free'; // Padrão
        if (ADMIN_DISCORD_IDS.includes(discordId)) {
            userRole = 'admin';
        } else if (PREMIUM_DISCORD_IDS.includes(discordId)) {
            userRole = 'premium';
        }
        
        // Opcional: Salvar/atualizar informações do usuário no seu DB aqui, se necessário
        // Ex: usersCollection.updateOne({ discord_id: discordId }, { $set: { username: discordUser.username, last_login: new Date() } }, { upsert: true });

        // Gerar seu próprio JWT para sua aplicação
        const appTokenPayload = {
            discordId: discordId,
            username: discordUser.username,
            avatar: discordUser.avatar ? `https://cdn.discordapp.com/avatars/${discordId}/${discordUser.avatar}.png` : null, // Construir URL do avatar
            role: userRole,
        };

        const appToken = jwt.sign(appTokenPayload, JWT_SECRET, { expiresIn: '7d' }); // Token expira em 7 dias

        // Redirecionar de volta para o frontend com o token
        // Você pode passar o token como um query parameter
        res.redirect(`${FRONTEND_URL}/dashboard.html?token=${appToken}`);
        // Alternativa mais segura (mas mais complexa de configurar no frontend para SPA sem refresh):
        // res.cookie('app_token', appToken, { httpOnly: true, secure: process.env.NODE_ENV === 'production', maxAge: 7 * 24 * 60 * 60 * 1000 });
        // res.redirect(`${FRONTEND_URL}/dashboard.html`);


    } catch (error) {
        console.error('Erro no callback do Discord OAuth2:', error.response ? error.response.data : error.message);
        // Redirecionar para uma página de erro no frontend
        return res.redirect(`${FRONTEND_URL}/dashboard.html?error=discord_callback_error`);
    }
});


// --- Rotas da API Existentes (Exemplo: /users, /users/:userIdStr) ---
// Estas rotas agora precisarão de proteção se você quiser que apenas usuários logados (ou com certas roles) as acessem.
// Por enquanto, vou mantê-las como estão, e na próxima parte adicionaremos o middleware de proteção.

app.get('/', (req, res) => {
    res.json({ message: "Bem-vindo à API do Celestial Tracker (Node.js). Acesse os dados dos usuários em /users/" });
});

app.get('/users', async (req, res) => {
    // TODO: Adicionar middleware de autenticação/autorização aqui na próxima etapa
    if (!usersCollection) {
        return res.status(503).json({ error: "Serviço indisponível: conexão com MongoDB falhou." });
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

app.get('/users/:userIdStr', async (req, res) => {
    // TODO: Adicionar middleware de autenticação/autorização aqui na próxima etapa
    if (!usersCollection) {
        return res.status(503).json({ error: "Serviço indisponível: conexão com MongoDB falhou." });
    }
    const userIdStr = req.params.userIdStr;
    try {
        const userIdQuery = Long.fromString(userIdStr);
        let user = await usersCollection.findOne({ user_id: userIdQuery }); // Busca pelo user_id do seu sistema

        if (user) {
            const simplifiedUser = convertUserDocument(user);
            res.json(simplifiedUser);
        } else {
            res.status(404).json({ error: `Usuário com ID '${userIdStr}' não encontrado.` });
        }
    } catch (error) {
        console.error(`Erro ao processar/buscar usuário ${userIdStr}:`, error);
        if (error.message && (error.message.includes("is not a valid string representation of a Long") || error.message.toLowerCase().includes("out of range") || error.message.toLowerCase().includes("non-hex character"))) {
             return res.status(400).json({ error: `ID de usuário inválido na URL: '${userIdStr}'. Deve ser uma representação numérica válida para um ID.` });
        }
        res.status(500).json({ error: "Erro interno ao buscar usuário.", details: error.message });
    }
});

// A rota /users/:userIdStr/history/nicknames também precisará de proteção
// ... (sua rota de nicknames existente)


// --- Iniciar o Servidor ---
app.listen(PORT, () => {
    console.log(`🚀 Servidor Node.js da API rodando na porta ${PORT}`);
    console.log(`🔗 Acessível localmente em: http://localhost:${PORT}`);
    if (process.env.RENDER_EXTERNAL_URL) {
        console.log(`🔗 Deploy no Render acessível em: ${process.env.RENDER_EXTERNAL_URL}`);
    }
    console.log(`🔑 Admin Discord IDs: ${ADMIN_DISCORD_IDS.join(', ')}`);
    console.log(`⭐ Premium Discord IDs: ${PREMIUM_DISCORD_IDS.join(', ')}`);
    console.log(`🔗 Frontend URL para redirecionamento: ${FRONTEND_URL}`);
    console.log(`🔗 Discord Redirect URI configurada: ${DISCORD_REDIRECT_URI}`);
});
