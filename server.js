// server.js (Completo e Atualizado)
require('dotenv').config();
const express = require('express');
const { MongoClient, Long } = require('mongodb'); // Long é necessário para as consultas ao DB
const cors = require('cors');

// --- Configuração ---
const MONGO_URI = process.env.MONGO_URI || "mongodb+srv://thiago:OptozQfMn5s2HEG6@cluster0.r2krhdh.mongodb.net/"; // Substitua pela sua URI real se não usar .env
const DB_NAME = "tracker_db";
const COLLECTION_NAME = "users";
const PORT = process.env.PORT || 3000;

// --- Inicialização do App Express ---
const app = express();

// --- Middlewares ---
app.use(cors({
    origin: "*", // Em produção, restrinja para os domínios do seu frontend.
    methods: ["GET"], // Apenas métodos GET por enquanto
}));
app.use(express.json()); // Para parsear JSON no corpo de requisições

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
        process.exit(1); // Encerra o processo se não conseguir conectar ao DB
    });

// --- Função Auxiliar para Converter Documentos MongoDB para JSON Simples ---
function convertUserDocument(doc) {
    if (!doc) return doc; // Retorna nulo/undefined se o documento for nulo/undefined

    // Cria uma cópia superficial para não modificar o objeto original do cache do driver (se houver)
    const newDoc = { ...doc };

    // Converte _id (ObjectId) para string
    if (newDoc._id) {
        if (typeof newDoc._id === 'object' && newDoc._id.$oid && typeof newDoc._id.$oid === 'string') {
            newDoc._id = newDoc._id.$oid;
        } else if (typeof newDoc._id.toString === 'function') {
            // Fallback para instâncias de ObjectId que não foram serializadas para EJSON {$oid: ...}
            newDoc._id = newDoc._id.toString();
        }
    }

    // Converte user_id (Long ou EJSON Long) para string
    if (newDoc.user_id) {
        if (newDoc.user_id.$numberLong && typeof newDoc.user_id.$numberLong === 'string') {
            newDoc.user_id = newDoc.user_id.$numberLong;
        } else if (typeof newDoc.user_id === 'object' && newDoc.user_id._bsontype === 'Long' && typeof newDoc.user_id.toString === 'function') {
            newDoc.user_id = newDoc.user_id.toString();
        } else if (typeof newDoc.user_id === 'number' || typeof newDoc.user_id === 'string') {
            newDoc.user_id = newDoc.user_id.toString(); // Garante que seja string
        }
    }

    // Converte guild_id e datas dentro do array 'servers'
    if (newDoc.servers && Array.isArray(newDoc.servers)) {
        newDoc.servers = newDoc.servers.map(server => {
            const newServer = { ...server }; // Copia para evitar modificar o original no array
            if (newServer.guild_id) {
                if (newServer.guild_id.$numberLong && typeof newServer.guild_id.$numberLong === 'string') {
                    newServer.guild_id = newServer.guild_id.$numberLong;
                } else if (typeof newServer.guild_id === 'object' && newServer.guild_id._bsontype === 'Long' && typeof newServer.guild_id.toString === 'function') {
                    newServer.guild_id = newServer.guild_id.toString();
                } else if (typeof newServer.guild_id === 'number' || typeof newServer.guild_id === 'string') {
                     newServer.guild_id = newServer.guild_id.toString();
                }
            }
            // Converte datas EJSON para timestamp numérico (milissegundos)
            if (newServer.first_seen && typeof newServer.first_seen === 'object' && newServer.first_seen.$date) {
                if (newServer.first_seen.$date.$numberLong && typeof newServer.first_seen.$date.$numberLong === 'string') {
                    newServer.first_seen = parseInt(newServer.first_seen.$date.$numberLong, 10);
                } else if (typeof newServer.first_seen.$date === 'string') { // EJSON v1 date
                    newServer.first_seen = new Date(newServer.first_seen.$date).getTime();
                }
            }
            return newServer;
        });
    }

    // Converte guild_id e datas dentro do array 'history'
    if (newDoc.history && Array.isArray(newDoc.history)) {
        newDoc.history = newDoc.history.map(histEntry => {
            const newHistEntry = { ...histEntry }; // Copia
            if (newHistEntry.changed_at && typeof newHistEntry.changed_at === 'object' && newHistEntry.changed_at.$date) {
                if (newHistEntry.changed_at.$date.$numberLong && typeof newHistEntry.changed_at.$date.$numberLong === 'string') {
                    newHistEntry.changed_at = parseInt(newHistEntry.changed_at.$date.$numberLong, 10);
                } else if (typeof newHistEntry.changed_at.$date === 'string') { // EJSON v1 date
                     newHistEntry.changed_at = new Date(newHistEntry.changed_at.$date).getTime();
                }
            }

            // Lida com 'server_joined' ou 'server' dentro de changes
            const serverChangeKey = newHistEntry.changes && newHistEntry.changes.server_joined ? 'server_joined' : (newHistEntry.changes && newHistEntry.changes.server ? 'server' : null);
            if (serverChangeKey && newHistEntry.changes[serverChangeKey]) {
                const serverChangeData = { ...newHistEntry.changes[serverChangeKey] }; // Copia
                if (serverChangeData.guild_id) {
                    if (serverChangeData.guild_id.$numberLong && typeof serverChangeData.guild_id.$numberLong === 'string') {
                        serverChangeData.guild_id = serverChangeData.guild_id.$numberLong;
                    } else if (typeof serverChangeData.guild_id === 'object' && serverChangeData.guild_id._bsontype === 'Long' && typeof serverChangeData.guild_id.toString === 'function') {
                        serverChangeData.guild_id = serverChangeData.guild_id.toString();
                    } else if (typeof serverChangeData.guild_id === 'number' || typeof serverChangeData.guild_id === 'string') {
                        serverChangeData.guild_id = serverChangeData.guild_id.toString();
                    }
                }
                if (serverChangeData.first_seen && typeof serverChangeData.first_seen === 'object' && serverChangeData.first_seen.$date) {
                   if (serverChangeData.first_seen.$date.$numberLong && typeof serverChangeData.first_seen.$date.$numberLong === 'string') {
                       serverChangeData.first_seen = parseInt(serverChangeData.first_seen.$date.$numberLong, 10);
                   } else if (typeof serverChangeData.first_seen.$date === 'string') {
                       serverChangeData.first_seen = new Date(serverChangeData.first_seen.$date).getTime();
                   }
                }
                newHistEntry.changes[serverChangeKey] = serverChangeData;
            }
            return newHistEntry;
        });
    }
    return newDoc;
}

