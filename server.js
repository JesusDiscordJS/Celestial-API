import express from "express";
import mongoose from "mongoose";
import cors from "cors";
import dotenv from "dotenv";

dotenv.config();

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());

// Conectar ao MongoDB
mongoose.connect(process.env.MONGO_URI, {
  dbName: "discordAvatares", // Certifique-se que este é o nome correto do banco
}).then(() => console.log("✅ MongoDB conectado"))
  .catch((err) => console.error("❌ Erro ao conectar:", err));

// Schema do avatar COMPLETO
const avatarSchema = new mongoose.Schema({
  userId: String,
  usernames: [String], // Adicionado
  avatars: [String],
  lastJoinCall: {      // Adicionado
    channelId: String,
    timestamp: Date,
  },
  lastLeaveCall: {     // Adicionado
    channelId: String,
    timestamp: Date,
  },
  // Se você tiver o campo __v (versionKey), pode deixar o Mongoose gerenciá-lo
  // ou explicitamente adicionar: __v: Number se quiser lê-lo,
  // mas geralmente não é necessário enviá-lo na resposta da API.
});

const AvatarModel = mongoose.model("Avatar", avatarSchema); // "Avatar" mapeia para a coleção "avatars"

// Rota para buscar dados do usuário por ID
app.get("/api/avatars/:id", async (req, res) => {
  try {
    const user = await AvatarModel.findOne({ userId: req.params.id });
    if (!user) {
      return res.status(404).json({ error: "Usuário não encontrado" }); // Mudado 'message' para 'error' para consistência, opcional
    }
    
    // Enviar todos os dados relevantes
    res.json({
      userId: user.userId,
      usernames: user.usernames || [], // Envia array vazio se não houver usernames
      avatars: user.avatars || [],   // Envia array vazio se não houver avatars
      lastJoinCall: user.lastJoinCall, // Envia o objeto ou null se não existir
      lastLeaveCall: user.lastLeaveCall // Envia o objeto ou null se não existir
    });

  } catch (err) {
    console.error("Erro na rota /api/avatars/:id :", err); // Log do erro no servidor
    res.status(500).json({ error: "Erro interno no servidor" }); // Mudado 'message' para 'error'
  }
});

// Página padrão
app.get("/", (req, res) => {
  res.send("🚀 API de Dados de Usuários do Discord está online!");
});

app.listen(PORT, () => {
  console.log(`🔊 Servidor rodando na porta ${PORT}`);
});
