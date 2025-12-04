const express = require('express');
const bodyParser = require('body-parser');
const axios = require('axios');

const app = express();
const PORT = process.env.PORT || 3000;

// Tokens / configs do WhatsApp
const WHATSAPP_TOKEN = process.env.WHATSAPP_TOKEN;
const VERIFY_TOKEN = process.env.VERIFY_TOKEN || 'move_driver_bot';

// Config da API externa Move Driver
const MOVEDRIVER_API_URL = process.env.MOVEDRIVER_API_URL;
const MOVEDRIVER_BASIC_AUTH = process.env.MOVEDRIVER_BASIC_AUTH;

// IDs fixos (ajuste depois se precisar)
const CLIENTE_ID = 3;              // ID do cliente "CENTRAL WHATSAPP" na DevBase
const SERVICO_ITEM_ID_VIAGEM = 5;  // ID do tipo de serviço (corrida padrão)
const TIPO_PAGAMENTO_DINHEIRO = 1; // ID da forma de pagamento em DINHEIRO

const DEFAULT_CIDADE = 'Coromandel';
const DEFAULT_UF = 'MG';
const DEFAULT_CEP = '38550000';

console.log('VERIFY_TOKEN em uso:', VERIFY_TOKEN);

app.use(bodyParser.json());

// Rota raiz
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

// Enviar mensagem pelo WhatsApp API
async function enviarMensagemWhatsApp(numero, texto) {
  try {
    const url = 'https://graph.facebook.com/v20.0/950609308124879/messages'; // seu Phone Number ID

    await axios.post(
      url,
      {
        messaging_product: 'whatsapp',
        to: numero,
        type: 'text',
        text: {
          body: texto
        }
      },
      {
        headers: {
          Authorization: `Bearer ${WHATSAPP_TOKEN}`,
          'Content-Type': 'application/json'
        }
      }
    );

    console.log('Mensagem enviada para:', numero);
  } catch (error) {
    console.error('Erro ao enviar mensagem:');
    if (error.response) {
      console.error(JSON.stringify(error.response.data, null, 2));
    } else {
      console.error(error.message);
    }
  }
}

// Parse simples do comando /corrida
function parseCorrida(texto) {
  if (!texto) return null;

  const linhas = texto
    .split('\n')
    .map(l => l.trim())
    .filter(Boolean);

  if (linhas.length === 0 || !linhas[0].toLowerCase().startsWith('/corrida')) {
    return null;
  }

  const dados = {
    origem: '',
    destino: '',
    observacoes: ''
  };

  for (let i = 1; i < linhas.length; i++) {
    const linha = linhas[i];
    const [chaveRaw, ...resto] = linha.split(':');
    if (!resto.length) continue;

    const valor = resto.join(':').trim();
    const chave = chaveRaw.toLowerCase();

    if (chave.includes('origem')) {
      dados.origem = valor;
    } else if (chave.includes('destino')) {
      dados.destino = valor;
    } else if (chave.startsWith('obs')) {
      dados.observacoes = valor;
    }
  }

  return dados;
}

// Chamar API externa para criar solicitação
async function criarSolicitacaoViagem(dadosCorrida) {
  if (!MOVEDRIVER_API_URL) {
    throw new Error('MOVEDRIVER_API_URL não configurada.');
  }
  if (!MOVEDRIVER_BASIC_AUTH) {
    throw new Error('MOVEDRIVER_BASIC_AUTH não configurada.');
  }

  const payload = {
    ClienteID: CLIENTE_ID,
    ServicoItemID: SERVICO_ITEM_ID_VIAGEM,
    TipoPagamentoID: TIPO_PAGAMENTO_DINHEIRO,
    enderecoOrigem: {
      Endereco: dadosCorrida.origem,
      CEP: DEFAULT_CEP,
      Cidade: DEFAULT_CIDADE,
      EstadoSigla: DEFAULT_UF,
      Observacao: dadosCorrida.observacoes || ''
    },
    lstDestino: [
      {
        Endereco: dadosCorrida.destino,
        CEP: DEFAULT_CEP,
        Cidade: DEFAULT_CIDADE,
        EstadoSigla: DEFAULT_UF,
        Observacao: ''
      }
    ]
  };

  console.log('Enviando para API Move Driver:', JSON.stringify(payload, null, 2));

  const resp = await axios.post(MOVEDRIVER_API_URL, payload, {
    headers: {
      Authorization: MOVEDRIVER_BASIC_AUTH,
      'Content-Type': 'application/json'
    },
    timeout: 15000
  });

  const data = resp.data;
  console.log('Resposta da API Move Driver:', JSON.stringify(data, null, 2));

  if (!data.Resultado || !data.Resultado.ok) {
    const msgErro =
      data.Resultado?.resultado?.mensagemErro ||
      data.Resultado?.descricao ||
      'Erro desconhecido';

    const codigo = data.Resultado?.resultado?.codigo;
    const erroFormatado = codigo ? `${codigo} - ${msgErro}` : msgErro;

    throw new Error(`Falha ao criar solicitação: ${erroFormatado}`);
  }

  const resultado = data.Resultado.resultado;

  return {
    solicitacaoId: resultado.SolicitacaoID,
    dataHoraCriacao: resultado.DataHoraCriacao
  };
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
        const from = msg.from;
        const text = msg.text && msg.text.body ? msg.text.body : '';

        console.log('Mensagem recebida de', from, ':', text);

        if (text.toLowerCase().startsWith('/corrida')) {
          const dados = parseCorrida(text);

          if (!dados || !dados.origem || !dados.destino) {
            await enviarMensagemWhatsApp(
              from,
              '❌ Faltam dados na solicitação.\n\nUse o modelo:\n/corrida\nOrigem: Endereço de origem\nDestino: Endereço de destino\nObs: Alguma observação (opcional)'
            );
          } else {
            try {
              const resultado = await criarSolicitacaoViagem(dados);

              await enviarMensagemWhatsApp(
                from,
                `✅ Corrida criada com sucesso!\n` +
                `Cliente: CENTRAL WHATSAPP\n` +
                `ID da solicitação: ${resultado.solicitacaoId}\n` +
                `Origem: ${dados.origem}\n` +
                `Destino: ${dados.destino}\n` +
                `Pagamento: Dinheiro`
              );
            } catch (erroApi) {
              console.error('Erro ao criar solicitação na API Move Driver:', erroApi.message);
              await enviarMensagemWhatsApp(
                from,
                `⚠️ Não consegui criar a corrida na plataforma.\nMotivo: ${erroApi.message}`
              );
            }
          }
        } else {
          const respostaPadrao =
            '🚕 Bot da Move Driver está online!\n\n' +
            'Para lançar uma corrida, use o comando:\n/corrida\n' +
            'Origem: ...\nDestino: ...\nObs: ... (opcional)';

          await enviarMensagemWhatsApp(from, respostaPadrao);
        }
      }
    }

    res.sendStatus(200);
  } catch (err) {
    console.error('Erro no processamento do webhook:', err);
    res.sendStatus(500);
  }
});

app.listen(PORT, () => {
  console.log(`Servidor rodando na porta ${PORT}`);
});
