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
const CLIENTE_ID = 3;              // Cliente "CENTRAL WHATSAPP"
const SERVICO_ITEM_ID_VIAGEM = 5;  // ID do tipo de serviço (corrida normal)

// 🔥 CORRETO AGORA:
// TipoP
