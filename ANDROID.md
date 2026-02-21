# 🤖 Gravity Claw - Android/Linux Guide

Este guia cobre a instalação e uso do Gravity Claw em **Android (Termux)** e **servidores Linux**.

---

## 📱 Android (Termux)

### Requisitos

- Android 7.0+
- 2GB+ RAM recomendado
- 500MB+ espaço livre
- [Termux](https://termux.com/) instalado

### Instalação Rápida

```bash
# 1. Atualizar Termux
pkg update && pkg upgrade -y

# 2. Instalar dependências
pkg install nodejs python git -y

# 3. Clonar o projeto
git clone https://github.com/rfammon/gravity-claw.git
cd gravity-claw
git checkout android-linux

# 4. Executar script de instalação
chmod +x scripts/install-linux.sh
./scripts/install-linux.sh

# 5. Configurar variáveis de ambiente
nano .env

# 6. Iniciar o bot
npm run start
```

### Limitações no Android

| Feature | Status | Notas |
|---------|--------|-------|
| Chat básico | ✅ | Funciona normalmente |
| Voice STT/TTS | ⚠️ | Pode ser lento |
| OCR (fotos) | ✅ | Usa OCR Space API |
| Browser | ❌ | Desabilitado (memória) |
| SQLite | ✅ | Usa sql.js (pure JS) |
| Trello | ✅ | Funciona normalmente |
| Finance | ✅ | Funciona normalmente |

### Otimizações Automáticas

O sistema detecta automaticamente o ambiente Termux e:

1. **Modo de baixo recurso**: Ativado quando RAM < 2GB
2. **SQLite fallback**: Usa sql.js em vez de better-sqlite3
3. **Browser desabilitado**: Para economizar memória
4. **Cache reduzido**: TTL de 1 minuto em vez de 5

---

## 🐧 Linux (Server)

### Requisitos

- Ubuntu 20.04+ / Debian 11+ / Arch / Fedora
- Node.js 18+
- 1GB+ RAM
- Conexão estável com internet

### Instalação

```bash
# 1. Instalar Node.js 20
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt-get install -y nodejs

# 2. Instalar dependências do sistema (para Playwright)
sudo apt-get install -y \
    libnss3 libnspr4 libatk1.0-0 libatk-bridge2.0-0 \
    libcups2 libdrm2 libxkbcommon0 libxcomposite1 \
    libxdamage1 libxfixes3 libxrandr2 libgbm1 libasound2

# 3. Clonar e instalar
git clone https://github.com/rfammon/gravity-claw.git
cd gravity-claw
git checkout android-linux

# 4. Executar script de instalação
chmod +x scripts/install-linux.sh
./scripts/install-linux.sh

# 5. Configurar .env
cp .env.example .env
nano .env

# 6. Iniciar
npm run start
```

### Usando PM2 (Recomendado)

```bash
# Instalar PM2
sudo npm install -g pm2

# Iniciar com PM2
pm2 start npm --name "gravity-claw" -- run start

# Salvar configuração
pm2 save
pm2 startup
```

---

## 🔧 Configuração de Performance

### Variáveis de Ambiente Opcionais

```bash
# Modo de baixo recurso (força otimizações)
LOW_RESOURCE_MODE=true

# Conexões máximas simultâneas
MAX_CONCURRENT_TOOLS=2

# Limite de memória (MB)
MEMORY_LIMIT_MB=256

# TTL do cache (ms)
CACHE_TTL_MS=60000
```

### Plataformas Suportadas

| Plataforma | Detecção | SQLite | Browser |
|------------|----------|--------|---------|
| Android/Termux | Auto | sql.js | Fetch-only |
| Linux Server | Auto | better-sqlite3 | Playwright |
| Linux Desktop | Auto | better-sqlite3 | Playwright |
| Windows | Auto | better-sqlite3 | Playwright |
| macOS | Auto | better-sqlite3 | Playwright |

---

## 🐛 Troubleshooting

### Erro: "Cannot find module 'better-sqlite3'"

```bash
# Tentar reconstruir
npm rebuild better-sqlite3

# Se falhar, o sistema usará sql.js automaticamente
```

### Erro: "Chromium failed to launch"

```bash
# Instalar dependências do Chromium
sudo apt-get install -y \
    libnss3 libnspr4 libatk1.0-0 libatk-bridge2.0-0 \
    libcups2 libdrm2 libxkbcommon0 libxcomposite1 \
    libxdamage1 libxfixes3 libxrandr2 libgbm1 libasound2

# Ou desabilitar browser
export DISABLE_BROWSER=true
```

### Memória insuficiente no Termux

```bash
# Aumentar limite de memória do Node
export NODE_OPTIONS="--max-old-space-size=512"

# Ou ativar modo de baixo recurso
export LOW_RESOURCE_MODE=true
```

### Erro de permissão no .env

```bash
# Verificar permissões
chmod 600 .env

# Verificar conteúdo
cat .env
```

---

## 📊 Monitoramento

### Verificar status

```bash
# Com PM2
pm2 status gravity-claw
pm2 logs gravity-claw

# Sem PM2
tail -f ~/.gravity_claw/logs/agent.log
```

### Verificar banco de dados

```bash
# Localização
~/.gravity_claw/memory.sqlite

# Verificar integridade
sqlite3 ~/.gravity_claw/memory.sqlite "PRAGMA integrity_check;"
```

---

## 🔄 Atualização

```bash
# Parar o serviço
pm2 stop gravity-claw

# Atualizar código
git pull origin android-linux

# Reinstalar dependências
npm install

# Reiniciar
pm2 restart gravity-claw
```

---

## 📞 Suporte

- Issues: [GitHub Issues](https://github.com/rfammon/gravity-claw/issues)
- Documentação: `README.md`
- Configuração: `.env.example`
