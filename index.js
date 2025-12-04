const express = require("express");
const axios = require("axios");

const app = express();
app.use(express.json());

// =====================
// CONFIGURAÇÕES GERAIS
// =====================

const VERIFY_TOKEN = process.env.VERIFY_TOKEN || "move_driver_bot";

// Token e Phone Number ID do WhatsApp
const WABA_TOKEN =
  process.env.WHATSAPP_TOKEN || process.env.WABA_TOKEN || "";
const WABA_PHONE_NUMBER_ID =
  process.env.WHATSAPP_PHONE_NUMBER_ID ||
  process.env.WABA_PHONE_NUMBER_ID ||
  "";

// Config DevBase (Move Driver)
const DEVBASE_BASE_URL =
  process.env.DEVBASE_BASE_URL ||
  "https://webapiexterna.azurewebsites.net/movedriver/api/external/";
const DEVBASE_USER = process.env.DEVBASE_USER;
const DEVBASE_PASSWORD = process.env.DEVBASE_PASSWORD;

const DEVBASE_CLIENTE_ID = Number(process.env.DEVBASE_CLIENTE_ID || 1);
const DEVBASE_SERVICO_ITEM_ID = Number(
  process.env.DEVBASE_SERVICO_ITEM_ID || 250
);
const DEVBASE_TIPO_PAGAMENTO_ID = Number(
  process.env.DEVBASE_TIPO_PAGAMENTO_ID || 5
);

// Endereço padrão (caso não informe CEP/cidade/estado)
const DEVBASE_CIDADE_PADRAO = process.env.DEVBASE_CIDADE_PADRAO || "Coromandel";
const DEVBASE_ESTADO_SIGLA_PADRAO =
  process.env.DEVBASE_ESTADO_SIGLA_PADRAO || "MG";
const DEVBASE_CEP_PADRAO = process.env.DEVBASE_CEP_PADRAO || "38550000";

// =====================
// HELPERS
// =====================

function getDevBaseAuthHeader() {
  const token = Buffer.from(`${DEVBASE_USER}:${DEVBASE_PASSWORD}`).toString(
    "base64"
  );
  return `Basic ${token}`;
}

async function sendWhatsAppText(to, body) {
  if (!WABA_TOKEN || !WABA_PHONE_NUMBER_ID) {
    console.error("WhatsApp TOKEN ou PHONE_NUMBER_ID não configurados.");
    return;
  }

  try {
    await axios.post(
      `https://graph.facebook.com/v21.0/${WABA_PHONE_NUMBER_ID}/messages`,
      {
        messaging_product: "whatsapp",
        to,
        type: "text",
        text: { body },
      },
      {
        headers: {
          Authorization: `Bearer ${WABA_TOKEN}`,
          "Content-Type": "application/json",
        },
      }
    );
  } catch (err) {
    console.error(
      "Erro ao enviar mensagem WhatsApp:",
      err.response?.data || err.message
    );
  }
}

// =====================
// MONITORAR SOLICITAÇÃO
// =====================
// Fica consultando EtapaSolicitacao até aparecer motorista, carro e placa
// Respeitando o limite da API: 1 requisição a cada 15s por SolicitacaoID