// --- Endpoints da API ---

app.get('/', (req, res) => {
    res.json({ message: "Bem-vindo à API do Celestial Tracker (Node.js). Acesse os dados dos usuários em /users/" });
});

app.get('/users', async (req, res) => {
    if (!usersCollection) {
        return res.status(503).json({ error: "Serviço indisponível: conexão com MongoDB falhou." });
    }
    try {
        const skip = parseInt(req.query.skip) || 0;
        const limit = parseInt(req.query.limit) || 10;

        const usersArray = await usersCollection.find().skip(skip).limit(limit).toArray();
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
        const userIdQuery = Long.fromString(userIdStr); // Consulta ao DB ainda usa BSON Long
        let user = await usersCollection.findOne({ user_id: userIdQuery });

        if (user) {
            const simplifiedUser = convertUserDocument(user); // Converte o resultado para JSON simples
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

app.get('/users/:userIdStr/history/nicknames', async (req, res) => {
    if (!usersCollection) {
        return res.status(503).json({ error: "Serviço indisponível: conexão com MongoDB falhou." });
    }
    const userIdStr = req.params.userIdStr;
    try {
        const userIdQuery = Long.fromString(userIdStr);
        const projection = { projection: { _id: 0, user_id: 1, nicknames: 1, username_global: 1 } };
        const userFromDb = await usersCollection.findOne({ user_id: userIdQuery }, projection);

        if (userFromDb) {
            // Mesmo que user_id seja projetado, convertUserDocument não é chamado aqui,
            // então vamos garantir que o user_id na resposta seja a string da URL para consistência.
            // Se 'user_id' viesse do DB como Long, precisaria de conversão.
            // No entanto, como projetamos, e o objetivo é retornar um objeto simples,
            // usar userIdStr (que já é string) é mais direto aqui.
            res.json({
                user_id: userIdStr, // O ID que foi usado na busca
                username_global: userFromDb.username_global,
                nicknames: userFromDb.nicknames || []
            });
        } else {
            res.status(404).json({ error: `Usuário com ID '${userIdStr}' não encontrado.` });
        }
    } catch (error) {
        console.error(`Erro ao buscar histórico de apelidos para ${userIdStr}:`, error);
         if (error.message && (error.message.includes("is not a valid string representation of a Long") || error.message.toLowerCase().includes("out of range") || error.message.toLowerCase().includes("non-hex character"))) {
             return res.status(400).json({ error: `ID de usuário inválido na URL: '${userIdStr}'. Deve ser uma representação numérica válida para um ID.` });
        }
        res.status(500).json({ error: "Erro interno ao buscar histórico de apelidos.", details: error.message });
    }
});

// --- Iniciar o Servidor ---
app.listen(PORT, () => {
    console.log(`🚀 Servidor Node.js da API rodando na porta ${PORT}`);
    console.log(`🔗 Acessível localmente em: http://localhost:${PORT}`);
    if (process.env.RENDER_EXTERNAL_URL) { // Para logs no Render
        console.log(`🔗 Deploy no Render acessível em: ${process.env.RENDER_EXTERNAL_URL}`);
    }
});
