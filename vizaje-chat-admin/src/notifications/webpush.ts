// Web Push: уведомления о новых сообщениях приходят даже когда вкладка
// админки не открыта (на телефоне — как у нативного приложения). На iOS
// Safari работает только после «Добавить на экран Домой» — ограничение
// самого iOS, Push API в обычной вкладке там недоступен.
import { fetchVapidPublicKey, subscribeWebPush } from '../lib/api'

function isSupported() {
	return 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window
}

// VAPID-ключ приходит в base64url — PushManager.subscribe() ждёт Uint8Array
function urlBase64ToUint8Array(base64Url: string) {
	const padding = '='.repeat((4 - (base64Url.length % 4)) % 4)
	const base64 = (base64Url + padding).replace(/-/g, '+').replace(/_/g, '/')
	const raw = atob(base64)
	return Uint8Array.from([...raw].map(c => c.charCodeAt(0)))
}

// вызывается при каждом заходе в админку, после запроса обычного разрешения
// на уведомления (см. ensureNotificationPermission в alerts.ts) — если
// разрешение уже есть, тихо (пере)регистрирует подписку; ничего не просит
// и не падает, если Web Push не поддерживается браузером или не настроен на сервере
export async function ensureWebPushSubscription(token: string) {
	if (!isSupported() || Notification.permission !== 'granted') return
	try {
		const registration = await navigator.serviceWorker.register('/sw.js')
		const existing = await registration.pushManager.getSubscription()
		const subscription =
			existing ??
			(await (async () => {
				const publicKey = await fetchVapidPublicKey(token)
				if (!publicKey) return null // Web Push не настроен на сервере
				return registration.pushManager.subscribe({
					userVisibleOnly: true,
					applicationServerKey: urlBase64ToUint8Array(publicKey)
				})
			})())
		if (!subscription) return
		await subscribeWebPush(token, subscription.toJSON())
	} catch (error) {
		// лучше тихо остаться без push-уведомлений, чем сломать загрузку админки
		console.error('Web Push subscription failed:', error)
	}
}
