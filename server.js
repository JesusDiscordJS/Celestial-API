// server.js
import express from "express";
import mongoose from "mongoose";
import cors from "cors";
import dotenv from "dotenv";
import fetch from 'node-fetch'; // Para fazer requisições HTTP à API do Discord

dotenv.config(); // Carrega variáveis de ambiente do arquivo .env

const app = express();
const PORT = process.env.PORT || 3000; // Porta do servidor
const DISCORD_BOT_TOKEN = process.env.DISCORD_BOT_TOKEN; // Token do seu bot Discord
const MONGO_URI = process.env.MONGO_URI; // String de conexão do MongoDB

app.use(cors()); // Habilita CORS para todas as rotas

// Conectar ao MongoDB
if (!MONGO_URI) {
  console.error("ERRO: MONGO_URI não definida no .env. A aplicação não pode iniciar.");
  process.exit(1); // Encerra a aplicação se a URI do MongoDB não estiver definida
}

mongoose.connect(MONGO_URI, {
  dbName: "discordAvatares", // Nome do banco de dados
}).then(() => console.log("✅ MongoDB conectado com sucesso!"))
  .catch((err) => {
    console.error("❌ Erro ao conectar ao MongoDB:", err);
    process.exit(1); // Encerra em caso de falha na conexão inicial com o DB
  });

// Schema completo do usuário/avatar no MongoDB
const avatarSchema = new mongoose.Schema({
  userId: { type: String, index: true, unique: true, required: true }, // ID do usuário, indexado e único
  usernames: { type: [String], default: [] }, // Histórico de nomes de usuário
  avatars: { type: [String], default: [] },   // Histórico de URLs de avatares
  lastJoinCall: { // Última vez que entrou em um canal de voz
    channelId: String,
    timestamp: Date,
  },
  lastLeaveCall: { // Última vez que saiu de um canal de voz
    channelId: String,
    timestamp: Date,
  },
}, { timestamps: true }); // Adiciona createdAt e updatedAt automaticamente

// "Avatar" é o nome do modelo, mapeando para a coleção "avatars" (pluralizado) no MongoDB.
const AvatarModel = mongoose.model("Avatar", avatarSchema);

// Rota principal da API para buscar dados do usuário por ID
app.get("/api/avatars/:id", async (req, res) => {
  try {
    const requestedUserId = req.params.id;

    if (!/^\d{17,19}$/.test(requestedUserId)) { // Validação básica do formato do ID
        return res.status(400).json({ error: "Formato de ID de usuário inválido." });
    }

    let userFromDb = await AvatarModel.findOne({ userId: requestedUserId });

    if (!userFromDb) {
      // Usuário não encontrado no banco de dados local, tentar buscar na API do Discord
      console.log(`Usuário ${requestedUserId} não encontrado no DB. Buscando no Discord...`);

      if (!DISCORD_BOT_TOKEN) {
        console.warn("AVISO: DISCORD_BOT_TOKEN não está configurado no .env. Não é possível buscar dados ao vivo do Discord.");
        // Não retorna 404 aqui ainda, pois o frontend pode ter sido feito para esperar dados mesmo sem fallback.
        // Ou, se preferir, pode retornar um 404 específico:
        // return res.status(404).json({ error: "Usuário não encontrado no banco de dados local. Busca ao vivo desabilitada." });
        // Por ora, vamos seguir com a lógica de que um 404 só ocorre se não achar em lugar nenhum.
         return res.status(404).json({ error: "Usuário não encontrado no banco de dados local e busca ao vivo desabilitada (sem token)." });
      }

      const discordApiUrl = `https://discord.com/api/v10/users/${requestedUserId}`;
      const discordResponse = await fetch(discordApiUrl, {
        method: 'GET',
        headers: {
          'Authorization': `Bot ${DISCORD_BOT_TOKEN}`,
          'User-Agent': 'CelestialUserTrackerAPI/1.0 (https://yourdomain.com, seuemail@example.com)' // Bom adicionar um User-Agent
        }
      });

      if (!discordResponse.ok) {
        if (discordResponse.status === 404) {
          console.log(`Usuário ${requestedUserId} também não encontrado no Discord.`);
          return res.status(404).json({ error: "Usuário não encontrado no banco de dados local nem no Discord." });
        }
        const errorText = await discordResponse.text();
        console.error(`Erro ao buscar usuário ${requestedUserId} do Discord: ${discordResponse.status} - ${discordResponse.statusText}. Detalhes: ${errorText}`);
        return res.status(discordResponse.status).json({ error: `Erro ao consultar a API do Discord: ${discordResponse.statusText}` });
      }

      const discordUserData = await discordResponse.json();
      console.log(`Dados do usuário ${requestedUserId} encontrados no Discord: ${discordUserData.username}`);

      const newUserRecordData = {
        userId: discordUserData.id,
        usernames: [discordUserData.username],
        avatars: [],
        lastJoinCall: null,
        lastLeaveCall: null,
      };

      if (discordUserData.avatar) {
        const avatarExtension = discordUserData.avatar.startsWith("a_") ? "gif" : "png";
        newUserRecordData.avatars.push(`https://cdn.discordapp.com/avatars/${discordUserData.id}/${discordUserData.avatar}.${avatarExtension}?size=1024`);
      }
      // else: o array de avatares permanece vazio, o que é ok.

      try {
        userFromDb = await AvatarModel.create(newUserRecordData);
        console.log(`Usuário ${requestedUserId} (não estava no DB) foi buscado do Discord e salvo com sucesso.`);
      } catch (dbError) {
        console.error(`Erro ao salvar o novo usuário ${requestedUserId} (vindo do Discord) no DB:`, dbError);
        return res.status(500).json({ error: "Usuário encontrado no Discord, mas falha ao salvar no banco de dados local." });
      }
    }

    // Envia os dados do usuário (seja do DB original ou recém-criados a partir do Discord)
    res.json({
      userId: userFromDb.userId,
      usernames: userFromDb.usernames || [],
      avatars: userFromDb.avatars || [],
      lastJoinCall: userFromDb.lastJoinCall, // Será null se for um novo usuário ou se nunca usou call
      lastLeaveCall: userFromDb.lastLeaveCall, // Idem
      // Você poderia adicionar aqui 'createdAt' e 'updatedAt' se fossem úteis para o frontend:
      // createdAt: userFromDb.createdAt,
      // updatedAt: userFromDb.updatedAt,
    });

  } catch (err) {
    console.error(`Erro GERAL na rota /api/avatars/${req.params.id}:`, err);
    res.status(500).json({ error: "Erro interno desconhecido no servidor." });
  }
});

// Rota raiz para um health check ou página de boas-vindas da API
app.get("/", (req, res) => {
  res.send("🚀 API Celestial User Tracker está online e funcionando!");
});

// Tratamento para rotas não encontradas (404) - deve ser o último manipulador de rota
app.use((req, res, next) => {
  res.status(404).json({ error: "Rota não encontrada." });
});

// Middleware de tratamento de erro genérico - deve ser o último app.use()
app.use((err, req, res, next) => {
  console.error("Erro não tratado:", err.stack || err);
  res.status(500).json({ error: 'Ocorreu um erro inesperado no servidor.' });
});

// Iniciar o servidor
app.listen(PORT, () => {
  console.log(`🔊 Servidor API rodando na porta ${PORT}`);
  if (!DISCORD_BOT_TOKEN) {
    console.warn("⚠️ AVISO: DISCORD_BOT_TOKEN não está configurado. A funcionalidade de buscar usuários (não encontrados no DB) diretamente do Discord estará DESABILITADA.");
  }
});
