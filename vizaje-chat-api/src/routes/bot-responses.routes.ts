import { Elysia, t } from 'elysia'
import { verifyToken } from '../auth/guard'
import {
	createBotResponse,
	deleteBotResponse,
	listBotResponses,
	updateBotResponse
} from '../bot-responses/service'

const createBody = t.Object({
	triggerText: t.String(),
	answerRu: t.String(),
	answerRo: t.String()
})

const updateBody = t.Object({
	triggerText: t.Optional(t.String()),
	answerRu: t.Optional(t.String()),
	answerRo: t.Optional(t.String())
})

export const botResponsesRoutes = new Elysia()
	.get('/admin/bot-responses', async ({ headers, set }) => {
		const admin = verifyToken(headers.authorization)
		if (!admin) {
			set.status = 401
			return { error: 'Unauthorized' }
		}
		return listBotResponses()
	})
	.post(
		'/admin/bot-responses',
		async ({ headers, body, set }) => {
			const admin = verifyToken(headers.authorization)
			if (!admin) {
				set.status = 401
				return { error: 'Unauthorized' }
			}
			try {
				set.status = 201
				return await createBotResponse(body)
			} catch (e) {
				set.status = 422
				return { error: e instanceof Error ? e.message : 'Invalid bot response' }
			}
		},
		{ body: createBody }
	)
	.patch(
		'/admin/bot-responses/:id',
		async ({ headers, params, body, set }) => {
			const admin = verifyToken(headers.authorization)
			if (!admin) {
				set.status = 401
				return { error: 'Unauthorized' }
			}
			try {
				const updated = await updateBotResponse(Number(params.id), body)
				if (!updated) {
					set.status = 404
					return { error: 'Bot response not found' }
				}
				return updated
			} catch (e) {
				set.status = 422
				return { error: e instanceof Error ? e.message : 'Invalid bot response' }
			}
		},
		{ body: updateBody }
	)
	.delete('/admin/bot-responses/:id', async ({ headers, params, set }) => {
		const admin = verifyToken(headers.authorization)
		if (!admin) {
			set.status = 401
			return { error: 'Unauthorized' }
		}
		const deleted = await deleteBotResponse(Number(params.id))
		if (!deleted) {
			set.status = 404
			return { error: 'Bot response not found' }
		}
		return { ok: true }
	})
