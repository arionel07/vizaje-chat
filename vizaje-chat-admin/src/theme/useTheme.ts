import { useCallback, useEffect, useState } from 'react'

export type Theme = 'light' | 'dark'

const STORAGE_KEY = 'theme'
const DARK_QUERY = '(prefers-color-scheme: dark)'

function storedTheme(): Theme | null {
	try {
		const t = localStorage.getItem(STORAGE_KEY)
		return t === 'light' || t === 'dark' ? t : null
	} catch {
		return null
	}
}

function systemTheme(): Theme {
	return window.matchMedia(DARK_QUERY).matches ? 'dark' : 'light'
}

// Тема хранится классом .dark на <html>. Пока пользователь сам не выбрал,
// следуем за системной темой; после выбора — за его выбором.
export function useTheme() {
	const [theme, setTheme] = useState<Theme>(() => storedTheme() ?? systemTheme())

	useEffect(() => {
		document.documentElement.classList.toggle('dark', theme === 'dark')
	}, [theme])

	useEffect(() => {
		const mq = window.matchMedia(DARK_QUERY)
		const onChange = () => {
			if (!storedTheme()) setTheme(mq.matches ? 'dark' : 'light')
		}
		mq.addEventListener('change', onChange)
		return () => mq.removeEventListener('change', onChange)
	}, [])

	const toggle = useCallback(() => {
		const next: Theme = theme === 'dark' ? 'light' : 'dark'
		try {
			localStorage.setItem(STORAGE_KEY, next)
		} catch {
			// приватный режим и т.п. — тема просто не запомнится
		}
		setTheme(next)
	}, [theme])

	return { theme, toggle }
}
