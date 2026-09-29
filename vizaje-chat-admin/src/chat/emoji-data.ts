// Набор эмодзи (тот же, что в виджете: vizaje-chat-widget/widget.js, EMOJI_CATEGORIES)
export type EmojiCategory = { id: string; label: string; icon: string; emojis: string[] }

const split = (s: string) => s.split(' ')

export const EMOJI_CATEGORIES: EmojiCategory[] = [
	{
		id: 'smileys',
		label: 'Смайлы',
		icon: '😀',
		emojis: split(
			'😀 😃 😄 😁 😆 😅 😂 🤣 🙂 🙃 😉 😊 😇 🥰 😍 🤩 😘 😋 😜 🤪 😎 🤓 🥳 😏 😌 😔 😢 😭 😤 😡 🥺 😱 😳 🤔 🤗 🙄 😴 🤯 😬'
		)
	},
	{
		id: 'gestures',
		label: 'Жесты',
		icon: '👍',
		emojis: split('👍 👎 👌 ✌️ 🤞 🤝 👏 🙌 🙏 💪 👋 🤚 ✋ 🫡 🤙 👀 ☝️ 👇 👉 👈 🤷 🙋 🤦')
	},
	{
		id: 'hearts',
		label: 'Сердца',
		icon: '❤️',
		emojis: split('❤️ 🧡 💛 💚 💙 💜 🖤 🤍 💔 ❣️ 💕 💖 💗 💯 ✨ 🔥 ⭐ 🎉 🎊 🎁')
	},
	{
		id: 'objects',
		label: 'Предметы',
		icon: '📦',
		emojis: split('✅ ❌ ❗ ❓ ⚠️ 💬 📦 🚚 📞 📧 🕐 💳 💰 🛒 🎯 🔒 🔑 📌 ✏️ 📎 🎧 📷 💡')
	},
	{
		id: 'nature',
		label: 'Еда и природа',
		icon: '☕',
		emojis: split('☕ 🍕 🍔 🍰 🍎 🍓 🌞 🌙 🌈 🌸 🌹 🐶 🐱 🐻 🚗 ✈️ 🏠')
	}
]

const RECENT_KEY = 'admin_emoji_recent'
const RECENT_MAX = 16

export function readRecentEmoji(): string[] {
	try {
		const list = JSON.parse(localStorage.getItem(RECENT_KEY) ?? '[]')
		return Array.isArray(list)
			? list.filter((x): x is string => typeof x === 'string').slice(0, RECENT_MAX)
			: []
	} catch {
		return []
	}
}

export function pushRecentEmoji(emoji: string) {
	const next = [emoji, ...readRecentEmoji().filter(e => e !== emoji)].slice(0, RECENT_MAX)
	try {
		localStorage.setItem(RECENT_KEY, JSON.stringify(next))
	} catch {
		// приватный режим и т.п. — «недавние» просто не запомнятся
	}
}
