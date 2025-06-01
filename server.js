// server.js (Completo e Atualizado)
require('dotenv').config();
const express = require('express');
const { MongoClient, Long } = require('mongodb'); // Long é necessário para as consultas ao DB
const cors = require('cors');

// --- Configuração ---
const MONGO_URI = process.env.MONGO_URI || "mongodb+srv://thiago:OptozQfMn5s2HEG6@cluster0.r2krhdh.mongodb.net/"; // Substitua pela sua URI real se não usar .env
const DB_NAME = "tracker_db"; // Nome do banco de dados correto
const COLLECTION_NAME = "users"; // Coleção que você quer acessar
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
    if (!doc) return doc;

    const newDoc = { ...doc };

    if (newDoc._id) {
        if (typeof newDoc._id === 'object' && newDoc._id.$oid && typeof newDoc._id.$oid === 'string') {
            newDoc._id = newDoc._id.$oid;
        } else if (typeof newDoc._id.toString === 'function') {
            newDoc._id = newDoc._id.toString();
        }
    }

    if (newDoc.user_id) {
        if (newDoc.user_id.$numberLong && typeof newDoc.user_id.$numberLong === 'string') {
            newDoc.user_id = newDoc.user_id.$numberLong;
        } else if (typeof newDoc.user_id === 'object' && newDoc.user_id._bsontype === 'Long' && typeof newDoc.user_id.toString === 'function') {
            newDoc.user_id = newDoc.user_id.toString();
        } else if (typeof newDoc.user_id === 'number' || typeof newDoc.user_id === 'string') {
            newDoc.user_id = newDoc.user_id.toString();
        }
    }

    if (newDoc.servers && Array.isArray(newDoc.servers)) {
        newDoc.servers = newDoc.servers.map(server => {
            const newServer = { ...server };
            if (newServer.guild_id) {
                if (newServer.guild_id.$numberLong && typeof newServer.guild_id.$numberLong === 'string') {
                    newServer.guild_id = newServer.guild_id.$numberLong;
                } else if (typeof newServer.guild_id === 'object' && newServer.guild_id._bsontype === 'Long' && typeof newServer.guild_id.toString === 'function') {
                    newServer.guild_id = newServer.guild_id.toString();
                } else if (typeof newServer.guild_id === 'number' || typeof newServer.guild_id === 'string') {
                     newServer.guild_id = newServer.guild_id.toString();
                }
            }
            if (newServer.first_message_at && typeof newServer.first_message_at === 'object' && newServer.first_message_at.$date) {
                 if (newServer.first_message_at.$date.$numberLong && typeof newServer.first_message_at.$date.$numberLong === 'string') {
                     newServer.first_message_at = parseInt(newServer.first_message_at.$date.$numberLong, 10);
                 } else if (typeof newServer.first_message_at.$date === 'string') {
                     newServer.first_message_at = new Date(newServer.first_message_at.$date).getTime();
                 }
            }
             if (newServer.last_message_at && typeof newServer.last_message_at === 'object' && newServer.last_message_at.$date) {
                 if (newServer.last_message_at.$date.$numberLong && typeof newServer.last_message_at.$date.$numberLong === 'string') {
                     newServer.last_message_at = parseInt(newServer.last_message_at.$date.$numberLong, 10);
                 } else if (typeof newServer.last_message_at.$date === 'string') {
                     newServer.last_message_at = new Date(newServer.last_message_at.$date).getTime();
                 }
            }
            // Adicionado para recent_messages dentro de servers, se aplicável (adapte se a estrutura for diferente)
            if (newServer.recent_messages && Array.isArray(newServer.recent_messages)) {
                newServer.recent_messages = newServer.recent_messages.map(msg => convertMessageData(msg));
            }
            return newServer;
        });
    }

    if (newDoc.history && Array.isArray(newDoc.history)) {
        newDoc.history = newDoc.history.map(histEntry => {
            const newHistEntry = { ...histEntry };
            if (newHistEntry.changed_at && typeof newHistEntry.changed_at === 'object' && newHistEntry.changed_at.$date) {
                if (newHistEntry.changed_at.$date.$numberLong && typeof newHistEntry.changed_at.$date.$numberLong === 'string') {
                    newHistEntry.changed_at = parseInt(newHistEntry.changed_at.$date.$numberLong, 10);
                } else if (typeof newHistEntry.changed_at.$date === 'string') {
                     newHistEntry.changed_at = new Date(newHistEntry.changed_at.$date).getTime();
                }
            }
            const serverChangeKey = newHistEntry.changes && newHistEntry.changes.server_joined ? 'server_joined' : (newHistEntry.changes && newHistEntry.changes.server ? 'server' : null);
            if (serverChangeKey && newHistEntry.changes[serverChangeKey]) {
                const serverChangeData = { ...newHistEntry.changes[serverChangeKey] };
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
                 if (serverChangeData.first_message_at && typeof serverChangeData.first_message_at === 'object' && serverChangeData.first_message_at.$date) { // Adicionado para consistência, se existir
                    if (serverChangeData.first_message_at.$date.$numberLong && typeof serverChangeData.first_message_at.$date.$numberLong === 'string') {
                        serverChangeData.first_message_at = parseInt(serverChangeData.first_message_at.$date.$numberLong, 10);
                    } else if (typeof serverChangeData.first_message_at.$date === 'string') {
                        serverChangeData.first_message_at = new Date(serverChangeData.first_message_at.$date).getTime();
                    }
                }
                newHistEntry.changes[serverChangeKey] = serverChangeData;
            }
            return newHistEntry;
        });
    }

    // Converte datas principais do documento
    if (newDoc.first_seen_overall_at && typeof newDoc.first_seen_overall_at === 'object' && newDoc.first_seen_overall_at.$date) {
        if (newDoc.first_seen_overall_at.$date.$numberLong && typeof newDoc.first_seen_overall_at.$date.$numberLong === 'string') {
            newDoc.first_seen_overall_at = parseInt(newDoc.first_seen_overall_at.$date.$numberLong, 10);
        } else if (typeof newDoc.first_seen_overall_at.$date === 'string') {
            newDoc.first_seen_overall_at = new Date(newDoc.first_seen_overall_at.$date).getTime();
        }
    }
    if (newDoc.last_seen_overall_at && typeof newDoc.last_seen_overall_at === 'object' && newDoc.last_seen_overall_at.$date) {
         if (newDoc.last_seen_overall_at.$date.$numberLong && typeof newDoc.last_seen_overall_at.$date.$numberLong === 'string') {
            newDoc.last_seen_overall_at = parseInt(newDoc.last_seen_overall_at.$date.$numberLong, 10);
        } else if (typeof newDoc.last_seen_overall_at.$date === 'string') {
            newDoc.last_seen_overall_at = new Date(newDoc.last_seen_overall_at.$date).getTime();
        }
    }

    // Converte 'recent_messages'
    if (newDoc.recent_messages && Array.isArray(newDoc.recent_messages)) {
        newDoc.recent_messages = newDoc.recent_messages.map(msg => convertMessageData(msg));
    }

    return newDoc;
}

