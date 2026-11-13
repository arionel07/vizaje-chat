import { cors } from '@elysiajs/cors'
import { Elysia } from 'elysia'
import { ALLOWED_ORIGINS } from './config'
import { aiBotRoutes } from './routes/ai-bot.routes'
import { analyticsRoutes } from './routes/analytics.routes'
import { authRoutes } from './routes/auth.routes'
import { botResponsesRoutes } from './routes/bot-responses.routes'
import { cannedResponsesRoutes } from './routes/canned-responses.routes'
import { conversationsRoutes } from './routes/conversations.routes'
import { instagramRoutes } from './routes/instagram.routes'
import { productsRoutes } from './routes/products.routes'
import { pushTokensRoutes } from './routes/push-tokens.routes'
import { reactionsRoutes } from './routes/reactions.routes'
import { settingsRoutes } from './routes/settings.routes'
import { telegramRoutes } from './routes/telegram.routes'
import { uploadsRoutes } from './routes/uploads.routes'
import { webPushRoutes } from './routes/web-push.routes'
import { widgetRoutes } from './routes/widget.routes'
import { wsRoutes } from './routes/ws.routes'

// Сборка приложения без запуска: index.ts слушает порт, тесты — случайный
export function createApp() {
	return new Elysia()
		.use(cors({ origin: ALLOWED_ORIGINS, credentials: true }))
		.onError(({ code, error, set }) => {
			// внутренние ошибки (например, упавший SQL) логируем, клиенту — без деталей
			if (code === 'UNKNOWN' || code === 'INTERNAL_SERVER_ERROR') {
				console.error(error)
				set.status = 500
				return { error: 'Internal server error' }
			}
		})
		.get('/health', () => ({ status: 'ok' }))
		.use(authRoutes)
		.use(widgetRoutes)
		.use(telegramRoutes)
		.use(instagramRoutes)
		.use(conversationsRoutes)
		.use(productsRoutes)
		.use(pushTokensRoutes)
		.use(reactionsRoutes)
		.use(settingsRoutes)
		.use(cannedResponsesRoutes)
		.use(botResponsesRoutes)
		.use(analyticsRoutes)
		.use(aiBotRoutes)
		.use(uploadsRoutes)
		.use(webPushRoutes)
		.use(wsRoutes)
}
