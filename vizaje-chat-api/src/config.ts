function required(name: string): string {
	const value = process.env[name]
	if (!value) {
		console.error(`Missing required env variable: ${name}`)
		process.exit(1)
	}
	return value
}

export const DATABASE_URL = required('DATABASE_URL')
export const JWT_SECRET = required('JWT_SECRET')

// Origins, которым разрешён CORS (сайты с виджетом и админка), через запятую
export const ALLOWED_ORIGINS = (
	process.env.ALLOWED_ORIGINS ??
	'http://localhost:5173,http://localhost:8080'
)
	.split(',')
	.map(o => o.trim())
	.filter(Boolean)

// true, если сервис стоит за reverse proxy, который выставляет X-Forwarded-For
export const TRUST_PROXY = process.env.TRUST_PROXY === 'true'

// порт HTTP/WS сервера
export const PORT = Number(process.env.PORT ?? 3001)

// Telegram-бот — опциональный канал; без токена /telegram/webhook просто
// не сможет ничего отправить обратно (входящие всё равно примет и сохранит)
export const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN || null
// секрет, который Telegram присылает в заголовке X-Telegram-Bot-Api-Secret-Token
// (задаётся при регистрации вебхука) — без него /telegram/webhook принимает
// запросы от кого угодно, кто узнает URL
export const TELEGRAM_WEBHOOK_SECRET = process.env.TELEGRAM_WEBHOOK_SECRET || null