// Função auxiliar para converter dados de mensagem dentro de arrays
function convertMessageData(msg) {
    if (!msg) return msg;
    const newMsg = { ...msg }; // Copia

    if (newMsg.guild_id) { // Converte guild_id se presente na mensagem
        if (newMsg.guild_id.$numberLong && typeof newMsg.guild_id.$numberLong === 'string') {
            newMsg.guild_id = newMsg.guild_id.$numberLong;
        } else if (typeof newMsg.guild_id === 'object' && newMsg.guild_id._bsontype === 'Long' && typeof newMsg.guild_id.toString === 'function') {
            newMsg.guild_id = newMsg.guild_id.toString();
        } else if (typeof newMsg.guild_id === 'number' || typeof newMsg.guild_id === 'string') {
            newMsg.guild_id = newMsg.guild_id.toString();
        }
    }
    if (newMsg.message_id) { // Converte message_id se presente na mensagem
        if (newMsg.message_id.$numberLong && typeof newMsg.message_id.$numberLong === 'string') {
            newMsg.message_id = newMsg.message_id.$numberLong;
        } else if (typeof newMsg.message_id === 'object' && newMsg.message_id._bsontype === 'Long' && typeof newMsg.message_id.toString === 'function') {
            newMsg.message_id = newMsg.message_id.toString();
        } else if (typeof newMsg.message_id === 'number' || typeof newMsg.message_id === 'string') {
            newMsg.message_id = newMsg.message_id.toString();
        }
    }
    if (newMsg.timestamp && typeof newMsg.timestamp === 'object' && newMsg.timestamp.$date) {
        if (newMsg.timestamp.$date.$numberLong && typeof newMsg.timestamp.$date.$numberLong === 'string') {
            newMsg.timestamp = parseInt(newMsg.timestamp.$date.$numberLong, 10);
        } else if (typeof newMsg.timestamp.$date === 'string') {
            newMsg.timestamp = new Date(newMsg.timestamp.$date).getTime();
        }
    }
    return newMsg;
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
        // MODIFICAÇÃO: Removido .skip() e .limit() para buscar todos os documentos
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
        const userIdQuery = Long.fromString(userIdStr);
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

app.get('/users/:userIdStr/history/nicknames', async (req, res) => {
    if (!usersCollection) {
        return res.status(503).json({ error: "Serviço indisponível: conexão com MongoDB falhou." });
    }
    const userIdStr = req.params.userIdStr;
    try {
        const userIdQuery = Long.fromString(userIdStr);
        const projection = { projection: { _id: 0, user_id: 1, nicknames: 1, username_global: 1 } }; // Ajuste a projeção conforme necessário
        const userFromDb = await usersCollection.findOne({ user_id: userIdQuery }, projection);

        if (userFromDb) {
            res.json({
                user_id: userIdStr,
                username_global: userFromDb.username_global, // Garanta que este campo exista ou ajuste a projeção
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
