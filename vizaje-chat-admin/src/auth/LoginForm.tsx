import { CircleAlert, Eye, EyeOff, Loader2, Lock, Mail } from 'lucide-react'
import { useState } from 'react'
import { login, LoginError } from '../lib/api'
import { ThemeToggle } from '../theme/ThemeToggle'

function errorMessage(e: unknown) {
	if (e instanceof LoginError) {
		if (e.status === 401) return 'Неверный email или пароль'
		if (e.status === 429) return 'Слишком много попыток. Попробуйте позже'
	}
	return 'Не удалось подключиться к серверу. Попробуйте ещё раз'
}

const inputClass =
	'box-border block w-full h-12 rounded-lg border border-solid border-zinc-300 bg-white pl-11 pr-4 text-base text-zinc-900 placeholder:text-zinc-400 outline-none transition-colors focus:border-zinc-900 focus:ring-2 focus:ring-zinc-900/15 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-100 dark:placeholder:text-zinc-500 dark:focus:border-zinc-300 dark:focus:ring-zinc-300/20'

export function LoginForm({
	onSuccess
}: {
	onSuccess: (token: string) => void
}) {
	const [email, setEmail] = useState('')
	const [password, setPassword] = useState('')
	const [showPassword, setShowPassword] = useState(false)
	const [error, setError] = useState('')
	const [submitting, setSubmitting] = useState(false)

	async function handleSubmit(e: React.FormEvent) {
		e.preventDefault()
		if (submitting) return
		setError('')
		setSubmitting(true)
		try {
			const { token } = await login(email, password)
			localStorage.setItem('admin_token', token)
			onSuccess(token)
		} catch (e) {
			setError(errorMessage(e))
			setSubmitting(false)
		}
	}

	return (
		<main className="flex min-h-dvh items-center justify-center bg-white px-4 py-8 text-left dark:bg-zinc-950">
			<ThemeToggle className="fixed left-4 top-4" />
			<div className="w-full max-w-sm sm:rounded-2xl sm:border sm:border-solid sm:border-zinc-200 sm:p-8 sm:shadow-sm dark:sm:border-zinc-800">
				<h1 className="m-0 text-2xl font-semibold tracking-tight text-zinc-950 dark:text-white">
					Добро пожаловать
				</h1>
				<p className="mt-2 text-base text-zinc-500 dark:text-zinc-400">
					Войдите в панель поддержки
				</p>

				<form onSubmit={handleSubmit} className="mt-8 space-y-5">
					<div>
						<label
							htmlFor="email"
							className="mb-2 block text-sm font-medium text-zinc-700 dark:text-zinc-300"
						>
							Email
						</label>
						<div className="relative">
							<Mail
								aria-hidden="true"
								className="pointer-events-none absolute left-3.5 top-1/2 h-5 w-5 -translate-y-1/2 text-zinc-400"
							/>
							<input
								id="email"
								type="email"
								inputMode="email"
								autoComplete="email"
								required
								value={email}
								onChange={e => setEmail(e.target.value)}
								placeholder="name@example.com"
								className={inputClass}
							/>
						</div>
					</div>

					<div>
						<label
							htmlFor="password"
							className="mb-2 block text-sm font-medium text-zinc-700 dark:text-zinc-300"
						>
							Пароль
						</label>
						<div className="relative">
							<Lock
								aria-hidden="true"
								className="pointer-events-none absolute left-3.5 top-1/2 h-5 w-5 -translate-y-1/2 text-zinc-400"
							/>
							<input
								id="password"
								type={showPassword ? 'text' : 'password'}
								autoComplete="current-password"
								required
								value={password}
								onChange={e => setPassword(e.target.value)}
								placeholder="Введите пароль"
								className={`${inputClass} pr-12`}
							/>
							<button
								type="button"
								onClick={() => setShowPassword(v => !v)}
								aria-label={showPassword ? 'Скрыть пароль' : 'Показать пароль'}
								aria-pressed={showPassword}
								className="absolute right-1 top-1/2 flex h-10 w-10 -translate-y-1/2 cursor-pointer items-center justify-center rounded-md border-0 bg-transparent text-zinc-500 hover:text-zinc-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-zinc-900/30 dark:text-zinc-400 dark:hover:text-zinc-100 dark:focus-visible:ring-zinc-300/30"
							>
								{showPassword ? (
									<EyeOff aria-hidden="true" className="h-5 w-5" />
								) : (
									<Eye aria-hidden="true" className="h-5 w-5" />
								)}
							</button>
						</div>
					</div>

					{error && (
						<div
							role="alert"
							className="flex items-start gap-2 rounded-lg border border-solid border-red-200 bg-red-50 px-3 py-2.5 text-sm text-red-700 dark:border-red-500/30 dark:bg-red-500/10 dark:text-red-300"
						>
							<CircleAlert
								aria-hidden="true"
								className="mt-0.5 h-4 w-4 shrink-0"
							/>
							<span>{error}</span>
						</div>
					)}

					<button
						type="submit"
						disabled={submitting}
						className="flex h-12 w-full cursor-pointer items-center justify-center gap-2 rounded-lg border-0 bg-zinc-950 text-base font-semibold text-white transition-colors hover:bg-zinc-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-zinc-900/40 focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-70 dark:bg-white dark:text-zinc-950 dark:hover:bg-zinc-200 dark:focus-visible:ring-white/60 dark:focus-visible:ring-offset-zinc-950"
					>
						{submitting && (
							<Loader2 aria-hidden="true" className="h-5 w-5 animate-spin" />
						)}
						{submitting ? 'Входим…' : 'Войти'}
					</button>
				</form>
			</div>
		</main>
	)
}
