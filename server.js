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
  dbName: "discordAvatares",
}).then(() => console.log("✅ MongoDB conectado"))
  .catch((err) => console.error("❌ Erro ao conectar:", err));

// Schema do avatar
const avatarSchema = new mongoose.Schema({
  userId: String,
  avatars: [String],
});
const AvatarModel = mongoose.model("Avatar", avatarSchema);

// Rota para buscar avatares por ID
app.get("/api/avatars/:id", async (req, res) => {
  try {
    const user = await AvatarModel.findOne({ userId: req.params.id });
    if (!user) return res.status(404).json({ message: "Usuário não encontrado" });
    res.json({ userId: user.userId, avatars: user.avatars });
  } catch (err) {
    res.status(500).json({ message: "Erro interno no servidor" });
  }
});

// Página padrão
app.get("/", (req, res) => {
  res.send("🚀 API de Avatares do Discord está online!");
});

app.listen(PORT, () => {
  console.log(`🔊 Servidor rodando na porta ${PORT}`);
});
