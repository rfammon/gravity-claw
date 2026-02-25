# Skill Vetter 🔒

Esta habilidade estabelece um protocolo de segurança para a verificação (vetting) de novas habilidades (skills) e ferramentas antes de serem adicionadas ao Gravity Claw. **Nunca instale uma ferramenta ou código desconhecido sem antes verificá-lo.**

## Quando Usar:
- Antes de instalar qualquer habilidade de fontes externas (ex: ClawdHub, repositórios do GitHub).
- Ao avaliar scripts ou ferramentas compartilhadas por outros agentes/usuários.
- Sempre que for solicitado a integrar código de terceiros ao sistema.

## Protocolo de Verificação:

### Passo 1: Verificação da Fonte
Responda às seguintes perguntas:
- De onde veio essa habilidade?
- O autor é conhecido/reputável?
- A ferramenta é amplamente utilizada ou tem boas avaliações?
- Quando foi atualizada pela última vez?

### Passo 2: Revisão de Código (OBRIGATÓRIO)
Leia **TODOS** os arquivos da habilidade sugerida. Verifique os seguintes **SINAIS DE ALERTA (RED FLAGS)**:

🚨 **REJEITE IMEDIATAMENTE (ou exija aprovação humana) SE ENCONTRAR:**
- `curl/wget` ou requisições (fetch/axios) para URLs desconhecidas ou suspeitas.
- Envio de dados, telemetria ou logs para servidores externos não autorizados.
- Solicitações de credenciais, tokens, ou chaves de API ocultas no código.
- Leitura de diretórios confidenciais (`~/.ssh`, `~/.aws`, `.env`) sem escopo justificado.
- Acesso indevido aos prompts do sistema ou à memória do Gravity Claw.
- Uso de ofuscação (ex: `base64 decode` injustificado, código minificado/codificado).
- Execução de código dinâmico não seguro (`eval()`, `exec()`, `spawn` com inputs arbitrários).
- Modificação de arquivos de sistema fora da pasta do projeto.
- Instalação de dependências npm/yarn ocultas ou scripts postinstall nefastos.

### Passo 3: Escopo de Permissões
Avalie rigorosamente:
1. **Sistema de Arquivos:** Quais arquivos a skill precisa ler/escrever?
2. **Execução:** Quais comandos de terminal ela executa?
3. **Rede:** Ela faz requisições externas? Para quais domínios?
4. **Privilégios:** O escopo é o mínimo necessário para a função que ela diz exercer?

### Passo 4: Classificação de Risco
| Nível de Risco | Exemplos | Ação Exigida |
|----------------|----------|--------------|
| 🟢 BAIXO | Formatação de texto, cálculos matemáticos locais. | Revisão básica, OK para aprovar a instalação. |
| 🟡 MÉDIO | Leitura de arquivos do projeto, requisições a APIs públicas conhecidas. | Revisão completa linha a linha obrigatória. |
| 🔴 ALTO | Modificação de arquivos, manipulação de banco de dados, requisições autenticadas. | Aprovação explícita do usuário (Vinícius/Rafael) obrigatória. |
| ⛔ EXTREMO | Execução de comandos do sistema operacional, acesso modificado a `.env`. | **NÃO INSTALAR** sob nenhuma circunstância. |

## Formato de Saída (Output)
Após a verificação, se for questionado sobre uma nova skill, produza o relatório abaixo para o usuário:

```text
RELATÓRIO DE VERIFICAÇÃO DE HABILIDADE (SKILL VETTING)
═══════════════════════════════════════
Nome sugerido: [nome]
Fonte: [URL ou Origem]
───────────────────────────────────────
SINAIS DE ALERTA (RED FLAGS): [Nenhum / Listá-los]

PERMISSões IDENTIFICADAS:
• Arquivos: [Lista de acessos de leitura/escrita ou "Nenhuma"]
• Rede: [Lista de domínios contatados ou "Nenhuma"]  
• Sistema: [Comandos a serem executados ou "Nenhum"]
───────────────────────────────────────
NÍVEL DE RISCO: [🟢 BAIXO / 🟡 MÉDIO / 🔴 ALTO / ⛔ EXTREMO]

VEREDITO: [✅ SEGURO / ⚠️ EXIGE CAUTELA / ❌ REJEITADO]

NOTAS: [Justificativa e observações finais]
═══════════════════════════════════════
```

## Lembre-se:
- Paranoia é uma funcionalidade (feature), não um defeito. 🔒
- Nenhuma funcionalidade nova vale o comprometimento da segurança do servidor.
- Na dúvida, não execute, não instale, e alerte o usuário!
