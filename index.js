const express = require('express');
const bodyParser = require('body-parser');
const axios = require('axios');

const app = express();
const PORT = process.env.PORT || 3000;

// Tokens / configs do WhatsApp
const WHATSAPP_TOKEN = process.env.WHATSAPP_TOKEN;
const VERIFY_TOKEN = process.env.VERIFY_TOKEN || 'move_driver_bot';

// Config da API externa Move Driver (via Render)
const MOVEDRIVER_API_URL = process.env.MOVEDRIVER_API_URL;       // ex: https://webapiexterna.azurewebsites.net/movedriver/api/external/CriarSolicitacaoViagem
const MOVEDRIVER_BASIC_AUTH = process.env.MOVEDRIVER_BASIC_AUTH; // ex: Basic SEU_BASE64

// IDs fixos (IDs reais da DevBase)
// Cliente padrão: CENTRAL WHATSAPP
const CLIENTE_ID = 1;

// Serviço padrão de corrida (informado por você)
const SERVICO_ITEM_ID_VIAGEM = 250;

// TipoPagamentoID aceito via integração (informado: 5)
const TIPO_PAGAMENTO_DINHEIRO = 5;

// Dados padrão de cidade/estado/CEP
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
    const url = 'https://graph.facebook.com/v20.0/950609308124879/messages';

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
// Formato esperado:
//
// /corrida
// Origem: Rua X, 123 - Centro
// Destino: Supermercado ABC
// Obs: Alguma observação (opcional)
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

  try {
    const resp = await axios.post(MOVEDRIVER_API_URL, payload, {
      headers: {
        Authorization: MOVEDRIVER_BASIC_AUTH,
        'Content-Type': 'application/json'
      },
      timeout: 15000
    });

    const data = resp.data;
    console.log('Resposta da API Move Driver:', JSON.stringify(data, null, 2));

    if (data.Resultado) {
      if (!data.Resultado.ok) {
        const msgErro =
          data.Resultado.resultado?.mensagemErro ||
          data.Resultado.descricao ||
          'Erro desconhecido';
        const codigo = data.Resultado.resultado?.codigo;
        const erroFormatado = codigo ? `${codigo} - ${msgErro}` : msgErro;
        throw new Error(erroFormatado);
      }

      const resultado = data.Resultado.resultado || {};
      return {
        solicitacaoId: resultado.SolicitacaoID,
        dataHoraCriacao: resultado.DataHoraCriacao
      };
    }

    if (data.message) {
      throw new Error(data.message);
    }

    return {
      solicitacaoId: data.SolicitacaoID || 0,
      dataHoraCriacao: data.DataHoraCriacao || null
    };
  } catch (error) {
    if (error.response) {
      const status = error.response.status;
      const data = error.response.data;
      console.error('Erro da API (status ' + status + '):', JSON.stringify(data, null, 2));

      let msg = '';

      if (data?.Resultado) {
        const msgErro =
          data.Resultado.resultado?.mensagemErro ||
          data.Resultado.descricao ||
          'Erro desconhecido';
        const codigo = data.Resultado.resultado?.codigo;
        msg = codigo ? `${codigo} - ${msgErro}` : msgErro;
      } else if (data?.message) {
        msg = data.message;
      } else {
        msg = 'Erro ao chamar API (status ' + status + ')';
      }

      throw new Error(msg);
    } else {
      throw new Error(error.message || 'Erro na comunicação com a API');
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
        const from = msg.from;
        const text = msg.text && msg.text.body ? msg.text.body : '';

        console.log('Mensagem recebida de', from, ':', text);

        if (text.toLowerCase().startsWith('/corrida')) {
          const dados = parseCorrida(text);

          if (!dados || !dados.origem || !dados.destino) {
            await enviarMensagemWhatsApp(
              from,
              '❌ Faltam dados.\n\nUse o modelo:\n/corrida\nOrigem: ...\nDestino: ...\nObs: (opcional)'
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
              await enviarMensagemWhatsApp(
                from,
                `⚠️ Não consegui criar a corrida.\nMotivo: ${erroApi.message}`
              );
            }
          }
        } else {
          await enviarMensagemWhatsApp(
            from,
            '🚕 *Move Driver Bot Online*\n\nUse:\n/corrida\nOrigem: ...\nDestino: ...\nObs: ...'
          );
        }
      }
    }

    res.sendStatus(200);
  } catch (err) {
    console.error('Erro no webhook:', err);
    res.sendStatus(500);
  }
});

app.listen(PORT, () => {
  console.log(`Servidor rodando na porta ${PORT}`);
});
