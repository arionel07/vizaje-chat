import { Elysia, t } from 'elysia'
import { verifyToken } from '../auth/guard'
import { VAPID_PUBLIC_KEY } from '../config'
import { registerWebPushSubscription, removeWebPushSubscription } from '../web-push/service'

export const webPushRoutes = new Elysia()
	// публичный ключ пары VAPID — нужен браузеру, чтобы создать подписку
	// (PushManager.subscribe({ applicationServerKey })); не секрет, но за
	// авторизацией — как и остальные /admin/* эндпоинты
	.get('/admin/web-push/public-key', ({ headers, set }) => {
		const admin = verifyToken(headers.authorization)
		if (!admin) {
			set.status = 401
			return { error: 'Unauthorized' }
		}
		if (!VAPID_PUBLIC_KEY) {
			set.status = 404
			return { error: 'Web Push не настроен на сервере' }
		}
		return { publicKey: VAPID_PUBLIC_KEY }
	})
	.post(
		'/admin/web-push/subscribe',
		async ({ headers, body, set }) => {
			const admin = verifyToken(headers.authorization)
			if (!admin) {
				set.status = 401
				return { error: 'Unauthorized' }
			}
			await registerWebPushSubscription(admin.sub, body)
			return { ok: true }
		},
		{
			body: t.Object({
				endpoint: t.String(),
				keys: t.Object({ p256dh: t.String(), auth: t.String() })
			})
		}
	)
	.post(
		'/admin/web-push/unsubscribe',
		async ({ headers, body, set }) => {
			const admin = verifyToken(headers.authorization)
			if (!admin) {
				set.status = 401
				return { error: 'Unauthorized' }
			}
			await removeWebPushSubscription(body.endpoint)
			return { ok: true }
		},
		{ body: t.Object({ endpoint: t.String() }) }
	)
