import { eq } from 'drizzle-orm'
import { db } from '../db/client'
import { webPushSubscriptions } from '../db/schema'

export type PushSubscriptionInput = {
	endpoint: string
	keys: { p256dh: string; auth: string }
}

// upsert по endpoint: тот же браузер на том же устройстве переподписывается
// под новым оператором, если устройство сменило владельца (как pushTokens)
export async function registerWebPushSubscription(
	adminId: number,
	subscription: PushSubscriptionInput
) {
	await db
		.insert(webPushSubscriptions)
		.values({
			adminId,
			endpoint: subscription.endpoint,
			p256dh: subscription.keys.p256dh,
			auth: subscription.keys.auth
		})
		.onConflictDoUpdate({
			target: webPushSubscriptions.endpoint,
			set: {
				adminId,
				p256dh: subscription.keys.p256dh,
				auth: subscription.keys.auth
			}
		})
}

// отключение уведомлений в браузере (кнопка «Выключить» в настройках)
export async function removeWebPushSubscription(endpoint: string) {
	await db.delete(webPushSubscriptions).where(eq(webPushSubscriptions.endpoint, endpoint))
}

export async function getAllWebPushSubscriptions() {
	return db
		.select({
			endpoint: webPushSubscriptions.endpoint,
			p256dh: webPushSubscriptions.p256dh,
			auth: webPushSubscriptions.auth
		})
		.from(webPushSubscriptions)
}
