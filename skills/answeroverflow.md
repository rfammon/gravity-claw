# Answer Overflow (Pesquisa de Discord) 💬

Esta habilidade permite pesquisar soluções, discussões de bibliotecas e suporte técnico diretamente em comunidades do Discord indexadas pelo Answer Overflow (já que muitos problemas de código modernos são resolvidos lá e não no StackOverflow).

## O que é o Answer Overflow?
É uma plataforma que indexa canais públicos de suporte do Discord e os torna pesquisáveis no Google e via API direta. Perfeito para encontrar aquelas respostas evasivas de fóruns de desenvolvimento.

## Como Pesquisar (Quick Search)

A maneira mais fácil de usar o Answer Overflow é através da ferramenta `web_search` combinada com o operador `site:`.

**Exemplos de buscas:**
```bash
# Procurar ajuda sobre Discord.js
web_search "site:answeroverflow.com discord.js slash commands"

# Procurar soluções de Next.js App Router
web_search "site:answeroverflow.com nextjs app router error"

# Procurar problemas de conexão do Prisma
web_search "site:answeroverflow.com prisma connection pooling"
```

## Como Ler uma Thread (Discussão)

Quando uma URL for encontrada nas buscas, você pode extrair o conteúdo da discussão em formato Markdown.

1. Identifique o ID da mensagem na URL (ex: `1234567890123456789`).
2. Utilize a ferramenta adequada de leitura de URL (como `web_fetch` ou o navegador).
3. **Importante:** Para conteúdo amigável (Markdown), tente adicionar o sufixo `.md` à URL ou use o prefixo `/m/`.

**Exemplos de URL para leitura:**
- Padrão: `https://www.answeroverflow.com/m/1234567890123456789`
- Com sufixo: `https://www.answeroverflow.com/m/1234567890123456789.md`

## Servidor MCP (Avançado)
Se disponível e configurado no seu sistema, existe um servidor MCP do Answer Overflow (`https://www.answeroverflow.com/mcp`) com as ferramentas:
- `search_answeroverflow`: Pesquisa em todas as comunidades, permitindo filtros por canal/servidor.
- `search_servers`: Identifica servidores do Discord indexados.
- `get_thread_messages`: Coleta todas as mensagens de uma thread específica.

## Dicas Importantes
- **Contexto Informal:** Os resultados são conversas reais de chat, então a linguagem pode ser informal e cheia de jargões/gírias.
- **Vai e Vem:** Muitas threads têm dezenas de mensagens de debug e perguntas antes da resposta real. Leia o histórico com atenção.
- **Oficial vs Comunidade:** Preste atenção se o servidor fornecendo a resposta é o oficial do projeto ou uma comunidade genérica.

## Links Úteis
- Site: https://www.answeroverflow.com
- Documentação: https://docs.answeroverflow.com
