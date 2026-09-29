import { cors } from '@elysiajs/cors'
import { Elysia } from 'elysia'
import { ALLOWED_ORIGINS } from './config'
import { authRoutes } from './routes/auth.routes'
import { conversationsRoutes } from './routes/conversations.routes'
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
		.use(conversationsRoutes)
		.use(wsRoutes)
}
