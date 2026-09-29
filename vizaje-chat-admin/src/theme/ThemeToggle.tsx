import { Moon, Sun } from 'lucide-react'
import { useTheme } from './useTheme'

// Показывает иконку темы, на которую переключит нажатие
export function ThemeToggle({ className = '' }: { className?: string }) {
	const { theme, toggle } = useTheme()
	const isDark = theme === 'dark'

	return (
		<button
			type="button"
			onClick={toggle}
			aria-label={isDark ? 'Включить светлую тему' : 'Включить тёмную тему'}
			title={isDark ? 'Светлая тема' : 'Тёмная тема'}
			className={`box-border flex h-11 w-11 cursor-pointer items-center justify-center rounded-lg border border-solid border-zinc-300 bg-white text-zinc-700 transition-colors hover:bg-zinc-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-zinc-900/30 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-200 dark:hover:bg-zinc-800 dark:focus-visible:ring-zinc-300/30 ${className}`}
		>
			{isDark ? (
				<Sun aria-hidden="true" className="h-5 w-5" />
			) : (
				<Moon aria-hidden="true" className="h-5 w-5" />
			)}
		</button>
	)
}
