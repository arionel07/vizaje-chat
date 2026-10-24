// Подключается через bunfig.toml (preload) до загрузки кода приложения.
// Тесты чистят таблицы, поэтому работают только с отдельной тестовой БД.
const url = process.env.TEST_DATABASE_URL

if (!url) {
	throw new Error(
		'Задайте TEST_DATABASE_URL — отдельная БД для тестов (тесты очищают таблицы), ' +
			'например postgres://postgres:dev@localhost:5433/vizaje_chat_test'
	)
}
if (!/test/i.test(new URL(url).pathname)) {
	throw new Error(
		'Имя тестовой БД должно содержать "test", чтобы не очистить рабочие данные'
	)
}

process.env.DATABASE_URL = url
process.env.JWT_SECRET = 'test-secret'
// отдельная папка, не "./uploads" из .env — чтобы тестовые файлы не оседали
// рядом с настоящими загрузками при локальном запуске
process.env.UPLOAD_DIR = './uploads-test'
// нужен, чтобы проверять relay картинок в Telegram (sendPhoto требует публичный URL)
process.env.PUBLIC_API_URL = 'http://test-api.local'
// тестовая пара VAPID — не настоящий секрет, нужна только чтобы sendWebPush()
// не выходил по раннему return до инжектированного sender'а в тестах
process.env.VAPID_PUBLIC_KEY =
	'BDN3Jk5rcZ25rjolGghAzSs6YlPFNhSA0RnUJnpyoN-prOocu_-tidEpJJOSiwZCkaXH3m9ogio9ui464rDdwWg'
process.env.VAPID_PRIVATE_KEY = 'D1leeFoLkrlZfyIBbz7d1KAtyDxRpTuE7TV7tYnkDfM'
// Instagram — не настоящие секреты; APP_SECRET нужен, чтобы проверить саму
// проверку подписи вебхука (см. tests/instagram.test.ts), VERIFY_TOKEN — чтобы
// проверить GET-рукопожатие при подключении вебхука
process.env.INSTAGRAM_APP_SECRET = 'test-instagram-app-secret'
process.env.INSTAGRAM_VERIFY_TOKEN = 'test-instagram-verify-token'
process.env.INSTAGRAM_PAGE_ACCESS_TOKEN = 'test-instagram-page-token'
