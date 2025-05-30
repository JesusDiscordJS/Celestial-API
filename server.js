// server.js
require('dotenv').config();
const express = require('express');
// Importe 'Long' junto com MongoClient
const { MongoClient, Long } = require('mongodb');
const cors = require('cors');

// --- Configuração (sem alterações aqui) ---
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

// --- Endpoints da API ---

// Endpoint Raiz (sem alterações)
app.get('/', (req, res) => {
    res.json({ message: "Bem-vindo à API do Celestial Tracker (Node.js). Acesse os dados dos usuários em /users/" });
});

// Listar todos os usuários (sem alterações na lógica de ID, pois skip/limit são pequenos)
app.get('/users', async (req, res) => {
    if (!usersCollection) {
        return res.status(503).json({ error: "Serviço indisponível: conexão com MongoDB falhou." });
    }
    try {
        const skip = parseInt(req.query.skip) || 0;
        const limit = parseInt(req.query.limit) || 10;
        const usersCursor = usersCollection.find().skip(skip).limit(limit);
        const usersArray = await usersCursor.toArray();
        res.json(usersArray);
    } catch (error) {
        console.error("Erro ao buscar usuários:", error);
        res.status(500).json({ error: "Erro interno ao buscar usuários.", details: error.message });
    }
});

// Buscar um usuário específico pelo ID (CORRIGIDO)
app.get('/users/:userIdStr', async (req, res) => {
    if (!usersCollection) {
        return res.status(503).json({ error: "Serviço indisponível: conexão com MongoDB falhou." });
    }

    const userIdStr = req.params.userIdStr;
    try {
        // Use Long.fromString para converter a string do ID para um tipo Long BSON
        const userIdQuery = Long.fromString(userIdStr);

        const user = await usersCollection.findOne({ user_id: userIdQuery });

        if (user) {
            res.json(user);
        } else {
            res.status(404).json({ error: `Usuário com ID '${userIdStr}' não encontrado.` });
        }
    } catch (error) { // Este catch agora também pode pegar erros de Long.fromString
        console.error(`Erro ao processar/buscar usuário ${userIdStr}:`, error);
        // Verifica se o erro é de conversão do Long para um bad request mais específico
        if (error.message && (error.message.includes("is not a valid string representation of a Long") || error.message.toLowerCase().includes("out of range"))) {
             return res.status(400).json({ error: `ID de usuário inválido: '${userIdStr}'. Deve ser uma representação numérica válida para um ID de 64 bits.` });
        }
        res.status(500).json({ error: "Erro interno ao buscar usuário.", details: error.message });
    }
});

// Exemplo de endpoint mais específico: Histórico de Apelidos (CORRIGIDO)
app.get('/users/:userIdStr/history/nicknames', async (req, res) => {
    if (!usersCollection) {
        return res.status(503).json({ error: "Serviço indisponível: conexão com MongoDB falhou." });
    }

    const userIdStr = req.params.userIdStr;
    try {
        // Use Long.fromString aqui também
        const userIdQuery = Long.fromString(userIdStr);

        const projection = { projection: { _id: 0, nicknames: 1, username_global: 1 } };
        const user = await usersCollection.findOne({ user_id: userIdQuery }, projection);

        if (user) {
            res.json({
                user_id: userIdStr,
                username_global: user.username_global,
                nicknames: user.nicknames || []
            });
        } else {
            res.status(404).json({ error: `Usuário com ID '${userIdStr}' não encontrado para buscar apelidos.` });
        }
    } catch (error) {
        console.error(`Erro ao buscar histórico de apelidos para ${userIdStr}:`, error);
        if (error.message && (error.message.includes("is not a valid string representation of a Long") || error.message.toLowerCase().includes("out of range"))) {
             return res.status(400).json({ error: `ID de usuário inválido: '${userIdStr}'. Deve ser uma representação numérica válida para um ID de 64 bits.` });
        }
        res.status(500).json({ error: "Erro interno ao buscar histórico de apelidos.", details: error.message });
    }
});

// --- Iniciar o Servidor (sem alterações) ---
app.listen(PORT, () => {
    console.log(`🚀 Servidor Node.js da API rodando na porta ${PORT}`);
    console.log(`Disponível em http://localhost:${PORT}`);
});
