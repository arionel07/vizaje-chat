import { Elysia, t } from 'elysia'
import { verifyToken } from '../auth/guard'
import { login } from '../auth/service'

export const authRoutes = new Elysia()
	.post(
		'/admin/auth/login',
		async ({ body, set }) => {
			const result = await login(body.email, body.password)
			if (!result) {
				set.status = 401
				return { error: 'Invalid credentials' }
			}
			return result
		},
		{
			body: t.Object({ email: t.String(), password: t.String() })
		}
	)
	.get('/admin/auth/me', ({ headers, set }) => {
		const payload = verifyToken(headers.authorization)
		if (!payload) {
			set.status = 401
			return { error: 'Unauthorized' }
		}
		return { email: payload.email }
	})
