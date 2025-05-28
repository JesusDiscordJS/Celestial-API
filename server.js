// server.js
import express from "express";
import mongoose from "mongoose";
import cors from "cors";
import dotenv from "dotenv";
import fetch from 'node-fetch'; // Para fazer requisições HTTP à API do Discord

dotenv.config();

const app = express();
const PORT = process.env.PORT || 3000;
const DISCORD_BOT_TOKEN = process.env.DISCORD_BOT_TOKEN;

app.use(cors());

// Conectar ao MongoDB
mongoose.connect(process.env.MONGO_URI, {
  dbName: "discordAvatares", // Certifique-se que este é o nome correto do banco
}).then(() => console.log("✅ MongoDB conectado"))
  .catch((err) => console.error("❌ Erro ao conectar ao MongoDB:", err));

// Schema completo do usuário/avatar
const avatarSchema = new mongoose.Schema({
  userId: { type: String, index: true, unique: true }, // Adicionar index e unique para otimizar buscas e garantir unicidade
  usernames: [String],
  avatars: [String],
  lastJoinCall: {
    channelId: String,
    timestamp: Date,
  },
  lastLeaveCall: {
    channelId: String,
    timestamp: Date,
  },
});

// "Avatar" é o nome do modelo, que por padrão mapeará para a coleção "avatars" no MongoDB.
const AvatarModel = mongoose.model("Avatar", avatarSchema);

// Rota principal para buscar dados do usuário por ID
app.get("/api/avatars/:id", async (req, res) => {
  try {
    const requestedUserId = req.params.id;
    let userFromDb = await AvatarModel.findOne({ userId: requestedUserId });

    if (!userFromDb) {
      // Usuário não encontrado no banco de dados local, tentar buscar na API do Discord
      console.log(`Usuário ${requestedUserId} não encontrado no DB. Buscando no Discord...`);

      if (!DISCORD_BOT_TOKEN) {
        console.warn("AVISO: DISCORD_BOT_TOKEN não está configurado no .env. Não é possível buscar dados ao vivo do Discord.");
        return res.status(404).json({ error: "Usuário não encontrado no banco de dados local. Busca ao vivo desabilitada." });
      }

      const discordApiUrl = `https://discord.com/api/v10/users/${requestedUserId}`;
      const discordResponse = await fetch(discordApiUrl, {
        method: 'GET',
        headers: {
          'Authorization': `Bot ${DISCORD_BOT_TOKEN}`
        }
      });

      if (!discordResponse.ok) {
        if (discordResponse.status === 404) {
          console.log(`Usuário ${requestedUserId} também não encontrado no Discord.`);
          return res.status(404).json({ error: "Usuário não encontrado no banco de dados local nem no Discord." });
        }
        // Outros erros da API do Discord (rate limit, token inválido, etc.)
        console.error(`Erro ao buscar usuário ${requestedUserId} do Discord: ${discordResponse.status} - ${discordResponse.statusText}`);
        const errorBody = await discordResponse.text(); // Tenta pegar mais detalhes do erro
        console.error(`Corpo do erro do Discord: ${errorBody}`);
        return res.status(discordResponse.status).json({ error: `Erro ao consultar a API do Discord: ${discordResponse.statusText}` });
      }

      const discordUserData = await discordResponse.json();
      console.log(`Dados do usuário ${requestedUserId} encontrados no Discord:`, discordUserData.username);

      // Estruturar os dados para salvar no seu banco
      const newUserRecordData = {
        userId: discordUserData.id,
        usernames: [discordUserData.username], // A API do Discord só fornece o username atual
        avatars: [], // O avatar precisa ser construído a partir do hash
        lastJoinCall: null, // Não há histórico de chamadas em uma busca nova
        lastLeaveCall: null,
      };

      if (discordUserData.avatar) {
        const avatarExtension = discordUserData.avatar.startsWith("a_") ? "gif" : "png";
        newUserRecordData.avatars.push(`https://cdn.discordapp.com/avatars/${discordUserData.id}/${discordUserData.avatar}.${avatarExtension}?size=1024`);
      } else {
        // Se o usuário não tiver um avatar customizado, Discord usa um avatar padrão.
        // Você pode optar por não salvar nada ou salvar um placeholder/URL do avatar padrão.
        // Exemplo: `https://cdn.discordapp.com/embed/avatars/${parseInt(discordUserData.discriminator) % 5}.png` se tiver o discriminator
        // ou simplesmente deixar o array de avatares vazio.
      }

      // Salvar o novo usuário no banco de dados
      try {
        userFromDb = await AvatarModel.create(newUserRecordData);
        console.log(`Usuário ${requestedUserId} (anteriormente não encontrado no DB) foi buscado do Discord e salvo com sucesso.`);
      } catch (dbError) {
        // Tratar erros de salvamento no DB (ex: violação de índice único se algo der muito errado)
        console.error(`Erro ao salvar o novo usuário ${requestedUserId} (vindo do Discord) no banco de dados:`, dbError);
        // Neste caso, você pode optar por retornar os dados que acabou de buscar do Discord (sem salvar)
        // ou retornar um erro indicando a falha no salvamento. Para consistência do sistema,
        // é melhor indicar a falha, pois o objetivo é ter o usuário no DB.
        return res.status(500).json({ error: "Usuário encontrado no Discord, mas ocorreu uma falha ao salvá-lo no banco de dados local." });
      }
    }

    // Se chegou aqui, userFromDb contém os dados (seja do DB original ou recém-criados do Discord)
    res.json({
      userId: userFromDb.userId,
      usernames: userFromDb.usernames || [], // Garante que seja um array
      avatars: userFromDb.avatars || [],   // Garante que seja um array
      lastJoinCall: userFromDb.lastJoinCall,
      lastLeaveCall: userFromDb.lastLeaveCall
    });

  } catch (err) {
    console.error(`Erro geral na rota /api/avatars/${req.params.id}:`, err);
    res.status(500).json({ error: "Erro interno no servidor." });
  }
});

// Rota raiz para verificar se a API está online
app.get("/", (req, res) => {
  res.send("🚀 API de Dados de Usuários do Discord (Celestial Tracker) está online!");
});

// Iniciar o servidor
app.listen(PORT, () => {
  console.log(`🔊 Servidor rodando na porta ${PORT}`);
  if (!DISCORD_BOT_TOKEN) {
    console.warn("AVISO: DISCORD_BOT_TOKEN não está configurado. A funcionalidade de buscar usuários não encontrados no DB diretamente do Discord estará desabilitada.");
  }
});
