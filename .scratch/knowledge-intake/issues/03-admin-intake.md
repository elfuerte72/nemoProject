# Панель: файл или текст → черновик → база

Status: ready-for-human

`apps/admin/lib/knowledge-file.ts` — текст из файла по первым байтам
(unpdf, mammoth, UTF-8). Маршруты `/api/concierge/knowledge/draft`
(multipart или JSON) и `/api/concierge/knowledge/batch`. Форма
`knowledge-form.tsx`: поле текста и выбор файла, черновик с правкой и
удалением статей, кнопка «Запомнить», ручная статья вторым путём, без
поля «Порядок». Без ключа провайдера — слова о том, что разбор
выключен.
