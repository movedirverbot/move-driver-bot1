const express = require('express');
const bodyParser = require('body-parser');

const app = express();
const PORT = process.env.PORT || 3000;

// VERIFY TOKEN - tem que ser IGUAL ao que você colocar no Meta for Developers
const VERIFY_TOKEN = process.env.VERIFY_TOKEN || 'move_driver_bot';
console.log('VERIFY_TOKEN em uso:', VERIFY_TOKEN);

// para ler JSON do webhook
app.use(bodyParser.json());

// Rota raiz só pra testar no navegador
app.get('/', (req, res) => {
  res.send('🚕 Move Driver WhatsApp Bot está rodando (move-driver-bot1).');
});

// GET /webhook -> usado SOMENTE na verificação do Meta
app.get('/webhook', (req, res) => {
  const mode = req.query['hub.mode'];
  const token = req.query['hub.verify_token'];
  const challenge = req.query['hub.challenge'];

  console.log('GET /webhook recebido:', { mode, token, challenge });

  if (mode === 'subscribe' && token === VERIFY_TOKEN) {
    // Se o token bater, devolve o challenge
    return res.status(200).send(challenge);
  } else {
    // Se não bater, o Meta recebe 403 e fala que não validou
    return res.sendStatus(403);
  }
});

// POST /webhook -> aqui depois vamos tratar as mensagens do WhatsApp
app.post('/webhook', (req, res) => {
  console.log('POST /webhook BODY:');
  console.log(JSON.stringify(req.body, null, 2));

  // Por enquanto só confirma pro Meta que recebemos
  res.sendStatus(200);
});

// Sobe o servidor
app.listen(PORT, () => {
  console.log(`Servidor rodando na porta ${PORT}`);
});
