// server.js
require('dotenv').config(); // Carrega variáveis de ambiente do arquivo .env para desenvolvimento local
const express = require('express');
// Importe 'Long' junto com MongoClient para checar o tipo e converter
const { MongoClient, Long } = require('mongodb');
const cors = require('cors');

// --- Configuração ---
const MONGO_URI = process.env.MONGO_URI || "mongodb+srv://thiago:OptozQfMn5s2HEG6@cluster0.r2krhdh.mongodb.net/"; // Use sua URI real
const DB_NAME = "tracker_db";
const COLLECTION_NAME = "users";
const PORT = process.env.PORT || 3000;

// --- Inicialização do App Express ---
const app = express();

// --- Middlewares ---
app.use(cors({
    origin: "*", // Para desenvolvimento. Em produção, restrinja para seus domínios.
    methods: ["GET"], // Apenas GET para estes endpoints de leitura por enquanto
}));
app.use(express.json()); // Para parsear JSON no corpo de requisições (se adicionar POST/PUT)

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

// --- Função Auxiliar para Converter User ID (se necessário) ---
// Esta função pode ser usada para garantir que o user_id seja uma string na resposta.
function ensureUserIdIsString(userDocument) {
    if (userDocument && userDocument.user_id && typeof userDocument.user_id === 'object' && userDocument.user_id._bsontype === 'Long') {
        return { ...userDocument, user_id: userDocument.user_id.toString() };
    }
    // Se já for string ou número (que será stringificado corretamente), ou se não for Long, retorna como está
    return userDocument;
}

// --- Endpoints da API ---

// Endpoint Raiz
app.get('/', (req, res) => {
    res.json({ message: "Bem-vindo à API do Celestial Tracker (Node.js). Acesse os dados dos usuários em /users/" });
});

// Listar todos os usuários (com paginação e conversão de user_id)
app.get('/users', async (req, res) => {
    if (!usersCollection) {
        return res.status(503).json({ error: "Serviço indisponível: conexão com MongoDB falhou." });
    }
    try {
        const skip = parseInt(req.query.skip) || 0;
        const limit = parseInt(req.query.limit) || 10;

        const usersCursor = usersCollection.find().skip(skip).limit(limit);
        const usersArray = await usersCursor.toArray();

        // Mapeia para converter user_id para string se for Long em cada usuário
        const usersWithStringIds = usersArray.map(user => ensureUserIdIsString(user));

        res.json(usersWithStringIds);
    } catch (error) {
        console.error("Erro ao buscar usuários:", error);
        res.status(500).json({ error: "Erro interno ao buscar usuários.", details: error.message });
    }
});

// Buscar um usuário específico pelo ID (com conversão de user_id na resposta)
app.get('/users/:userIdStr', async (req, res) => {
    if (!usersCollection) {
        return res.status(503).json({ error: "Serviço indisponível: conexão com MongoDB falhou." });
    }

    const userIdStr = req.params.userIdStr;
    try {
        // Use Long.fromString para a consulta, pois o ID no DB é um BSON Long
        const userIdQuery = Long.fromString(userIdStr);
        let user = await usersCollection.findOne({ user_id: userIdQuery });

        if (user) {
            // Garante que o user_id na resposta seja uma string
            user = ensureUserIdIsString(user);
            res.json(user);
        } else {
            res.status(404).json({ error: `Usuário com ID '${userIdStr}' não encontrado.` });
        }
    } catch (error) {
        console.error(`Erro ao processar/buscar usuário ${userIdStr}:`, error);
        if (error.message && (error.message.includes("is not a valid string representation of a Long") || error.message.toLowerCase().includes("out of range"))) {
             return res.status(400).json({ error: `ID de usuário inválido: '${userIdStr}'. Deve ser uma representação numérica válida para um ID de 64 bits.` });
        }
        res.status(500).json({ error: "Erro interno ao buscar usuário.", details: error.message });
    }
});

// Histórico de Apelidos (user_id na resposta já é string do path param)
app.get('/users/:userIdStr/history/nicknames', async (req, res) => {
    if (!usersCollection) {
        return res.status(503).json({ error: "Serviço indisponível: conexão com MongoDB falhou." });
    }

    const userIdStr = req.params.userIdStr; // Este já é uma string
    try {
        const userIdQuery = Long.fromString(userIdStr); // Para a consulta no DB

        const projection = { projection: { _id: 0, nicknames: 1, username_global: 1 } };
        const user = await usersCollection.findOne({ user_id: userIdQuery }, projection);

        if (user) {
            res.json({
                user_id: userIdStr, // Usa a string do path param, que é o ID correto
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


// --- Iniciar o Servidor ---
app.listen(PORT, () => {
    console.log(`🚀 Servidor Node.js da API rodando na porta ${PORT}`);
    console.log(`🔗 Acessível em: http://localhost:${PORT}`);
    if (process.env.RENDER_EXTERNAL_URL) {
        console.log(`🔗 Deploy no Render acessível em: ${process.env.RENDER_EXTERNAL_URL}`);
    }
});
