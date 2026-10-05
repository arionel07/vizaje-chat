import { Elysia, t } from 'elysia'
import { verifyToken } from '../auth/guard'
import {
	getSchedule,
	getWidgetTheme,
	setSchedule,
	setWidgetTheme
} from '../settings/service'

const daySchema = t.Object({
	enabled: t.Boolean(),
	start: t.String(),
	end: t.String()
})

const scheduleBody = t.Object({
	days: t.Object({
		mon: daySchema,
		tue: daySchema,
		wed: daySchema,
		thu: daySchema,
		fri: daySchema,
		sat: daySchema,
		sun: daySchema
	})
})

export const settingsRoutes = new Elysia()
	.get('/admin/settings/schedule', async ({ headers, set }) => {
		const admin = verifyToken(headers.authorization)
		if (!admin) {
			set.status = 401
			return { error: 'Unauthorized' }
		}
		return getSchedule()
	})
	.put(
		'/admin/settings/schedule',
		async ({ headers, body, set }) => {
			const admin = verifyToken(headers.authorization)
			if (!admin) {
				set.status = 401
				return { error: 'Unauthorized' }
			}
			try {
				return await setSchedule(body)
			} catch (e) {
				set.status = 422
				return { error: e instanceof Error ? e.message : 'Invalid schedule' }
			}
		},
		{ body: scheduleBody }
	)
	.get('/admin/settings/theme', async ({ headers, set }) => {
		const admin = verifyToken(headers.authorization)
		if (!admin) {
			set.status = 401
			return { error: 'Unauthorized' }
		}
		return { theme: await getWidgetTheme() }
	})
	.put(
		'/admin/settings/theme',
		async ({ headers, body, set }) => {
			const admin = verifyToken(headers.authorization)
			if (!admin) {
				set.status = 401
				return { error: 'Unauthorized' }
			}
			try {
				return { theme: await setWidgetTheme(body.theme) }
			} catch (e) {
				set.status = 422
				return { error: e instanceof Error ? e.message : 'Invalid theme' }
			}
		},
		{ body: t.Object({ theme: t.String() }) }
	)
