const express = require('express');
const bodyParser = require('body-parser');

const app = express();
const PORT = process.env.PORT || 3000;

// VERIFY TOKEN - vamos usar esse mesmo no Meta for Developers
const VERIFY_TOKEN = process.env.VERIFY_TOKEN || 'move_driver_bot';

// para ler JSON do webhook
app.use(bodyParser.json());

// Rota raiz só pra testar se está online
app.get('/', (req, res) => {
  res.send('🚕 Move Driver WhatsApp Bot está rodando.');
});

// GET /webhook -> usado SOMENTE na verificação do Meta
app.get('/webhook', (req, res) => {
  const mode = req.query['hub.mode'];
  const token = req.query['hub.verify_token'];
  const challenge = req.query['hub.challenge'];

  console.log('GET /webhook recebido', { mode, token, challenge });

  if (mode === 'subscribe' && token === VERIFY_TOKEN) {
    // deu certo, responde o challenge
    return res.status(200).send(challenge);
  } else {
    return res.sendStatus(403);
  }
});

// POST /webhook -> aqui depois vamos tratar as mensagens do WhatsApp
app.post('/webhook', (req, res) => {
  console.log('POST /webhook BODY:');
  console.log(JSON.stringify(req.body, null, 2));

  // Por enquanto, só confirma pro Meta que recebemos
  res.sendStatus(200);
});

// Sobe o servidor
app.listen(PORT, () => {
  console.log(`Servidor rodando na porta ${PORT}`);
});
