import { Moon, Sun } from 'lucide-react'
import { useTheme } from './useTheme'

// Показывает иконку темы, на которую переключит нажатие
export function ThemeToggle({
	className = '',
	compact = false
}: {
	className?: string
	compact?: boolean // без рамки, 40px — для шапок
}) {
	const { theme, toggle } = useTheme()
	const isDark = theme === 'dark'

	return (
		<button
			type="button"
			onClick={toggle}
			aria-label={isDark ? 'Включить светлую тему' : 'Включить тёмную тему'}
			title={isDark ? 'Светлая тема' : 'Тёмная тема'}
			className={`flex shrink-0 cursor-pointer items-center justify-center rounded-lg text-zinc-700 transition-colors hover:bg-zinc-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-zinc-900/30 dark:text-zinc-200 dark:hover:bg-zinc-800 dark:focus-visible:ring-zinc-300/30 ${
				compact
					? 'h-10 w-10'
					: 'h-11 w-11 border border-zinc-300 bg-white dark:border-zinc-700 dark:bg-zinc-900'
			} ${className}`}
		>
			{isDark ? (
				<Sun aria-hidden="true" className="h-5 w-5" />
			) : (
				<Moon aria-hidden="true" className="h-5 w-5" />
			)}
		</button>
	)
}