function startMonitoringSolicitacao(solicitacaoID, whatsappFrom) {
  const intervaloMs = 20000; // 20s > 15s (limite da DevBase)
  const maxTentativas = 60; // ~20 minutos (60 * 20s)

  let tentativas = 0;

  const interval = setInterval(async () => {
    tentativas++;

    try {
      const url = `${DEVBASE_BASE_URL}EtapaSolicitacao?solicitacaoID=${solicitacaoID}`;

      const resp = await axios.get(url, {
        headers: {
          Authorization: getDevBaseAuthHeader(),
        },
      });

      const etapa = resp.data?.EtapaSolicitacao;

      if (!etapa) {
        console.log(
          `Solicitação ${solicitacaoID}: resposta sem EtapaSolicitacao`
        );
      } else {
        console.log(`EtapaSolicitacao ${solicitacaoID}:`, etapa);

        const {
          Etapa,
          StatusSolicitacao,
          NomePrestador,
          Veiculo,
          Placa,
          Cor,
          ViagemFinalizada,
        } = etapa;

        // Quando o motorista ACEITA (Etapa 2, normalmente)
        if (Etapa >= 2 && NomePrestador && Veiculo && Placa) {
          const msg =
            `✅ CORRIDA ACEITA\n\n` +
            `Solicitação: ${solicitacaoID}\n` +
            `Status: ${StatusSolicitacao}\n\n` +
            `Motorista: ${NomePrestador}\n` +
            `Carro: ${Veiculo} (${Cor || "cor não informada"})\n` +
            `Placa: ${Placa}`;

          await sendWhatsAppText(whatsappFrom, msg);
          clearInterval(interval);
          return;
        }

        // Se a viagem finalizar sem nunca ter informado (caso raro)
        if (ViagemFinalizada) {
          const msg =
            `⚠️ Viagem da solicitação ${solicitacaoID} foi finalizada.\n` +
            `Status: ${StatusSolicitacao}`;
          await sendWhatsAppText(whatsappFrom, msg);
          clearInterval(interval);
          return;
        }
      }
    } catch (err) {
      console.error(
        `Erro ao consultar EtapaSolicitacao ${solicitacaoID}:`,
        err.response?.data || err.message
      );
      // Se der erro repetidamente, o loop vai parar por maxTentativas
    }

    if (tentativas >= maxTentativas) {
      console.log(
        `Parando monitoramento da solicitação ${solicitacaoID} por tempo máximo.`
      );
      clearInterval(interval);
    }
  }, intervaloMs);
}

// =====================
// PARSER DA MENSAGEM /CORRIDA
// =====================

function parseCorridaMessage(text) {
  // Remove /corrida da primeira linha
  const linhas = text.split("\n").map((l) => l.trim()).filter((l) => l);

  // Ex: ["/corrida", "origem: ...", "destino: ...", "obs: ..."]
  let origem = "";
  let destino = "";
  let obs = "";

  for (const linha of linhas) {
    const lower = linha.toLowerCase();

    if (lower.startsWith("/corrida")) continue;

    if (lower.startsWith("origem:")) {
      origem = linha.substring(linha.indexOf(":") + 1).trim();
    } else if (lower.startsWith("destino:")) {
      destino = linha.substring(linha.indexOf(":") + 1).trim();
    } else if (lower.startsWith("obs:")) {
      obs = linha.substring(linha.indexOf(":") + 1).trim();
    }
  }

  if (!origem || !destino) {
    return null;
  }

  return { origem, destino, obs };
}

// =====================
// CRIAR SOLICITAÇÃO DEVBASE
// =====================

async function criarSolicitacaoViagem({ origem, destino, obs }) {
  const url = `${DEVBASE_BASE_URL}CriarSolicitacaoViagem`;

  const payload = {
    ClienteID: DEVBASE_CLIENTE_ID,
    ServicoItemID: DEVBASE_SERVICO_ITEM_ID,
    TipoPagamentoID: DEVBASE_TIPO_PAGAMENTO_ID,
    enderecoOrigem: {
      CEP: DEVBASE_CEP_PADRAO,
      Endereco: origem,
      Cidade: DEVBASE_CIDADE_PADRAO,
      EstadoSigla: DEVBASE_ESTADO_SIGLA_PADRAO,
      Observacao: obs || "CENTRAL WHATSAPP",
    },
    lstDestino: [
      {
        CEP: DEVBASE_CEP_PADRAO,
        Endereco: destino,
        Cidade: DEVBASE_CIDADE_PADRAO,
        EstadoSigla: DEVBASE_ESTADO_SIGLA_PADRAO,
        Observacao: obs || "",
      },
    ],
  };

  const resp = await axios.post(url, payload, {
    headers: {
      Authorization: getDevBaseAuthHeader(),
      "Content-Type": "application/json",
    },
  });

  return resp.data;
}

