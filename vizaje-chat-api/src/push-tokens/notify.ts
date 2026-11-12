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

// отдельный пуш в момент, когда ИИ-бот передал беседу оператору (ai-bot/service.ts) —
// обычный пуш о сообщении посетителя уже мог прийти раньше (на само сообщение,
// которое и привело к передаче) и ничем не выделялся среди прочих; этот явно
// говорит «нужен человек», чтобы оператор не пропустил эскалацию
export async function notifyAdminsOfAiHandoff(conversationId: number, summary: string) {
	const schedule = await getSchedule().catch(() => null)
	if (schedule && !isOnlineAt(schedule, new Date())) return

	const title = `🤖→🧑 ИИ передал беседу #${conversationId}`
	getAllPushTokens()
		.then(tokens => sendExpoPush(tokens, { title, body: summary, data: { conversationId } }))
		.catch(error => console.error('Failed to notify admins of AI handoff:', error))
	getAllWebPushSubscriptions()
		.then(subs => sendWebPush(subs, { title, body: summary, data: { conversationId } }))
		.catch(error => console.error('Failed to send web push for AI handoff:', error))
}
