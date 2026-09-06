# Интерфейс черновика и операции ядра

Status: ready-for-human

`KnowledgeDrafter` в `packages/core/src/knowledge-drafter.ts`,
`knowledgeDrafter?` в `CoreConfig`. Операции в `concierge-knowledge.ts`:
`draftKnowledgeArticles` (текст → черновик с заменами и
предупреждениями), `addKnowledgeArticles` (черновик → база одной
транзакцией, по названию — замена), `hasKnowledgeDrafter`.
`saveKnowledgeArticle` без позиции ставит новую статью в конец, а при
правке позицию не трогает.

Тест-первым: пустой текст, нет черновика, дедупликация по названию,
позиция в конец, деление длинной статьи, предупреждения.
