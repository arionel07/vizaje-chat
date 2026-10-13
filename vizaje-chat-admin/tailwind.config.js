/** @type {import('tailwindcss').Config} */
export default {
	// тёмная тема включается классом .dark на <html> (см. src/theme и скрипт в index.html)
	darkMode: 'class',
	content: ['./index.html', './src/**/*.{ts,tsx}'],
	theme: {
		extend: {
			keyframes: {
				'typing-dot': {
					'0%, 60%, 100%': { opacity: '0.3', transform: 'none' },
					'30%': { opacity: '1', transform: 'translateY(-2px)' }
				}
			},
			animation: { 'typing-dot': 'typing-dot 1.2s infinite ease-in-out' }
		}
	},
	plugins: []
}
