export const API_URL = (
	import.meta.env.VITE_API_URL || 'http://localhost:3001'
).replace(/\/$/, '')

export const WS_URL = API_URL.replace(/^http/, 'ws') + '/ws'

// язык диктовки (речь в текст); можно переопределить через VITE_DICTATION_LANG
export const DICTATION_LANG = import.meta.env.VITE_DICTATION_LANG || 'ru-RU'