// =====================
// WEBHOOK - VERIFICAÇÃO (GET)
// =====================

app.get("/webhook", (req, res) => {
  const mode = req.query["hub.mode"];
  const token = req.query["hub.verify_token"];
  const challenge = req.query["hub.challenge"];

  if (mode && token && mode === "subscribe" && token === VERIFY_TOKEN) {
    console.log("WEBHOOK VERIFICADO COM SUCESSO");
    return res.status(200).send(challenge);
  }

  console.log("FALHA NA VERIFICAÇÃO DO WEBHOOK");
  return res.sendStatus(403);
});

// =====================
// WEBHOOK - MENSAGENS (POST)
// =====================

app.post("/webhook", async (req, res) => {
  try {
    const body = req.body;

    if (
      body.object === "whatsapp_business_account" &&
      body.entry &&
      body.entry[0]?.changes &&
      body.entry[0].changes[0]?.value?.messages &&
      body.entry[0].changes[0].value.messages[0]
    ) {
      const message = body.entry[0].changes[0].value.messages[0];
      const from = message.from; // número de quem mandou (atendente)
      const msgBody = message.text?.body?.trim() || "";

      console.log("Mensagem recebida:", from, msgBody);

      // Comando /corrida
      if (msgBody.toLowerCase().startsWith("/corrida")) {
        const dados = parseCorridaMessage(msgBody);

        if (!dados) {
          await sendWhatsAppText(
            from,
            "❌ Formato inválido.\n\nUse assim:\n/corrida\norigem: Rua tal, 123\ndestino: Outra rua, 456\nobs: opcional"
          );
        } else {
          try {
            await sendWhatsAppText(
              from,
              "⏳ Criando solicitação de corrida na plataforma..."
            );

            const resultado = await criarSolicitacaoViagem(dados);

            const ok = resultado?.Resultado?.ok;
            const descricao = resultado?.Resultado?.descricao;
            const solicitacaoID =
              resultado?.Resultado?.resultado?.SolicitacaoID;

            if (ok && solicitacaoID) {
              await sendWhatsAppText(
                from,
                `✅ Corrida criada com sucesso!\nSolicitaçãoID: ${solicitacaoID}\n\nOrigem: ${dados.origem}\nDestino: ${dados.destino}\n\nVou te avisar assim que um motorista aceitar.`
              );

              // 👉 COMEÇA A MONITORAR ESSA SOLICITAÇÃO
              startMonitoringSolicitacao(solicitacaoID, from);
            } else {
              const codigo = resultado?.Resultado?.resultado?.codigo;
              const mensagemErro =
                resultado?.Resultado?.resultado?.mensagemErro;

              await sendWhatsAppText(
                from,
                `❌ Não consegui criar a corrida.\nMotivo: ${descricao || ""}\n` +
                  (codigo || mensagemErro
                    ? `Código: ${codigo || ""}\nErro: ${
                        mensagemErro || ""
                      }`
                    : "")
              );
            }
          } catch (err) {
            console.error(
              "Erro ao criar corrida:",
              err.response?.data || err.message
            );
            await sendWhatsAppText(
              from,
              "❌ Erro ao criar a corrida na plataforma. Veja o log do servidor para mais detalhes."
            );
          }
        }
      } else {
        // Qualquer outra mensagem que não seja /corrida
        await sendWhatsAppText(
          from,
          "👋 Olá! Para abrir uma corrida pela central, envie no formato:\n\n/corrida\norigem: Rua tal, 123\ndestino: Outra rua, 456\nobs: opcional"
        );
      }
    }

    res.sendStatus(200);
  } catch (err) {
    console.error("Erro geral no webhook:", err);
    res.sendStatus(500);
  }
});

// =====================
// SUBIR SERVIDOR
// =====================

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log("Servidor WhatsApp bot rodando na porta " + PORT);
});
