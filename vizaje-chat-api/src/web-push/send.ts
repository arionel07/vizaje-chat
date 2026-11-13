import webpush from 'web-push'
import { VAPID_PRIVATE_KEY, VAPID_PUBLIC_KEY, VAPID_SUBJECT } from '../config'
import { removeWebPushSubscription } from './service'

if (VAPID_PUBLIC_KEY && VAPID_PRIVATE_KEY) {
	webpush.setVapidDetails(VAPID_SUBJECT, VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY)
}

type Subscription = { endpoint: string; p256dh: string; auth: string }

// настоящая отправка — вызов web-push (сеть к push-серверу браузера);
// подменяется в тестах через setWebPushSender, как publisher в chat/events.ts
let sender: typeof webpush.sendNotification = (subscription, payload) =>
	webpush.sendNotification(subscription, payload)

export function setWebPushSender(fn: typeof webpush.sendNotification) {
	sender = fn
}

export async function sendWebPush(
	subscriptions: Subscription[],
	notification: { title: string; body: string; data?: Record<string, unknown> }
) {
	if (!VAPID_PUBLIC_KEY || !VAPID_PRIVATE_KEY) return
	const payload = JSON.stringify(notification)

	await Promise.all(
		subscriptions.map(async sub => {
			try {
				await sender(
					{
						endpoint: sub.endpoint,
						keys: { p256dh: sub.p256dh, auth: sub.auth }
					},
					payload
				)
			} catch (error) {
				// 404/410 — подписка больше не существует (отписались, очистили
				// данные браузера, переустановили) — чистим, иначе будем долбиться
				// в мёртвый endpoint на каждое сообщение
				const statusCode = (error as { statusCode?: number } | null)?.statusCode
				if (statusCode === 404 || statusCode === 410) {
					await removeWebPushSubscription(sub.endpoint).catch(() => {})
				} else {
					console.error('Failed to send web push notification:', error)
				}
			}
		})
	)
}
