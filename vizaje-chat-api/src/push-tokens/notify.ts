import { sendExpoPush } from './expo-push'
import { getAllPushTokens } from './service'
import { sendWebPush } from '../web-push/send'
import { getAllWebPushSubscriptions } from '../web-push/service'

// best-effort, не блокирует обработку сообщения — общий путь для сообщения
// посетителя виджета (ws.routes.ts) и сообщений, пришедших из Telegram/Instagram
// (telegram/flow.ts, instagram/flow.ts): раньше push слался только для виджета,
// оператор узнавал о новом Telegram/Instagram-сообщении лишь если беседа уже
// была открыта
export function notifyAdminsOfVisitorMessage(conversationId: number, text: string) {
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
