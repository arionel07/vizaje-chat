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
