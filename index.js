const express = require('express');
const bodyParser = require('body-parser');
const axios = require('axios');

const app = express();
const PORT = process.env.PORT || 3000;

// Tokens / configs do WhatsApp
const WHATSAPP_TOKEN = process.env.WHATSAPP_TOKEN;
const VERIFY_TOKEN = process.env.VERIFY_TOKEN || 'move_driver_bot';

// URL completa para criar solicitação (env no Render)
// Ex: https://webapiexterna.azurewebsites.net/movedriver/api/external/CriarSolicitacaoViagem
const MOVEDRIVER_API_URL = process.env.MOVEDRIVER_API_URL;

// Auth da API externa Move Driver (env no Render)
// Ex: Basic SEU_BASE64_DE_USUARIO:SENHA
const MOVEDRIVER_BASIC_AUTH = process.env.MOVEDRIVER_BASIC_AUTH;

// Base da API externa (usada para EtapaSolicitacao)
// Se não tiver env, usa a padrão da Move Driver
const MOVEDRIVER_BASE_URL =
  process.env.MOVEDRIVER_BASE_URL ||
  'https://webapiexterna.azurewebsites.net/movedriver/api/external/';

// IDs fixos reais da DevBase
const CLIENTE_ID = 1;              // Cliente "CENTRAL WHATSAPP"
const SERVICO_ITEM_ID_VIAGEM = 250; // Serviço padrão de corrida
const TIPO_PAGAMENTO_DINHEIRO = 5;  // TipoPagamentoID aceito via integração

// Dados padrão de cidade/estado/CEP
const DEFAULT_CIDADE = 'Coromandel';
const DEFAULT_UF = 'MG';
const DEFAULT_CEP = '38550000';

// Phone Number ID do WhatsApp (fixo, o seu)
const PHONE_NUMBER_ID = '950609308124879';

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
    const url = `https://graph.facebook.com/v20.0/${PHONE_NUMBER_ID}/messages`;

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

