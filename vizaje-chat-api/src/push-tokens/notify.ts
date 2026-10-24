import { sendExpoPush } from './expo-push'
import { getAllPushTokens } from './service'
import { sendWebPush } from '../web-push/send'
import { getAllWebPushSubscriptions } from '../web-push/service'
import { getSchedule, isOnlineAt } from '../settings/service'

// best-effort, не блокирует обработку сообщения — общий путь для сообщения
// посетителя виджета (ws.routes.ts) и сообщений, пришедших из Telegram/Instagram
// (telegram/flow.ts, instagram/flow.ts): раньше push слался только для виджета,
// оператор узнавал о новом Telegram/Instagram-сообщении лишь если беседа уже
// была открыта
//
// вне рабочего графика push не шлём — сообщение всё равно сохраняется и
// приходит по WS, просто без уведомления; оператор увидит его в начале
// следующей рабочей смены
export async function notifyAdminsOfVisitorMessage(conversationId: number, text: string) {
	const schedule = await getSchedule().catch(() => null)
	if (schedule && !isOnlineAt(schedule, new Date())) return

	getAllPushTokens()
		.then(tokens =>
			sendExpoPush(tokens, {
				title: `Беседа #${conversationId}`,
				body: text,
				data: { conversationId }
			})
		)
		.catch(error => console.error('Failed to notify admins:', error))
	getAllWebPushSubscriptions()
		.then(subs =>
			sendWebPush(subs, {
				title: `Беседа #${conversationId}`,
				body: text,
				data: { conversationId }
			})
		)
		.catch(error => console.error('Failed to send web push to admins:', error))
}
