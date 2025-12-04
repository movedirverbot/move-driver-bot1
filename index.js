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

// Base da API externa (usada para EtapaSolicitacao e CancelarSolicitacao)
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

// Número autorizado (seu WhatsApp) - formato enviado pela API
// Seu número (34) 9 9260-6729 chega como 553492606729
const NUMERO_AUTORIZADO = '553492606729';

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

// Enviar mensagem texto pelo WhatsApp API
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

// Enviar mensagem com botão de cancelar solicitação (texto customizado)
async function enviarMensagemWhatsAppComBotaoCancelar(numero, solicitacaoId, textoCorpo) {
  try {
    const url = `https://graph.facebook.com/v20.0/${PHONE_NUMBER_ID}/messages`;

    await axios.post(
      url,
      {
        messaging_product: 'whatsapp',
        to: numero,
        type: 'interactive',
        interactive: {
          type: 'button',
          body: {
            text: textoCorpo
          },
          action: {
            buttons: [
              {
                type: 'reply',
                reply: {
                  // id único baseado na solicitação -> garante cancelar só ela
                  id: `cancel_${solicitacaoId}`,
                  title: 'Cancelar solicitação'
                }
              }
            ]
          }
        }
      },
      {
        headers: {
          Authorization: `Bearer ${WHATSAPP_TOKEN}`,
          'Content-Type': 'application/json'
        }
      }
    );

    console.log('Mensagem com botão enviada para:', numero);
  } catch (error) {
    console.error('Erro ao enviar mensagem com botão:');
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

// Parser simples com " x " e valor opcional
function parseCorridaSimples(texto) {
  if (!texto) return null;

  // Usa " x " como separador (origem x destino x obs ... x valor)
  const partes = texto
    .split(' x ')
    .map(p => p.trim())
    .filter(Boolean);

  if (partes.length < 2) {
    return null;
  }

  const origem = partes[0];
  const destino = partes[1];

  let observacoes = '';
  let valor = null;

  for (let i = 2; i < partes.length; i++) {
    const p = partes[i];

    // Obs: prefixo "obs:"
    if (p.toLowerCase().startsWith('obs:')) {
      observacoes = p.slice(4).trim();
      continue;
    }

    // Tentativa de extrair valor numérico (R$ 30,00, 30,00, 25 etc.)
    let raw = p.toLowerCase();
    raw = raw.replace('r$', '').trim();
    raw = raw.split('(')[0].trim();   // remove qualquer coisa depois de "("
    raw = raw.split(' ')[0].trim();   // pega só o primeiro token

    raw = raw.replace(/\./g, '');     // remove pontos de milhar
    raw = raw.replace(',', '.');      // vírgula -> ponto

    const num = parseFloat(raw);
    if (!isNaN(num)) {
      valor = num;
    }
  }

  if (!origem || !destino) {
    return null;
  }

  return {
    origem,
    destino,
    observacoes,
    valor
  };
}

// Parser antigo (multi-linha com Origem:, Destino:, Obs:)
function parseCorridaAntigo(linhas) {
  const dados = {
    origem: '',
    destino: '',
    observacoes: '',
    valor: null
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
    } else if (chave.includes('valor')) {
      // Opcional: Valor: 30,00
      let raw = valor.toLowerCase().replace('r$', '').trim();
      raw = raw.replace(/\./g, '');
      raw = raw.replace(',', '.');
      const num = parseFloat(raw);
      if (!isNaN(num)) {
        dados.valor = num;
      }
    }
  }

  if (!dados.origem || !dados.destino) {
    return null;
  }

  return dados;
}

// Função principal de parse
function parseCorrida(texto) {
  if (!texto) return null;

  const linhas = texto
    .split('\n')
    .map(l => l.trim())
    .filter(Boolean);

  if (linhas.length === 0) return null;

  const primeiraLinha = linhas[0];

  if (!primeiraLinha.toLowerCase().startsWith('/corrida')) {
    return null;
  }

  // Remove o "/corrida" da primeira linha
  let depoisDoComando = primeiraLinha.slice(8).trim(); // "/corrida".length === 8

  // Monta uma string única com o resto do texto
  let resto = '';
  if (depoisDoComando) {
    resto = depoisDoComando + ' ' + linhas.slice(1).join(' ');
  } else {
    resto = linhas.slice(1).join(' ');
  }
  resto = resto.trim();

  // 1) Tenta o formato simples: origem x destino x obs: ... x valor
  if (resto.includes(' x ')) {
    const simples = parseCorridaSimples(resto);
    if (simples) return simples;
  }

  // 2) Cai para o formato antigo com "Origem:", "Destino:", "Obs:"
  return parseCorridaAntigo(linhas);
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

  // Se o usuário informou um valor fixo, enviamos o campo Valor
  if (typeof dadosCorrida.valor === 'number' && !isNaN(dadosCorrida.valor)) {
    payload.Valor = dadosCorrida.valor;
  }

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

// -----------------------------
// Cancelar Solicitação na DevBase
// -----------------------------
async function cancelarSolicitacao(solicitacaoId, tipo = 'C', cancEngano = false, cliNaoEncontrado = false) {
  if (!MOVEDRIVER_BASE_URL) {
    throw new Error('MOVEDRIVER_BASE_URL não configurada.');
  }
  if (!MOVEDRIVER_BASIC_AUTH) {
    throw new Error('MOVEDRIVER_BASIC_AUTH não configurada.');
  }

  if (!solicitacaoId) {
    throw new Error('SolicitacaoID inválido para cancelamento.');
  }

  // tipo = "C" (cliente) ou "P" (prestador)
  const url = `${MOVEDRIVER_BASE_URL}CancelarSolicitacao` +
    `?solicitacaoID=${encodeURIComponent(solicitacaoId)}` +
    `&tipo=${encodeURIComponent(tipo)}` +
    `&cancEngano=${cancEngano}` +
    `&cliNaoEncontrado=${cliNaoEncontrado}`;

  console.log('Cancelando solicitação na API Move Driver:', url);

  try {
    const resp = await axios.post(
      url,
      {},
      {
        headers: {
          Authorization: MOVEDRIVER_BASIC_AUTH,
          'Content-Type': 'application/json'
        },
        timeout: 15000
      }
    );

    const data = resp.data;
    console.log('Resposta cancelamento:', JSON.stringify(data, null, 2));

    if (data.Resultado) {
      if (!data.Resultado.ok) {
        const msgErro =
          data.Resultado.resultado?.mensagemErro ||
          data.Resultado.descricao ||
          'Erro desconhecido ao cancelar.';
        const codigo = data.Resultado.resultado?.codigo;
        const erroFormatado = codigo ? `${codigo} - ${msgErro}` : msgErro;
        throw new Error(erroFormatado);
      }
      return true;
    }

    if (data.message && data.message !== 'OK') {
      throw new Error(data.message);
    }

    return true;
  } catch (error) {
    if (error.response) {
      const status = error.response.status;
      const data = error.response.data;
      console.error('Erro da API ao cancelar (status ' + status + '):', JSON.stringify(data, null, 2));

      let msg = '';

      if (data?.Resultado) {
        const msgErro =
          data.Resultado.resultado?.mensagemErro ||
          data.Resultado.descricao ||
          'Erro desconhecido ao cancelar.';
        const codigo = data.Resultado.resultado?.codigo;
        msg = codigo ? `${codigo} - ${msgErro}` : msgErro;
      } else if (data?.message) {
        msg = data.message;
      } else {
        msg = 'Erro ao chamar API de cancelamento (status ' + status + ')';
      }

      throw new Error(msg);
    } else {
      throw new Error(error.message || 'Erro na comunicação com a API de cancelamento');
    }
  }
}

// -----------------------------------------
// Monitorar EtapaSolicitacao (DevBase)
// -----------------------------------------
function startMonitoringSolicitacao(solicitacaoId, whatsappFrom, dadosCorrida, podeDuplicar = true) {
  const intervaloMs = 20000;     // 20s
  const maxMinutos = 360;        // ~6 horas
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

      const origemTexto = dadosCorrida?.origem || 'não informada';
      const destinoTexto = dadosCorrida?.destino || 'não informado';

      // 0) Aviso genérico sempre que o status mudar (exceto na primeira vez)
      if (statusLower && statusLower !== lastStatusLower) {
        const especiais = [
          'aguardando motorista',
          'em viagem',
          'excedeu tentativas',
          'cancelado pelo adiministrador',
          'cancelado pelo administrador',
          'cancelado pelo cliente',
          'cancelado pelo sistema',
          'cancelado pelo motorista',
          'viagem finalizada',
          'nenhum motorista disponível. por favor tente novamente.'
        ];

        if (!especiais.includes(statusLower)) {
          await enviarMensagemWhatsApp(
            whatsappFrom,
            `🔄 Status atualizado da solicitação ${solicitacaoId}:\n` +
            `${StatusSolicitacao}\n\n` +
            `Origem: ${origemTexto}\n` +
            `Destino: ${destinoTexto}`
          );
        }

        lastStatusLower = statusLower;
      }

      // 1) Motorista aceitou
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
          const msgAceita =
            `✅ CORRIDA ACEITA\n\n` +
            `Solicitação: ${solicitacaoId}\n` +
            `Status: ${StatusSolicitacao}\n\n` +
            `Motorista: ${NomePrestador || 'não informado'}\n` +
            `Carro: ${Veiculo || 'não informado'}${Cor ? ' (' + Cor + ')' : ''}\n` +
            `Placa: ${Placa || 'não informada'}\n\n` +
            `Origem: ${origemTexto}\n` +
            `Destino: ${destinoTexto}\n\n` +
            `Se precisar, toque no botão abaixo para cancelar ESSA solicitação, enquanto a viagem ainda não estiver em andamento.`;

          await enviarMensagemWhatsAppComBotaoCancelar(
            whatsappFrom,
            solicitacaoId,
            msgAceita
          );

          sentDriverInfo = true;
        }

        if (statusLower !== lastStatusLower) {
          lastStatusLower = statusLower;
        }
      }

      // 2) "em viagem"
      if (
        statusLower === 'em viagem' &&
        hasDriver &&
        !sentEmViagem
      ) {
        const msg =
          `🚗 A viagem da solicitação ${solicitacaoId} está EM VIAGEM.\n` +
          `O motorista já pegou o cliente e está indo ao destino.\n\n` +
          `Origem: ${origemTexto}\n` +
          `Destino: ${destinoTexto}`;
        await enviarMensagemWhatsApp(whatsappFrom, msg);
        sentEmViagem = true;
        lastStatusLower = statusLower;
      }

      // 3) Nenhum motorista encontrado
      const isNoDriverStatus =
        statusLower === 'excedeu tentativas' ||
        statusLower.startsWith('nenhum motorista disponível');

      if (!hasDriver && isNoDriverStatus) {
        if (!sentNoDriver && podeDuplicar) {
          // Primeira vez: tenta duplicar
          const msgInicial =
            `⚠️ Nenhum motorista foi encontrado para a solicitação ${solicitacaoId}.\n` +
            `Status: ${StatusSolicitacao}\n\n` +
            `Origem: ${origemTexto}\n` +
            `Destino: ${destinoTexto}\n\n` +
            `Vou tentar criar automaticamente uma nova solicitação para essa mesma corrida.`;
          await enviarMensagemWhatsApp(whatsappFrom, msgInicial);

          try {
            const novoResultado = await criarSolicitacaoViagem(dadosCorrida);
            const novaSolicitacaoId = novoResultado.solicitacaoId;

            await enviarMensagemWhatsApp(
              whatsappFrom,
              `🔁 Nova solicitação criada automaticamente: ${novaSolicitacaoId}\n\n` +
              `Origem: ${origemTexto}\n` +
              `Destino: ${destinoTexto}\n\n` +
              `Vou te avisar se algum motorista aceitar ou se, novamente, não houver motoristas disponíveis.`
            );

            // Passa a monitorar a nova solicitação (sem duplicar de novo)
            startMonitoringSolicitacao(novaSolicitacaoId, whatsappFrom, dadosCorrida, false);
          } catch (erroReplica) {
            await enviarMensagemWhatsApp(
              whatsappFrom,
              `⚠️ Tentei criar uma nova solicitação automaticamente, mas deu erro:\n${erroReplica.message}\n\n` +
              `Verifique no painel se deseja criar manualmente.`
            );
          }

          sentNoDriver = true;
          clearInterval(interval);
          return;
        }

        if (!sentNoDriver && !podeDuplicar) {
          // Segunda tentativa: não duplica mais
          const msg =
            `⚠️ Nenhum motorista foi encontrado novamente para a solicitação ${solicitacaoId}.\n` +
            `Status: ${StatusSolicitacao}\n\n` +
            `Origem: ${origemTexto}\n` +
            `Destino: ${destinoTexto}\n\n` +
            `Verifique no painel se deseja tentar mais uma vez ou encaminhar de outra forma.`;
          await enviarMensagemWhatsApp(whatsappFrom, msg);
          sentNoDriver = true;
          clearInterval(interval);
          return;
        }
      }

      // 4) Motorista cancelou depois de aceitar
      if (
        hasDriver &&
        statusLower === 'cancelado pelo motorista' &&
        !sentDriverCanceled
      ) {
        const nomeMotorista = NomePrestador || 'O motorista';
        const msgAlerta =
          `🚨🚨🚨🚨${nomeMotorista} cancelou a corrida 🚨🚨🚨🚨\n\n` +
          `Solicitação: ${solicitacaoId}\n` +
          `Status: ${StatusSolicitacao}\n\n` +
          `Origem: ${origemTexto}\n` +
          `Destino: ${destinoTexto}\n\n` +
          `Vou continuar monitorando. Se outro motorista aceitar, te aviso
