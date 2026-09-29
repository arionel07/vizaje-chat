/** @type {import('tailwindcss').Config} */
export default {
	// тёмная тема включается классом .dark на <html> (см. src/theme и скрипт в index.html)
	darkMode: 'class',
	content: ['./index.html', './src/**/*.{ts,tsx}'],
	theme: { extend: {} },
	plugins: []
}
