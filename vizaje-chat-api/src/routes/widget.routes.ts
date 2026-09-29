import { Elysia, t } from 'elysia'
import { addMessage, getMessages } from '../chat/service'
import { createSession, verifySessionToken } from '../widget/service'

export const widgetRoutes = new Elysia()
	.post('/widget/session', async () => {
		return createSession()
	})
	.post(
		'/widget/messages',
		async ({ headers, body, set }) => {
			const session = verifySessionToken(headers.authorization)
			if (!session) {
				set.status = 401
				return { error: 'Unauthorized' }
			}
			return addMessage(session.conversationId, 'visitor', body.text)
		},
		{
			body: t.Object({ text: t.String() })
		}
	)
	.get('/widget/messages', async ({ headers, set }) => {
		const session = verifySessionToken(headers.authorization)
		if (!session) {
			set.status = 401
			return { error: 'Unauthorized' }
		}
		return getMessages(session.conversationId)
	})
