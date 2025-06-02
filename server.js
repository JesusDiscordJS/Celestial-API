// server.js (Completo e Atualizado)
require('dotenv').config();
const express = require('express');
const { MongoClient, Long } = require('mongodb');
const cors = require('cors');

const MONGO_URI = process.env.MONGO_URI || "mongodb+srv://thiago:OptozQfMn5s2HEG6@cluster0.r2krhdh.mongodb.net/";
const DB_NAME = "tracker_db";
const COLLECTION_NAME = "users";
const PORT = process.env.PORT || 3000;

const app = express();

app.use(cors({ origin: "*", methods: ["GET"] }));
app.use(express.json());

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

function convertBsonTypeToString(value) {
    if (!value) return value;
    if (value.$numberLong && typeof value.$numberLong === 'string') {
        return value.$numberLong;
    } else if (typeof value === 'object' && value._bsontype === 'Long' && typeof value.toString === 'function') {
        return value.toString();
    } else if (typeof value === 'number' || typeof value === 'string') {
        return value.toString();
    }
    return value; // Fallback
}

function convertBsonDateToTimestamp(value) {
    if (!value) return value;
    if (typeof value === 'object' && value.$date) {
        if (value.$date.$numberLong && typeof value.$date.$numberLong === 'string') {
            return parseInt(value.$date.$numberLong, 10);
        } else if (typeof value.$date === 'string') {
            return new Date(value.$date).getTime();
        }
    } else if (value instanceof Date) { // Se já for um objeto Date do driver
        return value.getTime();
    }
    return value; // Fallback
}


function convertUserDocument(doc) {
    if (!doc) return doc;
    const newDoc = { ...doc };

    if (newDoc._id) { // ObjectId
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
            // Simplificado, assumindo que changes não tem Long/Date complexos aninhados ou já são tratados pelo bot
            return newHistEntry;
        });
    }

    if (newDoc.first_seen_overall_at) {
        newDoc.first_seen_overall_at = convertBsonDateToTimestamp(newDoc.first_seen_overall_at);
    }
    if (newDoc.last_seen_overall_at) {
        newDoc.last_seen_overall_at = convertBsonDateToTimestamp(newDoc.last_seen_overall_at);
    }

    // Converte 'recent_messages'
    if (newDoc.recent_messages && Array.isArray(newDoc.recent_messages)) {
        newDoc.recent_messages = newDoc.recent_messages.map(msg => {
            const newMsg = { ...msg };
            if (newMsg.guild_id) newMsg.guild_id = convertBsonTypeToString(newMsg.guild_id);
            if (newMsg.message_id) newMsg.message_id = convertBsonTypeToString(newMsg.message_id);
            if (newMsg.timestamp) newMsg.timestamp = convertBsonDateToTimestamp(newMsg.timestamp);
            return newMsg;
        });
    }

    // NOVO: Converte 'message_image_history'
    if (newDoc.message_image_history && Array.isArray(newDoc.message_image_history)) {
        newDoc.message_image_history = newDoc.message_image_history.map(imgEntry => {
            const newImgEntry = { ...imgEntry };
            if (newImgEntry.guild_id) newImgEntry.guild_id = convertBsonTypeToString(newImgEntry.guild_id);
            if (newImgEntry.message_id) newImgEntry.message_id = convertBsonTypeToString(newImgEntry.message_id);
            if (newImgEntry.timestamp) newImgEntry.timestamp = convertBsonDateToTimestamp(newImgEntry.timestamp);
            // imgEntry.url e content_snippet são strings, não precisam de conversão especial
            return newImgEntry;
        });
    }

    return newDoc;
}


app.get('/', (req, res) => {
    res.json({ message: "Bem-vindo à API do Celestial Tracker (Node.js). Acesse os dados dos usuários em /users/" });
});

app.get('/users', async (req, res) => {
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
    if (!usersCollection) {
        return res.status(503).json({ error: "Serviço indisponível: conexão com MongoDB falhou." });
    }
    const userIdStr = req.params.userIdStr;
    try {
        const userIdQuery = Long.fromString(userIdStr); // Consulta ao DB ainda usa Long
        let user = await usersCollection.findOne({ user_id: userIdQuery });

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

// Endpoint de histórico de nicknames (mantido como estava, apenas para referência)
app.get('/users/:userIdStr/history/nicknames', async (req, res) => {
    if (!usersCollection) {
        return res.status(503).json({ error: "Serviço indisponível: conexão com MongoDB falhou." });
    }
    const userIdStr = req.params.userIdStr;
    try {
        const userIdQuery = Long.fromString(userIdStr);
        // Ajuste a projeção para incluir os campos que você realmente precisa.
        // Se username_global_history é o campo correto para apelidos globais, projete-o.
        // O campo 'nicknames' no seu código original parecia ser para apelidos de servidor, não globais.
        const projection = { projection: { _id: 0, user_id: 1, current_username_global: 1, username_global_history: 1 } };
        const userFromDb = await usersCollection.findOne({ user_id: userIdQuery }, projection);

        if (userFromDb) {
            res.json({
                user_id: convertBsonTypeToString(userFromDb.user_id), // Converter o user_id também
                current_username_global: userFromDb.current_username_global,
                username_global_history: userFromDb.username_global_history || [] // Usa o histórico de nomes globais
            });
        } else {
            res.status(404).json({ error: `Usuário com ID '${userIdStr}' não encontrado.` });
        }
    } catch (error) {
        console.error(`Erro ao buscar histórico de nomes para ${userIdStr}:`, error);
        if (error.message && (error.message.includes("is not a valid string representation of a Long") || error.message.toLowerCase().includes("out of range") || error.message.toLowerCase().includes("non-hex character"))) {
            return res.status(400).json({ error: `ID de usuário inválido na URL: '${userIdStr}'. Deve ser uma representação numérica válida para um ID.` });
        }
        res.status(500).json({ error: "Erro interno ao buscar histórico de nomes.", details: error.message });
    }
});


app.listen(PORT, () => {
    console.log(`🚀 Servidor Node.js da API rodando na porta ${PORT}`);
    console.log(`🔗 Acessível localmente em: http://localhost:${PORT}`);
    if (process.env.RENDER_EXTERNAL_URL) {
        console.log(`🔗 Deploy no Render acessível em: ${process.env.RENDER_EXTERNAL_URL}`);
    }
});
