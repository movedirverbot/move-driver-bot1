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
      const PrevisaoChegadaOrigem = etapaObj.PrevisaoChegadaOrigem || '';
      const PrevisaoChegadaDestino = etapaObj.PrevisaoChegadaDestino || null;

      const statusLower = StatusSolicitacao.toLowerCase();
      const solicitacaoIdStr = String(solicitacaoId);

      const origemTexto = dadosCorrida?.origem || 'não informada';
      const destinoTexto = dadosCorrida?.destino || 'não informado';

      // Flags de cancelamento/sem motorista
      const isNoDriverStatus =
        statusLower === 'excedeu tentativas' ||
        statusLower.startsWith('nenhum motorista disponível');

      const isCanceladoGenerico =
        statusLower === 'cancelado pelo adiministrador' ||
        statusLower === 'cancelado pelo administrador' ||
        statusLower === 'cancelado pelo cliente' ||
        statusLower === 'cancelado pelo sistema';

      const isCanceladoMotorista = statusLower === 'cancelado pelo motorista';

      const isAlgumCancelamento =
        isNoDriverStatus || isCanceladoGenerico || isCanceladoMotorista;

      // 0) Aviso genérico sempre que o status mudar (exceto nos especiais)
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

        // 🧠 AQUI entra a lógica que você pediu:
        // Se esse motorista já tiver OUTRA corrida "em viagem" (que o bot conhece),
        // avisa que essa será a próxima corrida dele.
        if (NomePrestador) {
          const ativos = driverActiveTrips.get(NomePrestador);
          if (ativos && ativos.size > 0) {
            // Procura alguma outra solicitação diferente desta
            const outras = [...ativos].filter(id => id !== solicitacaoIdStr);
            if (outras.length > 0) {
              const outraId = outras[0];
              const msgFila =
                `⏱ Atenção: o motorista ${NomePrestador} já está em outra viagem EM ANDAMENTO (Solicitação ${outraId}).\n\n` +
                `Essa nova corrida (Solicitação ${solicitacaoId}) ficará como PRÓXIMA viagem dele.\n\n` +
                `Origem: ${origemTexto}\n` +
                `Destino: ${destinoTexto}`;
              await enviarMensagemWhatsApp(whatsappFrom, msgFila);
            }
          }
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
        // Marca essa solicitação como viagem ativa desse motorista
        if (NomePrestador) {
          addDriverActiveTrip(NomePrestador, solicitacaoId);
        }

        const etaDestinoTexto = PrevisaoChegadaDestino
          ? `Previsão de chegada ao destino: ${PrevisaoChegadaDestino}\n\n`
          : '';

        const msg =
          `🚗 A viagem da solicitação ${solicitacaoId} está EM VIAGEM.\n` +
          etaDestinoTexto +
          `Origem: ${origemTexto}\n` +
          `Destino: ${destinoTexto}`;
        await enviarMensagemWhatsApp(whatsappFrom, msg);
        sentEmViagem = true;
        lastStatusLower = statusLower;
      }

      // 3) Nenhum motorista encontrado (primeira ou segunda tentativa)
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
        isCanceladoMotorista &&
        !sentDriverCanceled
      ) {
        if (NomePrestador) {
          removeDriverActiveTrip(NomePrestador, solicitacaoId);
        }

        const nomeMotorista = NomePrestador || 'O motorista';
        const msgAlerta =
          `🚨🚨🚨🚨${nomeMotorista} cancelou a corrida 🚨🚨🚨🚨\n\n` +
          `Solicitação: ${solicitacaoId}\n` +
          `Status: ${StatusSolicitacao}\n\n` +
          `Origem: ${origemTexto}\n` +
          `Destino: ${destinoTexto}\n\n` +
          `Vou continuar monitorando. Se outro motorista aceitar, te aviso.`;

        await enviarMensagemWhatsApp(whatsappFrom, msgAlerta);
        sentDriverCanceled = true;
        clearInterval(interval);
        return;
      }

      // Outros cancelamentos (admin, cliente, sistema)
      if (!sentDriverCanceled && isCanceladoGenerico) {
        if (NomePrestador) {
          removeDriverActiveTrip(NomePrestador, solicitacaoId);
        }

        const msg =
          `ℹ️ Solicitação ${solicitacaoId} foi cancelada.\n` +
          `Motivo: ${StatusSolicitacao}\n\n` +
          `Origem: ${origemTexto}\n` +
          `Destino: ${destinoTexto}`;
        await enviarMensagemWhatsApp(whatsappFrom, msg);
        sentDriverCanceled = true;
        clearInterval(interval);
        return;
      }

      // 5) Viagem demorando mais de 30 min após aceite
      // (só avisa se NÃO tiver sido cancelada / sem motorista / finalizada)
      if (
        hasDriver &&
        driverAcceptedAt &&
        !sentTooLong &&
        !ViagemFinalizada &&
        !isAlgumCancelamento &&
        statusLower !== 'viagem finalizada'
      ) {
        const elapsedMs = Date.now() - driverAcceptedAt;
        if (elapsedMs > 30 * 60 * 1000) {
          const msg =
            `⏱ Atenção: a viagem da solicitação ${solicitacaoId} está em andamento há mais de 30 minutos desde que o motorista aceitou.\n` +
            `Status atual: ${StatusSolicitacao || 'indisponível'}\n\n` +
            `Origem: ${origemTexto}\n` +
            `Destino: ${destinoTexto}\n\n` +
            `Verifique no painel se está tudo bem com o motorista e o cliente.`;
          await enviarMensagemWhatsApp(whatsappFrom, msg);
          sentTooLong = true;
        }
      }

      // 6) Viagem finalizada
      if (!sentFinalizada && (ViagemFinalizada || statusLower === 'viagem finalizada')) {
        if (NomePrestador) {
          removeDriverActiveTrip(NomePrestador, solicitacaoId);
        }

        const msg =
          `✅ Viagem da solicitação ${solicitacaoId} foi finalizada.\n` +
          `Status final: ${StatusSolicitacao || 'viagem finalizada'}\n\n` +
          `Origem: ${origemTexto}\n` +
          `Destino: ${destinoTexto}`;
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
        `ℹ️ Encerrado o monitoramento automático da solicitação ${solicitacaoId} após aproximadamente ${maxMinutos} minutos.\n` +
        `Verifique o painel para mais detalhes.`
      );
      clearInterval(interval);
    }
  }, intervaloMs);
}
