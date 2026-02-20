# Trello Core Skill

Esta habilidade habilita o gerenciamento completo do Trello pelo Gravity Claw.

## Funções Habilitadas:
1. **Visualizar Quadros e Cartões**: Use `trello_list_boards`, `trello_get_board_lists` e `trello_get_cards`.
2. **Criar Cartões**: Use `trello_create_card`.
3. **Mover Cartões**: Use `trello_move_card` informando o `cardId` e o `listId` de destino.
4. **Concluir Cartões**: Use `trello_complete_card`.
5. **Checklists**: Use `trello_add_checklist` para criar a lista no cartão.
6. **Comentários**: Use `trello_add_comment` para adicionar feedback ou notas.
7. **Prazos**: Use `trello_set_deadline` com datas no formato ISO.
8. **Anexos**: Use `trello_add_attachment` para anexar fotos ou arquivos via URL.

## Diretrizes de Uso:
- Sempre peça confirmação antes de mover ou deletar cartões importantes.
- Se não encontrar um quadro ou lista pelo nome, use a ferramenta de listagem para obter o ID correto.
- Informe ao Rafael se houver erro de permissão (401/403).
