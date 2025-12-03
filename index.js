const express = require('express');
const bodyParser = require('body-parser');
const axios = require('axios');

const app = express();
const PORT = process.env.PORT || 3000;

// TOKEN DO META (para enviar mensagens)
const WHATSAPP_TOKEN = process.env.WHATSAPP_TOKEN;

// VERIFY TOKEN para o webhook
const VERIFY_TOKEN = process.env.VERIFY_TOKEN || 'move_driver_bot';

console.log('VERIFY_TOKEN em uso:', VERIFY_TOKEN);

app.use(bodyParser.json());

// Rota raiz
app.get('/', (req, res) => {
  res.send('🚕 Move Driver WhatsApp Bot conectado e funcionando.');
});

// GET /webhook - Verificação do Meta
app.get('/webhook', (req, res) => {
  const mode = req.query['hub.mode'];
  const token = req.query['hub.verify_token'];
  const challenge = req.query['hub.challenge'];

  if (mode === 'subscribe' && token === VERIFY_TOKEN) {
    return res.status(200).send(challenge);
  } else {
    return res.sendStatus(403);
  }
});

// Função para enviar mensagem via WhatsApp API
async function enviarMensagemWhatsApp(numero, texto) {
  try {
    const url = "https://graph.facebook.com/v20.0/PHONE_NUMBER_ID/messages";

    await axios.post(
      url,
      {
        messaging_product: "whatsapp",
        to: numero,
        type: "text",
        text: { body: texto }
      },
      {
        headers: {
          Authorization: `Bearer ${WHATSAPP_TOKEN}`,
          "Content-Type": "application/json"
        }
      }
    );

    console.log("Mensagem enviada para:", numero);

  } catch (error) {
    console.error("Erro ao enviar mensagem:", error.response?.data || error);
  }
}

// POST /webhook - Recebe mensagens do WhatsApp
app.post('/webhook', async (req, res) => {
  try {
    const body = req.body;

    if (body.object === "whatsapp_business_account") {
      const mensagem = body.entry?.[0]?.changes?.[0]?.value?.messages?.[0];

      if (mensagem) {
        const numero = mensagem.from;
        const texto = mensagem.text?.body || "";

        console.log("Mensagem recebida:", texto);

        // Resposta automática
        await enviarMensagemWhatsApp(numero, "🚕 Bot da Move Driver está online! Como posso ajudar?");
      }
    }

    res.sendStatus(200);

  } catch (err) {
    console.error("Erro no webhook:", err);
    res.sendStatus(500);
  }
});

app.listen(PORT, () => {
  console.log(`Servidor rodando na porta ${PORT}`);
});
