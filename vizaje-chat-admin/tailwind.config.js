/** @type {import('tailwindcss').Config} */
export default {
	content: ['./index.html', './src/**/*.{ts,tsx}'],
	// Preflight выключен: на этом шаге переносим старые инлайн-стили «один в один»,
	// а браузерные стили кнопок и полей должны остаться как были.
	// Бордеры заданы arbitrary-свойствами ([border-bottom:1px_solid_#eee]): без
	// Preflight классы border-*/border-solid дали бы 3px по умолчанию.
	// Включить Preflight можно на этапе редизайна.
	corePlugins: { preflight: false },
	theme: { extend: {} },
	plugins: []
}
