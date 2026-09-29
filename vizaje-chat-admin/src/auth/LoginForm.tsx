import { useState } from 'react'
import { login } from '../lib/api'

export function LoginForm({
	onSuccess
}: {
	onSuccess: (token: string) => void
}) {
	const [email, setEmail] = useState('')
	const [password, setPassword] = useState('')
	const [error, setError] = useState('')

	async function handleSubmit(e: React.FormEvent) {
		e.preventDefault()
		setError('')
		try {
			const { token } = await login(email, password)
			localStorage.setItem('admin_token', token)
			onSuccess(token)
		} catch {
			setError('Неверный email или пароль')
		}
	}

	return (
		<form onSubmit={handleSubmit}>
			<input
				value={email}
				onChange={e => setEmail(e.target.value)}
				placeholder="Email"
			/>
			<input
				value={password}
				onChange={e => setPassword(e.target.value)}
				type="password"
				placeholder="Пароль"
			/>
			<button type="submit">Войти</button>
			{error && <p className="text-[red]">{error}</p>}
		</form>
	)
}
