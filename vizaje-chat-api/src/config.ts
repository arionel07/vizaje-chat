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

// куда на диске складываются загруженные вложения (картинки из чата)
export const UPLOAD_DIR = process.env.UPLOAD_DIR || './uploads'
// максимальный размер одного файла, байт — по умолчанию 10MB
export const MAX_UPLOAD_SIZE = Number(process.env.MAX_UPLOAD_SIZE ?? 10 * 1024 * 1024)
// сколько дней хранить вложение, прежде чем удалить файл с диска (само
// сообщение в истории остаётся, просто без картинки) — см. uploads/cleanup.ts
export const ATTACHMENT_RETENTION_DAYS = Number(process.env.ATTACHMENT_RETENTION_DAYS ?? 3)
