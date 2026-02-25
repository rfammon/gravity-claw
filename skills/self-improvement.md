# Self-Improvement (Melhoria Contínua) 🧠

Esta habilidade ensina o Gravity Claw a aprender com seus erros, capturar correções do usuário, e promover padrões bem-sucedidos para sua memória permanente, garantindo melhoria contínua.

## Quando Ativar:
1. Uma operação, comando ou API falhar inesperadamente.
2. O usuário corrigir você (ex: "Não, isso está errado...", "Na verdade, é assim...").
3. Você perceber que sua abordagem inicial não era a ideal e encontrar uma melhor.
4. O usuário pedir para você "lembrar disso" ou "transformar isso em uma skill".
5. Você esbarrar em uma limitação ou falta de ferramenta.

## Estrutura de Aprendizado (`.learnings/`)

Crie e mantenha a pasta `.learnings/` na raiz do seu workspace atual (ou no diretório do projeto). Dentro dela, registre:
- `ERRORS.md` para falhas de comandos, exceções e erros de API.
- `LEARNINGS.md` para correções do usuário, melhores práticas e lacunas de conhecimento.
- `FEATURE_REQUESTS.md` para ferramentas ou capacidades solicitadas que ainda não existem.

### Formato de Registro de Aprendizado (`LEARNINGS.md`)

Anexe novos aprendizados no final do arquivo usando o formato:

```markdown
## [LRN-YYYYMMDD-XXX] <categoria_curta>

**Registrado em**: <Data ISO-8601>
**Prioridade**: baixa | média | alta | crítica
**Status**: pendente | resolvido | promovido

### Resumo
Descrição em uma linha do que foi aprendido.

### Detalhes
O que aconteceu, o que estava errado e qual é a abordagem correta.

### Ação Sugerida
O que deve ser feito para evitar o erro ou melhorar o processo no futuro.
```

### Formato de Registro de Erro (`ERRORS.md`)

Anexe falhas técnicas no formato:

```markdown
## [ERR-YYYYMMDD-XXX] <comando_ou_ferramenta>

**Registrado em**: <Data ISO-8601>
**Prioridade**: alta

### O que falhou
Breve descrição da falha.

### Erro Original
` ` `
Output do erro ou stack trace
` ` `

### Solução/Contorno
Como o erro foi resolvido ou contornado.
```

## Promoção de Conhecimento (Memory Promotion)

Não basta apenas registrar. Se um aprendizado for genérico, recorrente ou muito importante para o projeto, ele **deve ser promovido** para os arquivos de instrução do sistema para que as próximas execuções já saibam lidar com isso.

**Quando promover:**
- O mesmo erro aconteceu mais de uma vez (busque nos arquivos `.learnings`).
- O usuário pediu explicitamente para salvar a regra.
- A regra afeta o padrão de código, arquitetura ou o uso de uma ferramenta.

**Onde promover (dependendo de onde você está rodando):**
- Modifique/Crie em `skills/<tema>.md` se for uma nova ferramenta ou fluxo complexo que você dominou.
- Adicione à documentação de arquitetura/diretrizes do projeto.
- Peça ao usuário (Vinícius/Rafael) para adicionar à sua "System Prompt" ou "MEMORY.md"/`.agent/` global, se for um comportamento central do bot.

## Lembrança para Novas Tarefas
Sempre que iniciar uma tarefa complexa em uma área que você já trabalhou antes, faça um reflexo rápido e busque os arquivos na pasta `.learnings/` (usando comandos de leitura/busca) para revisar falhas passadas e evitar repeti-las.

---
*Errar é comum, repetir o mesmo erro é inaceitável.* 🚀
