// server.js
require('dotenv').config(); // Carrega variáveis de ambiente do arquivo .env para desenvolvimento local
const express = require('express');
const { MongoClient } = require('mongodb');
const cors = require('cors');

// --- Configuração ---
const MONGO_URI = process.env.MONGO_URI || "mongodb+srv://thiago:OptozQfMn5s2HEG6@cluster0.r2krhdh.mongodb.net/";
const DB_NAME = "tracker_db"; // O nome do banco de dados que seu bot usa
const COLLECTION_NAME = "users"; // A coleção onde os dados dos usuários são salvos
const PORT = process.env.PORT || 3000; // Porta para a API rodar

// --- Inicialização do App Express ---
const app = express();

// --- Middlewares ---
app.use(cors({ // Configuração do CORS
    origin: "*", // Para desenvolvimento. Em produção, restrinja aos seus domínios.
    methods: ["GET"], // Apenas métodos GET para estes endpoints de leitura
}));
app.use(express.json()); // Para parsear JSON no corpo de requisições (se você adicionar POST/PUT depois)

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
        // Em um cenário real, você pode querer que a API não inicie ou retorne um status de erro global.
        // Por enquanto, os endpoints verificarão se usersCollection está disponível.
        process.exit(1); // Encerra o processo se não conseguir conectar ao DB
    });

// --- Endpoints da API ---

// Endpoint Raiz
app.get('/', (req, res) => {
    res.json({ message: "Bem-vindo à API do Celestial Tracker (Node.js). Acesse os dados dos usuários em /users/" });
});

// Listar todos os usuários (com paginação)
app.get('/users', async (req, res) => {
    if (!usersCollection) {
        return res.status(503).json({ error: "Serviço indisponível: conexão com MongoDB falhou." });
    }

    try {
        const skip = parseInt(req.query.skip) || 0;
        const limit = parseInt(req.query.limit) || 10;

        const usersCursor = usersCollection.find().skip(skip).limit(limit);
        const usersArray = await usersCursor.toArray(); // Converte o cursor para um array

        if (!usersArray) { // usersArray será [] se nada for encontrado, o que é ok
            return res.json([]);
        }
        res.json(usersArray);
    } catch (error) {
        console.error("Erro ao buscar usuários:", error);
        res.status(500).json({ error: "Erro interno ao buscar usuários.", details: error.message });
    }
});

// Buscar um usuário específico pelo ID
app.get('/users/:userIdStr', async (req, res) => {
    if (!usersCollection) {
        return res.status(503).json({ error: "Serviço indisponível: conexão com MongoDB falhou." });
    }

    try {
        const userIdStr = req.params.userIdStr;
        // Seu bot salva `member.id` (que é um int) como `user_id`.
        // O path parameter vem como string, então precisa ser convertido para int.
        const userIdQuery = parseInt(userIdStr);

        if (isNaN(userIdQuery)) {
            return res.status(400).json({ error: `ID de usuário inválido: '${userIdStr}'. Deve ser um número.` });
        }

        const user = await usersCollection.findOne({ user_id: userIdQuery });

        if (user) {
            res.json(user);
        } else {
            res.status(404).json({ error: `Usuário com ID '${userIdStr}' não encontrado.` });
        }
    } catch (error) {
        console.error(`Erro ao buscar usuário ${req.params.userIdStr}:`, error);
        res.status(500).json({ error: "Erro interno ao buscar usuário.", details: error.message });
    }
});

// Exemplo de endpoint mais específico: Histórico de Apelidos
app.get('/users/:userIdStr/history/nicknames', async (req, res) => {
    if (!usersCollection) {
        return res.status(503).json({ error: "Serviço indisponível: conexão com MongoDB falhou." });
    }

    try {
        const userIdStr = req.params.userIdStr;
        const userIdQuery = parseInt(userIdStr);

        if (isNaN(userIdQuery)) {
            return res.status(400).json({ error: `ID de usuário inválido: '${userIdStr}'. Deve ser um número.` });
        }

        // Projeta apenas os campos necessários
        const projection = { projection: { _id: 0, nicknames: 1, username_global: 1 } };
        const user = await usersCollection.findOne({ user_id: userIdQuery }, projection);

        if (user) {
            res.json({
                user_id: userIdStr, // Retorna o ID string da requisição para consistência
                username_global: user.username_global,
                nicknames: user.nicknames || []
            });
        } else {
            res.status(404).json({ error: `Usuário com ID '${userIdStr}' não encontrado para buscar apelidos.` });
        }
    } catch (error) {
        console.error(`Erro ao buscar histórico de apelidos para ${req.params.userIdStr}:`, error);
        res.status(500).json({ error: "Erro interno ao buscar histórico de apelidos.", details: error.message });
    }
});


// --- Iniciar o Servidor ---
app.listen(PORT, () => {
    console.log(`🚀 Servidor Node.js da API rodando na porta ${PORT}`);
    console.log(`Disponível em http://localhost:${PORT}`);
});
