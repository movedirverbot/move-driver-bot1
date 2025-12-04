const express = require('express');
const bodyParser = require('body-parser');
const axios = require('axios');

const app = express();
const PORT = process.env.PORT || 3000;

// Token permanente do WhatsApp vindo das variáveis de ambiente do Render
const WHATSAPP_TOKEN = process.env.WHATSAPP_TOKEN;

// Verify token do webhook (tem que ser igual ao do Meta)
const VERIFY_TOKEN = process.env.VERIFY_TOKEN || 'move_driver_bot';

console.log('VERIFY_TOKEN em uso:', VERIFY_TOKEN);

app.use(bodyParser.json());

// Rota raiz só pra teste
app.get('/', (req, res) => {
  res.send('🚕 Move Driver WhatsApp Bot conectado e funcionando (move-driver-bot1).');
});

// GET /webhook - verificação do Meta
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

// Função para enviar mensagem via WhatsApp Cloud API
async function enviarMensagemWhatsApp(numero, texto) {
  try {
    // Usa o SEU Phone Number ID real
    const url = "https://graph.facebook.com/v20.0/950609308124879/messages";

    await axios.post(
      url,
      {
        messaging_product: "whatsapp",
        to: numero,
        type: "text",
        text: {
          body: texto
        }
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
    console.error("Erro ao enviar mensagem:");
    if (error.response) {
      console.error(JSON.stringify(error.response.data, null, 2));
    } else {
      console.error(error.message);
    }
  }
}

// POST /webhook - recebe mensagens do WhatsApp
app.post('/webhook', async (req, res) => {
  try {
    const body = req.body;

    console.log('POST /webhook recebido:');
    console.log(JSON.stringify(body, null, 2));

    if (body.object === 'whatsapp_business_account') {
      const entry = body.entry && body.entry[0];
      const changes = entry && entry.changes && entry.changes[0];
      const value = changes && changes.value;
      const messages = value && value.messages;

      if (messages && messages[0]) {
        const msg = messages[0];
        const from = msg.from; // número de quem mandou
        const text = msg.text && msg.text.body ? msg.text.body : '';

        console.log('Mensagem recebida de', from, ':', text);

        // Por enquanto, uma resposta simples
        const resposta = '🚕 Bot da Move Driver está online! Em breve vou lançar corridas direto aqui 😉';

        await enviarMensagemWhatsApp(from, resposta);
      }
    }

    res.sendStatus(200);

  } catch (err) {
    console.error('Erro no processamento do webhook:', err);
    res.sendStatus(500);
  }
});

// Sobe o servidor
app.listen(PORT, () => {
  console.log(`Servidor rodando na porta ${PORT}`);
});
