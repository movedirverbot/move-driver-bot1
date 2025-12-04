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
const MOVEDRIVER_BASE_URL =
  process.env.MOVEDRIVER_BASE_URL ||
  'https://webapiexterna.azurewebsites.net/movedriver/api/external/';

// IDs fixos reais da DevBase
const CLIENTE_ID = 1;               // Cliente "CENTRAL WHATSAPP"
const SERVICO_ITEM_ID_VIAGEM = 250; // Serviço padrão de corrida
const TIPO_PAGAMENTO_DINHEIRO = 5;  // TipoPagamentoID via integração

// Dados padrão de cidade/estado/CEP
const DEFAULT_CIDADE = 'Coromandel';
const DEFAULT_UF = 'MG';
const DEFAULT_CEP = '38550000';

// Phone Number ID do WhatsApp (o seu)
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

// -------------------------
// Parse do comando /corrida
// -------------------------
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

// -----------------------------
// Criar solicitação na DevBase
// -----------------------------
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

// -----------------------------------------
// Monitorar EtapaSolicitacao (DevBase)
// -----------------------------------------
//
// Status informados:
// - aguardando motorista      -> Motorista aceitou e está indo pegar o cliente
// - em viagem                 -> Motorista pegou o cliente e está indo ao destino
// - cancelado pelo adiministrador
// - cancelado pelo administrador
// - cancelado pelo cliente
// - cancelado pelo sistema
// - cancelado pelo motorista
// - excedeu tentativas        -> Não encontrou motorista
// - viagem finalizada         -> Fim da corrida
//
// OBJETIVO: depois que criar a solicitação, ficar monitorando até
// viagem finalizada / cancelamento / excedeu tentativas,
// e avisar SEMPRE que o status mudar.
//
function startMonitoringSolicitacao(solicitacaoId, whatsappFrom) {
  const intervaloMs = 20000;     // 20s (respeita limite de 15s)
  const maxMinutos = 360;        // ~6 horas de monitoramento por segurança
  const maxTentativas = Math.ceil((maxMinutos * 60 * 1000) / intervaloMs);

  let tentativas = 0;

  let hasDriver = false;
  let driverAcceptedAt = null;
  let sentDriverInfo = false;
  let sentNoDriver = false;
  let sentDriverCanceled = false;
  let sentTooLong = false;
  let sentFinalizada = false;
  let sentEmViagem = false;

  let lastStatusLower = ''; // para detectar mudança de status

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
      const StatusSolicitacao = (etapaObj.StatusSolicitacao || '').trim();
      const NomePrestador = etapaObj.NomePrestador || '';
      const Veiculo = etapaObj.Veiculo || '';
      const Placa = etapaObj.Placa || '';
      const Cor = etapaObj.Cor || '';
      const ViagemFinalizada = !!etapaObj.ViagemFinalizada;

      const statusLower = StatusSolicitacao.toLowerCase();

      // 0) Aviso genérico SEMPRE que o status mudar (exceto na primeira vez sem status)
      if (statusLower && statusLower !== lastStatusLower) {
        // Não duplicar mensagem quando vamos mandar uma mensagem especial
        const especiais = [
          'aguardando motorista',
          'em viagem',
          'excedeu tentativas',
          'cancelado pelo adiministrador',
          'cancelado pelo administrador',
          'cancelado pelo cliente',
          'cancelado pelo sistema',
          'cancelado pelo motorista',
          'viagem finalizada'
        ];

        if (!especiais.includes(statusLower)) {
          await enviarMensagemWhatsApp(
            whatsappFrom,
            `🔄 Status atualizado da solicitação ${solicitacaoId}: ${StatusSolicitacao}`
          );
        }

        lastStatusLower = statusLower;
      }

      // 1) Motorista aceitou
      //
      // Regra que você explicou:
      // "aguardando motorista" = motorista já aceitou e está indo buscar
      if (
        !hasDriver &&
        (
          statusLower === 'aguardando motorista' ||
          (NomePrestador && Veiculo && Placa && Etapa >= 2)
        )
      ) {
        hasDriver = true;
        if (!driverAcceptedAt) {
          driverAcceptedAt = Date.now();
        }

        if (!sentDriverInfo) {
          const msg =
            `✅ CORRIDA ACEITA\n\n` +
            `Solicitação: ${solicitacaoId}\n` +
            `Status: ${StatusSolicitacao}\n\n` +
            `Motorista: ${NomePrestador || 'não informado'}\n` +
            `Carro: ${Veiculo || 'não informado'}${Cor ? ' (' + Cor + ')' : ''}\n` +
            `Placa: ${Placa || 'não informada'}`;
          await enviarMensagemWhatsApp(whatsappFrom, msg);
          sentDriverInfo = true;
        }

        // Também consideramos isso como mudança de status relevante
        if (statusLower !== lastStatusLower) {
          lastStatusLower = statusLower;
        }
      }

      // 2) Motorista está "em viagem" (já pegou o cliente)
      if (
        statusLower === 'em viagem' &&
        hasDriver &&
        !sentEmViagem
      ) {
        const msg =
          `🚗 A viagem da solicitação ${solicitacaoId} está EM VIAGEM.\n` +
          `O motorista já pegou o cliente e está indo ao destino.`;
        await enviarMensagemWhatsApp(whatsappFrom, msg);
        sentEmViagem = true;
        lastStatusLower = statusLower;
      }

      // 3) Nenhum motorista encontrado
      // Somente quando o sistema marcar "excedeu tentativas"
      if (!hasDriver && !sentNoDriver && statusLower === 'excedeu tentativas') {
        const msg =
          `⚠️ Nenhum motorista foi encontrado para a solicitação ${solicitacaoId}.\n` +
          `Status: ${StatusSolicitacao}\n\n` +
          `Verifique no painel se deseja reabrir ou criar uma nova corrida.`;
        await enviarMensagemWhatsApp(whatsappFrom, msg);
        sentNoDriver = true;
        clearInterval(interval);
        return;
      }

      // 4) Motorista cancelou depois de ter aceitado
      if (
        hasDriver &&
        !sentDriverCanceled &&
        statusLower === 'cancelado pelo motorista'
      ) {
        const msg =
          `⚠️ O motorista cancelou a corrida após ter aceitado.\n` +
          `Solicitação: ${solicitacaoId}\n` +
          `Status: ${StatusSolicitacao}`;
        await enviarMensagemWhatsApp(whatsappFrom, msg);
        sentDriverCanceled = true;
        clearInterval(interval);
        return;
      }

      // Outros cancelamentos (admin, cliente, sistema) – também avisar
      if (
        !sentDriverCanceled &&
        (
          statusLower === 'cancelado pelo adiministrador' ||
          statusLower === 'cancelado pelo administrador' ||
          statusLower === 'cancelado pelo cliente' ||
          statusLower === 'cancelado pelo sistema'
        )
      ) {
        const msg =
          `ℹ️ Solicitação ${solicitacaoId} foi cancelada.\n` +
          `Motivo: ${StatusSolicitacao}`;
        await enviarMensagemWhatsApp(whatsappFrom, msg);
        sentDriverCanceled = true;
        clearInterval(interval);
        return;
      }

      // 5) Viagem demorando mais de 30min depois que o motorista aceitou
      if (hasDriver && driverAcceptedAt && !sentTooLong && !ViagemFinalizada) {
        const elapsedMs = Date.now() - driverAcceptedAt;
        if (elapsedMs > 30 * 60 * 1000) {
          const msg =
            `⏱ Atenção: a viagem da solicitação ${solicitacaoId} está em andamento há mais de 30 minutos desde que o motorista aceitou.\n` +
            `Status atual: ${StatusSolicitacao || 'indisponível'}\n\n` +
            `Verifique no painel se está tudo bem com o motorista e o cliente.`;
          await enviarMensagemWhatsApp(whatsappFrom, msg);
          sentTooLong = true;
        }
      }

      // 6) Viagem finalizada
      if (!sentFinalizada && (ViagemFinalizada || statusLower === 'viagem finalizada')) {
        const msg =
          `✅ Viagem da solicitação ${solicitacaoId} foi finalizada.\n` +
          `Status final: ${StatusSolicitacao || 'viagem finalizada'}`;
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
        `Parando monitoramento da solicitação ${solicitacaoId} por tempo máximo (~${maxMinutos}min).`
      );
      await enviarMensagemWhatsApp(
        whatsappFrom,
        `ℹ️ Encerrado o monitoramento automático da solicitação ${solicitacaoId} após aproximadamente ${maxMinutos} minutos.\nVerifique o painel para mais detalhes.`
      );
      clearInterval(interval);
    }
  }, intervaloMs);
}

// -------------------------
// WEBHOOK POST (WhatsApp)
// -------------------------
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
        // ---------------------------------------
// BLOQUEIO DE NÚMERO NÃO AUTORIZADO
// ---------------------------------------
const numeroAutorizado = "553492606729"; 
// Formato WhatsApp = 55 + DDD + número

if (from !== numeroAutorizado) {
  await enviarMensagemWhatsApp(from, "⚠️ Este número não está autorizado a usar este serviço.");
  return res.sendStatus(200);
}


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
                `Vou te avisar sempre que o status da solicitação mudar, até a viagem ser finalizada ou cancelada.`
              );

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