// Monitorar EtapaSolicitacao para avisos:
// - motorista aceitou (já temos)
// - não encontrou motorista
// - motorista cancelou depois de aceitar
// - viagem demorou mais de 30min para finalizar
function startMonitoringSolicitacao(solicitacaoId, whatsappFrom) {
  const intervaloMs = 20000; // 20s (respeita limite de 15s da DevBase)
  const maxMinutos = 40;     // tempo máximo monitorando ~40min
  const maxTentativas = Math.ceil((maxMinutos * 60 * 1000) / intervaloMs);

  let tentativas = 0;
  let hasDriver = false;
  let driverAcceptedAt = null;
  let sentDriverInfo = false;
  let sentNoDriver = false;
  let sentDriverCanceled = false;
  let sentTooLong = false;
  let sentFinalizada = false;

  console.log(`Iniciando monitoramento da solicitação ${solicitacaoId} para ${whatsappFrom}`);

  const interval = setInterval(async () => {
    tentativas++;

    try {
      const url = `${MOVEDRIVER_BASE_URL}EtapaSolicitacao?solicitacaoID=${solicitacaoId}`;

      const resp = await axios.get(url, {
        headers: {
          Authorization: MOVEDRIVER_BASIC_AUTH
        },
        timeout: 15000
      });

      const etapaObj = resp.data?.EtapaSolicitacao || resp.data || {};
      console.log(`EtapaSolicitacao ${solicitacaoId}:`, JSON.stringify(etapaObj, null, 2));

      const Etapa = etapaObj.Etapa;
      const StatusSolicitacao = etapaObj.StatusSolicitacao || '';
      const NomePrestador = etapaObj.NomePrestador || '';
      const Veiculo = etapaObj.Veiculo || '';
      const Placa = etapaObj.Placa || '';
      const Cor = etapaObj.Cor || '';
      const ViagemFinalizada = !!etapaObj.ViagemFinalizada;

      const statusLower = StatusSolicitacao.toLowerCase();

      // 1) Motorista aceitou (primeira vez)
      if (!hasDriver && NomePrestador && Veiculo && Placa && Etapa >= 2) {
        hasDriver = true;
        driverAcceptedAt = Date.now();

        if (!sentDriverInfo) {
          const msg =
            `✅ CORRIDA ACEITA\n\n` +
            `Solicitação: ${solicitacaoId}\n` +
            `Status: ${StatusSolicitacao}\n\n` +
            `Motorista: ${NomePrestador}\n` +
            `Carro: ${Veiculo}${Cor ? ' (' + Cor + ')' : ''}\n` +
            `Placa: ${Placa}`;
          await enviarMensagemWhatsApp(whatsappFrom, msg);
          sentDriverInfo = true;
        }
      }

      // 2) Nenhum motorista encontrado (mensagem de status indicando isso)
      if (
        !hasDriver &&
        !sentNoDriver &&
        statusLower &&
        (
          statusLower.includes('sem motorista') ||
          statusLower.includes('sem prestador') ||
          statusLower.includes('não foi possível encontrar') ||
          statusLower.includes('nao foi possivel encontrar')
        )
      ) {
        const msg =
          `⚠️ Nenhum motorista foi encontrado para a solicitação ${solicitacaoId}.\n` +
          `Status: ${StatusSolicitacao}\n\n` +
          `Verifique no painel se deseja reabrir ou criar uma nova solicitação.`;
        await enviarMensagemWhatsApp(whatsappFrom, msg);
        sentNoDriver = true;
        clearInterval(interval);
        return;
      }

      // 2b) fallback: muito tempo sem motorista (ex: 15min) e ainda sem prestador
      const tempoTotalMs = tentativas * intervaloMs;
      if (!hasDriver && !sentNoDriver && tempoTotalMs > 15 * 60 * 1000) {
        const msg =
          `⚠️ Atenção: já se passaram mais de 15 minutos e ainda não há motorista aceitando a solicitação ${solicitacaoId}.\n` +
          `Status atual: ${StatusSolicitacao || 'indisponível'}\n\n` +
          `Verifique no painel se está tudo certo ou se precisa abrir outra corrida.`;
        await enviarMensagemWhatsApp(whatsappFrom, msg);
        sentNoDriver = true;
        // ainda deixamos monitorar por mais um tempo, caso alguém aceite depois
      }

      // 3) Motorista cancelou depois de ter aceitado
      if (
        hasDriver &&
        !sentDriverCanceled &&
        statusLower.includes('cancelad')
      ) {
        const msg =
          `⚠️ O motorista cancelou a corrida.\n` +
          `Solicitação: ${solicitacaoId}\n` +
          `Status: ${StatusSolicitacao}`;
        await enviarMensagemWhatsApp(whatsappFrom, msg);
        sentDriverCanceled = true;
        clearInterval(interval);
        return;
      }

      // 4) Viagem demorando mais de 30min depois de aceita
      if (
        hasDriver &&
        driverAcceptedAt &&
        !sentTooLong &&
        !ViagemFinalizada
      ) {
        const elapsedMs = Date.now() - driverAcceptedAt;
        if (elapsedMs > 30 * 60 * 1000) {
          const msg =
            `⏱ Atenção: a viagem da solicitação ${solicitacaoId} está em andamento há mais de 30 minutos.\n` +
            `Status atual: ${StatusSolicitacao || 'indisponível'}\n\n` +
            `Verifique no painel se está tudo bem com o motorista e o cliente.`;
          await enviarMensagemWhatsApp(whatsappFrom, msg);
          sentTooLong = true;
        }
      }

      // 5) Viagem finalizada
      if (ViagemFinalizada && !sentFinalizada) {
        const msg =
          `✅ Viagem da solicitação ${solicitacaoId} foi finalizada.\n` +
          `Status final: ${StatusSolicitacao}`;
        await enviarMensagemWhatsApp(whatsappFrom, msg);
        sentFinalizada = true;
        clearInterval(interval);
        return;
      }

    } catch (err) {
      console.error(
        `Erro ao consultar EtapaSolicitacao ${solicitacaoId}:`,
        err.response?.data || err.message
      );
    }

    if (tentativas >= maxTentativas) {
      console.log(
        `Parando monitoramento da solicitação ${solicitacaoId} por tempo máximo.`
      );
      await enviarMensagemWhatsApp(
        whatsappFrom,
        `ℹ️ Encerrado o monitoramento automático da solicitação ${solicitacaoId} após aproximadamente ${maxMinutos} minutos.\nVerifique o painel para mais detalhes.`
      );
      clearInterval(interval);
    }
  }, intervaloMs);
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
              '❌ Faltam dados.\n\nUse o modelo:\n/corrida\nOrigem: Rua tal, 123\nDestino: Outra rua, 456\nObs: (opcional)'
            );
          } else {
            try {
              await enviarMensagemWhatsApp(
                from,
                '⏳ Criando solicitação de corrida na plataforma...'
              );

              const resultado = await criarSolicitacaoViagem(dados);

              const solicitacaoId = resultado.solicitacaoId;

              await enviarMensagemWhatsApp(
                from,
                `✅ Corrida criada com sucesso!\n` +
                `Cliente: CENTRAL WHATSAPP\n` +
                `ID da solicitação: ${solicitacaoId}\n` +
                `Origem: ${dados.origem}\n` +
                `Destino: ${dados.destino}\n` +
                `Pagamento: Dinheiro\n\n` +
                `Vou te avisar assim que um motorista aceitar ou se não for encontrado motorista.`
              );

              // Inicia monitoramento da EtapaSolicitacao para essa corrida
              if (solicitacaoId) {
                startMonitoringSolicitacao(solicitacaoId, from);
              }
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
            '🚕 *Move Driver Bot Online*\n\n' +
            'Para lançar uma corrida, use o comando:\n/corrida\n' +
            'Origem: ...\nDestino: ...\nObs: ... (opcional)'
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
